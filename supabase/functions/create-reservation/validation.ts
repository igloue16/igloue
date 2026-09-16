import { IGLOUE_SERVER_PRICING } from "./pricing.ts";

export const IGLOUE_SERVER_SERVICE_WINDOWS = Object.freeze([
  { id: "0830-1030", startTime: "08:30", endTime: "10:30" },
  { id: "1030-1230", startTime: "10:30", endTime: "12:30" },
  { id: "1230-1430", startTime: "12:30", endTime: "14:30" },
  { id: "1430-1630", startTime: "14:30", endTime: "16:30" },
  { id: "1630-1830", startTime: "16:30", endTime: "18:30" },
  { id: "1830-2030", startTime: "18:30", endTime: "20:30" },
]);

function isValidServiceWindowId(slotId: string) {
  return IGLOUE_SERVER_SERVICE_WINDOWS.some(
    (serviceWindow) => serviceWindow.id === slotId,
  );
}

export function validateProductId(productId: unknown) {
  if (
    typeof productId !== "string" ||
    !(productId in IGLOUE_SERVER_PRICING.products)
  ) {
    return {
      ok: false as const,
      error: "Invalid productId",
    };
  }

  return {
    ok: true as const,
    productId,
  };
}

export function validateCustomer(customer: unknown) {
  if (
    typeof customer !== "object" ||
    customer === null
  ) {
    return {
      ok: false as const,
      error: "Invalid customer",
    };
  }

  const value = customer as Record<string, unknown>;

  if (
    typeof value.firstName !== "string" ||
    value.firstName.trim() === ""
  ) {
    return {
      ok: false as const,
      error: "Invalid firstName",
    };
  }

  if (
    typeof value.lastName !== "string" ||
    value.lastName.trim() === ""
  ) {
    return {
      ok: false as const,
      error: "Invalid lastName",
    };
  }

  if (
    typeof value.email !== "string" ||
    value.email.trim() === ""
  ) {
    return {
      ok: false as const,
      error: "Invalid email",
    };
  }

  if (
    value.phone !== undefined &&
    value.phone !== null &&
    typeof value.phone !== "string"
  ) {
    return {
      ok: false as const,
      error: "Invalid phone",
    };
  }

  return {
    ok: true as const,
    customer: {
      firstName: value.firstName.trim(),
      lastName: value.lastName.trim(),
      email: value.email.trim(),
      phone:
        typeof value.phone === "string"
          ? value.phone.trim()
          : null,
    },
  };
}

export function validateDeliveryAddress(address: unknown) {
  if (
    typeof address !== "object" ||
    address === null
  ) {
    return {
      ok: false as const,
      error: "Invalid deliveryAddress",
    };
  }

  const value = address as Record<string, unknown>;

  if (
    typeof value.line1 !== "string" ||
    value.line1.trim() === ""
  ) {
    return {
      ok: false as const,
      error: "Invalid delivery address line1",
    };
  }

  if (
    typeof value.postcode !== "string" ||
    value.postcode.trim() === ""
  ) {
    return {
      ok: false as const,
      error: "Invalid delivery postcode",
    };
  }

  if (
    typeof value.city !== "string" ||
    value.city.trim() === ""
  ) {
    return {
      ok: false as const,
      error: "Invalid delivery city",
    };
  }

  return {
    ok: true as const,
    address: {
      line1: value.line1.trim(),
      line2:
        typeof value.line2 === "string"
          ? value.line2.trim()
          : null,
      postcode: value.postcode.trim(),
      city: value.city.trim(),
    },
  };
}

export function validateRentalDates(rental: unknown) {
  if (
    typeof rental !== "object" ||
    rental === null
  ) {
    return {
      ok: false as const,
      error: "Invalid rental",
    };
  }

  const value = rental as Record<string, unknown>;

  if (
    typeof value.startDate !== "string" ||
    value.startDate.trim() === ""
  ) {
    return {
      ok: false as const,
      error: "Invalid rental startDate",
    };
  }

  if (
    typeof value.endDate !== "string" ||
    value.endDate.trim() === ""
  ) {
    return {
      ok: false as const,
      error: "Invalid rental endDate",
    };
  }

  const startDate = value.startDate.trim();
  const endDate = value.endDate.trim();

  const start = new Date(`${startDate}T12:00:00Z`);
  const end = new Date(`${endDate}T12:00:00Z`);

  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime())
  ) {
    return {
      ok: false as const,
      error: "Invalid rental dates",
    };
  }

  if (end <= start) {
    return {
      ok: false as const,
      error: "Rental endDate must be after startDate",
    };
  }

  const millisecondsPerDay = 1000 * 60 * 60 * 24;
  const nights = Math.round(
    (end.getTime() - start.getTime()) /
      millisecondsPerDay,
  );

  if (nights < IGLOUE_SERVER_PRICING.minimumRentalNights) {
    return {
      ok: false as const,
      error: `Minimum rental is ${IGLOUE_SERVER_PRICING.minimumRentalNights} nights`,
    };
  }

  return {
    ok: true as const,
    rental: {
      startDate,
      endDate,
      nights,
    },
  };
}

export function validateServiceChoices(service: unknown) {
  if (
    typeof service !== "object" ||
    service === null
  ) {
    return {
      ok: false as const,
      error: "Invalid service",
    };
  }

  const value = service as Record<string, unknown>;

  if (
    typeof value.deliverySlotId !== "string" ||
    !isValidServiceWindowId(value.deliverySlotId.trim())
  ) {
    return {
      ok: false as const,
      error: "Invalid deliverySlotId",
    };
  }

  if (
    typeof value.collectionSlotId !== "string" ||
    !isValidServiceWindowId(value.collectionSlotId.trim())
  ) {
    return {
      ok: false as const,
      error: "Invalid collectionSlotId",
    };
  }

  if (
    typeof value.setupMode !== "string" ||
    !(value.setupMode in IGLOUE_SERVER_PRICING.setup)
  ) {
    return {
      ok: false as const,
      error: "Invalid setupMode",
    };
  }

  if (
    value.expressSelected !== undefined &&
    typeof value.expressSelected !== "boolean"
  ) {
    return {
      ok: false as const,
      error: "Invalid expressSelected",
    };
  }

  return {
    ok: true as const,
    service: {
      deliverySlotId: value.deliverySlotId.trim(),
      collectionSlotId: value.collectionSlotId.trim(),
      setupMode: value.setupMode,
      expressSelected: value.expressSelected === true,
    },
  };
}