(function (global) {
  "use strict";

  const labels = Object.freeze({
    planned: "Livraison planifiée",
    driver_assigned: "Chauffeur attribué",
    on_the_way: "Votre livraison est en route",
    arrived: "Le chauffeur est arrivé",
    handover: "Remise en cours",
    completed: "Livraison terminée",
    update_pending: "Mise à jour de votre livraison en cours"
  });
  const timelineLabels = Object.freeze({
    planned: "Livraison planifiée",
    driver_assigned: "Chauffeur attribué",
    on_the_way: "En route",
    arrived: "Chauffeur arrivé",
    handover: "Remise en cours",
    completed: "Livraison terminée"
  });
  const timelineOrder = Object.freeze(Object.keys(timelineLabels));
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;

  function byId(id) { return global.document.getElementById(id); }

  function showMessage(title, description) {
    const root = byId("delivery-status-message");
    if (!root) return;
    root.replaceChildren();
    const heading = global.document.createElement("h1");
    heading.textContent = title;
    const paragraph = global.document.createElement("p");
    paragraph.textContent = description;
    root.append(heading, paragraph);
  }

  function tokenFromFragment(hash) {
    const params = new URLSearchParams(String(hash || "").replace(/^#/, ""));
    return params.get("token") || "";
  }

  function validPayload(data) {
    if (!data || data.ok !== true || typeof data.business_name !== "string" || data.business_name.length > 120 ||
        !(data.support_email === null || typeof data.support_email === "string" && data.support_email.length <= 254) ||
        !Object.hasOwn(labels, data.state) ||
        typeof data.scheduled_date !== "string" || !datePattern.test(data.scheduled_date) ||
        !(data.time_slot === null || typeof data.time_slot === "string" && data.time_slot.length <= 100) ||
        !(data.delivery_address === null || typeof data.delivery_address === "string" && data.delivery_address.length <= 300) ||
        typeof data.last_updated_at !== "string" || Number.isNaN(Date.parse(data.last_updated_at)) ||
        !Array.isArray(data.timeline)) return false;
    return data.timeline.every((item) => item && Object.hasOwn(timelineLabels, item.state) &&
      (item.at === null || typeof item.at === "string" && !Number.isNaN(Date.parse(item.at))));
  }

  function formatDate(value) {
    const [year, month, day] = value.split("-").map(Number);
    return new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "UTC" })
      .format(new Date(Date.UTC(year, month - 1, day)));
  }

  function formatDateTime(value) {
    return new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris"
    }).format(new Date(value));
  }

  function renderStatus(data) {
    const details = byId("delivery-status-details");
    const heading = byId("delivery-status-title");
    if (!details || !heading) return;
    const brand = byId("delivery-status-brand");
    if (brand) brand.textContent = data.business_name;
    const support = byId("delivery-status-support");
    if (support) {
      support.replaceChildren();
      if (data.support_email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.support_email)) {
        const link = global.document.createElement("a");
        link.href = `mailto:${data.support_email}`;
        link.textContent = `Pour toute question, contactez ${data.support_email}.`;
        support.append(link);
        support.hidden = false;
      } else support.hidden = true;
    }
    heading.textContent = labels[data.state];
    byId("delivery-status-date").textContent = `Date prévue : ${formatDate(data.scheduled_date)}${data.time_slot ? ` · ${data.time_slot}` : ""}`;
    byId("delivery-status-address").textContent = data.delivery_address ? `Adresse : ${data.delivery_address}` : "Adresse communiquée séparément.";
    byId("delivery-status-updated").textContent = `Dernière mise à jour : ${formatDateTime(data.last_updated_at)}`;
    const timeline = byId("delivery-status-timeline");
    timeline.replaceChildren();
    const reached = new Set(data.timeline.filter((item) => item.at).map((item) => item.state));
    const currentIndex = timelineOrder.indexOf(data.state);
    const isCompleted = data.state === "completed";
    for (const [index, state] of timelineOrder.entries()) {
      const item = data.timeline.find((entry) => entry.state === state);
      const step = global.document.createElement("li");
      const lifecycleClass = isCompleted || index < currentIndex
        ? "delivery-status-step--completed"
        : index === currentIndex ? "delivery-status-step--active" : "delivery-status-step--upcoming";
      const animateIncomingConnector = index === currentIndex - 1;
      step.className = `delivery-status-step ${lifecycleClass}${animateIncomingConnector ? " delivery-status-step--connector-update" : ""}`;
      step.dataset.reached = String(reached.has(state));
      const text = global.document.createElement("span");
      const label = global.document.createElement("strong");
      label.textContent = timelineLabels[state];
      text.append(label);
      if (item && item.at) {
        const time = global.document.createElement("time");
        time.dateTime = item.at;
        time.textContent = formatDateTime(item.at);
        text.append(time);
      }
      step.append(text);
      if (animateIncomingConnector) {
        const highlight = global.document.createElement("span");
        highlight.className = "delivery-status-connector-highlight";
        highlight.setAttribute("aria-hidden", "true");
        step.append(highlight);
      }
      timeline.append(step);
    }
    details.hidden = false;
    showMessage("Statut de votre livraison", "Consultez les étapes de votre livraison.");
  }

  async function loadDeliveryStatus(token, config, fetchImpl = global.fetch) {
    if (typeof token !== "string" || !token || !config ||
        typeof config.projectUrl !== "string" || typeof config.publishableKey !== "string") {
      return { ok: false };
    }
    const response = await fetchImpl(`${config.projectUrl}/functions/v1/customer-delivery-status`, {
      method: "POST",
      headers: { apikey: config.publishableKey, "content-type": "application/json" },
      body: JSON.stringify({ token }),
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer"
    });
    if (!response.ok) return { ok: false };
    const data = await response.json();
    return validPayload(data) ? data : { ok: false };
  }

  async function start() {
    const card = byId("delivery-status-card");
    const token = tokenFromFragment(global.location && global.location.hash);
    // Keep the fragment so a customer can refresh. Fragments are not sent in HTTP
    // requests or Referer headers; this page has no analytics or third-party assets.
    if (!token) {
      if (card) card.setAttribute("aria-busy", "false");
      showMessage("Lien non valide ou expiré", "Ce lien de suivi n’est plus disponible. Contactez votre prestataire si vous avez besoin d’aide.");
      return;
    }
    try {
      const data = await loadDeliveryStatus(token, global.IGLOUE_SUPABASE_CONFIG);
      if (!data.ok) {
        showMessage("Lien non valide ou expiré", "Ce lien de suivi n’est plus disponible. Contactez votre prestataire si vous avez besoin d’aide.");
      } else {
        renderStatus(data);
      }
    } catch {
      showMessage("Statut temporairement indisponible", "Impossible de charger le statut pour le moment. Réessayez dans quelques instants.");
    } finally {
      if (card) card.setAttribute("aria-busy", "false");
    }
  }

  global.IgDeliveryStatus = Object.freeze({ labels, loadDeliveryStatus, renderStatus, start, tokenFromFragment, validPayload });
  if (global.document && typeof global.document.getElementById === "function") start();
})(window);
