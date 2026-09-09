const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const context = vm.createContext({ Date });

["reservation.js", "fleet.js"].forEach((filename) => {
  vm.runInContext(
    fs.readFileSync(path.join(projectRoot, "assets/js", filename), "utf8"),
    context,
    { filename }
  );
});

function evaluate(expression) {
  return vm.runInContext(expression, context);
}

context.assistantLikeState = {
  postcode: "16000",
  deliveryZone: { id: "local", name: "Angoulême proche" },
  roomType: "living_room",
  roomSubtype: null,
  roomArea: 27,
  roomConditions: ["sunny"],
  openingType: "casement",
  hasAccessibleOutdoorSpace: false,
  veluxBottomHeightRange: null,
  installationAssessmentRequired: false,
  extendedExhaustRequired: false,
  startDate: "2026-09-18",
  endDate: "2026-09-25",
  deliverySlotId: "0830-1030",
  collectionSlotId: "1630-1830",
  sameDayExpressSelected: true,
  recommendedProduct: { id: "mobile-duo", name: "IGLOUE Mobile Duo" },
  idealProduct: { id: "mobile-duo", name: "IGLOUE Mobile Duo" },
  setupMode: "basic",
  pricing: { total: 143, caution: { amount: 350 } }
};

evaluate("globalThis.testDraft = buildNormalizedReservationDraft(assistantLikeState)");

const draft = JSON.parse(JSON.stringify(context.testDraft));

assert.equal(draft.status, "draft", "A: draft status");
assert.equal(draft.location.postcode, "16000", "A: postcode");
assert.equal(draft.rental.deliveryDate, "2026-09-18", "A: delivery date");
assert.equal(draft.rental.collectionDate, "2026-09-25", "A: collection date");
assert.equal(draft.rental.nights, 7, "A: night count");
assert.equal(draft.product.selectedProductId, "mobile-duo", "A: product");
assert.equal(draft.delivery.slotId, "0830-1030", "A: delivery slot");
assert.equal(draft.collection.slotId, "1630-1830", "A: collection slot");
assert.equal(draft.delivery.expressSelected, true, "A: Express selection");
assert.equal(draft.bookingMode, "instant", "A: normal booking mode");
assert.equal(
  evaluate("validateNormalizedReservationDraft(testDraft, 3).valid"),
  true,
  "A: complete draft validation"
);

assert.equal(
  evaluate(`
    IGLOUE_RESERVATION_STATUSES.includes("draft") &&
    !IGLOUE_RESERVATION_STATUSES.includes("cleaning") &&
    IGLOUE_UNIT_STATUSES.includes("cleaning") &&
    !IGLOUE_UNIT_STATUSES.includes("draft")
  `),
  true,
  "B: reservation and unit status systems are separate"
);

assert.equal(
  evaluate(`(() => {
    let reservation = { status: "draft" };
    for (const status of ["pending", "confirmed", "active", "completed"]) {
      reservation = transitionReservationStatus(reservation, status);
    }
    return reservation.status;
  })()`),
  "completed",
  "B: reservation lifecycle"
);

assert.equal(
  evaluate(`(() => {
    let unit = createPhysicalUnit({ unitId: "S03", productId: "split-12" });
    for (const status of ["reserved", "preparing", "loaded", "delivered", "in-rental"]) {
      unit = transitionPhysicalUnit(unit, status);
    }
    return unit.status;
  })()`),
  "in-rental",
  "C: outbound lifecycle"
);

assert.equal(
  evaluate(`(() => {
    let unit = createPhysicalUnit({
      unitId: "S03",
      productId: "split-12",
      status: "in-rental"
    });
    for (const status of ["collection-due", "collected", "inspection", "cleaning", "available"]) {
      unit = transitionPhysicalUnit(unit, status);
    }
    return unit.status;
  })()`),
  "available",
  "D: return and cleaning lifecycle"
);

assert.equal(
  evaluate(`(() => {
    let unit = createPhysicalUnit({
      unitId: "S03",
      productId: "split-12",
      status: "inspection"
    });
    unit = transitionPhysicalUnit(unit, "maintenance");
    unit = transitionPhysicalUnit(unit, "available");
    return unit.status;
  })()`),
  "available",
  "E: maintenance branch"
);

assert.equal(
  evaluate(`transitionPhysicalUnit(
    createPhysicalUnit({ unitId: "S03", productId: "split-12" }),
    "in-rental"
  )`),
  false,
  "F: invalid transition"
);

assert.equal(
  evaluate('transitionReservationStatus({ status: "draft" }, "active")'),
  false,
  "F: invalid reservation transition"
);

context.testDraft.assignedUnitIds.push("S01", "S02");
assert.deepEqual(
  Array.from(context.testDraft.assignedUnitIds),
  ["S01", "S02"],
  "G: multiple assigned units"
);

evaluate("globalThis.testServices = buildReservationServiceRecords(testDraft)");
const services = JSON.parse(JSON.stringify(context.testServices));

assert.equal(services.length, 2, "H: two independent service records");
assert.equal(services[0].serviceType, "delivery", "H: delivery service");
assert.equal(services[0].slotId, "0830-1030", "H: delivery slot");
assert.equal(services[1].serviceType, "collection", "H: collection service");
assert.equal(services[1].slotId, "1630-1830", "H: collection slot");
assert.equal(
  evaluate(`transitionServiceStatus({ status: "scheduled" }, "en-route").status`),
  "en-route",
  "H: service lifecycle"
);

assert.equal(
  draft.operations.collectionLabel.required,
  true,
  "J: collection reminder label required"
);
assert.equal(
  draft.operations.collectionLabel.applied,
  false,
  "J: label not yet applied"
);
assert.equal(
  draft.operations.collectionLabel.needsUpdate,
  false,
  "J: future extension update flag"
);

context.assistantLikeState.requiresAssessment = true;
evaluate("globalThis.manualDraft = buildNormalizedReservationDraft(assistantLikeState)");
assert.equal(
  context.manualDraft.bookingMode,
  "manual-review",
  "D: assessment requires manual review"
);

console.log("Reservation, lifecycle and review-domain scenarios passed.");
