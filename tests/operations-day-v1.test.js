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
    { id: "0830-1030", startTime: "08:30", endTime: "10:30", displayLabel: "08:30–10:30" },
    { id: "1030-1230", startTime: "10:30", endTime: "12:30", displayLabel: "10:30–12:30" },
    { id: "1230-1430", startTime: "12:30", endTime: "14:30", displayLabel: "12:30–14:30" },
    { id: "1430-1630", startTime: "14:30", endTime: "16:30", displayLabel: "14:30–16:30" },
    { id: "1630-1830", startTime: "16:30", endTime: "18:30", displayLabel: "16:30–18:30" },
    { id: "1830-2030", startTime: "18:30", endTime: "20:30", displayLabel: "18:30–20:30" }
  ];
  const IGLOUE_AVAILABILITY_SETTINGS = { defaultCapacityPerSlot: 1 };
  const testProducts = [
    { id: "split-12", name: "IGLOUE Split 12" }
  ];
  function getProductById(productId) {
    return testProducts.find((product) => product.id === productId) || null;
  }
`, context);

vm.runInContext(
  fs.readFileSync(
    path.join(projectRoot, "assets/js/fleet-allocation.js"),
    "utf8"
  ),
  context,
  { filename: "fleet-allocation.js" }
);

vm.runInContext(
  fs.readFileSync(
    path.join(projectRoot, "assets/js/operations-day.js"),
    "utf8"
  ),
  context,
  { filename: "operations-day.js" }
);

vm.runInContext(`
  globalThis.testReservations = [];
  globalThis.testServices = [];
  globalThis.testBusyPeriods = [];
  globalThis.testAllocations = [];
  globalThis.testUnits = [];

  const testScheduleProvider = {
    getBusyPeriods() {
      return testBusyPeriods.map((period) => ({ ...period }));
    }
  };
  const testReservationProvider = {
    getReservations() {
      return testReservations.map((reservation) => ({ ...reservation }));
    },
    getServiceRecords() {
      return testServices.map((service) => ({ ...service }));
    }
  };
  const testAvailabilityProvider = {
    getAvailableSlots({ serviceType }) {
      return [{
        id: serviceType === "delivery" ? "1430-1630" : "1830-2030",
        label: serviceType === "delivery" ? "14:30–16:30" : "18:30–20:30"
      }];
    }
  };

  function buildTestOperationalDay(date) {
    return buildOperationalDay(date, {
      scheduleProvider: testScheduleProvider,
      reservationProvider: testReservationProvider,
      allocationProvider: createFleetAllocationProvider(testAllocations),
      availabilityProvider: testAvailabilityProvider,
      units: testUnits,
      planningPostcode: "16000",
      now: { date, hour: 6, minute: 0 },
      slotCapacity: 1
    });
  }
