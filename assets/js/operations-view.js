const IGLOUE_OPERATION_TASK_LABELS = Object.freeze({
  "prepare-unit": "Machine à préparer",
  "prepare-collection-label": "Étiquette de reprise à préparer",
  inspection: "Inspection à prévoir",
  cleaning: "Nettoyage à prévoir"
});

const IGLOUE_OPERATION_SETUP_LABELS = Object.freeze({
  "delivery-only": "Livraison seule",
  basic: "Mise en service simple",
  "window-installation": "Installation fenêtre",
  special: "Installation à vérifier"
});

const IGLOUE_OPERATION_TASK_STATUS_LABELS = Object.freeze({
  pending: "À faire",
  "in-progress": "En cours",
  completed: "Terminée",
  blocked: "Bloquée"
});

function isOperationalDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || "");
}

function shiftOperationalDate(date, dayCount) {
  const dateMinute = getFleetCivilMinute(`${date}T12:00`);
  return formatFleetCivilMinute(dateMinute + (dayCount * 1440)).slice(0, 10);
}

function formatOperationalDayHeading(date) {
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long"
  }).format(new Date(`${date}T12:00:00`));
}

function renderOperationalTimelineItem(item) {
  if (item.itemType === "busy-period") {
    return `
      <article class="operations-timeline-item">
        <time class="operations-time">${item.startTime}<br>${item.endTime}</time>
        <div>
          <span class="operations-item-kind">Indisponible</span>
          <h3 class="operations-item-title">${item.busyPeriod.displayLabel}</h3>
          <p class="operations-item-copy">Source normalisée · ${item.busyPeriod.source}</p>
        </div>
      </article>
    `;
  }

  if (item.itemType === "preparation-window") {
    return `
      <article class="operations-timeline-item">
        <time class="operations-time">${item.startTime}<br>${item.endTime}</time>
        <div>
          <span class="operations-item-kind">Préparation réservée</span>
          <h3 class="operations-item-title">
            ${item.unitIds.length ? item.unitIds.join(" · ") : "Machine à attribuer"}
          </h3>
          <p class="operations-item-copy">Marge opérationnelle avant livraison.</p>
        </div>
      </article>
    `;
  }

  if (item.itemType === "turnaround-window") {
    const nextDay = item.endDate !== item.serviceDate && item.endDate;
    return `
      <article class="operations-timeline-item">
        <time class="operations-time">${item.startTime}<br>${item.endTime}${nextDay ? " +1 j" : ""}</time>
        <div>
          <span class="operations-item-kind">Remise en service réservée</span>
          <h3 class="operations-item-title">
            ${item.unitIds.length ? item.unitIds.join(" · ") : "Machine à attribuer"}
          </h3>
          <p class="operations-item-copy">Inspection, nettoyage et préparation planifiés — non confirmés.</p>
        </div>
      </article>
    `;
  }

  const service = item.service;
  const serviceName = service.serviceType === "delivery" ? "Livraison" : "Reprise";
  const units = service.unitIds.length
    ? service.unitIds.join(" · ")
    : "Machine à attribuer";
  const setup = service.serviceType === "delivery" && service.setupMode
    ? IGLOUE_OPERATION_SETUP_LABELS[service.setupMode] || service.setupMode
    : null;

  return `
    <article class="operations-timeline-item" data-service-id="${service.serviceId}">
      <time class="operations-time">${service.startTime}<br>${service.endTime}</time>
      <div>
        <span class="operations-item-kind">${serviceName} · ${service.statusLabel}</span>
        <h3 class="operations-item-title">${service.productName} · ${units}</h3>
        <p class="operations-item-copy">
          ${service.postcode}${service.zoneName ? ` · ${service.zoneName}` : ""}
        </p>
        <div class="operations-service-meta">
          ${setup ? `<span>${setup}</span>` : ""}
          ${service.expressSelected ? "<span>Express · Oui</span>" : ""}
          <span>Réf. ${service.reservationId}</span>
          <span>Ressource ${service.assignedResourceIds.join(", ") || "à attribuer"}</span>
        </div>
        <button class="operations-future-action" type="button" disabled>
          Ouvrir l’intervention — bientôt
        </button>
      </div>
    </article>
  `;
}

function renderOperationalTasks(tasks) {
  if (!tasks.length) {
    return '<p class="operations-empty">Aucune action flotte dérivée.</p>';
  }

  return `
    <ul class="operations-task-list">
      ${tasks.map((task) => `
        <li class="operations-task-row">
          <div>
            <strong>${IGLOUE_OPERATION_TASK_LABELS[task.type] || task.type}</strong>
            <span>${task.unitId || "Machine à attribuer"} · avant ${task.dueTime}</span>
          </div>
          <span class="operations-task-status">
            ${IGLOUE_OPERATION_TASK_STATUS_LABELS[task.status] || task.status}
          </span>
        </li>
      `).join("")}
    </ul>
  `;
}

