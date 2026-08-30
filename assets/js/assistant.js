const ASSISTANT_I18N = {
  fr: {
    progressLabel: "Progression de l’assistant",
    progress: ["Livraison", "Pièce", "Situation", "Dates"],
    back: "← Retour",
    next: "Continuer →",
    delivery: {
      heading: "Quel est votre code postal ?",
      introduction: "Nous vérifierons immédiatement votre zone de livraison.",
      postcodeLabel: "Code postal",
      postcodePlaceholder: "16000",
      postcodeHint: "Disponible actuellement dans certaines zones de la Charente.",
      postcodeError: "Saisissez un code postal à 5 chiffres.",
      submit: "Vérifier ma zone →",
      availableLabel: "Livraison disponible",
      availableHeading: "Bonne nouvelle.",
      availableText: "Nous livrons et reprenons le climatiseur dans votre secteur.",
      postcode: "Code postal",
      zone: "Zone",
      deliveryPrice: "Livraison & reprise",
      oneTime: "Paiement unique",
      unavailableLabel: "Zone non disponible",
      unavailableHeading: "Pas encore dans votre secteur.",
      unavailableText: "IGLOUE se concentre actuellement sur certaines zones de la Charente.",
      unavailableStatus: (postcode) => `Le code postal ${postcode} n’est pas dans la zone desservie actuellement.`,
      retry: "Modifier le code postal →"
    },
    room: {
      heading: "Quelle pièce souhaitez-vous rafraîchir ?",
      roomLegend: "Type de pièce",
      areaHeading: "Environ quelle superficie ?",
      areaLabel: "Superficie en m²",
      areaPlaceholder: "25",
      error: "Choisissez une pièce et indiquez une superficie valide.",
      types: {
        bedroom: "Chambre",
        living_room: "Salon",
        office: "Bureau",
        other: "Autre"
      }
    },
    situation: {
      heading: "Votre pièce est-elle particulièrement difficile à rafraîchir ?",
      hint: "Plusieurs réponses sont possibles.",
      error: "Sélectionnez au moins une réponse, ou « Aucun de ces cas ».",
      conditions: {
        sunny: "Très ensoleillée",
        top_floor: "Sous les combles / dernier étage",
        large_windows: "Grandes baies vitrées",
        usually_hot: "Très chaude habituellement",
        none: "Aucun de ces cas"
      }
    },
    dates: {
      heading: "Quand souhaitez-vous louer votre climatiseur ?",
      introduction: "Ces dates préparent votre demande. La disponibilité sera confirmée lors de la réservation.",
      start: "Date de début",
      end: "Date de fin",
      missingError: "Indiquez une date de début et une date de fin.",
      pastError: "La date de début ne peut pas être antérieure à aujourd’hui.",
      orderError: "La date de fin doit être identique ou postérieure à la date de début.",
      submit: "Voir ma recommandation →"
    },
    result: {
      eyebrow: "Notre recommandation",
      recommendation: ({ room, area, product }) => (
        `Pour votre ${room.toLowerCase()} de ${area} m², ${product} offre la puissance adaptée.`
      ),
      conditions: (conditions) => `Nous avons également tenu compte de : ${conditions.join(", ").toLowerCase()}.`,
      upgraded: "Ces contraintes conduisent à retenir le modèle supérieur.",
      rental: "Location — première semaine",
      delivery: "Livraison & reprise — paiement unique",
      setup: "Mise en service — paiement unique",
      setupOption: (price) => `Ajouter la mise en service (+${price})`,
      setupHint: "Placement, branchement, kit fenêtre compatible, test et démonstration.",
      setupNotSelected: "Non sélectionnée",
      total: "Total de départ estimé",
      afterFirstWeek: "Après votre première semaine",
      rentalOnly: "Location uniquement",
      request: "Demander une réservation →",
      reservationStatus: "La réservation en ligne n’est pas encore activée.",
      dateSummary: (start, end) => `Du ${start} au ${end}`
    }
  }
};

const assistantLocale = document.documentElement.lang.split("-")[0] || "fr";
const assistantCopy = ASSISTANT_I18N[assistantLocale] || ASSISTANT_I18N.fr;

