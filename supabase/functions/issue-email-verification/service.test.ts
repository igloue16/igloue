import assert from "node:assert/strict";
import { issueEmailVerificationToken } from "./service.ts";

const RESERVATION_ID = "00000000-0000-4000-8000-000000000301";

function mockRpc(result: unknown, error: { code?: string; message?: string } | null = null) {
  const calls: Array<{ name: string; parameters: Record<string, unknown> }> = [];
  return {
    calls,
    rpc: { async rpc(name: string, parameters: Record<string, unknown>) {
      calls.push({ name, parameters });
      return { data: result, error };
    } },
  };
}

Deno.test("issues a 256-bit URL-safe token and sends only its hash to RPC", async () => {
  const mock = mockRpc([{ token_id: "token-1", reservation_id: RESERVATION_ID, expires_at: "2027-01-01T12:30:00.000Z" }]);
  const result = await issueEmailVerificationToken(RESERVATION_ID, {
    rpc: mock.rpc,
    now: new Date("2027-01-01T12:00:00Z"),
  });
    assert.equal(result.status, "issued");
  if (result.status === "issued") {
    assert.equal(result.token.length, 43);
    assert.match(result.token, /^[A-Za-z0-9_-]+$/);
    assert.notEqual(result.token, mock.calls[0].parameters.p_token_hash);
    assert.equal(result.tokenId, "token-1");
  }
  assert.equal(mock.calls[0].name, "issue_email_verification_token");
  assert.equal(mock.calls[0].parameters.p_reservation_id, RESERVATION_ID);
  assert.equal(typeof mock.calls[0].parameters.p_token_hash, "string");
  assert.match(String(mock.calls[0].parameters.p_token_hash), /^\\x[0-9a-f]{64}$/);
  assert.deepEqual(Object.keys(mock.calls[0].parameters).sort(), [
    "p_requested_expires_at", "p_reservation_id", "p_token_hash",
  ]);
});

Deno.test("rejects malformed reservation IDs without generating or calling RPC", async () => {
  const mock = mockRpc([]);
  const result = await issueEmailVerificationToken("not-a-uuid", { rpc: mock.rpc });
  assert.deepEqual(result, { status: "error", code: "INVALID_REQUEST" });
  assert.equal(mock.calls.length, 0);
});

Deno.test("maps cooldown and eligibility failures without exposing database errors", async () => {
  const cooldown = mockRpc(null, { code: "P0004", message: "Email verification resend cooldown is active" });
  assert.deepEqual(
    await issueEmailVerificationToken(RESERVATION_ID, { rpc: cooldown.rpc }),
    { status: "error", code: "COOLDOWN" },
  );
  const ineligible = mockRpc(null, { code: "P0001", message: "internal reservation detail" });
  assert.deepEqual(
    await issueEmailVerificationToken(RESERVATION_ID, { rpc: ineligible.rpc }),
    { status: "error", code: "NOT_ELIGIBLE" },
  );
});
