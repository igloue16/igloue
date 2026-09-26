const MAX_REQUEST_BYTES = 2_048;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DISPOSITIONS = new Set([
  "refund_required",
  "no_refund_required",
  "manual_investigation_complete",
]);
const OPERATOR_SOURCE = "operator_tool";
const OPERATOR_ACTOR = "payment_operator_api";

type RpcError = { code?: string; message?: string } | null;
type RpcResult = { data: unknown; error: RpcError };
export type OperatorRpcClient = {
  rpc(
    name: string,
    parameters: Record<string, unknown>,
  ): PromiseLike<RpcResult>;
};
type Dependencies = {
  supabaseAdmin: OperatorRpcClient;
  serviceRoleKey: string;
};

function response(body: Record<string, unknown>, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
function failure(status: number, code: string, retryable = false) {
  return response({ ok: false, error: { code, retryable } }, status);
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function scalarRow(value: unknown): Record<string, unknown> | null {
  const item = Array.isArray(value) && value.length === 1 ? value[0] : value;
  return object(item) ? item : null;
}
function uuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
function amount(value: unknown) {
  return typeof value === "string" || typeof value === "number";
}
async function parseBody(request: Request): Promise<unknown> {
  if (!request.body) throw new Error("empty request body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new Error("request body too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
function queueRow(value: unknown) {
  if (
    !object(value) || !uuid(value.exception_id) ||
    !uuid(value.reservation_id) ||
    !uuid(value.payment_attempt_id) || typeof value.created_at !== "string" ||
    typeof value.reason_code !== "string" ||
    value.exception_status !== "unresolved" ||
    !amount(value.amount) || typeof value.currency !== "string"
  ) return null;
  return {
    exceptionId: value.exception_id,
    reservationId: value.reservation_id,
    paymentAttemptId: value.payment_attempt_id,
    createdAt: value.created_at,
    reasonCode: value.reason_code,
    status: value.exception_status,
    amount: value.amount,
    currency: value.currency,
  };
}
function caseRow(value: unknown) {
  const row = scalarRow(value);
  if (
    !row || !uuid(row.exception_id) || !uuid(row.organisation_id) ||
    !uuid(row.reservation_id) || !uuid(row.payment_attempt_id) ||
    typeof row.created_at !== "string" || typeof row.reason_code !== "string" ||
    !["unresolved", "resolved"].includes(String(row.exception_status)) ||
    row.reservation_payment_status !== "requires_review" ||
    row.attempt_status !== "requires_review" ||
    typeof row.paid_at !== "string" ||
    !amount(row.amount) || typeof row.currency !== "string" ||
    (row.resolution !== null && typeof row.resolution !== "string") ||
    (row.resolved_at !== null && typeof row.resolved_at !== "string")
  ) return null;
  return {
    exceptionId: row.exception_id,
    organisationId: row.organisation_id,
    reservationId: row.reservation_id,
    paymentAttemptId: row.payment_attempt_id,
    createdAt: row.created_at,
    reasonCode: row.reason_code,
    status: row.exception_status,
    resolution: row.resolution,
    resolvedAt: row.resolved_at,
    paymentStatus: row.reservation_payment_status,
    attemptStatus: row.attempt_status,
    paidAt: row.paid_at,
    amount: row.amount,
    currency: row.currency,
  };
}
function rpcFailure(error: RpcError) {
  return error?.code === "P0001" || error?.code === "P0002"
    ? failure(409, "RESOLUTION_REJECTED")
    : failure(503, "OPERATOR_AUTHORITY_UNAVAILABLE", true);
}
async function loadCase(dependencies: Dependencies, exceptionId: string) {
  let result: RpcResult;
  try {
    result = await dependencies.supabaseAdmin.rpc(
      "get_payment_exception_operator_case",
      { p_exception_id: exceptionId },
    );
  } catch {
    return { response: failure(503, "OPERATOR_AUTHORITY_UNAVAILABLE", true) };
  }
  if (result.error) return { response: rpcFailure(result.error) };
  const row = caseRow(result.data);
  if (!row || row.exceptionId !== exceptionId) {
    return { response: failure(404, "CASE_NOT_FOUND") };
  }
  return { row };
}

export async function handlePaymentOperatorRequest(
  request: Request,
  dependencies: Dependencies,
) {
  if (request.method !== "POST") return failure(405, "METHOD_NOT_ALLOWED");
  if (
    !dependencies.serviceRoleKey ||
    request.headers.get("authorization") !==
      `Bearer ${dependencies.serviceRoleKey}`
  ) {
    return failure(401, "UNAUTHORIZED");
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return failure(400, "INVALID_REQUEST");
  }
  let body: unknown;
  try {
    body = await parseBody(request);
  } catch {
    return failure(400, "INVALID_REQUEST");
  }
  if (!object(body) || typeof body.action !== "string") {
    return failure(400, "INVALID_REQUEST");
  }

  if (body.action === "list") {
    if (Object.keys(body).some((key) => !["action", "limit"].includes(key))) {
      return failure(400, "INVALID_REQUEST");
    }
    const requestedLimit = body.limit === undefined ? 25 : body.limit;
    if (
      typeof requestedLimit !== "number" || !Number.isInteger(requestedLimit) ||
      requestedLimit < 1
    ) {
      return failure(400, "INVALID_REQUEST");
    }
    let result: RpcResult;
    try {
      result = await dependencies.supabaseAdmin.rpc(
        "list_unresolved_paid_payment_exceptions",
        { p_limit: Math.min(requestedLimit, 50) },
      );
    } catch {
      return failure(503, "OPERATOR_AUTHORITY_UNAVAILABLE", true);
    }
    if (result.error) return rpcFailure(result.error);
    if (!Array.isArray(result.data)) {
      return failure(503, "OPERATOR_AUTHORITY_UNAVAILABLE", true);
    }
    const cases = result.data.map(queueRow);
    if (cases.some((item) => item === null)) {
      return failure(503, "OPERATOR_AUTHORITY_UNAVAILABLE", true);
    }
    return response({ ok: true, cases });
  }

  if (body.action === "inspect") {
    if (
      Object.keys(body).some((key) =>
        !["action", "exceptionId"].includes(key)
      ) ||
      !uuid(body.exceptionId)
    ) return failure(400, "INVALID_REQUEST");
    const loaded = await loadCase(dependencies, body.exceptionId);
    if (loaded.response) return loaded.response;
    const { organisationId: _organisationId, ...safeCase } = loaded.row;
    return response({ ok: true, case: safeCase });
  }

  if (body.action === "resolve") {
    if (
      Object.keys(body).some((key) =>
        !["action", "exceptionId", "disposition", "idempotencyKey"].includes(
          key,
        )
      ) || !uuid(body.exceptionId) || typeof body.disposition !== "string" ||
      !DISPOSITIONS.has(body.disposition) || !uuid(body.idempotencyKey)
    ) {
      return failure(400, "INVALID_REQUEST");
    }
    const loaded = await loadCase(dependencies, body.exceptionId);
    if (loaded.response) return loaded.response;
    let result: RpcResult;
    try {
      result = await dependencies.supabaseAdmin.rpc(
        "resolve_payment_exception",
        {
          p_exception_id: loaded.row.exceptionId,
          p_organisation_id: loaded.row.organisationId,
          p_resolution: body.disposition,
          p_resolver_source: OPERATOR_SOURCE,
          p_resolver_actor: OPERATOR_ACTOR,
          p_idempotency_key: body.idempotencyKey,
        },
      );
    } catch {
      return failure(503, "RESOLUTION_AUTHORITY_UNAVAILABLE", true);
    }
    if (result.error) return rpcFailure(result.error);
    const resolved = scalarRow(result.data);
    if (
      !resolved || resolved.exception_id !== body.exceptionId ||
      !["resolved", "already_resolved"].includes(String(resolved.outcome)) ||
      typeof resolved.resolved_at !== "string"
    ) {
      return failure(503, "RESOLUTION_AUTHORITY_UNAVAILABLE", true);
    }
    return response({
      ok: true,
      resolution: {
        exceptionId: body.exceptionId,
        outcome: resolved.outcome,
        resolvedAt: resolved.resolved_at,
      },
    });
  }
  return failure(400, "INVALID_REQUEST");
}

export function createPaymentOperatorDependencies(
  supabaseAdmin: OperatorRpcClient,
  serviceRoleKey: string,
): Dependencies {
  return { supabaseAdmin, serviceRoleKey };
}
