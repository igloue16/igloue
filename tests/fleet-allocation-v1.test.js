const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const context = vm.createContext({ Date, Intl });

vm.runInContext(
  fs.readFileSync(path.join(projectRoot, "assets/js/fleet.js"), "utf8"),
  context,
  { filename: "fleet.js" }
);

vm.runInContext(`
  const IGLOUE_SERVICE_WINDOWS = [
    { id: "0830-1030", startTime: "08:30", endTime: "10:30" },
    { id: "1030-1230", startTime: "10:30", endTime: "12:30" },
    { id: "1630-1830", startTime: "16:30", endTime: "18:30" },
    { id: "1830-2030", startTime: "18:30", endTime: "20:30" }
  ];
`, context);

vm.runInContext(
  fs.readFileSync(
    path.join(projectRoot, "assets/js/fleet-allocation.js"),
    "utf8"
  ),
  context,
  { filename: "fleet-allocation.js" }
);

function evaluate(expression) {
  return vm.runInContext(expression, context);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function reservation({
  id,
  productId = "split-12",
  quantity = 1,
  deliveryDate,
  deliverySlotId = "0830-1030",
  collectionDate,
  collectionSlotId = "1030-1230"
}) {
  return {
    reservationId: id,
    product: {
      selectedProductId: productId,
      requestedQuantity: quantity
    },
    rental: {
      deliveryDate,
      collectionDate
    },
    delivery: {
      date: deliveryDate,
      slotId: deliverySlotId
    },
    collection: {
      date: collectionDate,
      slotId: collectionSlotId
    }
  };
}

function allocationFor(unitId, sourceReservation, allocationId) {
  context.sourceReservation = sourceReservation;
  context.sourceUnitId = unitId;
  context.sourceAllocationId = allocationId;

  return clone(evaluate(`(() => {
    const period = buildFleetOperationalPeriod(sourceReservation);
    return createFleetAllocation({
      allocationId: sourceAllocationId,
      reservationId: sourceReservation.reservationId,
      unitId: sourceUnitId,
      productId: sourceReservation.product.selectedProductId,
      operationalStart: period.operationalStart,
      operationalEnd: period.operationalEnd,
      status: "reserved"
    });
  })()`));
}

const threeSplitUnits = ["S01", "S02", "S03"].map((unitId) => ({
  unitId,
  productId: "split-12",
  status: "available",
  serialNumber: null,
  unavailableUntil: null
}));

const target = reservation({
  id: "R-target",
  deliveryDate: "2026-09-18",
  collectionDate: "2026-09-25"
});
const overlapOne = allocationFor("S01", reservation({
  id: "R-one",
  deliveryDate: "2026-09-17",
  collectionDate: "2026-09-20"
}), "A-one");
const overlapTwo = allocationFor("S02", reservation({
  id: "R-two",
  deliveryDate: "2026-09-22",
  collectionDate: "2026-09-26"
}), "A-two");

context.target = target;
context.threeSplitUnits = threeSplitUnits;
context.twoBlockingAllocations = [overlapOne, overlapTwo];

let result = clone(evaluate(`findCompatibleUnits(target, {
  units: threeSplitUnits,
  allocations: twoBlockingAllocations
})`));
assert.deepEqual(result.compatibleUnitIds, ["S03"], "A: one free unit");
assert.equal(result.availableQuantity, 1, "A: available quantity");
assert.equal(result.canAllocate, true, "A: one-unit request succeeds");
assert.deepEqual(
  clone(evaluate(`getProductFleetAvailability("split-12", target, {
    units: threeSplitUnits,
    allocations: twoBlockingAllocations
  }).compatibleUnitIds`)),
  ["S03"],
  "A: product-level bridge uses physical-unit availability"
);

context.threeBlockingAllocations = [
  overlapOne,
  overlapTwo,
  allocationFor("S03", reservation({
    id: "R-three",
    deliveryDate: "2026-09-18",
    collectionDate: "2026-09-19"
  }), "A-three")
];
assert.equal(
  evaluate(`findCompatibleUnits(target, {
    units: threeSplitUnits,
    allocations: threeBlockingAllocations
  }).canAllocate`),
  false,
  "B: no free unit"
);

context.inRentalUnit = [{
  ...threeSplitUnits[0],
  status: "in-rental"
}];
context.finishedAllocation = [allocationFor("S01", reservation({
  id: "R-finished",
  deliveryDate: "2026-09-01",
  collectionDate: "2026-09-05"
}), "A-finished")];
assert.equal(
  evaluate(`findCompatibleUnits(target, {
    units: inRentalUnit,
    allocations: finishedAllocation
  }).canAllocate`),
  true,
  "C: current workflow status does not erase future planning availability"
);

context.availableUnit = [threeSplitUnits[0]];
context.futureConflict = [allocationFor("S01", {
  ...target,
  reservationId: "R-future-conflict"
}, "A-future")];
assert.equal(
  evaluate(`findCompatibleUnits(target, {
    units: availableUnit,
    allocations: futureConflict
  }).canAllocate`),
  false,
  "D: future allocation blocks an otherwise available unit"
);

context.maintenanceUnit = [{
  ...threeSplitUnits[0],
  status: "maintenance"
}];
assert.equal(
  evaluate(`findCompatibleUnits(target, {
    units: maintenanceUnit,
    allocations: []
  }).canAllocate`),
  false,
  "E: unresolved maintenance is a hard block"
);

context.maintenanceUntilUnit = [{
  ...threeSplitUnits[0],
  status: "maintenance",
  unavailableUntil: "2026-09-10T00:00"
}];
context.beforeReturn = reservation({
  id: "R-before-return",
  deliveryDate: "2026-09-09",
  collectionDate: "2026-09-12"
});
assert.equal(
  evaluate(`findCompatibleUnits(beforeReturn, {
    units: maintenanceUntilUnit,
    allocations: []
  }).canAllocate`),
  false,
  "F: maintenance unit blocked before return-to-service"
);
assert.equal(
  evaluate(`findCompatibleUnits(target, {
    units: maintenanceUntilUnit,
    allocations: []
  }).canAllocate`),
  true,
  "F: maintenance unit eligible after known return-to-service"
);

context.eveningDelivery = reservation({
  id: "R-evening",
  deliveryDate: "2026-09-10",
  deliverySlotId: "1830-2030",
  collectionDate: "2026-09-13"
});
context.morningCollection = [allocationFor("S01", reservation({
  id: "R-morning-return",
  deliveryDate: "2026-09-05",
  collectionDate: "2026-09-10",
  collectionSlotId: "0830-1030"
}), "A-morning-return")];
assert.equal(
  evaluate(`findCompatibleUnits(eveningDelivery, {
    units: availableUnit,
    allocations: morningCollection
  }).canAllocate`),
  true,
  "G: morning collection permits evening delivery after turnaround"
);

context.lateCollection = [allocationFor("S01", reservation({
  id: "R-late-return",
  deliveryDate: "2026-09-05",
  collectionDate: "2026-09-10",
  collectionSlotId: "1630-1830"
}), "A-late-return")];
assert.equal(
  evaluate(`findCompatibleUnits(eveningDelivery, {
    units: availableUnit,
    allocations: lateCollection
  }).canAllocate`),
  false,
  "H: late collection conflicts with near-immediate delivery"
);

context.boundaryCollection = [allocationFor("S01", reservation({
  id: "R-boundary",
  deliveryDate: "2026-09-05",
  collectionDate: "2026-09-10",
  collectionSlotId: "1030-1230"
}), "A-boundary")];
assert.equal(
  evaluate(`findCompatibleUnits(eveningDelivery, {
    units: availableUnit,
    allocations: boundaryCollection
  }).canAllocate`),
  true,
  "H: exact buffered boundary is non-overlapping"
);

context.twoUnitTarget = {
  ...target,
  reservationId: "R-two-units",
  product: { ...target.product, requestedQuantity: 2 }
};
const twoUnitResult = clone(evaluate(`findCompatibleUnits(twoUnitTarget, {
  units: threeSplitUnits,
  allocations: twoBlockingAllocations
})`));
assert.equal(twoUnitResult.availableQuantity, 1, "I: only one unit free");
assert.equal(twoUnitResult.canAllocate, false, "I: full quantity required");

context.releaseProvider = evaluate("createFleetAllocationProvider([])");
context.firstReservation = {
  ...target,
  reservationId: "R-first"
};
context.secondReservation = {
  ...target,
  reservationId: "R-second"
};
const allocated = clone(evaluate(`allocateUnitToReservation(firstReservation, {
  units: availableUnit,
  allocationProvider: releaseProvider
})`));
assert.equal(allocated.success, true, "J: explicit allocation succeeds");
assert.equal(
  evaluate(`findCompatibleUnits(secondReservation, {
    units: availableUnit,
    allocationProvider: releaseProvider
  }).canAllocate`),
  false,
  "J: allocation blocks the unit"
);
context.releaseAllocationId = allocated.allocations[0].allocationId;
assert.equal(
  evaluate(`releaseFleetAllocation(releaseAllocationId, {
    allocationProvider: releaseProvider
  }).status`),
  "released",
  "J: allocation releases cleanly"
);
assert.equal(
  evaluate(`findCompatibleUnits(secondReservation, {
    units: availableUnit,
    allocationProvider: releaseProvider
  }).canAllocate`),
  true,
  "J: released allocation stops blocking"
);

context.upcomingProvider = evaluate("createFleetAllocationProvider([])");
context.laterAllocation = allocationFor("S03", reservation({
  id: "R-later",
  deliveryDate: "2026-10-20",
  collectionDate: "2026-10-24"
}), "A-later");
context.soonerAllocation = allocationFor("S03", reservation({
  id: "R-sooner",
  deliveryDate: "2026-10-10",
  collectionDate: "2026-10-14"
}), "A-sooner");
evaluate("upcomingProvider.addAllocation(laterAllocation)");
evaluate("upcomingProvider.addAllocation(soonerAllocation)");
assert.deepEqual(
  Array.from(evaluate(`getUpcomingAllocationsForUnit("S03", {
    after: "2026-10-01T00:00",
    allocationProvider: upcomingProvider
  }).map((allocation) => allocation.allocationId)`)),
  ["A-sooner", "A-later"],
  "K: upcoming allocations are chronological"
);

assert.equal(
  evaluate("IGLOUE_FLEET_TURNAROUND.preparationBufferMinutes"),
  120,
  "turnaround: preparation default"
);
assert.equal(
  evaluate("IGLOUE_FLEET_TURNAROUND.turnaroundBufferMinutes"),
  240,
  "turnaround: inspection/cleaning default"
);

console.log("Physical Fleet Allocation V1 scenarios A–K passed.");
