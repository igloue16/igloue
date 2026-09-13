export const IGLOUE_SERVER_PRICING = {
  currency: "EUR",

  minimumRentalNights: 3,

  products: {
    essential: {
      weeklyPrice: 59,
      depositAmount: 250,
    },
    "mobile-duo": {
      weeklyPrice: 79,
      depositAmount: 350,
    },
    "split-12": {
      weeklyPrice: 99,
      depositAmount: 550,
    },
    "max-pro": {
      weeklyPrice: 129,
      depositAmount: 750,
    },
  },

  addOns: {
    extendedExhaust: 9,
    sameDayExpress: 25,
  },

  setup: {
    none: 0,
    basic: 19,
    "terrace-split": 19,
    "window-split": 39,
    "adapted-opening": 39,
    special: 59,
  },
} as const;

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateServerRentalPrice(
  weeklyPrice: number,
  nights: number,
) {
  const chargeableNights = Math.max(
    nights,
    IGLOUE_SERVER_PRICING.minimumRentalNights,
  );

  const nightlyRate = weeklyPrice / 7;

  return roundMoney(
    nightlyRate * chargeableNights,
  );
}

export function calculateServerBookingPrice(input: {
  productId: keyof typeof IGLOUE_SERVER_PRICING.products;
  nights: number;
  deliveryFee: number;
  setupMode: keyof typeof IGLOUE_SERVER_PRICING.setup;
  expressSelected: boolean;
}) {
  const product =
    IGLOUE_SERVER_PRICING.products[input.productId];

  const rentalPrice = calculateServerRentalPrice(
    product.weeklyPrice,
    input.nights,
  );

  const setupPrice =
    IGLOUE_SERVER_PRICING.setup[input.setupMode];

  const expressPrice = input.expressSelected
    ? IGLOUE_SERVER_PRICING.addOns.sameDayExpress
    : 0;

  const totalAmount = roundMoney(
    rentalPrice +
      input.deliveryFee +
      setupPrice +
      expressPrice,
  );

  return {
    currency: IGLOUE_SERVER_PRICING.currency,
    weeklyPrice: product.weeklyPrice,
    rentalPrice,
    deliveryFee: roundMoney(input.deliveryFee),
    setupPrice,
    expressPrice,
    depositAmount: product.depositAmount,
    totalAmount,
  };
}