import assert from "node:assert/strict";
import { handleReservationRequest } from "./handler.ts";

Deno.env.set("PAYMENT_CAPABILITY_SECRET", "test-payment-secret");

const NOW = new Date("2027-01-01T12:00:00Z");

function body(overrides: Record<string, unknown> = {}) {
  return {
    idempotencyKey: "handler-test-1",
    customer: { firstName: "Ada", lastName: "Loue", email: "ada@example.com", phone: "06 12 34 56 78" },
    productId: "essential",
    deliveryAddress: { line1: "1 Rue Test", line2: null, postcode: "16000", city: "Angouleme" },
    rental: { startDate: "2027-07-12", endDate: "2027-07-19" },
    service: { deliverySlotId: "0830-1030", collectionSlotId: "1630-1830", setupMode: "none", expressSelected: false },
    ...overrides,
  };
}

function request(value: unknown, method = "POST") {
  return new Request("http://localhost/functions/v1/create-reservation", {
    method,
    headers: { "content-type": "application/json" },
    body: method === "POST" ? JSON.stringify(value) : undefined,
  });
}

function rpc(result: unknown, error: { code?: string; message?: string } | null = null) {
  const calls: Array<{ name: string; parameters: Record<string, unknown> }> = [];
  return {
    calls,
    client: { async rpc(name: string, parameters: Record<string, unknown>) {
      calls.push({ name, parameters });
      return { data: result, error };
    } } as const,
  };
}

type ErrorPayload = { error: { code: string } };

