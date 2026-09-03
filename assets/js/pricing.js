const IGLOUE_PRICING = {
  currency: "EUR",

  minimumRentalNights: 3,

  caution: {
    chargedUpfront: false
  },

  weeklyRates: {
    essential: 59,
    mobileDuo: 79,
    split12: 99,
    maxPro: 129
  },

  setup: {
    none: {
      id: "none",
      label: "Livraison seule",
      price: 0
    },

    basic: {
      id: "basic",
      label: "Mise en service simple",
      price: 19
    },

    terraceSplit: {
      id: "terrace-split",
      label: "Mise en service terrasse / balcon",
      price: 19
    },

    windowSplit: {
      id: "window-split",
      label: "Installation split sur fenêtre",
      price: 39
    },

    adaptedOpening: {
      id: "adapted-opening",
      label: "Adaptation fenêtre / porte-fenêtre / Velux",
      price: 39
    },

    special: {
      id: "special",
      label: "Installation particulière",
      price: 59,
      isStartingPrice: true
    }
  }
};

function roundCurrency(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function getNightlyRate(weeklyPrice) {
  return roundCurrency(weeklyPrice / 7);
}

function getRentalNightCount(startDate, endDate) {
  if (!startDate || !endDate) {
    return 0;
  }

  const start = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 0;
  }

  const millisecondsPerDay = 1000 * 60 * 60 * 24;
  const difference = Math.round((end - start) / millisecondsPerDay);

  return Math.max(0, difference);
}

function calculateRentalPrice(weeklyPrice, startDate, endDate) {
  const actualNights = getRentalNightCount(startDate, endDate);

  if (actualNights <= 0) {
    return {
      actualNights: 0,
      chargeableNights: 0,
      nightlyRate: getNightlyRate(weeklyPrice),
      rentalPrice: 0
    };
  }

  const chargeableNights = Math.max(
    actualNights,
    IGLOUE_PRICING.minimumRentalNights
  );

  const nightlyRate = weeklyPrice / 7;
  const rentalPrice = roundCurrency(nightlyRate * chargeableNights);

  return {
    actualNights,
    chargeableNights,
    nightlyRate: roundCurrency(nightlyRate),
    rentalPrice
  };
}

function calculateBookingTotal({
  weeklyPrice,
  startDate,
  endDate,
  deliveryPrice = 0,
  setupPrice = 0,
  cautionAmount = 0
}) {
  const rental = calculateRentalPrice(
    weeklyPrice,
    startDate,
    endDate
  );

  const total = roundCurrency(
    rental.rentalPrice +
    deliveryPrice +
    setupPrice
  );

  return {
    currency: IGLOUE_PRICING.currency,

    actualNights: rental.actualNights,
    chargeableNights: rental.chargeableNights,

    weeklyPrice: roundCurrency(weeklyPrice),
    nightlyRate: rental.nightlyRate,
    rentalPrice: rental.rentalPrice,

    deliveryPrice: roundCurrency(deliveryPrice),
    setupPrice: roundCurrency(setupPrice),

    total,

    caution: {
      amount: roundCurrency(cautionAmount),
      chargedUpfront: IGLOUE_PRICING.caution.chargedUpfront
    }
  };
}
