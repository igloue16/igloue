import assert from "node:assert/strict";
import { createWorkerDependencies } from "./handler.ts";
import { processOutboxBatch } from "./worker.ts";
import { sendZeptoMail } from "../_shared/email/zeptomail.ts";

Deno.test("recovers only stale leases before claiming the bounded batch", async () => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const dependencies = createWorkerDependencies({
    async rpc(name, parameters) {
      calls.push([name, parameters]);
      return {
        data: name === "claim_outbox_events" ? [] : 2,
        error: null,
      };
    },
    from() {
      throw new Error("reservation query is not expected");
    },
  });

  assert.deepEqual(await dependencies.claim(10), []);
  assert.deepEqual(calls, [
    ["recover_stale_outbox_events", { p_limit: 100 }],
    ["claim_outbox_events", { p_limit: 10 }],
  ]);
});

Deno.test("does not claim outbox rows when stale lease recovery fails", async () => {
  const calls: string[] = [];
  const dependencies = createWorkerDependencies({
    async rpc(name) {
      calls.push(name);
      return { data: null, error: new Error("database unavailable") };
    },
    from() {
      throw new Error("reservation query is not expected");
    },
  });

  await assert.rejects(dependencies.claim(10), /stale outbox recovery failed/);
  assert.deepEqual(calls, ["recover_stale_outbox_events"]);
});

Deno.test("CPaaS acceptance completes reservation.confirmed through the injected fake transport", async () => {
  const org = "00000000-0000-4000-8000-000000005001";
  const reservationId = "00000000-0000-4000-8000-000000005101";
  const eventId = "00000000-0000-4000-8000-000000005201";
  const claimToken = "00000000-0000-4000-8000-000000005011";
  const rpcCalls: string[] = [];
  const completionParameters: Record<string, unknown>[] = [];
  let providerCalls = 0;
  let requestBody: Record<string, unknown> | null = null;
  const dependencies = createWorkerDependencies({
    async rpc(name, parameters) {
      rpcCalls.push(name);
      if (name === "claim_outbox_events") {
        return {
          data: [{
            id: eventId,
            organisation_id: org,
            event_type: "reservation.confirmed",
            aggregate_type: "reservation",
            aggregate_id: reservationId,
            payload: {},
            status: "processing",
            attempt_count: 1,
            last_attempt_at: null,
            lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
            claim_token: claimToken,
          }],
          error: null,
        };
      }
      if (name === "complete_outbox_event") completionParameters.push(parameters);
      return { data: true, error: null };
    },
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                async maybeSingle() {
                  return {
                    data: {
                      id: reservationId,
                      organisation_id: org,
                      status: "confirmed",
                      customer_id: "00000000-0000-4000-8000-000000005102",
                      product_id: "essential",
                      quantity: 1,
                      rental_start: "2027-07-12T12:00:00Z",
                      rental_end: "2027-07-19T12:00:00Z",
                      total_amount: "88.00",
                      delivery_address_line_1: "12 rue du Test",
                      delivery_address_line_2: null,
                      delivery_postcode: "75001",
                      delivery_city: "Paris",
                      customer: { organisation_id: org, first_name: "Camille", last_name: "Internal", email: "client@example.com" },
                      product: { name: "IGLOUE Essential" },
                      items: [{ product: { name: "IGLOUE Essential" } }],
                    },
                    error: null,
                  };
                },
              };
            },
          };
        },
      };
    },
  }, {
    transport: async (input) => {
      providerCalls += 1;
      return await sendZeptoMail(input, {
        getToken: () => "test-token-never-real",
        fetchImpl: async (_url, init) => {
          requestBody = JSON.parse(String(init?.body));
          return Response.json({ data: [{ code: "EM_104" }], request_id: "test-request-id" });
        },
      });
    },
  });
  const result = await processOutboxBatch(dependencies);
  assert.deepEqual(result, { claimed: 1, completed: 1, retried: 0, failed: 0, lostClaims: 0 });
  assert.equal(providerCalls, 1);
  assert.deepEqual(rpcCalls, ["recover_stale_outbox_events", "claim_outbox_events", "complete_outbox_event"]);
  assert.deepEqual(completionParameters, [{ p_event_id: eventId, p_claim_token: claimToken }]);
  const payload = requestBody as unknown as Record<string, unknown>;
  assert.equal(payload.subject, "Réservation confirmée — IGLOUE");
  assert.equal((payload.from as { address: string }).address, "commandes@igloue.fr");
  assert.equal(((payload.to as Array<{ email_address: { address: string } }>)[0]).email_address.address, "client@example.com");
  assert.equal(typeof payload.htmlbody, "string");
  assert.equal(typeof payload.textbody, "string");
});
