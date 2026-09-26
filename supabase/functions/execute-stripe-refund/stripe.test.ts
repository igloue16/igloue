import assert from "node:assert/strict";
import {
  createStripeRefundAdapter,
  StripeRefundError,
  stripeRefundIdempotencyKey,
} from "./stripe.ts";

const input = {
  refundId: "00000000-0000-4000-8000-00000000d101",
  paymentIntentId: "pi_authoritative123",
  expectedAmount: 75,
  currency: "EUR",
};

function stripeResponse(overrides: Record<string, unknown> = {}) {
  return Response.json({
    id: "re_valid123",
    object: "refund",
    amount: 7500,
    currency: "eur",
    status: "succeeded",
    payment_intent: input.paymentIntentId,
    ...overrides,
  });
}

Deno.test("Stripe refund request uses the authoritative PaymentIntent and omits amount for a full refund", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const adapter = createStripeRefundAdapter(
    "test-secret",
    async (url, init) => {
      capturedUrl = String(url);
      capturedInit = init;
      return stripeResponse();
    },
  );

  const result = await adapter.createFullRefund(
    input,
    stripeRefundIdempotencyKey(input.refundId),
  );
  assert.equal(capturedUrl, "https://api.stripe.com/v1/refunds");
  assert.equal(capturedInit?.method, "POST");
  assert.equal(
    (capturedInit?.headers as Record<string, string>).Authorization,
    "Bearer test-secret",
  );
  assert.equal(
    (capturedInit?.headers as Record<string, string>)["Idempotency-Key"],
    `igloue:refund:${input.refundId}`,
  );
  const body = new URLSearchParams(String(capturedInit?.body));
  assert.equal(body.get("payment_intent"), input.paymentIntentId);
  assert.equal(body.get("metadata[igloue_refund_id]"), input.refundId);
  assert.equal(body.has("amount"), false);
  assert.equal(body.has("currency"), false);
  assert.deepEqual(result, {
    id: "re_valid123",
    status: "succeeded",
    amount: 75,
    currency: "EUR",
    paymentIntentId: input.paymentIntentId,
  });
});

Deno.test("refund idempotency key derives only from immutable refund ID", () => {
  assert.equal(
    stripeRefundIdempotencyKey(input.refundId),
    `igloue:refund:${input.refundId}`,
  );
  assert.equal(
    stripeRefundIdempotencyKey(input.refundId),
    stripeRefundIdempotencyKey(input.refundId),
  );
  assert.notEqual(
    stripeRefundIdempotencyKey(input.refundId),
    stripeRefundIdempotencyKey("00000000-0000-4000-8000-00000000d102"),
  );
});

Deno.test("response must contain the expected refund ID, exact amount, EUR currency, and PaymentIntent", async () => {
  const mismatches = [
    { id: null },
    { amount: 7400 },
    { amount: 7600 },
    { currency: "usd" },
    { payment_intent: "pi_other" },
    { id: "not_a_refund" },
    { status: "unknown" },
  ];
  for (const mismatch of mismatches) {
    const adapter = createStripeRefundAdapter(
      "test-secret",
      async () => stripeResponse(mismatch),
    );
    await assert.rejects(
      adapter.createFullRefund(input, "stable-key"),
      (error: unknown) =>
        error instanceof StripeRefundError && error.kind === "invalid_response",
    );
  }
});

Deno.test("pending and deterministic failed refund objects are distinguished from success", async () => {
  const pending = createStripeRefundAdapter(
    "test-secret",
    async () => stripeResponse({ status: "pending" }),
  );
  const failed = createStripeRefundAdapter(
    "test-secret",
    async () => stripeResponse({ status: "failed" }),
  );
  assert.equal(
    (await pending.createFullRefund(input, "stable-key")).status,
    "pending",
  );
  assert.equal(
    (await failed.createFullRefund(input, "stable-key")).status,
    "failed",
  );
});

Deno.test("provider error response bodies are not read or exposed", async () => {
  const providerResponse = new Response("private stripe response body", {
    status: 400,
  });
  const adapter = createStripeRefundAdapter(
    "test-secret",
    async () => providerResponse,
  );
  await assert.rejects(
    adapter.createFullRefund(input, "stable-key"),
    (error: unknown) =>
      error instanceof StripeRefundError && error.kind === "provider_4xx" &&
      !error.message.includes("private"),
  );
  assert.equal(providerResponse.bodyUsed, false);
});

Deno.test("network ambiguity is classified for retry with unchanged idempotency basis", async () => {
  const keys: string[] = [];
  let attempt = 0;
  const adapter = createStripeRefundAdapter(
    "test-secret",
    async (_url, init) => {
      keys.push((init?.headers as Record<string, string>)["Idempotency-Key"]);
      attempt += 1;
      if (attempt === 1) {
        throw new DOMException(
          "ambiguous transport result",
          "AbortError",
        );
      }
      return stripeResponse();
    },
  );
  await assert.rejects(
    adapter.createFullRefund(input, stripeRefundIdempotencyKey(input.refundId)),
    (error: unknown) =>
      error instanceof StripeRefundError && error.kind === "timeout",
  );
  const result = await adapter.createFullRefund(
    input,
    stripeRefundIdempotencyKey(input.refundId),
  );
  assert.equal(result.status, "succeeded");
  assert.deepEqual(keys, [
    `igloue:refund:${input.refundId}`,
    `igloue:refund:${input.refundId}`,
  ]);
});

Deno.test("adapter rejects non-EUR or non-Stripe PaymentIntent input before fetch", async () => {
  let called = false;
  const adapter = createStripeRefundAdapter("test-secret", async () => {
    called = true;
    return stripeResponse();
  });
  await assert.rejects(
    adapter.createFullRefund({ ...input, currency: "USD" }, "key"),
  );
  await assert.rejects(
    adapter.createFullRefund(
      { ...input, paymentIntentId: "ch_arbitrary" },
      "key",
    ),
  );
  assert.equal(called, false);
});
