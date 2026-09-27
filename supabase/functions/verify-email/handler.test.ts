import assert from "node:assert/strict";
import { handleVerifyEmailRequest } from "./handler.ts";

const credential = "A".repeat(43);
function post(body: unknown) {
  return new Request("https://functions.example/verify-email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

Deno.test("POST consumes only a credential and never echoes it or caches the response", async () => {
  let calls = 0;
  let rpcInput: Record<string, unknown> | undefined;
  const response = await handleVerifyEmailRequest(post({ credential }), {
    supabaseAdmin: {
      async rpc(name, parameters) {
        calls++;
        assert.equal(name, "consume_email_verification_token");
        rpcInput = parameters;
        return { data: true, error: null };
      },
    },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(calls, 1);
  assert.ok(rpcInput);
  assert.equal(JSON.stringify(rpcInput).includes(credential), false);
});

Deno.test("GET and OPTIONS cannot consume a credential", async () => {
  let calls = 0;
  const dependencies = {
    supabaseAdmin: {
      async rpc() {
        calls++;
        return { data: true, error: null };
      },
    },
  };
  const get = await handleVerifyEmailRequest(
    new Request(
      "https://functions.example/verify-email?credential=" + credential,
    ),
    dependencies,
  );
  assert.equal(get.status, 405);
  assert.equal(
    (await handleVerifyEmailRequest(
      new Request("https://functions.example/verify-email", {
        method: "OPTIONS",
      }),
      dependencies,
    )).status,
    204,
  );
  assert.equal(calls, 0);
});

Deno.test("rejects malformed, oversized and unknown-field input without RPC calls", async () => {
  let calls = 0;
  const dependencies = {
    supabaseAdmin: {
      async rpc() {
        calls++;
        return { data: true, error: null };
      },
    },
  };
  for (
    const request of [
      post({ credential: "short" }),
      post({ credential, reservationId: "forged" }),
      post({ token: credential }),
    ]
  ) {
    const response = await handleVerifyEmailRequest(request, dependencies);
    assert.equal(response.status, 400);
  }
  const oversized = new Request("https://functions.example/verify-email", {
    method: "POST",
    body: JSON.stringify({ credential, extra: "x".repeat(400) }),
  });
  assert.equal(
    (await handleVerifyEmailRequest(oversized, dependencies)).status,
    400,
  );
  assert.equal(calls, 0);
});

Deno.test("replay, expiry, malformed database outcome and cross-customer failures stay generic", async () => {
  for (
    const rpc of [
      async () => ({
        data: null,
        error: { code: "P0001", message: "expired token detail" },
      }),
      async () => ({ data: false, error: null }), // replay/already consumed
      async () => ({ data: "true", error: null }),
      async () => {
        throw new Error("cross-customer detail");
      },
    ]
  ) {
    const response = await handleVerifyEmailRequest(post({ credential }), {
      supabaseAdmin: { rpc },
    });
    assert.equal(response.status, 400);
    const body = await response.text();
    assert.equal(
      body,
      '{"ok":false,"error":{"code":"INVALID_OR_EXPIRED_CREDENTIAL"}}',
    );
    assert.doesNotMatch(
      body,
      /credential|expired token detail|cross-customer detail/,
    );
  }
});
