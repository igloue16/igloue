const ASSISTANT_I18N = {
  fr: {
    progressLabel: "Progression de l’assistant",
    progress: [
      "Livraison",
      "Pièce",
      "Situation",
      "Ouverture",
      "Dates"
    ],

    back: "← Retour",
    next: "Continuer →",

    delivery: {
      heading: "Quel est votre code postal ?",
      introduction:
        "Nous vérifions votre zone de livraison et les climatiseurs disponibles à votre adresse.",

      postcodeLabel: "Code postal",
      postcodePlaceholder: "16000",

      postcodeHint:
        "IGLOUE dessert Angoulême et une grande partie de la Charente.",

      postcodeError:
        "Saisissez un code postal à 5 chiffres.",

      submit: "Vérifier ma zone →",

      availableLabel: "Livraison disponible",
      availableHeading: "Nous pouvons vous livrer.",
      availableText:
        "Le tarif comprend la livraison du climatiseur et sa reprise en fin de location.",

      postcode: "Code postal",
      zone: "Secteur",
      deliveryPrice: "Livraison + reprise",
      oneTime: "Ce transport n’est facturé qu’une seule fois.",

      unavailableLabel: "Adresse à vérifier",
      unavailableHeading: "Nous devons vérifier votre secteur.",
      unavailableText:
        "Votre code postal n’est pas encore configuré dans notre calculateur automatique.",

      unavailableStatus: (postcode) =>
        `Le code postal ${postcode} nécessite une confirmation manuelle.`,

      retry: "Modifier le code postal →"
    },

    room: {
      heading: "Quelle pièce souhaitez-vous rafraîchir ?",

      areaHeading: "Quelle est sa superficie ?",
      areaLabel: "Superficie approximative",
      areaValue: (area) =>
        area >= 60 ? "60+ m²" : `Environ ${area} m²`,
      areaExample: ({ width, length, area }) =>
        `Exemple : ${width} m × ${length} m ≈ ${area >= 60 ? "60+" : area} m²`,

      error:
        "Choisissez une pièce pour continuer.",

      types: {
        bedroom: "Chambre",
        living_room: "Salon / séjour",
        office: "Bureau",
        other: "Autre"
      }
    },

    situation: {
      heading:
        "Cette pièce est-elle particulièrement difficile à rafraîchir ?",

      hint: "Vous pouvez sélectionner plusieurs réponses.",

      error:
        "Sélectionnez au moins une réponse, ou « Aucun de ces cas ».",

      conditions: {
        sunny: "Très ensoleillée",
        top_floor: "Sous les combles / dernier étage",
        large_windows: "Grandes surfaces vitrées",
        usually_hot: "Très chaude habituellement",
        none: "Aucun de ces cas"
      }
    },

    opening: {
      heading: "Quelle ouverture pouvons-nous utiliser ?",

      introduction:
        "Le bon kit dépend de votre fenêtre, porte-fenêtre ou accès extérieur.",

      error: "Sélectionnez le type d’ouverture le plus proche de votre situation.",

      types: {
        casement: "Fenêtre classique",
        tilt_turn: "Oscillo-battante",
        sliding: "Fenêtre coulissante",
        french_door: "Porte-fenêtre / baie",
        velux: "Fenêtre de toit / Velux",
        terrace: "Terrasse / balcon",
        unsure: "Je ne sais pas"
      },

      notes: {
        terrace:
          "Une terrasse ou un balcon est souvent la solution la plus simple pour un climatiseur split.",
        velux:
          "Les fenêtres de toit nécessitent généralement un kit ou une adaptation spécifique.",
        unsure:
          "Pas de problème. Nous pourrons vérifier votre ouverture avant la livraison."
      }
    },

    dates: {
      heading: "Quand souhaitez-vous le climatiseur ?",

      introduction:
        "La location est calculée au prorata du tarif hebdomadaire, avec un minimum de 3 nuits.",

      start: "Livraison",
      end: "Reprise",

      missingError:
        "Indiquez une date de livraison et une date de reprise.",

      pastError:
  "La première date de livraison disponible est demain.",

      orderError:
        "La reprise doit avoir lieu après la livraison.",

      submit: "Voir ma recommandation →"
    },

    result: {
      eyebrow: "Recommandation IGLOUE",

      recommendation: ({ room, area, product }) =>
        `Pour votre ${room.toLowerCase()} d’environ ${area >= 60 ? "60+" : area} m², nous vous recommandons ${product}.`,

      conditions: (conditions) =>
        `Nous avons également tenu compte de : ${conditions
          .join(", ")
          .toLowerCase()}.`,

      upgraded:
        "Les contraintes de la pièce nous conduisent à privilégier un modèle plus puissant.",

      limitedArea:
        "Le modèle d’entrée de gamme n’est pas proposé dans votre secteur de livraison.",

      nights: (count) =>
        `${count} nuit${count > 1 ? "s" : ""} de location`,

      minimumNights:
        "Minimum de facturation : 3 nuits.",

      rental: "Location",
      delivery: "Livraison + reprise",
      setup: "Mise en service / installation",

      total: "À payer",

      weeklyReference: "Tarif affiché",
      perWeek: "/ semaine",

      modelChoiceHeading: "Choisissez votre modèle",
      modelChoiceHint:
        "Notre recommandation reste votre meilleur repère, mais vous gardez le choix.",
      selectionDetails: "Détails de votre recommandation",
      showInformation: "Afficher les informations",
      hideInformation: "Masquer les informations",
      recommendedLabel: "Recommandé par IGLOUE",
      recommendedShort: "Recommandé",
      unavailableShort: "Indisponible",
      selectedSummary: ({ room, area, product }) =>
        `Vous avez sélectionné ${product} pour votre ${room.toLowerCase()} d’environ ${area >= 60 ? "60+" : area} m².`,

      sizing: {
        best: {
          label: "Recommandé par IGLOUE",
          text: "Le modèle le mieux adapté aux informations que vous nous avez données."
        },
        slightlySmaller: {
          label: "Un peu juste",
          text: "Il peut améliorer votre confort, mais devra travailler davantage pour cette surface."
        },
        tooSmall: {
          label: "Trop petit pour cette pièce",
          text: "Il apportera un peu de fraîcheur, mais nous ne le recommandons pas pour refroidir efficacement cette surface."
        },
        slightlyLarger: {
          label: "Plus puissant que nécessaire",
          text: "Il fonctionnera très bien, mais le modèle inférieur devrait suffire pour votre pièce."
        },
        muchLarger: {
          label: "Très largement dimensionné",
          text: "Il fonctionnera, mais un modèle plus petit suffit normalement pour cette pièce."
        }
      },

      cautionHeading: "Garantie du matériel",
      cautionLabel: "Caution sécurisée",
      cautionNotCharged: (amount) =>
        `${amount} non ajoutés à votre paiement`,
      cautionExplanation:
        "Si le matériel est rendu normalement, aucun montant n’est prélevé au titre de la caution.",

      setupRequired:
        "Pour ce modèle, la mise en service par IGLOUE est obligatoire.",

      setupOptional:
        "Vous pouvez installer ce modèle vous-même ou demander notre aide.",

      assessmentHeading: "Vérification nécessaire",
      assessmentText:
        "Votre configuration nécessite une validation avant de confirmer la réservation.",

      undersizedWarning:
        "Attention : ce modèle est prévu pour une surface inférieure à celle indiquée. Le rafraîchissement pourra être moins efficace.",

      alternativeSelected:
        "Vous avez choisi ce modèle disponible en remplacement de notre recommandation initiale.",

      unavailableHeading: "Notre recommandation n’est plus disponible",

      unavailableText: (product) =>
        `Nous vous recommanderions normalement ${product} pour cette configuration, mais tous nos appareils de ce modèle sont déjà réservés pour vos dates.`,

      largerAlternative:
        "Plus puissant que nécessaire, mais parfaitement capable de rafraîchir votre pièce.",

      smallerAlternative:
        "Moins puissant que notre recommandation idéale. Il peut apporter un rafraîchissement utile, mais sera moins adapté à votre pièce.",

      chooseAlternative: "Choisir cette alternative →",

      noAlternativeHeading:
        "Aucun modèle adapté disponible",

      noAlternativeText:
        "Nous n’avons malheureusement plus de climatiseur suffisamment adapté à votre configuration pour ces dates.",

      request: "Demander une réservation →",

      reservationStatus:
        "La réservation en ligne sera connectée à cette étape prochainement.",

      dateSummary: (start, end) =>
        `Livraison le ${start} · reprise le ${end}`
    }
  }
};

