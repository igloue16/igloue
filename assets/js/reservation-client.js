(function createReservationClient(global) {
  const endpointName = "create-reservation";
  const knownErrorCodes = new Set([
    "INVALID_REQUEST",
    "INVALID_CUSTOMER",
    "INVALID_ADDRESS",
    "INVALID_PRODUCT",
    "INVALID_DATES",
    "INVALID_SERVICE_WINDOW",
    "INVALID_SETUP",
    "EXPRESS_NOT_ALLOWED",
    "NO_MACHINE_AVAILABLE",
    "RESERVATION_EXPIRED",
    "RESERVATION_UNAVAILABLE",
    "IDEMPOTENCY_CONFLICT",
    "TOO_MANY_ACTIVE_HOLDS",
    "METHOD_NOT_ALLOWED",
    "PAYLOAD_TOO_LARGE",
    "INTERNAL_ERROR"
  ]);

  function getConfig() {
    const config = global.IGLOUE_SUPABASE_CONFIG || {};
    const projectUrl = String(config.projectUrl || "").replace(/\/+$/, "");
    const publishableKey = String(config.publishableKey || "");

    if (
      !projectUrl ||
      !publishableKey ||
      /YOUR_PROJECT_REF|REPLACE_WITH_PROJECT_KEY/i.test(projectUrl + publishableKey)
    ) {
      throw new Error("PUBLIC_CONFIGURATION_ERROR");
    }

    return { projectUrl, publishableKey };
  }

  function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
  }

  function isValidRequest(value) {
    return isObject(value) &&
      isNonEmptyString(value.idempotencyKey) &&
      isObject(value.customer) &&
      isNonEmptyString(value.customer.firstName) &&
      isNonEmptyString(value.customer.lastName) &&
      isNonEmptyString(value.customer.email) &&
      (value.customer.phone === null || value.customer.phone === undefined || typeof value.customer.phone === "string") &&
      isNonEmptyString(value.productId) &&
      isObject(value.deliveryAddress) &&
      isNonEmptyString(value.deliveryAddress.line1) &&
      (value.deliveryAddress.line2 === null || value.deliveryAddress.line2 === undefined || typeof value.deliveryAddress.line2 === "string") &&
      isNonEmptyString(value.deliveryAddress.postcode) &&
      isNonEmptyString(value.deliveryAddress.city) &&
      isObject(value.rental) &&
      isNonEmptyString(value.rental.startDate) &&
      isNonEmptyString(value.rental.endDate) &&
      isObject(value.service) &&
      isNonEmptyString(value.service.deliverySlotId) &&
      isNonEmptyString(value.service.collectionSlotId) &&
      isNonEmptyString(value.service.setupMode) &&
      typeof value.service.expressSelected === "boolean";
  }

  function buildRequestBody(input) {
    return {
      idempotencyKey: input.idempotencyKey,
      customer: {
        firstName: input.customer.firstName,
        lastName: input.customer.lastName,
        email: input.customer.email,
        phone: input.customer.phone === undefined ? null : input.customer.phone
      },
      productId: input.productId,
      deliveryAddress: {
        line1: input.deliveryAddress.line1,
        line2: input.deliveryAddress.line2 === undefined ? null : input.deliveryAddress.line2,
        postcode: input.deliveryAddress.postcode,
        city: input.deliveryAddress.city
      },
      rental: {
        startDate: input.rental.startDate,
        endDate: input.rental.endDate
      },
      service: {
        deliverySlotId: input.service.deliverySlotId,
        collectionSlotId: input.service.collectionSlotId,
        setupMode: input.service.setupMode,
        expressSelected: input.service.expressSelected
      }
    };
  }

  function normalizeSuccess(payload) {
    if (
      !isObject(payload) ||
      payload.ok !== true ||
      !isObject(payload.reservation) ||
      !isNonEmptyString(payload.reservation.reference) ||
      !isNonEmptyString(payload.reservation.status) ||
      (payload.reservation.holdExpiresAt !== null &&
        !isNonEmptyString(payload.reservation.holdExpiresAt)) ||
      !isNonEmptyString(payload.productId) ||
      !isObject(payload.rental) ||
      !isNonEmptyString(payload.rental.startDate) ||
      !isNonEmptyString(payload.rental.endDate) ||
      typeof payload.rental.nights !== "number" ||
      !Number.isFinite(payload.rental.nights) ||
      !isObject(payload.deliveryZone) ||
      !isNonEmptyString(payload.deliveryZone.name) ||
      !isObject(payload.pricing) ||
      !isNonEmptyString(payload.pricing.currency) ||
      !["rentalPrice", "deliveryFee", "setupPrice", "expressPrice", "totalAmount", "depositAmount"]
        .every((field) => typeof payload.pricing[field] === "number" && Number.isFinite(payload.pricing[field]))
    ) {
      throw new Error("INVALID_SUCCESS_RESPONSE");
    }

    return {
      status: "success",
      reservation: {
        reference: payload.reservation.reference,
        status: payload.reservation.status,
        holdExpiresAt: payload.reservation.holdExpiresAt
      },
      productId: payload.productId,
      rental: {
        startDate: payload.rental.startDate,
        endDate: payload.rental.endDate,
        nights: payload.rental.nights
      },
      deliveryZone: { name: payload.deliveryZone.name },
      pricing: {
        currency: payload.pricing.currency,
        rentalPrice: payload.pricing.rentalPrice,
        deliveryFee: payload.pricing.deliveryFee,
        setupPrice: payload.pricing.setupPrice,
        expressPrice: payload.pricing.expressPrice,
        totalAmount: payload.pricing.totalAmount,
        depositAmount: payload.pricing.depositAmount
      }
    };
  }

  function normalizeError(payload) {
    if (
      isObject(payload) &&
      payload.ok === false &&
      isObject(payload.error) &&
      typeof payload.error.code === "string" &&
      knownErrorCodes.has(payload.error.code)
    ) {
      return { status: "error", code: payload.error.code };
    }
    return { status: "error", code: "INTERNAL_ERROR" };
  }

  async function createReservation(input) {
    try {
      if (!isValidRequest(input)) {
        return { status: "error", code: "INVALID_REQUEST" };
      }

      const config = getConfig();
      const response = await global.fetch(`${config.projectUrl}/functions/v1/${endpointName}`, {
        method: "POST",
        headers: {
          apikey: config.publishableKey,
          "content-type": "application/json"
        },
        body: JSON.stringify(buildRequestBody(input))
      });

      let payload;
      try {
        payload = await response.json();
      } catch {
        return { status: "error", code: "INTERNAL_ERROR" };
      }

      if (response.ok && payload && payload.ok === true) {
        try {
          return normalizeSuccess(payload);
        } catch {
          return { status: "error", code: "INTERNAL_ERROR" };
        }
      }

      return normalizeError(payload);
    } catch {
      return { status: "error", code: "INTERNAL_ERROR" };
    }
  }

  global.IGLOUE_RESERVATION_CLIENT = Object.freeze({ createReservation });
})(window);
