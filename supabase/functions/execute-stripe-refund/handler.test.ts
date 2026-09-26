import assert from "node:assert/strict";
import {
  createExecutionDependencies,
  handleExecuteRefundRequest,
} from "./handler.ts";
import { type StripeRefundAdapter, StripeRefundError } from "./stripe.ts";

const serviceKey = "internal-service-test-key";
const refundId = "00000000-0000-4000-8000-00000000d101";
const orgId = "00000000-0000-4000-8000-00000000d201";
const row = {
  refund_id: refundId,
  organisation_id: orgId,
  provider: "stripe",
  refund_status: "prepared",
  refund_amount: "75.00",
  refund_currency: "EUR",
  payment_attempt_id: "00000000-0000-4000-8000-00000000d301",
  payment_intent_id: "pi_authoritative123",
  attempt_status: "requires_review",
  attempt_amount: "75.00",
  attempt_currency: "EUR",
  attempt_paid_at: "2026-09-26T10:00:00Z",
  attempt_refunded_at: null,
  reservation_payment_status: "requires_review",
  reservation_status: "cancelled",
  exception_status: "resolved",
  exception_resolution: "refund_required",
  source_provider_event_id: "00000000-0000-4000-8000-00000000d401",
  source_event_matched_at: "2026-09-26T10:00:00Z",
};