function hasErrorCode(value: unknown): value is ErrorPayload {
  if (typeof value !== "object" || value === null || !("error" in value)) return false;
  const error = value.error;
  return typeof error === "object" && error !== null &&
    "code" in error && typeof error.code === "string";
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

async function errorCode(response: Response): Promise<string> {
  const value: unknown = await response.json();
  assert.ok(hasErrorCode(value));
  return value.error.code;
}

Deno.test("returns an allowlisted success with authoritative state and pricing", async () => {
  const mock = rpc([{ reservation_id: "res-1", reservation_status: "pending", hold_expires_at: "2027-07-12T10:30:00Z", payment_capability_matched: true, created_new: true, customer_id: "customer-secret", allocation_id: "allocation-secret", machine_id: "machine-secret", delivery_job_id: "job-secret", collection_job_id: "job-secret-2" }]);
  const response = await handleReservationRequest(request(body()), { supabaseAdmin: mock.client, now: NOW });
  const result = await json(response);
  assert.equal(response.status, 201);
  const paymentCapability = result.paymentCapability;
  delete result.paymentCapability;
  assert.equal(typeof paymentCapability, "string");
  assert.match(paymentCapability as string, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(mock.calls[0].name, "create_reservation_with_payment_capability");
  assert.match(String(mock.calls[0].parameters.p_capability_hash), /^\\x[0-9a-f]{64}$/);
  assert.equal(String(mock.calls[0].parameters.p_capability_hash).includes(paymentCapability as string), false);
  assert.deepEqual(result, {
    ok: true,
    reservation: { reference: "res-1", status: "pending", holdExpiresAt: "2027-07-12T10:30:00.000Z" },
    productId: "essential",
    rental: { startDate: "2027-07-12", endDate: "2027-07-19", nights: 7 },
    deliveryZone: { name: "Angoulême proche" },
    pricing: { currency: "EUR", rentalPrice: 59, deliveryFee: 29, setupPrice: 0, expressPrice: 0, totalAmount: 88, depositAmount: 250 },
  });
  assert.equal(JSON.stringify(result).includes("customer"), false);
  assert.equal(JSON.stringify(result).includes("machine"), false);
  assert.equal(JSON.stringify(result).includes("allocation"), false);
  assert.equal(JSON.stringify(result).includes("serviceJobs"), false);
  assert.equal(JSON.stringify(result).includes("operational"), false);
  assert.equal(JSON.stringify(result).includes("created_new"), false);
});

Deno.test("accepts a one-unit basket and persists normalized context parameters", async () => {
  const mock = rpc([{ reservation_id: "res-1", reservation_status: "pending", hold_expires_at: "2027-07-12T10:30:00Z", payment_capability_matched: true, created_new: true }]);
  const response = await handleReservationRequest(request(body({
    productId: undefined,
    items: [{ productId: "essential", quantity: 1 }],
    recipient: { mode: "other", firstName: "Marie", lastName: "Test", phone: "0612345678" },
    billing: { mode: "business", billingName: "Marie Test", companyName: "Acme", billingEmail: "billing@example.com", billingAddress: { line1: "2 Rue B", postcode: "75001", city: "Paris", country: "FR" } },
  })), { supabaseAdmin: mock.client, now: NOW });
  assert.equal(response.status, 201);
  assert.equal(mock.calls[0].parameters.p_recipient_first_name, "Marie");
  assert.equal(mock.calls[0].parameters.p_billing_mode, "business");
  assert.equal(mock.calls[0].parameters.p_unit_rental_price, 59);
  assert.equal(mock.calls[0].parameters.p_line_total, 59);
});

Deno.test("rejects multi-unit runtime creation until allocation support exists", async () => {
  const mock = rpc(null);
  const response = await handleReservationRequest(request(body({
    productId: undefined,
    items: [{ productId: "essential", quantity: 2 }],
  })), { supabaseAdmin: mock.client, now: NOW });
  assert.equal(response.status, 409);
  assert.equal(await errorCode(response), "MULTI_ITEM_NOT_YET_AVAILABLE");
  assert.equal(mock.calls.length, 0);
});

Deno.test("supports CORS OPTIONS and rejects unsupported methods", async () => {
  const mock = rpc(null);
  const options = await handleReservationRequest(request(undefined, "OPTIONS"), { supabaseAdmin: mock.client });
  const get = await handleReservationRequest(request(undefined, "GET"), { supabaseAdmin: mock.client });
  assert.equal(options.status, 204);
  assert.equal(options.headers.get("access-control-allow-origin"), "*");
  assert.equal(get.status, 405);
  assert.equal(await errorCode(get), "METHOD_NOT_ALLOWED");
});

Deno.test("rejects malformed, unknown, and oversized requests", async () => {
  const mock = rpc(null);
  const malformed = await handleReservationRequest(new Request("http://localhost", { method: "POST", body: "{" }), { supabaseAdmin: mock.client });
  assert.equal(await errorCode(malformed), "INVALID_REQUEST");
  const unknown = await handleReservationRequest(request({ ...body(), extra: true }), { supabaseAdmin: mock.client });
  assert.equal(await errorCode(unknown), "INVALID_REQUEST");
  const oversized = await handleReservationRequest(request({ ...body(), customer: { ...body().customer, firstName: "x".repeat(17000) } }), { supabaseAdmin: mock.client });
  assert.equal(oversized.status, 413);
  assert.equal(await errorCode(oversized), "PAYLOAD_TOO_LARGE");
});

Deno.test("maps stock conflicts and expired retries without false hold claims", async () => {
  const stock = rpc(null, { code: "P0001", message: "No eligible machine available" });
  const stockResponse = await handleReservationRequest(request(body()), { supabaseAdmin: stock.client, now: NOW });
  assert.equal(stockResponse.status, 409);
  assert.equal(await errorCode(stockResponse), "NO_MACHINE_AVAILABLE");
  const conflict = rpc(null, { code: "23P01", message: "private detail" });
  const conflictResponse = await handleReservationRequest(request(body()), { supabaseAdmin: conflict.client, now: NOW });
  assert.equal(conflictResponse.status, 409);
  assert.equal(await errorCode(conflictResponse), "NO_MACHINE_AVAILABLE");
  const expired = rpc([{ reservation_id: "res-expired", reservation_status: "cancelled", hold_expires_at: null }]);
  const expiredResponse = await handleReservationRequest(request(body()), { supabaseAdmin: expired.client, now: NOW });
  assert.equal(expiredResponse.status, 409);
  assert.equal(await errorCode(expiredResponse), "RESERVATION_EXPIRED");
});

Deno.test("fails closed for missing or elapsed pending holds", async () => {
  for (const hold_expires_at of [null, "2026-12-31T00:00:00Z"]) {
    const mock = rpc([{ reservation_id: "res-pending", reservation_status: "pending", hold_expires_at, payment_capability_matched: true }]);
    const response = await handleReservationRequest(request(body()), { supabaseAdmin: mock.client, now: NOW });
    assert.equal(response.status, hold_expires_at === null ? 503 : 409);
    assert.equal(await errorCode(response), hold_expires_at === null ? "RESERVATION_UNAVAILABLE" : "RESERVATION_EXPIRED");
  }
});

Deno.test("maps a dedicated idempotency conflict and thrown RPC error", async () => {
  const mismatch = rpc(null, { code: "P0003", message: "private idempotency detail" });
  const mismatchResponse = await handleReservationRequest(request(body()), { supabaseAdmin: mismatch.client, now: NOW });
  assert.equal(mismatchResponse.status, 409);
  assert.deepEqual(await json(mismatchResponse), { ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });

  const thrown = {
    async rpc() {
      throw new Error("private exception detail");
    },
  };
  const thrownResponse = await handleReservationRequest(request(body()), { supabaseAdmin: thrown, now: NOW });
  assert.equal(thrownResponse.status, 500);
  assert.equal(thrownResponse.headers.get("access-control-allow-origin"), "*");
  assert.deepEqual(await json(thrownResponse), { ok: false, error: { code: "INTERNAL_ERROR" } });
});

Deno.test("maps only the dedicated contact hold limit and keeps public errors sanitized", async () => {
  const limited = rpc(null, { code: "P1001", message: "Too many active holds" });
  const limitedResponse = await handleReservationRequest(request(body()), { supabaseAdmin: limited.client, now: NOW });
  const limitedBody = await json(limitedResponse);
  assert.equal(limitedResponse.status, 409);
  assert.equal(limitedResponse.headers.get("access-control-allow-origin"), "*");
  assert.deepEqual(limitedBody, { ok: false, error: { code: "TOO_MANY_ACTIVE_HOLDS" } });
  const serialized = JSON.stringify(limitedBody);
  for (const secret of ["P1001", "Too many active holds", "2", "ada@example.com", "customer", "reservation", "allocation"]) {
    assert.equal(serialized.includes(secret), false, `public response does not expose ${secret}`);
  }

  const unrelated = rpc(null, { code: "P1001", message: "unrelated database failure" });
  const unrelatedResponse = await handleReservationRequest(request(body()), { supabaseAdmin: unrelated.client, now: NOW });
  assert.equal(unrelatedResponse.status, 500);
  assert.deepEqual(await json(unrelatedResponse), { ok: false, error: { code: "INTERNAL_ERROR" } });
});

Deno.test("maps confirmed retries and unexpected database failures safely", async () => {
  const confirmed = rpc([{ reservation_id: "res-confirmed", reservation_status: "confirmed", hold_expires_at: "2027-07-12T10:30:00Z" }]);
  const confirmedResponse = await handleReservationRequest(request(body()), { supabaseAdmin: confirmed.client, now: NOW });
  const confirmedBody = await json(confirmedResponse);
  assert.equal(confirmedResponse.status, 201);
  const reservation = confirmedBody.reservation as Record<string, unknown>;
  assert.equal(reservation.status, "confirmed");
  assert.equal(reservation.holdExpiresAt, null);

  const failed = rpc(null, { code: "XX000", message: "private SQL detail" });
  const failedResponse = await handleReservationRequest(request(body()), { supabaseAdmin: failed.client, now: NOW });
  assert.equal(failedResponse.status, 500);
  assert.deepEqual(await json(failedResponse), { ok: false, error: { code: "INTERNAL_ERROR" } });
});

Deno.test("rejects nested unknown fields and invalid email before the RPC", async () => {
  const mock = rpc(null);
  const nested = await handleReservationRequest(request({ ...body(), customer: { ...body().customer, secret: true } }), { supabaseAdmin: mock.client });
  assert.equal(await errorCode(nested), "INVALID_CUSTOMER");
  const address = await handleReservationRequest(request({ ...body(), deliveryAddress: { ...body().deliveryAddress, secret: true } }), { supabaseAdmin: mock.client });
  assert.equal(await errorCode(address), "INVALID_ADDRESS");
  const rental = await handleReservationRequest(request({ ...body(), rental: { ...body().rental, secret: true } }), { supabaseAdmin: mock.client });
  assert.equal(await errorCode(rental), "INVALID_DATES");
  const service = await handleReservationRequest(request({ ...body(), service: { ...body().service, secret: true } }), { supabaseAdmin: mock.client });
  assert.equal(await errorCode(service), "INVALID_REQUEST");
  const invalidEmail = await handleReservationRequest(request({ ...body(), customer: { ...body().customer, email: "not-an-email" } }), { supabaseAdmin: mock.client });
  assert.equal(await errorCode(invalidEmail), "INVALID_CUSTOMER");
  assert.equal(mock.calls.length, 0);
});

Deno.test("uses created_new as the sole verification orchestration gate", async () => {
  const calls: string[] = [];
  let replay = false;
  let lookups = 0;
  let deliveries = 0;
  const client = {
    async rpc(name: string) {
      calls.push(name);
      if (name === "create_reservation_with_payment_capability") {
        return {
          data: [{
            reservation_id: "00000000-0000-4000-8000-000000000001",
            customer_id: "00000000-0000-4000-8000-000000000002",
            reservation_status: "pending",
            hold_expires_at: "2027-07-12T10:30:00Z",
            payment_capability_matched: true,
            created_new: !replay,
          }],
          error: null,
        };
      }
      return {
        data: [{
          token_id: "00000000-0000-4000-8000-000000000003",
          reservation_id: "00000000-0000-4000-8000-000000000001",
          customer_id: "00000000-0000-4000-8000-000000000002",
          organisation_id: "00000000-0000-4000-8000-000000000004",
          expires_at: "2027-07-12T10:30:00Z",
        }],
        error: null,
      };
    },
  };
  const dependencies = {
    supabaseAdmin: client,
    now: NOW,
    publicBaseUrl: "https://igloue.example",
    lookupCustomerEmail: async () => {
      lookups += 1;
      return "customer@example.com";
    },
    verificationDelivery: {
      async sendVerificationEmail(input: { destination: string; verificationUrl: string; expiresAt: string }) {
        deliveries += 1;
        assert.equal(input.destination, "customer@example.com");
        assert.match(input.verificationUrl, /#credential=/);
        return { status: "delivered" as const };
      },
    },
  };

  const first = await handleReservationRequest(request(body()), dependencies);
  assert.equal(first.status, 201);
  assert.equal(lookups, 1);
  assert.equal(deliveries, 1);
  assert.equal(calls.filter((name) => name === "issue_email_verification_token").length, 1);
  assert.equal((await json(first)).created_new, undefined);

  replay = true;
  const second = await handleReservationRequest(request(body()), dependencies);
  assert.equal(second.status, 201);
  assert.equal(lookups, 1);
  assert.equal(deliveries, 1);
  assert.equal(calls.filter((name) => name === "issue_email_verification_token").length, 1);
});

Deno.test("rotated-secret replay fails closed without returning the new capability", async () => {
  let storedHash = "";
  const client = {
    async rpc(_name: string, parameters: Record<string, unknown>) {
      const hash = String(parameters.p_capability_hash);
      if (!storedHash) storedHash = hash;
      return {
        data: [{
          reservation_id: "00000000-0000-4000-8000-000000000501",
          reservation_status: "pending",
          hold_expires_at: "2027-07-12T10:30:00Z",
          payment_capability_matched: hash === storedHash,
          created_new: false,
        }],
        error: null,
      };
    },
  };

  const first = await handleReservationRequest(request(body()), {
    supabaseAdmin: client,
    now: NOW,
    paymentCapabilitySecret: "rotation-secret-a",
  });
  assert.equal(first.status, 201);
  const firstBody = await json(first);
  const firstCapability = firstBody.paymentCapability;
  assert.equal(typeof firstCapability, "string");

  const replay = await handleReservationRequest(request(body()), {
    supabaseAdmin: client,
    now: NOW,
    paymentCapabilitySecret: "rotation-secret-b",
  });
  assert.equal(replay.status, 409);
  const replayBody = await json(replay);
  assert.deepEqual(replayBody, { ok: false, error: { code: "PAYMENT_CAPABILITY_UNAVAILABLE" } });
  assert.equal(JSON.stringify(replayBody).includes(storedHash), false);
  assert.equal(JSON.stringify(replayBody).includes("rotation-secret-b"), false);
  assert.equal(JSON.stringify(replayBody).includes(String(firstCapability)), false);
});
