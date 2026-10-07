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
  async function start() {
    const root = id("reservation-portal");
    const token = tokenFromFragment(global.location.hash);
    try {
      const data = await loadPortal(token, global.IGLOUE_SUPABASE_CONFIG);
      render(data);
      id("portal-message").hidden = true;
    } catch {
      showError("Lien invalide ou expiré", "Ce lien ne permet plus d’accéder à la réservation. Utilisez le lien reçu dans votre e-mail de confirmation.");
    } finally { if (root) root.setAttribute("aria-busy", "false"); }
  }
  global.IgReservationPortal = Object.freeze({ tokenFromFragment, validPayload, loadPortal, render, start });
  if (global.document && typeof global.document.getElementById === "function") start();
})(window);