const assistantLocale =
  document.documentElement.lang.split("-")[0] || "fr";

const assistantCopy =
  ASSISTANT_I18N[assistantLocale] || ASSISTANT_I18N.fr;

const assistantState = {
  postcode: "",

  deliveryZone: null,
  deliveryPrice: 0,

  roomType: "",
  roomArea: 20,
  roomConditions: null,

  openingType: "",

  startDate: "",
  endDate: "",

  recommendedProduct: null,
  idealProduct: null,

  setupMode: null,

  pricing: null,

availability: null,

requiresAssessment: false
};

const assistantHistory = [];

const roomTypeIds = [
  "bedroom",
  "living_room",
  "office",
  "other"
];

const roomConditionIds = [
  "sunny",
  "top_floor",
  "large_windows",
  "usually_hot"
];

const openingTypeIds = [
  "casement",
  "tilt_turn",
  "sliding",
  "french_door",
  "velux",
  "terrace",
  "unsure"
];

function getAssistantElement() {
  return document.querySelector("[data-assistant]");
}

function formatPrice(price) {
  return `${Number(price).toFixed(2).replace(".", ",")} €`;
}

function formatDate(dateValue) {
  return new Intl.DateTimeFormat(assistantLocale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(new Date(`${dateValue}T12:00:00`));
}

function getRoomDimensionsExample(area) {
  const numericArea = Number(area);
  const width = Math.max(
    2,
    Math.round(Math.sqrt(numericArea * 0.8))
  );

  const length = Math.max(
    width,
    Math.round(numericArea / width)
  );

  return {
    width,
    length,
    area: numericArea
  };
}

function getRoomAreaProgress(area) {
  return ((Number(area) - 8) / (60 - 8)) * 100;
}

function getEarliestDeliveryDate() {
  const tomorrow = new Date();

  tomorrow.setDate(
    tomorrow.getDate() + 1
  );

  const offset =
    tomorrow.getTimezoneOffset();

  return new Date(
    tomorrow.getTime() -
    offset * 60 * 1000
  )
    .toISOString()
    .slice(0, 10);
}

function invalidateRecommendation() {
  assistantState.recommendedProduct = null;
  assistantState.idealProduct = null;
  assistantState.setupMode = null;
  assistantState.pricing = null;
assistantState.availability = null;
assistantState.requiresAssessment = false;
}

function renderProgress(activeStep, isResult = false) {
  const items = assistantCopy.progress
    .map((label, index) => {
      const step = index + 1;

      const stateClass =
        isResult || step < activeStep
          ? "is-complete"
          : step === activeStep
            ? "is-current"
            : "";

      return `
        <li class="${stateClass}">
          <span>0${step}</span>
          ${label}
        </li>
      `;
    })
    .join("");

  return `
    <ol
      class="assistant-progress"
      aria-label="${assistantCopy.progressLabel}">
      ${items}
    </ol>
  `;
}

function renderBackControl() {
  return `
    <button
      class="assistant-back"
      type="button"
      data-assistant-back>
      ${assistantCopy.back}
    </button>
  `;
}

function renderStageShell({
  stage,
  mascotState,
  content,
  isResult = false
}) {
  return `
    <div
      class="assistant-screen${isResult ? " is-result" : ""}"
      data-assistant-stage="${mascotState}">

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

function renderAssistant(
  markup,
  focusSelector = "[data-assistant-heading]"
) {
  const assistant = getAssistantElement();

  if (!assistant) {
    return null;
  }

  assistant.innerHTML = markup;

  const screen =
    assistant.querySelector(".assistant-screen");

  if (screen) {
    screen.scrollTop = 0;
  }

  requestAnimationFrame(() => {
    const focusTarget =
      assistant.querySelector(focusSelector);

    if (focusTarget) {
      focusTarget.focus({
        preventScroll: true
      });
    }
  });

  return assistant;
}

function pushStage(stageFunction) {
  assistantHistory.push(stageFunction);
}

function goBack() {
  if (assistantHistory.length <= 1) {
    showDeliveryStage(false);
    return;
  }

  assistantHistory.pop();

  const previousStage =
    assistantHistory[assistantHistory.length - 1];

  previousStage(false);
}

function connectBackControl(assistant) {
  const backButton =
    assistant.querySelector("[data-assistant-back]");

  if (backButton) {
    backButton.addEventListener(
      "click",
      goBack
    );
  }
}

function setFieldError(
  assistant,
  inputSelector,
  errorSelector,
  message = ""
) {
  const input =
    assistant.querySelector(inputSelector);

  const error =
    assistant.querySelector(errorSelector);

  const hasError = Boolean(message);

  if (input) {
    input.setAttribute(
      "aria-invalid",
      String(hasError)
    );
  }

  if (error) {
    error.textContent = message;
    error.hidden = !hasError;
  }
}

/* --------------------------------
   DELIVERY
-------------------------------- */

function setDeliveryState(postcode) {
  const postcodeChanged =
    assistantState.postcode !== postcode;

  const zone =
    getDeliveryZoneByPostcode(postcode);

  assistantState.postcode = postcode;
  assistantState.deliveryZone = zone;
  assistantState.deliveryPrice =
    zone ? zone.price : 0;

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

  const assistant = renderAssistant(
    renderStageShell({
      stage: 1,
      mascotState: "delivery",

      content: `
        <h2
          data-assistant-heading
          tabindex="-1">
          ${copy.heading}
        </h2>

        <p>${copy.introduction}</p>

        <form
          data-postcode-form
          novalidate>

          <label
            class="assistant-label"
            for="assistant-postcode">
            ${copy.postcodeLabel}
          </label>

          <input
            id="assistant-postcode"
            class="assistant-line-input"
            type="text"
            inputmode="numeric"
            maxlength="5"
            pattern="[0-9]{5}"
            placeholder="${copy.postcodePlaceholder}"
            autocomplete="postal-code"
            aria-describedby="
              assistant-postcode-hint
              assistant-postcode-error
            "
            aria-invalid="false"
            required
            value="${assistantState.postcode}">

          <p
            id="assistant-postcode-hint"
            class="assistant-hint">
            ${copy.postcodeHint}
          </p>

          <p
            id="assistant-postcode-error"
            class="assistant-error"
            role="alert"
            hidden>
          </p>

          <button
            class="assistant-next"
            type="submit">
            ${copy.submit}
          </button>

        </form>
      `
    }),
    "#assistant-postcode"
  );

  const form =
    assistant.querySelector("[data-postcode-form]");

  const input =
    assistant.querySelector("#assistant-postcode");

 input.addEventListener("input", () => {
  input.value =
    input.value.replace(/\D/g, "");

  setFieldError(
    assistant,
    "#assistant-postcode",
    "#assistant-postcode-error"
  );

  if (input.value.length !== 5) {
    return;
  }

  setDeliveryState(input.value);

  if (assistantState.deliveryZone) {
    showDeliveryConfirmation();
  } else {
    showUnavailableDelivery();
  }
});

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    if (input.value.length !== 5) {
      setFieldError(
        assistant,
        "#assistant-postcode",
        "#assistant-postcode-error",
        copy.postcodeError
      );

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

  const assistant = renderAssistant(
    renderStageShell({
      stage: 1,
      mascotState: "delivery",

      content: `
        <span class="assistant-step-label">
          ${copy.availableLabel}
        </span>

        <h2
          data-assistant-heading
          tabindex="-1">
          ${copy.availableHeading}
        </h2>

        <p>${copy.availableText}</p>

        <div
          class="assistant-result-grid assistant-delivery-confirmation"
          role="status">

          <div>
            <span>${copy.postcode}</span>
            <strong>${assistantState.postcode}</strong>
          </div>

          <div>
            <span>${copy.zone}</span>
            <strong>${assistantState.deliveryZone.name}</strong>
          </div>

          <div>
            <span>${copy.deliveryPrice}</span>
            <strong>
              ${formatPrice(assistantState.deliveryPrice)}
            </strong>
          </div>

        </div>

        <p class="assistant-note">
          ${copy.oneTime}
        </p>

        <button
          class="assistant-next"
          type="button"
          data-delivery-continue>
          Continuer →
        </button>
      `
    })
  );

  assistant
    .querySelector("[data-delivery-continue]")
    .addEventListener("click", () => {
      showRoomStage();
    });
}

function showUnavailableDelivery() {
  const copy = assistantCopy.delivery;

  const assistant = renderAssistant(
    renderStageShell({
      stage: 1,
      mascotState: "delivery",

      content: `
        <span class="assistant-step-label">
          ${copy.unavailableLabel}
        </span>

        <h2
          data-assistant-heading
          tabindex="-1">
          ${copy.unavailableHeading}
        </h2>

        <p>${copy.unavailableText}</p>

        <p
          class="assistant-note"
          role="status">
          ${copy.unavailableStatus(
            assistantState.postcode
          )}
        </p>

        <button
          class="assistant-next"
          type="button"
          data-restart>
          ${copy.retry}
        </button>
      `
    })
  );

  assistant
    .querySelector("[data-restart]")
    .addEventListener(
      "click",
      () => showDeliveryStage(false)
    );
}

/* --------------------------------
   ROOM
-------------------------------- */

function showRoomStage(addToHistory = true) {
  if (addToHistory) {
    pushStage(showRoomStage);
  }

  const copy = assistantCopy.room;

  const selectedArea = Math.min(
    60,
    Math.max(8, Number(assistantState.roomArea) || 20)
  );

  assistantState.roomArea = selectedArea;

  const dimensions =
    getRoomDimensionsExample(selectedArea);

  const roomButtons = roomTypeIds
    .map((roomId) => `
      <button
        class="${
          assistantState.roomType === roomId
            ? "is-selected"
            : ""
        }"
        type="button"
        aria-pressed="${
          assistantState.roomType === roomId
        }"
        data-room-type="${roomId}">
        ${copy.types[roomId]}
      </button>
    `)
    .join("");

  const assistant = renderAssistant(
    renderStageShell({
      stage: 2,
      mascotState: "room",

      content: `
        ${renderBackControl()}

        <form
          data-room-form
          novalidate>

          <fieldset
            class="assistant-fieldset">

            <legend
              data-assistant-heading
              tabindex="-1">
              ${copy.heading}
            </legend>

            <div
              class="
                assistant-options
                assistant-options-compact
              ">
              ${roomButtons}
            </div>

          </fieldset>

          <div class="assistant-area-control">
            <div class="assistant-area-heading">
              <label for="assistant-room-area">
                ${copy.areaHeading}
              </label>

              <output
                for="assistant-room-area"
                aria-live="polite"
                data-room-area-value>
                ${copy.areaValue(selectedArea)}
              </output>
            </div>

            <input
              id="assistant-room-area"
              class="assistant-area-range"
              type="range"
              min="8"
              max="60"
              step="1"
              value="${selectedArea}"
              aria-describedby="assistant-area-scale assistant-room-example assistant-room-error"
              style="--assistant-range-progress: ${getRoomAreaProgress(selectedArea)}%">

            <div
              id="assistant-area-scale"
              class="assistant-area-scale"
              aria-hidden="true">
              <span>Petite</span>
              <span>Moyenne</span>
              <span>Grande</span>
              <span>60+ m²</span>
            </div>

            <p
              id="assistant-room-example"
              class="assistant-area-example"
              data-room-area-example>
              ${copy.areaExample(dimensions)}
            </p>
          </div>

          <p
            id="assistant-room-error"
            class="assistant-error"
            role="alert"
            hidden>
          </p>

          <button
            class="assistant-next"
            type="submit">
            ${assistantCopy.next}
          </button>

        </form>
      `
    })
  );

  connectBackControl(assistant);

  const form =
    assistant.querySelector("[data-room-form]");

  const areaInput =
    assistant.querySelector(
      "#assistant-room-area"
    );

  const areaValue =
    assistant.querySelector(
      "[data-room-area-value]"
    );

  const areaExample =
    assistant.querySelector(
      "[data-room-area-example]"
    );

  assistant
    .querySelectorAll("[data-room-type]")
    .forEach((button) => {
      button.addEventListener(
        "click",
        () => {
          assistantState.roomType =
            button.dataset.roomType;

          invalidateRecommendation();

          assistant
            .querySelectorAll(
              "[data-room-type]"
            )
            .forEach((option) => {
              const selected =
                option === button;

              option.classList.toggle(
                "is-selected",
                selected
              );

              option.setAttribute(
                "aria-pressed",
                String(selected)
              );
            });
        }
      );
    });

  areaInput.addEventListener(
    "input",
    () => {
      const area = Number(areaInput.value);

      assistantState.roomArea = area;

      areaValue.textContent =
        copy.areaValue(area);

      areaExample.textContent =
        copy.areaExample(
          getRoomDimensionsExample(area)
        );

      areaInput.style.setProperty(
        "--assistant-range-progress",
        `${getRoomAreaProgress(area)}%`
      );

      invalidateRecommendation();
    }
  );

  form.addEventListener(
    "submit",
    (event) => {
      event.preventDefault();

      const area =
        Number(areaInput.value);

      if (
        !assistantState.roomType ||
        !Number.isFinite(area) ||
        area < 8 ||
        area > 60
      ) {
        const error = assistant.querySelector(
          "#assistant-room-error"
        );

        error.textContent = copy.error;
        error.hidden = false;

        return;
      }

      assistantState.roomArea = area;

      invalidateRecommendation();

      showSituationStage();
    }
  );
}

/* --------------------------------
   SITUATION
-------------------------------- */

function showSituationStage(
  addToHistory = true
) {
  if (addToHistory) {
    pushStage(showSituationStage);
  }

  const copy =
    assistantCopy.situation;

  const selectedConditions =
    assistantState.roomConditions || [];

  const conditionOptions =
    roomConditionIds
      .map((conditionId) => `
        <label
          class="assistant-check-option">

          <input
            type="checkbox"
            value="${conditionId}"
            data-room-condition
            ${
              selectedConditions.includes(
                conditionId
              )
                ? "checked"
                : ""
            }>

          <span>
            ${copy.conditions[conditionId]}
          </span>

        </label>
      `)
      .join("");

  const assistant = renderAssistant(
    renderStageShell({
      stage: 3,
      mascotState: "situation",

      content: `
        ${renderBackControl()}

        <form
          data-situation-form
          novalidate>

          <fieldset
            class="assistant-fieldset">

            <legend
              data-assistant-heading
              tabindex="-1">
              ${copy.heading}
            </legend>

            <p class="assistant-hint">
              ${copy.hint}
            </p>

            <div
              class="assistant-check-grid">

              ${conditionOptions}

              <label
                class="
                  assistant-check-option
                  assistant-check-none
                ">

                <input
                  type="checkbox"
                  value="none"
                  data-condition-none
                  ${
                    assistantState.roomConditions &&
                    assistantState
                      .roomConditions
                      .length === 0
                      ? "checked"
                      : ""
                  }>

                <span>
                  ${copy.conditions.none}
                </span>

              </label>

            </div>
          </fieldset>

          <p
            id="assistant-situation-error"
            class="assistant-error"
            role="alert"
            hidden>
          </p>

          <button
            class="assistant-next"
            type="submit">
            ${assistantCopy.next}
          </button>

        </form>
      `
    })
  );

  connectBackControl(assistant);

  const form =
    assistant.querySelector(
      "[data-situation-form]"
    );

  const noneOption =
    assistant.querySelector(
      "[data-condition-none]"
    );

  const conditionInputs = [
    ...assistant.querySelectorAll(
      "[data-room-condition]"
    )
  ];

  const error =
    assistant.querySelector(
      "#assistant-situation-error"
    );

  function syncConditionState() {
    if (noneOption.checked) {
      assistantState.roomConditions = [];
    } else {
      assistantState.roomConditions =
        conditionInputs
          .filter(
            (input) => input.checked
          )
          .map(
            (input) => input.value
          );
    }

    invalidateRecommendation();

    error.hidden = true;
    error.textContent = "";
  }

  conditionInputs.forEach(
    (input) => {
      input.addEventListener(
        "change",
        () => {
          if (input.checked) {
            noneOption.checked = false;
          }

          syncConditionState();
        }
      );
    }
  );

  noneOption.addEventListener(
    "change",
    () => {
      if (noneOption.checked) {
        conditionInputs.forEach(
          (input) => {
            input.checked = false;
          }
        );
      }

      syncConditionState();
    }
  );

  form.addEventListener(
    "submit",
    (event) => {
      event.preventDefault();

      if (
        assistantState.roomConditions ===
        null
      ) {
        error.textContent = copy.error;
        error.hidden = false;
        return;
      }

      showOpeningStage();
    }
  );
}

/* --------------------------------
   OPENING
-------------------------------- */

function showOpeningStage(
  addToHistory = true
) {
  if (addToHistory) {
    pushStage(showOpeningStage);
  }

  const copy =
    assistantCopy.opening;

  const openingButtons =
    openingTypeIds
      .map((openingId) => `
        <button
          class="assistant-opening-option ${
            assistantState.openingType ===
            openingId
              ? "is-selected"
              : ""
          }"
          type="button"
          aria-pressed="${
            assistantState.openingType ===
            openingId
          }"
          data-opening-type="${openingId}">
          <span
            class="assistant-opening-thumbnail"
            data-opening-thumbnail="${openingId}"
            aria-hidden="true">
          </span>

          <span class="assistant-opening-label">
            ${copy.types[openingId]}
          </span>
        </button>
      `)
      .join("");

  const assistant = renderAssistant(
    renderStageShell({
      stage: 4,
      mascotState: "opening",

      content: `
        ${renderBackControl()}

        <form
          data-opening-form
          novalidate>

          <fieldset
            class="assistant-fieldset">

            <legend
              data-assistant-heading
              tabindex="-1">
              ${copy.heading}
            </legend>

            <p class="assistant-hint">
              ${copy.introduction}
            </p>

            <div
              class="assistant-options">
              ${openingButtons}
            </div>

          </fieldset>

          <p
            class="assistant-note"
            data-opening-note
            hidden>
          </p>

          <p
            id="assistant-opening-error"
            class="assistant-error"
            role="alert"
            hidden>
          </p>

          <button
            class="assistant-next"
            type="submit">
            ${assistantCopy.next}
          </button>

        </form>
      `
    })
  );

  connectBackControl(assistant);

  const form =
    assistant.querySelector(
      "[data-opening-form]"
    );

  const note =
    assistant.querySelector(
      "[data-opening-note]"
    );

  const error =
    assistant.querySelector(
      "#assistant-opening-error"
    );

  function updateOpeningNote() {
    const noteText =
      copy.notes[
        assistantState.openingType
      ];

    if (noteText) {
      note.textContent = noteText;
      note.hidden = false;
    } else {
      note.textContent = "";
      note.hidden = true;
    }
  }

  updateOpeningNote();

  assistant
    .querySelectorAll(
      "[data-opening-type]"
    )
    .forEach((button) => {
      button.addEventListener(
        "click",
        () => {
          assistantState.openingType =
            button.dataset.openingType;

          invalidateRecommendation();

          assistant
            .querySelectorAll(
              "[data-opening-type]"
            )
            .forEach((option) => {
              const selected =
                option === button;

              option.classList.toggle(
                "is-selected",
                selected
              );

              option.setAttribute(
                "aria-pressed",
                String(selected)
              );
            });

          error.hidden = true;
          error.textContent = "";

          updateOpeningNote();
        }
      );
    });

  form.addEventListener(
    "submit",
    (event) => {
      event.preventDefault();

      if (
        !assistantState.openingType
      ) {
        error.textContent =
          copy.error;

        error.hidden = false;

        return;
      }

      showDatesStage();
    }
  );
}

function showDatesStage(
  addToHistory = true
) {
  if (addToHistory) {
    pushStage(showDatesStage);
  }

  const copy =
    assistantCopy.dates;

  const assistant = renderAssistant(
    renderStageShell({
      stage: 5,
      mascotState: "dates",

      content: `
        ${renderBackControl()}

        <h2
          data-assistant-heading
          tabindex="-1">
          ${copy.heading}
        </h2>

        <p>${copy.introduction}</p>

        <div
          class="assistant-date-selection"
          data-date-selection>

          <div class="assistant-date-selection-summary">
            <div>
              <span>Livraison</span>
              <strong data-selected-start>
                ${
                  assistantState.startDate
                    ? formatDate(
                        assistantState.startDate
                      )
                    : "À choisir"
                }
              </strong>
            </div>

            <div>
              <span>Reprise</span>
              <strong data-selected-end>
                ${
                  assistantState.endDate
                    ? formatDate(
                        assistantState.endDate
                      )
                    : "À choisir"
                }
              </strong>
            </div>
          </div>

          <div
            data-igloue-calendar>
          </div>

          <p
            id="assistant-dates-error"
            class="assistant-error"
            role="alert"
            hidden>
          </p>

          <button
            class="assistant-next"
            type="button"
            data-dates-continue>
            ${copy.submit}
          </button>

        </div>
      `
    })
  );

  connectBackControl(assistant);

  const calendarContainer =
    assistant.querySelector(
      "[data-igloue-calendar]"
    );

  const startDisplay =
    assistant.querySelector(
      "[data-selected-start]"
    );

  const endDisplay =
    assistant.querySelector(
      "[data-selected-end]"
    );

  const continueButton =
    assistant.querySelector(
      "[data-dates-continue]"
    );

  const error =
    assistant.querySelector(
      "#assistant-dates-error"
    );

  createIgloueCalendar({
    container:
      calendarContainer,

    startDate:
      assistantState.startDate,

    endDate:
      assistantState.endDate,

    onChange: ({
      startDate,
      endDate
    }) => {
      assistantState.startDate =
        startDate;

      assistantState.endDate =
        endDate;

      invalidateRecommendation();

      startDisplay.textContent =
        startDate
          ? formatDate(startDate)
          : "À choisir";

      endDisplay.textContent =
        endDate
          ? formatDate(endDate)
          : "À choisir";

      error.hidden = true;
      error.textContent = "";
    }
  });

  continueButton.addEventListener(
    "click",
    () => {
      if (
        !assistantState.startDate ||
        !assistantState.endDate
      ) {
        error.textContent =
          "Choisissez une date de livraison puis une date de reprise.";

        error.hidden = false;
        return;
      }

      const nights =
        getRentalNightCount(
          assistantState.startDate,
          assistantState.endDate
        );

      if (nights <= 0) {
        error.textContent =
          copy.orderError;

        error.hidden = false;
        return;
      }

      calculateRecommendation();

      if (
        assistantState.availability &&
        !assistantState
          .availability
          .idealAvailable
      ) {
        showUnavailableRecommendation();
      } else {
        showRecommendationResult();
      }
    }
  );
}
function calculateAvailability() {
  const product =
    assistantState.recommendedProduct;

  if (!product) {
    assistantState.availability = null;
    return;
  }

  assistantState.availability =
    getAlternativeAvailability({
      idealProduct: product,

      postcode:
        assistantState.postcode,

      openingType:
        assistantState.openingType,

      startDate:
        assistantState.startDate,

      endDate:
        assistantState.endDate
    });
}

function showUnavailableRecommendation(
  addToHistory = true
) {
  if (addToHistory) {
    pushStage(
      showUnavailableRecommendation
    );
  }

  const copy =
    assistantCopy.result;

  const idealProduct =
    assistantState.recommendedProduct;

  const availability =
    assistantState.availability;

  if (
    !idealProduct ||
    !availability
  ) {
    showDatesStage(false);
    return;
  }

  const alternatives = [];

  if (
    availability.largerAlternative
  ) {
    alternatives.push({
      product:
        availability.largerAlternative,

      type: "larger",

      explanation:
        copy.largerAlternative
    });
  }

  /*
    Only offer the smaller machine when
    the customer's room is reasonably
    close to that machine's intended range.

    We currently allow up to 15% above
    its normal room-size recommendation.
  */
  if (
    availability.smallerAlternative
  ) {
    const smaller =
      availability.smallerAlternative;

    const maximumCompromiseArea =
      smaller.maxRoomSize
        ? smaller.maxRoomSize * 1.15
        : 0;

    if (
      assistantState.roomArea <=
      maximumCompromiseArea
    ) {
      alternatives.push({
        product: smaller,

        type: "smaller",

        explanation:
          copy.smallerAlternative
      });
    }
  }

  const alternativesMarkup =
    alternatives.length
      ? alternatives
          .map(({ product, explanation }) => `
            <div
              class="assistant-alternative">

              <div>
                <span
                  class="assistant-step-label">
                  Alternative
                </span>

                <h3>
                  ${product.name}
                </h3>

                <p>
                  ${explanation}
                </p>

                <strong>
                  ${formatPrice(
                    product.weeklyPrice
                  )}
                  ${copy.perWeek}
                </strong>
              </div>

              <button
                class="assistant-next"
                type="button"
                data-select-alternative="${product.id}">
                ${copy.chooseAlternative}
              </button>

            </div>
          `)
          .join("")
      : `
        <div class="assistant-note">
          <strong>
            ${copy.noAlternativeHeading}
          </strong>

          <br>

          ${copy.noAlternativeText}
        </div>
      `;

  const assistant =
    renderAssistant(
      renderStageShell({
        stage: 5,
        mascotState: "unavailable",
        isResult: true,

        content: `
          ${renderBackControl()}

          <span
            class="assistant-step-label">
            Disponibilité
          </span>

          <h2
            data-assistant-heading
            tabindex="-1">
            ${copy.unavailableHeading}
          </h2>

          <p>
            ${copy.unavailableText(
              idealProduct.name
            )}
          </p>

          <div
            class="
              assistant-recurring-price
              assistant-recurring-compact
            ">

            <span>
              Recommandation idéale
            </span>

            <strong>
              ${idealProduct.name}
            </strong>

          </div>

          <p class="assistant-date-summary">
            ${copy.dateSummary(
              formatDate(
                assistantState.startDate
              ),
              formatDate(
                assistantState.endDate
              )
            )}
          </p>

          ${alternativesMarkup}
        `
      })
    );

  connectBackControl(assistant);

  assistant
    .querySelectorAll(
      "[data-select-alternative]"
    )
    .forEach((button) => {
      button.addEventListener(
        "click",
        () => {
          const product =
            getProductById(
              button.dataset
                .selectAlternative
            );

          if (!product) {
            return;
          }

          assistantState
            .recommendedProduct =
              product;

          /*
            The customer has knowingly
            selected a fallback product.
          */
          assistantState.availability = {
            ...assistantState.availability,
            selectedAsAlternative: true
          };

          determineDefaultSetupMode();

          calculateCurrentPricing();

          showRecommendationResult();
        }
      );
    });
}

/* --------------------------------
   RECOMMENDATION
-------------------------------- */

function findOpeningCompatibleProduct(
  startingProduct
) {
  if (!startingProduct) {
    return null;
  }

  if (
    assistantState.openingType ===
    "unsure"
  ) {
    assistantState.requiresAssessment =
      true;

    return startingProduct;
  }

  const availableProducts =
    getProductsAvailableForPostcode(
      assistantState.postcode
    );

  const startIndex =
    IGLOUE_PRODUCTS.findIndex(
      (product) =>
        product.id ===
        startingProduct.id
    );

  const candidates =
    IGLOUE_PRODUCTS
      .slice(
        Math.max(0, startIndex)
      )
      .filter((product) =>
        availableProducts.some(
          (available) =>
            available.id ===
            product.id
        )
      );

  const compatible =
    candidates.find(
      (product) =>
        productSupportsOpening(
          product,
          assistantState.openingType
        )
    );

  if (compatible) {
    return compatible;
  }

  assistantState.requiresAssessment =
    true;

  return startingProduct;
}

function calculateRecommendation() {
  const hasDifficultConditions =
    assistantState.roomConditions.length > 0;

  const initialProduct =
    findProductByRoomArea(
      assistantState.roomArea,
      hasDifficultConditions,
      assistantState.postcode
    );

  assistantState.recommendedProduct =
    findOpeningCompatibleProduct(
      initialProduct
    );

  assistantState.idealProduct =
    assistantState.recommendedProduct;

  if (
    assistantState.roomArea >=
    60
  ) {
    assistantState.requiresAssessment =
      true;
  }

  calculateAvailability();

if (
  assistantState.availability &&
  !assistantState.availability.idealAvailable
) {
  return;
}

determineDefaultSetupMode();

calculateCurrentPricing();
}

function determineDefaultSetupMode() {
  const product =
    assistantState.recommendedProduct;

  if (!product) {
    assistantState.setupMode = null;
    return;
  }

  const modes =
    getAvailableSetupModes(product);

  assistantState.setupMode =
    modes.includes("none")
      ? "none"
      : modes[0] || null;
}

function getSetupPrice() {
  if (!assistantState.setupMode) {
    return 0;
  }

  const setup =
    IGLOUE_PRICING.setup[
      camelCaseSetupKey(
        assistantState.setupMode
      )
    ];

  return setup ? setup.price : 0;
}

function camelCaseSetupKey(
  setupMode
) {
  const map = {
    none: "none",
    basic: "basic",
    "terrace-split":
      "terraceSplit",
    "window-split":
      "windowSplit",
    "adapted-opening":
      "adaptedOpening",
    special: "special"
  };

  return map[setupMode] || null;
}

function getSetupDefinition(
  setupMode
) {
  const key =
    camelCaseSetupKey(setupMode);

  return key
    ? IGLOUE_PRICING.setup[key]
    : null;
}

function calculateCurrentPricing() {
  const product =
    assistantState.recommendedProduct;

  if (!product) {
    assistantState.pricing = null;
    return;
  }

  assistantState.pricing =
    calculateBookingTotal({
      weeklyPrice:
        product.weeklyPrice,

      startDate:
        assistantState.startDate,

      endDate:
        assistantState.endDate,

      deliveryPrice:
        assistantState.deliveryPrice,

      setupPrice:
        getSetupPrice(),

      cautionAmount:
        product.cautionAmount
    });
}

function getAvailableSetupModes(
  product
) {
  if (!product) {
    return [];
  }

  const opening =
    assistantState.openingType;

  const supported = (modes) =>
    modes.filter((mode) =>
      productSupportsSetupMode(
        product,
        mode
      )
    );

  if (
    product.type ===
    "portable-split"
  ) {
    if (opening === "terrace") {
      return supported(["terrace-split"]);
    }

    if (
      opening === "unsure"
    ) {
      return supported(["special"]);
    }

    if (opening === "velux") {
      return supported([
        "adapted-opening",
        "special"
      ]);
    }

    return supported(["window-split"]);
  }

  if (
    product.id === "max-pro"
  ) {
    if (opening === "terrace") {
      return supported(["terrace-split"]);
    }

    if (opening === "unsure") {
      return supported(["special"]);
    }

    if (opening === "velux") {
      return supported(["adapted-opening"]);
    }

    return supported(["window-split"]);
  }

  if (
    opening === "velux" ||
    opening === "unsure"
  ) {
    return supported([
      "none",
      "adapted-opening"
    ]);
  }

  return supported(["none", "basic"]);
}

function buildSetupOptions(
  product
) {
  const modes =
    getAvailableSetupModes(product);

  return modes
    .map((mode) => {
      const setup =
        getSetupDefinition(mode);

      if (!setup) {
        return "";
      }

      const selected =
        assistantState.setupMode ===
        mode;

      const priceLabel =
        setup.price === 0
          ? "Sans supplément"
          : `+ ${formatPrice(
              setup.price
            )}`;

      return `
        <button
          class="${
            selected
              ? "is-selected"
              : ""
          }"
          type="button"
          aria-pressed="${selected}"
          data-setup-mode="${mode}">

          <span>
            ${setup.label}
          </span>

          <strong>
            ${priceLabel}
          </strong>

        </button>
      `;
    })
    .join("");
}

function getIdealProduct() {
  return (
    assistantState.idealProduct ||
    assistantState.recommendedProduct
  );
}

function getProductSizing(product) {
  const idealProduct =
    getIdealProduct();

  const sizingCopy =
    assistantCopy.result.sizing;

  const productIndex =
    IGLOUE_PRODUCTS.findIndex(
      (candidate) =>
        candidate.id === product.id
    );

  const idealIndex =
    IGLOUE_PRODUCTS.findIndex(
      (candidate) =>
        idealProduct &&
        candidate.id === idealProduct.id
    );

  const difference =
    productIndex - idealIndex;

  if (difference === 0) {
    return {
      ...sizingCopy.best,
      tone: "recommended"
    };
  }

  if (difference === -1) {
    return {
      ...sizingCopy.slightlySmaller,
      tone: "warning"
    };
  }

  if (difference < -1) {
    return {
      ...sizingCopy.tooSmall,
      tone: "danger"
    };
  }

  if (difference === 1) {
    return {
      ...sizingCopy.slightlyLarger,
      tone: "neutral"
    };
  }

  return {
    ...sizingCopy.muchLarger,
    tone: "neutral"
  };
}

function isProductChoiceAvailable(product) {
  return (
    isProductAvailableForPostcode(
      product.id,
      assistantState.postcode
    ) &&
    isProductAvailableForDates(
      product.id,
      assistantState.startDate,
      assistantState.endDate
    )
  );
}

function buildProductChoices() {
  const selectedProduct =
    assistantState.recommendedProduct;

  const idealProduct =
    getIdealProduct();

  return IGLOUE_PRODUCTS
    .map((product) => {
      const selected =
        selectedProduct.id === product.id;

      const recommended =
        idealProduct &&
        idealProduct.id === product.id;

      const available =
        isProductChoiceAvailable(product);

      const status = !available
        ? assistantCopy.result.unavailableShort
        : recommended
          ? assistantCopy.result.recommendedShort
          : getProductSizing(product).label;

      return `
        <article
          class="assistant-model-card${selected ? " is-selected" : ""}${recommended ? " is-recommended" : ""}"
          data-model-card="${product.id}">

          <button
            class="assistant-model-select"
            type="button"
            data-product-choice="${product.id}"
            aria-pressed="${selected}"
            ${available ? "" : "disabled"}>

            <span
              class="assistant-product-image"
              data-product-image="${product.id}"
              aria-hidden="true">
            </span>

            <span class="assistant-model-status">
              ${status}
            </span>

            <strong>${product.name}</strong>

            <span class="assistant-model-price">
              ${formatPrice(product.weeklyPrice)}
              ${assistantCopy.result.perWeek}
            </span>
          </button>

          <button
            class="assistant-info-toggle"
            type="button"
            aria-label="${assistantCopy.result.showInformation} — ${product.name}"
            aria-expanded="false"
            aria-controls="assistant-model-info-${product.id}"
            data-info-label="${product.name}"
            data-info-toggle>
            ?
          </button>

          <div
            id="assistant-model-info-${product.id}"
            class="assistant-info-panel"
            data-info-panel
            hidden>
            <p>${product.tagline}</p>
            <p>${product.suitableFor}</p>
          </div>
        </article>
      `;
    })
    .join("");
}

function updateSelectedProductAssessment(product) {
  const opening =
    assistantState.openingType;

  assistantState.requiresAssessment =
    assistantState.roomArea >= 60 ||
    opening === "unsure" ||
    !productSupportsOpening(
      product,
      opening
    );
}

function selectProductChoice(productId) {
  const product =
    getProductById(productId);

  if (
    !product ||
    !isProductChoiceAvailable(product)
  ) {
    return;
  }

  assistantState.recommendedProduct =
    product;

  assistantState.availability = {
    ...(assistantState.availability || {}),
    selectedAsAlternative:
      product.id !== getIdealProduct().id
  };

  updateSelectedProductAssessment(product);
  determineDefaultSetupMode();
  calculateCurrentPricing();
  showRecommendationResult(false);
}

function connectInfoControls(assistant) {
  assistant
    .querySelectorAll("[data-info-toggle]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        const panel = assistant.querySelector(
          `#${button.getAttribute("aria-controls")}`
        );

        if (!panel) {
          return;
        }

        const expanded =
          button.getAttribute("aria-expanded") === "true";

        button.setAttribute(
          "aria-expanded",
          String(!expanded)
        );

        button.setAttribute(
          "aria-label",
          `${
            expanded
              ? assistantCopy.result.showInformation
              : assistantCopy.result.hideInformation
          }${
            button.dataset.infoLabel
              ? ` — ${button.dataset.infoLabel}`
              : ""
          }`
        );

        panel.hidden = expanded;
      });
    });
}

