import assert from "node:assert/strict";
import { handleProcessOutboxRequest } from "./handler.ts";
import { processOutboxBatch, type ClaimedOutboxEvent, type ReservationEmailData, type WorkerDependencies } from "./worker.ts";

const org = "00000000-0000-4000-8000-000000005001";
const token = "00000000-0000-4000-8000-000000005011";
const reservationId = "00000000-0000-4000-8000-000000005101";

function event(overrides: Partial<ClaimedOutboxEvent> = {}): ClaimedOutboxEvent {
  return {
    id: "00000000-0000-4000-8000-000000005201",
    organisation_id: org,
    event_type: "reservation.confirmed",
    aggregate_type: "reservation",
    aggregate_id: reservationId,
    payload: { recipient: "attacker@example.com" },
    status: "processing",
    attempt_count: 1,
    last_attempt_at: null,
    lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
    claim_token: token,
    ...overrides,
  };
}

function reservation(overrides: Partial<ReservationEmailData> = {}): ReservationEmailData {
  return {
    id: reservationId,
    organisation_id: org,
    status: "confirmed",
    customer_id: "00000000-0000-4000-8000-000000005102",
    product_id: "essential",
    rental_start: "2027-07-12T12:00:00Z",
    rental_end: "2027-07-19T12:00:00Z",
    total_amount: "88.00",
    customer: { organisation_id: org, first_name: "Camille", last_name: "Test", email: "client@example.com" },
    product: { name: "IGLOUE Essential" },
    ...overrides,
  };
}

function dependencies(events: ClaimedOutboxEvent[], loaded = reservation()): WorkerDependencies & { calls: string[]; deliveredMessage?: unknown } {
  const calls: string[] = [];
  const value: WorkerDependencies & { calls: string[]; deliveredMessage?: unknown } = {
    calls,
    async claim(limit) { assert.equal(limit, 10); return events; },
    async loadReservation() { return loaded ? { status: "ok", reservation: loaded } : { status: "not_found" }; },
    async deliver(message) { value.deliveredMessage = message; calls.push("deliver"); return { status: "delivered" }; },
    async complete() { calls.push("complete"); return true; },
    async retry() { calls.push("retry"); return true; },
    async fail() { calls.push("fail"); return true; },
  };
  return value;
}

Deno.test("empty batch claims ten and returns zero counts", async () => {
  const deps = dependencies([]);
  assert.deepEqual(await processOutboxBatch(deps), { claimed: 0, completed: 0, retried: 0, failed: 0, lostClaims: 0 });
});

Deno.test("authoritative confirmed reservation is delivered and completed", async () => {
  const deps = dependencies([event()]);
  const result = await processOutboxBatch(deps);
  assert.deepEqual(result, { claimed: 1, completed: 1, retried: 0, failed: 0, lostClaims: 0 });
  assert.deepEqual(deps.calls, ["deliver", "complete"]);
  assert.equal((deps.deliveredMessage as { locale: string }).locale, "fr");
  assert.equal(JSON.stringify(deps.deliveredMessage).includes("attacker@example.com"), false);
});

Deno.test("unsupported, malformed and invalid events fail safely", async () => {
  const cases = [
    [event({ event_type: "payment.confirmed" }), "unsupported_event_type"],
    [event({ aggregate_type: "customer" }), "invalid_event_payload"],
    [event(), "invalid_reservation_state"],
  ] as const;
  for (const [claimed, code] of cases) {
    const deps = dependencies([claimed], code === "invalid_reservation_state" ? reservation({ status: "pending" }) : reservation());
    let seen = "";
    deps.fail = async (_id, _token, errorCode) => { seen = errorCode; return true; };
    await processOutboxBatch(deps);
    assert.equal(seen, code);
  }
});

