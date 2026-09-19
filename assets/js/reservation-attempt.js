(function createReservationAttempt(global) {
  let currentAttempt = null;

  function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
  }

  function optionalString(value) {
    return value === undefined || value === null || typeof value === "string";
  }

  function isValidMaterialPayload(value) {
    return isObject(value) &&
      isObject(value.customer) &&
      isNonEmptyString(value.customer.firstName) &&
      isNonEmptyString(value.customer.lastName) &&
      isNonEmptyString(value.customer.email) &&
      optionalString(value.customer.phone) &&
      isNonEmptyString(value.productId) &&
      isObject(value.deliveryAddress) &&
      isNonEmptyString(value.deliveryAddress.line1) &&
      optionalString(value.deliveryAddress.line2) &&
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

  function fingerprint(value) {
    return JSON.stringify({
      customer: {
        firstName: value.customer.firstName,
        lastName: value.customer.lastName,
        email: value.customer.email,
        phone: value.customer.phone ?? null
      },
      productId: value.productId,
      deliveryAddress: {
        line1: value.deliveryAddress.line1,
        line2: value.deliveryAddress.line2 ?? null,
        postcode: value.deliveryAddress.postcode,
        city: value.deliveryAddress.city
      },
      rental: {
        startDate: value.rental.startDate,
        endDate: value.rental.endDate
      },
      service: {
        deliverySlotId: value.service.deliverySlotId,
        collectionSlotId: value.service.collectionSlotId,
        setupMode: value.service.setupMode,
        expressSelected: value.service.expressSelected
      }
    });
  }

  function prepareAttempt(materialPayload) {
    if (!isValidMaterialPayload(materialPayload)) {
      return null;
    }

    const currentFingerprint = fingerprint(materialPayload);
    if (currentAttempt && currentAttempt.fingerprint === currentFingerprint) {
      return currentAttempt.idempotencyKey;
    }

    if (!global.crypto || typeof global.crypto.randomUUID !== "function") {
      return null;
    }

    const idempotencyKey = global.crypto.randomUUID();
    currentAttempt = { idempotencyKey, fingerprint: currentFingerprint };
    return idempotencyKey;
  }

  function resetAttempt() {
    currentAttempt = null;
  }

  global.IGLOUE_RESERVATION_ATTEMPT = Object.freeze({
    prepareAttempt,
    resetAttempt
  });
})(window);
