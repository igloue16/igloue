const IGLOUE_SERVICE_WINDOWS = [
  { id: "0830-1030", startTime: "08:30", endTime: "10:30", displayLabel: "08:30–10:30" },
  { id: "1030-1230", startTime: "10:30", endTime: "12:30", displayLabel: "10:30–12:30" },
  { id: "1230-1430", startTime: "12:30", endTime: "14:30", displayLabel: "12:30–14:30" },
  { id: "1430-1630", startTime: "14:30", endTime: "16:30", displayLabel: "14:30–16:30" },
  { id: "1630-1830", startTime: "16:30", endTime: "18:30", displayLabel: "16:30–18:30" },
  { id: "1830-2030", startTime: "18:30", endTime: "20:30", displayLabel: "18:30–20:30" }
];

const IGLOUE_AVAILABILITY_SETTINGS = {
  timeZone: "Europe/Paris",
  busyBufferBeforeMinutes: 30,
  busyBufferAfterMinutes: 30,
  defaultCapacityPerSlot: 1,
  sameDayExpress: {
    cutoffHour: 10,
    availableFutureDeliverySlotsEligible: true
  }
};

const IGLOUE_SLOT_REASON = {
  CLOSED_DAY: "closed-day",
  MANUAL_BLOCK: "manual-block",
  BUSY_PERIOD: "busy-period",
  BUFFER_CONFLICT: "buffer-conflict",
  CAPACITY_FULL: "capacity-full",
  PAST_TIME: "past-time",
  EXPRESS_CUTOFF: "express-cutoff",
  OUTSIDE_SERVICE_AREA: "outside-service-area"
};

function availabilityTimeToMinutes(value) {
  const [hours, minutes] = String(value).split(":").map(Number);
  return (hours * 60) + minutes;
}

function getAvailabilityOperationalTime(now = new Date()) {
  if (
    now &&
    typeof now === "object" &&
    typeof now.date === "string" &&
    Number.isFinite(now.hour)
  ) {
    return {
      date: now.date,
      hour: now.hour,
      minute: Number(now.minute) || 0
    };
  }

  return getFranceLocalDateTime(now);
}

function getAvailabilityZone({ postcode, zone }) {
  if (zone && typeof zone === "object") {
    return zone;
  }

  if (typeof zone === "string") {
    return getDeliveryZoneById(zone);
  }

  return getDeliveryZoneByPostcode(postcode);
}

function getAvailabilityConflict(slot, busyPeriods) {
  const slotStart = availabilityTimeToMinutes(slot.startTime);
  const slotEnd = availabilityTimeToMinutes(slot.endTime);

  for (const period of busyPeriods) {
    const busyStart = availabilityTimeToMinutes(period.startTime);
    const busyEnd = availabilityTimeToMinutes(period.endTime);
    const overlapsBusy = slotStart < busyEnd && slotEnd > busyStart;
    const overlapsBufferedBusy =
      slotStart < busyEnd + IGLOUE_AVAILABILITY_SETTINGS.busyBufferAfterMinutes &&
      slotEnd > busyStart - IGLOUE_AVAILABILITY_SETTINGS.busyBufferBeforeMinutes;

    if (overlapsBusy) {
      return IGLOUE_SLOT_REASON.BUSY_PERIOD;
    }

    if (overlapsBufferedBusy) {
      return IGLOUE_SLOT_REASON.BUFFER_CONFLICT;
    }
  }

  return null;
}

function getRoutePreferenceScore() {
  // Future postcode/commune/route scoring plugs in here; V1 stays neutral.
  return 0;
}