function request(
  body: unknown = { refundId },
  authorization: string | null = `Bearer ${serviceKey}`,
  method = "POST",
) {
  return new Request("https://edge.example.test/execute-stripe-refund", {
    method,
    headers: {
      ...(authorization ? { authorization } : {}),
      "content-type": "application/json",
    },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
}

function fixture(options: {
  executionData?: unknown;
  executionError?: { code?: string } | null;
  evidenceError?: { code?: string } | null;
  stripeAdapter?: StripeRefundAdapter;
} = {}) {
  const calls: { name: string; parameters: Record<string, unknown> }[] = [];
  let stripeCalls = 0;
  const client = {
    async rpc(name: string, parameters: Record<string, unknown>) {
      calls.push({ name, parameters });
      if (name === "get_payment_refund_execution") {
        return {
          data: options.executionData ?? [row],
          error: options.executionError ?? null,
        };
      }
      if (name === "record_payment_refund_evidence") {
        return {
          data: [{
            refund_id: parameters.p_refund_id,
            outcome: parameters.p_evidence_outcome,
          }],
          error: options.evidenceError ?? null,
        };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
  };
  const stripe: StripeRefundAdapter = options.stripeAdapter ?? {
    async createFullRefund(input, key) {
      stripeCalls += 1;
      assert.equal(input.paymentIntentId, row.payment_intent_id);
      assert.equal(input.expectedAmount, 75);
      assert.equal(input.currency, "EUR");
      assert.equal(key, `igloue:refund:${refundId}`);
      return {
        id: "re_valid123",
        status: "succeeded",
        amount: 75,
        currency: "EUR",
        paymentIntentId: row.payment_intent_id,
      };
    },
  };
  return {
    dependencies: createExecutionDependencies(client, stripe, serviceKey),
    calls,
    stripeCalls: () => stripeCalls,
  };
}

Deno.test("prepared refund loads server authority, calls Stripe once, then reuses C1 finalization RPC", async () => {
  const f = fixture();
  const response = await handleExecuteRefundRequest(request(), f.dependencies);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    refund: { status: "succeeded" },
  });
  assert.equal(f.stripeCalls(), 1);
  assert.deepEqual(f.calls.map((call) => call.name), [
    "get_payment_refund_execution",
    "record_payment_refund_evidence",
  ]);
  assert.deepEqual(f.calls[0].parameters, { p_refund_id: refundId });
  assert.deepEqual(f.calls[1].parameters, {
    p_refund_id: refundId,
    p_organisation_id: orgId,
    p_provider_refund_id: "re_valid123",
    p_evidence_outcome: "succeeded",
    p_evidence_source: "stripe_api",
    p_actor_source: "operator_tool",
    p_actor_id: "stripe_refund_executor",
    p_idempotency_key: refundId,
  });
  assert.equal(
    f.calls.some((call) => /update|status|refunded_at/i.test(call.name)),
    false,
  );
});

Deno.test("only internal service authorization is accepted", async () => {
  for (
    const authorization of [
      null,
      "Bearer anon-key",
      "Bearer customer-jwt",
      "Bearer wrong-service-key",
    ]
  ) {
    const f = fixture();
    const response = await handleExecuteRefundRequest(
      request({ refundId }, authorization),
      f.dependencies,
    );
    assert.equal(response.status, 401);
    assert.equal(f.calls.length, 0);
    assert.equal(f.stripeCalls(), 0);
  }
});

Deno.test("HTTP boundary accepts POST and rejects malformed or caller-augmented refund requests before Stripe", async () => {
  const methodFixture = fixture();
  assert.equal(
    (await handleExecuteRefundRequest(
      request({}, `Bearer ${serviceKey}`, "GET"),
      methodFixture.dependencies,
    )).status,
    405,
  );
  for (
    const body of [
      {},
      { refundId: "not-a-uuid" },
      { refundId, amount: 1 },
      { refundId, currency: "USD" },
      { refundId, paymentIntentId: "pi_attacker" },
      { refundId, organisationId: "00000000-0000-4000-8000-00000000ffff" },
    ]
  ) {
    const f = fixture();
    const response = await handleExecuteRefundRequest(
      request(body),
      f.dependencies,
    );
    assert.equal(response.status, 400);
    assert.equal(f.calls.length, 0);
    assert.equal(f.stripeCalls(), 0);
  }
});

Deno.test("non-prepared, incoherent or cross-organisation authority never reaches Stripe", async () => {
  const invalidRows = [
    { ...row, refund_status: "succeeded" },
    { ...row, refund_status: "failed" },
    { ...row, provider: "other" },
    { ...row, refund_amount: "74.00" },
    { ...row, attempt_amount: "74.00" },
    { ...row, refund_currency: "USD" },
    { ...row, attempt_currency: "USD" },
    { ...row, payment_intent_id: null },
    { ...row, attempt_status: "refunded" },
    { ...row, attempt_refunded_at: "2026-09-26T11:00:00Z" },
    { ...row, reservation_payment_status: "refunded" },
    { ...row, source_event_matched_at: null },
  ];
  for (const invalidRow of invalidRows) {
    const f = fixture({ executionData: [invalidRow] });
    const response = await handleExecuteRefundRequest(
      request(),
      f.dependencies,
    );
    assert.equal(response.status, 409, JSON.stringify(invalidRow));
    assert.equal(f.stripeCalls(), 0);
    assert.equal(f.calls.length, 1);
  }
  const missing = fixture({ executionError: { code: "P0002" } });
  assert.equal(
    (await handleExecuteRefundRequest(request(), missing.dependencies)).status,
    409,
  );
  assert.equal(missing.stripeCalls(), 0);
});

Deno.test("successful Stripe response is finalized by C1, preserving separate reservation lifecycle", async () => {
  const f = fixture();
  const response = await handleExecuteRefundRequest(request(), f.dependencies);
  const result = await response.json();
  assert.deepEqual(result, { ok: true, refund: { status: "succeeded" } });
  assert.equal(row.reservation_status, "cancelled");
  assert.equal(f.calls[1].name, "record_payment_refund_evidence");
  assert.equal(
    f.calls.some((call) =>
      ["cancel_reservation", "release_allocation", "confirm_reservation"]
        .includes(call.name)
    ),
    false,
  );
});

Deno.test("ambiguous network result remains retryable and every retry uses the same Stripe key", async () => {
  const keys: string[] = [];
  let attempts = 0;
  const stripe: StripeRefundAdapter = {
    async createFullRefund(_input, key) {
      keys.push(key);
      attempts += 1;
      if (attempts === 1) throw new StripeRefundError("timeout");
      return {
        id: "re_valid123",
        status: "succeeded",
        amount: 75,
        currency: "EUR",
        paymentIntentId: row.payment_intent_id,
      };
    },
  };
  const f = fixture({ stripeAdapter: stripe });
  const first = await handleExecuteRefundRequest(request(), f.dependencies);
  assert.equal(first.status, 504);
  assert.deepEqual(await first.json(), {
    ok: false,
    error: { code: "REFUND_PROVIDER_TIMEOUT", retryable: true },
  });
  assert.equal(
    f.calls.some((call) => call.name === "record_payment_refund_evidence"),
    false,
  );
  const second = await handleExecuteRefundRequest(request(), f.dependencies);
  assert.equal(second.status, 200);
  assert.deepEqual(keys, [
    `igloue:refund:${refundId}`,
    `igloue:refund:${refundId}`,
  ]);
});

Deno.test("invalid Stripe response is not finalized and provider failures are sanitized", async () => {
  const invalidAdapter: StripeRefundAdapter = {
    async createFullRefund() {
      throw new StripeRefundError("invalid_response");
    },
  };
  const invalid = fixture({ stripeAdapter: invalidAdapter });
  const invalidResponse = await handleExecuteRefundRequest(
    request(),
    invalid.dependencies,
  );
  assert.equal(invalidResponse.status, 502);
  assert.equal(
    invalid.calls.some((call) =>
      call.name === "record_payment_refund_evidence"
    ),
    false,
  );
  assert.equal(
    JSON.stringify(await invalidResponse.json()).includes("StripeRefundError"),
    false,
  );

  for (
    const [kind, status, code, retryable] of [
      ["provider_4xx", 422, "REFUND_PROVIDER_REJECTED", false],
      ["provider_5xx", 503, "REFUND_PROVIDER_UNAVAILABLE", true],
    ] as const
  ) {
    const adapter: StripeRefundAdapter = {
      async createFullRefund() {
        throw new StripeRefundError(kind);
      },
    };
    const f = fixture({ stripeAdapter: adapter });
    const response = await handleExecuteRefundRequest(
      request(),
      f.dependencies,
    );
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: { code, retryable },
    });
    assert.equal(
      f.calls.some((call) => call.name === "record_payment_refund_evidence"),
      false,
    );
  }
});

