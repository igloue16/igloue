const assistantState = {
  postcode: "",
  zone: null,
  room: "",
  size: "",
  product: null,
  setup: false
};

const assistantHistory = [];

const deliveryZones = [
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
    postcodes: [
      "16110", "16120", "16160", "16230", "16290", "16320", "16340",
      "16380", "16400", "16410", "16440", "16560", "16610", "16730"
    ]
  },
  {
    id: "zone-3",
    name: "Zone 3",
    price: 19.99,
    postcodes: [
      "16100", "16130", "16140", "16150", "16200", "16210", "16220",
      "16240", "16250", "16260", "16270", "16300", "16310", "16350",
      "16360", "16450", "16500", "16510", "16570", "16620", "16660",
      "16700", "16720", "16760"
    ]
  }
];

const setupPrice = 9.99;

function getAssistantElement() {
  return document.querySelector("[data-assistant]");
}

function formatPrice(price) {
  return `${price.toFixed(2).replace(".", ",")} €`;
}

function findZone(postcode) {
  return deliveryZones.find((zone) => zone.postcodes.includes(postcode)) || null;
}

function pushScreen(screenFunction) {
  assistantHistory.push(screenFunction);
}

function goBack() {
  if (assistantHistory.length <= 1) {
    showPostcodeScreen(false);
    return;
  }

  assistantHistory.pop();
  const previousScreen = assistantHistory[assistantHistory.length - 1];
  previousScreen(false);
}

function renderBackControl() {
  return `
    <button class="assistant-back" type="button" data-assistant-back>
      ← Retour
    </button>
  `;
}

function connectBackControl() {
  const backButton = document.querySelector("[data-assistant-back]");

  if (backButton) {
    backButton.addEventListener("click", goBack);
  }
}

function showPostcodeScreen(addToHistory = true) {
  const assistant = getAssistantElement();

  if (!assistant) {
    return;
  }

  if (addToHistory) {
    assistantHistory.length = 0;
    pushScreen(showPostcodeScreen);
  }

  assistant.innerHTML = `
    <div class="assistant-screen">
      <span class="assistant-step-label">Étape 1</span>
      <h2>Quel est votre code postal ?</h2>
      <p>Nous vérifierons immédiatement votre zone de livraison.</p>

      <label class="assistant-label" for="assistant-postcode">Code postal</label>

      <input
        id="assistant-postcode"
        class="assistant-line-input"
        type="text"
        inputmode="numeric"
        maxlength="5"
        placeholder="16000"
        autocomplete="postal-code"
        value="${assistantState.postcode}">

      <p class="assistant-hint">
        Disponible actuellement dans certaines zones de la Charente.
      </p>
    </div>
  `;

  const input = document.querySelector("#assistant-postcode");

  input.addEventListener("input", () => {
    input.value = input.value.replace(/\D/g, "");

    if (input.value.length !== 5) {
      return;
    }

    assistantState.postcode = input.value;
    assistantState.zone = findZone(assistantState.postcode);

    if (assistantState.zone) {
      showZoneScreen();
    } else {
      showUnavailableScreen();
    }
  });

  input.focus();
}

function showZoneScreen(addToHistory = true) {
  const assistant = getAssistantElement();

  if (addToHistory) {
    pushScreen(showZoneScreen);
  }

  assistant.innerHTML = `
    <div class="assistant-screen">
      ${renderBackControl()}
      <span class="assistant-step-label">Livraison disponible</span>
      <h2>Bonne nouvelle.</h2>
      <p>Nous livrons et reprenons le climatiseur dans votre secteur.</p>

      <div class="assistant-result-grid">
        <div><span>Code postal</span><strong>${assistantState.postcode}</strong></div>
        <div><span>Zone</span><strong>${assistantState.zone.name}</strong></div>
        <div><span>Livraison & reprise</span><strong>${formatPrice(assistantState.zone.price)}</strong></div>
      </div>

      <p class="assistant-note">
        La livraison et la reprise sont facturées une seule fois.
      </p>

      <button class="assistant-next" type="button" data-next-room>
        Choisir la pièce →
      </button>
    </div>
  `;

  connectBackControl();
  document.querySelector("[data-next-room]").addEventListener("click", showRoomScreen);
}

