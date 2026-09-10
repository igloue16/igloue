const IGLOUE_UNIT_STATUSES = Object.freeze([
  "available",
  "reserved",
  "preparing",
  "loaded",
  "delivered",
  "in-rental",
  "collection-due",
  "collected",
  "inspection",
  "cleaning",
  "maintenance",
  "unavailable"
]);

const IGLOUE_UNIT_TRANSITIONS = Object.freeze({
  available: ["reserved", "maintenance", "unavailable"],
  reserved: ["available", "preparing", "maintenance", "unavailable"],
  preparing: ["available", "loaded", "maintenance", "unavailable"],
  loaded: ["preparing", "delivered", "maintenance", "unavailable"],
  delivered: ["in-rental", "maintenance", "unavailable"],
  "in-rental": ["collection-due"],
  "collection-due": ["collected"],
  collected: ["inspection"],
  inspection: ["cleaning", "maintenance"],
  cleaning: ["available", "maintenance"],
  maintenance: ["available", "unavailable"],
  unavailable: ["available", "maintenance"]
});

function createPhysicalUnit({
  unitId,
  productId,
  status = "available",
  serialNumber = null,
  unavailableUntil = null,
  externalReferences = {},
  metadata = {}
}) {
  if (
    !unitId ||
    !productId ||
    !IGLOUE_UNIT_STATUSES.includes(status)
  ) {
    return false;
  }

  return {
    unitId,
    productId,
    status,
    serialNumber,
    unavailableUntil,
    externalReferences: { ...externalReferences },
    metadata: { ...metadata }
  };
}

function canTransitionPhysicalUnit(currentStatus, nextStatus) {
  return Boolean(
    IGLOUE_UNIT_TRANSITIONS[currentStatus] &&
    IGLOUE_UNIT_TRANSITIONS[currentStatus].includes(nextStatus)
  );
}

function transitionPhysicalUnit(unit, nextStatus) {
  if (
    !unit ||
    !canTransitionPhysicalUnit(unit.status, nextStatus)
  ) {
    return false;
  }

  return {
    ...unit,
    status: nextStatus
  };
}

/*
  Development-only fleet sample. These are not purchased/production assets.
  Current inventory quantities remain the recommendation source until an
  authoritative backend allocation adapter is introduced.
*/
const IGLOUE_MOCK_PHYSICAL_UNITS = Object.freeze([
  createPhysicalUnit({ unitId: "E01", productId: "essential" }),
  createPhysicalUnit({ unitId: "E02", productId: "essential" }),
  createPhysicalUnit({ unitId: "D01", productId: "mobile-duo" }),
  createPhysicalUnit({ unitId: "D02", productId: "mobile-duo" }),
  createPhysicalUnit({ unitId: "S01", productId: "split-12" }),
  createPhysicalUnit({ unitId: "S02", productId: "split-12" }),
  createPhysicalUnit({ unitId: "S03", productId: "split-12" }),
  createPhysicalUnit({ unitId: "M01", productId: "max-pro" })
]);
