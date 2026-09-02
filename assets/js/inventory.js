const IGLOUE_INVENTORY = {
  /*
    Temporary fleet quantities.

    These are placeholder quantities until the real fleet is purchased.
    Later this file/backend will track individual machines, bookings,
    maintenance blocks and availability by date.
  */

  products: {
    essential: {
      quantity: 2
    },

    "mobile-duo": {
      quantity: 3
    },

    "split-12": {
      quantity: 3
    },

    "max-pro": {
      quantity: 2
    }
  },

  /*
    Temporary booking blocks.

    Structure example:

    {
      productId: "split-12",
      startDate: "2027-07-12",
      endDate: "2027-07-19",
      quantity: 2
    }

    startDate = delivery date
    endDate   = collection date

    Collection day does not overlap with a new booking starting
    on that same day.
  */
  reservations: []
};

function getInventoryRecord(productId) {
  return IGLOUE_INVENTORY.products[productId] || null;
}

function getFleetQuantity(productId) {
  const record = getInventoryRecord(productId);

  return record ? record.quantity : 0;
}

function dateRangesOverlap(
  startA,
  endA,
  startB,
  endB
) {
  if (
    !startA ||
    !endA ||
    !startB ||
    !endB
  ) {
    return false;
  }

  /*
    End dates are collection dates.

    Therefore:
    booking A ending on 20 July
    and booking B starting on 20 July
    do NOT overlap.
  */
  return (
    startA < endB &&
    endA > startB
  );
}

function getReservedQuantity(
  productId,
  startDate,
  endDate
) {
  return IGLOUE_INVENTORY.reservations
    .filter((reservation) => (
      reservation.productId === productId &&
      dateRangesOverlap(
        startDate,
        endDate,
        reservation.startDate,
        reservation.endDate
      )
    ))
    .reduce(
      (total, reservation) =>
        total + (reservation.quantity || 1),
      0
    );
}

function getAvailableQuantity(
  productId,
  startDate,
  endDate
) {
  const fleetQuantity =
    getFleetQuantity(productId);

  const reservedQuantity =
    getReservedQuantity(
      productId,
      startDate,
      endDate
    );

  return Math.max(
    0,
    fleetQuantity - reservedQuantity
  );
}

function isProductAvailableForDates(
  productId,
  startDate,
  endDate
) {
  return (
    getAvailableQuantity(
      productId,
      startDate,
      endDate
    ) > 0
  );
}

function getProductIndex(productId) {
  return IGLOUE_PRODUCTS.findIndex(
    (product) => product.id === productId
  );
}

function getPreviousProduct(productId) {
  const index =
    getProductIndex(productId);

  if (index <= 0) {
    return null;
  }

  return IGLOUE_PRODUCTS[index - 1];
}

function getNextProduct(productId) {
  const index =
    getProductIndex(productId);

  if (
    index < 0 ||
    index >= IGLOUE_PRODUCTS.length - 1
  ) {
    return null;
  }

  return IGLOUE_PRODUCTS[index + 1];
}

function productCanServePostcode(
  product,
  postcode
) {
  if (!product) {
    return false;
  }

  return isProductAvailableForPostcode(
    product.id,
    postcode
  );
}

function productCanUseOpening(
  product,
  openingType
) {
  if (!product) {
    return false;
  }

  if (openingType === "unsure") {
    return true;
  }

  return productSupportsOpening(
    product,
    openingType
  );
}

function getAlternativeAvailability({
  idealProduct,
  postcode,
  openingType,
  startDate,
  endDate
}) {
  if (!idealProduct) {
    return {
      idealAvailable: false,
      shouldOfferAlternatives: false,
      largerAlternative: null,
      smallerAlternative: null
    };
  }

  const idealAvailable =
    isProductAvailableForDates(
      idealProduct.id,
      startDate,
      endDate
    );

  /*
    Normal situation:
    the correct machine is available.

    Do not distract the customer with alternatives.
  */
  if (idealAvailable) {
    return {
      idealAvailable: true,
      shouldOfferAlternatives: false,
      largerAlternative: null,
      smallerAlternative: null
    };
  }

  const largerProduct =
    getNextProduct(idealProduct.id);

  const smallerProduct =
    getPreviousProduct(idealProduct.id);

  let largerAlternative = null;
  let smallerAlternative = null;

  /*
    A larger machine is the preferred fallback.

    It must:
    - serve the postcode
    - work with the opening
    - actually be free for the requested dates
  */
  if (
    largerProduct &&
    productCanServePostcode(
      largerProduct,
      postcode
    ) &&
    productCanUseOpening(
      largerProduct,
      openingType
    ) &&
    isProductAvailableForDates(
      largerProduct.id,
      startDate,
      endDate
    )
  ) {
    largerAlternative =
      largerProduct;
  }

  /*
    Smaller machines are not treated as equivalent.

    We return the immediately lower tier only.
    assistant.js will later decide whether the room/load is
    close enough to make it a reasonable compromise.
  */
  if (
    smallerProduct &&
    productCanServePostcode(
      smallerProduct,
      postcode
    ) &&
    productCanUseOpening(
      smallerProduct,
      openingType
    ) &&
    isProductAvailableForDates(
      smallerProduct.id,
      startDate,
      endDate
    )
  ) {
    smallerAlternative =
      smallerProduct;
  }

  return {
    idealAvailable: false,

    shouldOfferAlternatives: Boolean(
      largerAlternative ||
      smallerAlternative
    ),

    largerAlternative,
    smallerAlternative
  };
}
