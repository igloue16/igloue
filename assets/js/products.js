const IGLOUE_PRODUCTS = [
  {
    id: "essential",
    name: "IGLOUE Essential",
    weeklyPrice: 59,

    type: "monobloc",
    tier: "entry",

    coolingCapacityKw: 2.6,
    maxRoomSize: 20,

    energyClassTarget: "A",
    tagline: "L’essentiel pour les petites pièces.",
    suitableFor: "Petites chambres, bureaux et pièces jusqu’à environ 20 m².",

    installationRequired: false,

    compatibleOpenings: [
      "casement",
      "tilt-turn",
      "sliding",
      "french-door",
      "velux"
    ],

    allowedSetupModes: [
      "none",
      "basic",
      "adapted-opening"
    ],

    serviceArea: "local"
  },

  {
    id: "mobile-duo",
    name: "IGLOUE Mobile Duo",
    weeklyPrice: 79,

    type: "dual-hose-monobloc",
    tier: "standard",

    coolingCapacityKw: 3.5,
    maxRoomSize: 30,

    energyClassTarget: "A+",
    tagline: "Plus efficace, sans unité extérieure.",
    suitableFor: "Chambres, salons et bureaux jusqu’à environ 30 m².",

    installationRequired: false,

    compatibleOpenings: [
      "casement",
      "tilt-turn",
      "sliding",
      "french-door",
      "velux"
    ],

    allowedSetupModes: [
      "none",
      "basic",
      "adapted-opening"
    ],

    serviceArea: "charente"
  },

  {
    id: "split-12",
    name: "IGLOUE Split 12",
    weeklyPrice: 99,

    type: "portable-split",
    tier: "premium",

    coolingCapacityKw: 3.5,
    maxRoomSize: 40,

    energyClassTarget: "A++",
    tagline: "Plus silencieux, plus efficace.",
    suitableFor: "Chambres, salons et pièces jusqu’à environ 40 m².",

    installationRequired: true,

    compatibleOpenings: [
      "casement",
      "tilt-turn",
      "sliding",
      "french-door",
      "terrace"
    ],

    allowedSetupModes: [
      "terrace-split",
      "window-split",
      "special"
    ],

    serviceArea: "charente"
  },

  {
    id: "max-pro",
    name: "IGLOUE Max Pro",
    weeklyPrice: 129,

    type: "high-capacity",
    tier: "pro",

    coolingCapacityKw: null,
    maxRoomSize: 60,

    energyClassTarget: null,
    tagline: "Pour les grands volumes et besoins intensifs.",
    suitableFor: "Grandes pièces, bureaux, commerces et espaces professionnels.",

    installationRequired: true,

    compatibleOpenings: [
      "casement",
      "tilt-turn",
      "sliding",
      "french-door",
      "terrace",
      "special"
    ],

    allowedSetupModes: [
      "basic",
      "terrace-split",
      "window-split",
      "adapted-opening",
      "special"
    ],

    requiresAssessmentAbove: 60,

    serviceArea: "charente"
  }
];

function getProductById(productId) {
  return IGLOUE_PRODUCTS.find((product) => product.id === productId) || null;
}

function getProductsAvailableForPostcode(postcode) {
  return IGLOUE_PRODUCTS.filter((product) => (
    isProductAvailableForPostcode(product.id, postcode)
  ));
}

function getBaseProductForRoomArea(area) {
  const numericArea = Number(area);

  if (!Number.isFinite(numericArea) || numericArea <= 0) {
    return null;
  }

  return IGLOUE_PRODUCTS.find((product) => (
    product.maxRoomSize === null ||
    numericArea <= product.maxRoomSize
  )) || IGLOUE_PRODUCTS[IGLOUE_PRODUCTS.length - 1];
}

function findProductByRoomArea(
  area,
  hasDifficultConditions = false,
  postcode = ""
) {
  const numericArea = Number(area);

  if (!Number.isFinite(numericArea) || numericArea <= 0) {
    return null;
  }

  let productIndex = IGLOUE_PRODUCTS.findIndex((product) => (
    product.maxRoomSize === null ||
    numericArea <= product.maxRoomSize
  ));

  if (productIndex < 0) {
    productIndex = IGLOUE_PRODUCTS.length - 1;
  }

  if (hasDifficultConditions) {
    productIndex = Math.min(
      productIndex + 1,
      IGLOUE_PRODUCTS.length - 1
    );
  }

  let product = IGLOUE_PRODUCTS[productIndex];

  if (postcode && !isProductAvailableForPostcode(product.id, postcode)) {
    const availableProducts = getProductsAvailableForPostcode(postcode);

    product = availableProducts.find((candidate) => (
      candidate.maxRoomSize === null ||
      numericArea <= candidate.maxRoomSize
    )) || availableProducts[availableProducts.length - 1] || null;
  }

  return product;
}

function productSupportsOpening(product, openingType) {
  if (!product || !openingType) {
    return false;
  }

  const compatibleOpeningId = openingType.replaceAll("_", "-");

  return product.compatibleOpenings.includes(compatibleOpeningId);
}

function productSupportsSetupMode(product, setupMode) {
  if (!product || !setupMode) {
    return false;
  }

  return product.allowedSetupModes.includes(setupMode);
}
