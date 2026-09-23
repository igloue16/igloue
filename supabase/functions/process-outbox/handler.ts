import {
  deliverTransactionalEmail,
  type EmailDeliveryResult,
} from "../_shared/email/delivery-service.ts";
import { processOutboxBatch, type ClaimedOutboxEvent, type ReservationEmailData, type ReservationLoadResult, type WorkerDependencies } from "./worker.ts";

type QueryResult<T> = { data: T | null; error: unknown | null };
type SupabaseClient = {
  rpc(name: string, parameters: Record<string, unknown>): Promise<QueryResult<unknown>>;
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): Promise<QueryResult<unknown>>;
      };
    };
  };
};

function response(body: unknown, status = 200) {
  return Response.json(body, { status });
}

function scalarBoolean(data: unknown) {
  if (typeof data === "boolean") return data;
  if (Array.isArray(data) && data.length === 1 && data[0] && typeof data[0] === "object") {
    const values = Object.values(data[0] as Record<string, unknown>);
    return values.length === 1 && values[0] === true;
  }
  return false;
}

function rows(data: unknown): ClaimedOutboxEvent[] {
  return Array.isArray(data) ? data as ClaimedOutboxEvent[] : [];
}

export function createWorkerDependencies(supabaseAdmin: SupabaseClient): WorkerDependencies {
  return {
    async claim(limit) {
      const result = await supabaseAdmin.rpc("claim_outbox_events", { p_limit: limit });
      if (result.error) throw new Error("claim failed");
      return rows(result.data);
    },
    async loadReservation(event): Promise<ReservationLoadResult> {
      const result = await supabaseAdmin
        .from("reservations")
        .select("id, organisation_id, status, customer_id, product_id, rental_start, rental_end, total_amount, customer:customers(organisation_id, first_name, last_name, email), product:products(name)")
        .eq("id", event.aggregate_id)
        .maybeSingle();
      if (result.error) return { status: "error" };
      if (!result.data) return { status: "not_found" };
      return { status: "ok", reservation: result.data as ReservationEmailData };
    },
    deliver(message): Promise<EmailDeliveryResult> {
      return deliverTransactionalEmail(message);
    },
    async complete(eventId, claimToken) {
      const result = await supabaseAdmin.rpc("complete_outbox_event", {
        p_event_id: eventId,
        p_claim_token: claimToken,
      });
      if (result.error) throw new Error("complete failed");
      return scalarBoolean(result.data);
    },
    async retry(eventId, claimToken, delaySeconds, errorCode) {
      const result = await supabaseAdmin.rpc("retry_outbox_event", {
        p_event_id: eventId,
        p_claim_token: claimToken,
        p_retry_delay_seconds: delaySeconds,
        p_error_code: errorCode,
      });
      if (result.error) throw new Error("retry failed");
      return scalarBoolean(result.data);
    },
    async fail(eventId, claimToken, errorCode) {
      const result = await supabaseAdmin.rpc("fail_outbox_event", {
        p_event_id: eventId,
        p_claim_token: claimToken,
        p_error_code: errorCode,
      });
      if (result.error) throw new Error("fail failed");
      return scalarBoolean(result.data);
    },
  };
}

export async function handleProcessOutboxRequest(
  request: Request,
  dependencies: WorkerDependencies,
) {
  if (request.method !== "POST") return response({ ok: false, error: { code: "METHOD_NOT_ALLOWED" } }, 405);
  try {
    return response({ ok: true, ...await processOutboxBatch(dependencies) });
  } catch {
    return response({ ok: false, error: { code: "INTERNAL_ERROR" } }, 503);
  }
}
