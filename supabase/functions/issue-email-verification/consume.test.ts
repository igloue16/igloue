import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { issueEmailVerificationToken } from "./service.ts";
import { consumeEmailVerificationToken } from "./consume.ts";
import { encodeVerificationToken } from "./token.ts";

const reservationId = "00000000-0000-4000-8000-000000000401";

test("issued credential and consumption use the same SHA-256 bytea digest", async () => {
  let issuedHash: unknown;
  const issuer = { async rpc(_name: string, payload: Record<string, unknown>) {
    assert.equal(_name, "issue_email_verification_token");
    assert.deepEqual(Object.keys(payload).sort(), [
      "p_requested_expires_at", "p_reservation_id", "p_token_hash",
    ]);
    issuedHash = payload.p_token_hash;
    return { data: [{ token_id: "test-id" }], error: null };
  } };
  const issued = await issueEmailVerificationToken(reservationId, { rpc: issuer });
  assert.equal(issued.status, "issued");
  if (issued.status !== "issued") return;
  assert.match(issued.token, /^[A-Za-z0-9_-]{43}$/);
  assert.match(String(issuedHash), /^\\x[0-9a-f]{64}$/);
  assert.equal(issuedHash, `\\x${createHash("sha256")
    .update(Buffer.from(issued.token, "base64url")).digest("hex")}`);
  assert.notEqual(issued.token, issuedHash);

  let calls = 0;
  const consumer = { async rpc(name: string, payload: Record<string, unknown>) {
    calls++;
    assert.equal(name, "consume_email_verification_token");
    assert.deepEqual(Object.keys(payload), ["p_token_hash"]);
    assert.equal(payload.p_token_hash, issuedHash);
    assert.notEqual(payload.p_token_hash, issued.token);
    return { data: true, error: null };
  } };
  assert.deepEqual(await consumeEmailVerificationToken(issued.token, { rpc: consumer }),
    { status: "verified" });
  assert.equal(calls, 1);
});

test("malformed and non-canonical tokens never reach the database", async () => {
  let calls = 0;
  const rpc = { async rpc() { calls++; return { data: true, error: null }; } };
  const valid = encodeVerificationToken(new Uint8Array(32));
  for (const token of [null, "", "not-a-token", valid + "=", valid.slice(0, -1) + "!", valid.slice(0, -1) + "B"]) {
    assert.deepEqual(await consumeEmailVerificationToken(token, { rpc }),
      { status: "error", code: "INVALID_TOKEN" });
  }
  assert.equal(calls, 0);
});

test("database errors and thrown details are sanitized, and false is not success", async () => {
  const token = encodeVerificationToken(new Uint8Array(32));
  const rawMessage = "private token and customer data";
  for (const rpc of [
    { async rpc() { return { data: null, error: { code: "P0001", message: rawMessage } }; } },
    { async rpc() { throw new Error(rawMessage); } },
    { async rpc() { return { data: false, error: null }; } },
  ]) {
    const result = await consumeEmailVerificationToken(token, { rpc });
    assert.deepEqual(result, { status: "error", code: "NOT_ELIGIBLE" });
    assert.doesNotMatch(JSON.stringify(result), /private|token|customer data/);
  }
});
