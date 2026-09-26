const EVENT_ID = /^evt_[A-Za-z0-9]+$/;
const REFUND_ID = /^re_[A-Za-z0-9]+$/;
const PAYMENT_INTENT_ID = /^pi_[A-Za-z0-9]+$/;
const REFUND_EVENT_TYPES = new Set([
  "refund.created",
  "refund.updated",
  "refund.failed",
]);

export type StripeRefundEventType =
  | "refund.created"
  | "refund.updated"
  | "refund.failed";
export type StripeRefundObjectStatus =
  | "pending"
  | "requires_action"
  | "succeeded"
  | "failed"
  | "canceled";

export type NormalizedStripeRefundEvent = {
  eventId: string;
  eventType: StripeRefundEventType;
  eventCreatedAt: string;
  livemode: boolean;
  refundId: string;
  paymentIntentId: string | null;
  amountCents: number;
  currency: "eur";
  status: StripeRefundObjectStatus;
};

export type StripeRefundEventParseResult =
  | { ok: true; value: NormalizedStripeRefundEvent }
  | { ok: false; code: "unsupported_event" | "malformed_refund_event" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function paymentIntentId(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  const id = typeof value === "string"
    ? value
    : isRecord(value) && typeof value.id === "string"
    ? value.id
    : null;
  return id !== null && PAYMENT_INTENT_ID.test(id) ? id : undefined;
}

export function isSupportedStripeRefundEventType(
  value: string,
): value is StripeRefundEventType {
  return REFUND_EVENT_TYPES.has(value);
}

export function parseStripeRefundEvent(
  value: unknown,
): StripeRefundEventParseResult {
  if (
    !isRecord(value) || typeof value.type !== "string" ||
    !isSupportedStripeRefundEventType(value.type)
  ) {
    return { ok: false, code: "unsupported_event" };
  }

  if (
    typeof value.id !== "string" || !EVENT_ID.test(value.id) ||
    typeof value.created !== "number" || !Number.isSafeInteger(value.created) ||
    value.created <= 0 ||
    !Number.isSafeInteger(value.created * 1000) ||
    !Number.isFinite(new Date(value.created * 1000).getTime()) ||
    typeof value.livemode !== "boolean"
  ) {
    return { ok: false, code: "malformed_refund_event" };
  }

  const data = value.data;
  const refund = isRecord(data) && isRecord(data.object) ? data.object : null;
  if (
    !refund || refund.object !== "refund" || typeof refund.id !== "string" ||
    !REFUND_ID.test(refund.id)
  ) {
    return { ok: false, code: "malformed_refund_event" };
  }

  const intentId = paymentIntentId(refund.payment_intent);
  if (
    intentId === undefined || typeof refund.amount !== "number" ||
    !Number.isSafeInteger(refund.amount) || refund.amount <= 0 ||
    refund.currency !== "eur" ||
    typeof refund.status !== "string" ||
    !["pending", "requires_action", "succeeded", "failed", "canceled"].includes(
      refund.status,
    ) ||
    (value.type === "refund.failed" && refund.status !== "failed")
  ) {
    return { ok: false, code: "malformed_refund_event" };
  }

  return {
    ok: true,
    value: {
      eventId: value.id,
      eventType: value.type,
      eventCreatedAt: new Date(value.created * 1000).toISOString(),
      livemode: value.livemode,
      refundId: refund.id,
      paymentIntentId: intentId,
      amountCents: refund.amount,
      currency: "eur",
      status: refund.status as StripeRefundObjectStatus,
    },
  };
}
