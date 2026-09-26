export type RefundRequest = {
  refundId: string;
  paymentIntentId: string;
  expectedAmount: number;
  currency: string;
};

export type StripeRefund = {
  id: string;
  status: "succeeded" | "failed" | "pending";
  amount: number;
  currency: "EUR";
  paymentIntentId: string;
};

export type StripeFailureKind =
  | "timeout"
  | "provider_4xx"
  | "provider_5xx"
  | "invalid_response";

export class StripeRefundError extends Error {
  readonly kind: StripeFailureKind;

  constructor(kind: StripeFailureKind) {
    super(kind);
    this.name = "StripeRefundError";
    this.kind = kind;
  }
}

export interface StripeRefundAdapter {
  createFullRefund(
    input: RefundRequest,
    idempotencyKey: string,
  ): Promise<StripeRefund>;
}

export function stripeRefundIdempotencyKey(refundId: string): string {
  return `igloue:refund:${refundId}`;
}

function amountToCents(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new StripeRefundError("invalid_response");
  }
  const cents = amount * 100;
  if (
    !Number.isSafeInteger(Math.round(cents)) ||
    Math.abs(cents - Math.round(cents)) > 1e-8
  ) {
    throw new StripeRefundError("invalid_response");
  }
  return Math.round(cents);
}

function paymentIntentId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const id = (value as Record<string, unknown>).id;
    return typeof id === "string" ? id : null;
  }
  return null;
}

export function createStripeRefundAdapter(
  secretKey: string,
  fetcher: typeof fetch = fetch,
): StripeRefundAdapter {
  return {
    async createFullRefund(input, idempotencyKey) {
      const expectedCents = amountToCents(input.expectedAmount);
      if (
        input.currency !== "EUR" ||
        !/^pi_[A-Za-z0-9]+$/.test(input.paymentIntentId)
      ) {
        throw new StripeRefundError("invalid_response");
      }

      const body = new URLSearchParams();
      body.set("payment_intent", input.paymentIntentId);
      body.set("metadata[igloue_refund_id]", input.refundId);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      let response: Response;
      try {
        response = await fetcher("https://api.stripe.com/v1/refunds", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${secretKey}`,
            "Content-Type": "application/x-www-form-urlencoded",
            "Idempotency-Key": idempotencyKey,
          },
          body,
          signal: controller.signal,
        });
      } catch {
        throw new StripeRefundError("timeout");
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        throw new StripeRefundError(
          response.status >= 500 ? "provider_5xx" : "provider_4xx",
        );
      }

      let data: unknown;
      try {
        data = await response.json();
      } catch {
        throw new StripeRefundError("invalid_response");
      }
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new StripeRefundError("invalid_response");
      }

      const row = data as Record<string, unknown>;
      const responsePaymentIntentId = paymentIntentId(row.payment_intent);
      if (
        typeof row.id !== "string" || !/^re_[A-Za-z0-9]+$/.test(row.id) ||
        !Number.isSafeInteger(row.amount) || row.amount !== expectedCents ||
        row.currency !== "eur" ||
        responsePaymentIntentId !== input.paymentIntentId
      ) {
        throw new StripeRefundError("invalid_response");
      }

      let status: StripeRefund["status"];
      if (row.status === "succeeded") status = "succeeded";
      else if (row.status === "failed" || row.status === "canceled") {
        status = "failed";
      } else if (row.status === "pending" || row.status === "requires_action") {
        status = "pending";
      } else throw new StripeRefundError("invalid_response");

      return {
        id: row.id,
        status,
        amount: input.expectedAmount,
        currency: "EUR",
        paymentIntentId: input.paymentIntentId,
      };
    },
  };
}
