const IGLOUE_FLEET_ALLOCATION_STATUSES = Object.freeze([
  "held",
  "reserved",
  "active",
  "released",
  "cancelled"
]);

const IGLOUE_BLOCKING_ALLOCATION_STATUSES = Object.freeze([
  "held",
  "reserved",
  "active"
]);

const IGLOUE_HARD_BLOCKING_UNIT_STATUSES = Object.freeze([
  "maintenance",
  "unavailable"
]);

/*
  Provisional planning defaults, kept in one place for operational testing.
  Buffers are applied to the selected service-window boundaries, so same-day
  turnaround remains possible when there is genuinely enough time.
*/
const IGLOUE_FLEET_TURNAROUND = Object.freeze({
  timeZone: "Europe/Paris",
  preparationBufferMinutes: 120,
  turnaroundBufferMinutes: 240
});

function getFleetCivilMinute(value) {
  const match = String(value || "").match(
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/
  );

  if (!match) {
    return NaN;
  }

  const [, year, month, day, hours = "00", minutes = "00"] = match;

  /*
    Date.UTC is used only as a stable civil-calendar minute index. These are
    Europe/Paris wall-clock values, not instants converted between timezones,
    so DST cannot move a service onto another calendar date.
  */
  return Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hours),
    Number(minutes)
  ) / 60000;
}

function formatFleetCivilMinute(value) {
  if (!Number.isFinite(value)) {
    return null;
  }

  return new Date(value * 60000)
    .toISOString()
    .slice(0, 16);
}

function getFleetServiceWindow(slotId) {
  return IGLOUE_SERVICE_WINDOWS.find(
    (serviceWindow) => serviceWindow.id === slotId
  ) || null;
}

function buildFleetOperationalPeriod(
  reservation,
  configuration = IGLOUE_FLEET_TURNAROUND
) {
  if (!reservation || !reservation.delivery || !reservation.collection) {
    return null;
  }

  const deliveryWindow = getFleetServiceWindow(reservation.delivery.slotId);
  const collectionWindow = getFleetServiceWindow(reservation.collection.slotId);

  if (!deliveryWindow || !collectionWindow) {
    return null;
  }

  const deliveryDate = reservation.delivery.date || reservation.rental.deliveryDate;
  const collectionDate = reservation.collection.date || reservation.rental.collectionDate;
  const deliveryStart = getFleetCivilMinute(
    `${deliveryDate}T${deliveryWindow.startTime}`
  );
  const collectionEnd = getFleetCivilMinute(
    `${collectionDate}T${collectionWindow.endTime}`
  );
  const operationalStartMinute =
    deliveryStart - configuration.preparationBufferMinutes;
  const operationalEndMinute =
    collectionEnd + configuration.turnaroundBufferMinutes;

  if (
    !Number.isFinite(operationalStartMinute) ||
    !Number.isFinite(operationalEndMinute) ||
    operationalStartMinute >= operationalEndMinute
  ) {
    return null;
  }

  return {
    timeZone: configuration.timeZone,
    preparationBufferMinutes: configuration.preparationBufferMinutes,
    turnaroundBufferMinutes: configuration.turnaroundBufferMinutes,
    deliveryWindowStart: `${deliveryDate}T${deliveryWindow.startTime}`,
    collectionWindowEnd: `${collectionDate}T${collectionWindow.endTime}`,
    operationalStart: formatFleetCivilMinute(operationalStartMinute),
    operationalEnd: formatFleetCivilMinute(operationalEndMinute)
  };
}

/* Half-open intervals: an end exactly equal to the next start is permitted. */
function fleetOperationalPeriodsOverlap(periodA, periodB) {
  if (!periodA || !periodB) {
    return false;
  }

  const startA = getFleetCivilMinute(periodA.operationalStart);
  const endA = getFleetCivilMinute(periodA.operationalEnd);
  const startB = getFleetCivilMinute(periodB.operationalStart);
  const endB = getFleetCivilMinute(periodB.operationalEnd);

  if (![startA, endA, startB, endB].every(Number.isFinite)) {
    return false;
  }

  return startA < endB && endA > startB;
}

