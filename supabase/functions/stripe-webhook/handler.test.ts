import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import { handleStripeWebhookRequest, MAX_BODY_BYTES } from "./handler.ts";
import { payloadSha256 } from "./digest.ts";
import type { ReceiptRpcClient } from "./receipt.ts";
import type { CheckoutSessionParseResult } from "./checkout-session.ts";

const SECRET = "whsec_test_secret";
const NOW = new Date("2027-01-15T08:00:00.000Z");
const TIMESTAMP = Math.floor(NOW.getTime() / 1000);
const EVENT_ID = "evt_test_123";
const SESSION_ID = "cs_test_123";
const PAYMENT_ATTEMPT_ID = "00000000-0000-4000-8000-000000000201";
const RESERVATION_ID = "00000000-0000-4000-8000-000000000202";

async function signature(body: string, secret = SECRET, timestamp = TIMESTAMP) {
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
    new TextEncoder().encode(`${timestamp}.${body}`),
  );
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return `t=${timestamp},v1=${hex}`;
}

function request(body: string, method = "POST", headers: Record<string, string> = {}) {
  return new Request("https://example.test/stripe-webhook", {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : body,
  });
}

function checkoutEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: EVENT_ID,
    type: "checkout.session.completed",
    created: TIMESTAMP,
    livemode: false,
    data: {
      object: {
        object: "checkout.session",
        id: SESSION_ID,
        mode: "payment",
        status: "complete",
        payment_status: "paid",
        amount_total: 7500,
        currency: "eur",
        payment_intent: "pi_test_123",
        client_reference_id: PAYMENT_ATTEMPT_ID,
        metadata: {
          payment_attempt_id: PAYMENT_ATTEMPT_ID,
          reservation_id: RESERVATION_ID,
        },
      },
    },
    ...overrides,
  };
}

function genericEvent(type = "checkout.session.completed") {
  return JSON.stringify({
    id: EVENT_ID,
    type,
    created: TIMESTAMP,
    livemode: false,
  });
}

function body(value: unknown) {
  return JSON.stringify(value);
}

function makeDependencies(options: {
  expectedLivemode?: string;
  receiptOutcome?: "recorded" | "duplicate" | "conflict";
  matchOutcome?: "matched" | "already_matched" | "unknown_provider_event" |
    "unknown_checkout_session" | "validation_failed" | "conflict";
  receiptData?: unknown;
  matcherData?: unknown;
  receiptError?: unknown | null;
  matcherError?: unknown | null;
  throwReceipt?: boolean;
  throwMatcher?: boolean;
  parser?: (event: unknown) => CheckoutSessionParseResult;
} = {}) {
  const calls: Array<{ name: string; parameters: Record<string, unknown> }> = [];
  const receiptClient: ReceiptRpcClient = {
    async rpc(name, parameters) {
      calls.push({ name, parameters });
      if (name === "receive_payment_provider_event") {
        if (options.throwReceipt) throw new Error("receipt unavailable");
        return {
          data: options.receiptData ?? [{
            outcome: options.receiptOutcome ?? "recorded",
            event_id: "00000000-0000-4000-8000-000000000301",
          }],
          error: options.receiptError ?? null,
        };
      }
      if (options.throwMatcher) throw new Error("matcher unavailable");
      return {
        data: options.matcherData ?? [{ outcome: options.matchOutcome ?? "matched" }],
        error: options.matcherError ?? null,
      };
    },
  };

  return {
    calls,
    dependencies: {
      secret: SECRET,
      now: NOW,
      receiptClient,
      expectedLivemode: "expectedLivemode" in options ? options.expectedLivemode : "false",
      parser: options.parser,
    },
  };
}

function errorCode(response: Response) {
  return response.json().then((value) => value.error.code);
}

async function signedRequest(value: unknown, headers: Record<string, string> = {}) {
  const raw = typeof value === "string" ? value : body(value);
  return request(raw, "POST", {
    "content-type": "application/json",
    "stripe-signature": await signature(raw),
    ...headers,
  });
}

