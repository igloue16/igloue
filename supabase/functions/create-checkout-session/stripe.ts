export type CheckoutRequest = {
  amount: number;
  currency: string;
  paymentAttemptId: string;
  reservationId: string;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
};

export type CheckoutSession = {
  id: string;
  url: string;
  paymentIntentId?: string;
};

export type StripeFailureKind = "timeout" | "provider_4xx" | "provider_5xx" | "invalid_response";

export class StripeAdapterError extends Error {
  readonly kind: StripeFailureKind;

  constructor(kind: StripeFailureKind) {
    super(kind);
    this.name = "StripeAdapterError";
    this.kind = kind;
  }
}

export interface CheckoutAdapter {
  createCheckoutSession(input: CheckoutRequest, idempotencyKey: string): Promise<CheckoutSession>;
}

export function stripeIdempotencyKey(paymentAttemptId: string): string {
  return `igloue:checkout-session:${paymentAttemptId}`;
}

export function amountToCents(amount: number): number {
  if (!Number.isFinite(amount) || amount < 0) throw new StripeAdapterError("invalid_response");
  const cents = amount * 100;
  if (!Number.isSafeInteger(Math.round(cents)) || Math.abs(cents - Math.round(cents)) > 1e-8) {
    throw new StripeAdapterError("invalid_response");
  }
  return Math.round(cents);
}

function formBody(input: CheckoutRequest): URLSearchParams {
  const cents = amountToCents(input.amount);
  const body = new URLSearchParams();
  body.set("mode", "payment");
  body.set("currency", "eur");
  body.set("line_items[0][price_data][currency]", "eur");
  body.set("line_items[0][price_data][unit_amount]", String(cents));
  body.set("line_items[0][price_data][product_data][name]", "IGLOUE rental payment");
  body.set("line_items[0][quantity]", "1");
  body.set("success_url", input.successUrl);
  body.set("cancel_url", input.cancelUrl);
  body.set("client_reference_id", input.paymentAttemptId);
  body.set("customer_email", input.customerEmail);
  body.set("metadata[payment_attempt_id]", input.paymentAttemptId);
  body.set("metadata[reservation_id]", input.reservationId);
  body.set("payment_intent_data[metadata][payment_attempt_id]", input.paymentAttemptId);
  body.set("payment_intent_data[metadata][reservation_id]", input.reservationId);
  return body;
}

export function createStripeCheckoutAdapter(
  secretKey: string,
  fetcher: typeof fetch = fetch,
): CheckoutAdapter {
  return {
    async createCheckoutSession(input, idempotencyKey) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      let response: Response;
      try {
        response = await fetcher("https://api.stripe.com/v1/checkout/sessions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${secretKey}`,
            "Content-Type": "application/x-www-form-urlencoded",
            "Idempotency-Key": idempotencyKey,
          },
          body: formBody(input),
          signal: controller.signal,
        });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new StripeAdapterError("timeout");
        }
        throw new StripeAdapterError("timeout");
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        throw new StripeAdapterError(response.status >= 500 ? "provider_5xx" : "provider_4xx");
      }

      let data: unknown;
      try {
        data = await response.json();
      } catch {
        throw new StripeAdapterError("invalid_response");
      }
      if (!data || typeof data !== "object") throw new StripeAdapterError("invalid_response");
      const row = data as Record<string, unknown>;
      if (typeof row.id !== "string" || typeof row.url !== "string" || !row.url.startsWith("https://")) {
        throw new StripeAdapterError("invalid_response");
      }
      return {
        id: row.id,
        url: row.url,
        ...(typeof row.payment_intent === "string" ? { paymentIntentId: row.payment_intent } : {}),
      };
    },
  };
}
