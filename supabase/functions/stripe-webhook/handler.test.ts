import assert from "node:assert/strict";
import { handleStripeWebhookRequest, MAX_BODY_BYTES } from "./handler.ts";

const SECRET = "whsec_test_only_local_secret";
const NOW = new Date("2027-01-01T12:00:00.000Z");
const TIMESTAMP = Math.floor(NOW.getTime() / 1000);

async function signature(body: string, secret = SECRET, timestamp = TIMESTAMP): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bodyBytes = new TextEncoder().encode(body);
  const prefix = new TextEncoder().encode(`${timestamp}.`);
  const payload = new Uint8Array(prefix.length + bodyBytes.length);
  payload.set(prefix);
  payload.set(bodyBytes, prefix.length);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, payload.buffer));
  return `t=${timestamp},v1=${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function request(body: string, method = "POST", headers: Record<string, string> = {}) {
  return new Request("http://localhost/functions/v1/stripe-webhook", {
    method,
    body: method === "POST" ? body : undefined,
    headers,
  });
}

function dependencies(secret: string | undefined = SECRET) {
  return { secret, now: NOW };
}

async function errorCode(response: Response): Promise<string> {
  const body = await response.json() as { error: { code: string } };
  return body.error.code;
}

Deno.test("accepts POST only and returns sanitized method errors", async () => {
  const response = await handleStripeWebhookRequest(request("", "GET"), dependencies());
  assert.equal(response.status, 405);
  assert.deepEqual(await response.json(), { ok: false, error: { code: "METHOD_NOT_ALLOWED" } });
});

Deno.test("rejects missing, oversized, and actually oversized bodies safely", async () => {
  const missing = await handleStripeWebhookRequest(request("{}"), dependencies());
  assert.equal(missing.status, 400);
  assert.equal(await errorCode(missing), "INVALID_SIGNATURE");

  const oversizedHeader = await handleStripeWebhookRequest(
    request("{}", "POST", { "content-length": String(MAX_BODY_BYTES + 1) }),
    dependencies(),
  );
  assert.equal(oversizedHeader.status, 413);

  const oversizedBody = "x".repeat(MAX_BODY_BYTES + 1);
  const oversizedActual = await handleStripeWebhookRequest(
    request(oversizedBody, "POST", { "stripe-signature": await signature(oversizedBody) }),
    dependencies(),
  );
  assert.equal(oversizedActual.status, 413);
});

Deno.test("verifies before parsing JSON", async () => {
  const malformed = "{not-json";
  const invalid = await handleStripeWebhookRequest(
    request(malformed, "POST", { "stripe-signature": "t=1704110400,v1=00" }),
    dependencies(),
  );
  assert.equal(invalid.status, 400);
  assert.equal(await errorCode(invalid), "INVALID_SIGNATURE");

  const valid = await handleStripeWebhookRequest(
    request(malformed, "POST", { "stripe-signature": await signature(malformed) }),
    dependencies(),
  );
  assert.equal(valid.status, 400);
  assert.equal(await errorCode(valid), "INVALID_JSON");
});

Deno.test("returns WEBHOOK_NOT_READY only after valid signature and JSON", async () => {
  const body = JSON.stringify({ id: "evt_test_123", type: "checkout.session.completed" });
  const response = await handleStripeWebhookRequest(
    request(body, "POST", { "stripe-signature": await signature(body) }),
    dependencies(),
  );
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ok: false, error: { code: "WEBHOOK_NOT_READY" } });
});

Deno.test("fails closed when the runtime webhook secret is missing", async () => {
  const secret = "whsec_missing_config_should_not_be_logged";
  const body = JSON.stringify({ id: "evt_test_123" });
  const response = await handleStripeWebhookRequest(
    request(body, "POST", { "stripe-signature": await signature(body, secret) }),
    dependencies(""),
  );
  assert.equal(response.status, 500);
  assert.equal(await errorCode(response), "WEBHOOK_CONFIGURATION_ERROR");
});

Deno.test("does not expose body, signature, or secret in responses", async () => {
  const body = '{"sensitive":"payload-value"}';
  const secret = "whsec_response_redaction_test";
  const header = await signature(body, secret);
  const response = await handleStripeWebhookRequest(
    request(body, "POST", { "stripe-signature": header }),
    dependencies(secret),
  );
  const text = await response.text();
  assert.equal(text.includes(body), false);
  assert.equal(text.includes(header), false);
  assert.equal(text.includes(secret), false);
});
