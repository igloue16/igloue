import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import {
  handleStripeWebhookRequest,
  MAX_BODY_BYTES,
} from "./handler.ts";
import { payloadSha256 } from "./digest.ts";
import type { ReceiptRpcClient } from "./receipt.ts";

const SECRET = "whsec_test_secret";
const NOW = new Date("2027-01-15T08:00:00.000Z");
const TIMESTAMP = Math.floor(NOW.getTime() / 1000);
const EVENT = {
  id: "evt_test_123",
  type: "checkout.session.completed",
  created: TIMESTAMP,
  livemode: false,
};

async function signature(body: string, secret = SECRET, timestamp = TIMESTAMP) {
  const payload = `${timestamp}.${body}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return `t=${timestamp},v1=${hex}`;
}

function request(
  body: string,
  method = "POST",
  headers: Record<string, string> = {},
) {
  return new Request("https://example.test/stripe-webhook", {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : body,
  });
}

function eventBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({ ...EVENT, ...overrides });
}

function makeDependencies(options: {
  secret?: string;
  result?: unknown;
  error?: unknown | null;
  throwError?: boolean;
}) {
  const calls: Array<{ name: string; parameters: Record<string, unknown> }> = [];
  const receiptClient: ReceiptRpcClient = {
    async rpc(name, parameters) {
      calls.push({ name, parameters });
      if (options.throwError) throw new Error("database unavailable");
      return {
        data: options.result ?? [{ outcome: "recorded", event_id: "internal-event-id" }],
        error: options.error ?? null,
      };
    },
  };

  return {
    calls,
    dependencies: {
      secret: options.secret ?? SECRET,
      now: NOW,
      receiptClient,
    },
  };
}

function errorCode(response: Response) {
  return response.json().then((body) => ({
    error: typeof body.error === "string" ? body.error : body.error.code,
  }));
}

async function signedRequest(body: string, headers: Record<string, string> = {}) {
  return request(body, "POST", {
    "content-type": "application/json",
    "stripe-signature": await signature(body),
    ...headers,
  });
}

Deno.test("allows only POST and returns sanitized errors", async () => {
  const { dependencies } = makeDependencies({});
  const response = await handleStripeWebhookRequest(
    request("", "GET"),
    dependencies,
  );

  assertEquals(response.status, 405);
  assertEquals(await errorCode(response), { error: "METHOD_NOT_ALLOWED" });
});

Deno.test("rejects oversized bodies before signature verification", async () => {
  const { dependencies, calls } = makeDependencies({});
  const body = "x".repeat(MAX_BODY_BYTES + 1);
  const response = await handleStripeWebhookRequest(
    request(body, "POST", {
      "content-length": String(body.length),
      "stripe-signature": "invalid",
    }),
    dependencies,
  );

  assertEquals(response.status, 413);
  assertEquals(await errorCode(response), { error: "REQUEST_TOO_LARGE" });
  assertEquals(calls.length, 0);
});

Deno.test("invalid signatures never reach the receipt RPC", async () => {
  const { dependencies, calls } = makeDependencies({});
  const response = await handleStripeWebhookRequest(
    request(eventBody(), "POST", {
      "stripe-signature": "t=1800000000,v1=invalid",
    }),
    dependencies,
  );

  assertEquals(response.status, 400);
  assertEquals(await errorCode(response), { error: "INVALID_SIGNATURE" });
  assertEquals(calls.length, 0);
});

Deno.test("parses JSON only after signature verification", async () => {
  const { dependencies, calls } = makeDependencies({});
  const invalid = "{";

  const invalidSignature = await handleStripeWebhookRequest(
    request(invalid, "POST", { "stripe-signature": "invalid" }),
    dependencies,
  );
  assertEquals(invalidSignature.status, 400);
  assertEquals(await errorCode(invalidSignature), { error: "INVALID_SIGNATURE" });

  const validSignature = await handleStripeWebhookRequest(
    await signedRequest(invalid),
    dependencies,
  );
  assertEquals(validSignature.status, 400);
  assertEquals(await errorCode(validSignature), { error: "INVALID_JSON" });
  assertEquals(calls.length, 0);
});

Deno.test("reads the raw body once and sends its exact SHA-256 digest", async () => {
  const body = eventBody();
  const { dependencies, calls } = makeDependencies({});
  const signed = await signedRequest(body);
  let reads = 0;
  const arrayBuffer = signed.arrayBuffer.bind(signed);
  signed.arrayBuffer = () => {
    reads += 1;
    return arrayBuffer();
  };

  const response = await handleStripeWebhookRequest(signed, dependencies);
  const expectedDigest = await payloadSha256(new TextEncoder().encode(body));

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { received: true });
  assertEquals(reads, 1);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "receive_payment_provider_event");
  assertEquals(calls[0].parameters.p_payload_sha256, expectedDigest);
  assertEquals(String(calls[0].parameters.p_payload_sha256).length, 64);
  assertEquals(/^[0-9a-f]{64}$/.test(String(calls[0].parameters.p_payload_sha256)), true);
});

Deno.test("hashes exact raw bytes, not parsed JSON", async () => {
  const compact = eventBody();
  const pretty = JSON.stringify({ ...EVENT }, null, 2);
  const compactDeps = makeDependencies({});
  const prettyDeps = makeDependencies({});

  assertEquals(
    (await handleStripeWebhookRequest(await signedRequest(compact), compactDeps.dependencies)).status,
    200,
  );
  assertEquals(
    (await handleStripeWebhookRequest(await signedRequest(pretty), prettyDeps.dependencies)).status,
    200,
  );

  const compactDigest = compactDeps.calls[0].parameters.p_payload_sha256;
  const prettyDigest = prettyDeps.calls[0].parameters.p_payload_sha256;
  assertNotEquals(compactDigest, prettyDigest);
  assertNotEquals(compactDigest, await payloadSha256(new TextEncoder().encode(pretty)));
});

Deno.test("accepts a generic event envelope and forwards exact receipt arguments", async () => {
  const body = eventBody();
  const { dependencies, calls } = makeDependencies({});
  const response = await handleStripeWebhookRequest(
    await signedRequest(body),
    dependencies,
  );

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { received: true });
  assertEquals(calls[0].parameters, {
    p_provider: "stripe",
    p_provider_event_id: EVENT.id,
    p_event_type: EVENT.type,
    p_provider_event_created_at: "2027-01-15T08:00:00.000Z",
    p_livemode: false,
    p_payload_sha256: await payloadSha256(new TextEncoder().encode(body)),
  });
});

Deno.test("rejects malformed generic event envelopes", async () => {
  const invalidEvents = [
    { id: undefined },
    { id: " " },
    { id: "x".repeat(256) },
    { type: undefined },
    { type: "" },
    { type: "x".repeat(256) },
    { created: undefined },
    { created: "1800000000" },
    { created: 1.5 },
    { created: Number.MAX_SAFE_INTEGER },
    { livemode: undefined },
    { livemode: "false" },
  ];

  for (const invalid of invalidEvents) {
    const { dependencies, calls } = makeDependencies({});
    const response = await handleStripeWebhookRequest(
      await signedRequest(eventBody(invalid)),
      dependencies,
    );
    assertEquals(response.status, 400);
    assertEquals(await errorCode(response), { error: "INVALID_PAYLOAD" });
    assertEquals(calls.length, 0);
  }
});

Deno.test("maps recorded, duplicate, and conflict outcomes to the same 200 response", async () => {
  for (const outcome of ["recorded", "duplicate", "conflict"]) {
    const { dependencies } = makeDependencies({
      result: [{ outcome, event_id: "internal-event-id" }],
    });
    const response = await handleStripeWebhookRequest(
      await signedRequest(eventBody()),
      dependencies,
    );
    assertEquals(response.status, 200);
    assertEquals(await response.json(), { received: true });
  }
});

Deno.test("sanitizes receipt failures and malformed RPC results", async () => {
  const cases = [
    { throwError: true },
    { error: { message: "database failure" } },
    { result: [] },
    { result: [{ outcome: "unexpected" }] },
  ];

  for (const options of cases) {
    const { dependencies } = makeDependencies(options);
    const response = await handleStripeWebhookRequest(
      await signedRequest(eventBody()),
      dependencies,
    );
    assertEquals(response.status, 503);
    assertEquals(await errorCode(response), { error: "WEBHOOK_RECEIPT_UNAVAILABLE" });
  }

  const withoutReceipt = {
    ...makeDependencies({}).dependencies,
    receiptClient: undefined,
  };
  const response = await handleStripeWebhookRequest(
    await signedRequest(eventBody()),
    withoutReceipt,
  );
  assertEquals(response.status, 503);
  assertEquals(await errorCode(response), { error: "WEBHOOK_RECEIPT_UNAVAILABLE" });
});

Deno.test("fails closed when the webhook secret is missing", async () => {
  const { dependencies, calls } = makeDependencies({ secret: "" });
  const response = await handleStripeWebhookRequest(
    request(eventBody(), "POST", { "stripe-signature": "invalid" }),
    dependencies,
  );

  assertEquals(response.status, 500);
  assertEquals(await errorCode(response), { error: "WEBHOOK_CONFIGURATION_ERROR" });
  assertEquals(calls.length, 0);
});
