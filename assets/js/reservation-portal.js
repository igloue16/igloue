(function (global) {
  "use strict";
  const TOKEN = /^p1\.[0-9a-f]{64}$/;
  const STATUS = Object.freeze({ pending: "En attente", confirmed: "Confirmée", ongoing: "En cours", completed: "Terminée", cancelled: "Annulée" });
  const PAYMENT = Object.freeze({ not_started: "En attente", processing: "En cours", paid: "Payé", failed: "Échec", requires_review: "Vérification en cours", refunded: "Remboursé" });
  const SERVICE = Object.freeze({ scheduled: "Planifiée", assigned: "En préparation", en_route: "En route", arrived: "Arrivé", handover_in_progress: "Remise en cours", completed: "Terminée", failed: "À reprogrammer", cancelled: "Annulée", in_progress: "En cours" });
  function validService(value) {
    return value === null || !!value && typeof value === "object" && /^\d{4}-\d{2}-\d{2}$/.test(value.date) &&
      (value.time_slot === null || typeof value.time_slot === "string" && value.time_slot.length <= 100) &&
      (value.status === null || Object.hasOwn(SERVICE, value.status)) &&
      (value.address === null || typeof value.address === "string" && value.address.length <= 240);
  }
  const id = (value) => global.document?.getElementById(value) ?? null;
  function tokenFromFragment(hash) { return new URLSearchParams(String(hash || "").replace(/^#/, "")).get("token") || ""; }
  function validPayload(data) {
    const expectedPaid = !!data && data.payment_status === "paid" &&
      ["confirmed", "ongoing", "completed"].includes(data.reservation_status);
    return !!data && data.ok === true && /^[A-F0-9]{8}$/.test(data.reference) &&
      Object.hasOwn(STATUS, data.reservation_status) && Object.hasOwn(PAYMENT, data.payment_status) &&
      typeof data.paid_and_confirmed === "boolean" && data.paid_and_confirmed === expectedPaid && typeof data.product_name === "string" &&
      typeof data.email_verified === "boolean" && data.price && data.price.currency === "EUR" &&
      validService(data.delivery) && validService(data.collection) &&
      [data.price.total, data.price.delivery, data.price.options, data.price.deposit].every((n) => Number.isFinite(n) && n >= 0) &&
      !Number.isNaN(Date.parse(data.rental_start)) && !Number.isNaN(Date.parse(data.rental_end));
  }
  function setText(target, value) { const node = id(target); if (node) node.textContent = value; }
  function formatDate(value) { return new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "Europe/Paris" }).format(new Date(value)); }
  function formatAmount(value) { return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(value); }
  function renderService(prefix, value) {
    if (!value) { setText(`portal-${prefix}`, "Aucune information disponible pour le moment."); setText(`portal-${prefix}-status`, ""); return; }
    setText(`portal-${prefix}`, `${formatDate(`${value.date}T12:00:00Z`)}${value.time_slot ? ` · ${value.time_slot}` : ""}${value.address ? `\n${value.address}` : ""}`);
    setText(`portal-${prefix}-status`, SERVICE[value.status] ? `Statut : ${SERVICE[value.status]}` : "");
  }
  function render(data) {
    const status = id("portal-status");
    status.replaceChildren();
    const badge = (text, soft) => { const node = global.document.createElement("span"); node.className = `badge${soft ? " badge--soft" : ""}`; node.textContent = text; status.append(node); };
    if (data.paid_and_confirmed) { badge("Paiement confirmé · Payé", false); badge(`Réservation ${STATUS[data.reservation_status]}`, false); }
    else {
      const paymentLabel = data.payment_status === "paid" ? "Paiement en cours de vérification" : `Paiement : ${PAYMENT[data.payment_status]}`;
      badge(paymentLabel, true); badge(`Réservation : ${STATUS[data.reservation_status]}`, true);
    }
    setText("portal-product", data.product_name);
    setText("portal-dates", `Du ${formatDate(data.rental_start)} au ${formatDate(data.rental_end)}`);
    setText("portal-reference", data.reference);
    setText("portal-delivery-price", formatAmount(data.price.delivery));
    setText("portal-options-price", formatAmount(data.price.options));
    setText("portal-deposit", formatAmount(data.price.deposit));
    setText("portal-total", formatAmount(data.price.total));
    renderService("delivery", data.delivery);
    renderService("collection", data.collection);
    setText("portal-email-state", data.email_verified ? "Adresse e-mail vérifiée." : "Adresse e-mail non vérifiée.");
    id("portal-content").hidden = false;
  }
  function showError(title, detail) {
    const node = id("portal-message");
    node.dataset.kind = "error";
    node.replaceChildren();
    const heading = global.document.createElement("strong"); heading.textContent = title;
    const text = global.document.createElement("div"); text.textContent = detail;
    node.append(heading, text);
  }
  async function loadPortal(token, config, fetchImpl = global.fetch) {
    if (!TOKEN.test(token) || !config || typeof config.projectUrl !== "string" || typeof config.publishableKey !== "string") throw new Error("invalid access");
    const response = await fetchImpl(`${config.projectUrl.replace(/\/$/, "")}/functions/v1/customer-reservation-portal`, {
      method: "POST", cache: "no-store", referrerPolicy: "no-referrer",
      headers: { apikey: config.publishableKey, "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const data = await response.json();
    if (!response.ok || !validPayload(data)) throw new Error("invalid access");
    return data;
  }
  const EXTENSION_STATES = new Set(["held", "checkout_created", "paid", "confirmed", "expired", "cancelled", "failed", "review_required"]);
  function validExtensionStatus(value) {
    return !!value && value.ok === true && value.extension &&
      /^[0-9a-f-]{36}$/i.test(value.extension.id) && EXTENSION_STATES.has(value.extension.status) &&
      DATE(value.extension.previousEndDate) && DATE(value.extension.newEndDate) &&
      Number.isInteger(value.extension.addedDays) && value.extension.addedDays > 0 &&
      Number.isFinite(value.extension.additionalAmount) && value.extension.additionalAmount > 0 &&
      value.extension.currency === "EUR" &&
      (value.extension.checkoutUrl === null || typeof value.extension.checkoutUrl === "string" && value.extension.checkoutUrl.startsWith("https://"));
  }
  function DATE(value) { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`)); }
  async function extensionRequest(token, action, payload = {}, config, fetchImpl = global.fetch) {
    if (!TOKEN.test(token) || !config || typeof config.projectUrl !== "string" || typeof config.publishableKey !== "string") throw new Error("invalid access");
    const response = await fetchImpl(`${config.projectUrl.replace(/\/$/, "")}/functions/v1/customer-rental-extension`, {
      method: "POST", cache: "no-store", referrerPolicy: "no-referrer",
      headers: { apikey: config.publishableKey, "content-type": "application/json" },
      body: JSON.stringify({ action, token, ...payload }),
    });
    const result = await response.json();
    if (!response.ok || !result || result.ok !== true) throw new Error(result?.error?.code || "extension unavailable");
    if (action === "status" || action === "cancel") {
      if (!validExtensionStatus(result)) throw new Error("invalid extension status");
    }
    return result;
  }
  async function extensionWindows(token, newEndDate, config, fetchImpl = global.fetch) {
    const result = await extensionRequest(token, "windows", { newEndDate }, config, fetchImpl);
    if (!Array.isArray(result.windows)) throw new Error("invalid service windows");
    return result.windows;
  }
  const DATE_CHANGE_STATES = new Set(["confirmed", "review_required", "failed", "unchanged", "delegated_to_extension", "held", "checkout_created", "payment_failed", "payment_cancelled", "expired", "paid"]);
  function validDateChangeQuote(value) {
    return !!value && value.ok === true && value.quote && typeof value.quote.eligible === "boolean" &&
      (!value.quote.eligible || DATE(value.quote.oldStartDate) && DATE(value.quote.oldEndDate) &&
        DATE(value.quote.newStartDate) && DATE(value.quote.newEndDate) &&
        [value.quote.currentPaidAmount, value.quote.currentRentalAmount, value.quote.newRentalAmount,
          value.quote.priceDelta, value.quote.additionalAmountDue, value.quote.refundOrCreditAmount].every(Number.isFinite) &&
        value.quote.currency === "EUR" && ["automatic", "extension", "review_required", "payment_required", "no_change"].includes(value.quote.mode));
  }
  function validDateChangeResult(value) {
    return !!value && value.ok === true && value.change && DATE_CHANGE_STATES.has(value.change.status) &&
      (value.change.status === "delegated_to_extension" || value.change.status === "unchanged" ||
        /^[0-9a-f-]{36}$/i.test(value.change.id));
  }
  async function dateChangeRequest(token, action, payload = {}, config, fetchImpl = global.fetch) {
    if (!TOKEN.test(token) || !config || typeof config.projectUrl !== "string" || typeof config.publishableKey !== "string") throw new Error("invalid access");
    const response = await fetchImpl(`${config.projectUrl.replace(/\/$/, "")}/functions/v1/customer-rental-date-change`, {
      method: "POST", cache: "no-store", referrerPolicy: "no-referrer",
      headers: { apikey: config.publishableKey, "content-type": "application/json" },
      body: JSON.stringify({ action, token, ...payload }),
    });
    const result = await response.json();
    if (!response.ok || !result || result.ok !== true) throw new Error(result?.error?.code || "date change unavailable");
    if (action === "quote" && !validDateChangeQuote(result)) throw new Error("invalid date change quote");
    if (action === "windows" && (!Array.isArray(result.windows) || result.windows.some((w) => !w || typeof w.code !== "string" ||
      typeof w.label !== "string" || typeof w.startTime !== "string" || typeof w.endTime !== "string"))) throw new Error("invalid service windows");
    if (action === "nearest" && (!result.alternatives || !["earlier", "later"].every((key) => result.alternatives[key] === null || result.alternatives[key] && DATE(result.alternatives[key].date) && Array.isArray(result.alternatives[key].windows) && result.alternatives[key].quote?.eligible === true && Number.isFinite(result.alternatives[key].quote.additionalAmountDue)))) throw new Error("invalid nearest alternatives");
    if (!( ["quote", "windows", "nearest"].includes(action)) && !validDateChangeResult(result)) throw new Error("invalid date change result");
    return result;
  }
  async function dateChangeWindows(token, serviceDate, serviceType, config, fetchImpl = global.fetch) {
    const result = await dateChangeRequest(token, "windows", { serviceDate, serviceType }, config, fetchImpl);
    if (!Array.isArray(result.windows)) throw new Error("invalid service windows");
    return result.windows;
  }
  async function dateChangeNearest(token, serviceDate, serviceType, newStartDate, newEndDate, config, fetchImpl = global.fetch) {
    return dateChangeRequest(token, "nearest", { serviceDate, serviceType, newStartDate, newEndDate }, config, fetchImpl);
  }
  function renderExtensionAvailability(data) {
    return data && data.paid_and_confirmed === true && ["confirmed", "ongoing"].includes(data.reservation_status);
  }
  function setExtensionStatus(message, isError = false) {
    const node = id("extension-status");
    if (!node) return;
    node.textContent = message;
    node.dataset.kind = isError ? "error" : "info";
  }
  function renderExtensionResult(extension) {
    const panel = id("extension-result");
    if (!panel) return;
    panel.replaceChildren();
    const heading = global.document.createElement("h2");
    const detail = global.document.createElement("p");
    if (extension.status === "confirmed") {
      heading.textContent = "Location prolongée";
      detail.textContent = `Votre nouvelle date de fin est le ${formatDate(`${extension.newEndDate}T12:00:00Z`)}. Montant supplémentaire payé : ${formatAmount(extension.additionalAmount)}.`;
    } else if (["cancelled", "expired", "failed"].includes(extension.status)) {
      heading.textContent = "Paiement non finalisé";
      detail.textContent = "Votre réservation initiale reste confirmée sans changement. Vous pourrez réessayer si votre réservation est toujours éligible.";
    } else if (extension.status === "review_required") {
      heading.textContent = "Vérification du paiement en cours";
      detail.textContent = "La prolongation n’est pas confirmée. Votre réservation initiale reste inchangée pendant la vérification.";
    } else {
      heading.textContent = "Paiement de la prolongation en cours";
      detail.textContent = "Nous attendons la confirmation sécurisée du paiement. La date de fin reste inchangée jusqu’à cette confirmation.";
    }
    panel.append(heading, detail);
    panel.hidden = false;
  }
  async function refreshPortal(token, config) {
    const fresh = await loadPortal(token, config);
    render(fresh);
    renderExtensionAvailability(fresh) ? show("portal-extension", true) : show("portal-extension", false);
    return fresh;
  }
  function show(target, visible) { const node = id(target); if (node) node.hidden = !visible; }
  function renderDateChangeAvailability(data) {
    return data && data.paid_and_confirmed === true && ["confirmed", "ongoing"].includes(data.reservation_status);
  }
  function setDateChangeStatus(message, isError = false) {
    const node = id("date-change-status");
    if (!node) return;
    node.textContent = message;
    node.dataset.kind = isError ? "error" : "info";
  }
  function renderDateChangeResult(change) {
    const panel = id("date-change-result");
    if (!panel) return;
    panel.replaceChildren();
    const heading = global.document.createElement("h2");
    const detail = global.document.createElement("p");
    if (change.status === "confirmed") {
      heading.textContent = "Dates modifiées";
      detail.textContent = `Votre location va du ${formatDate(`${change.newStartDate}T12:00:00Z`)} au ${formatDate(`${change.newEndDate}T12:00:00Z`)}. Le montant initialement payé est conservé.`;
    } else if (["held", "checkout_created", "paid"].includes(change.status)) {
      heading.textContent = "Paiement de la modification en cours";
      detail.textContent = "Votre réservation initiale reste inchangée jusqu’à la confirmation du paiement par notre serveur.";
    } else if (["payment_failed", "payment_cancelled", "expired"].includes(change.status)) {
      heading.textContent = "Modification non finalisée";
      detail.textContent = "Votre réservation et ses dates initiales sont conservées. Vous pouvez recalculer les dates et réessayer.";
    } else if (change.status === "review_required") {
      heading.textContent = "Demande transmise pour vérification";
      detail.textContent = "Les dates de votre réservation restent inchangées pendant l’examen. Aucun paiement ni remboursement n’a été effectué.";
    } else if (change.status === "failed") {
      heading.textContent = "Dates non modifiées";
      detail.textContent = "La disponibilité a changé avant la confirmation. Votre réservation initiale reste intacte.";
    } else if (change.status === "unchanged") {
      heading.textContent = "Aucune modification nécessaire";
      detail.textContent = "Les dates sélectionnées correspondent déjà à votre réservation.";
    } else {
      heading.textContent = "Utiliser la prolongation sécurisée";
      detail.textContent = "Cette demande ajoute des jours de location. Le paiement doit passer par le parcours de prolongation existant.";
    }
    if (change.status === "confirmed" && Number(change.additionalAmountDue ?? change.priceDelta) > 0) {
      detail.textContent += ` Montant supplementaire paye : ${formatAmount(Number(change.additionalAmountDue ?? change.priceDelta))}.`;
    }
    panel.append(heading, detail);
    panel.hidden = false;
  }
  function setupDateChange(data, token, config) {
    const panel = id("portal-date-change");
    if (!panel) return;
    panel.hidden = !renderDateChangeAvailability(data);
    if (panel.hidden) return;
    const start = id("date-change-start");
    const end = id("date-change-end");
    const form = id("date-change-form");
    const quoteNode = id("date-change-quote");
    const quoteButton = id("date-change-quote-button");
    const confirmButton = id("date-change-confirm");
    const extensionButton = id("date-change-use-extension");
    const deliveryWindow = id("date-change-delivery-window");
    const collectionWindow = id("date-change-collection-window");
    const deliveryAlternatives = id("date-change-delivery-alternatives");
    const collectionAlternatives = id("date-change-collection-alternatives");
    if (!start || !end || !form || !quoteNode || !quoteButton || !confirmButton || !extensionButton || !deliveryWindow || !collectionWindow) return;
    const toDate = (value) => String(value).slice(0, 10);
    const currentStart = toDate(data.rental_start);
    const currentEnd = toDate(data.rental_end);
    start.value = currentStart; end.value = currentEnd;
    const minimum = new Date(); minimum.setDate(minimum.getDate() + 1);
    start.min = minimum.toISOString().slice(0, 10); end.min = start.min;
    const resetQuote = () => { delete quoteNode.dataset.start; delete quoteNode.dataset.end; delete quoteNode.dataset.delivery; delete quoteNode.dataset.collection; confirmButton.hidden = true; extensionButton.hidden = true; };
    const loadWindows = async (date, originalDate, type, select, allowAlternatives = true) => {
      const alternativesNode = type === "delivery" ? deliveryAlternatives : collectionAlternatives;
      alternativesNode.replaceChildren(); alternativesNode.hidden = true;
      const changed = date !== originalDate;
      select.required = changed; select.disabled = !changed; select.hidden = !changed;
      if (!changed) { select.replaceChildren(Object.assign(document.createElement("option"), { value: "", textContent: "Créneau actuel conservé" })); return []; }
      select.replaceChildren(Object.assign(document.createElement("option"), { value: "", textContent: "Chargement des créneaux…" }));
      try {
        const windows = await dateChangeWindows(token, date, type, config);
        select.replaceChildren(Object.assign(document.createElement("option"), { value: "", textContent: "Choisissez un créneau" }));
        for (const window of windows) {
          const option = document.createElement("option"); option.value = window.code;
          option.textContent = `${window.label} (${window.startTime}–${window.endTime})`; select.append(option);
        }
        if (!windows.length) {
          select.firstChild.textContent = type === "delivery" ? "Aucun créneau de livraison n’est disponible à cette date" : "Aucun créneau de collecte n’est disponible à cette date";
          if (allowAlternatives) {
            const nearest = await dateChangeNearest(token, date, type, start.value, end.value, config);
            for (const direction of ["earlier", "later"]) {
              const side = nearest.alternatives[direction]; if (!side) continue;
              const heading = document.createElement("h4");
              heading.textContent = `Créneau ${type === "delivery" ? "de livraison" : "de collecte"} disponible le plus proche ${direction === "earlier" ? "avant" : "après"} — ${formatDate(`${side.date}T12:00:00Z`)}`;
              const quote = side.quote;
              const details = document.createElement("p");
              details.textContent = `Location actuelle : ${formatAmount(quote.currentRentalAmount)}. Nouvelle valorisation : ${formatAmount(quote.newRentalAmount)}. Montant à régler : ${formatAmount(quote.additionalAmountDue)}. Livraison : frais inchangés (${formatAmount(quote.deliveryChargeImpact)}). ${quote.priceDelta === 0 ? "Prix inchangé." : `Écart : ${quote.priceDelta > 0 ? "+" : "−"}${formatAmount(Math.abs(quote.priceDelta))}.`} TVA : non configurée. Le paiement déjà effectué ne sera pas débité à nouveau.`;
              alternativesNode.append(heading, details);
              for (const window of side.windows) {
                const button = document.createElement("button"); button.type = "button";
                button.textContent = `${window.label} (${window.startTime}–${window.endTime}) — choisir ce créneau`;
                button.addEventListener("click", async () => {
                  const targetDate = side.date;
                  if (type === "delivery") start.value = targetDate; else end.value = targetDate;
                  resetQuote();
                  await loadWindows(targetDate, originalDate, type, select, false);
                  if ([...select.options].some((option) => option.value === window.code)) {
                    select.value = window.code;
                    if (start.value !== currentStart && !deliveryWindow.value || end.value !== currentEnd && !collectionWindow.value) {
                      setDateChangeStatus("Créneau sélectionné. Choisissez également l’autre créneau requis, puis vérifiez le montant.");
                    } else form.requestSubmit();
                  } else {
                    setDateChangeStatus("Ce créneau vient d’être complet. Les disponibilités ont été actualisées.", true);
                  }
                });
                alternativesNode.append(button);
              }
            }
            alternativesNode.hidden = alternativesNode.childElementCount === 0;
          }
        }
        return windows;
      } catch { select.replaceChildren(Object.assign(document.createElement("option"), { value: "", textContent: "Créneaux indisponibles" })); return []; }
    };
    start.addEventListener("change", () => { resetQuote(); void loadWindows(start.value, currentStart, "delivery", deliveryWindow); });
    end.addEventListener("change", () => { resetQuote(); void loadWindows(end.value, currentEnd, "collection", collectionWindow); });
    void loadWindows(currentStart, currentStart, "delivery", deliveryWindow);
    void loadWindows(currentEnd, currentEnd, "collection", collectionWindow);
    form.addEventListener("submit", async (event) => {
      event.preventDefault(); resetQuote();
      if (!DATE(start.value) || !DATE(end.value) || end.value <= start.value) { setDateChangeStatus("Choisissez une période de location valide.", true); return; }
      if (start.value !== currentStart && !deliveryWindow.value || end.value !== currentEnd && !collectionWindow.value) {
        setDateChangeStatus("Choisissez un créneau de livraison et de collecte disponible.", true); return;
      }
      quoteButton.disabled = true;
      try {
        const { quote } = await dateChangeRequest(token, "quote", { newStartDate: start.value, newEndDate: end.value,
          ...(start.value !== currentStart ? { deliveryWindowCode: deliveryWindow.value } : {}),
          ...(end.value !== currentEnd ? { collectionWindowCode: collectionWindow.value } : {}) }, config);
        if (!quote.eligible) throw new Error("not eligible");
        quoteNode.textContent = `Période actuelle : du ${formatDate(`${quote.oldStartDate}T12:00:00Z`)} au ${formatDate(`${quote.oldEndDate}T12:00:00Z`)}. Nouvelle période : du ${formatDate(`${quote.newStartDate}T12:00:00Z`)} au ${formatDate(`${quote.newEndDate}T12:00:00Z`)}. Montant historiquement payé : ${formatAmount(quote.currentPaidAmount)}. Valorisation locative actuelle : ${formatAmount(quote.currentRentalAmount)}. Nouvelle valorisation : ${formatAmount(quote.newRentalAmount)}. ` +
          (quote.mode === "extension" ? `Montant supplémentaire à régler : ${formatAmount(quote.additionalAmountDue)}. Utilisez le parcours de prolongation sécurisé.` :
            quote.mode === "payment_required" ? `Paiement requis avant modification : ${formatAmount(quote.additionalAmountDue)}.` :
            quote.mode === "review_required" ? `Montant supplémentaire calculé : ${formatAmount(quote.additionalAmountDue)}. Une vérification est nécessaire avant toute modification.` :
              quote.priceDelta < 0 ? `Montant initialement payé conservé : ${formatAmount(quote.currentPaidAmount)}. La réduction de la durée ne donne pas automatiquement lieu à un remboursement.` :
                `Aucun frais de livraison supplémentaire. Aucun montant supplémentaire à régler.`);
        quoteNode.textContent += ` Livraison : ${quote.deliveryWindow?.label || data.delivery?.time_slot || "créneau actuel conservé"}. Collecte : ${quote.collectionWindow?.label || data.collection?.time_slot || "créneau actuel conservé"}. Frais de livraison : inchangés (${formatAmount(quote.deliveryChargeImpact)}). TVA : non configurée. Le paiement déjà effectué ne sera pas débité à nouveau.`;
        quoteNode.dataset.start = start.value; quoteNode.dataset.end = end.value; quoteNode.dataset.delivery = deliveryWindow.value; quoteNode.dataset.collection = collectionWindow.value; quoteNode.dataset.mode = quote.mode;
        if (quote.mode === "extension") extensionButton.hidden = false;
        else confirmButton.hidden = false;
        setDateChangeStatus("Disponibilité et impact tarifaire calculés par le serveur.");
      } catch {
        quoteNode.textContent = "";
        if (start.value !== currentStart) await loadWindows(start.value, currentStart, "delivery", deliveryWindow);
        if (end.value !== currentEnd) await loadWindows(end.value, currentEnd, "collection", collectionWindow);
        setDateChangeStatus("Ces dates ne sont pas disponibles pour une modification en ligne. Votre réservation reste inchangée.", true);
      } finally { quoteButton.disabled = false; }
    });
    extensionButton.addEventListener("click", () => {
      const extensionPanel = id("portal-extension");
      const extensionForm = id("extension-form");
      const extensionDate = id("extension-date");
      const open = id("extension-open");
      if (!extensionPanel || !extensionForm || !extensionDate) return;
      extensionPanel.hidden = false;
      if (open && !extensionForm.hidden) open.hidden = true;
      else if (open) open.click();
      extensionDate.value = end.value;
      extensionDate.focus();
      setDateChangeStatus("Vérifiez le montant dans le parcours de prolongation avant de payer.");
    });
    confirmButton.addEventListener("click", async () => {
      if (quoteNode.dataset.start !== start.value || quoteNode.dataset.end !== end.value || quoteNode.dataset.delivery !== deliveryWindow.value || quoteNode.dataset.collection !== collectionWindow.value || !global.crypto?.randomUUID) {
        setDateChangeStatus("Recalculez les dates avant de confirmer.", true); return;
      }
      confirmButton.disabled = true;
      setDateChangeStatus("Confirmation sécurisée en cours…");
      try {
        const { change } = await dateChangeRequest(token, "create", { newStartDate: start.value, newEndDate: end.value,
          ...(start.value !== currentStart ? { deliveryWindowCode: deliveryWindow.value } : {}),
          ...(end.value !== currentEnd ? { collectionWindowCode: collectionWindow.value } : {}),
          idempotencyKey: confirmButton.dataset.idempotencyKey || (confirmButton.dataset.idempotencyKey = global.crypto.randomUUID()) }, config);
        delete confirmButton.dataset.idempotencyKey;
        if (change.checkoutUrl && change.checkoutUrl.startsWith("https://checkout.stripe.com/")) {
          global.location.assign(change.checkoutUrl);
          return;
        }
        renderDateChangeResult(change);
        if (change.status === "confirmed") {
          try { await refreshPortal(token, config); } catch { /* Result remains server-confirmed. */ }
          confirmButton.hidden = true;
        }
        setDateChangeStatus(change.status === "review_required" ? "Aucune date ni somme n’a été modifiée automatiquement." : "État confirmé par le serveur.");
      } catch {
        if (start.value !== currentStart) await loadWindows(start.value, currentStart, "delivery", deliveryWindow);
        if (end.value !== currentEnd) await loadWindows(end.value, currentEnd, "collection", collectionWindow);
        try {
          const fresh = await loadPortal(token, config);
          render(fresh);
          const startNow = String(fresh.rental_start).slice(0, 10);
          const endNow = String(fresh.rental_end).slice(0, 10);
          if (startNow === start.value && endNow === end.value) {
            renderDateChangeResult({ status: "confirmed", newStartDate: startNow, newEndDate: endNow });
            setDateChangeStatus("Les dates demandées sont confirmées par le serveur.");
          } else {
            setDateChangeStatus("Impossible de confirmer la modification. L’état actuel de votre réservation a été rechargé.", true);
          }
        } catch { setDateChangeStatus("Impossible de vérifier l’état actuel. Actualisez cette page avant de réessayer.", true); }
      } finally { confirmButton.disabled = false; }
    });
  }
  async function processDateChangeReturn(token, config, search = global.location.search, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), fetchImpl = global.fetch) {
    const query = new URLSearchParams(search || "");
    const action = query.get("date_change");
    const changeId = query.get("change_id");
    if (!["success", "cancel"].includes(action) || !changeId || !/^[0-9a-f-]{36}$/i.test(changeId)) return null;
    let result;
    try { result = await dateChangeRequest(token, action === "cancel" ? "cancel" : "status", { changeId }, config, fetchImpl); }
    catch { setDateChangeStatus("Impossible de verifier le paiement. Aucune confirmation n'est affichee sans reponse du serveur.", true); return null; }
    let change = result.change;
    renderDateChangeResult(change);
    for (let attempt = 0; attempt < 20 && ["held", "checkout_created", "paid"].includes(change.status); attempt++) {
      await wait(1500);
      try { result = await dateChangeRequest(token, "status", { changeId }, config, fetchImpl); change = result.change; renderDateChangeResult(change); }
      catch { break; }
    }
    if (change.status === "confirmed") {
      try { await refreshPortal(token, config); renderDateChangeResult(change); } catch { /* Backend status remains authoritative. */ }
    }
    return change;
  }

  function setupExtension(data, token, config) {
    const panel = id("portal-extension");
    if (!panel) return;
    panel.hidden = !renderExtensionAvailability(data);
    const open = id("extension-open");
    const form = id("extension-form");
    const input = id("extension-date");
    const quoteButton = id("extension-quote-button");
    const pay = id("extension-pay");
    const quote = id("extension-quote");
    const collectionWindow = id("extension-collection-window");
    if (!panel.hidden && input) {
      const [year, month, day] = String(data.rental_end).slice(0, 10).split("-").map(Number);
      input.min = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
    }
    input?.addEventListener("change", async () => {
      if (quote) { quote.dataset.quoteDate = ""; delete quote.dataset.window; }
      if (pay) pay.hidden = true;
      if (!collectionWindow) return;
      collectionWindow.replaceChildren(Object.assign(document.createElement("option"), { value: "", textContent: "Chargement des créneaux…" }));
      try {
        const windows = await extensionWindows(token, input.value, config);
        collectionWindow.replaceChildren(Object.assign(document.createElement("option"), { value: "", textContent: "Conserver le créneau actuel s’il est disponible" }));
        for (const window of windows) {
          const option = document.createElement("option"); option.value = window.code;
          option.textContent = `${window.label} (${window.startTime}–${window.endTime})`; collectionWindow.append(option);
        }
      } catch { collectionWindow.replaceChildren(Object.assign(document.createElement("option"), { value: "", textContent: "Créneaux indisponibles" })); }
    });
    collectionWindow?.addEventListener("change", () => {
      if (quote) { quote.dataset.quoteDate = ""; delete quote.dataset.window; }
      if (pay) pay.hidden = true;
    });
    if (open && form) open.addEventListener("click", () => { form.hidden = false; open.hidden = true; input?.focus(); });
    if (form) form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!input || !DATE(input.value)) { setExtensionStatus("Choisissez une date de fin valide.", true); return; }
      quoteButton.disabled = true;
      if (pay) pay.hidden = true;
      try {
        const result = await extensionRequest(token, "quote", { newEndDate: input.value,
          ...(collectionWindow?.value ? { collectionWindowCode: collectionWindow.value } : {}) }, config);
        const q = result.quote;
        if (!q || !DATE(q.currentEndDate) || !DATE(q.newEndDate) || !Number.isInteger(q.addedDays) ||
            !Number.isFinite(q.additionalAmount) || q.currency !== "EUR" || q.newEndDate <= q.currentEndDate) throw new Error("invalid quote");
        if (q.collectionWindowRequired) {
          quote.textContent = "Le créneau de collecte actuel est indisponible à cette date. Choisissez un créneau puis recalculez le montant.";
          quote.dataset.quoteDate = ""; if (pay) pay.hidden = true; return;
        }
        quote.textContent = `Fin actuelle : ${formatDate(`${q.currentEndDate}T12:00:00Z`)}. Nouvelle fin : ${formatDate(`${q.newEndDate}T12:00:00Z`)}. ${q.addedDays} jour(s) supplémentaire(s) : ${formatAmount(q.additionalAmount)}. Aucun nouveau frais de livraison ni dépôt n’est inclus.`;
        quote.textContent += ` Collecte : ${q.collectionWindow?.label || "créneau actuel conservé"}.`;
        quote.dataset.quoteDate = q.newEndDate; quote.dataset.window = q.collectionWindow?.code || "";
        quote.dataset.window = q.collectionWindow?.code || "";
        if (pay) pay.hidden = false;
        setExtensionStatus("Le montant et la disponibilité ont été vérifiés par le serveur.");
      } catch (error) {
        quote.textContent = "";
        setExtensionStatus(error?.message === "NOT_ELIGIBLE" ? "Cette date ou cette réservation n’est pas éligible." : "Cette prolongation n’est pas disponible pour ces dates.", true);
      } finally { quoteButton.disabled = false; }
    });
    if (pay) pay.addEventListener("click", async () => {
      if (!input || quote?.dataset.quoteDate !== input.value || !global.crypto?.randomUUID) {
        setExtensionStatus("Recalculez le montant avant de continuer.", true); return;
      }
      pay.disabled = true;
      setExtensionStatus("Création sécurisée du paiement supplémentaire…");
      try {
        if (!quote.dataset.window) { setExtensionStatus("Le serveur n’a pas confirmé de créneau de collecte.", true); return; }
        const result = await extensionRequest(token, "create", { newEndDate: input.value, collectionWindowCode: quote.dataset.window,
          idempotencyKey: global.crypto.randomUUID() }, config);
        if (!result.checkout || typeof result.checkout.url !== "string" || !result.checkout.url.startsWith("https://checkout.stripe.com/")) throw new Error("invalid checkout");
        global.location.assign(result.checkout.url);
      } catch {
        setExtensionStatus("Le paiement n’a pas pu être préparé. Votre réservation initiale reste inchangée.", true);
        pay.disabled = false;
      }
    });
  }
  async function processExtensionReturn(token, config, search = global.location.search, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))) {
    const query = new URLSearchParams(search || "");
    const action = query.get("extension");
    const extensionId = query.get("extension_id");
    if (!["success", "cancel"].includes(action) || !extensionId || !/^[0-9a-f-]{36}$/i.test(extensionId)) return null;
    const outcome = async () => action === "cancel"
      ? await extensionRequest(token, "cancel", { extensionId }, config)
      : await extensionRequest(token, "status", { extensionId }, config);
    let result;
    try { result = await outcome(); } catch { setExtensionStatus("Impossible de vérifier le paiement pour le moment. Votre réservation initiale n’a pas été modifiée.", true); return null; }
    let ext = result.extension;
    renderExtensionResult(ext);
    for (let attempt = 0; attempt < 20 && !["confirmed", "cancelled", "expired", "failed", "review_required"].includes(ext.status); attempt++) {
      await wait(1500);
      try { result = await extensionRequest(token, "status", { extensionId }, config); ext = result.extension; renderExtensionResult(ext); }
      catch { break; }
    }
    if (ext.status === "confirmed") {
      try { await refreshPortal(token, config); renderExtensionResult(ext); } catch { /* Extension status remains backend-confirmed. */ }
    }
    return ext;
  }
  async function start() {
    const root = id("reservation-portal");
    const token = tokenFromFragment(global.location.hash);
    try {
      const data = await loadPortal(token, global.IGLOUE_SUPABASE_CONFIG);
      render(data);
      setupExtension(data, token, global.IGLOUE_SUPABASE_CONFIG);
      setupDateChange(data, token, global.IGLOUE_SUPABASE_CONFIG);
      id("portal-message").hidden = true;
      await processExtensionReturn(token, global.IGLOUE_SUPABASE_CONFIG);
      await processDateChangeReturn(token, global.IGLOUE_SUPABASE_CONFIG);
    } catch {
      showError("Lien invalide ou expiré", "Ce lien ne permet plus d’accéder à la réservation. Utilisez le lien reçu dans votre e-mail de confirmation.");
    } finally { if (root) root.setAttribute("aria-busy", "false"); }
  }
  global.IgReservationPortal = Object.freeze({ tokenFromFragment, validPayload, loadPortal, validExtensionStatus,
    extensionRequest, renderExtensionAvailability, renderExtensionResult, processExtensionReturn, extensionWindows, dateChangeWindows, dateChangeNearest,
    validDateChangeQuote, validDateChangeResult, dateChangeRequest, renderDateChangeAvailability, renderDateChangeResult, processDateChangeReturn, render, start });
  if (global.document && typeof global.document.getElementById === "function") start();
})(window);
