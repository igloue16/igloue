import {
  type StripeRefundAdapter,
  StripeRefundError,
  stripeRefundIdempotencyKey,
} from "./stripe.ts";

const MAX_REQUEST_BYTES = 2_048;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RpcError = { code?: string } | null;
type RpcResult = { data: unknown; error: RpcError };
export type RefundRpcClient = {
  rpc(
    name: string,
    parameters: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
};

type Dependencies = {
  supabaseAdmin: RefundRpcClient;
  stripeAdapter: StripeRefundAdapter;
  serviceRoleKey: string;
};

type ExecutionRecord = {
  refundId: string;
  organisationId: string;
  provider: "stripe";
  refundStatus: "prepared";
  refundAmount: number;
  refundCurrency: "EUR";
  paymentAttemptId: string;
  paymentIntentId: string;
  attemptStatus: "requires_review";
  attemptAmount: number;
  attemptCurrency: "EUR";
  attemptPaidAt: string;
  attemptRefundedAt: null;
  reservationPaymentStatus: "requires_review";
  sourceProviderEventId: string;
  sourceEventMatchedAt: string;
  providerAttemptId: string;
  providerAttemptNumber: number;
};

function response(body: Record<string, unknown>, status: number) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function errorResponse(status: number, code: string, retryable = false) {
  return response({ ok: false, error: { code, retryable } }, status);
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scalarRow(value: unknown): Record<string, unknown> | null {
  const item = Array.isArray(value) && value.length === 1 ? value[0] : value;
  return object(item) ? item : null;
}

function money(value: unknown): number | null {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string"
    ? Number(value)
    : NaN;
  if (
    !Number.isFinite(parsed) || parsed <= 0 ||
    Math.abs(parsed * 100 - Math.round(parsed * 100)) > 1e-8
  ) {
    return null;
  }
  return Math.round(parsed * 100) / 100;
}

function executionRecord(value: unknown): ExecutionRecord | null {
  const row = scalarRow(value);
  if (!row) return null;
  const refundAmount = money(row.refund_amount);
  const attemptAmount = money(row.attempt_amount);
  if (
    typeof row.refund_id !== "string" || !UUID.test(row.refund_id) ||
    typeof row.organisation_id !== "string" ||
    !UUID.test(row.organisation_id) ||
    row.provider !== "stripe" || row.refund_status !== "prepared" ||
    refundAmount === null || attemptAmount === null ||
    refundAmount !== attemptAmount ||
    row.refund_currency !== "EUR" ||
    typeof row.payment_attempt_id !== "string" ||
    !UUID.test(row.payment_attempt_id) ||
    typeof row.payment_intent_id !== "string" ||
    !/^pi_[A-Za-z0-9]+$/.test(row.payment_intent_id) ||
    row.attempt_status !== "requires_review" ||
    row.attempt_currency !== "EUR" ||
    typeof row.attempt_paid_at !== "string" ||
    row.attempt_refunded_at !== null ||
    row.reservation_payment_status !== "requires_review" ||
    typeof row.source_provider_event_id !== "string" ||
    !UUID.test(row.source_provider_event_id) ||
    typeof row.source_event_matched_at !== "string" ||
    typeof row.provider_attempt_id !== "string" ||
    !UUID.test(row.provider_attempt_id) ||
    typeof row.provider_attempt_number !== "number" ||
    !Number.isInteger(row.provider_attempt_number) ||
    row.provider_attempt_number < 1
  ) return null;

  return {
    refundId: row.refund_id,
    organisationId: row.organisation_id,
    provider: "stripe",
    refundStatus: "prepared",
    refundAmount,
    refundCurrency: "EUR",
    paymentAttemptId: row.payment_attempt_id,
    paymentIntentId: row.payment_intent_id,
    attemptStatus: "requires_review",
    attemptAmount,
    attemptCurrency: "EUR",
    attemptPaidAt: row.attempt_paid_at,
    attemptRefundedAt: null,
    reservationPaymentStatus: "requires_review",
    sourceProviderEventId: row.source_provider_event_id,
    sourceEventMatchedAt: row.source_event_matched_at,
    providerAttemptId: row.provider_attempt_id,
    providerAttemptNumber: Number(row.provider_attempt_number),
  };
}

function rpcFailure(error: RpcError) {
  return error?.code === "P0001" || error?.code === "P0002"
    ? errorResponse(409, "REFUND_NOT_EXECUTABLE")
    : errorResponse(503, "REFUND_AUTHORITY_UNAVAILABLE", true);
}

export async function handleExecuteRefundRequest(
  request: Request,
  dependencies: Dependencies,
) {
  if (request.method !== "POST") {
    return errorResponse(405, "METHOD_NOT_ALLOWED");
  }

  const authorization = request.headers.get("authorization");
  if (
    !dependencies.serviceRoleKey ||
    authorization !== `Bearer ${dependencies.serviceRoleKey}`
  ) {
    return errorResponse(401, "UNAUTHORIZED");
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
    !object(body) || Object.keys(body).length !== 1 ||
    typeof body.refundId !== "string" || !UUID.test(body.refundId)
  ) {
    return errorResponse(400, "INVALID_REQUEST");
  }

  let executionResult: RpcResult;
  try {
    executionResult = await dependencies.supabaseAdmin.rpc(
      "get_payment_refund_execution",
      {
        p_refund_id: body.refundId,
      },
    );
  } catch {
    return errorResponse(503, "REFUND_AUTHORITY_UNAVAILABLE", true);
  }
  if (executionResult.error) return rpcFailure(executionResult.error);

  const execution = executionRecord(executionResult.data);
  if (!execution || execution.refundId !== body.refundId) {
    return errorResponse(409, "REFUND_NOT_EXECUTABLE");
  }

  let providerRefund;
  try {
    providerRefund = await dependencies.stripeAdapter.createFullRefund({
      refundId: execution.refundId,
      paymentIntentId: execution.paymentIntentId,
      expectedAmount: execution.refundAmount,
      currency: execution.refundCurrency,
    }, stripeRefundIdempotencyKey(execution.providerAttemptId));
  } catch (error) {
    if (error instanceof StripeRefundError) {
      if (error.kind === "timeout") {
        return errorResponse(504, "REFUND_PROVIDER_TIMEOUT", true);
      }
      if (error.kind === "provider_5xx") {
        return errorResponse(503, "REFUND_PROVIDER_UNAVAILABLE", true);
      }
      if (error.kind === "provider_4xx") {
        return errorResponse(422, "REFUND_PROVIDER_REJECTED");
      }
    }
    return errorResponse(502, "REFUND_PROVIDER_RESPONSE_INVALID");
  }

  if (providerRefund.status === "pending") {
    return response({ ok: true, refund: { status: "pending" } }, 202);
  }

  let evidenceResult: RpcResult;
  try {
    evidenceResult = await dependencies.supabaseAdmin.rpc(
      "record_payment_refund_attempt_evidence",
      {
        p_provider_attempt_id: execution.providerAttemptId,
        p_organisation_id: execution.organisationId,
        p_provider_refund_id: providerRefund.id,
        p_evidence_outcome: providerRefund.status,
        p_evidence_source: "stripe_api",
        p_actor_source: "operator_tool",
        p_actor_id: "stripe_refund_executor",
        p_idempotency_key: execution.providerAttemptId,
      },
    );
  } catch {
    return errorResponse(503, "REFUND_EVIDENCE_UNAVAILABLE", true);
  }
  if (evidenceResult.error) return rpcFailure(evidenceResult.error);

  const evidence = scalarRow(evidenceResult.data);
  if (
    !evidence || evidence.refund_id !== execution.refundId ||
    evidence.provider_attempt_id !== execution.providerAttemptId ||
    ![providerRefund.status, "already_recorded"].includes(
      String(evidence.outcome),
    )
  ) {
    return errorResponse(503, "REFUND_EVIDENCE_UNAVAILABLE", true);
  }

  if (providerRefund.status === "failed") {
    return errorResponse(422, "REFUND_FAILED");
  }
  return response({ ok: true, refund: { status: "succeeded" } }, 200);
}

export function createExecutionDependencies(
  supabaseAdmin: RefundRpcClient,
  stripeAdapter: StripeRefundAdapter,
  serviceRoleKey: string,
): Dependencies {
  return { supabaseAdmin, stripeAdapter, serviceRoleKey };
}
