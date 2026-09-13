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