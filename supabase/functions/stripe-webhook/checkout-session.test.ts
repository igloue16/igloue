import { assertEquals, assertFalse } from "jsr:@std/assert@1";
import {
  parseCheckoutSessionCompleted,
  type CheckoutSessionParseError,
} from "./checkout-session.ts";

const EVENT_ID = "evt_test_123";
const SESSION_ID = "cs_test_123";
const PAYMENT_ATTEMPT_ID = "00000000-0000-4000-8000-000000000201";
const RESERVATION_ID = "00000000-0000-4000-8000-000000000202";

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: EVENT_ID,
    type: "checkout.session.completed",
    livemode: false,
    data: {
      object: {
        object: "checkout.session",
        id: SESSION_ID,
        mode: "payment",
        status: "complete",
        payment_status: "paid",
        amount_total: 12345,
        currency: "eur",
        payment_intent: "pi_test_123",
        client_reference_id: PAYMENT_ATTEMPT_ID,
        metadata: {
          payment_attempt_id: PAYMENT_ATTEMPT_ID,
          reservation_id: RESERVATION_ID,
          unrelated: "discard-me",
        },
        customer_email: "customer@example.test",
      },
    },
    ...overrides,
  };
}

function session(overrides: Record<string, unknown> = {}) {
  return event({ data: { object: { ...event().data.object, ...overrides } } });
}

function assertError(input: unknown, code: CheckoutSessionParseError) {
  const result = parseCheckoutSessionCompleted(input);
  assertEquals(result, { ok: false, code });
}

Deno.test("normalizes a valid card Checkout Session", () => {
  const result = parseCheckoutSessionCompleted(event());

  assertEquals(result, {
    ok: true,
    value: {
      eventId: EVENT_ID,
      eventType: "checkout.session.completed",
      livemode: false,
      checkoutSessionId: SESSION_ID,
      mode: "payment",
      status: "complete",
      paymentStatus: "paid",
      amountTotal: 12345,
      currency: "eur",
      paymentIntentId: "pi_test_123",
      clientReferenceId: PAYMENT_ATTEMPT_ID,
      metadata: {
        paymentAttemptId: PAYMENT_ATTEMPT_ID,
        reservationId: RESERVATION_ID,
      },
    },
  });
});

Deno.test("normalizes an expanded PaymentIntent object", () => {
  const result = parseCheckoutSessionCompleted(session({
    payment_intent: { id: "pi_expanded_123", object: "payment_intent" },
  }));

  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.value.paymentIntentId, "pi_expanded_123");
});

Deno.test("preserves livemode and exact integer cents", () => {
  const result = parseCheckoutSessionCompleted({
    ...event(),
    livemode: true,
    data: { object: { ...event().data.object, amount_total: 9007199254740000 } },
  });

  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.value.livemode, true);
    assertEquals(result.value.amountTotal, 9007199254740000);
  }
});

Deno.test("normalizes missing references and metadata fields to null", () => {
  const result = parseCheckoutSessionCompleted(session({
    client_reference_id: null,
    metadata: {},
  }));

  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.value.clientReferenceId, null);
    assertEquals(result.value.metadata, {
      paymentAttemptId: null,
      reservationId: null,
    });
  }
});

Deno.test("discards unrelated metadata and customer data", () => {
  const result = parseCheckoutSessionCompleted(event());
  assertEquals(result.ok, true);
  if (result.ok) {
    assertFalse("unrelated" in result.value.metadata);
    assertFalse("customer_email" in result.value);
    assertFalse("data" in result.value);
  }
});

Deno.test("rejects unsupported event types and invalid event envelopes", () => {
  assertError({ ...event(), type: "checkout.session.expired" }, "unsupported_event");
  assertError({ ...event(), id: " " }, "invalid_checkout_session");
  assertError({ ...event(), livemode: "false" }, "invalid_checkout_session");
});

Deno.test("rejects missing or malformed session objects", () => {
  assertError({ ...event(), data: undefined }, "invalid_checkout_session");
  assertError({ ...event(), data: { object: undefined } }, "invalid_checkout_session");
  assertError({ ...event(), data: { object: { ...event().data.object, object: "payment_intent" } } }, "invalid_checkout_session");
  assertError(session({ id: undefined }), "invalid_checkout_session");
  assertError(session({ id: " " }), "invalid_checkout_session");
  assertError(session({ id: "x".repeat(256) }), "invalid_checkout_session");
});

Deno.test("rejects invalid payment state", () => {
  assertError(session({ mode: "setup" }), "invalid_payment_state");
  assertError(session({ status: "open" }), "invalid_payment_state");
  assertError(session({ payment_status: "unpaid" }), "invalid_payment_state");
});

Deno.test("rejects invalid money and currency", () => {
  assertError(session({ amount_total: undefined }), "invalid_amount");
  assertError(session({ amount_total: 12.5 }), "invalid_amount");
  assertError(session({ amount_total: Number.NaN }), "invalid_amount");
  assertError(session({ amount_total: Number.POSITIVE_INFINITY }), "invalid_amount");
  assertError(session({ amount_total: Number.MAX_SAFE_INTEGER + 1 }), "invalid_amount");
  assertError(session({ amount_total: -1 }), "invalid_amount");
  assertError(session({ currency: "gbp" }), "invalid_currency");
  assertError(session({ currency: undefined }), "invalid_currency");
});

Deno.test("rejects missing or malformed PaymentIntent values", () => {
  assertError(session({ payment_intent: undefined }), "invalid_payment_intent");
  assertError(session({ payment_intent: null }), "invalid_payment_intent");
  assertError(session({ payment_intent: " " }), "invalid_payment_intent");
  assertError(session({ payment_intent: { object: "payment_intent" } }), "invalid_payment_intent");
  assertError(session({ payment_intent: { id: " " } }), "invalid_payment_intent");
});

Deno.test("fails closed on malformed references without making them authoritative", () => {
  assertError(session({ client_reference_id: "not-a-uuid" }), "invalid_checkout_session");
  assertError(session({ metadata: { payment_attempt_id: "not-a-uuid" } }), "invalid_checkout_session");
  assertError(session({ metadata: { reservation_id: "not-a-uuid" } }), "invalid_checkout_session");
});

Deno.test("is a pure local parser with no provider or database boundary", () => {
  const result = parseCheckoutSessionCompleted(event());
  assertEquals(result.ok, true);
});
