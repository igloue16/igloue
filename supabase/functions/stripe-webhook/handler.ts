import { verifyStripeSignature } from "./signature.ts";
import { payloadSha256 } from "./digest.ts";
import type { ReceiptRpcClient } from "./receipt.ts";
import {
  type CheckoutSessionParseResult,
  parseCheckoutSessionCompleted,
} from "./checkout-session.ts";
import { parseExpectedLivemode } from "./config.ts";
import {
  isSupportedStripeRefundEventType,
  parseStripeRefundEvent,
} from "./refund-event.ts";

export const MAX_BODY_BYTES = 1024 * 1024;

export type WebhookParser = (event: unknown) => CheckoutSessionParseResult;

type Dependencies = {
  secret?: string;
  now?: Date;
  receiptClient?: ReceiptRpcClient;
  matcherClient?: ReceiptRpcClient;
  expectedLivemode?: string;
  parser?: WebhookParser;
};

function response(code: string, status: number) {
  return Response.json({ ok: false, error: { code } }, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type StripeEventEnvelope = {
  id: string;
  type: string;
  created: string;
  livemode: boolean;
};

function parseEventEnvelope(value: unknown): StripeEventEnvelope | null {
  if (!isRecord(value)) return null;

  const id = value.id;
  const type = value.type;
  const created = value.created;
  const livemode = value.livemode;
  if (
    typeof id !== "string" || id.length < 1 || id.length > 255 ||
    id !== id.trim()
  ) return null;
  if (
    typeof type !== "string" || type.length < 1 || type.length > 255 ||
    type !== type.trim()
  ) return null;
  if (
    typeof created !== "number" || !Number.isSafeInteger(created) ||
    created <= 0
  ) return null;
  if (typeof livemode !== "boolean") return null;

  const createdMilliseconds = created * 1000;
  if (!Number.isSafeInteger(createdMilliseconds)) return null;
  const createdAt = new Date(createdMilliseconds);
  if (!Number.isFinite(createdAt.getTime())) return null;

  return {
    id,
    type,
    created: createdAt.toISOString(),
    livemode,
  };
}

type ReceiptResult = {
  outcome: "recorded" | "duplicate" | "conflict" | "ignored";
  eventId: string;
};

function receiptResult(value: unknown): ReceiptResult | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!isRecord(row)) return null;
  if (
    row.outcome !== "recorded" && row.outcome !== "duplicate" &&
    row.outcome !== "conflict" && row.outcome !== "ignored"
  ) return null;
  if (typeof row.event_id !== "string" || row.event_id.trim() === "") {
    return null;
  }
  return { outcome: row.outcome, eventId: row.event_id };
}

function matcherResult(value: unknown):
  | "matched"
  | "already_matched"
  | "unknown_provider_event"
  | "unknown_checkout_session"
  | "validation_failed"
  | "conflict"
  | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!isRecord(row)) return null;
  return row.outcome === "matched" || row.outcome === "already_matched" ||
      row.outcome === "unknown_provider_event" ||
      row.outcome === "unknown_checkout_session" ||
      row.outcome === "validation_failed" || row.outcome === "conflict"
    ? row.outcome
    : null;
}

type AuthorityOutcome =
  | "paid_confirmed"
  | "paid_already_confirmed"
  | "requires_review"
  | "already_paid"
  | "already_requires_review"
  | "not_authoritative";

function authorityResult(value: unknown): AuthorityOutcome | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!isRecord(row)) return null;
  return row.outcome === "paid_confirmed" ||
      row.outcome === "paid_already_confirmed" ||
      row.outcome === "requires_review" || row.outcome === "already_paid" ||
      row.outcome === "already_requires_review" ||
      row.outcome === "not_authoritative"
    ? row.outcome
    : null;
}

function refundOutcome(
  value: unknown,
):
  | "succeeded"
  | "failed"
  | "already_processed"
  | "pending"
  | "ignored"
  | "conflict"
  | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!isRecord(row)) return null;
  return [
      "succeeded",
      "failed",
      "already_processed",
      "pending",
      "ignored",
      "conflict",
    ].includes(String(row.outcome))
    ? row.outcome as
      | "succeeded"
      | "failed"
      | "already_processed"
      | "pending"
      | "ignored"
      | "conflict"
    : null;
}

