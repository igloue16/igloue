import assert from "node:assert/strict";
import { createWorkerDependencies } from "./handler.ts";

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
