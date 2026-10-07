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
  const id = (value) => global.document.getElementById(value);
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
    if (!panel.hidden && input) {
      const [year, month, day] = String(data.rental_end).slice(0, 10).split("-").map(Number);
      input.min = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
    }
    if (open && form) open.addEventListener("click", () => { form.hidden = false; open.hidden = true; input?.focus(); });
    if (form) form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!input || !DATE(input.value)) { setExtensionStatus("Choisissez une date de fin valide.", true); return; }
      quoteButton.disabled = true;
      if (pay) pay.hidden = true;
      try {
        const result = await extensionRequest(token, "quote", { newEndDate: input.value }, config);
        const q = result.quote;
        if (!q || !DATE(q.currentEndDate) || !DATE(q.newEndDate) || !Number.isInteger(q.addedDays) ||
            !Number.isFinite(q.additionalAmount) || q.currency !== "EUR" || q.newEndDate <= q.currentEndDate) throw new Error("invalid quote");
        quote.textContent = `Fin actuelle : ${formatDate(`${q.currentEndDate}T12:00:00Z`)}. Nouvelle fin : ${formatDate(`${q.newEndDate}T12:00:00Z`)}. ${q.addedDays} jour(s) supplémentaire(s) : ${formatAmount(q.additionalAmount)}. Aucun nouveau frais de livraison ni dépôt n’est inclus.`;
        quote.dataset.quoteDate = q.newEndDate;
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
        const result = await extensionRequest(token, "create", { newEndDate: input.value, idempotencyKey: global.crypto.randomUUID() }, config);
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
      id("portal-message").hidden = true;
      await processExtensionReturn(token, global.IGLOUE_SUPABASE_CONFIG);
    } catch {
      showError("Lien invalide ou expiré", "Ce lien ne permet plus d’accéder à la réservation. Utilisez le lien reçu dans votre e-mail de confirmation.");
    } finally { if (root) root.setAttribute("aria-busy", "false"); }
  }
  global.IgReservationPortal = Object.freeze({ tokenFromFragment, validPayload, loadPortal, validExtensionStatus,
    extensionRequest, renderExtensionAvailability, renderExtensionResult, processExtensionReturn, render, start });
  if (global.document && typeof global.document.getElementById === "function") start();
})(window);
