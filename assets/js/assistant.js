const assistantState = {
  postcode: "",
  zone: null,
  room: "",
  size: "",
  product: null,
  setup: null
};

const assistantHistory = [];
const assistantStepCount = 4;

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

function roundCurrency(price) {
  return Math.round((price + Number.EPSILON) * 100) / 100;
}

function findZone(postcode) {
  return deliveryZones.find((zone) => zone.postcodes.includes(postcode)) || null;
}

function pushScreen(screenFunction) {
  assistantHistory.push(screenFunction);
}

function renderProgress(step, label, isComplete = false) {
  const progress = isComplete ? 100 : (step / assistantStepCount) * 100;
  const count = isComplete ? "Terminé" : `Étape ${step} sur ${assistantStepCount}`;

  return `
    <div
      class="assistant-progress"
      role="progressbar"
      aria-label="${label}"
      aria-valuemin="1"
      aria-valuemax="${assistantStepCount}"
      aria-valuenow="${step}"
      style="--assistant-progress: ${progress}%">
      <span>${label}</span>
      <strong>${count}</strong>
      <i aria-hidden="true"><span></span></i>
    </div>
  `;
}

function renderAssistant(markup, focusSelector = "[data-assistant-heading]") {
  const assistant = getAssistantElement();

  if (!assistant) {
    return null;
  }

  assistant.innerHTML = markup;

  const screen = assistant.querySelector(".assistant-screen");

  if (screen) {
    screen.scrollTop = 0;
  }

  requestAnimationFrame(() => {
    const focusTarget = assistant.querySelector(focusSelector);

    if (focusTarget) {
      focusTarget.focus({ preventScroll: true });
    }
  });

  return assistant;
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

function connectBackControl(assistant) {
  const backButton = assistant.querySelector("[data-assistant-back]");

  if (backButton) {
    backButton.addEventListener("click", goBack);
  }
}

function setPostcodeError(assistant, message = "") {
  const input = assistant.querySelector("#assistant-postcode");
  const error = assistant.querySelector("#assistant-postcode-error");
  const hasError = Boolean(message);

  input.setAttribute("aria-invalid", String(hasError));
  error.textContent = message;
  error.hidden = !hasError;
}

function showPostcodeScreen(addToHistory = true) {
  if (addToHistory) {
    assistantHistory.length = 0;
    pushScreen(showPostcodeScreen);
  }

  const assistant = renderAssistant(`
    <div class="assistant-screen">
      ${renderProgress(1, "Zone de livraison")}
      <h2 data-assistant-heading tabindex="-1">Quel est votre code postal ?</h2>
      <p>Nous vérifierons immédiatement votre zone de livraison.</p>

      <form data-postcode-form novalidate>
        <label class="assistant-label" for="assistant-postcode">Code postal</label>

        <input
          id="assistant-postcode"
          class="assistant-line-input"
          type="text"
          inputmode="numeric"
          maxlength="5"
          pattern="[0-9]{5}"
          placeholder="16000"
          autocomplete="postal-code"
          aria-describedby="assistant-postcode-hint assistant-postcode-error"
          aria-invalid="false"
          required
          value="${assistantState.postcode}">

        <p id="assistant-postcode-hint" class="assistant-hint">
          Disponible actuellement dans certaines zones de la Charente.
        </p>

        <p id="assistant-postcode-error" class="assistant-error" role="alert" hidden></p>

        <button class="assistant-next" type="submit">
          Vérifier ma zone →
        </button>
      </form>
    </div>
  `, "#assistant-postcode");

  if (!assistant) {
    return;
  }

  const form = assistant.querySelector("[data-postcode-form]");
  const input = assistant.querySelector("#assistant-postcode");

  input.addEventListener("input", () => {
    input.value = input.value.replace(/\D/g, "");
    assistantState.postcode = input.value;
    assistantState.zone = null;
    setPostcodeError(assistant);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    if (input.value.length !== 5) {
      setPostcodeError(assistant, "Saisissez un code postal à 5 chiffres.");
      input.focus();
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
}

function showZoneScreen(addToHistory = true) {
  if (addToHistory) {
    pushScreen(showZoneScreen);
  }

  const assistant = renderAssistant(`
    <div class="assistant-screen">
      ${renderBackControl()}
      ${renderProgress(1, "Zone de livraison")}
      <h2 data-assistant-heading tabindex="-1">Bonne nouvelle.</h2>
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
  `);

  connectBackControl(assistant);
  assistant.querySelector("[data-next-room]").addEventListener("click", showRoomScreen);
}

function showUnavailableScreen(addToHistory = true) {
  if (addToHistory) {
    pushScreen(showUnavailableScreen);
  }

  const assistant = renderAssistant(`
    <div class="assistant-screen">
      ${renderBackControl()}
      ${renderProgress(1, "Zone de livraison")}
      <h2 data-assistant-heading tabindex="-1">Pas encore dans votre secteur.</h2>
      <p>IGLOUE se concentre actuellement sur certaines zones de la Charente.</p>

      <p class="assistant-note" role="status">
        Le code postal ${assistantState.postcode} n’est pas dans la zone desservie actuellement.
      </p>

      <button class="assistant-next" type="button" data-restart>
        Modifier le code postal →
      </button>
    </div>
  `);

  connectBackControl(assistant);
  assistant.querySelector("[data-restart]").addEventListener("click", () => showPostcodeScreen(false));
}

function showRoomScreen(addToHistory = true) {
  if (addToHistory) {
    pushScreen(showRoomScreen);
  }

  const rooms = [
    ["chambre", "Chambre"],
    ["salon", "Salon"],
    ["bureau", "Bureau"],
    ["autre", "Autre pièce"]
  ];
  const roomOptions = rooms.map(([value, label]) => `
    <button
      class="${assistantState.room === value ? "is-selected" : ""}"
      type="button"
      aria-pressed="${assistantState.room === value}"
      data-room="${value}">${label}</button>
  `).join("");

  const assistant = renderAssistant(`
    <div class="assistant-screen">
      ${renderBackControl()}
      ${renderProgress(2, "Type de pièce")}
      <h2 data-assistant-heading tabindex="-1">Quelle pièce souhaitez-vous rafraîchir ?</h2>

      <div class="assistant-options">
        ${roomOptions}
      </div>
    </div>
  `);

  connectBackControl(assistant);

  assistant.querySelectorAll("[data-room]").forEach((button) => {
    button.addEventListener("click", () => {
      assistantState.room = button.dataset.room;
      showSizeScreen();
    });
  });
}

function showSizeScreen(addToHistory = true) {
  if (addToHistory) {
    pushScreen(showSizeScreen);
  }

  const sizes = [
    ["small", "Moins de 15 m²"],
    ["medium", "De 15 à 25 m²"],
    ["large", "De 25 à 35 m²"],
    ["xl", "Plus de 35 m²"]
  ];
  const sizeOptions = sizes.map(([value, label]) => `
    <button
      class="${assistantState.size === value ? "is-selected" : ""}"
      type="button"
      aria-pressed="${assistantState.size === value}"
      data-size="${value}">${label}</button>
  `).join("");

  const assistant = renderAssistant(`
    <div class="assistant-screen">
      ${renderBackControl()}
      ${renderProgress(3, "Surface de la pièce")}
      <h2 data-assistant-heading tabindex="-1">Quelle est la taille de cette pièce ?</h2>

      <div class="assistant-options">
        ${sizeOptions}
      </div>
    </div>
  `);

  connectBackControl(assistant);

  assistant.querySelectorAll("[data-size]").forEach((button) => {
    button.addEventListener("click", () => {
      assistantState.size = button.dataset.size;
      assistantState.product = findProductByRoomSize(assistantState.size);
      showRecommendationScreen();
    });
  });
}

function showRecommendationScreen(addToHistory = true) {
  const product = assistantState.product;

  if (addToHistory) {
    pushScreen(showRecommendationScreen);
  }

  const assistant = renderAssistant(`
    <div class="assistant-screen">
      ${renderBackControl()}
      ${renderProgress(3, "Recommandation")}

      <div class="assistant-product">
        <span class="assistant-product-mark" aria-hidden="true">❄</span>
        <div>
          <h2 data-assistant-heading tabindex="-1">${product.name}</h2>
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
  `);

  connectBackControl(assistant);
  assistant.querySelector("[data-next-setup]").addEventListener("click", showSetupScreen);
}

function showSetupScreen(addToHistory = true) {
  if (addToHistory) {
    pushScreen(showSetupScreen);
  }

  const assistant = renderAssistant(`
    <div class="assistant-screen">
      ${renderBackControl()}
      ${renderProgress(4, "Mise en service")}

      <div class="assistant-heading-row">
        <h2 data-assistant-heading tabindex="-1">Souhaitez-vous que nous l’installions pour vous ?</h2>
        <button
          class="assistant-help"
          type="button"
          aria-label="Afficher les détails de la mise en service"
          aria-expanded="false"
          aria-controls="assistant-setup-help"
          data-setup-help>i</button>
      </div>

      <div
        id="assistant-setup-help"
        class="assistant-help-content"
        data-setup-help-content
        hidden>
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
        <button
          class="${assistantState.setup === true ? "is-selected" : ""}"
          type="button"
          aria-pressed="${assistantState.setup === true}"
          data-setup="yes">Oui — ${formatPrice(setupPrice)}</button>
        <button
          class="${assistantState.setup === false ? "is-selected" : ""}"
          type="button"
          aria-pressed="${assistantState.setup === false}"
          data-setup="no">Non — je m’en charge</button>
      </div>
    </div>
  `);

  connectBackControl(assistant);

  const helpButton = assistant.querySelector("[data-setup-help]");
  const helpContent = assistant.querySelector("[data-setup-help-content]");

  helpButton.addEventListener("click", () => {
    const expanded = helpButton.getAttribute("aria-expanded") === "true";
    helpButton.setAttribute("aria-expanded", String(!expanded));
    helpContent.hidden = expanded;
  });

  assistant.querySelectorAll("[data-setup]").forEach((button) => {
    button.addEventListener("click", () => {
      assistantState.setup = button.dataset.setup === "yes";
      showSummaryScreen();
    });
  });
}

function buildReservationDraft() {
  const product = assistantState.product;
  const selectedSetupPrice = assistantState.setup ? setupPrice : 0;

  return {
    postcode: assistantState.postcode,
    deliveryZone: {
      id: assistantState.zone.id,
      name: assistantState.zone.name
    },
    requirement: {
      room: assistantState.room,
      size: assistantState.size
    },
    product: {
      id: product.id,
      name: product.name
    },
    pricing: {
      currency: "EUR",
      weeklyRental: roundCurrency(product.weeklyPrice),
      deliveryAndCollection: roundCurrency(assistantState.zone.price),
      setup: roundCurrency(selectedSetupPrice),
      initialTotal: roundCurrency(product.weeklyPrice + assistantState.zone.price + selectedSetupPrice)
    }
  };
}

function showSummaryScreen(addToHistory = true) {
  const product = assistantState.product;

  if (addToHistory) {
    pushScreen(showSummaryScreen);
  }

  const selectedSetupPrice = assistantState.setup ? setupPrice : 0;
  const firstWeekTotal = product.weeklyPrice + assistantState.zone.price + selectedSetupPrice;

  const assistant = renderAssistant(`
    <div class="assistant-screen">
      ${renderBackControl()}
      ${renderProgress(4, "Estimation prête", true)}
      <h2 data-assistant-heading tabindex="-1">${product.name}</h2>

      <div class="assistant-result-grid">
        <div><span>Location — première semaine</span><strong>${formatPrice(product.weeklyPrice)}</strong></div>
        <div><span>Livraison & reprise — paiement unique</span><strong>${formatPrice(assistantState.zone.price)}</strong></div>
        <div>
          <span>Mise en service — paiement unique</span>
          <strong>${assistantState.setup ? formatPrice(setupPrice) : "Non sélectionnée"}</strong>
        </div>
        <div class="assistant-total"><span>Total de départ estimé</span><strong>${formatPrice(firstWeekTotal)}</strong></div>
      </div>

      <section class="assistant-recurring-block" aria-label="Tarif après la première semaine">
        <span class="assistant-step-label">Après votre première semaine</span>
        <div class="assistant-recurring-price">
          <span>Location uniquement</span>
          <strong>${formatPrice(product.weeklyPrice)} / semaine</strong>
        </div>
      </section>

      <button class="assistant-next" type="button" data-reservation-request>
        Demander une réservation →
      </button>

      <p class="assistant-reservation-status" role="status" tabindex="-1" data-reservation-status hidden></p>
    </div>
  `);

  connectBackControl(assistant);

  assistant.querySelector("[data-reservation-request]").addEventListener("click", () => {
    const status = assistant.querySelector("[data-reservation-status]");

    assistant.dispatchEvent(new CustomEvent("igloue:reservation-requested", {
      bubbles: true,
      detail: buildReservationDraft()
    }));

    status.textContent = "La réservation en ligne n’est pas encore activée.";
    status.hidden = false;
    status.focus({ preventScroll: true });
  });
}

document.addEventListener("DOMContentLoaded", showPostcodeScreen);