function buildRecommendationExplanation() {
  const copy =
    assistantCopy.result;

  const roomLabel =
    assistantCopy.room.types[
      assistantState.roomType
    ];

  const conditions =
    assistantState.roomConditions.map(
      (id) =>
        assistantCopy
          .situation
          .conditions[id]
    );

  const baseProduct =
    getBaseProductForRoomArea(
      assistantState.roomArea
    );

  const product =
    assistantState.recommendedProduct;

  const idealProduct =
    getIdealProduct();

  const isIdealSelection =
    idealProduct &&
    idealProduct.id === product.id;

  const parts = [
    (isIdealSelection
      ? copy.recommendation
      : copy.selectedSummary)({
      room: roomLabel,
      area:
        assistantState.roomArea,
      product: product.name
    })
  ];

  if (conditions.length) {
    parts.push(
      copy.conditions(conditions)
    );
  }

  if (!isIdealSelection) {
    return parts.join(" ");
  }

  if (
    baseProduct &&
    product.id !== baseProduct.id
  ) {
    if (
      baseProduct.id ===
        "essential" &&
      !isProductAvailableForPostcode(
        "essential",
        assistantState.postcode
      )
    ) {
      parts.push(
        copy.limitedArea
      );
    } else {
      parts.push(
        copy.upgraded
      );
    }
  }

  return parts.join(" ");
}

