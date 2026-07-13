/* =========================================================
   IGLOUE Product Catalogue
   Single source of truth for rental models and prices
   ========================================================= */

const igloueProducts = [
  {
    id: "frost",
    name: "IGLOUE Frost",
    sizeKey: "small",
    maxRoomSize: 15,
    weeklyPrice: 19,
    tagline: "Un froid efficace pour les petits espaces.",
    suitableFor: "Chambres, bureaux et petites pièces",
    specifications: {
      btu: "À confirmer",
      noise: "À confirmer",
      energyClass: "À confirmer"
    }
  },
  {
    id: "polar",
    name: "IGLOUE Polar",
    sizeKey: "medium",
    maxRoomSize: 25,
    weeklyPrice: 24,
    tagline: "L’équilibre idéal entre puissance et simplicité.",
    suitableFor: "Chambres, salons et appartements",
    specifications: {
      btu: "À confirmer",
      noise: "À confirmer",
      energyClass: "À confirmer"
    }
  },
  {
    id: "arctique",
    name: "IGLOUE Arctique",
    sizeKey: "large",
    maxRoomSize: 35,
    weeklyPrice: 29,
    tagline: "Pensé pour les grandes pièces et les fortes chaleurs.",
    suitableFor: "Grands salons et espaces ouverts",
    specifications: {
      btu: "À confirmer",
      noise: "À confirmer",
      energyClass: "À confirmer"
    }
  },
  {
    id: "glacier",
    name: "IGLOUE Glacier",
    sizeKey: "xl",
    maxRoomSize: null,
    weeklyPrice: 34,
    tagline: "La puissance maximale de la gamme IGLOUE.",
    suitableFor: "Très grandes pièces et grands espaces",
    specifications: {
      btu: "À confirmer",
      noise: "À confirmer",
      energyClass: "À confirmer"
    }
  }
];

function findProductByRoomSize(sizeKey) {
  return (
    igloueProducts.find((product) => product.sizeKey === sizeKey) || null
  );
}