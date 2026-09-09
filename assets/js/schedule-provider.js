/*
  Mock operational schedule input.

  A future TimeSquare/iCalendar adapter only needs to emit normalized busy
  periods with this shape:
  {
    id, date, startTime, endTime, type, source, resourceId, resourceType
  }

  The availability engine deliberately does not know which external system
  produced these records.
*/
const IGLOUE_MOCK_SCHEDULE_INPUT = [
  {
    id: "mock-early-shift",
    date: "2026-09-11",
    startTime: "06:00",
    endTime: "13:30",
    source: "mock-schedule"
  },
  {
    id: "mock-afternoon-shift",
    date: "2026-09-12",
    startTime: "12:30",
    endTime: "19:30",
    source: "mock-schedule"
  }
];

const IGLOUE_MOCK_MANUAL_AVAILABILITY = [
  {
    date: "2026-09-13",
    closed: true,
    disabledSlots: [],
    forceEnabledSlots: []
  },
  {
    date: "2026-09-14",
    closed: false,
    disabledSlots: ["0830-1030"],
    forceEnabledSlots: ["1830-2030"]
  }
];

function normalizeMockBusyPeriod(record) {
  return {
    id: record.id,
    date: record.date,
    startTime: record.startTime,
    endTime: record.endTime,
    type: "busy",
    source: record.source || "mock-schedule",
    resourceId: record.resourceId || "operations-primary",
    resourceType: record.resourceType || "driver"
  };
}

const IGLOUE_SCHEDULE_PROVIDER = {
  getBusyPeriods({ date }) {
    return IGLOUE_MOCK_SCHEDULE_INPUT
      .filter((record) => record.date === date)
      .map(normalizeMockBusyPeriod);
  },

  getManualOverride({ date, serviceType }) {
    const override =
      IGLOUE_MOCK_MANUAL_AVAILABILITY.find(
        (record) =>
          record.date === date &&
          (!record.serviceType || record.serviceType === serviceType)
      );

    if (!override) {
      return {
        date,
        closed: false,
        disabledSlots: [],
        forceEnabledSlots: []
      };
    }

    return {
      date,
      closed: Boolean(override.closed),
      disabledSlots: [...(override.disabledSlots || [])],
      forceEnabledSlots: [...(override.forceEnabledSlots || [])]
    };
  }
};