const assistantState = {
  postcode: "",
  deliveryZone: null,
  deliveryPrice: 0,
  roomType: "",
  roomArea: null,
  roomConditions: null,
  startDate: "",
  endDate: "",
  recommendedProduct: null,
  setup: false,
  pricing: null
};

const assistantHistory = [];
const assistantStepCount = 4;
let assistantAdvanceTimer = null;

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
const roomTypeIds = ["bedroom", "living_room", "office", "other"];
const roomConditionIds = ["sunny", "top_floor", "large_windows", "usually_hot"];

function getAssistantElement() {
  return document.querySelector("[data-assistant]");
}

function formatPrice(price) {
  return `${price.toFixed(2).replace(".", ",")} €`;
}

function roundCurrency(price) {
  return Math.round((price + Number.EPSILON) * 100) / 100;
}

function formatDate(dateValue) {
  return new Intl.DateTimeFormat(assistantLocale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(new Date(`${dateValue}T12:00:00`));
}

function getTodayValue() {
  const today = new Date();
  const offset = today.getTimezoneOffset();
  return new Date(today.getTime() - (offset * 60 * 1000)).toISOString().slice(0, 10);
}

function findZone(postcode) {
  return deliveryZones.find((zone) => zone.postcodes.includes(postcode)) || null;
}

function clearAdvanceTimer() {
  if (assistantAdvanceTimer) {
    window.clearTimeout(assistantAdvanceTimer);
    assistantAdvanceTimer = null;
  }
}

function invalidateRecommendation() {
  assistantState.recommendedProduct = null;
  assistantState.pricing = null;
}

function renderProgress(activeStep, isResult = false) {
  const items = assistantCopy.progress.map((label, index) => {
    const step = index + 1;
    const stateClass = isResult || step < activeStep
      ? "is-complete"
      : step === activeStep ? "is-current" : "";

    return `<li class="${stateClass}"><span>0${step}</span>${label}</li>`;
  }).join("");

  return `
    <ol class="assistant-progress" aria-label="${assistantCopy.progressLabel}">
      ${items}
    </ol>
  `;
}

function renderBackControl() {
  return `
    <button class="assistant-back" type="button" data-assistant-back>
      ${assistantCopy.back}
    </button>
  `;
}

function renderStageShell({ stage, mascotState, content, isResult = false }) {
  return `
    <div class="assistant-screen" data-assistant-stage="${mascotState}">
      <div class="assistant-stage-layout">
        <div class="assistant-stage-content">
          ${renderProgress(stage, isResult)}
          ${content}
        </div>

        <aside
          class="assistant-mascot-slot"
          data-assistant-mascot="${mascotState}"
          aria-hidden="true">
        </aside>
      </div>
    </div>
  `;
}

function renderAssistant(markup, focusSelector = "[data-assistant-heading]") {
  const assistant = getAssistantElement();

  if (!assistant) {
    return null;
  }

  clearAdvanceTimer();
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

function pushStage(stageFunction) {
  assistantHistory.push(stageFunction);
}

function goBack() {
  clearAdvanceTimer();

  if (assistantHistory.length <= 1) {
    showDeliveryStage(false);
    return;
  }

  assistantHistory.pop();
  const previousStage = assistantHistory[assistantHistory.length - 1];
  previousStage(false);
}

function connectBackControl(assistant) {
  const backButton = assistant.querySelector("[data-assistant-back]");

  if (backButton) {
    backButton.addEventListener("click", goBack);
  }
}

function setFieldError(assistant, inputSelector, errorSelector, message = "") {
  const input = assistant.querySelector(inputSelector);
  const error = assistant.querySelector(errorSelector);
  const hasError = Boolean(message);

  if (input) {
    input.setAttribute("aria-invalid", String(hasError));
  }

  error.textContent = message;
  error.hidden = !hasError;
}

function setDeliveryState(postcode) {
  const postcodeChanged = assistantState.postcode !== postcode;
  const zone = findZone(postcode);

  assistantState.postcode = postcode;
  assistantState.deliveryZone = zone;
  assistantState.deliveryPrice = zone ? zone.price : 0;

  if (postcodeChanged) {
    invalidateRecommendation();
  }
}

function showDeliveryStage(addToHistory = true) {
  if (addToHistory) {
    assistantHistory.length = 0;
    pushStage(showDeliveryStage);
  }

  const copy = assistantCopy.delivery;
  const assistant = renderAssistant(renderStageShell({
    stage: 1,
    mascotState: "delivery",
    content: `
      <h2 data-assistant-heading tabindex="-1">${copy.heading}</h2>
      <p>${copy.introduction}</p>

      <form data-postcode-form novalidate>
        <label class="assistant-label" for="assistant-postcode">${copy.postcodeLabel}</label>
        <input
          id="assistant-postcode"
          class="assistant-line-input"
          type="text"
          inputmode="numeric"
          maxlength="5"
          pattern="[0-9]{5}"
          placeholder="${copy.postcodePlaceholder}"
          autocomplete="postal-code"
          aria-describedby="assistant-postcode-hint assistant-postcode-error"
          aria-invalid="false"
          required
          value="${assistantState.postcode}">

        <p id="assistant-postcode-hint" class="assistant-hint">${copy.postcodeHint}</p>
        <p id="assistant-postcode-error" class="assistant-error" role="alert" hidden></p>

        <button class="assistant-next" type="submit">${copy.submit}</button>
      </form>
    `
  }), "#assistant-postcode");

  const form = assistant.querySelector("[data-postcode-form]");
  const input = assistant.querySelector("#assistant-postcode");

  input.addEventListener("input", () => {
    input.value = input.value.replace(/\D/g, "");
    setDeliveryState(input.value);
    setFieldError(assistant, "#assistant-postcode", "#assistant-postcode-error");
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
      setFieldError(assistant, "#assistant-postcode", "#assistant-postcode-error", copy.postcodeError);
      input.focus();
      return;
    }

    setDeliveryState(input.value);

    if (assistantState.deliveryZone) {
      showDeliveryConfirmation();
    } else {
      showUnavailableDelivery();
    }
  });
}

function showDeliveryConfirmation() {
  const copy = assistantCopy.delivery;
  const assistant = renderAssistant(renderStageShell({
    stage: 1,
    mascotState: "delivery",
    content: `
      <span class="assistant-step-label">${copy.availableLabel}</span>
      <h2 data-assistant-heading tabindex="-1">${copy.availableHeading}</h2>
      <p>${copy.availableText}</p>

      <div class="assistant-result-grid assistant-delivery-confirmation" role="status">
        <div><span>${copy.postcode}</span><strong>${assistantState.postcode}</strong></div>
        <div><span>${copy.zone}</span><strong>${assistantState.deliveryZone.name}</strong></div>
        <div><span>${copy.deliveryPrice}</span><strong>${formatPrice(assistantState.deliveryPrice)}</strong></div>
      </div>

      <p class="assistant-note">${copy.oneTime}</p>
    `
  }));

  assistant.setAttribute("aria-busy", "false");
  assistantAdvanceTimer = window.setTimeout(() => showRoomStage(), 1100);
}

function showUnavailableDelivery() {
  const copy = assistantCopy.delivery;
  const assistant = renderAssistant(renderStageShell({
    stage: 1,
    mascotState: "delivery",
    content: `
      <span class="assistant-step-label">${copy.unavailableLabel}</span>
      <h2 data-assistant-heading tabindex="-1">${copy.unavailableHeading}</h2>
      <p>${copy.unavailableText}</p>
      <p class="assistant-note" role="status">${copy.unavailableStatus(assistantState.postcode)}</p>
      <button class="assistant-next" type="button" data-restart>${copy.retry}</button>
    `
  }));

  assistant.querySelector("[data-restart]").addEventListener("click", () => showDeliveryStage(false));
}

function showRoomStage(addToHistory = true) {
  if (addToHistory) {
    pushStage(showRoomStage);
  }

  const copy = assistantCopy.room;
  const roomButtons = roomTypeIds.map((roomId) => `
    <button
      class="${assistantState.roomType === roomId ? "is-selected" : ""}"
      type="button"
      aria-pressed="${assistantState.roomType === roomId}"
      data-room-type="${roomId}">${copy.types[roomId]}</button>
  `).join("");

  const assistant = renderAssistant(renderStageShell({
    stage: 2,
    mascotState: "room",
    content: `
      ${renderBackControl()}
      <form data-room-form novalidate>
        <fieldset class="assistant-fieldset">
          <legend data-assistant-heading tabindex="-1">${copy.heading}</legend>
          <div class="assistant-options assistant-options-compact">${roomButtons}</div>
        </fieldset>

        <label class="assistant-area-label" for="assistant-room-area">
          <strong>${copy.areaHeading}</strong>
          <span>${copy.areaLabel}</span>
        </label>
        <div class="assistant-area-input-wrap">
          <input
            id="assistant-room-area"
            class="assistant-area-input"
            type="number"
            inputmode="decimal"
            min="1"
            max="200"
            step="1"
            placeholder="${copy.areaPlaceholder}"
            aria-describedby="assistant-room-error"
            aria-invalid="false"
            value="${assistantState.roomArea || ""}">
          <span aria-hidden="true">m²</span>
        </div>

        <p id="assistant-room-error" class="assistant-error" role="alert" hidden></p>
        <button class="assistant-next" type="submit">${assistantCopy.next}</button>
      </form>
    `
  }));

  connectBackControl(assistant);
  const form = assistant.querySelector("[data-room-form]");
  const areaInput = assistant.querySelector("#assistant-room-area");

  assistant.querySelectorAll("[data-room-type]").forEach((button) => {
    button.addEventListener("click", () => {
      assistantState.roomType = button.dataset.roomType;
      invalidateRecommendation();

      assistant.querySelectorAll("[data-room-type]").forEach((option) => {
        const selected = option === button;
        option.classList.toggle("is-selected", selected);
        option.setAttribute("aria-pressed", String(selected));
      });
    });
  });

  areaInput.addEventListener("input", () => {
    assistantState.roomArea = areaInput.value ? Number(areaInput.value) : null;
    invalidateRecommendation();
    setFieldError(assistant, "#assistant-room-area", "#assistant-room-error");
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const area = Number(areaInput.value);

    if (!assistantState.roomType || !Number.isFinite(area) || area < 1 || area > 200) {
      setFieldError(assistant, "#assistant-room-area", "#assistant-room-error", copy.error);
      return;
    }

    assistantState.roomArea = area;
    invalidateRecommendation();
    showSituationStage();
  });
}

function showSituationStage(addToHistory = true) {
  if (addToHistory) {
    pushStage(showSituationStage);
  }

  const copy = assistantCopy.situation;
  const selectedConditions = assistantState.roomConditions || [];
  const conditionOptions = roomConditionIds.map((conditionId) => `
    <label class="assistant-check-option">
      <input
        type="checkbox"
        value="${conditionId}"
        data-room-condition
        ${selectedConditions.includes(conditionId) ? "checked" : ""}>
      <span>${copy.conditions[conditionId]}</span>
    </label>
  `).join("");

  const assistant = renderAssistant(renderStageShell({
    stage: 3,
    mascotState: "situation",
    content: `
      ${renderBackControl()}
      <form data-situation-form novalidate>
        <fieldset class="assistant-fieldset">
          <legend data-assistant-heading tabindex="-1">${copy.heading}</legend>
          <p class="assistant-hint">${copy.hint}</p>
          <div class="assistant-check-grid">
            ${conditionOptions}
            <label class="assistant-check-option assistant-check-none">
              <input
                type="checkbox"
                value="none"
                data-condition-none
                ${assistantState.roomConditions && assistantState.roomConditions.length === 0 ? "checked" : ""}>
              <span>${copy.conditions.none}</span>
            </label>
          </div>
        </fieldset>

        <p id="assistant-situation-error" class="assistant-error" role="alert" hidden></p>
        <button class="assistant-next" type="submit">${assistantCopy.next}</button>
      </form>
    `
  }));

  connectBackControl(assistant);
  const form = assistant.querySelector("[data-situation-form]");
  const noneOption = assistant.querySelector("[data-condition-none]");
  const conditionInputs = [...assistant.querySelectorAll("[data-room-condition]")];
  const error = assistant.querySelector("#assistant-situation-error");

  function syncConditionState() {
    if (noneOption.checked) {
      assistantState.roomConditions = [];
    } else {
      assistantState.roomConditions = conditionInputs
        .filter((input) => input.checked)
        .map((input) => input.value);
    }

    invalidateRecommendation();
    error.hidden = true;
    error.textContent = "";
  }

  conditionInputs.forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) {
        noneOption.checked = false;
      }

      syncConditionState();
    });
  });

  noneOption.addEventListener("change", () => {
    if (noneOption.checked) {
      conditionInputs.forEach((input) => {
        input.checked = false;
      });
    }

    syncConditionState();
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    if (assistantState.roomConditions === null) {
      error.textContent = copy.error;
      error.hidden = false;
      return;
    }

    showDatesStage();
  });
}

