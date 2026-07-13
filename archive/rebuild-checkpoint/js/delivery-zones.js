const deliveryZones = {
  zone1: {
    name: "Zone 1 – Centre",
    price: 15.99,
    postcodes: ["16000", "16430", "16600", "16710", "16800"]
  },
  zone2: {
    name: "Zone 2 – Intermédiaire",
    price: 17.99,
    postcodes: ["16110", "16120", "16160", "16230", "16290", "16320", "16340", "16380", "16400", "16410", "16440", "16560", "16610", "16730"]
  },
  zone3: {
    name: "Zone 3 – Périphérie",
    price: 19.99,
    postcodes: ["16100", "16130", "16140", "16150", "16200", "16210", "16220", "16240", "16250", "16260", "16270", "16300", "16310", "16350", "16360", "16450", "16500", "16510", "16570", "16620", "16660", "16700", "16720", "16760"]
  }
};

const weeklyRentalPrice = 19;
const setupPrice = 9.99;

function findDeliveryZone(postcode) {
  for (const zoneKey in deliveryZones) {
    if (deliveryZones[zoneKey].postcodes.includes(postcode)) {
      return deliveryZones[zoneKey];
    }
  }

  return null;
}

function formatPrice(price) {
  return price.toFixed(2).replace(".", ",") + " €";
}

document.addEventListener("DOMContentLoaded", () => {
  const form = document.querySelector("[data-delivery-form]");
  const input = document.querySelector("[data-postcode-input]");
  const result = document.querySelector("[data-delivery-result]");

  if (!form || !input || !result) return;

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const postcode = input.value.trim();
    const zone = findDeliveryZone(postcode);

    if (!zone) {
      result.innerHTML = `
        <div class="delivery-result error">
          <strong>Zone non disponible pour le moment</strong>
          <p>Nous nous concentrons actuellement sur certaines zones de la Charente (16).</p>
        </div>
      `;
      return;
    }

    const firstWeekTotal = weeklyRentalPrice + zone.price;

    result.innerHTML = `
      <div class="delivery-result success">
        <strong>✓ Livraison disponible</strong>
        <p>${postcode} — ${zone.name}</p>
        <ul>
          <li>Location : <strong>${formatPrice(weeklyRentalPrice)} / semaine</strong></li>
          <li>Livraison + reprise : <strong>${formatPrice(zone.price)}</strong></li>
          <li>Total première semaine : <strong>${formatPrice(firstWeekTotal)}</strong></li>
          <li>Mise en service optionnelle : <strong>+ ${formatPrice(setupPrice)}</strong></li>
        </ul>
      </div>
    `;
  });
});