import assert from "node:assert/strict";
import {
  createRecoveryDependencies,
  createRefundRecoveryDependencies,
  handleRecoveryRequest,
} from "./handler.ts";
import { RECOVERY_BATCH_LIMIT, type RecoveryDependencies } from "./worker.ts";

Deno.test("recovery RPC adapter uses server expected livemode and only internal event IDs", async () => {
  const calls: Array<{ name: string; parameters: Record<string, unknown> }> =
    [];
  const dependencies = createRecoveryDependencies({
    async rpc(name, parameters) {
      calls.push({ name, parameters });
      if (name === "claim_payment_provider_event_recovery") {
        return {
          data: [{
            event_id: "event-1",
            claim_token: "token-1",
            attempt_count: 1,
          }],
          error: null,
        };
      }
      if (name === "apply_provider_payment_outcome") {
        return { data: [{ outcome: "requires_review" }], error: null };
      }
      return { data: "completed", error: null };
    },
  }, false);

  const [event] = await dependencies.claim(RECOVERY_BATCH_LIMIT);
  assert.equal(event.event_id, "event-1");
  assert.equal(
    await dependencies.applyAuthority(event.event_id),
    "requires_review",
  );
  assert.equal(
    await dependencies.recordResult(
      event.event_id,
      event.claim_token,
      "processed",
    ),
    "completed",
  );
  assert.deepEqual(calls, [
    {
      name: "claim_payment_provider_event_recovery",
      parameters: { p_limit: 10, p_expected_livemode: false },
    },
    {
      name: "apply_provider_payment_outcome",
      parameters: { p_event_id: "event-1" },
    },
    {
      name: "record_payment_provider_event_recovery",
      parameters: {
        p_event_id: "event-1",
        p_claim_token: "token-1",
        p_result: "processed",
        p_error_class: null,
      },
    },
  ]);
});

Deno.test("missing server livemode fails closed before claiming", async () => {
  let called = false;
  const dependencies = createRecoveryDependencies({
    async rpc() {
      called = true;
      return { data: [], error: null };
    },
  }, null);
  await assert.rejects(
    () => dependencies.claim(1),
    /livemode configuration unavailable/,
  );
  assert.equal(called, false);
});

Deno.test("refund recovery adapter claims by expected mode and applies internal receipts", async () => {
  const calls: Array<{ name: string; parameters: Record<string, unknown> }> =
    [];
  const dependencies = createRefundRecoveryDependencies({
    async rpc(name, parameters) {
      calls.push({ name, parameters });
      if (name === "claim_payment_refund_event_recovery") {
        return {
          data: [{
            event_id: "event-refund",
            claim_token: "token-refund",
            attempt_count: 1,
          }],
          error: null,
        };
      }
      if (name === "apply_payment_refund_provider_event") {
        return {
          data: [{ outcome: "succeeded", refund_id: "refund-internal" }],
          error: null,
        };
      }
      return { data: "completed", error: null };
    },
  }, false);
  const [event] = await dependencies.claim(10);
  assert.equal(await dependencies.applyAuthority(event.event_id), "succeeded");
  assert.equal(
    await dependencies.recordResult(
      event.event_id,
      event.claim_token,
      "processed",
    ),
    "completed",
  );
  assert.deepEqual(calls.map((call) => call.name), [
    "claim_payment_refund_event_recovery",
    "apply_payment_refund_provider_event",
    "record_payment_provider_event_recovery",
  ]);
  assert.deepEqual(calls[0].parameters, {
    p_limit: 10,
    p_expected_livemode: false,
  });
  assert.deepEqual(calls[1].parameters, { p_event_id: "event-refund" });
});

Deno.test("recovery endpoint is POST-only and returns sanitized batch results", async () => {
  const dependencies: RecoveryDependencies = {
    async claim() {
      return [];
    },
    async applyAuthority() {
      return null;
    },
    async recordResult() {
      return "lost_claim";
    },
  };
  const get = await handleRecoveryRequest(
    new Request("https://example.test", { method: "GET" }),
    dependencies,
  );
  assert.equal(get.status, 405);

  const post = await handleRecoveryRequest(
    new Request("https://example.test", { method: "POST" }),
    dependencies,
  );
  assert.equal(post.status, 200);
  assert.deepEqual(await post.json(), {
    ok: true,
    claimed: 0,
    processed: 0,
    terminal: 0,
    retried: 0,
    retryExhausted: 0,
    lostClaims: 0,
  });
});
