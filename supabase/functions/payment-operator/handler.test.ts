import assert from "node:assert/strict";
import {
  createPaymentOperatorDependencies,
  handlePaymentOperatorRequest,
} from "./handler.ts";

const secret = "local-test-service-role-secret-never-real";
const exceptionId = "00000000-0000-4000-8000-00000000a101";
const organisationId = "00000000-0000-4000-8000-00000000a201";
const reservationId = "00000000-0000-4000-8000-00000000a301";
const attemptId = "00000000-0000-4000-8000-00000000a401";
const idemKey = "00000000-0000-4000-8000-00000000a501";
const queue = {
  exception_id: exceptionId,
  organisation_id: organisationId,
  reservation_id: reservationId,
  payment_attempt_id: attemptId,
  source_provider_event_id: "00000000-0000-4000-8000-00000000a601",
  created_at: "2026-09-26T10:00:00Z",
  reason_code: "confirmation_failed",
  exception_status: "unresolved",
  customer_id: "00000000-0000-4000-8000-00000000a701",
  customer_name: "Private Customer",
  customer_email: "private@example.test",
  customer_phone: "+33000000000",
  amount: "75.00",
  currency: "EUR",
};
const caseDetail = {
  exception_id: exceptionId,
  organisation_id: organisationId,
  reservation_id: reservationId,
  payment_attempt_id: attemptId,
  created_at: "2026-09-26T10:00:00Z",
  reason_code: "confirmation_failed",
  exception_status: "unresolved",
  resolution: null,
  resolved_at: null,
  reservation_payment_status: "requires_review",
  attempt_status: "requires_review",
  paid_at: "2026-09-26T09:59:00Z",
  amount: "75.00",
  currency: "EUR",
};

