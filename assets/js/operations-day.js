const IGLOUE_OPERATION_TASK_STATUSES = Object.freeze([
  "pending",
  "in-progress",
  "completed",
  "blocked"
]);

const IGLOUE_OPERATION_CONFLICT_CODES = Object.freeze({
  BUSY_PERIOD: "busy-period-conflict",
  UNIT_OVERLAP: "unit-overlap",
  TURNAROUND: "turnaround-conflict",
  SLOT_CAPACITY: "slot-over-capacity",
  UNIT_UNAVAILABLE: "unit-unavailable"
});

const IGLOUE_SERVICE_STATUS_LABELS = Object.freeze({
  scheduled: "Planifiée",
  "en-route": "En route",
  completed: "Terminée",
  failed: "Échec",
  cancelled: "Annulée"
});

const IGLOUE_OPERATION_CONFLICT_LABELS = Object.freeze({
  [IGLOUE_OPERATION_CONFLICT_CODES.BUSY_PERIOD]:
    "Intervention pendant une période indisponible",
  [IGLOUE_OPERATION_CONFLICT_CODES.UNIT_OVERLAP]:
    "Machine affectée à deux locations simultanées",
  [IGLOUE_OPERATION_CONFLICT_CODES.TURNAROUND]:
    "Temps de remise en service insuffisant",
  [IGLOUE_OPERATION_CONFLICT_CODES.SLOT_CAPACITY]:
    "Capacité du créneau dépassée",
  [IGLOUE_OPERATION_CONFLICT_CODES.UNIT_UNAVAILABLE]:
    "Machine indisponible ou en maintenance"
});

function getOperationalProduct(productId) {
  return typeof getProductById === "function"
    ? getProductById(productId)
    : null;
}

function normalizeOperationalBusyPeriod(period) {
  return {
    busyPeriodId: period.id || null,
    date: period.date,
    startTime: period.startTime,
    endTime: period.endTime,
    source: period.source || "schedule-provider",
    displayLabel: period.displayLabel || "Période indisponible",
    resourceId: period.resourceId || null,
    resourceType: period.resourceType || null
  };
}

function normalizeOperationalService(service) {
  const serviceWindow = getFleetServiceWindow(service.slotId);
  const product = getOperationalProduct(service.productId);

  return {
    serviceId: service.serviceId,
    reservationId: service.reservationId,
    serviceType: service.serviceType,
    status: service.status,
    statusLabel:
      IGLOUE_SERVICE_STATUS_LABELS[service.status] || service.status,
    date: service.date,
    slotId: service.slotId,
    startTime: serviceWindow ? serviceWindow.startTime : null,
    endTime: serviceWindow ? serviceWindow.endTime : null,
    productId: service.productId,
    productName: product ? product.name : service.productId,
    postcode: service.postcode,
    zoneId: service.zoneId || null,
    zoneName: service.zoneName || null,
    unitIds: [...(service.unitIds || [])],
    assignedResourceIds: [...(service.assignedResourceIds || [])],
    assignedVehicleId: service.assignedVehicleId || null,
    routePreferenceScore: Number(service.routePreferenceScore) || 0,
    setupMode: service.setupMode || null,
    expressSelected: Boolean(service.expressSelected)
  };
}

function sortOperationalItems(items) {
  return [...items].sort((itemA, itemB) => {
    const timeComparison = String(itemA.startTime || "99:99")
      .localeCompare(String(itemB.startTime || "99:99"));

    if (timeComparison !== 0) {
      return timeComparison;
    }

    return String(itemA.itemId).localeCompare(String(itemB.itemId));
  });
}

/* Future route/geographic strategy hook; V1 preserves chronology only. */
function scoreOperationalRoute(services) {
  return sortOperationalItems(services).map((service) => ({ ...service }));
}

function createOperationalTask({
  taskId,
  type,
  date,
  dueTime,
  reservationId,
  unitId = null,
  status = "pending"
}) {
  if (!IGLOUE_OPERATION_TASK_STATUSES.includes(status)) {
    return false;
  }

  return {
    taskId,
    type,
    date,
    dueTime,
    reservationId,
    unitId,
    status
  };
}

