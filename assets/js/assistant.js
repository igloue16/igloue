const assistantState = {
  postcode: "",
  zone: null,
  room: "",
  size: "",
  setup: false
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
        <button type="button" data-room="chambre">Chambre</button>
        <button type="button" data-room="salon">Salon</button>
        <button type="button" data-room="bureau">Bureau</button>
        <button type="button" data-room="autre">Autre pièce</button>
      </div>
    </div>
  `;

  document.querySelectorAll("[data-room]").forEach((button) => {
    button.addEventListener("click", () => {
      assistantState.room = button.dataset.room;
      showSizeScreen();
    });
  });
}
function showSizeScreen() {
  const assistant = document.querySelector("[data-assistant]");

  assistant.innerHTML = `
    <div class="assistant-screen">
      <span class="eyebrow">Surface approximative</span>

      <h2>Quelle est la taille de la pièce ?</h2>

      <div class="assistant-options">
        <button type="button" data-size="small">Moins de 15 m²</button>
        <button type="button" data-size="medium">15 à 25 m²</button>
        <button type="button" data-size="large">25 à 35 m²</button>
        <button type="button" data-size="xl">Plus de 35 m²</button>
      </div>
    </div>
  `;

  document.querySelectorAll("[data-size]").forEach((button) => {
    button.addEventListener("click", () => {
      assistantState.size = button.dataset.size;
      showRecommendationScreen();
    });
  });
}
function showRecommendationScreen() {
  const assistant = document.querySelector("[data-assistant]");

  assistant.innerHTML = `
    <div class="assistant-screen">
      <span class="eyebrow">Recommandation</span>

      <h2>IGLOUE Air Mobile</h2>

      <p>
        Ce modèle est adapté pour une utilisation domestique courante :
        chambre, bureau ou pièce de vie.
      </p>

      <div class="assistant-result-grid">
        <div>
          <span>Location</span>
          <strong>19 € / semaine</strong>
        </div>

        <div>
          <span>Livraison + reprise</span>
          <strong>${formatPrice(assistantState.zone.price)}</strong>
        </div>
      </div>

      <button class="assistant-next" type="button" data-next-setup>
        Continuer →
      </button>
    </div>
  `;

  document.querySelector("[data-next-setup]").addEventListener("click", showSetupScreen);
}
function showSetupScreen() {
  const assistant = document.querySelector("[data-assistant]");

  assistant.innerHTML = `
    <div class="assistant-screen">
      <span class="eyebrow">Mise en service</span>

      <h2>Souhaitez-vous que nous l’installions pour vous ?</h2>

      <div class="assistant-options">
        <button type="button" data-setup="yes">Oui, mise en service +9,99 €</button>
        <button type="button" data-setup="no">Non, je le fais moi-même</button>
      </div>
    </div>
  `;

  document.querySelectorAll("[data-setup]").forEach((button) => {
    button.addEventListener("click", () => {
      assistantState.setup = button.dataset.setup === "yes";
      showSummaryScreen();
    });
  });
}
function showSummaryScreen() {
  const assistant = document.querySelector("[data-assistant]");
  const setupPrice = assistantState.setup ? 9.99 : 0;
  const total = rentalPrice + assistantState.zone.price + setupPrice;

  assistant.innerHTML = `
    <div class="assistant-screen">
      <span class="eyebrow">Estimation</span>

      <h2>Votre première estimation</h2>

      <div class="assistant-result-grid">
        <div>
          <span>Location</span>
          <strong>${formatPrice(rentalPrice)} / semaine</strong>
        </div>

        <div>
          <span>Livraison + reprise</span>
          <strong>${formatPrice(assistantState.zone.price)}</strong>
        </div>

        <div>
          <span>Mise en service</span>
          <strong>${assistantState.setup ? formatPrice(9.99) : "Non ajoutée"}</strong>
        </div>

        <div>
          <span>Total première semaine</span>
          <strong>${formatPrice(total)}</strong>
        </div>
      </div>

      <button class="assistant-next" type="button">
        Demander une réservation →
      </button>
    </div>
  `;
}

document.addEventListener("DOMContentLoaded", showPostcodeScreen);