import assert from "node:assert/strict";
import {
  validateCustomer,
  validateRentalDates,
  validateServiceChoices,
} from "./validation.ts";
import { buildServerOperationalPeriod } from "./operations.ts";

const NOW = new Date("2027-01-01T12:00:00Z");

Deno.test("customer phone is required and normalized to a French national number", () => {
  const base = { firstName: "Ada", lastName: "Loue", email: "ada@example.com" };
  assert.equal(validateCustomer({ ...base, phone: "   " }).ok, false);
  assert.equal(validateCustomer({ ...base, phone: "06 12 34 56 78" }).ok, true);
  const international = validateCustomer({ ...base, phone: "+33 6 12 34 56 78" });
  assert.equal(international.ok, true);
  if (international.ok) assert.equal(international.customer.phone, "0612345678");
});

function service(setupMode: string, expressSelected = false) {
  return {
    deliverySlotId: "0830-1030",
    collectionSlotId: "1630-1830",
    setupMode,
    expressSelected,
  };
}

Deno.test("shared reservation date rules use tomorrow as first bookable date", () => {
  assert.deepEqual(
    validateRentalDates({ startDate: "2027-01-02", endDate: "2027-01-05" }, NOW),
    {
      ok: true,
      rental: {
        startDate: "2027-01-02",
        endDate: "2027-01-05",
        nights: 3,
      },
    },
  );
  assert.equal(
    validateRentalDates({ startDate: "2027-07-12", endDate: "2027-07-19" }, NOW).ok,
    true,
  );
  assert.equal(
    validateRentalDates({ startDate: "2027-01-01", endDate: "2027-01-04" }, NOW).ok,
    false,
  );
  assert.equal(
    validateRentalDates({ startDate: "2026-12-31", endDate: "2027-01-04" }, NOW).ok,
    false,
  );
  assert.equal(
    validateRentalDates({ startDate: "2027-02-30", endDate: "2027-03-05" }, NOW).ok,
    false,
  );
  assert.equal(
    validateRentalDates({ startDate: "2027-01-02", endDate: "2027-01-04" }, NOW).ok,
    false,
  );
  assert.equal(
    validateRentalDates({ startDate: "02-01-2027", endDate: "2027-01-05" }, NOW).ok,
    false,
  );
});

Deno.test("server setup compatibility prevents cheaper invalid modes", () => {
  for (const [productId, setupMode] of [
    ["essential", "none"],
    ["mobile-duo", "basic"],
    ["split-12", "terrace-split"],
    ["max-pro", "special"],
  ]) {
    assert.equal(
      validateServiceChoices(service(setupMode), productId).ok,
      true,
      `${productId} accepts ${setupMode}`,
    );
  }

  for (const [productId, setupMode] of [
    ["split-12", "none"],
    ["max-pro", "none"],
    ["essential", "terrace-split"],
  ]) {
    const result = validateServiceChoices(service(setupMode), productId);
    assert.equal(result.ok, false, `${productId} rejects ${setupMode}`);
    if (!result.ok) {
      assert.equal(result.code, "INVALID_SETUP");
    }
  }
});

Deno.test("Express is rejected until server-authoritative capacity exists", () => {
  const result = validateServiceChoices(service("basic", true), "essential");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "EXPRESS_NOT_ALLOWED");
  }
});

Deno.test("reservation operational periods use the shared Paris civil-time values", () => {
  const summer = buildServerOperationalPeriod(
    "2027-07-12",
    "0830-1030",
    "2027-07-19",
    "1630-1830",
  );
  const winter = buildServerOperationalPeriod(
    "2027-01-11",
    "0830-1030",
    "2027-01-18",
    "1630-1830",
  );

  assert.equal(
    summer.ok && summer.operationalPeriod.operationalStart,
    "2027-07-12T06:30",
  );
  assert.equal(
    summer.ok && summer.operationalPeriod.operationalEnd,
    "2027-07-19T22:30",
  );
  assert.equal(
    winter.ok && winter.operationalPeriod.operationalStart,
    "2027-01-11T06:30",
  );
  assert.equal(
    winter.ok && winter.operationalPeriod.operationalEnd,
    "2027-01-18T22:30",
  );
});