Deno.test("invalid signatures never record, parse, or match", async () => {
  let parsed = 0;
  const { dependencies, calls } = makeDependencies({
    parser: () => {
      parsed += 1;
      return { ok: false, code: "invalid_checkout_session" };
    },
  });
  const response = await handleStripeWebhookRequest(
    request(genericEvent(), "POST", { "stripe-signature": "invalid" }),
    dependencies,
  );

  assertEquals(response.status, 400);
  assertEquals(calls.length, 0);
  assertEquals(parsed, 0);
});

Deno.test("oversized bodies never reach business processing", async () => {
  const { dependencies, calls } = makeDependencies({});
  const oversized = "x".repeat(MAX_BODY_BYTES + 1);
  const response = await handleStripeWebhookRequest(
    request(oversized, "POST", {
      "content-length": String(oversized.length),
      "stripe-signature": "invalid",
    }),
    dependencies,
  );

  assertEquals(response.status, 413);
  assertEquals(calls.length, 0);
});

Deno.test("malformed generic events never record or match", async () => {
  const { dependencies, calls } = makeDependencies({});
  const response = await handleStripeWebhookRequest(
    await signedRequest({ nope: true }),
    dependencies,
  );

  assertEquals(response.status, 400);
  assertEquals(calls.length, 0);
});

Deno.test("receipt succeeds before parser and matcher, with exact matcher arguments", async () => {
  const calls: string[] = [];
  const normalized: CheckoutSessionParseResult = {
    ok: true,
    value: {
      eventId: EVENT_ID,
      eventType: "checkout.session.completed",
      livemode: false,
      checkoutSessionId: SESSION_ID,
      mode: "payment",
      status: "complete",
      paymentStatus: "paid",
      amountTotal: 7500,
      currency: "eur",
      paymentIntentId: "pi_test_123",
      clientReferenceId: PAYMENT_ATTEMPT_ID,
      metadata: { paymentAttemptId: PAYMENT_ATTEMPT_ID, reservationId: RESERVATION_ID },
    },
  };
  const base = makeDependencies({});
  const dependencies = {
    ...base.dependencies,
    parser: () => {
      calls.push("parser");
      return normalized;
    },
  };
  const originalRpc = base.dependencies.receiptClient!.rpc.bind(base.dependencies.receiptClient);
  base.dependencies.receiptClient!.rpc = async (name, parameters) => {
    calls.push(name);
    return originalRpc(name, parameters);
  };

  const response = await handleStripeWebhookRequest(
    await signedRequest(checkoutEvent()),
    dependencies,
  );

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { received: true });
  assertEquals(calls, ["receive_payment_provider_event", "parser", "match_payment_provider_event"]);
  assertEquals(base.calls[1].parameters, {
    p_provider_event_id: EVENT_ID,
    p_checkout_session_id: SESSION_ID,
    p_amount_total: 7500,
    p_currency: "eur",
    p_mode: "payment",
    p_checkout_status: "complete",
    p_payment_status: "paid",
    p_payment_intent_id: "pi_test_123",
    p_client_reference_id: PAYMENT_ATTEMPT_ID,
    p_metadata_payment_attempt_id: PAYMENT_ATTEMPT_ID,
    p_metadata_reservation_id: RESERVATION_ID,
    p_expected_livemode: false,
  });
  assertNotEquals(base.calls[1].parameters.p_provider_event_id, "00000000-0000-4000-8000-000000000301");
});

Deno.test("recorded and duplicate receipts both continue to matching", async () => {
  for (const receiptOutcome of ["recorded", "duplicate"] as const) {
    const { dependencies, calls } = makeDependencies({ receiptOutcome });
    const response = await handleStripeWebhookRequest(
      await signedRequest(checkoutEvent()),
      dependencies,
    );
    assertEquals(response.status, 200);
    assertEquals(calls.map((call) => call.name), [
      "receive_payment_provider_event",
      "match_payment_provider_event",
    ]);
  }
});

Deno.test("receipt conflict is acknowledged without parser or matcher", async () => {
  let parsed = 0;
  const { dependencies, calls } = makeDependencies({
    receiptOutcome: "conflict",
    parser: () => {
      parsed += 1;
      return { ok: false, code: "invalid_checkout_session" };
    },
  });
  const response = await handleStripeWebhookRequest(
    await signedRequest(checkoutEvent()),
    dependencies,
  );

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { received: true });
  assertEquals(parsed, 0);
  assertEquals(calls.length, 1);
});

