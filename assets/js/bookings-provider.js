/*
  Mock booked-service input.

  A future Louez adapter should normalize reservations to this shape before
  they reach the availability engine:
  {
    serviceId, reservationId, date, slotId, serviceType, postcode, zoneId,
    assignedResourceIds, status
  }
*/
const IGLOUE_MOCK_BOOKED_SERVICES = [
  {
    serviceId: "mock-service-001",
    reservationId: "mock-reservation-001",
    date: "2026-09-15",
    slotId: "1030-1230",
    serviceType: "delivery",
    postcode: "16000",
    zoneId: "local",
    assignedResourceIds: ["operations-primary"],
    status: "scheduled"
  },
  {
    serviceId: "mock-service-002",
    reservationId: "mock-reservation-002",
    date: "2026-09-15",
    slotId: "1430-1630",
    serviceType: "collection",
    postcode: "16430",
    zoneId: "greater-angouleme",
    assignedResourceIds: ["operations-primary"],
    status: "scheduled"
  }
];

const IGLOUE_BOOKINGS_PROVIDER = {
  getBookedServices({ date, serviceType }) {
    return IGLOUE_MOCK_BOOKED_SERVICES.filter(
      (service) =>
        service.date === date &&
        service.serviceType === serviceType &&
        ["scheduled", "en-route"].includes(service.status)
    ).map((service) => ({ ...service }));
  }
};
