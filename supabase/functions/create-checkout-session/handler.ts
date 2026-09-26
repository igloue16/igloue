import { paymentCapabilityHash } from "../create-reservation/payment-capability.ts";
import {
  type CheckoutAdapter,
  createStripeCheckoutAdapter,
  StripeAdapterError,
  stripeIdempotencyKey,
} from "./stripe.ts";

const MAX_REQUEST_BYTES = 8_192;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CORS_HEADERS = Object.freeze({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
});

type RpcError = { code?: string; message?: string } | null;
export type CheckoutRpcClient = {
  rpc(
    name: string,
    parameters: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: RpcError }>;
};

type Dependencies = {
  supabaseAdmin: CheckoutRpcClient;
  stripeAdapter: CheckoutAdapter;
  now?: Date;
  successUrl: string;
  cancelUrl: string;
  logError?: (...values: unknown[]) => void;
};

function response(body: Record<string, unknown>, status: number) {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

function errorResponse(status: number, code: string) {
  return response({ ok: false, error: { code } }, status);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).length === keys.length &&
    Object.keys(value).every((key) => keys.includes(key));
}

function row(value: unknown): Record<string, unknown> | null {
  const item = Array.isArray(value) ? value[0] : value;
  return isObject(item) ? item : null;
}

function isValidUrl(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("https://");
}

function mapRpcError(error: RpcError) {
  if (!error) return null;
  if (error.code === "22023") return errorResponse(400, "INVALID_REQUEST");
  if (error.code === "P0001" || error.code === "P0002") {
    return errorResponse(409, "PAYMENT_UNAVAILABLE");
  }
  return errorResponse(503, "PAYMENT_UNAVAILABLE");
}

function mapStripeError(
  error: unknown,
  logError?: (...values: unknown[]) => void,
) {
  if (error instanceof StripeAdapterError) {
    if (error.kind === "timeout") {
      return errorResponse(504, "PAYMENT_PROVIDER_TIMEOUT");
    }
    if (error.kind === "provider_4xx") {
      return errorResponse(502, "PAYMENT_PROVIDER_ERROR");
    }
    if (error.kind === "provider_5xx") {
      return errorResponse(502, "PAYMENT_PROVIDER_UNAVAILABLE");
    }
  }
  logError?.("checkout provider failure");
  return errorResponse(502, "PAYMENT_PROVIDER_ERROR");
}