Deno.test("receipt failures return sanitized 503 and never match", async () => {
  for (const options of [
    { throwReceipt: true },
    { receiptError: { message: "database failure" } },
    { receiptData: [] },
  ]) {
    const { dependencies, calls } = makeDependencies(options);
    const response = await handleStripeWebhookRequest(
      await signedRequest(checkoutEvent()),
      dependencies,
    );
    assertEquals(response.status, 503);
    assertEquals(await errorCode(response), "WEBHOOK_RECEIPT_UNAVAILABLE");
    assertEquals(calls.length, 1);
  }
});

Deno.test("unsupported authentic events are durably acknowledged, not matched", async () => {
  const { dependencies, calls } = makeDependencies({ expectedLivemode: undefined });
  const response = await handleStripeWebhookRequest(
    await signedRequest(genericEvent("checkout.session.expired")),
    dependencies,
  );

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { received: true });
  assertEquals(calls.map((call) => call.name), ["receive_payment_provider_event"]);
});

Deno.test("parser failures are sanitized durable acknowledgements", async () => {
  const { dependencies, calls } = makeDependencies({
    parser: () => ({ ok: false, code: "invalid_payment_intent" }),
  });
  const response = await handleStripeWebhookRequest(
    await signedRequest(checkoutEvent()),
    dependencies,
  );

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { received: true });
  assertEquals(calls.length, 1);
});

Deno.test("expected livemode accepts only true and false", async () => {
  for (const expected of ["true", "false"] as const) {
    const { dependencies, calls } = makeDependencies({ expectedLivemode: expected });
    const response = await handleStripeWebhookRequest(
      await signedRequest(checkoutEvent()),
      dependencies,
    );
    assertEquals(response.status, 200);
    assertEquals(calls[1].parameters.p_expected_livemode, expected === "true");
  }

  for (const expectedLivemode of [undefined, "TRUE", "1", ""] as const) {
    const { dependencies, calls } = makeDependencies({ expectedLivemode });
    const response = await handleStripeWebhookRequest(
      await signedRequest(checkoutEvent()),
      dependencies,
    );
    assertEquals(response.status, 503);
    assertEquals(await errorCode(response), "WEBHOOK_PROCESSING_UNAVAILABLE");
    assertEquals(calls.length, 1);
  }
});

Deno.test("all deterministic matcher outcomes return the same sanitized 200", async () => {
  for (const matchOutcome of [
    "matched",
    "already_matched",
    "unknown_checkout_session",
    "validation_failed",
    "conflict",
  ] as const) {
    const { dependencies } = makeDependencies({ matchOutcome });
    const response = await handleStripeWebhookRequest(
      await signedRequest(checkoutEvent()),
      dependencies,
    );
    assertEquals(response.status, 200);
    assertEquals(await response.json(), { received: true });
  }
});

Deno.test("unknown provider event and transient matcher failures return sanitized 503", async () => {
  for (const options of [
    { matchOutcome: "unknown_provider_event" as const },
    { throwMatcher: true },
    { matcherError: { message: "database failure" } },
    { matcherData: [] },
  ]) {
    const { dependencies } = makeDependencies(options);
    const response = await handleStripeWebhookRequest(
      await signedRequest(checkoutEvent()),
      dependencies,
    );
    assertEquals(response.status, 503);
    assertEquals(await errorCode(response), "WEBHOOK_PROCESSING_UNAVAILABLE");
  }
});

Deno.test("responses never expose internal payment data", async () => {
  const { dependencies } = makeDependencies({ matchOutcome: "validation_failed" });
  const response = await handleStripeWebhookRequest(
    await signedRequest(checkoutEvent()),
    dependencies,
  );
  const successText = await response.text();
  assertEquals(successText, '{"received":true}');
  assertNotEquals(successText.includes(PAYMENT_ATTEMPT_ID), true);
  assertNotEquals(successText.includes(RESERVATION_ID), true);
  assertNotEquals(successText.includes("pi_test_123"), true);
});