function showDatesStage(addToHistory = true) {
  if (addToHistory) {
    pushStage(showDatesStage);
  }

  const copy = assistantCopy.dates;
  const today = getTodayValue();
  const assistant = renderAssistant(renderStageShell({
    stage: 4,
    mascotState: "dates",
    content: `
      ${renderBackControl()}
      <h2 data-assistant-heading tabindex="-1">${copy.heading}</h2>
      <p>${copy.introduction}</p>

      <form data-dates-form novalidate>
        <div class="assistant-date-grid">
          <label>
            <span>${copy.start}</span>
            <input type="date" min="${today}" value="${assistantState.startDate}" data-start-date>
          </label>
          <label>
            <span>${copy.end}</span>
            <input type="date" min="${assistantState.startDate || today}" value="${assistantState.endDate}" data-end-date>
          </label>
        </div>

        <p id="assistant-dates-error" class="assistant-error" role="alert" hidden></p>
        <button class="assistant-next" type="submit">${copy.submit}</button>
      </form>
    `
  }));

  connectBackControl(assistant);
  const form = assistant.querySelector("[data-dates-form]");
  const startInput = assistant.querySelector("[data-start-date]");
  const endInput = assistant.querySelector("[data-end-date]");
  const error = assistant.querySelector("#assistant-dates-error");

  startInput.addEventListener("change", () => {
    assistantState.startDate = startInput.value;
    endInput.min = startInput.value || today;
    invalidateRecommendation();
    error.hidden = true;
  });

  endInput.addEventListener("change", () => {
    assistantState.endDate = endInput.value;
    invalidateRecommendation();
    error.hidden = true;
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const startDate = startInput.value;
    const endDate = endInput.value;
    let message = "";

    if (!startDate || !endDate) {
      message = copy.missingError;
    } else if (startDate < today) {
      message = copy.pastError;
    } else if (endDate < startDate) {
      message = copy.orderError;
    }

    if (message) {
      error.textContent = message;
      error.hidden = false;
      return;
    }

    assistantState.startDate = startDate;
    assistantState.endDate = endDate;
    calculateRecommendationAndPricing();
    showRecommendationResult();
  });
}

