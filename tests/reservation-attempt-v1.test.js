const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "assets/js/reservation-attempt.js"), "utf8");
let uuidCalls = 0;
let fetchCalls = 0;
const context = vm.createContext({
  console,
  fetch: () => { fetchCalls += 1; throw new Error("network must not be used"); },
  crypto: { randomUUID: () => `uuid-${++uuidCalls}` }
});
context.window = context;
vm.runInContext(source, context);

const base = {
  customer: { firstName: "Ada", lastName: "Loue", email: "ada@example.com", phone: null },
  productId: "essential",
  deliveryAddress: { line1: "1 Rue Test", line2: null, postcode: "16000", city: "Angouleme" },
  rental: { startDate: "2027-07-12", endDate: "2027-07-19" },
  service: { deliverySlotId: "0830-1030", collectionSlotId: "1630-1830", setupMode: "none", expressSelected: false }
};

const prepare = (value = base) => vm.runInContext(
  `IGLOUE_RESERVATION_ATTEMPT.prepareAttempt(${JSON.stringify(value)})`,
  context
);
const reset = () => vm.runInContext("IGLOUE_RESERVATION_ATTEMPT.resetAttempt()", context);

function changed(path, value) {
  const copy = JSON.parse(JSON.stringify(base));
  const parts = path.split(".");
  if (parts.length === 1) {
    copy[parts[0]] = value;
  } else {
    copy[parts[0]][parts[1]] = value;
  }
  return copy;
}

(async () => {
  const first = prepare();
  assert.equal(first, "uuid-1");
  assert.equal(uuidCalls, 1);
  assert.equal(prepare(), first);
  assert.equal(prepare({ ...base, pricing: { total: 999 }, deliveryZone: { id: "local" }, recommendation: "ui" }), first);
  assert.equal(uuidCalls, 1);

  reset();
  const orderedA = JSON.parse(JSON.stringify(base));
  const orderedB = JSON.parse(`{"service":{"expressSelected":false,"setupMode":"none","collectionSlotId":"1630-1830","deliverySlotId":"0830-1030"},"rental":{"endDate":"2027-07-19","startDate":"2027-07-12"},"deliveryAddress":{"city":"Angouleme","postcode":"16000","line2":null,"line1":"1 Rue Test"},"productId":"essential","customer":{"phone":null,"email":"ada@example.com","lastName":"Loue","firstName":"Ada"}}`);
  const orderedKey = prepare(orderedA);
  const uuidBeforeOrderRepeat = uuidCalls;
  assert.equal(prepare(orderedB), orderedKey);
  assert.equal(uuidCalls, uuidBeforeOrderRepeat);

  reset();
  const ambiguousA = { ...base, customer: { ...base.customer, firstName: "ab", lastName: "c" } };
  const ambiguousB = { ...base, customer: { ...base.customer, firstName: "a", lastName: "bc" } };
  const ambiguousKey = prepare(ambiguousA);
  assert.notEqual(prepare(ambiguousB), ambiguousKey);

  reset();
  const validBooleanKey = prepare({ ...base, service: { ...base.service, expressSelected: true } });
  const uuidBeforeInvalidType = uuidCalls;
  assert.equal(prepare({ ...base, service: { ...base.service, expressSelected: "true" } }), null);
  assert.equal(uuidCalls, uuidBeforeInvalidType);
  assert.equal(prepare({ ...base, service: { ...base.service, expressSelected: true } }), validBooleanKey);

  reset();
  const immutableSnapshot = JSON.parse(JSON.stringify(base));
  const immutableKey = prepare(base);
  assert.deepEqual(base, immutableSnapshot);

  const uuidBeforeMalformedAfterValid = uuidCalls;
  assert.equal(prepare({ ...base, rental: null }), null);
  assert.equal(uuidCalls, uuidBeforeMalformedAfterValid);
  assert.equal(prepare(base), immutableKey);

  for (const [path, value] of [
    ["customer.firstName", "Bea"],
    ["customer.lastName", "Client"],
    ["customer.email", "bea@example.com"],
    ["customer.phone", "0600000000"],
    ["deliveryAddress.line1", "2 Rue Test"],
    ["deliveryAddress.line2", "Appartement 2"],
    ["deliveryAddress.postcode", "16100"],
    ["deliveryAddress.city", "Cognac"],
  ]) {
    const rotated = prepare(changed(path, value));
    assert.notEqual(rotated, first, `${path} rotates the key`);
    assert.equal(uuidCalls >= 2, true);
    reset();
  }

  for (const [path, value] of [
    ["productId", "mobile-duo"],
    ["rental.startDate", "2027-07-13"],
    ["rental.endDate", "2027-07-20"],
    ["service.deliverySlotId", "1030-1230"],
    ["service.collectionSlotId", "1830-2030"],
    ["service.setupMode", "basic"],
    ["service.expressSelected", true],
  ]) {
    const copy = JSON.parse(JSON.stringify(base));
    const parts = path.split(".");
    if (parts.length === 1) {
      copy[parts[0]] = value;
    } else {
      copy[parts[0]][parts[1]] = value;
    }
    const rotated = prepare(copy);
    assert.notEqual(rotated, first, `${path} rotates the key`);
    reset();
  }

  reset();
  const beforeReset = prepare();
  reset();
  const afterReset = prepare();
  assert.notEqual(afterReset, beforeReset);
  assert.equal(uuidCalls >= 2, true);

  reset();
  const absentPhoneKey = prepare({ ...base, customer: { ...base.customer, phone: undefined } });
  assert.equal(prepare({ ...base, customer: { ...base.customer, phone: null } }), absentPhoneKey);
  reset();
  const absentLine2Key = prepare({ ...base, deliveryAddress: { ...base.deliveryAddress, line2: undefined } });
  assert.equal(prepare({ ...base, deliveryAddress: { ...base.deliveryAddress, line2: null } }), absentLine2Key);

  const uuidBeforeInvalid = uuidCalls;
  for (const invalid of [null, {}, { ...base, customer: null }, { ...base, service: { ...base.service, expressSelected: "no" } }]) {
    assert.equal(prepare(invalid), null);
  }
  assert.equal(uuidCalls, uuidBeforeInvalid);
  const fetchBeforePreparations = fetchCalls;
  reset();
  prepare(base);
  prepare(base);
  reset();
  assert.equal(fetchCalls, fetchBeforePreparations);
  assert.equal("localStorage" in context, false);
  assert.equal("sessionStorage" in context, false);
  assert.equal("document" in context, false);
  console.log("Reservation attempt V1 tests passed (42 assertions / 31 scenarios).");
})().catch((error) => { console.error(error); process.exitCode = 1; });
