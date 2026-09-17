import assert from "node:assert/strict";
import test from "node:test";
import {
  type AvailabilityRpcClient,
  handleAvailabilityRequest,
} from "./handler.ts";

const NOW = new Date("2027-01-01T12:00:00Z");
const URL = "http://localhost/functions/v1/check-availability";

function validBody() {
  return {
    productId: "essential",
    rental: {
      startDate: "2027-07-12",
      endDate: "2027-07-19",
    },
    service: {
      deliverySlotId: "0830-1030",
      collectionSlotId: "1630-1830",
    },
  };
}

function request(
  body: unknown = validBody(),
  method = "POST",
) {
  return new Request(URL, {
    method,
    headers: { "content-type": "application/json" },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
}

function rpcClient(
  result: Awaited<ReturnType<AvailabilityRpcClient["rpc"]>>,
) {
  const calls: Array<{
    name: string;
    parameters: Record<string, unknown>;
  }> = [];

  return {
    calls,
    client: {
      async rpc(name: string, parameters: Record<string, unknown>) {
        calls.push({ name, parameters });
        return result;
      },
    } satisfies AvailabilityRpcClient,
  };
}

async function responseBody(response: Response) {
  return await response.json() as Record<string, unknown>;
}

test("returns a sanitized available response and calls only the availability RPC", async () => {
  const rpc = rpcClient({
    data: [{
      available: true,
      available_count: 3,
      machine_id: "private-machine",
    }],
    error: null,
  });
  const response = await handleAvailabilityRequest(request(), {
    supabaseAdmin: rpc.client,
    now: NOW,
  });
  const body = await responseBody(response);

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    ok: true,
    available: true,
    productId: "essential",
  });
  assert.equal(rpc.calls.length, 1);
  assert.equal(
    rpc.calls[0].name,
    "check_product_machine_availability",
  );
  assert.deepEqual(rpc.calls[0].parameters, {
    p_product_id: "essential",
    p_operational_start: "2027-07-12T06:30",
    p_operational_end: "2027-07-19T22:30",
  });
  assert.equal(JSON.stringify(body).includes("machine"), false);
  assert.equal(JSON.stringify(body).includes("allocation"), false);
  assert.equal(JSON.stringify(body).includes("reservation"), false);
  assert.equal(JSON.stringify(body).includes("customer"), false);
});

test("returns a sanitized unavailable response", async () => {
  const rpc = rpcClient({
    data: [{ available: false, available_count: 0 }],
    error: null,
  });
  const response = await handleAvailabilityRequest(request(), {
    supabaseAdmin: rpc.client,
    now: NOW,
  });

  assert.deepEqual(await responseBody(response), {
    ok: true,
    available: false,
    productId: "essential",
  });
});

test("rejects unknown products before calling the database", async () => {
  const rpc = rpcClient({ data: null, error: null });
  const body = validBody();
  body.productId = "unknown";
  const response = await handleAvailabilityRequest(request(body), {
    supabaseAdmin: rpc.client,
    now: NOW,
  });

  assert.equal(response.status, 400);
  assert.equal(
    ((await responseBody(response)).error as { code: string }).code,
    "INVALID_PRODUCT",
  );
  assert.equal(rpc.calls.length, 0);
});

test("maps an inactive database product to INVALID_PRODUCT", async () => {
  const rpc = rpcClient({
    data: null,
    error: { code: "P0001", message: "private database detail" },
  });
  const response = await handleAvailabilityRequest(request(), {
    supabaseAdmin: rpc.client,
    now: NOW,
  });
  const body = await responseBody(response);

  assert.equal(response.status, 400);
  assert.deepEqual(body, {
    ok: false,
    error: { code: "INVALID_PRODUCT", message: "Invalid product" },
  });
  assert.equal(JSON.stringify(body).includes("private"), false);
});

test("rejects missing and malformed fields", async () => {
  const rpc = rpcClient({ data: null, error: null });

  for (const body of [
    {},
    { ...validBody(), extra: true },
    { ...validBody(), rental: { startDate: 123, endDate: null } },
  ]) {
    const response = await handleAvailabilityRequest(request(body), {
      supabaseAdmin: rpc.client,
      now: NOW,
    });

    assert.equal(response.status, 400);
  }

  assert.equal(rpc.calls.length, 0);
});

test("rejects invalid, too-short, and past dates", async () => {
  const rpc = rpcClient({ data: null, error: null });
  const invalidRanges = [
    ["2027-02-30", "2027-03-05"],
    ["2027-07-12", "2027-07-13"],
    ["2027-01-01", "2027-01-05"],
  ];

  for (const [startDate, endDate] of invalidRanges) {
    const body = validBody();
    body.rental = { startDate, endDate };
    const response = await handleAvailabilityRequest(request(body), {
      supabaseAdmin: rpc.client,
      now: NOW,
    });

    assert.equal(response.status, 400);
    assert.equal(
      ((await responseBody(response)).error as { code: string }).code,
      "INVALID_DATES",
    );
  }

  assert.equal(rpc.calls.length, 0);
});

test("rejects invalid service windows", async () => {
  const rpc = rpcClient({ data: null, error: null });
  const body = validBody();
  body.service.deliverySlotId = "invalid";
  const response = await handleAvailabilityRequest(request(body), {
    supabaseAdmin: rpc.client,
    now: NOW,
  });

  assert.equal(response.status, 400);
  assert.equal(
    ((await responseBody(response)).error as { code: string }).code,
    "INVALID_SERVICE_WINDOW",
  );
  assert.equal(rpc.calls.length, 0);
});

test("supports OPTIONS and rejects unsupported methods with CORS headers", async () => {
  const rpc = rpcClient({ data: null, error: null });
  const options = await handleAvailabilityRequest(
    request(undefined, "OPTIONS"),
    { supabaseAdmin: rpc.client, now: NOW },
  );
  const get = await handleAvailabilityRequest(
    request(undefined, "GET"),
    { supabaseAdmin: rpc.client, now: NOW },
  );

  assert.equal(options.status, 204);
  assert.equal(options.headers.get("access-control-allow-origin"), "*");
  assert.equal(get.status, 405);
  assert.equal(get.headers.get("allow"), "POST, OPTIONS");
  assert.equal(
    ((await responseBody(get)).error as { code: string }).code,
    "METHOD_NOT_ALLOWED",
  );
  assert.equal(get.headers.get("access-control-allow-origin"), "*");
});

test("maps database failures and malformed RPC results to a sanitized 503", async () => {
  for (const result of [
    {
      data: null,
      error: { code: "XX000", message: "secret internal SQL failure" },
    },
    { data: [{ available_count: 1 }], error: null },
  ]) {
    const rpc = rpcClient(result);
    const response = await handleAvailabilityRequest(request(), {
      supabaseAdmin: rpc.client,
      now: NOW,
      logError() {},
    });
    const body = await responseBody(response);

    assert.equal(response.status, 503);
    assert.equal(
      (body.error as { code: string }).code,
      "AVAILABILITY_UNAVAILABLE",
    );
    assert.equal(JSON.stringify(body).includes("secret"), false);
  }
});

test("availability checking never invokes a mutating RPC", async () => {
  const rpc = rpcClient({
    data: [{ available: true, available_count: 1 }],
    error: null,
  });
  await handleAvailabilityRequest(request(), {
    supabaseAdmin: rpc.client,
    now: NOW,
  });

  assert.deepEqual(
    rpc.calls.map((call) => call.name),
    ["check_product_machine_availability"],
  );
});
