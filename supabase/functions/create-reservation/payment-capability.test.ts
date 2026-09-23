import assert from "node:assert/strict";
import { derivePaymentCapability, paymentCapabilityHash } from "./payment-capability.ts";

Deno.test("payment capability is deterministic, reservation-scoped by context, and hash-only at rest", async () => {
  const first = await derivePaymentCapability("attempt-1", "test-secret");
  const replay = await derivePaymentCapability("attempt-1", "test-secret");
  const other = await derivePaymentCapability("attempt-2", "test-secret");
  const hash = await paymentCapabilityHash(first);

  assert.equal(first.length, 43);
  assert.equal(first, replay);
  assert.notEqual(first, other);
  assert.notEqual(first, hash);
  assert(hash.startsWith("\\x"));
  assert.equal(hash.length, 66);
});

Deno.test("changing the server secret invalidates the derived capability", async () => {
  const first = await derivePaymentCapability("attempt-1", "secret-a");
  const second = await derivePaymentCapability("attempt-1", "secret-b");
  assert.notEqual(first, second);
});

Deno.test("invalid capability material is rejected without exposing secrets", async () => {
  await assert.rejects(() => paymentCapabilityHash("not-a-capability"));
});
