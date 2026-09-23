import {
  deliverTransactionalEmail,
  type EmailDeliveryResult,
} from "../_shared/email/delivery-service.ts";
import { buildReservationConfirmationEmail } from "../_shared/email/templates.ts";

export const OUTBOX_BATCH_LIMIT = 10;
export const RETRY_DELAY_SECONDS = 300;

export type ClaimedOutboxEvent = {
  id: string;
  organisation_id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: unknown;
  status: "processing";
  attempt_count: number;
  last_attempt_at: string | null;
  lease_expires_at: string;
  claim_token: string;
};

export type ReservationEmailData = {
  id: string;
  organisation_id: string;
  status: string;
  customer_id: string;
  product_id: string;
  rental_start: string;
  rental_end: string;
  total_amount: string | number;
  customer: {
    organisation_id: string;
    first_name: string;
    last_name: string;
    email: string;
  } | null;
  product: { name: string } | null;
};

export type ReservationLoadResult =
  | { status: "ok"; reservation: ReservationEmailData }
  | { status: "not_found" }
  | { status: "error" };

export type WorkerDependencies = {
  claim: (limit: number) => Promise<ClaimedOutboxEvent[]>;
  loadReservation: (event: ClaimedOutboxEvent) => Promise<ReservationLoadResult>;
  deliver: (message: ReturnType<typeof buildReservationConfirmationEmail>) => Promise<EmailDeliveryResult>;
  complete: (eventId: string, claimToken: string) => Promise<boolean>;
  retry: (eventId: string, claimToken: string, delaySeconds: number, errorCode: string) => Promise<boolean>;
  fail: (eventId: string, claimToken: string, errorCode: string) => Promise<boolean>;
};

export type OutboxBatchResult = {
  claimed: number;
  completed: number;
  retried: number;
  failed: number;
  lostClaims: number;
};

function emptyResult(): OutboxBatchResult {
  return { claimed: 0, completed: 0, retried: 0, failed: 0, lostClaims: 0 };
}

async function recordRetry(
  event: ClaimedOutboxEvent,
  dependencies: WorkerDependencies,
  result: OutboxBatchResult,
  errorCode: string,
) {
  try {
    if (await dependencies.retry(event.id, event.claim_token, RETRY_DELAY_SECONDS, errorCode)) result.retried += 1;
    else result.lostClaims += 1;
  } catch {
    // The event remains owned by the database lease; do not attempt another transition.
  }
}

async function recordFailure(
  event: ClaimedOutboxEvent,
  dependencies: WorkerDependencies,
  result: OutboxBatchResult,
  errorCode: string,
) {
  try {
    if (await dependencies.fail(event.id, event.claim_token, errorCode)) result.failed += 1;
    else result.lostClaims += 1;
  } catch {
    // Keep processing the remainder of the batch without exposing database errors.
  }
}

async function processEvent(
  event: ClaimedOutboxEvent,
  dependencies: WorkerDependencies,
  result: OutboxBatchResult,
) {
  try {
    if (event.event_type !== "reservation.confirmed") {
      await recordFailure(event, dependencies, result, "unsupported_event_type");
      return;
    }
    if (event.aggregate_type !== "reservation") {
      await recordFailure(event, dependencies, result, "invalid_event_payload");
      return;
    }

    const loaded = await dependencies.loadReservation(event);
    if (loaded.status === "error") {
      await recordRetry(event, dependencies, result, "delivery_failed");
      return;
    }
    if (loaded.status === "not_found") {
      await recordFailure(event, dependencies, result, "aggregate_not_found");
      return;
    }

    const reservation = loaded.reservation;
    if (!reservation.customer) {
      await recordFailure(event, dependencies, result, "aggregate_not_found");
      return;
    }
    if (reservation.organisation_id !== event.organisation_id ||
        reservation.customer.organisation_id !== reservation.organisation_id) {
      await recordFailure(event, dependencies, result, "tenant_mismatch");
      return;
    }
    if (reservation.status !== "confirmed") {
      await recordFailure(event, dependencies, result, "invalid_reservation_state");
      return;
    }
    if (!reservation.product) {
      await recordFailure(event, dependencies, result, "product_not_found");
      return;
    }
    if (typeof reservation.customer.email !== "string" || reservation.customer.email.trim() === "") {
      await recordFailure(event, dependencies, result, "recipient_missing");
      return;
    }

    const message = buildReservationConfirmationEmail({
      recipientEmail: reservation.customer.email,
      customerName: [reservation.customer.first_name, reservation.customer.last_name]
        .filter((value) => typeof value === "string" && value.trim() !== "")
        .join(" "),
      reservationReference: reservation.id,
      productName: reservation.product.name,
      startDate: reservation.rental_start,
      endDate: reservation.rental_end,
      totalAmount: String(reservation.total_amount),
    }, "fr");

    const delivery = await dependencies.deliver(message);
    if (delivery.status === "retryable_failure") {
      await recordRetry(event, dependencies, result, delivery.errorCode);
      return;
    }
    if (delivery.status === "terminal_failure") {
      await recordFailure(event, dependencies, result, delivery.errorCode);
      return;
    }

    try {
      if (await dependencies.complete(event.id, event.claim_token)) result.completed += 1;
      else result.lostClaims += 1;
    } catch {
      // Completion failure is not safe to replace with another transition.
    }
  } catch {
    await recordRetry(event, dependencies, result, "delivery_failed");
  }
}

export async function processOutboxBatch(dependencies: WorkerDependencies): Promise<OutboxBatchResult> {
  const events = await dependencies.claim(OUTBOX_BATCH_LIMIT);
  const result = emptyResult();
  result.claimed = events.length;
  for (const event of events) await processEvent(event, dependencies, result);
  return result;
}
