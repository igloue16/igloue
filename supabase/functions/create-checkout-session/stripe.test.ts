import assert from "node:assert/strict";
import {
  amountToCents,
  createStripeCheckoutAdapter,
  StripeAdapterError,
  stripeIdempotencyKey,
} from "./stripe.ts";

Deno.test("Checkout idempotency is derived only from the immutable attempt ID", () => {
  assert.equal(
    stripeIdempotencyKey("attempt-1"),
    "igloue:checkout-session:attempt-1",
  );
  assert.equal(amountToCents(75), 7500);
  assert.equal(amountToCents(75.25), 7525);
});

Deno.test("Stripe adapter sends authoritative hosted Checkout fields", async () => {
  let request: Request | undefined;
  const adapter = createStripeCheckoutAdapter(
    "sk_test_fake",
    async (input, init) => {
      request = new Request(input, init);
      return new Response(
        JSON.stringify({
          id: "cs_test_1",
          url: "https://checkout.stripe.test/cs_test_1",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    },
  );

  const result = await adapter.createCheckoutSession({
    amount: 75,
    currency: "USD",
    paymentAttemptId: "attempt-1",
    reservationId: "reservation-1",
    customerEmail: "customer@example.test",
    expiresAt: 1_798_812_600,
    successUrl: "https://example.test/payment/success",
    cancelUrl: "https://example.test/payment/cancel",
  }, stripeIdempotencyKey("attempt-1"));

  assert.equal(result.id, "cs_test_1");
  assert(request);
  assert.equal(request!.url, "https://api.stripe.com/v1/checkout/sessions");
  assert.equal(request!.method, "POST");
  assert.equal(request!.headers.get("Authorization"), "Bearer sk_test_fake");
  assert.equal(
    request!.headers.get("Content-Type"),
    "application/x-www-form-urlencoded",
  );
  assert.equal(
    request!.headers.get("Idempotency-Key"),
    "igloue:checkout-session:attempt-1",
  );
  const body = new URLSearchParams(await request!.text());
  assert.equal(body.get("mode"), "payment");
  assert.equal(body.get("payment_method_types[0]"), "card");
  assert.deepEqual(body.getAll("payment_method_types[0]"), ["card"]);
  assert.equal(body.get("currency"), "eur");
  assert.equal(body.get("line_items[0][price_data][unit_amount]"), "7500");
  assert.equal(body.get("metadata[payment_attempt_id]"), "attempt-1");
  assert.equal(body.get("metadata[reservation_id]"), "reservation-1");
  assert.equal(body.get("customer_email"), "customer@example.test");
  assert.equal(body.get("expires_at"), "1798812600");
  assert.equal(body.has("deposit_amount"), false);
});

Deno.test("default Checkout transport uses global fetch and the fixed Stripe endpoint", async () => {
  const originalFetch = globalThis.fetch;
  let request: Request | undefined;
  globalThis.fetch = async (input, init) => {
    request = new Request(input, init);
    return Response.json({
      id: "cs_test_default",
      url: "https://checkout.stripe.test/cs_test_default",
    });
  };

  try {
    const adapter = createStripeCheckoutAdapter("sk_test_default");
    await adapter.createCheckoutSession({
      amount: 12.5,
      currency: "USD",
      paymentAttemptId: "attempt-default",
      reservationId: "reservation-default",
      customerEmail: "customer@example.test",
      expiresAt: 1_798_812_600,
      successUrl: "https://example.test/success",
      cancelUrl: "https://example.test/cancel",
    }, "fixed-idempotency-key");

    assert(request);
    assert.equal(request.url, "https://api.stripe.com/v1/checkout/sessions");
    assert.equal(request.headers.get("Authorization"), "Bearer sk_test_default");
    assert.equal(request.headers.get("Idempotency-Key"), "fixed-idempotency-key");
    const body = new URLSearchParams(await request.text());
    assert.equal(body.get("line_items[0][price_data][unit_amount]"), "1250");
    assert.equal(body.get("currency"), "eur");
    assert.equal(body.get("line_items[0][price_data][currency]"), "eur");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("Stripe adapter maps provider failures without exposing response bodies", async () => {
  const adapter = createStripeCheckoutAdapter(
    "sk_test_fake",
    async () => new Response("secret provider body", { status: 500 }),
  );
  await assert.rejects(
    () =>
      adapter.createCheckoutSession({
        amount: 1,
        currency: "EUR",
        paymentAttemptId: "attempt-1",
        reservationId: "reservation-1",
        customerEmail: "customer@example.test",
        expiresAt: 1_798_812_600,
        successUrl: "https://example.test/success",
        cancelUrl: "https://example.test/cancel",
      }, "key"),
    (error) =>
      error instanceof StripeAdapterError && error.kind === "provider_5xx",
  );
});

Deno.test("Checkout transport ambiguity is a timeout and retries with the same idempotency key", async () => {
  const keys: string[] = [];
  let attempt = 0;
  const adapter = createStripeCheckoutAdapter(
    "sk_test_fake",
    async (input, init) => {
      const request = new Request(input, init);
      keys.push(request.headers.get("Idempotency-Key") ?? "");
      attempt += 1;
      if (attempt === 1) throw new TypeError("ambiguous transport result");
      return Response.json({
        id: "cs_test_retry",
        url: "https://checkout.stripe.test/cs_test_retry",
      });
    },
  );
  const checkoutInput = {
    amount: 75,
    currency: "EUR",
    paymentAttemptId: "attempt-retry",
    reservationId: "reservation-retry",
    customerEmail: "customer@example.test",
    expiresAt: 1_798_812_600,
    successUrl: "https://example.test/success",
    cancelUrl: "https://example.test/cancel",
  };
  const key = stripeIdempotencyKey(checkoutInput.paymentAttemptId);

  await assert.rejects(
    adapter.createCheckoutSession(checkoutInput, key),
    (error) => error instanceof StripeAdapterError && error.kind === "timeout",
  );
  assert.equal((await adapter.createCheckoutSession(checkoutInput, key)).id, "cs_test_retry");
  assert.deepEqual(keys, [key, key]);
});

Deno.test("Checkout provider response validation rejects malformed or non-HTTPS URLs", async () => {
  for (const providerBody of [
    "not-json",
    JSON.stringify({ id: "cs_missing_url" }),
    JSON.stringify({ id: "cs_http_url", url: "http://checkout.stripe.test/cs" }),
  ]) {
    const adapter = createStripeCheckoutAdapter(
      "sk_test_fake",
      async () => new Response(providerBody, {
        headers: { "content-type": "application/json" },
      }),
    );
    await assert.rejects(
      adapter.createCheckoutSession({
        amount: 75,
        currency: "EUR",
        paymentAttemptId: "attempt-invalid-response",
        reservationId: "reservation-invalid-response",
        customerEmail: "customer@example.test",
        expiresAt: 1_798_812_600,
        successUrl: "https://example.test/success",
        cancelUrl: "https://example.test/cancel",
      }, "stable-key"),
      (error) => error instanceof StripeAdapterError && error.kind === "invalid_response",
    );
  }
});