function showUnavailableScreen(addToHistory = true) {
  const assistant = getAssistantElement();

  if (addToHistory) {
    pushScreen(showUnavailableScreen);
  }

  assistant.innerHTML = `
    <div class="assistant-screen">
      ${renderBackControl()}
      <span class="assistant-step-label">Zone non disponible</span>
      <h2>Pas encore dans votre secteur.</h2>
      <p>IGLOUE se concentre actuellement sur certaines zones de la Charente.</p>

      <button class="assistant-next" type="button" data-restart>
        Modifier le code postal →
      </button>
    </div>
  `;

  connectBackControl();
  document.querySelector("[data-restart]").addEventListener("click", () => showPostcodeScreen(false));
}

function showRoomScreen(addToHistory = true) {
  const assistant = getAssistantElement();

  if (addToHistory) {
    pushScreen(showRoomScreen);
  }

  assistant.innerHTML = `
    <div class="assistant-screen">
      ${renderBackControl()}
      <span class="assistant-step-label">Votre besoin</span>
      <h2>Quelle pièce souhaitez-vous rafraîchir ?</h2>

      <div class="assistant-options">
        <button type="button" data-room="chambre">Chambre</button>
        <button type="button" data-room="salon">Salon</button>
        <button type="button" data-room="bureau">Bureau</button>
        <button type="button" data-room="autre">Autre pièce</button>
      </div>
    </div>
  `;

  connectBackControl();

  document.querySelectorAll("[data-room]").forEach((button) => {
    button.addEventListener("click", () => {
      assistantState.room = button.dataset.room;
      showSizeScreen();
    });
  });
}

function showSizeScreen(addToHistory = true) {
  const assistant = getAssistantElement();

  if (addToHistory) {
    pushScreen(showSizeScreen);
  }

  assistant.innerHTML = `
    <div class="assistant-screen">
      ${renderBackControl()}
      <span class="assistant-step-label">Surface approximative</span>
      <h2>Quelle est la taille de cette pièce ?</h2>

      <div class="assistant-options">
        <button type="button" data-size="small">Moins de 15 m²</button>
        <button type="button" data-size="medium">De 15 à 25 m²</button>
        <button type="button" data-size="large">De 25 à 35 m²</button>
        <button type="button" data-size="xl">Plus de 35 m²</button>
      </div>
    </div>
  `;

  connectBackControl();

  document.querySelectorAll("[data-size]").forEach((button) => {
    button.addEventListener("click", () => {
      assistantState.size = button.dataset.size;
      assistantState.product = findProductByRoomSize(assistantState.size);
      showRecommendationScreen();
    });
  });
}

function showRecommendationScreen(addToHistory = true) {
  const assistant = getAssistantElement();
  const product = assistantState.product;

  if (addToHistory) {
    pushScreen(showRecommendationScreen);
  }

  assistant.innerHTML = `
    <div class="assistant-screen">
      ${renderBackControl()}
      <span class="assistant-step-label">Notre recommandation</span>

      <div class="assistant-product">
        <span class="assistant-product-mark" aria-hidden="true">❄</span>
        <div>
          <h2>${product.name}</h2>
          <p>${product.tagline}</p>
          <p>${product.suitableFor}</p>
        </div>
      </div>

      <div class="assistant-result-grid">
        <div>
          <span>Surface conseillée</span>
          <strong>${product.maxRoomSize ? `Jusqu’à ${product.maxRoomSize} m²` : "Plus de 35 m²"}</strong>
        </div>
        <div><span>Location</span><strong>${formatPrice(product.weeklyPrice)} / semaine</strong></div>
        <div><span>Livraison & reprise</span><strong>${formatPrice(assistantState.zone.price)}</strong></div>
      </div>

      <button class="assistant-next" type="button" data-next-setup>
        Choisir la mise en service →
      </button>
    </div>
  `;

  connectBackControl();
  document.querySelector("[data-next-setup]").addEventListener("click", showSetupScreen);
}

