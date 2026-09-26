import assert from "node:assert/strict";
import {
  type ClaimedPaymentEvent,
  recoverStripeEventsBatch,
  RECOVERY_BATCH_LIMIT,
  type RecoveryDependencies,
} from "./worker.ts";

const event: ClaimedPaymentEvent = {
  event_id: "00000000-0000-4000-8000-00000000a901",
  claim_token: "00000000-0000-4000-8000-00000000a902",
  attempt_count: 1,
};

function dependencies(overrides: Partial<RecoveryDependencies> = {}) {
  const calls: unknown[][] = [];
  const value: RecoveryDependencies = {
    async claim(limit) {
      calls.push(["claim", limit]);
      return [event];
    },
    async applyAuthority(eventId) {
      calls.push(["apply", eventId]);
      return "paid_confirmed";
    },
    async recordResult(id, token, result, errorClass) {
      calls.push(["record", id, token, result, errorClass]);
      return result === "processed" ? "completed" : "retry_scheduled";
    },
    ...overrides,
  };
  return { value, calls };
}

Deno.test("recovery reuses the authoritative outcome RPC result for paid and review events", async () => {
  const { value, calls } = dependencies({
    async claim(limit) {
      assert.equal(limit, RECOVERY_BATCH_LIMIT);
      return [event, { ...event, event_id: "event-review" }];
    },
    async applyAuthority(eventId) {
      return eventId === event.event_id ? "paid_confirmed" : "requires_review";
    },
  });

  const result = await recoverStripeEventsBatch(value);
  assert.deepEqual(result, {
    claimed: 2,
    processed: 2,
    terminal: 0,
    retried: 0,
    retryExhausted: 0,
    lostClaims: 0,
  });
  assert.deepEqual(
    calls.filter((call) => call[0] === "record").map((call) => call[3]),
    ["processed", "processed"],
  );
});

Deno.test("not-authoritative outcomes are terminal and are not reported as paid", async () => {
  const { value, calls } = dependencies({
    async applyAuthority() {
      return "not_authoritative";
    },
    async recordResult(_id, _token, result) {
      calls.push(["record", result]);
      return "terminal";
    },
  });
  const result = await recoverStripeEventsBatch(value);
  assert.equal(result.terminal, 1);
  assert.equal(result.processed, 0);
  assert.deepEqual(calls.at(-1), ["record", "not_authoritative"]);
});

Deno.test("authority failures are classified for bounded retry without exposing provider errors", async () => {
  const { value, calls } = dependencies({
    async applyAuthority() {
      throw new Error("database details must not leak");
    },
    async recordResult(_id, _token, result, errorClass) {
      calls.push(["record", result, errorClass]);
      return "retry_scheduled";
    },
  });
  const result = await recoverStripeEventsBatch(value);
  assert.equal(result.retried, 1);
  assert.equal(result.processed, 0);
  assert.deepEqual(calls.at(-1), [
    "record",
    "transient_error",
    "authority_rpc_unavailable",
  ]);
  assert.equal(JSON.stringify(result).includes("database details"), false);
});

Deno.test("invalid authority responses are retried and an empty claim makes no authority calls", async () => {
  const invalid = dependencies({
    async applyAuthority() {
      return null;
    },
  });
  const invalidResult = await recoverStripeEventsBatch(invalid.value);
  assert.equal(invalidResult.retried, 1);
  assert.equal(invalid.calls.at(-1)?.[4], "invalid_authority_response");

  const empty = dependencies({
    async claim() {
      return [];
    },
    async applyAuthority() {
      throw new Error("must not run");
    },
  });
  const emptyResult = await recoverStripeEventsBatch(empty.value);
  assert.equal(emptyResult.claimed, 0);
  assert.equal(emptyResult.processed, 0);
});

Deno.test("a lost result claim is counted without repeating payment authority", async () => {
  let authorityCalls = 0;
  const lost = dependencies({
    async applyAuthority() {
      authorityCalls += 1;
      return "already_paid";
    },
    async recordResult() {
      return "lost_claim";
    },
  });
  const result = await recoverStripeEventsBatch(lost.value);
  assert.equal(authorityCalls, 1);
  assert.equal(result.lostClaims, 1);
  assert.equal(result.processed, 0);
});
