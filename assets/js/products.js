const IGLOUE_PRODUCTS = [
  {
    id: "frost",
    name: "IGLOUE Frost",
    weeklyPrice: 19,
    maxRoomSize: 15,
    tagline: "Compact et simple.",
    suitableFor: "Petites chambres, bureaux et espaces jusqu’à 15 m²."
  },
  {
    id: "polar",
    name: "IGLOUE Polar",
    weeklyPrice: 24,
    maxRoomSize: 25,
    tagline: "Le choix le plus polyvalent.",
    suitableFor: "Chambres, bureaux et pièces moyennes jusqu’à 25 m²."
  },
  {
    id: "arctique",
    name: "IGLOUE Arctique",
    weeklyPrice: 29,
    maxRoomSize: 35,
    tagline: "Plus de puissance pour les grandes pièces.",
    suitableFor: "Salons et grandes pièces jusqu’à 35 m²."
  },
  {
    id: "glacier",
    name: "IGLOUE Glacier",
    weeklyPrice: 34,
    maxRoomSize: null,
    tagline: "Notre puissance maximale.",
    suitableFor: "Très grandes pièces et besoins de refroidissement intensifs."
  }
];

function findProductByRoomSize(size) {
  const map = {
    small: "frost",
    medium: "polar",
    large: "arctique",
    xl: "glacier"
  };

  return IGLOUE_PRODUCTS.find((product) => product.id === map[size]) || IGLOUE_PRODUCTS[0];
}