function deriveOperationalTasks(date, services, reservations) {
  const reservationById = new Map(
    reservations.map((reservation) => [reservation.reservationId, reservation])
  );
  const tasks = [];

  services.forEach((service) => {
    const reservation = reservationById.get(service.reservationId);

    if (service.serviceType === "delivery") {
      service.unitIds.forEach((unitId) => {
        tasks.push(createOperationalTask({
          taskId: `${service.serviceId}-prepare-${unitId}`,
          type: "prepare-unit",
          date,
          dueTime: service.startTime,
          reservationId: service.reservationId,
          unitId
        }));
      });

      const collectionLabel =
        reservation && reservation.operations
          ? reservation.operations.collectionLabel
          : null;

      if (
        collectionLabel &&
        collectionLabel.required &&
        !collectionLabel.applied
      ) {
        tasks.push(createOperationalTask({
          taskId: `${service.serviceId}-collection-label`,
          type: "prepare-collection-label",
          date,
          dueTime: service.startTime,
          reservationId: service.reservationId,
          unitId: service.unitIds[0] || null
        }));
      }
    }

    if (service.serviceType === "collection") {
      service.unitIds.forEach((unitId) => {
        tasks.push(createOperationalTask({
          taskId: `${service.serviceId}-inspection-${unitId}`,
          type: "inspection",
          date,
          dueTime: service.endTime,
          reservationId: service.reservationId,
          unitId
        }));
        tasks.push(createOperationalTask({
          taskId: `${service.serviceId}-cleaning-${unitId}`,
          type: "cleaning",
          date,
          dueTime: service.endTime,
          reservationId: service.reservationId,
          unitId
        }));
      });
    }
  });

  const taskSequence = {
    "prepare-unit": 0,
    "prepare-collection-label": 1,
    inspection: 0,
    cleaning: 1
  };

  return tasks.sort((taskA, taskB) => (
    String(taskA.dueTime).localeCompare(String(taskB.dueTime)) ||
    (taskSequence[taskA.type] || 0) - (taskSequence[taskB.type] || 0) ||
    taskA.taskId.localeCompare(taskB.taskId)
  ));
}

function deriveOperationalTimeline(
  date,
  busyPeriods,
  services,
  configuration = IGLOUE_FLEET_TURNAROUND
) {
  const items = [];

  busyPeriods.forEach((period) => {
    items.push({
      itemId: `busy-${period.busyPeriodId || period.startTime}`,
      itemType: "busy-period",
      startTime: period.startTime,
      endTime: period.endTime,
      busyPeriod: period
    });
  });

  services.forEach((service) => {
    items.push({
      itemId: `service-${service.serviceId}`,
      itemType: "service",
      startTime: service.startTime,
      endTime: service.endTime,
      service
    });

    if (service.serviceType === "delivery" && service.startTime) {
      const deliveryStart = getFleetCivilMinute(`${date}T${service.startTime}`);
      items.push({
        itemId: `preparation-${service.serviceId}`,
        itemType: "preparation-window",
        startTime: formatFleetCivilMinute(
          deliveryStart - configuration.preparationBufferMinutes
        ).slice(11),
        endTime: service.startTime,
        unitIds: [...service.unitIds],
        reservationId: service.reservationId
      });
    }

    if (service.serviceType === "collection" && service.endTime) {
      const collectionEnd = getFleetCivilMinute(`${date}T${service.endTime}`);
      const turnaroundEnd = formatFleetCivilMinute(
        collectionEnd + configuration.turnaroundBufferMinutes
      );
      items.push({
        itemId: `turnaround-${service.serviceId}`,
        itemType: "turnaround-window",
        serviceDate: date,
        startTime: service.endTime,
        endTime: turnaroundEnd.slice(11),
        endDate: turnaroundEnd.slice(0, 10),
        unitIds: [...service.unitIds],
        reservationId: service.reservationId
      });
    }
  });

  return sortOperationalItems(items);
}