function request(
  body: unknown = { action: "list" },
  authorization: string | null = `Bearer ${secret}`,
  method = "POST",
) {
  return new Request("https://edge.example.test/payment-operator", {
    method,
    headers: {
      ...(authorization ? { authorization } : {}),
      "content-type": "application/json",
    },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
}

function fixture(options: {
  queueData?: unknown;
  caseData?: unknown;
  resolveData?: unknown;
  rpcError?: { code?: string; message?: string } | null;
  throwOn?: string;
} = {}) {
  const calls: { name: string; parameters: Record<string, unknown> }[] = [];
  let currentQueue: unknown = options.queueData ?? [queue];
  const client = {
    async rpc(name: string, parameters: Record<string, unknown>) {
      calls.push({ name, parameters });
      if (name === options.throwOn) throw new Error("private test failure");
      if (options.rpcError) return { data: null, error: options.rpcError };
      if (name === "list_unresolved_paid_payment_exceptions") {
        return { data: currentQueue, error: null };
      }
      if (name === "get_payment_exception_operator_case") {
        return { data: options.caseData ?? [caseDetail], error: null };
      }
      if (name === "resolve_payment_exception") {
        return {
          data: options.resolveData ?? [{
            exception_id: parameters.p_exception_id,
            outcome: "resolved",
            resolved_at: "2026-09-26T10:05:00Z",
          }],
          error: null,
        };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
  };
  return {
    dependencies: createPaymentOperatorDependencies(client, secret),
    calls,
    setQueue(value: unknown) {
      currentQueue = value;
    },
  };
}

Deno.test("valid service bearer delegates list to existing queue RPC", async () => {
  const f = fixture();
  const response = await handlePaymentOperatorRequest(
    request(),
    f.dependencies,
  );
  assert.equal(response.status, 200);
  assert.equal(f.calls[0].name, "list_unresolved_paid_payment_exceptions");
  assert.deepEqual(f.calls[0].parameters, { p_limit: 25 });
});
Deno.test("missing credential is rejected before privileged RPC", async () => {
  const f = fixture();
  assert.equal(
    (await handlePaymentOperatorRequest(request({}, null), f.dependencies))
      .status,
    401,
  );
  assert.equal(f.calls.length, 0);
});
Deno.test("wrong credential is rejected", async () => {
  const f = fixture();
  assert.equal(
    (await handlePaymentOperatorRequest(
      request({}, "Bearer wrong"),
      f.dependencies,
    )).status,
    401,
  );
  assert.equal(f.calls.length, 0);
});
Deno.test("anonymous bearer is rejected", async () => {
  const f = fixture();
  assert.equal(
    (await handlePaymentOperatorRequest(
      request({}, "Bearer anon-key"),
      f.dependencies,
    )).status,
    401,
  );
  assert.equal(f.calls.length, 0);
});
Deno.test("customer JWT bearer is rejected", async () => {
  const f = fixture();
  assert.equal(
    (await handlePaymentOperatorRequest(
      request({}, "Bearer customer-jwt"),
      f.dependencies,
    )).status,
    401,
  );
  assert.equal(f.calls.length, 0);
});
Deno.test("service credential comparison is exact", async () => {
  const f = fixture();
  assert.equal(
    (await handlePaymentOperatorRequest(
      request({}, `Bearer ${secret}x`),
      f.dependencies,
    )).status,
    401,
  );
  assert.equal(f.calls.length, 0);
});
Deno.test("non-POST request is rejected", async () => {
  const f = fixture();
  assert.equal(
    (await handlePaymentOperatorRequest(
      request({}, undefined, "GET"),
      f.dependencies,
    )).status,
    405,
  );
  assert.equal(f.calls.length, 0);
});
Deno.test("malformed JSON is rejected", async () => {
  const f = fixture();
  const req = new Request("https://edge.example.test", {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
    body: "{",
  });
  assert.equal(
    (await handlePaymentOperatorRequest(req, f.dependencies)).status,
    400,
  );
});
Deno.test("oversized body without content-length is rejected before RPC", async () => {
  const f = fixture();
  const req = new Request("https://edge.example.test", {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ action: "list", padding: "x".repeat(3_000) }),
  });
  assert.equal(
    (await handlePaymentOperatorRequest(req, f.dependencies)).status,
    400,
  );
  assert.equal(f.calls.length, 0);
});
Deno.test("list clamps excessive limit to queue authority maximum", async () => {
  const f = fixture();
  assert.equal(
    (await handlePaymentOperatorRequest(
      request({ action: "list", limit: 500 }),
      f.dependencies,
    )).status,
    200,
  );
  assert.deepEqual(f.calls[0].parameters, { p_limit: 50 });
});
Deno.test("list accepts supported lower limit", async () => {
  const f = fixture();
  await handlePaymentOperatorRequest(
    request({ action: "list", limit: 3 }),
    f.dependencies,
  );
  assert.deepEqual(f.calls[0].parameters, { p_limit: 3 });
});
Deno.test("list rejects invalid limit", async () => {
  const f = fixture();
  assert.equal(
    (await handlePaymentOperatorRequest(
      request({ action: "list", limit: 0 }),
      f.dependencies,
    )).status,
    400,
  );
  assert.equal(f.calls.length, 0);
});
Deno.test("list response omits organisation, customer and provider identifiers and PII", async () => {
  const f = fixture();
  const text =
    await (await handlePaymentOperatorRequest(request(), f.dependencies))
      .text();
  for (
    const privateValue of [
      organisationId,
      queue.customer_email,
      queue.customer_phone,
      queue.customer_id,
      queue.source_provider_event_id,
    ]
  ) {
    assert.equal(text.includes(privateValue), false);
  }
  assert.equal(text.includes("customer_name"), false);
});
Deno.test("list returns usable case reference and financial context", async () => {
  const f = fixture();
  const body =
    await (await handlePaymentOperatorRequest(request(), f.dependencies))
      .json();
  assert.deepEqual(body.cases[0], {
    exceptionId,
    reservationId,
    paymentAttemptId: attemptId,
    createdAt: queue.created_at,
    reasonCode: queue.reason_code,
    status: "unresolved",
    amount: "75.00",
    currency: "EUR",
  });
});
Deno.test("inspect calls minimal service-only case read", async () => {
  const f = fixture();
  await handlePaymentOperatorRequest(
    request({ action: "inspect", exceptionId }),
    f.dependencies,
  );
  assert.deepEqual(f.calls, [{
    name: "get_payment_exception_operator_case",
    parameters: { p_exception_id: exceptionId },
  }]);
});
Deno.test("inspect returns enough sanitized case context", async () => {
  const f = fixture();
  const body = await (await handlePaymentOperatorRequest(
    request({ action: "inspect", exceptionId }),
    f.dependencies,
  )).json();
  assert.equal(body.case.exceptionId, exceptionId);
  assert.equal(body.case.paymentStatus, "requires_review");
  assert.equal(body.case.amount, "75.00");
  assert.equal("organisationId" in body.case, false);
});
Deno.test("inspect rejects malformed exception UUID", async () => {
  const f = fixture();
  assert.equal(
    (await handlePaymentOperatorRequest(
      request({ action: "inspect", exceptionId: "bad" }),
      f.dependencies,
    )).status,
    400,
  );
  assert.equal(f.calls.length, 0);
});
Deno.test("caller cannot augment inspect with tenant or payment authority", async () => {
  const f = fixture();
  assert.equal(
    (await handlePaymentOperatorRequest(
      request({ action: "inspect", exceptionId, organisationId, amount: 1 }),
      f.dependencies,
    )).status,
    400,
  );
  assert.equal(f.calls.length, 0);
});
Deno.test("resolve loads DB case then calls existing audited resolution RPC", async () => {
  const f = fixture();
  const response = await handlePaymentOperatorRequest(
    request({
      action: "resolve",
      exceptionId,
      disposition: "refund_required",
      idempotencyKey: idemKey,
    }),
    f.dependencies,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(f.calls.map((call) => call.name), [
    "get_payment_exception_operator_case",
    "resolve_payment_exception",
  ]);
});
Deno.test("resolve derives organisation and fixes source/actor from trusted server boundary", async () => {
  const f = fixture();
  await handlePaymentOperatorRequest(
    request({
      action: "resolve",
      exceptionId,
      disposition: "refund_required",
      idempotencyKey: idemKey,
    }),
    f.dependencies,
  );
  assert.deepEqual(f.calls[1].parameters, {
    p_exception_id: exceptionId,
    p_organisation_id: organisationId,
    p_resolution: "refund_required",
    p_resolver_source: "operator_tool",
    p_resolver_actor: "payment_operator_api",
    p_idempotency_key: idemKey,
  });
});
Deno.test("refund_required disposition is forwarded unchanged", async () => {
  const f = fixture();
  await handlePaymentOperatorRequest(
    request({
      action: "resolve",
      exceptionId,
      disposition: "refund_required",
      idempotencyKey: idemKey,
    }),
    f.dependencies,
  );
  assert.equal(f.calls[1].parameters.p_resolution, "refund_required");
});
Deno.test("no_refund_required disposition is forwarded unchanged", async () => {
  const f = fixture();
  await handlePaymentOperatorRequest(
    request({
      action: "resolve",
      exceptionId,
      disposition: "no_refund_required",
      idempotencyKey: idemKey,
    }),
    f.dependencies,
  );
  assert.equal(f.calls[1].parameters.p_resolution, "no_refund_required");
});
Deno.test("manual investigation disposition is forwarded unchanged", async () => {
  const f = fixture();
  await handlePaymentOperatorRequest(
    request({
      action: "resolve",
      exceptionId,
      disposition: "manual_investigation_complete",
      idempotencyKey: idemKey,
    }),
    f.dependencies,
  );
  assert.equal(
    f.calls[1].parameters.p_resolution,
    "manual_investigation_complete",
  );
});
Deno.test("invalid disposition is rejected before case read or mutation", async () => {
  const f = fixture();
  assert.equal(
    (await handlePaymentOperatorRequest(
      request({
        action: "resolve",
        exceptionId,
        disposition: "refunded",
        idempotencyKey: idemKey,
      }),
      f.dependencies,
    )).status,
    400,
  );
  assert.equal(f.calls.length, 0);
});
Deno.test("resolve rejects malformed UUIDs before database calls", async () => {
  const f = fixture();
  assert.equal(
    (await handlePaymentOperatorRequest(
      request({
        action: "resolve",
        exceptionId: "x",
        disposition: "refund_required",
        idempotencyKey: idemKey,
      }),
      f.dependencies,
    )).status,
    400,
  );
  assert.equal(f.calls.length, 0);
});
Deno.test("caller cannot supply organisation, amount, currency or payment state", async () => {
  const f = fixture();
  assert.equal(
    (await handlePaymentOperatorRequest(
      request({
        action: "resolve",
        exceptionId,
        disposition: "refund_required",
        idempotencyKey: idemKey,
        organisationId,
        amount: 1,
        currency: "USD",
        paymentStatus: "refunded",
      }),
      f.dependencies,
    )).status,
    400,
  );
  assert.equal(f.calls.length, 0);
});
Deno.test("caller cannot supply actor or resolver source", async () => {
  const f = fixture();
  assert.equal(
    (await handlePaymentOperatorRequest(
      request({
        action: "resolve",
        exceptionId,
        disposition: "refund_required",
        idempotencyKey: idemKey,
        actor: "attacker",
      }),
      f.dependencies,
    )).status,
    400,
  );
  assert.equal(f.calls.length, 0);
});
Deno.test("exact resolution replay reports existing authority outcome", async () => {
  const f = fixture({
    resolveData: [{
      exception_id: exceptionId,
      outcome: "already_resolved",
      resolved_at: "2026-09-26T10:05:00Z",
    }],
  });
  const result = await handlePaymentOperatorRequest(
    request({
      action: "resolve",
      exceptionId,
      disposition: "refund_required",
      idempotencyKey: idemKey,
    }),
    f.dependencies,
  );
  assert.equal(result.status, 200);
  assert.equal((await result.json()).resolution.outcome, "already_resolved");
  assert.deepEqual(f.calls[1].parameters.p_idempotency_key, idemKey);
});
Deno.test("conflicting resolution rejection from authority is preserved", async () => {
  const f = fixture({ rpcError: { code: "P0001" } });
  const result = await handlePaymentOperatorRequest(
    request({
      action: "resolve",
      exceptionId,
      disposition: "no_refund_required",
      idempotencyKey: idemKey,
    }),
    f.dependencies,
  );
  assert.equal(result.status, 409);
  assert.deepEqual(await result.json(), {
    ok: false,
    error: { code: "RESOLUTION_REJECTED", retryable: false },
  });
});
Deno.test("unknown or resolved-incompatible case is unavailable", async () => {
  const f = fixture({ caseData: [] });
  assert.equal(
    (await handlePaymentOperatorRequest(
      request({
        action: "resolve",
        exceptionId,
        disposition: "refund_required",
        idempotencyKey: idemKey,
      }),
      f.dependencies,
    )).status,
    404,
  );
  assert.equal(f.calls.length, 1);
});
Deno.test("database exception errors return sanitized non-success", async () => {
  const f = fixture({
    rpcError: { code: "XX000", message: "private database secret" },
  });
  const response = await handlePaymentOperatorRequest(
    request(),
    f.dependencies,
  );
  assert.equal(response.status, 503);
  assert.equal(
    (await response.text()).includes("private database secret"),
    false,
  );
});
Deno.test("secret is never reflected in responses", async () => {
  const f = fixture();
  for (const body of [{ action: "list" }, { action: "bad" }]) {
    const text =
      await (await handlePaymentOperatorRequest(request(body), f.dependencies))
        .text();
    assert.equal(text.includes(secret), false);
  }
});
Deno.test("resolution outcome is sanitized and supplies DB timestamp", async () => {
  const f = fixture();
  const response = await handlePaymentOperatorRequest(
    request({
      action: "resolve",
      exceptionId,
      disposition: "refund_required",
      idempotencyKey: idemKey,
    }),
    f.dependencies,
  );
  assert.deepEqual(await response.json(), {
    ok: true,
    resolution: {
      exceptionId,
      outcome: "resolved",
      resolvedAt: "2026-09-26T10:05:00Z",
    },
  });
});
Deno.test("queue disappearance follows existing queue RPC semantics", async () => {
  const f = fixture();
  f.setQueue([]);
  const body =
    await (await handlePaymentOperatorRequest(request(), f.dependencies))
      .json();
  assert.deepEqual(body.cases, []);
});
Deno.test("read operation invokes only the existing read-only queue RPC", async () => {
  const f = fixture();
  await handlePaymentOperatorRequest(request(), f.dependencies);
  assert.deepEqual(f.calls.map((call) => call.name), [
    "list_unresolved_paid_payment_exceptions",
  ]);
  assert.equal(
    f.calls.some((call) =>
      /update|refund|reservation|inventory/i.test(call.name)
    ),
    false,
  );
});
Deno.test("case reads fail closed if authoritative state is not paid requires_review", async () => {
  const f = fixture({
    caseData: [{ ...caseDetail, attempt_status: "refunded" }],
  });
  assert.equal(
    (await handlePaymentOperatorRequest(
      request({ action: "inspect", exceptionId }),
      f.dependencies,
    )).status,
    404,
  );
});
Deno.test("resolve network ambiguity remains retryable and repeats identical DB authority inputs", async () => {
  const f = fixture({ throwOn: "resolve_payment_exception" });
  const first = await handlePaymentOperatorRequest(
    request({
      action: "resolve",
      exceptionId,
      disposition: "refund_required",
      idempotencyKey: idemKey,
    }),
    f.dependencies,
  );
  assert.equal(first.status, 503);
  assert.equal((await first.json()).error.retryable, true);
  assert.deepEqual(f.calls[1].parameters, {
    p_exception_id: exceptionId,
    p_organisation_id: organisationId,
    p_resolution: "refund_required",
    p_resolver_source: "operator_tool",
    p_resolver_actor: "payment_operator_api",
    p_idempotency_key: idemKey,
  });
});