export function createCheckoutOptionsResponse() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function handleCheckoutRequest(
  request: Request,
  dependencies: Dependencies,
) {
  if (request.method === "OPTIONS") return createCheckoutOptionsResponse();
  if (request.method !== "POST") {
    return errorResponse(405, "METHOD_NOT_ALLOWED");
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return errorResponse(400, "INVALID_REQUEST");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "INVALID_REQUEST");
  }
  if (
    !isObject(body) ||
    !hasOnlyKeys(body, ["reservationId", "paymentCapability", "idempotencyKey"])
  ) {
    return errorResponse(400, "INVALID_REQUEST");
  }
  const reservationId = body.reservationId;
  const capability = body.paymentCapability;
  const idempotencyKey = typeof body.idempotencyKey === "string"
    ? body.idempotencyKey.trim()
    : "";
  if (
    typeof reservationId !== "string" || !UUID.test(reservationId) ||
    typeof capability !== "string" || capability.length === 0 ||
    idempotencyKey.length === 0 || idempotencyKey.length > 255
  ) {
    return errorResponse(400, "INVALID_REQUEST");
  }

  let capabilityHash: string;
  try {
    capabilityHash = await paymentCapabilityHash(capability);
  } catch {
    return errorResponse(409, "PAYMENT_UNAVAILABLE");
  }

  const initiated = await dependencies.supabaseAdmin.rpc(
    "initiate_reservation_payment",
    {
      p_reservation_id: reservationId,
      p_capability_hash: capabilityHash,
      p_idempotency_key: idempotencyKey,
    },
  );
  const initiationError = mapRpcError(initiated.error);
  if (initiationError) return initiationError;
  const attempt = row(initiated.data);
  if (
    !attempt || typeof attempt.payment_attempt_id !== "string" ||
    typeof attempt.organisation_id !== "string"
  ) {
    dependencies.logError?.("payment initiation returned invalid data");
    return errorResponse(503, "PAYMENT_UNAVAILABLE");
  }

  const stateResult = await dependencies.supabaseAdmin.rpc(
    "prepare_reservation_payment_checkout",
    {
      p_payment_attempt_id: attempt.payment_attempt_id,
      p_organisation_id: attempt.organisation_id,
    },
  );
  const stateError = mapRpcError(stateResult.error);
  if (stateError) return stateError;
  const state = row(stateResult.data);
  if (!state || typeof state.eligible !== "boolean") {
    dependencies.logError?.("checkout state returned invalid data");
    return errorResponse(503, "PAYMENT_UNAVAILABLE");
  }
  if (!state.eligible) return errorResponse(409, "PAYMENT_WINDOW_CLOSED");
  if (
    typeof state.hold_expires_at !== "string" ||
    typeof state.checkout_expires_at !== "string"
  ) {
    dependencies.logError?.("checkout state returned invalid timing data");
    return errorResponse(503, "PAYMENT_UNAVAILABLE");
  }

  if (state.provider_checkout_session_id || state.provider_checkout_url) {
    if (
      state.attempt_status !== "checkout_open" ||
      typeof state.provider_checkout_session_id !== "string" ||
      !isValidUrl(state.provider_checkout_url)
    ) {
      return errorResponse(409, "PAYMENT_WINDOW_CLOSED");
    }
    return response({
      ok: true,
      checkout: {
        url: state.provider_checkout_url,
        holdExpiresAt: state.hold_expires_at,
      },
    }, 200);
  }

  const authoritativeAmount = typeof state.amount === "number"
    ? state.amount
    : typeof state.amount === "string"
    ? Number(state.amount)
    : NaN;
  if (
    !Number.isFinite(authoritativeAmount) || state.currency !== "EUR" ||
    typeof state.customer_email !== "string" ||
    typeof state.reservation_id !== "string"
  ) {
    return errorResponse(503, "PAYMENT_UNAVAILABLE");
  }

  let session;
  try {
    session = await dependencies.stripeAdapter.createCheckoutSession({
      amount: authoritativeAmount,
      currency: state.currency,
      paymentAttemptId: attempt.payment_attempt_id,
      reservationId: state.reservation_id,
      customerEmail: state.customer_email,
      expiresAt: Math.ceil(Date.parse(state.checkout_expires_at) / 1000),
      successUrl: dependencies.successUrl,
      cancelUrl: dependencies.cancelUrl,
    }, stripeIdempotencyKey(attempt.payment_attempt_id));
  } catch (error) {
    return mapStripeError(error, dependencies.logError);
  }

  if (!session || typeof session.id !== "string" || !isValidUrl(session.url)) {
    return errorResponse(502, "PAYMENT_PROVIDER_ERROR");
  }
  // Recheck DB time and hold authority after the provider call. If the
  // window has become unsafe, never return the URL to the browser.
  const checked = await dependencies.supabaseAdmin.rpc(
    "prepare_reservation_payment_checkout",
    {
      p_payment_attempt_id: attempt.payment_attempt_id,
      p_organisation_id: attempt.organisation_id,
    },
  );
  const checkedError = mapRpcError(checked.error);
  if (checkedError) return checkedError;
  const checkedRow = row(checked.data);
  if (
    !checkedRow || checkedRow.eligible !== true ||
    checkedRow.checkout_expires_at !== state.checkout_expires_at ||
    checkedRow.hold_expires_at !== state.hold_expires_at
  ) {
    return errorResponse(409, "PAYMENT_WINDOW_CLOSED");
  }
  const persisted = await dependencies.supabaseAdmin.rpc(
    "persist_reservation_payment_checkout",
    {
      p_payment_attempt_id: attempt.payment_attempt_id,
      p_organisation_id: attempt.organisation_id,
      p_provider_checkout_session_id: session.id,
      p_provider_checkout_url: session.url,
      p_provider_payment_intent_id: session.paymentIntentId ?? null,
    },
  );
  const persistError = mapRpcError(persisted.error);
  if (persistError) return persistError;
  const persistedRow = row(persisted.data);
  if (
    !persistedRow || typeof persistedRow.hold_expires_at !== "string" ||
    typeof persistedRow.eligible !== "boolean"
  ) {
    dependencies.logError?.("checkout persistence returned invalid data");
    return errorResponse(503, "PAYMENT_UNAVAILABLE");
  }
  if (!persistedRow.eligible) {
    return errorResponse(409, "PAYMENT_WINDOW_CLOSED");
  }
  const finalStateResult = await dependencies.supabaseAdmin.rpc(
    "prepare_reservation_payment_checkout",
    {
      p_payment_attempt_id: attempt.payment_attempt_id,
      p_organisation_id: attempt.organisation_id,
    },
  );
  const finalStateError = mapRpcError(finalStateResult.error);
  if (finalStateError) return finalStateError;
  const finalState = row(finalStateResult.data);
  if (
    !finalState || finalState.eligible !== true ||
    finalState.provider_checkout_session_id !== session.id ||
    finalState.checkout_expires_at !== state.checkout_expires_at
  ) {
    return errorResponse(409, "PAYMENT_WINDOW_CLOSED");
  }
  return response({
    ok: true,
    checkout: { url: session.url, holdExpiresAt: persistedRow.hold_expires_at },
  }, 201);
}

export function createProductionDependencies(
  supabaseAdmin: CheckoutRpcClient,
): Dependencies {
  const secret = Deno.env.get("STRIPE_SECRET_KEY")?.trim();
  const successUrl = Deno.env.get("IGLOUE_CHECKOUT_SUCCESS_URL")?.trim();
  const cancelUrl = Deno.env.get("IGLOUE_CHECKOUT_CANCEL_URL")?.trim();
  if (!secret || !isValidUrl(successUrl) || !isValidUrl(cancelUrl)) {
    throw new Error("checkout configuration unavailable");
  }
  return {
    supabaseAdmin,
    stripeAdapter: createStripeCheckoutAdapter(secret),
    successUrl,
    cancelUrl,
  };
}
