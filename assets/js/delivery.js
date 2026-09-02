const IGLOUE_DELIVERY = {
  serviceArea: "charente",

  zones: [
    {
      id: "local",
      name: "Angoulême proche",
      price: 29,
      maxDistanceKm: 10,
      productAccess: ["essential", "mobile-duo", "split-12", "max-pro"]
    },
    {
      id: "greater-angouleme",
      name: "Grand Angoulême",
      price: 39,
      maxDistanceKm: 20,
      productAccess: ["essential", "mobile-duo", "split-12", "max-pro"]
    },
    {
      id: "charente-near",
      name: "Charente proche",
      price: 55,
      maxDistanceKm: 35,
      productAccess: ["mobile-duo", "split-12", "max-pro"]
    },
    {
      id: "charente-mid",
      name: "Charente intermédiaire",
      price: 69,
      maxDistanceKm: 50,
      productAccess: ["mobile-duo", "split-12", "max-pro"]
    },
    {
      id: "charente-far",
      name: "Charente éloignée",
      price: 89,
      maxDistanceKm: 70,
      productAccess: ["mobile-duo", "split-12", "max-pro"]
    }
  ],

  manualReview: {
    id: "manual-review",
    name: "Zone sur demande",
    minimumDistanceKm: 70
  }
};

const IGLOUE_POSTCODE_ZONES = {
  /*
    Temporary postcode mapping.

    We will replace this with a cleaner real postcode/distance dataset
    once we settle the exact dispatch points and service coverage.

    For now this preserves the existing assistant behaviour while
    separating delivery logic from assistant.js.
  */

  "16000": "local",

  "16430": "greater-angouleme",
  "16600": "greater-angouleme",
  "16710": "greater-angouleme",
  "16800": "greater-angouleme",

  "16110": "charente-near",
  "16120": "charente-near",
  "16160": "charente-near",
  "16230": "charente-near",
  "16290": "charente-near",
  "16320": "charente-near",
  "16340": "charente-near",
  "16380": "charente-near",
  "16400": "charente-near",
  "16410": "charente-near",
  "16440": "charente-near",
  "16560": "charente-near",
  "16610": "charente-near",
  "16730": "charente-near",

  "16100": "charente-mid",
  "16130": "charente-mid",
  "16140": "charente-mid",
  "16150": "charente-mid",
  "16200": "charente-mid",
  "16210": "charente-mid",
  "16220": "charente-mid",
  "16240": "charente-mid",
  "16250": "charente-mid",
  "16260": "charente-mid",
  "16270": "charente-mid",
  "16300": "charente-mid",
  "16310": "charente-mid",
  "16350": "charente-mid",
  "16360": "charente-mid",
  "16450": "charente-mid",
  "16500": "charente-mid",
  "16510": "charente-mid",
  "16570": "charente-mid",
  "16620": "charente-mid",
  "16660": "charente-mid",
  "16700": "charente-mid",
  "16720": "charente-mid",
  "16760": "charente-mid"
};

function getDeliveryZoneById(zoneId) {
  return IGLOUE_DELIVERY.zones.find((zone) => zone.id === zoneId) || null;
}

function getDeliveryZoneByPostcode(postcode) {
  const zoneId = IGLOUE_POSTCODE_ZONES[postcode];

  if (!zoneId) {
    return null;
  }

  return getDeliveryZoneById(zoneId);
}

function getDeliveryPrice(postcode) {
  const zone = getDeliveryZoneByPostcode(postcode);

  return zone ? zone.price : null;
}

function isProductAvailableInZone(productId, zone) {
  if (!zone) {
    return false;
  }

  return zone.productAccess.includes(productId);
}

function isProductAvailableForPostcode(productId, postcode) {
  const zone = getDeliveryZoneByPostcode(postcode);

  return isProductAvailableInZone(productId, zone);
}

function getAvailableProductIdsForPostcode(postcode) {
  const zone = getDeliveryZoneByPostcode(postcode);

  if (!zone) {
    return [];
  }

  return [...zone.productAccess];
}