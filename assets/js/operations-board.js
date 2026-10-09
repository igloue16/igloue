(function installOperationsBoard(global) {
  "use strict";

  const stateLabels = Object.freeze({
    upcoming: "\u00c0 venir", due_now: "Dans le cr\u00e9neau", overdue: "En retard",
    completed: "Termin\u00e9e", cancelled: "Annul\u00e9e", attention: "\u00c0 v\u00e9rifier"
  });
  const jobLabels = Object.freeze({ delivery: "Livraison", collection: "Collecte" });
  const statusLabels = Object.freeze({
    scheduled: "Planifi\u00e9e", assigned: "Attribu\u00e9e", en_route: "En route", arrived: "Sur place",
    handover_in_progress: "Remise en cours", in_progress: "En cours", completed: "Termin\u00e9e",
    failed: "\u00c9chec", cancelled: "Annul\u00e9e"
  });
  const warningLabels = Object.freeze({
    job_failed: "Intervention en \u00e9chec",
    payment_not_confirmed: "Paiement ou r\u00e9servation \u00e0 v\u00e9rifier",
    service_window_missing: "Cr\u00e9neau de service manquant",
    allocation_missing: "\u00c9quipement allou\u00e9 manquant",
    allocated_equipment_unavailable: "\u00c9quipement allou\u00e9 indisponible"
  });

  function escape(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
  }

  function formatDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
    return match ? `${match[3]}/${match[2]}/${match[1]}` : "Date indisponible";
  }

  function renderSummary(summary) {
    const cards = [
      ["Livraisons", summary.deliveriesToday], ["Collectes", summary.collectionsToday],
      ["En retard", summary.overdueJobs], ["Termin\u00e9es", summary.completedJobs],
      ["\u00c0 suivre", summary.attentionJobs]
    ];
    return cards.map(([label, value]) => `<article class="ops-summary-card"><span>${label}</span><strong>${value}</strong></article>`).join("");
  }

  function renderJob(job) {
    const kind = jobLabels[job.type] || "Intervention";
    const state = stateLabels[job.state] || "Statut \u00e0 v\u00e9rifier";
    const status = statusLabels[job.status] || "Statut indisponible";
    const window = job.window ? `${escape(job.window.start)}\u2013${escape(job.window.end)} \u00b7 ${escape(job.window.label)}` : "Cr\u00e9neau non renseign\u00e9";
    const address = job.address || {};
    const addressText = [address.line1, address.line2, [address.postcode, address.city].filter(Boolean).join(" ")]
      .filter(Boolean).map(escape).join("<br>") || "Adresse indisponible";
    const warnings = Array.isArray(job.warnings) ? job.warnings : [];
    const equipment = Array.isArray(job.equipment) ? job.equipment : [];
    const warningMarkup = warnings.map((warning) => `<li>${escape(warningLabels[warning] || "Point \u00e0 v\u00e9rifier")}</li>`).join("");
    const equipmentMarkup = equipment.length
      ? equipment.map((item) => {
        const units = Array.isArray(item.units) ? item.units : [];
        const unitText = units.map((unit) => [unit.serialNumber, unit.status, unit.condition].filter(Boolean).join(" \u00b7 ")).filter(Boolean).join(", ");
        return `<li><strong>${escape(item.name)}</strong> \u00b7 ${Number(item.quantity) || 0} unit\u00e9(s)` +
          `${unitText ? `<small>${escape(unitText)}</small>` : ""}</li>`;
      }).join("")
      : "<li>\u00c9quipement non renseign\u00e9</li>";
    const phone = job.customerPhone ? `<a href="tel:${escape(job.customerPhone)}">${escape(job.customerPhone)}</a>` : "T\u00e9l\u00e9phone non renseign\u00e9";
    const notes = job.notes ? `<p><strong>Note op\u00e9rationnelle</strong><br>${escape(job.notes)}</p>` : "";
    const deliveryProgress = job.type === "delivery" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(job.serviceJobId || "")) &&
      job.status === "assigned"
      ? `<button class="handover-open-button" type="button" data-delivery-progress="en_route" data-service-job-id="${escape(job.serviceJobId)}">Démarrer la livraison</button>`
      : job.type === "delivery" && job.status === "en_route"
        ? `<button class="handover-open-button" type="button" data-delivery-progress="arrived" data-service-job-id="${escape(job.serviceJobId)}">Confirmer mon arrivée</button>`
        : "";
    const verifyAction = job.type === "delivery" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(job.serviceJobId || "")) &&
      ["arrived", "handover_in_progress"].includes(String(job.status || "")) &&
      !["completed", "cancelled"].includes(String(job.state || ""))
      ? `<button class="handover-open-button" type="button" data-verify-delivery="${escape(job.serviceJobId)}">${job.status === "handover_in_progress" ? "Reprendre la remise" : "Vérifier la livraison"}</button>`
      : "";
    return `<details class="ops-job ops-state-${escape(job.state)}${job.needsAttention ? " ops-needs-attention" : ""}">
      <summary>
        <span class="ops-job-time">${escape(job.window?.start || "\u2014")}</span>
        <span class="ops-job-main"><span class="ops-job-kind">${kind}</span><strong>${escape(job.customerName || "Client non renseign\u00e9")}</strong>
        <small>R\u00e9servation ${escape(job.reservationReference || "\u2014")} \u00b7 ${escape(formatDate(job.scheduledDate))}</small></span>
        <span class="ops-badges"><span class="ops-badge ops-state-badge">${escape(state)}</span><span class="ops-badge">${escape(status)}</span></span>
      </summary>
      <div class="ops-job-detail">
        <p><strong>Cr\u00e9neau</strong><br>${window}</p>
        <p><strong>Adresse</strong><br>${addressText}</p>
        <p><strong>Contact</strong><br>${phone}</p>
        <p><strong>Mat\u00e9riel</strong></p><ul class="ops-equipment">${equipmentMarkup}</ul>
        <p><strong>Paiement</strong><br>${escape(job.paymentStatus || "Indisponible")}</p>
        ${notes}
        ${warningMarkup ? `<div class="ops-warning"><strong>\u00c0 v\u00e9rifier</strong><ul>${warningMarkup}</ul></div>` : ""}
        ${deliveryProgress}${verifyAction}
      </div>
    </details>`;
  }

  function render(board, filter = "all") {
    if (!board || !board.metadata || !board.summary || !Array.isArray(board.jobs)) {
      return { date: "", summary: "", jobs: "<p class=\"ops-empty\">Les donn\u00e9es op\u00e9rationnelles sont indisponibles.</p>", timezone: "" };
    }
    const jobs = board.jobs.filter((job) => {
      if (!job || !["delivery", "collection"].includes(job.type)) return false;
      if (filter === "attention") return job.needsAttention === true || ["overdue", "attention"].includes(job.state);
      return filter === "all" || filter === job.type;
    });
    return {
      date: String(board.metadata.selectedDate || ""),
      timezone: String(board.metadata.timezone || ""),
      summary: renderSummary(board.summary),
      jobs: jobs.length ? jobs.map(renderJob).join("") : "<p class=\"ops-empty\">Aucune intervention pour cette journ\u00e9e.</p>"
    };
  }

  global.IGLOUE_OPERATIONS_BOARD = Object.freeze({ render, escape });
})(window);