export async function handleStripeWebhookRequest(
  request: Request,
  dependencies: Dependencies,
) {
  if (request.method !== "POST") return response("METHOD_NOT_ALLOWED", 405);
  if (!dependencies.secret) return response("WEBHOOK_CONFIGURATION_ERROR", 500);

  const contentLength = request.headers.get("content-length");
  if (
    contentLength !== null && /^\d+$/.test(contentLength) &&
    Number(contentLength) > MAX_BODY_BYTES
  ) {
    return response("REQUEST_TOO_LARGE", 413);
  }

  let rawBody: Uint8Array;
  try {
    rawBody = new Uint8Array(await request.arrayBuffer());
  } catch {
    return response("INVALID_REQUEST", 400);
  }
  if (rawBody.byteLength > MAX_BODY_BYTES) {
    return response("REQUEST_TOO_LARGE", 413);
  }

  let verification;
  try {
    verification = await verifyStripeSignature(
      rawBody,
      request.headers.get("stripe-signature"),
      dependencies.secret,
      dependencies.now ?? new Date(),
    );
  } catch {
    return response("WEBHOOK_VERIFICATION_ERROR", 500);
  }
  if (!verification.ok) return response("INVALID_SIGNATURE", 400);

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    return response("INVALID_JSON", 400);
  }
  if (
    typeof payload !== "object" || payload === null || Array.isArray(payload)
  ) {
    return response("INVALID_PAYLOAD", 400);
  }

  const event = parseEventEnvelope(payload);
  if (!event) return response("INVALID_PAYLOAD", 400);
  if (!dependencies.receiptClient) {
    return response("WEBHOOK_RECEIPT_UNAVAILABLE", 503);
  }

  let digest: string;
  try {
    digest = await payloadSha256(rawBody);
  } catch {
    return response("WEBHOOK_RECEIPT_UNAVAILABLE", 503);
  }

  let receipt;
  try {
    if (isSupportedStripeRefundEventType(event.type)) {
      const expectedLivemode = parseExpectedLivemode(
        dependencies.expectedLivemode,
      );
      if (expectedLivemode === null) {
        return response("WEBHOOK_PROCESSING_UNAVAILABLE", 503);
      }
      const parsed = parseStripeRefundEvent(payload);
      const normalized = parsed.ok ? parsed.value : null;
      receipt = await dependencies.receiptClient.rpc(
        "receive_payment_refund_provider_event",
        {
          p_provider_event_id: event.id,
          p_event_type: event.type,
          p_provider_event_created_at: event.created,
          p_livemode: event.livemode,
          p_payload_sha256: digest,
          p_expected_livemode: expectedLivemode,
          p_provider_refund_id: normalized?.refundId ?? null,
          p_payment_intent_id: normalized?.paymentIntentId ?? null,
          p_amount_cents: normalized?.amountCents ?? null,
          p_currency: normalized?.currency ?? null,
          p_refund_status: normalized?.status ?? null,
          p_validation_error: parsed.ok ? null : "malformed_refund_event",
        },
      );
    } else {receipt = await dependencies.receiptClient.rpc(
        "receive_payment_provider_event",
        {
          p_provider: "stripe",
          p_provider_event_id: event.id,
          p_event_type: event.type,
          p_provider_event_created_at: event.created,
          p_livemode: event.livemode,
          p_payload_sha256: digest,
        },
      );}
  } catch {
    return response("WEBHOOK_RECEIPT_UNAVAILABLE", 503);
  }
  const received = receipt.error ? null : receiptResult(receipt.data);
  if (!received) {
    return response("WEBHOOK_RECEIPT_UNAVAILABLE", 503);
  }

  if (received.outcome === "conflict") {
    return Response.json({ received: true }, { status: 200 });
  }

  if (isSupportedStripeRefundEventType(event.type)) {
    if (received.outcome === "ignored") {
      return Response.json({ received: true }, { status: 200 });
    }
    let applied;
    try {
      applied = await dependencies.receiptClient.rpc(
        "apply_payment_refund_provider_event",
        {
          p_event_id: received.eventId,
        },
      );
    } catch {
      return response("WEBHOOK_PROCESSING_UNAVAILABLE", 503);
    }
    if (applied.error || refundOutcome(applied.data) === null) {
      return response("WEBHOOK_PROCESSING_UNAVAILABLE", 503);
    }
    return Response.json({ received: true }, { status: 200 });
  }

  if (event.type !== "checkout.session.completed") {
    return Response.json({ received: true }, { status: 200 });
  }

  const expectedLivemode = parseExpectedLivemode(dependencies.expectedLivemode);
  if (expectedLivemode === null) {
    return response("WEBHOOK_PROCESSING_UNAVAILABLE", 503);
  }

  const parsed = (dependencies.parser ?? parseCheckoutSessionCompleted)(
    payload,
  );
  if (!parsed.ok) return Response.json({ received: true }, { status: 200 });

  const matcherClient = dependencies.matcherClient ??
    dependencies.receiptClient;
  if (!matcherClient) return response("WEBHOOK_PROCESSING_UNAVAILABLE", 503);

  let matching;
  try {
    matching = await matcherClient.rpc("match_payment_provider_event", {
      p_provider_event_id: event.id,
      p_checkout_session_id: parsed.value.checkoutSessionId,
      p_amount_total: parsed.value.amountTotal,
      p_currency: parsed.value.currency,
      p_mode: parsed.value.mode,
      p_checkout_status: parsed.value.status,
      p_payment_status: parsed.value.paymentStatus,
      p_payment_intent_id: parsed.value.paymentIntentId,
      p_client_reference_id: parsed.value.clientReferenceId,
      p_metadata_payment_attempt_id: parsed.value.metadata.paymentAttemptId,
      p_metadata_reservation_id: parsed.value.metadata.reservationId,
      p_expected_livemode: expectedLivemode,
    });
  } catch {
    return response("WEBHOOK_PROCESSING_UNAVAILABLE", 503);
  }

  const outcome = matching.error ? null : matcherResult(matching.data);
  if (!outcome) return response("WEBHOOK_PROCESSING_UNAVAILABLE", 503);
  if (outcome === "unknown_provider_event") {
    return response("WEBHOOK_PROCESSING_UNAVAILABLE", 503);
  }

  if (outcome !== "matched" && outcome !== "already_matched") {
    return Response.json({ received: true }, { status: 200 });
  }

  // Matching uses Stripe's evt_... identifier. Paid authority consumes the
  // distinct internal UUID returned by the durable receipt RPC.
  let authority;
  try {
    authority = await matcherClient.rpc("apply_provider_payment_outcome", {
      p_event_id: received.eventId,
    });
  } catch {
    return response("WEBHOOK_PROCESSING_UNAVAILABLE", 503);
  }

  const paymentOutcome = authority.error
    ? null
    : authorityResult(authority.data);
  if (!paymentOutcome || paymentOutcome === "not_authoritative") {
    return response("WEBHOOK_PROCESSING_UNAVAILABLE", 503);
  }

  return Response.json({ received: true }, { status: 200 });
}