function operationalClockPeriodsOverlap(date, periodA, periodB) {
  return fleetOperationalPeriodsOverlap(
    {
      operationalStart: `${date}T${periodA.startTime}`,
      operationalEnd: `${date}T${periodA.endTime}`
    },
    {
      operationalStart: `${date}T${periodB.startTime}`,
      operationalEnd: `${date}T${periodB.endTime}`
    }
  );
}

function allocationTouchesOperationalDay(allocation, date) {
  return fleetOperationalPeriodsOverlap(allocation, {
    operationalStart: `${date}T00:00`,
    operationalEnd: formatFleetCivilMinute(
      getFleetCivilMinute(`${date}T00:00`) + 1440
    )
  });
}

function getReservationCustomerPeriod(reservation) {
  const operationalPeriod = buildFleetOperationalPeriod(reservation, {
    ...IGLOUE_FLEET_TURNAROUND,
    preparationBufferMinutes: 0,
    turnaroundBufferMinutes: 0
  });

  return operationalPeriod
    ? {
        operationalStart: operationalPeriod.operationalStart,
        operationalEnd: operationalPeriod.operationalEnd
      }
    : null;
}

function analyzeOperationalConflicts({
  date,
  busyPeriods,
  services,
  reservations,
  allocations,
  units,
  slotCapacity = 1
}) {
  const conflicts = [];
  const addConflict = (code, details = {}) => {
    conflicts.push({
      conflictId: `${code}-${conflicts.length + 1}`,
      code,
      label: IGLOUE_OPERATION_CONFLICT_LABELS[code],
      ...details
    });
  };

  services.forEach((service) => {
    busyPeriods.forEach((busyPeriod) => {
      if (
        service.startTime &&
        service.endTime &&
        operationalClockPeriodsOverlap(date, service, busyPeriod)
      ) {
        addConflict(IGLOUE_OPERATION_CONFLICT_CODES.BUSY_PERIOD, {
          serviceIds: [service.serviceId],
          busyPeriodIds: [busyPeriod.busyPeriodId]
        });
      }
    });
  });

  const servicesBySlot = new Map();
  services.forEach((service) => {
    const slotServices = servicesBySlot.get(service.slotId) || [];
    slotServices.push(service);
    servicesBySlot.set(service.slotId, slotServices);
  });
  servicesBySlot.forEach((slotServices, slotId) => {
    if (slotServices.length > slotCapacity) {
      addConflict(IGLOUE_OPERATION_CONFLICT_CODES.SLOT_CAPACITY, {
        slotId,
        serviceIds: slotServices.map((service) => service.serviceId)
      });
    }
  });

  const relevantAllocations = allocations.filter((allocation) => (
    IGLOUE_BLOCKING_ALLOCATION_STATUSES.includes(allocation.status) &&
    allocationTouchesOperationalDay(allocation, date)
  ));
  const reservationById = new Map(
    reservations.map((reservation) => [reservation.reservationId, reservation])
  );
  const unitById = new Map(units.map((unit) => [unit.unitId, unit]));

  relevantAllocations.forEach((allocation) => {
    const unit = unitById.get(allocation.unitId);

    if (
      !unit ||
      !unitPassesFleetStatusRule(unit, allocation.operationalStart)
    ) {
      addConflict(IGLOUE_OPERATION_CONFLICT_CODES.UNIT_UNAVAILABLE, {
        allocationIds: [allocation.allocationId],
        reservationIds: [allocation.reservationId],
        unitIds: [allocation.unitId]
      });
    }
  });

  for (let index = 0; index < relevantAllocations.length; index += 1) {
    for (
      let comparisonIndex = index + 1;
      comparisonIndex < relevantAllocations.length;
      comparisonIndex += 1
    ) {
      const allocationA = relevantAllocations[index];
      const allocationB = relevantAllocations[comparisonIndex];

      if (
        allocationA.unitId !== allocationB.unitId ||
        !fleetOperationalPeriodsOverlap(allocationA, allocationB)
      ) {
        continue;
      }

      const customerPeriodA = getReservationCustomerPeriod(
        reservationById.get(allocationA.reservationId)
      );
      const customerPeriodB = getReservationCustomerPeriod(
        reservationById.get(allocationB.reservationId)
      );
      const customerRentalOverlaps =
        customerPeriodA &&
        customerPeriodB &&
        fleetOperationalPeriodsOverlap(customerPeriodA, customerPeriodB);

      addConflict(
        customerRentalOverlaps
          ? IGLOUE_OPERATION_CONFLICT_CODES.UNIT_OVERLAP
          : IGLOUE_OPERATION_CONFLICT_CODES.TURNAROUND,
        {
          allocationIds: [allocationA.allocationId, allocationB.allocationId],
          reservationIds: [allocationA.reservationId, allocationB.reservationId],
          unitIds: [allocationA.unitId]
        }
      );
    }
  }

  return conflicts;
}