function evaluateIgloueServiceSlots({
  date,
  serviceType,
  postcode = "",
  zone = null,
  productId = null,
  bookingContext = null,
  now = new Date(),
  capacityPerSlot = IGLOUE_AVAILABILITY_SETTINGS.defaultCapacityPerSlot,
  scheduleProvider = IGLOUE_SCHEDULE_PROVIDER,
  bookingsProvider = IGLOUE_BOOKINGS_PROVIDER
} = {}) {
  if (!date || !["delivery", "collection"].includes(serviceType)) {
    return [];
  }

  const operationalTime = getAvailabilityOperationalTime(now);
  const resolvedZone = getAvailabilityZone({ postcode, zone });
  const busyPeriods = scheduleProvider.getBusyPeriods({
    date,
    serviceType,
    postcode,
    zone: resolvedZone,
    productId,
    bookingContext
  });
  const manualOverride = scheduleProvider.getManualOverride({
    date,
    serviceType,
    postcode,
    zone: resolvedZone,
    productId,
    bookingContext
  });
  const bookedServices = bookingsProvider.getBookedServices({
    date,
    serviceType,
    postcode,
    zone: resolvedZone,
    productId,
    bookingContext
  });

  return IGLOUE_SERVICE_WINDOWS.map((windowDefinition) => {
    const reservedCount = bookedServices.filter(
      (service) => service.slotId === windowDefinition.id
    ).length;
    const remainingCapacity = Math.max(0, capacityPerSlot - reservedCount);
    const disabledManually = manualOverride.disabledSlots.includes(windowDefinition.id);
    const forcedEnabled = manualOverride.forceEnabledSlots.includes(windowDefinition.id);
    const slotStartMinutes = availabilityTimeToMinutes(windowDefinition.startTime);
    const currentMinutes = (operationalTime.hour * 60) + operationalTime.minute;

    let reasonUnavailable = null;

    if (!resolvedZone) {
      reasonUnavailable = IGLOUE_SLOT_REASON.OUTSIDE_SERVICE_AREA;
    } else if (manualOverride.closed) {
      reasonUnavailable = IGLOUE_SLOT_REASON.CLOSED_DAY;
    } else if (disabledManually) {
      reasonUnavailable = IGLOUE_SLOT_REASON.MANUAL_BLOCK;
    } else if (date < operationalTime.date || (date === operationalTime.date && slotStartMinutes <= currentMinutes)) {
      reasonUnavailable = IGLOUE_SLOT_REASON.PAST_TIME;
    } else if (remainingCapacity <= 0) {
      reasonUnavailable = IGLOUE_SLOT_REASON.CAPACITY_FULL;
    } else if (!forcedEnabled) {
      reasonUnavailable = getAvailabilityConflict(windowDefinition, busyPeriods);
    }

    const available = reasonUnavailable === null;
    const expressEligible = Boolean(
      available &&
      serviceType === "delivery" &&
      date === operationalTime.date &&
      operationalTime.hour < IGLOUE_AVAILABILITY_SETTINGS.sameDayExpress.cutoffHour &&
      IGLOUE_AVAILABILITY_SETTINGS.sameDayExpress.availableFutureDeliverySlotsEligible
    );

    return {
      id: windowDefinition.id,
      startTime: windowDefinition.startTime,
      endTime: windowDefinition.endTime,
      label: windowDefinition.displayLabel,
      serviceType,
      available,
      capacity: capacityPerSlot,
      reservedCount,
      remainingCapacity,
      reasonUnavailable,
      expressEligible,
      routePreferenceScore: getRoutePreferenceScore({
        postcode,
        zone: resolvedZone,
        bookedServices
      })
    };
  });
}

function getAvailableIgloueServiceSlots(request) {
  return evaluateIgloueServiceSlots(request)
    .filter((slot) => slot.available)
    .sort((a, b) => b.routePreferenceScore - a.routePreferenceScore);
}

const IGLOUE_AVAILABILITY_PROVIDER = {
  evaluateSlots: evaluateIgloueServiceSlots,
  getAvailableSlots: getAvailableIgloueServiceSlots,

  hasAvailableSameDaySlot({ postcode, deliveryDate, zone = null, now = new Date() } = {}) {
    return getAvailableIgloueServiceSlots({
      date: deliveryDate,
      serviceType: "delivery",
      postcode,
      zone,
      now
    }).some((slot) => slot.expressEligible);
  }
};

globalThis.IGLOUE_DELIVERY_SLOT_PROVIDER = IGLOUE_AVAILABILITY_PROVIDER;
