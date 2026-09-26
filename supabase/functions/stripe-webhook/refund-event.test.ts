import { assertEquals } from "jsr:@std/assert@1";
import { parseStripeRefundEvent } from "./refund-event.ts";

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt_test123",
    type: "refund.updated",
    created: 1800000000,
    livemode: false,
    data: {
      object: {
        object: "refund",
        id: "re_test123",
        payment_intent: "pi_test123",
        amount: 7500,
        currency: "eur",
        status: "succeeded",
      },
    },
    ...overrides,
  };
}

Deno.test("refund parser retains only coherent reconciliation fields", () => {
  assertEquals(parseStripeRefundEvent(event()), {
    ok: true,
    value: {
      eventId: "evt_test123",
      eventType: "refund.updated",
      eventCreatedAt: new Date(1800000000 * 1000).toISOString(),
      livemode: false,
      refundId: "re_test123",
      paymentIntentId: "pi_test123",
      amountCents: 7500,
      currency: "eur",
      status: "succeeded",
    },
  });
});

Deno.test("refund parser rejects unsupported and incoherent provider data", () => {
  assertEquals(
    parseStripeRefundEvent(event({ type: "charge.refunded" })).ok,
    false,
  );
  for (
    const object of [
      {
        object: "charge",
        id: "re_test123",
        amount: 7500,
        currency: "eur",
        status: "succeeded",
      },
      {
        object: "refund",
        id: "bad",
        amount: 7500,
        currency: "eur",
        status: "succeeded",
      },
      {
        object: "refund",
        id: "re_test123",
        amount: 7500,
        currency: "usd",
        status: "succeeded",
      },
      {
        object: "refund",
        id: "re_test123",
        amount: 0,
        currency: "eur",
        status: "succeeded",
      },
    ]
  ) assertEquals(parseStripeRefundEvent(event({ data: { object } })).ok, false);
  assertEquals(
    parseStripeRefundEvent(
      event({
        type: "refund.failed",
        data: {
          object: {
            object: "refund",
            id: "re_test123",
            amount: 7500,
            currency: "eur",
            status: "pending",
          },
        },
      }),
    ).ok,
    false,
  );
});
