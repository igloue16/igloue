import assert from "node:assert/strict";
import {
  createProductionDependencies,
  handleCheckoutRequest,
} from "./handler.ts";
import { type CheckoutAdapter, StripeAdapterError } from "./stripe.ts";

const capability = "A".repeat(43);
const reservationId = "00000000-0000-4000-8000-000000000101";

Deno.test("checkout configuration fails closed for missing or mismatched mode and malformed URLs", () => {
  const names = [
    "STRIPE_SECRET_KEY",
    "STRIPE_EXPECTED_LIVEMODE",
    "IGLOUE_CHECKOUT_SUCCESS_URL",
    "IGLOUE_CHECKOUT_CANCEL_URL",
  ];
  const previous = new Map(names.map((name) => [name, Deno.env.get(name)]));
  try {
    Deno.env.set("STRIPE_SECRET_KEY", "sk_test_local_only");
    Deno.env.set("STRIPE_EXPECTED_LIVEMODE", "false");
    Deno.env.set("IGLOUE_CHECKOUT_SUCCESS_URL", "https://example.test/success");
    Deno.env.set("IGLOUE_CHECKOUT_CANCEL_URL", "https://example.test/cancel");
    assert.doesNotThrow(() =>
      createProductionDependencies({
        rpc: async () => ({ data: null, error: null }),
      })
    );

    Deno.env.set("STRIPE_EXPECTED_LIVEMODE", "true");
    assert.throws(() =>
      createProductionDependencies({
        rpc: async () => ({ data: null, error: null }),
      })
    );
    Deno.env.set("STRIPE_EXPECTED_LIVEMODE", "false");
    Deno.env.set("IGLOUE_CHECKOUT_SUCCESS_URL", "https://");
    assert.throws(() =>
      createProductionDependencies({
        rpc: async () => ({ data: null, error: null }),
      })
    );
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
});

function request(body: unknown) {
  return new Request(
    "https://example.test/functions/v1/create-checkout-session",
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    },
  );
}

