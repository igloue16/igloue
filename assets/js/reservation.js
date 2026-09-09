const IGLOUE_RESERVATION_STATUSES = Object.freeze([
  "draft",
  "pending",
  "confirmed",
  "active",
  "completed",
  "cancelled"
]);

const IGLOUE_SERVICE_STATUSES = Object.freeze([
  "scheduled",
  "en-route",
  "completed",
  "failed",
  "cancelled"
]);

const IGLOUE_SERVICE_TRANSITIONS = Object.freeze({
  scheduled: ["en-route", "completed", "failed", "cancelled"],
  "en-route": ["completed", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: []
});

const IGLOUE_PAYMENT_STATUSES = Object.freeze([
  "not-started",
  "pending",
  "paid",
  "partially-paid",
  "refunded",
  "failed"
]);

const IGLOUE_BOOKING_MODES = Object.freeze([
  "instant",
  "manual-review"
]);

const IGLOUE_RESERVATION_TRANSITIONS = Object.freeze({
  draft: ["pending", "cancelled"],
  pending: ["draft", "confirmed", "cancelled"],
  confirmed: ["active", "cancelled"],
  active: ["completed"],
  completed: [],
  cancelled: []
});

function canTransitionReservationStatus(currentStatus, nextStatus) {
  return Boolean(
    IGLOUE_RESERVATION_TRANSITIONS[currentStatus] &&
    IGLOUE_RESERVATION_TRANSITIONS[currentStatus].includes(nextStatus)
  );
}

function transitionReservationStatus(reservation, nextStatus) {
  if (
    !reservation ||
    !canTransitionReservationStatus(reservation.status, nextStatus)
  ) {
    return false;
  }

  return {
    ...reservation,
    status: nextStatus
  };
}

function canTransitionServiceStatus(currentStatus, nextStatus) {
  return Boolean(
    IGLOUE_SERVICE_TRANSITIONS[currentStatus] &&
    IGLOUE_SERVICE_TRANSITIONS[currentStatus].includes(nextStatus)
  );
}

function transitionServiceStatus(service, nextStatus) {
  if (
    !service ||
    !canTransitionServiceStatus(service.status, nextStatus)
  ) {
    return false;
  }

  return {
    ...service,
    status: nextStatus
  };
}

function getReservationNightCount(startDate, endDate) {
  if (!startDate || !endDate) {
    return 0;
  }

  const startParts = startDate.split("-").map(Number);
  const endParts = endDate.split("-").map(Number);

  if (startParts.length !== 3 || endParts.length !== 3) {
    return 0;
  }

  const startValue = Date.UTC(
    startParts[0],
    startParts[1] - 1,
    startParts[2]
  );
  const endValue = Date.UTC(
    endParts[0],
    endParts[1] - 1,
    endParts[2]
  );

  return Math.max(
    0,
    Math.round((endValue - startValue) / 86400000)
  );
}

function getReservationBookingMode(reservation) {
  if (
    reservation &&
    reservation.requirements &&
    (
      reservation.requirements.manualAssessmentRequired ||
      reservation.delivery.setupMode === "special"
    )
  ) {
    return "manual-review";
  }

  return "instant";
}

function validateNormalizedReservationDraft(reservation, minimumNights = 3) {
  const issues = [];
  const addIssue = (code, section, message) => {
    issues.push({ code, section, message });
  };

  if (
    !reservation.location.postcode ||
    !reservation.location.zone
  ) {
    addIssue(
      "service-area-missing",
      "delivery",
      "Vérifiez votre code postal et votre zone de livraison."
    );
  }

  if (!reservation.product.selectedProductId) {
    addIssue(
      "product-missing",
      "product",
      "Choisissez un modèle avant de continuer."
    );
  }

  if (!reservation.rental.deliveryDate || !reservation.rental.collectionDate) {
    addIssue(
      "rental-dates-missing",
      "dates",
      "Choisissez vos dates de livraison et de reprise."
    );
  } else if (reservation.rental.nights < minimumNights) {
    addIssue(
      "minimum-duration",
      "dates",
      `La location doit durer au moins ${minimumNights} nuits.`
    );
  }

  if (!reservation.delivery.slotId) {
    addIssue(
      "delivery-slot-missing",
      "dates",
      "Choisissez un créneau de livraison."
    );
  }

  if (!reservation.collection.slotId) {
    addIssue(
      "collection-slot-missing",
      "dates",
      "Choisissez un créneau de reprise."
    );
  }

  const opening = reservation.requirements.opening;

  if (!opening.type) {
    addIssue(
      "opening-missing",
      "opening",
      "Précisez le type d'ouverture disponible."
    );
  }

  if (
    opening.type === "velux" &&
    !opening.roofWindowBottomHeightRange
  ) {
    addIssue(
      "roof-window-height-missing",
      "opening",
      "Précisez la hauteur de votre fenêtre de toit."
    );
  }

  if (!reservation.delivery.setupMode) {
    addIssue(
      "setup-missing",
      "opening",
      "Choisissez votre mode d'installation."
    );
  }

  if (
    !reservation.pricing ||
    !Number.isFinite(Number(reservation.pricing.total))
  ) {
    addIssue(
      "pricing-missing",
      "dates",
      "Le tarif doit être recalculé avant de continuer."
    );
  }

  return {
    valid: issues.length === 0,
    issues
  };
}

/*
  This is IGLOUE's canonical client-side draft boundary:

  assistant state -> normalized IGLOUE reservation -> future backend adapter.

  A Louez adapter will translate this object to/from Louez later. Louez's
  external representation must not become the internal source of truth.
*/
function buildNormalizedReservationDraft(state) {
  const selectedProduct = state.recommendedProduct || null;
  const recommendedProduct = state.idealProduct || selectedProduct;
  const zone = state.deliveryZone || null;
  const deliveryDate = state.startDate || "";
  const collectionDate = state.endDate || "";

  const reservation = {
    reservationId: null,
    status: "draft",

    customer: {
      customerId: null
    },

    location: {
      postcode: state.postcode || "",
      zone: zone
        ? {
            id: zone.id,
            name: zone.name
          }
        : null
    },

    product: {
      selectedProductId: selectedProduct ? selectedProduct.id : null,
      recommendedProductId: recommendedProduct ? recommendedProduct.id : null,
      requestedQuantity: 1
    },

    assignedUnitIds: [],

    requirements: {
      manualAssessmentRequired: Boolean(
        state.requiresAssessment ||
        state.installationAssessmentRequired
      ),

      room: {
        type: state.roomType || "",
        subtype: state.roomSubtype || null,
        area: Number(state.roomArea) || null,
        conditions: [...(state.roomConditions || [])]
      },
      opening: {
        type: state.openingType || "",
        hasAccessibleOutdoorSpace:
          typeof state.hasAccessibleOutdoorSpace === "boolean"
            ? state.hasAccessibleOutdoorSpace
            : null,
        roofWindowBottomHeightRange: state.veluxBottomHeightRange || null,
        installationAssessmentRequired: Boolean(
          state.installationAssessmentRequired
        ),
        extendedExhaustRequired: Boolean(state.extendedExhaustRequired)
      }
    },

    rental: {
      deliveryDate,
      collectionDate,
      nights: getReservationNightCount(deliveryDate, collectionDate)
    },

    delivery: {
      date: deliveryDate,
      slotId: state.deliverySlotId || null,
      expressSelected: Boolean(state.sameDayExpressSelected),
      setupMode: state.setupMode || null
    },

    collection: {
      date: collectionDate,
      slotId: state.collectionSlotId || null
    },

    pricing: state.pricing
      ? { ...state.pricing }
      : null,

    payment: {
      status: "not-started"
    },

    contract: {
      contractId: null,
      status: "not-started",
      signedAt: null
    },

    operations: {
      deliveryEvidence: null,
      collectionEvidence: null,
      collectionLabel: {
        required: true,
        applied: false,
        photoReference: null,
        needsUpdate: false
      }
    },

    source: "website-assistant"
  };

  reservation.bookingMode =
    getReservationBookingMode(reservation);

  return reservation;
}

/*
  Canonical adapter between a reservation and the service-record shape read
  by bookings-provider.js / availability.js. A future reservation store or
  Louez adapter can feed the same records without changing the slot engine.
*/
function buildReservationServiceRecords(reservation) {
  if (!reservation) {
    return [];
  }

  const baseRecord = {
    reservationId: reservation.reservationId,
    postcode: reservation.location ? reservation.location.postcode : "",
    zoneId:
      reservation.location && reservation.location.zone
        ? reservation.location.zone.id
        : null,
    status: "scheduled",
    assignedResourceIds: []
  };

  return [
    {
      ...baseRecord,
      serviceId: null,
      serviceType: "delivery",
      date: reservation.delivery.date,
      slotId: reservation.delivery.slotId
    },
    {
      ...baseRecord,
      serviceId: null,
      serviceType: "collection",
      date: reservation.collection.date,
      slotId: reservation.collection.slotId
    }
  ];
}