function updateResultPricing(
  assistant
) {
  calculateCurrentPricing();

  const pricing =
    assistantState.pricing;

  const setupDefinition =
    getSetupDefinition(
      assistantState.setupMode
    );

  assistant
    .querySelector(
      "[data-price-rental]"
    )
    .textContent =
      formatPrice(
        pricing.rentalPrice
      );

  assistant
    .querySelector(
      "[data-price-delivery]"
    )
    .textContent =
      formatPrice(
        pricing.deliveryPrice
      );

  assistant
    .querySelector(
      "[data-price-setup]"
    )
    .textContent =
      setupDefinition
        ? formatPrice(
            pricing.setupPrice
          )
        : formatPrice(0);

  assistant
    .querySelector(
      "[data-price-total]"
    )
    .textContent =
      formatPrice(pricing.total);

  const stickyTotal =
    assistant.querySelector(
      "[data-sticky-total]"
    );

  if (stickyTotal) {
    stickyTotal.textContent =
      formatPrice(pricing.total);
  }
}

function buildReservationDraft() {
  const product =
    assistantState.recommendedProduct;

  return {
    postcode:
      assistantState.postcode,

    deliveryZone: {
      id:
        assistantState
          .deliveryZone.id,

      name:
        assistantState
          .deliveryZone.name
    },

    room: {
      type:
        assistantState.roomType,

      area:
        assistantState.roomArea,

      conditions: [
        ...assistantState
          .roomConditions
      ]
    },

    openingType:
      assistantState.openingType,

    rentalDates: {
      startDate:
        assistantState.startDate,

      endDate:
        assistantState.endDate
    },

    product: {
      id: product.id,
      name: product.name
    },

    setupMode:
      assistantState.setupMode,

    requiresAssessment:
      assistantState
        .requiresAssessment,

    pricing: {
      ...assistantState.pricing
    }
  };
}