function calculateRecommendationAndPricing() {
  const hasDifficultConditions = assistantState.roomConditions.length > 0;
  assistantState.recommendedProduct = findProductByRoomArea(
    assistantState.roomArea,
    hasDifficultConditions
  );
  assistantState.pricing = calculatePricing();
}

function calculatePricing() {
  const product = assistantState.recommendedProduct;
  const selectedSetupPrice = assistantState.setup ? setupPrice : 0;

  return {
    currency: "EUR",
    weeklyRental: roundCurrency(product.weeklyPrice),
    deliveryAndCollection: roundCurrency(assistantState.deliveryPrice),
    setup: roundCurrency(selectedSetupPrice),
    initialTotal: roundCurrency(product.weeklyPrice + assistantState.deliveryPrice + selectedSetupPrice)
  };
}

function buildRecommendationExplanation() {
  const copy = assistantCopy.result;
  const roomLabel = assistantCopy.room.types[assistantState.roomType];
  const conditions = assistantState.roomConditions.map((id) => assistantCopy.situation.conditions[id]);
  const baseProduct = findProductByRoomArea(assistantState.roomArea, false);
  const product = assistantState.recommendedProduct;
  const parts = [copy.recommendation({
    room: roomLabel,
    area: assistantState.roomArea,
    product: product.name
  })];

  if (conditions.length) {
    parts.push(copy.conditions(conditions));
  }

  if (product.id !== baseProduct.id) {
    parts.push(copy.upgraded);
  }

  return parts.join(" ");
}

