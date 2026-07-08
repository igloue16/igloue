const assistantState = {
  postcode: "",
  zone: null
};

const zones = [
  {
    id: "zone-1",
    name: "Zone 1",
    price: 15.99,
    postcodes: ["16000", "16430", "16600", "16710", "16800"]
  },
  {
    id: "zone-2",
    name: "Zone 2",
    price: 17.99,
    postcodes: ["16110", "16120", "16160", "16230", "16290", "16320", "16340", "16380", "16400", "16410", "16440", "16560", "16610", "16730"]
  },
  {
    id: "zone-3",
    name: "Zone 3",
    price: 19.99,
    postcodes: ["16100", "16130", "16140", "16150", "16200", "16210", "16220", "16240", "16250", "16260", "16270", "16300", "16310", "16350", "16360", "16450", "16500", "16510", "16570", "16620", "16660", "16700", "16720", "16760"]
  }
];

const rentalPrice = 19;

function formatPrice(price) {
  return price.toFixed(2).replace(".", ",") + " €";
}

function findZone(postcode) {
  return zones.find(zone => zone.postcodes.includes(postcode)) || null;
}

function showPostcodeScreen() {
  const assistant = document.querySelector("[data-assistant]");

  assistant.innerHTML = `
    <div class="assistant-screen">
      <span class="eyebrow">Assistant IGLOUE</span>

      <h2>Où avez-vous besoin de fraîcheur ?</h2>

      <p>Entrez votre code postal. Nous vérifions votre zone automatiquement.</p>

      <label class="assistant-label" for="assistant-postcode">Code postal</label>

      <input
        id="assistant-postcode"
        class="assistant-line-input"
        type="text"
        inputmode="numeric"
        maxlength="5"
        placeholder="16000"
        autocomplete="postal-code">

      <p class="assistant-hint">Disponible actuellement en Charente (16).</p>
    </div>
  `;

  const input = document.querySelector("#assistant-postcode");

  input.addEventListener("input", () => {
    input.value = input.value.replace(/\D/g, "");

    if (input.value.length === 5) {
      assistantState.postcode = input.value;

      assistant.classList.add("is-loading");

      setTimeout(() => {
        assistant.classList.remove("is-loading");
        assistantState.zone = findZone(assistantState.postcode);

        if (assistantState.zone) {
          showZoneScreen();
        } else {
          showUnavailableScreen();
        }
      }, 450);
    }
  });

  input.focus();
}

function showZoneScreen() {
  const assistant = document.querySelector("[data-assistant]");
  const total = rentalPrice + assistantState.zone.price;

  assistant.innerHTML = `
    <div class="assistant-screen">
      <span class="eyebrow">Livraison disponible</span>

      <h2>Bonne nouvelle.</h2>

      <p>Nous livrons à votre code postal.</p>

      <div class="assistant-result-grid">
        <div>
          <span>Code postal</span>
          <strong>${assistantState.postcode}</strong>
        </div>

        <div>
          <span>Zone</span>
          <strong>${assistantState.zone.name}</strong>
        </div>

        <div>
          <span>Livraison + reprise</span>
          <strong>${formatPrice(assistantState.zone.price)}</strong>
        </div>

        <div>
          <span>Première semaine estimée</span>
          <strong>${formatPrice(total)}</strong>
        </div>
      </div>

      <button class="assistant-next" type="button" data-next-room>
        Continuer →
      </button>
    </div>
  `;

  document.querySelector("[data-next-room]").addEventListener("click", showRoomScreen);
}

function showUnavailableScreen() {
  const assistant = document.querySelector("[data-assistant]");

  assistant.innerHTML = `
    <div class="assistant-screen">
      <span class="eyebrow">Zone non disponible</span>

      <h2>Pas encore dans votre secteur.</h2>

      <p>IGLOUE se concentre actuellement sur certaines zones de la Charente.</p>

      <button class="assistant-next" type="button" data-restart>
        Réessayer →
      </button>
    </div>
  `;

  document.querySelector("[data-restart]").addEventListener("click", showPostcodeScreen);
}

function showRoomScreen() {
  const assistant = document.querySelector("[data-assistant]");

  assistant.innerHTML = `
    <div class="assistant-screen">
      <span class="eyebrow">Étape suivante</span>

      <h2>Quelle pièce voulez-vous rafraîchir ?</h2>

      <div class="assistant-options">
        <button type="button">Chambre</button>
        <button type="button">Salon</button>
        <button type="button">Bureau</button>
        <button type="button">Autre pièce</button>
      </div>
    </div>
  `;
}

document.addEventListener("DOMContentLoaded", showPostcodeScreen);