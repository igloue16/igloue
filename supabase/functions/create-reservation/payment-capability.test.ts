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
  assert.match(hash, /^\\x[0-9a-f]{64}$/);
  assert.equal(hash[0], "\\");
  assert.equal(hash[1], "x");
  assert.equal(hash.includes("\\\\"), false);
  assert.equal(hash, await paymentCapabilityHash(first));
});

Deno.test("changing the server secret invalidates the derived capability", async () => {
  const first = await derivePaymentCapability("attempt-1", "secret-a");
  const second = await derivePaymentCapability("attempt-1", "secret-b");
  assert.notEqual(first, second);
});

Deno.test("invalid capability material is rejected without exposing secrets", async () => {
  await assert.rejects(() => paymentCapabilityHash("not-a-capability"));
  await assert.rejects(() => paymentCapabilityHash("A".repeat(42) + "!"));
  await assert.rejects(() => paymentCapabilityHash("A".repeat(42) + "="));
  const generated = await derivePaymentCapability("canonicality", "test-secret");
  await assert.rejects(() => paymentCapabilityHash(`${generated}A`));
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const lastIndex = alphabet.indexOf(generated.at(-1)!);
  const alternateLast = alphabet[lastIndex === 63 ? lastIndex - 1 : lastIndex + 1];
  await assert.rejects(() => paymentCapabilityHash(generated.slice(0, -1) + alternateLast));
});