Deno.test("pending Stripe outcome remains prepared and is not falsely finalized", async () => {
  const stripe: StripeRefundAdapter = {
    async createFullRefund() {
      return {
        id: "re_valid123",
        status: "pending",
        amount: 75,
        currency: "EUR",
        paymentIntentId: row.payment_intent_id,
      };
    },
  };
  const f = fixture({ stripeAdapter: stripe });
  const response = await handleExecuteRefundRequest(request(), f.dependencies);
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), {
    ok: true,
    refund: { status: "pending" },
  });
  assert.equal(
    f.calls.some((call) => call.name === "record_payment_refund_evidence"),
    false,
  );
});

Deno.test("failed provider evidence is recorded but never represented as refunded", async () => {
  const stripe: StripeRefundAdapter = {
    async createFullRefund() {
      return {
        id: "re_valid123",
        status: "failed",
        amount: 75,
        currency: "EUR",
        paymentIntentId: row.payment_intent_id,
      };
    },
  };
  const f = fixture({ stripeAdapter: stripe });
  const response = await handleExecuteRefundRequest(request(), f.dependencies);
  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: { code: "REFUND_FAILED", retryable: false },
  });
  assert.equal(f.calls[1].parameters.p_evidence_outcome, "failed");
  assert.equal(
    f.calls.some((call) => /update|status|refunded_at/i.test(call.name)),
    false,
  );
});

Deno.test("C1 persistence ambiguity can be retried without exposing provider details or changing Stripe idempotency", async () => {
  let evidenceAttempts = 0;
  const calls: { name: string; parameters: Record<string, unknown> }[] = [];
  const client = {
    async rpc(name: string, parameters: Record<string, unknown>) {
      calls.push({ name, parameters });
      if (name === "get_payment_refund_execution") {
        return { data: [row], error: null };
      }
      evidenceAttempts += 1;
      return evidenceAttempts === 1
        ? {
          data: null,
          error: { code: "XX000", message: "private database detail" },
        }
        : {
          data: [{ refund_id: refundId, outcome: "succeeded" }],
          error: null,
        };
    },
  };
  const keys: string[] = [];
  const stripe: StripeRefundAdapter = {
    async createFullRefund(_input, key) {
      keys.push(key);
      return {
        id: "re_valid123",
        status: "succeeded",
        amount: 75,
        currency: "EUR",
        paymentIntentId: row.payment_intent_id,
      };
    },
  };
  const dependencies = createExecutionDependencies(client, stripe, serviceKey);
  const first = await handleExecuteRefundRequest(request(), dependencies);
  assert.equal(first.status, 503);
  const firstText = await first.text();
  assert.equal(firstText.includes("private database detail"), false);
  const second = await handleExecuteRefundRequest(request(), dependencies);
  assert.equal(second.status, 200);
  assert.deepEqual(keys, [
    `igloue:refund:${refundId}`,
    `igloue:refund:${refundId}`,
  ]);
});