`, context);

function evaluate(expression) {
  return vm.runInContext(expression, context);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function reservation({
  id,
  unitId = "S01",
  deliveryDate,
  deliverySlotId,
  collectionDate,
  collectionSlotId,
  labelApplied = false
}) {
  return {
    reservationId: id,
    status: "confirmed",
    location: {
      postcode: "16000",
      zone: { id: "local", name: "Angoulême proche" }
    },
    product: {
      selectedProductId: "split-12",
      requestedQuantity: 1
    },
    assignedUnitIds: unitId ? [unitId] : [],
    rental: { deliveryDate, collectionDate },
    delivery: {
      date: deliveryDate,
      slotId: deliverySlotId,
      setupMode: "window-installation",
      expressSelected: false
    },
    collection: {
      date: collectionDate,
      slotId: collectionSlotId
    },
    operations: {
      collectionLabel: {
        required: true,
        applied: labelApplied,
        photoReference: null,
        needsUpdate: false
      }
    }
  };
}

function servicesForDate(reservations, date) {
  return reservations.flatMap((item) => {
    const base = {
      reservationId: item.reservationId,
      productId: item.product.selectedProductId,
      postcode: item.location.postcode,
      zoneId: item.location.zone.id,
      zoneName: item.location.zone.name,
      unitIds: [...item.assignedUnitIds],
      assignedResourceIds: ["operations-primary"],
      assignedVehicleId: null,
      routePreferenceScore: 0,
      status: "scheduled"
    };
    const services = [];

    if (item.delivery.date === date) {
      services.push({
        ...base,
        serviceId: `${item.reservationId}-delivery`,
        serviceType: "delivery",
        date,
        slotId: item.delivery.slotId,
        setupMode: item.delivery.setupMode,
        expressSelected: false
      });
    }

    if (item.collection.date === date) {
      services.push({
        ...base,
        serviceId: `${item.reservationId}-collection`,
        serviceType: "collection",
        date,
        slotId: item.collection.slotId,
        setupMode: null,
        expressSelected: false
      });
    }

    return services;
  });
}

function allocationFor(item, unitId = item.assignedUnitIds[0]) {
  context.sourceReservation = item;
  context.sourceUnitId = unitId;

  return clone(evaluate(`(() => {
    const period = buildFleetOperationalPeriod(sourceReservation);
    return createFleetAllocation({
      allocationId: sourceReservation.reservationId + "-" + sourceUnitId,
      reservationId: sourceReservation.reservationId,
      unitId: sourceUnitId,
      productId: sourceReservation.product.selectedProductId,
      operationalStart: period.operationalStart,
      operationalEnd: period.operationalEnd,
      status: "reserved"
    });
  })()`));
}

function configure({ reservations, services, busyPeriods = [], allocations, units }) {
  context.testReservations = reservations;
  context.testServices = services;
  context.testBusyPeriods = busyPeriods;
  context.testAllocations = allocations;
  context.testUnits = units;
}

const baseUnits = ["S01", "S02", "S03"].map((unitId) => ({
  unitId,
  productId: "split-12",
  status: "available",
  serialNumber: null,
  unavailableUntil: null
}));
const day = "2026-09-10";
const returning = reservation({
  id: "R-return",
  unitId: "S01",
  deliveryDate: "2026-09-05",
  deliverySlotId: "0830-1030",
  collectionDate: day,
  collectionSlotId: "0830-1030",
  labelApplied: true
});
const delivering = reservation({
  id: "R-delivery",
  unitId: "S02",
  deliveryDate: day,
  deliverySlotId: "1430-1630",
  collectionDate: "2026-09-14",
  collectionSlotId: "0830-1030"
});
const freeDayReservations = [returning, delivering];

configure({
  reservations: freeDayReservations,
  services: servicesForDate(freeDayReservations, day),
  allocations: freeDayReservations.map((item) => allocationFor(item)),
  units: baseUnits
});
let model = clone(evaluate(`buildTestOperationalDay("${day}")`));
assert.equal(model.date, day, "A: selected date retained");
assert.equal(model.summary.deliveries, 1, "A: delivery included");
assert.equal(model.summary.collections, 1, "A: collection included");
assert.equal(model.summary.busyPeriods, 0, "A: free external schedule");
assert.deepEqual(
  model.timeline.map((item) => item.startTime),
  [...model.timeline.map((item) => item.startTime)].sort(),
  "A: timeline is chronological"
);
assert.equal(model.remainingSlots.delivery[0].id, "1430-1630", "A: remaining delivery slot");

configure({
  reservations: [delivering],
  services: servicesForDate([delivering], day),
  busyPeriods: [{
    id: "busy-early",
    date: day,
    startTime: "06:00",
    endTime: "13:30",
    source: "generic-calendar",
    displayLabel: "Calendrier de travail"
  }],
  allocations: [allocationFor(delivering)],
  units: baseUnits
});
model = clone(evaluate(`buildTestOperationalDay("${day}")`));
assert.equal(model.busyPeriods[0].displayLabel, "Calendrier de travail", "B: normalized busy label");
assert.equal(model.timeline[0].itemType, "busy-period", "B: early work shown first");
assert.equal(
  model.conflicts.some((conflict) => conflict.code === "busy-period-conflict"),
  false,
  "B: afternoon delivery does not conflict with early work"
);

const morningDelivery = reservation({
  id: "R-morning-delivery",
  unitId: "S03",
  deliveryDate: day,
  deliverySlotId: "0830-1030",
  collectionDate: "2026-09-15",
  collectionSlotId: "0830-1030"
});
configure({
  reservations: [morningDelivery, returning],
  services: servicesForDate([morningDelivery, returning], day),
  busyPeriods: [{
    id: "busy-afternoon",
    date: day,
    startTime: "12:30",
    endTime: "19:30",
    source: "generic-calendar",
    displayLabel: "Calendrier de travail"
  }],
  allocations: [allocationFor(morningDelivery), allocationFor(returning)],
  units: baseUnits
});
model = clone(evaluate(`buildTestOperationalDay("${day}")`));
assert.equal(model.summary.deliveries, 1, "C: morning delivery retained");
assert.equal(model.summary.collections, 1, "C: morning collection retained");
assert.equal(
  model.conflicts.some((conflict) => conflict.code === "busy-period-conflict"),
  false,
  "C: morning services do not conflict with afternoon work"
);

assert.equal(
  model.tasks.some((task) => task.type === "prepare-unit" && task.unitId === "S03"),
  true,
  "D: allocated delivery creates preparation task"
);
assert.equal(
  model.tasks.some((task) => task.type === "inspection" && task.unitId === "S01"),
  true,
  "E: return creates inspection task"
);
assert.equal(
  model.tasks.some((task) => task.type === "cleaning" && task.unitId === "S01"),
  true,
  "E: return creates cleaning task"
);
assert.equal(
  model.tasks.some((task) => task.type === "prepare-collection-label"),
  true,
  "F: unapplied required label creates reminder"
);

const eveningReuse = reservation({
  id: "R-evening-reuse",
  unitId: "S01",
  deliveryDate: day,
  deliverySlotId: "1830-2030",
  collectionDate: "2026-09-15",
  collectionSlotId: "0830-1030"
});
configure({
  reservations: [returning, eveningReuse],
  services: servicesForDate([returning, eveningReuse], day),
  allocations: [allocationFor(returning), allocationFor(eveningReuse)],
  units: baseUnits
});
model = clone(evaluate(`buildTestOperationalDay("${day}")`));
assert.equal(
  model.conflicts.some((conflict) => conflict.code === "turnaround-conflict"),
  false,
  "G: valid same-day reuse has no false turnaround conflict"
);

const lateReturning = reservation({
  id: "R-late-return",
  unitId: "S01",
  deliveryDate: "2026-09-05",
  deliverySlotId: "0830-1030",
  collectionDate: day,
  collectionSlotId: "1630-1830",
  labelApplied: true
});
configure({
  reservations: [lateReturning, eveningReuse],
  services: servicesForDate([lateReturning, eveningReuse], day),
  allocations: [allocationFor(lateReturning), allocationFor(eveningReuse)],
  units: baseUnits
});
model = clone(evaluate(`buildTestOperationalDay("${day}")`));
assert.equal(
  model.conflicts.some((conflict) => conflict.code === "turnaround-conflict"),
  true,
  "H: invalid same-day reuse reports turnaround conflict"
);

const maintenanceUnits = baseUnits.map((unit) => (
  unit.unitId === "S01" ? { ...unit, status: "maintenance" } : unit
));
configure({
  reservations: [eveningReuse],
  services: servicesForDate([eveningReuse], day),
  allocations: [allocationFor(eveningReuse)],
  units: maintenanceUnits
});
model = clone(evaluate(`buildTestOperationalDay("${day}")`));
assert.equal(
  model.conflicts.some((conflict) => conflict.code === "unit-unavailable"),
  true,
  "I: maintenance allocation reports conflict"
);

const sameSlotOne = reservation({
  id: "R-slot-one",
  unitId: "S01",
  deliveryDate: day,
  deliverySlotId: "1430-1630",
  collectionDate: "2026-09-14",
  collectionSlotId: "0830-1030"
});
const sameSlotTwo = reservation({
  id: "R-slot-two",
  unitId: "S02",
  deliveryDate: day,
  deliverySlotId: "1430-1630",
  collectionDate: "2026-09-14",
  collectionSlotId: "1030-1230"
});
configure({
  reservations: [sameSlotOne, sameSlotTwo],
  services: servicesForDate([sameSlotOne, sameSlotTwo], day),
  allocations: [allocationFor(sameSlotOne), allocationFor(sameSlotTwo)],
  units: baseUnits
});
model = clone(evaluate(`buildTestOperationalDay("${day}")`));
assert.equal(
  model.conflicts.some((conflict) => conflict.code === "slot-over-capacity"),
  true,
  "J: capacity-1 slot conflict reported"
);

assert.equal(
  evaluate("IGLOUE_FLEET_TURNAROUND.preparationBufferMinutes"),
  120,
  "turnaround preparation unchanged"
);
assert.equal(
  evaluate("IGLOUE_FLEET_TURNAROUND.turnaroundBufferMinutes"),
  240,
  "turnaround post-collection unchanged"
);

console.log("IGLOUE Operations Day View V1 scenarios A–J passed.");