function updateResultPricing(assistant) {
  assistantState.pricing = calculatePricing();
  const pricing = assistantState.pricing;

  assistant.querySelector("[data-price-rental]").textContent = formatPrice(pricing.weeklyRental);
  assistant.querySelector("[data-price-delivery]").textContent = formatPrice(pricing.deliveryAndCollection);
  assistant.querySelector("[data-price-setup]").textContent = assistantState.setup
    ? formatPrice(pricing.setup)
    : assistantCopy.result.setupNotSelected;
  assistant.querySelector("[data-price-total]").textContent = formatPrice(pricing.initialTotal);
  assistant.querySelector("[data-price-recurring]").textContent = `${formatPrice(pricing.weeklyRental)} / semaine`;
}

function buildReservationDraft() {
  const product = assistantState.recommendedProduct;

  return {
    postcode: assistantState.postcode,
    deliveryZone: {
      id: assistantState.deliveryZone.id,
      name: assistantState.deliveryZone.name
    },
    deliveryPrice: assistantState.deliveryPrice,
    requirement: {
      roomType: assistantState.roomType,
      roomArea: assistantState.roomArea,
      roomConditions: [...assistantState.roomConditions]
    },
    rentalDates: {
      startDate: assistantState.startDate,
      endDate: assistantState.endDate
    },
    product: {
      id: product.id,
      name: product.name
    },
    pricing: { ...assistantState.pricing }
  };
}