function renderOperationalSlots(remainingSlots) {
  const renderSlotList = (slots) => slots.length
    ? `<ul class="operations-slot-list">${slots.map((slot) => `
        <li class="operations-slot-row"><strong>${slot.label}</strong></li>
      `).join("")}</ul>`
    : '<p class="operations-empty">Aucun créneau</p>';

  return `
    <div class="operations-slot-columns">
      <div>
        <h3>Livraisons</h3>
        ${renderSlotList(remainingSlots.delivery)}
      </div>
      <div>
        <h3>Reprises</h3>
        ${renderSlotList(remainingSlots.collection)}
      </div>
    </div>
  `;
}

function renderOperationalDay(date) {
  const model = buildOperationalDay(date);
  const app = document.querySelector("#operations-app");
  const interventionLabel = `${model.summary.interventions} intervention${model.summary.interventions > 1 ? "s" : ""}`;

  app.innerHTML = `
    <div class="operations-shell">
      <header class="operations-topline">
        <div>
          <p class="operations-brand">IGLOUE</p>
          <p class="operations-environment">Vue opérations · développement V1</p>
        </div>
        <p class="operations-security-note">
          Outil statique non sécurisé. Une interface de production devra être authentifiée côté serveur.
        </p>
      </header>

      <section class="operations-sheet" aria-labelledby="operations-day-title">
        <nav class="operations-day-nav" aria-label="Navigation par date">
          <button type="button" data-previous-day>← Jour précédent</button>
          <label class="operations-date-control">
            Date
            <input type="date" value="${date}" data-operations-date>
          </label>
          <button type="button" data-next-day>Jour suivant →</button>
        </nav>

        <header class="operations-day-header">
          <div>
            <span class="operations-kicker">Plan de journée · Europe/Paris</span>
            <h1 id="operations-day-title">${formatOperationalDayHeading(date)}</h1>
          </div>
          <p class="operations-day-summary">
            ${interventionLabel}<br>
            ${model.summary.deliveries} livraison${model.summary.deliveries > 1 ? "s" : ""} ·
            ${model.summary.collections} reprise${model.summary.collections > 1 ? "s" : ""} ·
            ${model.summary.busyPeriods} indisponibilité${model.summary.busyPeriods > 1 ? "s" : ""}
          </p>
        </header>

        ${model.conflicts.length ? `
          <aside class="operations-conflicts" role="status">
            <h2>${model.conflicts.length} point${model.conflicts.length > 1 ? "s" : ""} à vérifier</h2>
            <ul>
              ${model.conflicts.map((conflict) => `
                <li>
                  ${conflict.label}
                  ${conflict.unitIds ? ` · ${conflict.unitIds.join(", ")}` : ""}
                  ${conflict.reservationIds
                    ? ` · ${conflict.reservationIds.join(", ")}`
                    : conflict.serviceIds
                      ? ` · ${conflict.serviceIds.join(", ")}`
                      : ""}
                </li>
              `).join("")}
            </ul>
          </aside>
        ` : ""}

        <div class="operations-layout">
          <section class="operations-timeline" aria-labelledby="operations-timeline-title">
            <div class="operations-section-heading">
              <h2 id="operations-timeline-title">Chronologie</h2>
              <span>${model.operatingRange.startTime}–${model.operatingRange.endTime}</span>
            </div>
            ${model.timeline.length
              ? model.timeline.map(renderOperationalTimelineItem).join("")
              : '<p class="operations-empty">Aucune intervention ou indisponibilité.</p>'}
          </section>

          <aside class="operations-side">
            <section aria-labelledby="operations-tasks-title">
              <div class="operations-section-heading">
                <h2 id="operations-tasks-title">Actions flotte</h2>
                <span>${model.tasks.length}</span>
              </div>
              ${renderOperationalTasks(model.tasks)}
            </section>

            <section aria-labelledby="operations-slots-title">
              <div class="operations-section-heading">
                <h2 id="operations-slots-title">Créneaux encore possibles</h2>
                <span>Indication V1</span>
              </div>
              ${renderOperationalSlots(model.remainingSlots)}
            </section>
          </aside>
        </div>

        <p class="operations-footnote">
          Planification indicative uniquement : aucun créneau, véhicule ou appareil n’est verrouillé par cette page.
        </p>
      </section>
    </div>
  `;

  const navigateToDate = (nextDate) => {
    const url = new URL(window.location.href);
    url.searchParams.set("date", nextDate);
    window.history.replaceState({}, "", url);
    renderOperationalDay(nextDate);
  };

  app.querySelector("[data-previous-day]").addEventListener("click", () => {
    navigateToDate(shiftOperationalDate(date, -1));
  });
  app.querySelector("[data-next-day]").addEventListener("click", () => {
    navigateToDate(shiftOperationalDate(date, 1));
  });
  app.querySelector("[data-operations-date]").addEventListener("change", (event) => {
    if (isOperationalDate(event.target.value)) {
      navigateToDate(event.target.value);
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const requestedDate = new URLSearchParams(window.location.search).get("date");
  const initialDate = isOperationalDate(requestedDate)
    ? requestedDate
    : getFranceLocalDateTime().date;

  renderOperationalDay(initialDate);
});