function createFleetAllocation({
  allocationId = null,
  reservationId = null,
  unitId,
  productId,
  operationalStart,
  operationalEnd,
  status = "reserved",
  externalReferences = {}
}) {
  if (
    !unitId ||
    !productId ||
    !operationalStart ||
    !operationalEnd ||
    !IGLOUE_FLEET_ALLOCATION_STATUSES.includes(status)
  ) {
    return false;
  }

  return {
    allocationId,
    reservationId,
    unitId,
    productId,
    operationalStart,
    operationalEnd,
    status,
    externalReferences: {
      louezReservationId: null,
      ...externalReferences
    }
  };
}

function createFleetAllocationProvider(initialAllocations = []) {
  const allocations = initialAllocations.map((allocation) => ({ ...allocation }));

  return {
    getAllocations() {
      return allocations.map((allocation) => ({ ...allocation }));
    },

    addAllocation(allocation) {
      if (!allocation) {
        return false;
      }

      allocations.push({ ...allocation });
      return { ...allocation };
    },

    updateAllocationStatus(allocationId, status) {
      if (!IGLOUE_FLEET_ALLOCATION_STATUSES.includes(status)) {
        return false;
      }

      const allocation = allocations.find(
        (candidate) => candidate.allocationId === allocationId
      );

      if (!allocation) {
        return false;
      }

      allocation.status = status;
      return { ...allocation };
    }
  };
}

/* Development-only allocation input; a backend/provider replaces this. */
const IGLOUE_MOCK_FLEET_ALLOCATIONS = [];
const IGLOUE_FLEET_ALLOCATION_PROVIDER =
  createFleetAllocationProvider(IGLOUE_MOCK_FLEET_ALLOCATIONS);

function unitPassesFleetStatusRule(unit, requestedOperationalStart) {
  if (!IGLOUE_HARD_BLOCKING_UNIT_STATUSES.includes(unit.status)) {
    return true;
  }

  if (!unit.unavailableUntil) {
    return false;
  }

  const unavailableUntil = getFleetCivilMinute(unit.unavailableUntil);
  const requestedStart = getFleetCivilMinute(requestedOperationalStart);

  return (
    Number.isFinite(unavailableUntil) &&
    Number.isFinite(requestedStart) &&
    requestedStart >= unavailableUntil
  );
}

function defaultFleetAllocationStrategy(unitA, unitB) {
  return unitA.unitId.localeCompare(unitB.unitId, "en", {
    numeric: true,
    sensitivity: "base"
  });
}

function findCompatibleUnits(
  reservation,
  {
    units = IGLOUE_MOCK_PHYSICAL_UNITS,
    allocations = null,
    allocationProvider = IGLOUE_FLEET_ALLOCATION_PROVIDER,
    configuration = IGLOUE_FLEET_TURNAROUND,
    strategy = defaultFleetAllocationStrategy
  } = {}
) {
  const productId = reservation && reservation.product
    ? reservation.product.selectedProductId
    : null;
  const requestedQuantity = Math.max(
    1,
    Math.floor(
      Number(reservation && reservation.product
        ? reservation.product.requestedQuantity
        : 1) || 1
    )
  );
  const operationalPeriod = buildFleetOperationalPeriod(
    reservation,
    configuration
  );
  const knownAllocations = allocations === null
    ? allocationProvider.getAllocations()
    : allocations;

  if (!productId || !operationalPeriod) {
    return {
      productId,
      requestedQuantity,
      availableQuantity: 0,
      compatibleUnitIds: [],
      canAllocate: false,
      operationalPeriod,
      planningOnly: true
    };
  }

  const compatibleUnits = units
    .filter((unit) => unit.productId === productId)
    .filter((unit) => (
      unitPassesFleetStatusRule(unit, operationalPeriod.operationalStart)
    ))
    .filter((unit) => {
      return !knownAllocations.some((allocation) => {
        if (!IGLOUE_BLOCKING_ALLOCATION_STATUSES.includes(allocation.status)) {
          return false;
        }

        if (
          reservation.reservationId &&
          allocation.reservationId === reservation.reservationId
        ) {
          return false;
        }

        return (
          allocation.unitId === unit.unitId &&
          fleetOperationalPeriodsOverlap(allocation, operationalPeriod)
        );
      });
    })
    .sort(strategy);
  const compatibleUnitIds = compatibleUnits.map((unit) => unit.unitId);

  return {
    productId,
    requestedQuantity,
    availableQuantity: compatibleUnitIds.length,
    compatibleUnitIds,
    canAllocate: compatibleUnitIds.length >= requestedQuantity,
    operationalPeriod,
    planningOnly: true
  };
}