function showRecommendationResult(addToHistory = true) {
  if (addToHistory) {
    pushStage(showRecommendationResult);
  }

  if (!assistantState.recommendedProduct || !assistantState.pricing) {
    calculateRecommendationAndPricing();
  }

  const copy = assistantCopy.result;
  const product = assistantState.recommendedProduct;
  const pricing = assistantState.pricing;
  const assistant = renderAssistant(renderStageShell({
    stage: 4,
    mascotState: "recommendation",
    isResult: true,
    content: `
      ${renderBackControl()}
      <span class="assistant-step-label">${copy.eyebrow}</span>
      <h2 data-assistant-heading tabindex="-1">${product.name}</h2>
      <p class="assistant-recommendation-copy">${buildRecommendationExplanation()}</p>
      <p class="assistant-date-summary">${copy.dateSummary(formatDate(assistantState.startDate), formatDate(assistantState.endDate))}</p>

      <label class="assistant-setup-option">
        <input type="checkbox" data-setup-option ${assistantState.setup ? "checked" : ""}>
        <span>
          <strong>${copy.setupOption(formatPrice(setupPrice))}</strong>
          <small>${copy.setupHint}</small>
        </span>
      </label>

      <div class="assistant-result-grid">
        <div><span>${copy.rental}</span><strong data-price-rental>${formatPrice(pricing.weeklyRental)}</strong></div>
        <div><span>${copy.delivery}</span><strong data-price-delivery>${formatPrice(pricing.deliveryAndCollection)}</strong></div>
        <div><span>${copy.setup}</span><strong data-price-setup>${assistantState.setup ? formatPrice(pricing.setup) : copy.setupNotSelected}</strong></div>
        <div class="assistant-total"><span>${copy.total}</span><strong data-price-total>${formatPrice(pricing.initialTotal)}</strong></div>
      </div>

      <div class="assistant-recurring-price assistant-recurring-compact">
        <span>${copy.afterFirstWeek} · ${copy.rentalOnly}</span>
        <strong data-price-recurring>${formatPrice(pricing.weeklyRental)} / semaine</strong>
      </div>

      <button class="assistant-next" type="button" data-reservation-request>${copy.request}</button>
      <p class="assistant-reservation-status" role="status" tabindex="-1" data-reservation-status hidden></p>
    `
  }));

  connectBackControl(assistant);

  assistant.querySelector("[data-setup-option]").addEventListener("change", (event) => {
    assistantState.setup = event.target.checked;
    updateResultPricing(assistant);
  });

  assistant.querySelector("[data-reservation-request]").addEventListener("click", () => {
    const status = assistant.querySelector("[data-reservation-status]");

    assistant.dispatchEvent(new CustomEvent("igloue:reservation-requested", {
      bubbles: true,
      detail: buildReservationDraft()
    }));

    status.textContent = copy.reservationStatus;
    status.hidden = false;
    status.focus({ preventScroll: true });
  });
}

document.addEventListener("DOMContentLoaded", showDeliveryStage);