function getOperationalRemainingSlots(
  date,
  {
    availabilityProvider,
    postcode,
    zone,
    now
  }
) {
  if (
    !availabilityProvider ||
    typeof availabilityProvider.getAvailableSlots !== "function"
  ) {
    return { delivery: [], collection: [], provisional: true };
  }

  const buildRequest = (serviceType) => ({
    date,
    serviceType,
    postcode,
    zone,
    now
  });

  return {
    delivery: availabilityProvider
      .getAvailableSlots(buildRequest("delivery"))
      .map((slot) => ({ id: slot.id, label: slot.label })),
    collection: availabilityProvider
      .getAvailableSlots(buildRequest("collection"))
      .map((slot) => ({ id: slot.id, label: slot.label })),
    provisional: true
  };
}

function buildOperationalDay(
  date,
  {
    scheduleProvider = IGLOUE_SCHEDULE_PROVIDER,
    reservationProvider = IGLOUE_OPERATIONS_RESERVATION_PROVIDER,
    allocationProvider = IGLOUE_OPERATIONS_ALLOCATION_PROVIDER,
    availabilityProvider = IGLOUE_AVAILABILITY_PROVIDER,
    units = IGLOUE_MOCK_PHYSICAL_UNITS,
    planningPostcode = "16000",
    planningZone = null,
    now = new Date(),
    slotCapacity = IGLOUE_AVAILABILITY_SETTINGS.defaultCapacityPerSlot
  } = {}
) {
  const reservations = reservationProvider.getReservations();
  const busyPeriods = scheduleProvider
    .getBusyPeriods({ date })
    .map(normalizeOperationalBusyPeriod);
  const services = scoreOperationalRoute(
    reservationProvider
      .getServiceRecords({ date })
      .map(normalizeOperationalService)
  );
  const allocations = allocationProvider.getAllocations();
  const tasks = deriveOperationalTasks(date, services, reservations);
  const timeline = deriveOperationalTimeline(date, busyPeriods, services);
  const conflicts = analyzeOperationalConflicts({
    date,
    busyPeriods,
    services,
    reservations,
    allocations,
    units,
    slotCapacity
  });
  const remainingSlots = getOperationalRemainingSlots(date, {
    availabilityProvider,
    postcode: planningPostcode,
    zone: planningZone,
    now
  });
  const deliveries = services.filter(
    (service) => service.serviceType === "delivery"
  );
  const collections = services.filter(
    (service) => service.serviceType === "collection"
  );

  return {
    date,
    timeZone: "Europe/Paris",
    operatingRange: { startTime: "06:00", endTime: "21:00" },
    summary: {
      interventions: services.length,
      deliveries: deliveries.length,
      collections: collections.length,
      busyPeriods: busyPeriods.length,
      fleetActions: tasks.length,
      conflicts: conflicts.length
    },
    busyPeriods,
    services,
    deliveries,
    collections,
    allocations: allocations.filter((allocation) => (
      allocationTouchesOperationalDay(allocation, date)
    )),
    tasks,
    timeline,
    remainingSlots,
    conflicts,
    planningOnly: true,
    authoritative: false
  };
}

/*
  Future schedule boundary:
  TimeSquare/Google/other calendar -> adapter -> normalized busy periods ->
  schedule provider -> buildOperationalDay(). No calendar-specific object is
  permitted beyond the adapter.

  Production operations must be authenticated and server-backed. This static
  development view contains no security boundary and must never hold secrets,
  private calendar URLs or customer data.
*/
