function getReservationSlotLabel(slotId) {
  const slot = IGLOUE_SERVICE_WINDOWS.find(
    (candidate) => candidate.id === slotId
  );

  return slot ? slot.displayLabel : "Créneau à choisir";
}

function formatReservationReviewDate(dateValue) {
  if (!dateValue) {
    return "Date à choisir";
  }

  return new Intl.DateTimeFormat(assistantLocale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(new Date(`${dateValue}T12:00:00`));
}

function getReservationReviewSizing(draft) {
  const selectedIndex = IGLOUE_PRODUCTS.findIndex(
    (product) => product.id === draft.product.selectedProductId
  );
  const recommendedIndex = IGLOUE_PRODUCTS.findIndex(
    (product) => product.id === draft.product.recommendedProductId
  );
  const difference = selectedIndex - recommendedIndex;
  const sizing = assistantCopy.result.sizing;

  if (difference === 0) return sizing.best;
  if (difference === -1) return sizing.slightlySmaller;
  if (difference < -1) return sizing.tooSmall;
  if (difference === 1) return sizing.slightlyLarger;
  return sizing.muchLarger;
}

function getReservationReviewRoomLabel(roomType) {
  return assistantCopy.room.types[roomType] || "pièce";
}

function getReservationReviewOpeningLabel(openingType) {
  const openingCopy = assistantCopy.opening.types[openingType];

  if (!openingCopy) {
    return "Ouverture à préciser";
  }

  return typeof openingCopy === "string"
    ? openingCopy
    : openingCopy.primary;
}

function escapeReservationReviewHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function validateReservationOperationalData(draft) {
  const issues = [];
  const product = getProductById(draft.product.selectedProductId);
  const realAvailabilityKey = [
    draft.product.selectedProductId,
    draft.rental.deliveryDate,
    draft.rental.collectionDate,
    draft.delivery.slotId,
    draft.collection.slotId
  ].map((value) => String(value || "")).join("|");
  const realAvailability = assistantState.availability;

  if (
    !product ||
    !realAvailability ||
    realAvailability.status !== "available" ||
    realAvailability.key !== realAvailabilityKey
  ) {
    issues.push({
      code: "availability-not-confirmed",
      section: "product",
      message:
        "La disponibilité doit être vérifiée avant de poursuivre."
    });
  }

  const slotProvider = globalThis.IGLOUE_DELIVERY_SLOT_PROVIDER;

  if (
    slotProvider &&
    typeof slotProvider.getAvailableSlots === "function"
  ) {
    const requestBase = {
      postcode: draft.location.postcode,
      zone: draft.location.zone,
      productId: draft.product.selectedProductId,
      bookingContext: draft
    };
    const availableDeliverySlots = slotProvider.getAvailableSlots({
      ...requestBase,
      date: draft.delivery.date,
      serviceType: "delivery"
    });
    const availableCollectionSlots = slotProvider.getAvailableSlots({
      ...requestBase,
      date: draft.collection.date,
      serviceType: "collection"
    });

    if (
      draft.delivery.slotId &&
      !availableDeliverySlots.some((slot) => slot.id === draft.delivery.slotId)
    ) {
      issues.push({
        code: "delivery-slot-unavailable",
        section: "dates",
        endpoint: "delivery",
        message:
          "Ce créneau de livraison n'est plus disponible. Choisissez-en un autre."
      });
    }

    if (
      draft.collection.slotId &&
      !availableCollectionSlots.some((slot) => slot.id === draft.collection.slotId)
    ) {
      issues.push({
        code: "collection-slot-unavailable",
        section: "dates",
        endpoint: "collection",
        message:
          "Ce créneau de reprise n'est plus disponible. Choisissez-en un autre."
      });
    }
  }

  return {
    valid: issues.length === 0,
    issues
  };
}

function routeReservationReviewIssue(issue) {
  if (issue.section === "customer") {
    showCustomerDetailsStage(false);
    return;
  }

  if (issue.section === "delivery") {
    showDeliveryStage(false);
    return;
  }

  if (issue.section === "opening") {
    showOpeningStage(false);
    return;
  }

  if (issue.section === "product") {
    calculateAvailability({ forceAvailability: true }).then((availability) => {
      if (availability.status === "available") {
        showRecommendationResult(false);
      } else if (availability.status === "unavailable") {
        showUnavailableRecommendation(false);
      } else {
        assistantState.serviceSlotNotice = issue.message;
        showDatesStage(false);
      }
    });
    return;
  }

  assistantState.serviceSlotNotice = issue.message;
  showDatesStage(false);
}

function prepareReservationReview() {
  let draft = buildReservationDraft();
  const completeness = validateNormalizedReservationDraft(
    draft,
    IGLOUE_PRICING.minimumRentalNights
  );

  if (!completeness.valid) {
    routeReservationReviewIssue(completeness.issues[0]);
    return null;
  }

  const operationalValidation =
    validateReservationOperationalData(draft);

  if (!operationalValidation.valid) {
    const issue = operationalValidation.issues[0];

    if (issue.endpoint === "delivery") {
      assistantState.deliverySlotId = "";
    }

    if (issue.endpoint === "collection") {
      assistantState.collectionSlotId = "";
    }

    routeReservationReviewIssue(issue);
    return null;
  }

  let notice = "";
  const expressEligibility = getSameDayExpressEligibility({
    selectedDeliveryDate: draft.delivery.date,
    postcode: draft.location.postcode
  });

  if (draft.delivery.expressSelected && !expressEligibility.eligible) {
    assistantState.sameDayExpressSelected = false;
    calculateCurrentPricing();
    draft = buildReservationDraft();
    notice =
      "La livraison Express n'est plus disponible. Le tarif a été mis à jour.";
  }

  return {
    draft,
    notice,
    validation: {
      completeness,
      operational: operationalValidation,
      authoritative: false
    }
  };
}

function buildReservationRequestPayload(draft) {
  return {
    customer: {
      firstName: draft.customer.firstName,
      lastName: draft.customer.lastName,
      email: draft.customer.email,
      phone: draft.customer.phone
    },
    productId: draft.product.selectedProductId,
    deliveryAddress: {
      line1: draft.deliveryAddress.line1,
      line2: draft.deliveryAddress.line2,
      postcode: draft.deliveryAddress.postcode,
      city: draft.deliveryAddress.city
    },
    rental: {
      startDate: draft.rental.deliveryDate,
      endDate: draft.rental.collectionDate
    },
    service: {
      deliverySlotId: draft.delivery.slotId,
      collectionSlotId: draft.collection.slotId,
      setupMode: draft.delivery.setupMode,
      expressSelected: draft.delivery.expressSelected
    }
  };
}

function getReservationSubmissionMessage(result) {
  const messages = {
    NO_MACHINE_AVAILABLE:
      "Ce modèle n'est plus disponible pour ces dates. Modifiez vos dates ou choisissez une autre solution.",
    RESERVATION_EXPIRED:
      "Cette disponibilité a expiré. Vérifiez à nouveau vos dates avant de continuer.",
    IDEMPOTENCY_CONFLICT:
      "Cette tentative a changé. Vérifiez vos informations avant de réessayer.",
    INVALID_REQUEST:
      "Certains détails ne sont plus valides. Vérifiez votre réservation avant de réessayer.",
    INVALID_CUSTOMER:
      "Vérifiez vos coordonnées avant de réessayer.",
    INVALID_ADDRESS:
      "Vérifiez votre adresse de livraison avant de réessayer.",
    INVALID_DATES:
      "Vérifiez vos dates de location avant de réessayer.",
    INVALID_SERVICE_WINDOW:
      "Vérifiez vos créneaux de livraison et de reprise avant de réessayer.",
    INVALID_SETUP:
      "Vérifiez votre choix d'installation avant de réessayer.",
    TOO_MANY_ACTIVE_HOLDS:
      "Une demande similaire est déjà en cours. Réessayez dans quelques instants.",
    INTERNAL_ERROR:
      "La finalisation est momentanément indisponible. Vous pouvez réessayer."
  };

  return messages[result && result.code] || messages.INTERNAL_ERROR;
}

function buildReservationReviewPriceRows(draft) {
  const pricing = draft.pricing;
  const rows = [
    {
      label: `Location — ${draft.rental.nights} nuit${draft.rental.nights > 1 ? "s" : ""}`,
      value: pricing.rentalPrice
    },
    {
      label: "Livraison + reprise",
      value: pricing.deliveryPrice
    }
  ];

  if (pricing.setupPrice > 0) {
    rows.push({
      label: "Installation",
      value: pricing.setupPrice
    });
  }

  if (
    draft.delivery.expressSelected &&
    pricing.sameDayExpressPrice > 0
  ) {
    rows.push({
      label: "Livraison Express aujourd'hui",
      value: pricing.sameDayExpressPrice
    });
  }

  return rows.map((row) => `
    <div class="reservation-review-price-row">
      <span>${row.label}</span>
      <strong>${formatPrice(row.value)}</strong>
    </div>
  `).join("");
}

function showReservationReview(addToHistory = true) {
  const preparedReview = prepareReservationReview();

  if (!preparedReview) {
    return;
  }

  if (addToHistory) {
    pushStage(showReservationReview);
  }

  const { draft, notice } = preparedReview;
  const product = getProductById(draft.product.selectedProductId);
  const sizing = getReservationReviewSizing(draft);
  const selectedIsRecommended =
    draft.product.selectedProductId === draft.product.recommendedProductId;
  const manualReview = draft.bookingMode === "manual-review";
  const setup = getSetupDefinition(draft.delivery.setupMode);
  const roomLabel = getReservationReviewRoomLabel(
    draft.requirements.room.type
  );
  const openingLabel = getReservationReviewOpeningLabel(
    draft.requirements.opening.type
  );
  const nextSteps = manualReview
    ? [
        "Nous vérifions votre installation.",
        "Nous confirmons la solution adaptée.",
        "Vous finalisez ensuite votre réservation."
      ]
    : [
        "Nous vérifions une dernière fois la disponibilité.",
        "Vous finalisez votre réservation en toute sécurité.",
        "IGLOUE livre et prépare votre climatiseur."
    ];

  const customer = draft.customer;
  const deliveryAddress = draft.deliveryAddress;
  const customerName = `${escapeReservationReviewHtml(customer.firstName)} ${escapeReservationReviewHtml(customer.lastName)}`;
  const customerPhone = customer.phone
    ? `<div><span>Téléphone</span><strong>${escapeReservationReviewHtml(customer.phone)}</strong></div>`
    : "";
  const addressLine2 = deliveryAddress.line2
    ? `<br>${escapeReservationReviewHtml(deliveryAddress.line2)}`
    : "";

  const assistant = renderAssistant(
    renderStageShell({
      stage: 5,
      mascotState: "recommendation",
      isResult: true,
      content: `
        ${renderBackControl()}

        <header class="reservation-review-header">
          <span class="assistant-step-label">Votre réservation</span>
          <h2 data-assistant-heading tabindex="-1">
            ${manualReview ? "Votre demande est prête." : "Votre location en un coup d'œil."}
          </h2>
          <p>
            ${manualReview
              ? "Nous vérifierons les points techniques avant toute confirmation."
              : "Vérifiez les derniers détails avant de poursuivre."}
          </p>
        </header>

        <div class="reservation-review-layout">
          <div class="reservation-review-details">
            <section class="reservation-review-section reservation-review-solution">
              <div class="reservation-review-section-heading">
                <span>Solution sélectionnée</span>
                <button type="button" data-review-edit="product">Modifier</button>
              </div>
              ${selectedIsRecommended
                ? '<small class="reservation-review-recommended">Recommandé par IGLOUE</small>'
                : `<small class="reservation-review-sizing">${sizing.label}</small>`}
              <h3>${product.name}</h3>
              <strong class="reservation-review-weekly-price">
                ${formatPrice(product.weeklyPrice)} / semaine
              </strong>
              <p>
                ${selectedIsRecommended
                  ? `Adapté à votre ${roomLabel.toLowerCase()} d'environ ${draft.requirements.room.area} m²${draft.requirements.room.conditions.length ? " et à ses contraintes thermiques" : ""}.`
                  : sizing.text}
              </p>
              <div class="reservation-review-minor-action">
                <span>${roomLabel} · ${draft.requirements.room.area} m²</span>
                <button type="button" data-review-edit="room">Modifier la pièce</button>
              </div>
            </section>

            <section class="reservation-review-section">
              <div class="reservation-review-section-heading">
                <span>Période et services</span>
                <button type="button" data-review-edit="dates">Modifier les dates</button>
              </div>
              <div class="reservation-review-service-grid">
                <div>
                  <span>Livraison</span>
                  <strong>${formatReservationReviewDate(draft.delivery.date)}</strong>
                  <b>${getReservationSlotLabel(draft.delivery.slotId)}</b>
                  <button type="button" data-review-edit="delivery-slot">Modifier</button>
                </div>
                <div>
                  <span>Reprise</span>
                  <strong>${formatReservationReviewDate(draft.collection.date)}</strong>
                  <b>${getReservationSlotLabel(draft.collection.slotId)}</b>
                  <button type="button" data-review-edit="collection-slot">Modifier</button>
                </div>
              </div>
              <p class="reservation-review-duration">
                ${draft.rental.nights} nuit${draft.rental.nights > 1 ? "s" : ""} · tarif calculé au prorata
              </p>
            </section>

            <section class="reservation-review-section">
              <div class="reservation-review-section-heading">
                <span>Installation</span>
                <button type="button" data-review-edit="opening">Modifier</button>
              </div>
              <strong>${setup ? setup.label : "À préciser"}</strong>
              <p>${openingLabel}</p>
            </section>

            <section class="reservation-review-section reservation-review-customer">
              <div class="reservation-review-section-heading">
                <span>Vos coordonnées</span>
                <button type="button" data-review-edit="customer">Modifier</button>
              </div>
              <div class="reservation-review-customer-grid">
                <div>
                  <span>Client</span>
                  <strong>${customerName}</strong>
                  <b>${escapeReservationReviewHtml(customer.email)}</b>
                  ${customerPhone}
                </div>
                <div>
                  <span>Adresse de livraison</span>
                  <strong>${escapeReservationReviewHtml(deliveryAddress.line1)}${addressLine2}</strong>
                  <b>${escapeReservationReviewHtml(deliveryAddress.postcode)} · ${escapeReservationReviewHtml(deliveryAddress.city)}</b>
                </div>
              </div>
            </section>

            ${manualReview
              ? `
                <aside class="reservation-review-assessment" role="note">
                  <strong>Installation à vérifier</strong>
                  <span>Nous vérifierons votre configuration avant de confirmer l'installation.</span>
                </aside>
              `
              : ""}
          </div>

          <aside class="reservation-review-summary" aria-label="Prix et prochaine étape">
            <h3>Votre tarif</h3>
            <div class="reservation-review-prices">
              ${buildReservationReviewPriceRows(draft)}
              <div class="reservation-review-total">
                <span>Total</span>
                <strong>${formatPrice(draft.pricing.total)} TTC</strong>
              </div>
            </div>

            <div class="reservation-review-caution">
              <span>Caution séparée</span>
              <strong>${formatPrice(draft.pricing.caution.amount)}</strong>
            </div>

            <section class="reservation-review-next">
              <h3>La suite</h3>
              <ol>
                ${nextSteps.map((step) => `<li>${step}</li>`).join("")}
              </ol>
            </section>

            <p
              class="reservation-review-notice"
              role="status"
              aria-live="polite"
              data-review-notice
              ${notice ? "" : "hidden"}>
              ${notice}
            </p>

            <button
              class="assistant-next reservation-review-submit"
              type="button"
              data-review-submit>
              ${manualReview ? "Envoyer ma demande" : "Continuer la réservation"}
            </button>

            <p
              class="assistant-reservation-status"
              role="status"
              tabindex="-1"
              data-reservation-status
              hidden>
            </p>
          </aside>
        </div>
      `
    })
  );

  connectBackControl(assistant);

  assistant.querySelectorAll("[data-review-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.dataset.reviewEdit;

      if (target === "product") {
        showRecommendationResult(false);
      } else if (target === "room") {
        showRoomStage(false);
      } else if (target === "opening") {
        showOpeningStage(false);
      } else if (target === "customer") {
        showCustomerDetailsStage(false);
      } else {
        showDatesStage(false);
      }
    });
  });

  const submitButton = assistant.querySelector("[data-review-submit]");
  const status = assistant.querySelector("[data-reservation-status]");
  let submissionPending = false;
  let submissionCompleted = false;

  submitButton.addEventListener("click", async () => {
    if (submissionPending || submissionCompleted) {
      return;
    }

    const latestReview = prepareReservationReview();

    if (!latestReview) {
      return;
    }

    const requestPayload = buildReservationRequestPayload(latestReview.draft);
    const attempt = globalThis.IGLOUE_RESERVATION_ATTEMPT;
    const client = globalThis.IGLOUE_RESERVATION_CLIENT;
    const idempotencyKey = attempt &&
      typeof attempt.prepareAttempt === "function"
      ? attempt.prepareAttempt(requestPayload)
      : null;

    if (!idempotencyKey || !client || typeof client.createReservation !== "function") {
      status.textContent = "La finalisation est momentanément indisponible. Vous pouvez réessayer.";
      status.hidden = false;
      status.focus({ preventScroll: true });
      return;
    }

    submissionPending = true;
    submitButton.disabled = true;
    submitButton.setAttribute("aria-busy", "true");
    submitButton.textContent = "Enregistrement en cours…";
    status.textContent = "Nous enregistrons votre demande en vérifiant la disponibilité…";
    status.hidden = false;

    if (typeof assistant.dispatchEvent === "function" &&
        typeof CustomEvent === "function") {
      assistant.dispatchEvent(
        new CustomEvent("igloue:reservation-requested", {
          bubbles: true,
          detail: latestReview.draft
        })
      );
    }

    let result;
    try {
      result = await client.createReservation({
        ...requestPayload,
        idempotencyKey
      });
    } catch {
      result = { status: "error", code: "INTERNAL_ERROR" };
    }

    submissionPending = false;
    submitButton.removeAttribute("aria-busy");

    if (result && result.status === "success") {
      submissionCompleted = true;
      submitButton.disabled = true;
      submitButton.textContent = "Demande enregistrée";
      status.textContent = result.reservation &&
        result.reservation.status === "pending"
        ? "Votre demande est enregistrée et la disponibilité est tenue temporairement. Aucun paiement n'a été effectué."
        : "Votre demande est enregistrée. Aucun paiement n'a été effectué.";
    } else {
      submitButton.disabled = false;
      submitButton.textContent = manualReview
        ? "Envoyer ma demande"
        : "Continuer la réservation";
      status.textContent = getReservationSubmissionMessage(result);
    }

    status.hidden = false;
    status.focus({ preventScroll: true });
  });
}
