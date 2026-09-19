const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "assets/js/reservation-client.js"), "utf8");
assert.equal(/service_role|sb_secret|SUPABASE_SERVICE_ROLE_KEY/i.test(source), false);

const input = {
  idempotencyKey: " booking-key-exact ",
  customer: { firstName: "Ada", lastName: "Loue", email: "ada@example.com", phone: null },
  productId: "essential",
  deliveryAddress: { line1: "1 Rue Test", line2: null, postcode: "16000", city: "Angouleme" },
  rental: { startDate: "2027-07-12", endDate: "2027-07-19" },
  service: { deliverySlotId: "0830-1030", collectionSlotId: "1630-1830", setupMode: "none", expressSelected: false },
  pricing: { total: 999 },
  customerId: "secret-customer",
  organisationId: "secret-organisation"
};

const successPayload = {
  ok: true,
  reservation: { reference: "public-ref", status: "pending", holdExpiresAt: "2027-07-12T10:30:00Z", reservationId: "secret-reservation" },
  productId: "essential",
  rental: { startDate: "2027-07-12", endDate: "2027-07-19", nights: 7 },
  deliveryZone: { name: "Angoulême proche" },
  pricing: { currency: "EUR", rentalPrice: 59, deliveryFee: 29, setupPrice: 0, expressPrice: 0, totalAmount: 88, depositAmount: 250 },
  machineId: "secret-machine"
};

let requests = [];
let response = { ok: true, json: async () => successPayload };
const context = vm.createContext({ console });
context.window = context;
context.fetch = async (url, options) => {
  requests.push({ url, options });
  return response;
};
vm.runInContext('window.IGLOUE_SUPABASE_CONFIG = { projectUrl: "https://demo.supabase.co/", publishableKey: "sb_publishable_test" };', context);
vm.runInContext(source, context);

const create = (value = input) => vm.runInContext(`IGLOUE_RESERVATION_CLIENT.createReservation(${JSON.stringify(value)})`, context);

(async () => {
  requests = [];
  const result = await create();
  assert.equal(requests[0].url, "https://demo.supabase.co/functions/v1/create-reservation");
  assert.equal(requests[0].options.method, "POST");
  assert.equal(requests[0].options.headers["content-type"], "application/json");
  assert.equal(requests[0].options.headers.apikey, "sb_publishable_test");
  assert.equal(Object.prototype.hasOwnProperty.call(requests[0].options, "credentials"), false);
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    idempotencyKey: " booking-key-exact ",
    customer: input.customer,
    productId: "essential",
    deliveryAddress: input.deliveryAddress,
    rental: input.rental,
    service: input.service
  });
  assert.equal(JSON.stringify(JSON.parse(requests[0].options.body)).includes("pricing"), false);
  assert.equal(JSON.stringify(JSON.parse(requests[0].options.body)).includes("organisationId"), false);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    status: "success",
    reservation: { reference: "public-ref", status: "pending", holdExpiresAt: "2027-07-12T10:30:00Z" },
    productId: "essential",
    rental: { startDate: "2027-07-12", endDate: "2027-07-19", nights: 7 },
    deliveryZone: { name: "Angoulême proche" },
    pricing: { currency: "EUR", rentalPrice: 59, deliveryFee: 29, setupPrice: 0, expressPrice: 0, totalAmount: 88, depositAmount: 250 }
  });

  for (const code of ["INVALID_REQUEST", "INVALID_CUSTOMER", "INVALID_ADDRESS", "INVALID_PRODUCT", "INVALID_DATES", "INVALID_SERVICE_WINDOW", "INVALID_SETUP", "EXPRESS_NOT_ALLOWED", "NO_MACHINE_AVAILABLE", "RESERVATION_EXPIRED", "RESERVATION_UNAVAILABLE", "IDEMPOTENCY_CONFLICT", "TOO_MANY_ACTIVE_HOLDS", "METHOD_NOT_ALLOWED", "PAYLOAD_TOO_LARGE", "INTERNAL_ERROR"]) {
    response = { ok: false, json: async () => ({ ok: false, error: { code, message: "private database detail" } }) };
    const error = await create();
    assert.deepEqual(JSON.parse(JSON.stringify(error)), { status: "error", code });
  }

  response = { ok: true, json: async () => ({ ok: true, reservation: { reference: "r", status: "pending", holdExpiresAt: null }, productId: "essential" }) };
  assert.deepEqual(JSON.parse(JSON.stringify(await create())), { status: "error", code: "INTERNAL_ERROR" });

  for (const [path, whitespace] of [
    ["reservation.reference", ""],
    ["reservation.reference", "   "],
    ["reservation.status", ""],
    ["productId", "   "],
    ["rental.startDate", ""],
    ["rental.endDate", "   "],
    ["deliveryZone.name", ""],
    ["pricing.currency", "   "],
  ]) {
    const malformedSuccess = JSON.parse(JSON.stringify(successPayload));
    const segments = path.split(".");
    if (segments.length === 1) {
      malformedSuccess[segments[0]] = whitespace;
    } else {
      malformedSuccess[segments[0]][segments[1]] = whitespace;
    }
    response = { ok: true, json: async () => malformedSuccess };
    assert.deepEqual(
      JSON.parse(JSON.stringify(await create())),
      { status: "error", code: "INTERNAL_ERROR" },
      `rejects ${path} when empty or whitespace-only`
    );
  }

  response = { ok: true, json: async () => { throw new Error("bad json"); } };
  assert.deepEqual(JSON.parse(JSON.stringify(await create())), { status: "error", code: "INTERNAL_ERROR" });
  response = { ok: false, json: async () => ({ ok: false, error: { code: "UNKNOWN", message: "secret" } }) };
  assert.deepEqual(JSON.parse(JSON.stringify(await create())), { status: "error", code: "INTERNAL_ERROR" });
  response = { ok: false, json: async () => ({ ok: false, error: { code: "INTERNAL_ERROR", message: "secret" } }) };
  const sanitized = JSON.stringify(await create());
  assert.equal(sanitized.includes("secret"), false);
  context.fetch = async () => { throw new Error("offline"); };
  assert.deepEqual(JSON.parse(JSON.stringify(await create())), { status: "error", code: "INTERNAL_ERROR" });

  let fetchCount = requests.length;
  const missing = { ...input, customer: { ...input.customer, email: "" } };
  assert.deepEqual(JSON.parse(JSON.stringify(await create(missing))), { status: "error", code: "INVALID_REQUEST" });
  assert.equal(requests.length, fetchCount);
  const malformed = { ...input, service: { ...input.service, setupMode: "" } };
  assert.deepEqual(JSON.parse(JSON.stringify(await create(malformed))), { status: "error", code: "INVALID_REQUEST" });
  assert.equal(requests.length, fetchCount);
  console.log("Reservation client V1 tests passed (46 assertions / 30 scenarios).");
})().catch((error) => { console.error(error); process.exitCode = 1; });
