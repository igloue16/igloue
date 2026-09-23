import assert from "node:assert/strict";
import { sendZeptoMail } from "./zeptomail.ts";

const validInput = {
  sender: "commandes@igloue.fr",
  recipient: "client@example.com",
  subject: "Votre vérification IGLOUE",
  htmlBody: "<p>Confirmez votre adresse.</p>",
};

function fakeFetch(response: Response | Error = new Response(null, { status: 200 })) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    if (response instanceof Error) throw response;
    return response;
  };
  return { calls, fetchImpl };
}

Deno.test("sends an allowlisted request with the ZeptoMail payload", async () => {
  const fake = fakeFetch();
  const result = await sendZeptoMail(validInput, {
    fetchImpl: fake.fetchImpl,
    getToken: () => "test-token-never-real",
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].url, "https://api.zeptomail.eu/v1.1/email");
  assert.equal(fake.calls[0].init.method, "POST");
  assert.equal(fake.calls[0].init.headers && (fake.calls[0].init.headers as Record<string, string>).Authorization, "Zoho-enczapikey test-token-never-real");
  assert.deepEqual(JSON.parse(String(fake.calls[0].init.body)), {
    from: { address: "commandes@igloue.fr" },
    to: [{ email_address: { address: "client@example.com" } }],
    subject: "Votre vérification IGLOUE",
    htmlbody: "<p>Confirmez votre adresse.</p>",
  });
});

Deno.test("fails safely when the token is missing or blank", async () => {
  const fake = fakeFetch();
  assert.deepEqual(await sendZeptoMail(validInput, { fetchImpl: fake.fetchImpl, getToken: () => "   " }), { ok: false, code: "missing_configuration", retryable: true });
  assert.equal(fake.calls.length, 0);
});

Deno.test("rejects disallowed senders before any network request", async () => {
  const fake = fakeFetch();
  const result = await sendZeptoMail({ ...validInput, sender: "attacker@example.com" }, {
    fetchImpl: fake.fetchImpl,
    getToken: () => "test-token-never-real",
  });
  assert.deepEqual(result, { ok: false, code: "invalid_sender", retryable: false });
  assert.equal(fake.calls.length, 0);
});

Deno.test("classifies provider and network failures without exposing details", async () => {
  const provider = fakeFetch(new Response("provider secret body", { status: 503 }));
  assert.deepEqual(await sendZeptoMail(validInput, { fetchImpl: provider.fetchImpl, getToken: () => "test-token-never-real" }), { ok: false, code: "provider_unavailable", retryable: true });

  const network = fakeFetch(new Error("private network detail"));
  const result = await sendZeptoMail(validInput, { fetchImpl: network.fetchImpl, getToken: () => "test-token-never-real" });
  assert.deepEqual(result, { ok: false, code: "provider_unavailable", retryable: true });
  assert.equal(JSON.stringify(result).includes("private"), false);
  assert.equal(JSON.stringify(result).includes("provider secret body"), false);
});

Deno.test("aborts a request that exceeds the configured timeout", async () => {
  const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) =>
    await new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    });
  const result = await sendZeptoMail(validInput, {
    fetchImpl,
    getToken: () => "test-token-never-real",
    timeoutMs: 1,
  });
  assert.deepEqual(result, { ok: false, code: "provider_timeout", retryable: true });
});

Deno.test("rejects invalid content without contacting ZeptoMail", async () => {
  const fake = fakeFetch();
  assert.deepEqual(await sendZeptoMail({ ...validInput, recipient: "not-an-email" }, { fetchImpl: fake.fetchImpl, getToken: () => "test-token-never-real" }), { ok: false, code: "invalid_message", retryable: false });
  assert.deepEqual(await sendZeptoMail({ ...validInput, subject: "   " }, { fetchImpl: fake.fetchImpl, getToken: () => "test-token-never-real" }), { ok: false, code: "invalid_message", retryable: false });
  assert.equal(fake.calls.length, 0);
});

Deno.test("rejects a request with no HTML or text body without exposing data", async () => {
  const fake = fakeFetch();
  const result = await sendZeptoMail({
    sender: "commandes@igloue.fr",
    recipient: "client@example.com",
    subject: "Confirmation",
  }, {
    fetchImpl: fake.fetchImpl,
    getToken: () => "test-token-never-real",
  });
  assert.deepEqual(result, { ok: false, code: "invalid_message", retryable: false });
  assert.equal(fake.calls.length, 0);
  assert.equal(JSON.stringify(result).includes("test-token-never-real"), false);
  assert.equal(JSON.stringify(result).includes("Confirmation"), false);
  assert.equal(JSON.stringify(result).includes("client@example.com"), false);
});

Deno.test("classifies HTTP statuses without reading provider response bodies", async () => {
  const statuses = [
    [408, "provider_timeout", true],
    [429, "provider_rate_limited", true],
    [400, "delivery_rejected", false],
    [401, "delivery_rejected", false],
    [403, "delivery_rejected", false],
    [404, "delivery_rejected", false],
    [409, "delivery_rejected", false],
    [422, "delivery_rejected", false],
    [500, "provider_unavailable", true],
    [503, "provider_unavailable", true],
  ] as const;
  for (const [status, code, retryable] of statuses) {
    const fake = fakeFetch(new Response("private provider response", { status }));
    const result = await sendZeptoMail(validInput, {
      fetchImpl: fake.fetchImpl,
      getToken: () => "test-token-never-real",
    });
    assert.deepEqual(result, { ok: false, code, retryable });
    assert.equal(JSON.stringify(result).includes("private"), false);
  }
});

Deno.test("normalizes an unexpected token-provider exception safely", async () => {
  const fake = fakeFetch();
  const result = await sendZeptoMail(validInput, {
    fetchImpl: fake.fetchImpl,
    getToken: () => { throw new Error("private token-provider detail"); },
  });
  assert.deepEqual(result, { ok: false, code: "delivery_failed", retryable: true });
  assert.equal(fake.calls.length, 0);
  assert.equal(JSON.stringify(result).includes("private"), false);
});