function getProductFleetAvailability(productId, reservation, options = {}) {
  if (!reservation) {
    return {
      productId,
      requestedQuantity: 1,
      availableQuantity: 0,
      compatibleUnitIds: [],
      canAllocate: false,
      operationalPeriod: null,
      planningOnly: true
    };
  }

  return findCompatibleUnits({
    ...reservation,
    product: {
      ...reservation.product,
      selectedProductId: productId
    }
  }, options);
}

function applyFleetAllocationToReservation(reservation, allocationResult) {
  if (!allocationResult || !allocationResult.success) {
    return reservation;
  }

  return {
    ...reservation,
    assignedUnitIds: [...allocationResult.unitIds]
  };
}

/*
  Future operational handoff:
  confirmed reservation -> physical allocation -> unit preparing -> tablet
  checklist -> collection label/evidence -> signature -> delivered/in-rental.
  This domain layer intentionally implements none of that UI or evidence flow.
*/

function allocateUnitToReservation(
  reservation,
  {
    status = "reserved",
    allocationProvider = IGLOUE_FLEET_ALLOCATION_PROVIDER,
    ...queryOptions
  } = {}
) {
  const availability = findCompatibleUnits(reservation, {
    ...queryOptions,
    allocationProvider
  });

  if (
    !availability.canAllocate ||
    !IGLOUE_BLOCKING_ALLOCATION_STATUSES.includes(status)
  ) {
    return {
      success: false,
      unitIds: [],
      allocations: [],
      availability,
      planningOnly: true
    };
  }

  const unitIds = availability.compatibleUnitIds.slice(
    0,
    availability.requestedQuantity
  );
  const allocations = unitIds.map((unitId) => {
    const allocation = createFleetAllocation({
      allocationId: [
        "mock-allocation",
        reservation.reservationId || "draft",
        unitId,
        availability.operationalPeriod.operationalStart.replace(/\D/g, "")
      ].join("-"),
      reservationId: reservation.reservationId || null,
      unitId,
      productId: availability.productId,
      operationalStart: availability.operationalPeriod.operationalStart,
      operationalEnd: availability.operationalPeriod.operationalEnd,
      status
    });

    return allocationProvider.addAllocation(allocation);
  });

  return {
    success: true,
    unitIds,
    allocations,
    availability,
    planningOnly: true
  };
}

function releaseFleetAllocation(
  allocationId,
  {
    status = "released",
    allocationProvider = IGLOUE_FLEET_ALLOCATION_PROVIDER
  } = {}
) {
  if (!["released", "cancelled"].includes(status)) {
    return false;
  }

  return allocationProvider.updateAllocationStatus(allocationId, status);
}

function getUpcomingAllocationsForUnit(
  unitId,
  {
    after = null,
    allocationProvider = IGLOUE_FLEET_ALLOCATION_PROVIDER
  } = {}
) {
  const afterMinute = after ? getFleetCivilMinute(after) : -Infinity;

  return allocationProvider.getAllocations()
    .filter((allocation) => (
      allocation.unitId === unitId &&
      IGLOUE_BLOCKING_ALLOCATION_STATUSES.includes(allocation.status) &&
      getFleetCivilMinute(allocation.operationalEnd) > afterMinute
    ))
    .sort((allocationA, allocationB) => (
      getFleetCivilMinute(allocationA.operationalStart) -
      getFleetCivilMinute(allocationB.operationalStart)
    ));
}

/*
  Planning query only. A future backend must repeat this query atomically,
  create/convert a hold, and lock stock before booking/payment confirmation.
  Real-time readiness (inspection and cleaning actually completed) remains an
  operational check even when the planned interval is clear.
*/
