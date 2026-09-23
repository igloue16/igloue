import assert from "node:assert/strict";
import {
  amountToCents,
  stripeIdempotencyKey,
  StripeAdapterError,
  createStripeCheckoutAdapter,
} from "./stripe.ts";

Deno.test("Checkout idempotency is derived only from the immutable attempt ID", () => {
  assert.equal(stripeIdempotencyKey("attempt-1"), "igloue:checkout-session:attempt-1");
  assert.equal(amountToCents(75), 7500);
  assert.equal(amountToCents(75.25), 7525);
});

Deno.test("Stripe adapter sends authoritative hosted Checkout fields", async () => {
  let request: Request | undefined;
  const adapter = createStripeCheckoutAdapter("sk_test_fake", async (input, init) => {
    request = new Request(input, init);
    return new Response(JSON.stringify({ id: "cs_test_1", url: "https://checkout.stripe.test/cs_test_1" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  const result = await adapter.createCheckoutSession({
    amount: 75,
    currency: "EUR",
    paymentAttemptId: "attempt-1",
    reservationId: "reservation-1",
    customerEmail: "customer@example.test",
    successUrl: "https://example.test/payment/success",
    cancelUrl: "https://example.test/payment/cancel",
  }, stripeIdempotencyKey("attempt-1"));

  assert.equal(result.id, "cs_test_1");
  assert(request);
  assert.equal(request!.headers.get("Idempotency-Key"), "igloue:checkout-session:attempt-1");
  const body = new URLSearchParams(await request!.text());
  assert.equal(body.get("mode"), "payment");
  assert.equal(body.get("currency"), "eur");
  assert.equal(body.get("line_items[0][price_data][unit_amount]"), "7500");
  assert.equal(body.get("metadata[payment_attempt_id]"), "attempt-1");
  assert.equal(body.get("metadata[reservation_id]"), "reservation-1");
  assert.equal(body.get("customer_email"), "customer@example.test");
  assert.equal(body.has("deposit_amount"), false);
});

Deno.test("Stripe adapter maps provider failures without exposing response bodies", async () => {
  const adapter = createStripeCheckoutAdapter("sk_test_fake", async () => new Response("secret provider body", { status: 500 }));
  await assert.rejects(
    () => adapter.createCheckoutSession({
      amount: 1,
      currency: "EUR",
      paymentAttemptId: "attempt-1",
      reservationId: "reservation-1",
      customerEmail: "customer@example.test",
      successUrl: "https://example.test/success",
      cancelUrl: "https://example.test/cancel",
    }, "key"),
    (error) => error instanceof StripeAdapterError && error.kind === "provider_5xx",
  );
});
