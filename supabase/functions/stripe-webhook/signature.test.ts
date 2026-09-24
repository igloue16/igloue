import assert from "node:assert/strict";
import {
  DEFAULT_TOLERANCE_SECONDS,
  verifyStripeSignature,
} from "./signature.ts";

const SECRET = "whsec_test_only_local_secret";
const NOW = new Date("2027-01-01T12:00:00.000Z");
const BODY = new TextEncoder().encode('{"id":"evt_test_123","type":"checkout.session.completed"}');

async function sign(secret: string, timestamp: number, body = BODY): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const prefix = new TextEncoder().encode(`${timestamp}.`);
  const payload = new Uint8Array(prefix.length + body.length);
  payload.set(prefix);
  payload.set(body, prefix.length);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, payload.buffer));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timestamp() {
  return Math.floor(NOW.getTime() / 1000);
}

Deno.test("accepts a valid Stripe signature", async () => {
  const t = timestamp();
  assert.deepEqual(
    await verifyStripeSignature(BODY, `t=${t},v1=${await sign(SECRET, t)}`, SECRET, NOW),
    { ok: true },
  );
});

Deno.test("rejects invalid signatures, altered bodies, and wrong secrets", async () => {
  const t = timestamp();
  const signature = await sign(SECRET, t);
  assert.equal((await verifyStripeSignature(BODY, `t=${t},v1=${"00".repeat(32)}`, SECRET, NOW)).ok, false);
  assert.equal((await verifyStripeSignature(new TextEncoder().encode('{"altered":true}'), `t=${t},v1=${signature}`, SECRET, NOW)).ok, false);
  assert.equal((await verifyStripeSignature(BODY, `t=${t},v1=${signature}`, "wrong_secret", NOW)).ok, false);
});

Deno.test("rejects missing and malformed signature components", async () => {
  const t = timestamp();
  assert.equal((await verifyStripeSignature(BODY, null, SECRET, NOW)).ok, false);
  assert.equal((await verifyStripeSignature(BODY, `v1=${await sign(SECRET, t)}`, SECRET, NOW)).ok, false);
  assert.equal((await verifyStripeSignature(BODY, `t=not-a-time,v1=${await sign(SECRET, t)}`, SECRET, NOW)).ok, false);
  assert.equal((await verifyStripeSignature(BODY, `t=${t}`, SECRET, NOW)).ok, false);
  assert.equal((await verifyStripeSignature(BODY, `t=${t},v1=not-hex`, SECRET, NOW)).ok, false);
});

Deno.test("rejects timestamps outside the five-minute tolerance", async () => {
  const t = timestamp();
  const signature = await sign(SECRET, t);
  const old = t - DEFAULT_TOLERANCE_SECONDS - 1;
  const future = t + DEFAULT_TOLERANCE_SECONDS + 1;
  assert.equal((await verifyStripeSignature(BODY, `t=${old},v1=${await sign(SECRET, old)}`, SECRET, NOW)).ok, false);
  assert.equal((await verifyStripeSignature(BODY, `t=${future},v1=${await sign(SECRET, future)}`, SECRET, NOW)).ok, false);
  assert.equal((await verifyStripeSignature(BODY, `t=${t},v1=${signature}`, SECRET, NOW)).ok, true);
});

Deno.test("accepts any matching v1 signature and rejects when none match", async () => {
  const t = timestamp();
  const valid = await sign(SECRET, t);
  const invalid = "11".repeat(32);
  assert.equal((await verifyStripeSignature(BODY, `t=${t},v1=${invalid},v1=${valid}`, SECRET, NOW)).ok, true);
  assert.equal((await verifyStripeSignature(BODY, `t=${t},v1=${invalid},v1=${"22".repeat(32)}`, SECRET, NOW)).ok, false);
});