Deno.test("ownership, missing data and recipient validation are terminal", async () => {
  const scenarios: Array<[Partial<ClaimedOutboxEvent>, Partial<ReservationEmailData>, string]> = [
    [{ organisation_id: "00000000-0000-4000-8000-000000005099" }, {}, "tenant_mismatch"],
    [{}, { customer: null }, "aggregate_not_found"],
    [{}, { product: null }, "product_not_found"],
    [{}, { customer: { organisation_id: org, first_name: "", last_name: "", email: "" } }, "recipient_missing"],
  ];
  for (const [eventChanges, reservationChanges, expected] of scenarios) {
    const deps = dependencies([event(eventChanges)], reservation(reservationChanges));
    let seen = "";
    deps.fail = async (_id, _token, code) => { seen = code; return true; };
    await processOutboxBatch(deps);
    assert.equal(seen, expected);
  }
});

Deno.test("database load failure and retryable delivery retry with five minutes", async () => {
  const deps = dependencies([event()]);
  deps.loadReservation = async () => ({ status: "error" });
  let delay = 0;
  let code = "";
  deps.retry = async (_id, _token, retryDelay, errorCode) => { delay = retryDelay; code = errorCode; return true; };
  assert.deepEqual(await processOutboxBatch(deps), { claimed: 1, completed: 0, retried: 1, failed: 0, lostClaims: 0 });
  assert.equal(delay, 300);
  assert.equal(code, "delivery_failed");
});

Deno.test("delivery retryable and terminal outcomes map to the matching transition", async () => {
  const retryDeps = dependencies([event()]);
  retryDeps.deliver = async () => ({ status: "retryable_failure", errorCode: "provider_timeout" });
  assert.equal((await processOutboxBatch(retryDeps)).retried, 1);
  assert.deepEqual(retryDeps.calls, ["retry"]);

  const failDeps = dependencies([event()]);
  failDeps.deliver = async () => ({ status: "terminal_failure", errorCode: "delivery_rejected" });
  assert.equal((await processOutboxBatch(failDeps)).failed, 1);
  assert.deepEqual(failDeps.calls, ["fail"]);
});

Deno.test("lost outcome claims are counted and never followed by another transition", async () => {
  for (const outcome of ["complete", "retry", "fail"] as const) {
    const deps = dependencies([event()]);
    deps.complete = async () => { deps.calls.push("complete"); return outcome === "complete" ? false : true; };
    deps.retry = async () => { deps.calls.push("retry"); return outcome === "retry" ? false : true; };
    deps.fail = async () => { deps.calls.push("fail"); return outcome === "fail" ? false : true; };
    if (outcome !== "complete") deps.deliver = async () => outcome === "retry"
      ? { status: "retryable_failure", errorCode: "provider_timeout" }
      : { status: "terminal_failure", errorCode: "delivery_rejected" };
    const result = await processOutboxBatch(deps);
    assert.equal(result.lostClaims, 1);
    assert.equal(deps.calls.filter((call) => call === "complete" || call === "retry" || call === "fail").length, 1);
  }
});

Deno.test("one event exception retries and does not prevent the next event", async () => {
  const deps = dependencies([event(), event({ id: "00000000-0000-4000-8000-000000005202" })]);
  let loads = 0;
  deps.loadReservation = async () => {
    loads += 1;
    if (loads === 1) throw new Error("private detail");
    return { status: "ok", reservation: reservation() };
  };
  const result = await processOutboxBatch(deps);
  assert.equal(result.retried, 1);
  assert.equal(result.completed, 1);
});

Deno.test("HTTP boundary accepts POST, rejects other methods, and returns counts only", async () => {
  const deps = dependencies([]);
  const ok = await handleProcessOutboxRequest(new Request("http://localhost", { method: "POST" }), deps);
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { ok: true, claimed: 0, completed: 0, retried: 0, failed: 0, lostClaims: 0 });
  const get = await handleProcessOutboxRequest(new Request("http://localhost", { method: "GET" }), deps);
  assert.equal(get.status, 405);
  assert.deepEqual(await get.json(), { ok: false, error: { code: "METHOD_NOT_ALLOWED" } });
});