function showRecommendationResult(
  addToHistory = true
) {
  if (addToHistory) {
    pushStage(
      showRecommendationResult
    );
  }

  if (
    !assistantState.recommendedProduct ||
    !assistantState.pricing
  ) {
    calculateRecommendation();
  }

  const copy =
    assistantCopy.result;

  const product =
    assistantState.recommendedProduct;

  const pricing =
    assistantState.pricing;

  const setupOptions =
    buildSetupOptions(product);

  const productChoices =
    buildProductChoices();

  const sizing =
    getProductSizing(product);

  const installationMessage =
    product.installationRequired
      ? copy.setupRequired
      : copy.setupOptional;

  const minimumNotice =
    pricing.actualNights <
    IGLOUE_PRICING.minimumRentalNights
      ? `
        <p class="assistant-note">
          ${copy.minimumNights}
        </p>
      `
      : "";

  const assessmentNotice =
    assistantState.requiresAssessment
      ? `
        <div class="assistant-note">
          <strong>
            ${copy.assessmentHeading}
          </strong>
          <br>
          ${copy.assessmentText}
        </div>
      `
      : "";

  const assistant = renderAssistant(
    renderStageShell({
      stage: 5,
      mascotState: "recommendation",
      isResult: true,

      content: `
        ${renderBackControl()}

        <div class="assistant-result-layout">
          <section
            class="assistant-product-choice"
            aria-labelledby="assistant-selected-product">

            <article
              class="assistant-featured-product is-${sizing.tone}"
              aria-live="polite">

              <span
                class="assistant-product-image"
                data-product-image="${product.id}"
                aria-hidden="true">
              </span>

              <span class="assistant-step-label">
                ${sizing.label}
              </span>

              <h2
                id="assistant-selected-product"
                data-assistant-heading
                tabindex="-1">
                ${product.name}
              </h2>

              <p class="assistant-sizing-message">
                ${sizing.text}
              </p>

              <p class="assistant-product-tagline">
                ${product.tagline}
              </p>

              <strong class="assistant-featured-price">
                ${formatPrice(product.weeklyPrice)}
                ${copy.perWeek}
              </strong>
            </article>

            <div class="assistant-selection-details">
              <div class="assistant-info-heading">
                <span>${copy.selectionDetails}</span>

                <button
                  class="assistant-info-toggle"
                  type="button"
                  aria-label="${copy.showInformation}"
                  aria-expanded="false"
                  aria-controls="assistant-selection-info"
                  data-info-toggle>
                  ?
                </button>
              </div>

              <div
                id="assistant-selection-info"
                class="assistant-info-panel"
                data-info-panel
                hidden>
                <p class="assistant-recommendation-copy">
                  ${buildRecommendationExplanation()}
                </p>
              </div>
            </div>

            <div class="assistant-model-selector">
              <div class="assistant-model-selector-heading">
                <strong>${copy.modelChoiceHeading}</strong>
                <span>${copy.modelChoiceHint}</span>
              </div>

              <div
                class="assistant-model-list"
                role="group"
                aria-label="${copy.modelChoiceHeading}">
                ${productChoices}
              </div>
            </div>
          </section>

          <section
            class="assistant-booking-summary"
            aria-label="Récapitulatif du prix">

            <p class="assistant-date-summary">
              ${copy.dateSummary(
                formatDate(assistantState.startDate),
                formatDate(assistantState.endDate)
              )}
            </p>

            <div class="assistant-result-action-bar">
              <div>
                <strong data-sticky-total>
                  ${formatPrice(pricing.total)}
                </strong>
                <span>à payer</span>
                <small>
                  ${copy.cautionLabel}
                  ${formatPrice(pricing.caution.amount)}
                </small>
              </div>

              <button
                class="assistant-next assistant-booking-action"
                type="button"
                data-reservation-request>
                ${copy.request}
              </button>
            </div>

            <p class="assistant-note assistant-nights-note">
              ${copy.nights(pricing.actualNights)}
            </p>

            ${minimumNotice}

            <p class="assistant-hint">
              ${installationMessage}
            </p>

            <div
              class="assistant-options assistant-setup-options"
              data-setup-options>
              ${setupOptions}
            </div>

            ${assessmentNotice}

            <div class="assistant-result-grid">

              <div>
                <span>${copy.rental}</span>
                <strong data-price-rental>
                  ${formatPrice(pricing.rentalPrice)}
                </strong>
              </div>

              <div>
                <span>${copy.delivery}</span>
                <strong data-price-delivery>
                  ${formatPrice(pricing.deliveryPrice)}
                </strong>
              </div>

              <div>
                <span>${copy.setup}</span>
                <strong data-price-setup>
                  ${formatPrice(pricing.setupPrice)}
                </strong>
              </div>

              <div class="assistant-total">
                <span>${copy.total}</span>
                <strong data-price-total>
                  ${formatPrice(pricing.total)}
                </strong>
              </div>
            </div>

            <div
              class="assistant-caution"
              aria-label="${copy.cautionHeading}">
              <span>${copy.cautionLabel}</span>
              <strong>
                ${formatPrice(pricing.caution.amount)}
              </strong>
              <small>
                ${copy.cautionNotCharged(
                  formatPrice(pricing.caution.amount)
                )}
              </small>
            </div>

            <p class="assistant-caution-explanation">
              ${copy.cautionExplanation}
            </p>

            <p
              class="assistant-reservation-status"
              role="status"
              tabindex="-1"
              data-reservation-status
              hidden>
            </p>
          </section>
        </div>
      `
    })
  );

  connectBackControl(assistant);
  connectInfoControls(assistant);

  assistant
    .querySelectorAll("[data-product-choice]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        selectProductChoice(
          button.dataset.productChoice
        );
      });
    });

  assistant
    .querySelectorAll(
      "[data-setup-mode]"
    )
    .forEach((button) => {
      button.addEventListener(
        "click",
        () => {
          assistantState.setupMode =
            button.dataset.setupMode;

          assistant
            .querySelectorAll(
              "[data-setup-mode]"
            )
            .forEach((option) => {
              const selected =
                option === button;

              option.classList.toggle(
                "is-selected",
                selected
              );

              option.setAttribute(
                "aria-pressed",
                String(selected)
              );
            });

          updateResultPricing(
            assistant
          );
        }
      );
    });

  assistant
    .querySelector(
      "[data-reservation-request]"
    )
    .addEventListener(
      "click",
      () => {
        const status =
          assistant.querySelector(
            "[data-reservation-status]"
          );

        assistant.dispatchEvent(
          new CustomEvent(
            "igloue:reservation-requested",
            {
              bubbles: true,
              detail:
                buildReservationDraft()
            }
          )
        );

        status.textContent =
          copy.reservationStatus;

        status.hidden = false;

        status.focus({
          preventScroll: true
        });
      }
    );
}

document.addEventListener(
  "DOMContentLoaded",
  showDeliveryStage
);
