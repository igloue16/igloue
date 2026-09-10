/*
  Development-only normalized reservation input for operations.html.

  Future Louez boundary:
  Louez -> reservation adapter -> normalized IGLOUE reservations/services ->
  buildOperationalDay(). The operations renderer must never consume Louez
  objects directly.

  No customer names, addresses, contact details or real fleet records belong
  in this static provider.
*/
const IGLOUE_MOCK_OPERATIONAL_RESERVATIONS = Object.freeze([
  {
    reservationId: "DEV-OPS-090",
    status: "confirmed",
    location: {
      postcode: "16000",
      zone: { id: "local", name: "Angoulême proche" }
    },
    product: {
      selectedProductId: "mobile-duo",
      requestedQuantity: 1
    },
    assignedUnitIds: ["D01"],
    rental: {
      deliveryDate: "2026-09-07",
      collectionDate: "2026-09-10"
    },
    delivery: {
      date: "2026-09-07",
      slotId: "0830-1030",
      setupMode: "delivery-only",
      expressSelected: false
    },
    collection: {
      date: "2026-09-10",
      slotId: "0830-1030"
    },
    operations: {
      collectionLabel: {
        required: true,
        applied: true,
        photoReference: null,
        needsUpdate: false
      }
    }
  },
  {
    reservationId: "DEV-OPS-100",
    status: "confirmed",
    location: {
      postcode: "16000",
      zone: { id: "local", name: "Angoulême proche" }
    },
    product: {
      selectedProductId: "essential",
      requestedQuantity: 1
    },
    assignedUnitIds: ["E01"],
    rental: {
      deliveryDate: "2026-09-10",
      collectionDate: "2026-09-13"
    },
    delivery: {
      date: "2026-09-10",
      slotId: "1430-1630",
      setupMode: "basic",
      expressSelected: false
    },
    collection: {
      date: "2026-09-13",
      slotId: "0830-1030"
    },
    operations: {
      collectionLabel: {
        required: true,
        applied: false,
        photoReference: null,
        needsUpdate: false
      }
    }
  },
  {
    reservationId: "DEV-OPS-110",
    status: "confirmed",
    location: {
      postcode: "16160",
      zone: { id: "greater-angouleme", name: "Grand Angoulême" }
    },
    product: {
      selectedProductId: "split-12",
      requestedQuantity: 1
    },
    assignedUnitIds: ["S01"],
    rental: {
      deliveryDate: "2026-09-11",
      collectionDate: "2026-09-16"
    },
    delivery: {
      date: "2026-09-11",
      slotId: "1430-1630",
      setupMode: "window-installation",
      expressSelected: false
    },
    collection: {
      date: "2026-09-16",
      slotId: "1030-1230"
    },
    operations: {
      collectionLabel: {
        required: true,
        applied: false,
        photoReference: null,
        needsUpdate: false
      }
    }
  },
  {
    reservationId: "DEV-OPS-120",
    status: "confirmed",
    location: {
      postcode: "16400",
      zone: { id: "greater-angouleme", name: "Grand Angoulême" }
    },
    product: {
      selectedProductId: "mobile-duo",
      requestedQuantity: 1
    },
    assignedUnitIds: ["D02"],
    rental: {
      deliveryDate: "2026-09-12",
      collectionDate: "2026-09-17"
    },
    delivery: {
      date: "2026-09-12",
      slotId: "0830-1030",
      setupMode: "delivery-only",
      expressSelected: false
    },
    collection: {
      date: "2026-09-17",
      slotId: "0830-1030"
    },
    operations: {
      collectionLabel: {
        required: true,
        applied: false,
        photoReference: null,
        needsUpdate: false
      }
    }
  },
  {
    reservationId: "DEV-OPS-121",
    status: "active",
    location: {
      postcode: "16000",
      zone: { id: "local", name: "Angoulême proche" }
    },
    product: {
      selectedProductId: "split-12",
      requestedQuantity: 1
    },
    assignedUnitIds: ["S02"],
    rental: {
      deliveryDate: "2026-09-06",
      collectionDate: "2026-09-12"
    },
    delivery: {
      date: "2026-09-06",
      slotId: "0830-1030",
      setupMode: "window-installation",
      expressSelected: false
    },
    collection: {
      date: "2026-09-12",
      slotId: "1030-1230"
    },
    operations: {
      collectionLabel: {
        required: true,
        applied: true,
        photoReference: null,
        needsUpdate: false
      }
    }
  }
]);

function cloneOperationalReservation(reservation) {
  return {
    ...reservation,
    location: {
      ...reservation.location,
      zone: reservation.location.zone
        ? { ...reservation.location.zone }
        : null
    },
    product: { ...reservation.product },
    assignedUnitIds: [...reservation.assignedUnitIds],
    rental: { ...reservation.rental },
    delivery: { ...reservation.delivery },
    collection: { ...reservation.collection },
    operations: {
      ...reservation.operations,
      collectionLabel: {
        ...reservation.operations.collectionLabel
      }
    }
  };
}

const IGLOUE_OPERATIONS_RESERVATION_PROVIDER = {
  getReservations() {
    return IGLOUE_MOCK_OPERATIONAL_RESERVATIONS.map(
      cloneOperationalReservation
    );
  },

  getServiceRecords({ date }) {
    return this.getReservations().flatMap((reservation) => {
      const base = {
        reservationId: reservation.reservationId,
        productId: reservation.product.selectedProductId,
        postcode: reservation.location.postcode,
        zoneId: reservation.location.zone
          ? reservation.location.zone.id
          : null,
        zoneName: reservation.location.zone
          ? reservation.location.zone.name
          : null,
        unitIds: [...reservation.assignedUnitIds],
        assignedResourceIds: ["operations-primary"],
        assignedVehicleId: null,
        routePreferenceScore: 0,
        status: "scheduled"
      };
      const services = [];

      if (reservation.delivery.date === date) {
        services.push({
          ...base,
          serviceId: `${reservation.reservationId}-delivery`,
          serviceType: "delivery",
          date,
          slotId: reservation.delivery.slotId,
          setupMode: reservation.delivery.setupMode,
          expressSelected: reservation.delivery.expressSelected
        });
      }

      if (reservation.collection.date === date) {
        services.push({
          ...base,
          serviceId: `${reservation.reservationId}-collection`,
          serviceType: "collection",
          date,
          slotId: reservation.collection.slotId,
          setupMode: null,
          expressSelected: false
        });
      }

      return services;
    });
  }
};

function buildMockOperationsAllocationProvider(
  reservationProvider = IGLOUE_OPERATIONS_RESERVATION_PROVIDER
) {
  const allocations = reservationProvider.getReservations().flatMap(
    (reservation) => {
      const operationalPeriod = buildFleetOperationalPeriod(reservation);

      if (!operationalPeriod) {
        return [];
      }

      return reservation.assignedUnitIds.map((unitId) => (
        createFleetAllocation({
          allocationId: `DEV-${reservation.reservationId}-${unitId}`,
          reservationId: reservation.reservationId,
          unitId,
          productId: reservation.product.selectedProductId,
          operationalStart: operationalPeriod.operationalStart,
          operationalEnd: operationalPeriod.operationalEnd,
          status: reservation.status === "active" ? "active" : "reserved"
        })
      ));
    }
  );

  return createFleetAllocationProvider(allocations);
}

const IGLOUE_OPERATIONS_ALLOCATION_PROVIDER =
  buildMockOperationsAllocationProvider();