function showSetupScreen(addToHistory = true) {
  const assistant = getAssistantElement();

  if (addToHistory) {
    pushScreen(showSetupScreen);
  }

  assistant.innerHTML = `
    <div class="assistant-screen">
      ${renderBackControl()}
      <span class="assistant-step-label">Mise en service</span>

      <div class="assistant-heading-row">
        <h2>Souhaitez-vous que nous l’installions pour vous ?</h2>
        <button
          class="assistant-help"
          type="button"
          aria-label="Afficher les détails"
          aria-expanded="false"
          data-setup-help>i</button>
      </div>

      <div class="assistant-help-content" data-setup-help-content hidden>
        <strong>La mise en service comprend :</strong>
        <ul>
          <li>Placement dans la pièce</li>
          <li>Branchement de l’appareil</li>
          <li>Installation du kit fenêtre, si compatible</li>
          <li>Test de fonctionnement</li>
          <li>Démonstration rapide</li>
        </ul>
      </div>

      <div class="assistant-options">
        <button type="button" data-setup="yes">Oui — ${formatPrice(setupPrice)}</button>
        <button type="button" data-setup="no">Non — je m’en charge</button>
      </div>
    </div>
  `;

  connectBackControl();

  const helpButton = document.querySelector("[data-setup-help]");
  const helpContent = document.querySelector("[data-setup-help-content]");

  helpButton.addEventListener("click", () => {
    const expanded = helpButton.getAttribute("aria-expanded") === "true";
    helpButton.setAttribute("aria-expanded", String(!expanded));
    helpContent.hidden = expanded;
  });

  document.querySelectorAll("[data-setup]").forEach((button) => {
    button.addEventListener("click", () => {
      assistantState.setup = button.dataset.setup === "yes";
      showSummaryScreen();
    });
  });
}

function showSummaryScreen(addToHistory = true) {
  const assistant = getAssistantElement();
  const product = assistantState.product;

  if (addToHistory) {
    pushScreen(showSummaryScreen);
  }

  const selectedSetupPrice = assistantState.setup ? setupPrice : 0;
  const firstWeekTotal = product.weeklyPrice + assistantState.zone.price + selectedSetupPrice;

  assistant.innerHTML = `
    <div class="assistant-screen">
      ${renderBackControl()}
      <span class="assistant-step-label">Votre estimation</span>
      <h2>${product.name}</h2>

      <div class="assistant-result-grid">
        <div><span>Location — première semaine</span><strong>${formatPrice(product.weeklyPrice)}</strong></div>
        <div><span>Livraison & reprise — paiement unique</span><strong>${formatPrice(assistantState.zone.price)}</strong></div>
        <div>
          <span>Mise en service — paiement unique</span>
          <strong>${assistantState.setup ? formatPrice(setupPrice) : "Non sélectionnée"}</strong>
        </div>
        <div><span>Total de départ estimé</span><strong>${formatPrice(firstWeekTotal)}</strong></div>
      </div>

      <section class="assistant-recurring-block">
        <span class="assistant-step-label">Après votre première semaine</span>
        <div class="assistant-recurring-price">
          <span>Location uniquement</span>
          <strong>${formatPrice(product.weeklyPrice)} / semaine</strong>
        </div>
      </section>

      <button class="assistant-next" type="button">
        Demander une réservation →
      </button>
    </div>
  `;

  connectBackControl();
}

document.addEventListener("DOMContentLoaded", showPostcodeScreen);
