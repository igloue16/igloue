import assert from "node:assert/strict";
import { handleCheckoutRequest } from "./handler.ts";
import { StripeAdapterError, type CheckoutAdapter } from "./stripe.ts";

const capability = "A".repeat(43);
const reservationId = "00000000-0000-4000-8000-000000000101";

function request(body: unknown) {
  return new Request("https://example.test/functions/v1/create-checkout-session", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function dependencies(overrides: {
  rpc?: (name: string, parameters: Record<string, unknown>) => Promise<{ data: unknown; error: null }>;
  adapter?: CheckoutAdapter;
  now?: Date;
} = {}) {
  const calls: { name: string; parameters: Record<string, unknown> }[] = [];
  const rpc = overrides.rpc ?? (async (name, parameters) => {
    calls.push({ name, parameters });
    if (name === "initiate_reservation_payment") {
      return {
        data: [{ payment_attempt_id: "00000000-0000-4000-8000-000000000201", organisation_id: "org-1" }],
        error: null,
      };
    }
    if (name === "get_reservation_payment_checkout") {
      return {
        data: [{
          payment_attempt_id: "00000000-0000-4000-8000-000000000201",
          reservation_id: reservationId,
          amount: 75,
          currency: "EUR",
          attempt_status: "created",
          customer_email: "customer@example.test",
          hold_expires_at: "2027-01-01T12:11:00.000Z",
          eligible: true,
          provider_checkout_session_id: null,
          provider_checkout_url: null,
        }],
        error: null,
      };
    }
    return {
      data: [{
        provider_checkout_session_id: "cs_test_1",
        provider_checkout_url: "https://checkout.stripe.test/cs_test_1",
        hold_expires_at: "2027-01-01T12:11:00.000Z",
        eligible: true,
      }],
      error: null,
    };
  });
  const adapter = overrides.adapter ?? {
    async createCheckoutSession() {
      return { id: "cs_test_1", url: "https://checkout.stripe.test/cs_test_1" };
    },
  };
  return {
    calls,
    supabaseAdmin: { rpc },
    stripeAdapter: adapter,
    now: overrides.now ?? new Date("2027-01-01T12:00:00.000Z"),
    successUrl: "https://example.test/payment/success",
    cancelUrl: "https://example.test/payment/cancel",
  };
}

Deno.test("valid checkout request hashes the capability and returns only the hosted URL", async () => {
  const deps = dependencies();
  const result = await handleCheckoutRequest(request({ reservationId, paymentCapability: capability, idempotencyKey: "payment-1" }), deps);
  assert.equal(result.status, 201);
  const body = await result.json();
  assert.deepEqual(body, {
    ok: true,
    checkout: { url: "https://checkout.stripe.test/cs_test_1", holdExpiresAt: "2027-01-01T12:11:00.000Z" },
  });
  assert.match(String(deps.calls[0].parameters.p_capability_hash), /^\\x[0-9a-f]{64}$/);
  assert.equal(String(deps.calls[0].parameters.p_capability_hash).includes(capability), false);
});

Deno.test("unknown fields and insufficient hold time fail before Stripe", async () => {
  const adapter = { async createCheckoutSession() { throw new Error("must not call provider"); } };
  const malformed = await handleCheckoutRequest(request({ reservationId, paymentCapability: capability, idempotencyKey: "x", amount: 1 }), dependencies({ adapter }));
  assert.equal(malformed.status, 400);

  const deps = dependencies({ adapter, now: new Date("2027-01-01T12:00:01.000Z") });
  const blocked = await handleCheckoutRequest(request({ reservationId, paymentCapability: capability, idempotencyKey: "x" }), deps);
  assert.equal(blocked.status, 409);
});

Deno.test("an eligible persisted Checkout URL is reused without Stripe", async () => {
  let called = false;
  const deps = dependencies({
    adapter: { async createCheckoutSession() { called = true; return { id: "cs_new", url: "https://checkout.stripe.test/new" }; } },
    rpc: async (name, parameters) => {
      if (name === "initiate_reservation_payment") return { data: [{ payment_attempt_id: "attempt-1", organisation_id: "org-1" }], error: null };
      if (name === "get_reservation_payment_checkout") return {
        data: [{ attempt_status: "checkout_open", provider_checkout_session_id: "cs_old", provider_checkout_url: "https://checkout.stripe.test/old", hold_expires_at: "2027-01-01T12:30:00.000Z", eligible: true }],
        error: null,
      };
      throw new Error(`unexpected ${name}`);
    },
  });
  const result = await handleCheckoutRequest(request({ reservationId, paymentCapability: capability, idempotencyKey: "x" }), deps);
  assert.equal(result.status, 200);
  assert.equal(called, false);
});

Deno.test("provider timeout and post-Stripe hold expiry are fail-closed", async () => {
  const timeout = await handleCheckoutRequest(
    request({ reservationId, paymentCapability: capability, idempotencyKey: "timeout" }),
    dependencies({ adapter: { async createCheckoutSession() { throw new StripeAdapterError("timeout"); } } }),
  );
  assert.equal(timeout.status, 504);

  const expired = dependencies({
    adapter: { async createCheckoutSession() { return { id: "cs_expired", url: "https://checkout.stripe.test/expired" }; } },
    rpc: async (name) => {
      if (name === "initiate_reservation_payment") return { data: [{ payment_attempt_id: "attempt-expired", organisation_id: "org-1" }], error: null };
      if (name === "get_reservation_payment_checkout") return {
        data: [{ reservation_id: reservationId, amount: 75, currency: "EUR", attempt_status: "created", customer_email: "customer@example.test", hold_expires_at: "2027-01-01T12:11:00.000Z", eligible: true, provider_checkout_session_id: null, provider_checkout_url: null }],
        error: null,
      };
      return { data: [{ hold_expires_at: "2027-01-01T12:00:00.000Z", eligible: false }], error: null };
    },
  });
  const withheld = await handleCheckoutRequest(request({ reservationId, paymentCapability: capability, idempotencyKey: "expired" }), expired);
  assert.equal(withheld.status, 409);
});
