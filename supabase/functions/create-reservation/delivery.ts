export const IGLOUE_SERVER_DELIVERY = {
  serviceArea: "charente",

  zones: {
    local: {
      id: "local",
      name: "Angoulême proche",
      price: 29,
      maxDistanceKm: 10,
      productAccess: [
        "essential",
        "mobile-duo",
        "split-12",
        "max-pro",
      ],
    },

    "greater-angouleme": {
      id: "greater-angouleme",
      name: "Grand Angoulême",
      price: 39,
      maxDistanceKm: 20,
      productAccess: [
        "essential",
        "mobile-duo",
        "split-12",
        "max-pro",
      ],
    },

    "charente-near": {
      id: "charente-near",
      name: "Charente proche",
      price: 55,
      maxDistanceKm: 35,
      productAccess: [
        "mobile-duo",
        "split-12",
        "max-pro",
      ],
    },

    "charente-mid": {
      id: "charente-mid",
      name: "Charente intermédiaire",
      price: 69,
      maxDistanceKm: 50,
      productAccess: [
        "mobile-duo",
        "split-12",
        "max-pro",
      ],
    },

    "charente-far": {
      id: "charente-far",
      name: "Charente éloignée",
      price: 89,
      maxDistanceKm: 70,
      productAccess: [
        "mobile-duo",
        "split-12",
        "max-pro",
      ],
    },
  },
} as const;

const IGLOUE_SERVER_POSTCODE_ZONES: Record<string, string> = {
  /*
   * Temporary postcode mapping.
   *
   * This mirrors the current customer assistant behaviour.
   * It should later be replaced by the definitive IGLOUE
   * postcode/distance dataset once dispatch points and
   * service coverage are finalised.
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
  "16760": "charente-mid",
};

type DeliveryZoneId =
  keyof typeof IGLOUE_SERVER_DELIVERY.zones;

export function getServerDeliveryZoneByPostcode(
  postcode: string,
) {
  const zoneId =
    IGLOUE_SERVER_POSTCODE_ZONES[postcode];

  if (!zoneId) {
    return null;
  }

  return IGLOUE_SERVER_DELIVERY.zones[
    zoneId as DeliveryZoneId
  ];
}

export function getServerDeliveryPrice(
  postcode: string,
) {
  const zone =
    getServerDeliveryZoneByPostcode(postcode);

  return zone ? zone.price : null;
}

export function isServerProductAvailableInZone(
  productId: string,
  zoneId: DeliveryZoneId,
) {
  const zone =
    IGLOUE_SERVER_DELIVERY.zones[zoneId];

  return (zone.productAccess as readonly string[]).includes(
    productId,
  );
}