function dependencies(overrides: {
  rpc?: (
    name: string,
    parameters: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: null }>;
  adapter?: CheckoutAdapter;
  now?: Date;
} = {}) {
  const calls: { name: string; parameters: Record<string, unknown> }[] = [];
  let sessionPersisted = false;
  const rpc = overrides.rpc ?? (async (name, parameters) => {
    calls.push({ name, parameters });
    if (name === "initiate_reservation_payment") {
      return {
        data: [{
          payment_attempt_id: "00000000-0000-4000-8000-000000000201",
          organisation_id: "org-1",
        }],
        error: null,
      };
    }
    if (name === "prepare_reservation_payment_checkout") {
      return {
        data: [{
          payment_attempt_id: "00000000-0000-4000-8000-000000000201",
          reservation_id: reservationId,
          amount: 75,
          currency: "EUR",
          attempt_status: sessionPersisted ? "checkout_open" : "created",
          customer_email: "customer@example.test",
          hold_expires_at: "2027-01-01T12:36:00.000Z",
          checkout_expires_at: "2027-01-01T12:31:00.000Z",
          eligible: true,
          provider_checkout_session_id: sessionPersisted ? "cs_test_1" : null,
          provider_checkout_url: sessionPersisted
            ? "https://checkout.stripe.test/cs_test_1"
            : null,
        }],
        error: null,
      };
    }
    sessionPersisted = true;
    return {
      data: [{
        provider_checkout_session_id: "cs_test_1",
        provider_checkout_url: "https://checkout.stripe.test/cs_test_1",
        hold_expires_at: "2027-01-01T12:36:00.000Z",
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
  const result = await handleCheckoutRequest(
    request({
      reservationId,
      paymentCapability: capability,
      idempotencyKey: "payment-1",
    }),
    deps,
  );
  assert.equal(result.status, 201);
  const body = await result.json();
  assert.deepEqual(body, {
    ok: true,
    checkout: {
      url: "https://checkout.stripe.test/cs_test_1",
      holdExpiresAt: "2027-01-01T12:36:00.000Z",
    },
  });
  assert.match(
    String(deps.calls[0].parameters.p_capability_hash),
    /^\\x[0-9a-f]{64}$/,
  );
  assert.equal(
    String(deps.calls[0].parameters.p_capability_hash).includes(capability),
    false,
  );
});

Deno.test("unknown fields and insufficient hold time fail before Stripe", async () => {
  const adapter = {
    async createCheckoutSession() {
      throw new Error("must not call provider");
    },
  };
  const malformed = await handleCheckoutRequest(
    request({
      reservationId,
      paymentCapability: capability,
      idempotencyKey: "x",
      amount: 1,
    }),
    dependencies({ adapter }),
  );
  assert.equal(malformed.status, 400);

  const deps = dependencies({
    adapter,
    rpc: async (name) =>
      name === "initiate_reservation_payment"
        ? {
          data: [{ payment_attempt_id: "attempt-1", organisation_id: "org-1" }],
          error: null,
        }
        : {
          data: [{
            hold_expires_at: "2027-01-01T12:36:00.000Z",
            checkout_expires_at: "2027-01-01T12:31:00.000Z",
            eligible: false,
          }],
          error: null,
        },
  });
  const blocked = await handleCheckoutRequest(
    request({
      reservationId,
      paymentCapability: capability,
      idempotencyKey: "x",
    }),
    deps,
  );
  assert.equal(blocked.status, 409);
});

Deno.test("an eligible persisted Checkout URL is reused without Stripe", async () => {
  let called = false;
  const deps = dependencies({
    adapter: {
      async createCheckoutSession() {
        called = true;
        return { id: "cs_new", url: "https://checkout.stripe.test/new" };
      },
    },
    rpc: async (name, parameters) => {
      if (name === "initiate_reservation_payment") {
        return {
          data: [{ payment_attempt_id: "attempt-1", organisation_id: "org-1" }],
          error: null,
        };
      }
      if (name === "prepare_reservation_payment_checkout") {
        return {
          data: [{
            attempt_status: "checkout_open",
            provider_checkout_session_id: "cs_old",
            provider_checkout_url: "https://checkout.stripe.test/old",
            hold_expires_at: "2027-01-01T12:36:00.000Z",
            checkout_expires_at: "2027-01-01T12:31:00.000Z",
            eligible: true,
          }],
          error: null,
        };
      }
      throw new Error(`unexpected ${name}`);
    },
  });
  const result = await handleCheckoutRequest(
    request({
      reservationId,
      paymentCapability: capability,
      idempotencyKey: "x",
    }),
    deps,
  );
  assert.equal(result.status, 200);
  assert.equal(called, false);
});

Deno.test("a stale persisted Checkout URL is never returned", async () => {
  let called = false;
  const deps = dependencies({
    adapter: {
      async createCheckoutSession() {
        called = true;
        return { id: "cs_new", url: "https://checkout.stripe.test/new" };
      },
    },
    rpc: async (name) =>
      name === "initiate_reservation_payment"
        ? {
          data: [{ payment_attempt_id: "attempt-1", organisation_id: "org-1" }],
          error: null,
        }
        : {
          data: [{
            attempt_status: "checkout_open",
            provider_checkout_session_id: "cs_stale",
            provider_checkout_url: "https://checkout.stripe.test/stale",
            hold_expires_at: "2027-01-01T12:36:00.000Z",
            checkout_expires_at: "2027-01-01T12:31:00.000Z",
            eligible: false,
          }],
          error: null,
        },
  });
  const result = await handleCheckoutRequest(
    request({
      reservationId,
      paymentCapability: capability,
      idempotencyKey: "x",
    }),
    deps,
  );
  assert.equal(result.status, 409);
  assert.equal(called, false);
});

Deno.test("browser expiry values are rejected and server window expiry is passed to Stripe", async () => {
  let expiry: number | undefined;
  const adapter = {
    async createCheckoutSession(input: { expiresAt: number }) {
      expiry = input.expiresAt;
      return { id: "cs_test_1", url: "https://checkout.stripe.test/cs_test_1" };
    },
  } as CheckoutAdapter;
  const forbidden = await handleCheckoutRequest(
    request({
      reservationId,
      paymentCapability: capability,
      idempotencyKey: "x",
      expiresAt: 1,
    }),
    dependencies({ adapter }),
  );
  assert.equal(forbidden.status, 400);
  assert.equal(expiry, undefined);
  const ok = await handleCheckoutRequest(
    request({
      reservationId,
      paymentCapability: capability,
      idempotencyKey: "x",
    }),
    dependencies({ adapter }),
  );
  assert.equal(ok.status, 201);
  assert.equal(expiry, Date.parse("2027-01-01T12:31:00.000Z") / 1000);
});

Deno.test("provider timeout and post-Stripe hold expiry are fail-closed", async () => {
  const timeout = await handleCheckoutRequest(
    request({
      reservationId,
      paymentCapability: capability,
      idempotencyKey: "timeout",
    }),
    dependencies({
      adapter: {
        async createCheckoutSession() {
          throw new StripeAdapterError("timeout");
        },
      },
    }),
  );
  assert.equal(timeout.status, 504);

  let prepareCount = 0;
  const expired = dependencies({
    adapter: {
      async createCheckoutSession() {
        return {
          id: "cs_expired",
          url: "https://checkout.stripe.test/expired",
        };
      },
    },
    rpc: async (name, _parameters) => {
      if (name === "initiate_reservation_payment") {
        return {
          data: [{
            payment_attempt_id: "attempt-expired",
            organisation_id: "org-1",
          }],
          error: null,
        };
      }
      if (name === "prepare_reservation_payment_checkout") {
        prepareCount++;
        return {
          data: [{
            reservation_id: reservationId,
            amount: 75,
            currency: "EUR",
            attempt_status: "created",
            customer_email: "customer@example.test",
            hold_expires_at: "2027-01-01T12:36:00.000Z",
            checkout_expires_at: "2027-01-01T12:31:00.000Z",
            eligible: prepareCount === 1,
            provider_checkout_session_id: null,
            provider_checkout_url: null,
          }],
          error: null,
        };
      }
      return {
        data: [{
          hold_expires_at: "2027-01-01T12:00:00.000Z",
          eligible: false,
        }],
        error: null,
      };
    },
  });
  const withheld = await handleCheckoutRequest(
    request({
      reservationId,
      paymentCapability: capability,
      idempotencyKey: "expired",
    }),
    expired,
  );
  assert.equal(withheld.status, 409);
});
