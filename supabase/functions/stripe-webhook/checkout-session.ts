const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_IDENTIFIER_LENGTH = 255;

export type CheckoutSessionParseError =
  | "unsupported_event"
  | "invalid_checkout_session"
  | "invalid_payment_state"
  | "invalid_amount"
  | "invalid_currency"
  | "invalid_payment_intent";

export type NormalizedCheckoutCompleted = {
  eventId: string;
  eventType: "checkout.session.completed";
  livemode: boolean;
  checkoutSessionId: string;
  mode: "payment";
  status: "complete";
  paymentStatus: "paid";
  amountTotal: number;
  currency: "eur";
  paymentIntentId: string;
  clientReferenceId: string | null;
  metadata: {
    paymentAttemptId: string | null;
    reservationId: string | null;
  };
};

export type CheckoutSessionParseResult =
  | { ok: true; value: NormalizedCheckoutCompleted }
  | { ok: false; code: CheckoutSessionParseError };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function identifier(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= MAX_IDENTIFIER_LENGTH
    ? normalized
    : null;
}

function uuidMetadata(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  const normalized = identifier(value);
  return normalized !== null && UUID.test(normalized) ? normalized : undefined;
}

function paymentIntentId(value: unknown): string | null {
  if (typeof value === "string") return identifier(value);
  if (isRecord(value)) return identifier(value.id);
  return null;
}

export function parseCheckoutSessionCompleted(event: unknown): CheckoutSessionParseResult {
  if (!isRecord(event) || event.type !== "checkout.session.completed") {
    return { ok: false, code: "unsupported_event" };
  }

  const eventId = identifier(event.id);
  if (eventId === null || typeof event.livemode !== "boolean") {
    return { ok: false, code: "invalid_checkout_session" };
  }

  const data = event.data;
  const session = isRecord(data) && isRecord(data.object) ? data.object : null;
  if (!session || session.object !== "checkout.session") {
    return { ok: false, code: "invalid_checkout_session" };
  }

  const checkoutSessionId = identifier(session.id);
  if (checkoutSessionId === null) {
    return { ok: false, code: "invalid_checkout_session" };
  }

  if (session.mode !== "payment" || session.status !== "complete" ||
      session.payment_status !== "paid") {
    return { ok: false, code: "invalid_payment_state" };
  }

  const amountTotal = session.amount_total;
  if (typeof amountTotal !== "number" || !Number.isFinite(amountTotal) ||
      !Number.isSafeInteger(amountTotal) || amountTotal < 0) {
    return { ok: false, code: "invalid_amount" };
  }

  if (session.currency !== "eur") {
    return { ok: false, code: "invalid_currency" };
  }

  const normalizedPaymentIntentId = paymentIntentId(session.payment_intent);
  if (normalizedPaymentIntentId === null) {
    return { ok: false, code: "invalid_payment_intent" };
  }

  const clientReferenceId = session.client_reference_id === undefined ||
      session.client_reference_id === null
    ? null
    : identifier(session.client_reference_id);
  if (session.client_reference_id !== undefined &&
      session.client_reference_id !== null &&
      (clientReferenceId === null || !UUID.test(clientReferenceId))) {
    return { ok: false, code: "invalid_checkout_session" };
  }

  const metadata = session.metadata === undefined || session.metadata === null
    ? {}
    : session.metadata;
  if (!isRecord(metadata)) {
    return { ok: false, code: "invalid_checkout_session" };
  }

  const paymentAttemptId = uuidMetadata(metadata.payment_attempt_id);
  const reservationId = uuidMetadata(metadata.reservation_id);
  if (paymentAttemptId === undefined || reservationId === undefined) {
    return { ok: false, code: "invalid_checkout_session" };
  }

  return {
    ok: true,
    value: {
      eventId,
      eventType: "checkout.session.completed",
      livemode: event.livemode,
      checkoutSessionId,
      mode: "payment",
      status: "complete",
      paymentStatus: "paid",
      amountTotal,
      currency: "eur",
      paymentIntentId: normalizedPaymentIntentId,
      clientReferenceId,
      metadata: { paymentAttemptId, reservationId },
    },
  };
}
