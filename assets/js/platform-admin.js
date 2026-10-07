(function installPlatformAdmin(global) {
  "use strict";
  const titles = {
    overview: "Vue d’ensemble",
    tenants: "Organisations",
    tenant: "Fiche organisation",
    employees: "Employés plateforme",
    roles: "Rôles et permissions",
    audit: "Audit plateforme",
    approvals: "Demandes de gouvernance",
  };
  const labels = {
    active: "ACTIF",
    inactive: "INACTIF",
    suspended: "SUSPENDU",
    revoked: "RÉVOQUÉ",
    pending: "EN ATTENTE",
    approved: "APPROUVÉ",
    rejected: "REFUSÉ",
    expired: "EXPIRÉ",
    failed: "ÉCHEC",
    resolved: "RÉSOLU",
    dismissed: "CLOS",
    success: "SUCCÈS",
    applied: "APPLIQUÉ",
  };
  const SUPPORT_SESSION_KEY = "igloue.platform-admin.support-session";
  const app = {
    client: null,
    section: "overview",
    tenantSlug: null,
    refreshTimer: null,
    supportExpireTimer: null,
    authorized: false,
    supportSessionId: null,
    pendingSupportTenant: null,
    supportView: "summary",
    supportReference: null,
  };
  function el(id) {
    return global.document && global.document.getElementById(id);
  }
  function make(tag, className, text) {
    const node = global.document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }
  function show(node, visible) {
    if (node) node.hidden = !visible;
  }
  function status(value) {
    const key = String(value || "").toLowerCase();
    const node = make("span", `status ${key}`, labels[key] || String(value || "—"));
    return node;
  }
  function panel(title, className = "") {
    const section = make("section", `panel ${className}`.trim());
    section.append(make("h2", "", title));
    return section;
  }
  function line(parent, title, detail, badge) {
    const row = make("div", "row");
    const main = make("div", "row-main");
    main.append(make("div", "row-title", title));
    if (detail) main.append(make("div", "row-meta", detail));
    row.append(main);
    if (badge !== undefined && badge !== null) row.append(typeof badge === "string" ? status(badge) : badge);
    parent.append(row);
    return row;
  }
  function tags(parent, values) {
    const wrap = make("div", "tag-list");
    (Array.isArray(values) ? values : []).forEach((value) => {
      const key = typeof value === "string" ? value : value && value.key;
      if (key) wrap.append(make("span", "tag", key));
    });
    if (!wrap.childNodes.length && !wrap.children.length) wrap.append(make("span", "row-meta", "Aucune permission"));
    parent.append(wrap);
  }
  function metricGrid(target, metrics) {
    metrics.forEach(([name, value]) => {
      const card = panel(name, "third");
      card.append(make("div", "metric", value === null || value === undefined ? "—" : value));
      card.append(make("div", "metric-label", "Données actuelles staging"));
      target.append(card);
    });
  }
  function date(value) {
    if (!value) return "—";
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? "—"
      : new Intl.DateTimeFormat("fr-FR", {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(parsed);
  }
  function setFeedback(message, isError = false) {
    const target = el("platform-feedback");
    if (!target) return;
    target.textContent = message || "";
    target.classList.toggle("error", isError);
  }
  function configuration() {
    const config = global.IGLOUE_SUPABASE_CONFIG;
    const hostname = String(global.location && global.location.hostname).toLowerCase();
    if (config && config.backend === "staging" && hostname === "test.igloue.fr") return config;
    return null;
  }
  function getClient() {
    if (app.client) return app.client;
    const config = configuration();
    if (!config || !global.supabase || typeof global.supabase.createClient !== "function") throw new Error("Configuration staging indisponible.");
    app.client = global.supabase.createClient(config.projectUrl, config.publishableKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
    return app.client;
  }
  async function verifyIdentity() {
    const { data, error } = await getClient().auth.getUser();
    if (error || !data || !data.user || !(data.user.email_confirmed_at || data.user.confirmed_at)) throw new Error("AUTH_REQUIRED");
    return data.user;
  }
  async function read(section, slug) {
    const db = getClient();
    const { data, error } = await db.rpc("platform_control_plane_read_v1", {
      p_section: section,
      p_slug: slug || null,
    });
    if (error) {
      const code = String(error.code || "");
      if (code === "42501" || /access denied|permission/i.test(String(error.message || ""))) throw new Error("DENIED");
      throw new Error("Lecture plateforme indisponible.");
    }
    if (!data || typeof data !== "object") throw new Error("Réponse plateforme invalide.");
    return data;
  }
  function storedSupportSession() {
    try {
      return global.sessionStorage && global.sessionStorage.getItem(SUPPORT_SESSION_KEY);
    } catch (_) {
      return null;
    }
  }
  function storeSupportSession(sessionId) {
    try {
      if (global.sessionStorage) global.sessionStorage.setItem(SUPPORT_SESSION_KEY, sessionId);
    } catch (_) {
      /* Backend authorization does not depend on browser storage. */
    }
  }
  function clearStoredSupportSession() {
    try {
      if (global.sessionStorage) global.sessionStorage.removeItem(SUPPORT_SESSION_KEY);
    } catch (_) {
      /* Backend authorization does not depend on browser storage. */
    }
  }
  async function openSupportSession(organisationSlug, reason) {
    const normalizedReason = String(reason || "").trim();
    if (!organisationSlug || normalizedReason.length < 20 || normalizedReason.length > 1000) throw new Error("REASON_REQUIRED");
    const { data, error } = await getClient().rpc("platform_open_support_session_for_tenant", {
      p_organisation_slug: organisationSlug,
      p_reason: normalizedReason,
      p_ttl_seconds: 1800,
    });
    if (error) {
      if (String(error.code || "") === "42501") throw new Error("DENIED");
      throw new Error("Impossible d’ouvrir la session de support.");
    }
    if (typeof data !== "string" || !data) throw new Error("Réponse de session invalide.");
    return data;
  }
  async function readSupportSession(sessionId) {
    if (!sessionId) throw new Error("DENIED");
    const { data, error } = await getClient().rpc("platform_support_session_read_v1", { p_session: sessionId });
    if (error) {
      if (String(error.code || "") === "42501") throw new Error("DENIED");
      throw new Error("Lecture du mode support indisponible.");
    }
    if (data && data.error === "expired") throw new Error("EXPIRED");
    if (!data || !data.session || !data.tenant || data.session.access_mode !== "read") throw new Error("DENIED");
    return data;
  }
  async function readSupportWorkspace(sessionId, section, reference = null) {
    if (!sessionId) throw new Error("DENIED");
    const { data, error } = await getClient().rpc("platform_support_workspace_read_v1", {
      p_session: sessionId,
      p_section: section,
      p_reservation_reference: reference,
    });
    if (error) {
      if (String(error.code || "") === "42501") throw new Error("DENIED");
      throw new Error("Lecture de l’espace support indisponible.");
    }
    if (!data || typeof data !== "object") throw new Error("Réponse de l’espace support invalide.");
    return data;
  }
  async function readSupportOutboxCandidates(sessionId) {
    if (!sessionId) throw new Error("DENIED");
    const { data, error } = await getClient().rpc("platform_support_outbox_retry_candidates_v1", {
      p_session: sessionId,
    });
    if (error) {
      if (String(error.code || "") === "42501") throw new Error("DENIED");
      throw new Error("Lecture des communications indisponible.");
    }
    if (!data || !Array.isArray(data.items)) throw new Error("Réponse des communications invalide.");
    return data;
  }
  async function retrySupportOutboxEvent(sessionId, eventId, reason) {
    if (!sessionId || !eventId || String(reason || "").trim().length < 20) throw new Error("REASON_REQUIRED");
    if (!global.crypto || typeof global.crypto.randomUUID !== "function") throw new Error("IDEMPOTENCY_UNAVAILABLE");
    const { data, error } = await getClient().rpc("platform_support_retry_outbox_event_v1", {
      p_session: sessionId,
      p_event_id: eventId,
      p_reason: String(reason).trim(),
      p_idempotency_key: global.crypto.randomUUID(),
    });
    if (error) {
      if (String(error.code || "") === "42501") throw new Error("DENIED");
      if (String(error.code || "") === "55000") throw new Error("NOT_RETRYABLE");
      throw new Error("Impossible d’enregistrer le réessai.");
    }
    if (!data || data.status !== "pending") throw new Error("Résultat du réessai invalide.");
    return data;
  }
  function supportOutboxRetryAvailable(event) {
    return Boolean(event && event.status === "failed" && event.can_retry === true &&
      typeof event.event_id === "string" && event.event_id.length > 0);
  }
  async function revokeSupportSession(sessionId, reason) {
    const { data, error } = await getClient().rpc("platform_revoke_support_session", {
      p_session: sessionId,
      p_reason: String(reason || "Employee exited support mode"),
    });
    if (error || data !== true) throw new Error("Impossible de confirmer la révocation de la session.");
    return true;
  }
  function showSupportBanner(data) {
    const banner = el("platform-support-banner");
    const title = el("platform-support-title");
    const meta = el("platform-support-meta");
    const tenant = data.tenant;
    const session = data.session;
    if (title) title.textContent = `MODE SUPPORT — Vous consultez ${tenant.name}`;
    if (meta) meta.textContent = `Entré par ${session.employee} · Lecture seule · Expire le ${date(session.expires_at)} · Motif : ${session.reason}`;
    show(banner, true);
    show(el("platform-sidebar"), false);
    show(el("platform-support-nav"), true);
    if (el("platform-app")) el("platform-app").classList.add("support-active");
  }
  function scheduleSupportExpiry(data) {
    if (app.supportExpireTimer) global.clearTimeout(app.supportExpireTimer);
    const expiry = Date.parse(data.session.expires_at);
    const delay = Number.isFinite(expiry) ? Math.max(0, expiry - Date.now()) : 0;
    const sessionId = data.session.id;
    app.supportExpireTimer = global.setTimeout(() => {
      if (app.supportSessionId === sessionId) handleSupportSessionFailure(new Error("EXPIRED"));
    }, delay);
  }
  async function loadSupportSession(sessionId) {
    app.supportSessionId = sessionId;
    app.section = "support";
    clearContent();
    setFeedback("Vérification de la session support…");
    try {
      const data = await readSupportSession(sessionId);
      app.tenantSlug = data.tenant.slug;
      showSupportBanner(data);
      scheduleSupportExpiry(data);
      const activeSessionId = data.session.id;
      if (app.refreshTimer) global.clearInterval(app.refreshTimer);
      app.refreshTimer = global.setInterval(() => {
        if (app.supportSessionId === activeSessionId) readSupportSession(activeSessionId).catch((error) => handleSupportSessionFailure(error));
      }, 30000);
      const heading = el("section-title");
      if (heading) heading.textContent = "Mode support temporaire";
      await loadSupportWorkspace(app.supportView || "summary", app.supportReference, true);
      setFeedback(`Vue support vérifiée ${date(new Date().toISOString())} · STAGING`);
      show(el("platform-app"), true);
      show(el("platform-login"), false);
      show(el("platform-denied"), false);
      show(el("platform-sign-out"), true);
      app.authorized = true;
      return true;
    } catch (error) {
      clearContent();
      resetSupportMode();
      if (error && (error.message === "DENIED" || error.message === "EXPIRED")) {
        show(el("platform-app"), false);
        show(el("platform-login"), false);
        show(el("platform-denied"), true);
        setFeedback("La session support n’est plus valide. Les données du tenant ont été effacées.", true);
      }
      throw error;
    }
  }
  function resetSupportMode() {
    if (app.supportExpireTimer) global.clearTimeout(app.supportExpireTimer);
    app.supportExpireTimer = null;
    if (app.refreshTimer) global.clearInterval(app.refreshTimer);
    app.refreshTimer = null;
    clearStoredSupportSession();
    app.supportSessionId = null;
    app.pendingSupportTenant = null;
    app.supportView = "summary";
    app.supportReference = null;
    show(el("platform-support-banner"), false);
    show(el("platform-support-nav"), false);
    show(el("platform-sidebar"), true);
    if (el("platform-app")) el("platform-app").classList.remove("support-active");
  }
  async function endSupportMode() {
    const sessionId = app.supportSessionId;
    const tenantSlug = app.tenantSlug;
    if (!sessionId) return;
    setFeedback("Révocation de la session support…");
    await revokeSupportSession(sessionId, "Employee manually exited support mode");
    resetSupportMode();
    await loadSection("tenant", tenantSlug);
  }
  async function handleSupportSessionFailure(error) {
    resetSupportMode();
    const message = error && error.message === "EXPIRED" ? "La session support a expiré. Aucun accès tenant n’est conservé." : "La session support n’est plus autorisée. Aucun accès tenant n’est conservé.";
    await loadSection("overview");
    setFeedback(message, true);
  }
  function openSupportDialog(tenant) {
    app.pendingSupportTenant = { slug: tenant.slug, name: tenant.name };
    const name = el("support-entry-tenant");
    const reason = el("support-entry-reason");
    const feedback = el("support-entry-feedback");
    if (name) name.textContent = `Organisation ciblée : ${tenant.name}`;
    if (reason) reason.value = "";
    if (feedback) {
      feedback.textContent = "";
      feedback.classList.remove("error");
    }
    const dialog = el("support-entry-dialog");
    if (dialog && typeof dialog.showModal === "function") dialog.showModal();
  }
  async function submitSupportEntry(event) {
    event.preventDefault();
    const tenant = app.pendingSupportTenant;
    const reason = el("support-entry-reason");
    const output = el("support-entry-feedback");
    const submit = el("support-entry-submit");
    if (!tenant || !reason) return;
    if (submit) submit.disabled = true;
    if (output) {
      output.textContent = "Création et vérification de la session…";
      output.classList.remove("error");
    }
    let sessionId = null;
    try {
      sessionId = await openSupportSession(tenant.slug, reason.value);
      app.supportSessionId = sessionId;
      storeSupportSession(sessionId);
      const dialog = el("support-entry-dialog");
      if (dialog && typeof dialog.close === "function") dialog.close();
      await loadSupportSession(sessionId);
    } catch (error) {
      if (sessionId) {
        try {
          await revokeSupportSession(sessionId, "Support session could not be opened in the dashboard");
        } catch (_) {
          /* Session remains short-lived and server checks still fail closed. */
        }
      }
      resetSupportMode();
      const message = error && error.message === "DENIED" ? "Accès support refusé par le serveur." : error && error.message === "REASON_REQUIRED" ? "Saisissez un motif d’au moins 20 caractères." : (error && error.message) || "Impossible de démarrer le mode support.";
      if (output) {
        output.textContent = message;
        output.classList.add("error");
      }
    } finally {
      if (submit) submit.disabled = false;
    }
  }
  function clearContent() {
    const content = el("platform-content");
    if (content) content.replaceChildren();
  }
  function renderSupportWorkspace(section, data) {
    const target = el("platform-content");
    const nav = el("platform-support-nav");
    if (nav) nav.querySelectorAll("[data-support-section]").forEach((button) => button.classList.toggle("active", button.dataset.supportSection === section));
    const titlesBySection = {
      summary: "Résumé de l’organisation",
      reservations: "Réservations",
      reservation: "Détail de la réservation",
      customers: "Clients",
      equipment: "Matériel",
      communications: "Communications",
      issues: "Points à vérifier",
      audit: "Activité d’audit du tenant",
    };
    const heading = el("section-title");
    if (heading) heading.textContent = titlesBySection[section] || "Espace support";
    const readonly = make("p", "support-readonly", "Consultation seule · Données vérifiées par le serveur");
    target.append(readonly);
    if (section === "summary") {
      const org = data.organisation || {};
      const identity = panel(org.name || "Organisation");
      line(identity, "Slug", org.slug, org.status);
      line(identity, "Créée le", date(org.created_at));
      const counts = data.counts || {};
      metricGrid(target, [
        ["Personnel actif", counts.staff],
        ["Clients", counts.customers],
        ["Produits", counts.products],
        ["Équipements physiques", counts.machines],
        ["Réservations", counts.reservations],
      ]);
      target.prepend(identity);
      const config = panel("Configuration du service");
      const c = org.configuration || {};
      line(config, "Vitrine", c.storefront_configured ? "Configurée" : "Non configurée");
      line(config, "Suivi livraison", c.delivery_status_configured ? "Configuré" : "Non configuré");
      line(config, "Portail client", c.reservation_portal_configured ? "Configuré" : "Non configuré");
      line(config, "Fuseau / devise", `${c.timezone || "—"} · ${c.currency || "—"}`);
      target.append(config);
      const statuses = panel("États opérationnels", "half");
      Object.entries(data.reservation_statuses || {}).forEach(([key, value]) => line(statuses, `Réservations · ${key}`, `${value} enregistrements`));
      Object.entries(data.service_statuses || {}).forEach(([key, value]) => line(statuses, `Interventions · ${key}`, `${value} enregistrements`));
      target.append(statuses);
      renderSupportIssues(data.issues || { items: [] }, target);
      return;
    }
    if (section === "reservation") {
      const r = data;
      const card = panel(`Réservation ${r.reference || ""}`);
      line(card, "Client", r.customer_name);
      line(card, "État / paiement", `${r.status} · ${r.payment_status}`, r.status);
      line(card, "Location", `${date(r.rental_start)} → ${date(r.rental_end)}`);
      line(card, "Matériel / quantité", `${r.product || "—"} · ${r.quantity ?? "—"}`);
      line(card, "Montant total", `${r.total_amount ?? "—"} ${r.currency || "EUR"}`);
      line(card, "Livraison", r.delivery ? `${r.delivery.status} · ${r.delivery.scheduled_date || "—"} · ${r.delivery.time_slot || "—"}` : "Aucune intervention liée");
      line(card, "Collecte", r.collection ? `${r.collection.status} · ${r.collection.scheduled_date || "—"} · ${r.collection.time_slot || "—"}` : "Aucune intervention liée");
      line(card, "Allocation", r.allocation_status || "Aucune allocation active");
      target.append(card);
      return;
    }
    if (section === "reservations") {
      const card = panel("Réservations récentes");
      (data.items || []).forEach((r) => {
        const row = line(card, `${r.reference} · ${r.customer_name || "Client"}`, `${r.product || "—"} · ${date(r.rental_start)} → ${date(r.rental_end)} · ${r.total_amount ?? "—"} ${r.currency || "EUR"}`, r.payment_status);
        const sub = make("div", "row-meta", `Réservation ${r.status} · Livraison ${r.delivery_status || "—"} · Collecte ${r.collection_status || "—"} · Allocation ${r.allocation_status || "—"}`);
        row.querySelector(".row-main").append(sub);
        if ((r.exceptions || []).length) row.querySelector(".row-main").append(make("div", "row-meta", `À vérifier : ${r.exceptions.join(", ")}`));
        const open = make("button", "support-detail-button", "Voir le détail");
        open.type = "button";
        open.addEventListener("click", () => loadSupportWorkspace("reservation", r.reference));
        row.append(open);
      });
      if (!(data.items || []).length) card.append(make("p", "empty", "Aucune réservation."));
      target.append(card);
      return;
    }
    if (section === "customers") {
      const card = panel("Clients récents (coordonnées masquées en V1)");
      (data.items || []).forEach((c) => line(card, c.name || "Client", `${c.reservation_count} réservation(s) · récente : ${c.recent_reservation_status || "—"} ${c.recent_reservation_reference || ""}`));
      if (!(data.items || []).length) card.append(make("p", "empty", "Aucun client."));
      target.append(card);
      return;
    }
    if (section === "equipment") {
      const products = panel("Produits");
      (data.products || []).forEach((p) => line(products, p.name, `${p.type || "—"} · ${p.tier || "—"} · ${p.weekly_price} €/semaine`, p.active ? "active" : "inactive"));
      if (!(data.products || []).length) products.append(make("p", "empty", "Aucun produit."));
      target.append(products);
      const machines = panel("Équipements physiques");
      const machineRows = data.machines || [];
      const countsByStatus = machineRows.reduce((counts, machine) => {
        counts[machine.status] = (counts[machine.status] || 0) + 1;
        return counts;
      }, {});
      line(
        machines,
        `Répartition des équipements affichés (${machineRows.length}${machineRows.length === 200 ? "+" : ""})`,
        Object.entries(countsByStatus)
          .map(([state, count]) => `${state} : ${count}`)
          .join(" · ") || "Aucun équipement",
      );
      machineRows.forEach((m) => line(machines, `Équipement ${m.unit} · ${m.product}`, `État ${m.status} · condition ${m.condition || "—"} · actif ${m.active ? "oui" : "non"} · allocation ${m.allocation_status || "aucune"}${m.reservation_reference ? ` · réservation ${m.reservation_reference}` : ""}${m.unavailable_until ? ` · indisponible jusqu’au ${date(m.unavailable_until)}` : ""}`, m.status));
      if (!(data.machines || []).length) machines.append(make("p", "empty", "Aucun équipement."));
      target.append(machines);
      return;
    }
    if (section === "communications") {
      const actions = panel("ACTIONS DE SUPPORT");
      actions.append(make("p", "row-meta", "Seuls les événements en échec autorisés peuvent être remis en attente. Les données de réservation ne sont pas modifiées."));
      target.append(actions);
      const card = panel("Événements de communication récents");
      (data.items || []).forEach((e) => {
        const row = line(card, e.event_type, `Créé ${date(e.created_at)} · tentatives ${e.attempt_count} · dernière tentative ${date(e.last_attempt_at)}${e.error_code ? ` · code ${e.error_code}` : ""}`, e.status);
        if (!supportOutboxRetryAvailable(e)) return;
        const retry = make("button", "support-detail-button", "Réessayer");
        retry.type = "button";
        retry.addEventListener("click", () => {
          retry.disabled = true;
          const form = make("form", "support-retry-form");
          const label = make("label", "row-meta", "Motif obligatoire pour cette action de support (20 caractères minimum)");
          const reason = make("textarea", "support-retry-reason");
          reason.required = true;
          reason.minLength = 20;
          reason.maxLength = 500;
          reason.placeholder = "Ex. Retry failed confirmation email after provider outage";
          reason.addEventListener("input", () => reason.setCustomValidity(""));
          label.append(reason);
          const submit = make("button", "support-detail-button", "Confirmer le réessai");
          submit.type = "submit";
          const cancel = make("button", "support-secondary-button", "Annuler");
          cancel.type = "button";
          const result = make("p", "row-meta", "");
          cancel.addEventListener("click", () => { form.remove(); retry.disabled = false; });
          form.append(label, submit, cancel, result);
          form.addEventListener("submit", async (event) => {
            event.preventDefault();
            if (reason.value.trim().length < 20) { reason.setCustomValidity("Saisissez un motif d’au moins 20 caractères."); reason.reportValidity(); return; }
            submit.disabled = true;
            cancel.disabled = true;
            try {
              await retrySupportOutboxEvent(app.supportSessionId, e.event_id, reason.value);
              result.textContent = "Réessai enregistré : l’événement est de nouveau en attente.";
              retry.textContent = "Réessai enregistré";
            } catch (error) {
              if (error && (error.message === "DENIED" || error.message === "EXPIRED")) {
                await handleSupportSessionFailure(error);
                return;
              }
              result.textContent = error && error.message === "NOT_RETRYABLE"
                  ? "Cet événement n’est plus réessayable. Actualisez la liste."
                  : error && error.message === "IDEMPOTENCY_UNAVAILABLE"
                    ? "Le réessai est indisponible dans ce navigateur."
                    : error && error.message === "REASON_REQUIRED"
                      ? "Saisissez un motif d’au moins 20 caractères."
                      : "Le réessai n’a pas pu être enregistré.";
              result.classList.add("error");
              submit.disabled = false;
              cancel.disabled = false;
              retry.disabled = false;
            }
          });
          row.append(form);
          reason.focus();
        });
        row.append(retry);
      });
      if (!(data.items || []).length) card.append(make("p", "empty", "Aucun événement de communication."));
      target.append(card);
      return;
    }
    if (section === "issues") {
      renderSupportIssues(data, target);
      return;
    }
    if (section === "audit") {
      const card = panel("100 derniers événements (lecture seule)");
      (data.items || []).forEach((e) => line(card, `${e.event_type} · ${e.entity_type || "—"}`, `${e.actor_role || "—"} · ${e.source || "—"} · ${date(e.created_at)}`));
      if (!(data.items || []).length) card.append(make("p", "empty", "Aucun événement d’audit visible."));
      target.append(card);
    }
  }
  function renderSupportIssues(data, target) {
    const card = panel("Indicateurs dérivés · état canonique inchangé");
    card.classList.add("support-issue");
    const labelsByKey = {
      failed_outbox: "Événements de communication en échec",
      overdue_reservations: "Réservations potentiellement en retard",
      expired_holds: "Allocations held arrivées à expiration",
      payment_attention: "Réservations avec paiement à vérifier",
    };
    (data.items || []).forEach((issue) => line(card, labelsByKey[issue.key] || issue.key, `${issue.count} · ${issue.basis}`));
    if (!(data.items || []).length) card.append(make("p", "empty", "Aucun indicateur dérivé détecté par ces règles."));
    target.append(card);
  }
  async function loadSupportWorkspace(section, reference = null, sessionAlreadyVerified = false) {
    const sessionId = app.supportSessionId;
    if (!sessionId) throw new Error("DENIED");
    try {
      if (!sessionAlreadyVerified) await readSupportSession(sessionId);
      const data = section === "communications"
        ? await readSupportOutboxCandidates(sessionId)
        : await readSupportWorkspace(sessionId, section, reference);
      if (section === "summary") data.issues = await readSupportWorkspace(sessionId, "issues");
      clearContent();
      renderSupportWorkspace(section, data);
      app.section = `support:${section}`;
      app.supportView = section;
      app.supportReference = reference;
      setFeedback(`Vue support vérifiée ${date(new Date().toISOString())} · STAGING`);
      return true;
    } catch (error) {
      clearContent();
      if (sessionAlreadyVerified) throw error;
      await handleSupportSessionFailure(error);
      return false;
    }
  }
  function renderOverview(data) {
    const target = el("platform-content");
    const org = data.organisations || {};
    metricGrid(target, [
      ["Organisations", org.total],
      ["Organisations actives", org.active],
      ["Organisations suspendues", org.suspended],
      ["Employés plateforme actifs", data.active_platform_employees],
    ]);
    const jobs = data.jobs || {};
    const activity = panel("Activité récente", "half");
    (data.recent_audit || []).forEach((event) => line(activity, event.action, `${actorLabel(event)} · ${event.target_type || "—"} · ${date(event.created_at)}`, event.outcome));
    if (!(data.recent_audit || []).length) activity.append(make("p", "empty", "Aucune activité visible avec vos permissions."));
    target.append(activity);
    const queue = panel("Files de notifications plateforme", "half");
    line(queue, "En attente", jobs.pending_notifications ?? "—");
    line(queue, "En échec", jobs.failed_notifications ?? "—");
    target.append(queue);
  }
  function renderTenants(data) {
    const target = el("platform-content");
    const card = panel("Annuaire des organisations");
    (data.tenants || []).forEach((tenant) => {
      const row = make("div", "row");
      const main = make("div", "row-main");
      const button = make("button", "tenant-link", tenant.name);
      button.type = "button";
      button.addEventListener("click", () => loadSection("tenant", tenant.slug));
      main.append(button, make("div", "row-meta", `${tenant.slug} · créée le ${date(tenant.created_at)}`));
      main.append(make("div", "row-meta", `${tenant.staff_count} employés · ${tenant.customer_count} clients · ${tenant.reservation_count} réservations · ${tenant.product_count} produits`));
      row.append(main, status(tenant.status));
      card.append(row);
    });
    if (!(data.tenants || []).length) card.append(make("p", "empty", "Aucune organisation."));
    target.append(card);
  }
  async function renderTenant(data, supportMode = false) {
    const target = el("platform-content");
    const head = panel("");
    const headTitle = head.querySelector("h2");
    headTitle.textContent = "";
    const headLine = make("div", "detail-head");
    const back = make("button", "back-button", "← Organisations");
    back.type = "button";
    back.addEventListener("click", () => loadSection("tenants"));
    if (supportMode) back.hidden = true;
    headLine.append(back, make("h2", "", data.name));
    head.append(headLine, status(data.status), make("p", "row-meta", `${data.slug} · créée le ${date(data.created_at)}`));
    target.append(head);
    const config = panel("Configuration", "half");
    const c = data.configuration || {};
    line(config, "Storefront", c.storefront_configured ? "Configuré" : "Non configuré");
    line(config, "Suivi de livraison", c.delivery_status_configured ? "Configuré" : "Non configuré");
    line(config, "Portail client", c.reservation_portal_configured ? "Configuré" : "Non configuré");
    line(config, "Fuseau / devise", `${c.timezone || "—"} · ${c.currency || "—"}`);
    target.append(config);
    const counts = panel("Activité opérationnelle", "half");
    line(counts, "Personnel actif", data.staff && data.staff.active);
    line(counts, "Personnel inactif", data.staff && data.staff.inactive);
    line(counts, "Clients / produits / \u00e9quipements", `${data.customers ?? 0} / ${data.products ?? 0} / ${data.machines ?? 0}`);
    line(counts, "Incidents ouverts", data.open_incidents ?? 0);
    target.append(counts);
    renderMap(target, "Réservations par état", data.reservations);
    renderMap(target, "Interventions par état", data.service_jobs);
    const incidents = panel("Incidents récents");
    (data.recent_incidents || []).forEach((incident) => line(incidents, `${incident.category} · ${incident.severity}`, date(incident.created_at), incident.status));
    if (!(data.recent_incidents || []).length) incidents.append(make("p", "empty", "Aucun incident ouvert récent."));
    target.append(incidents);
    if (!supportMode) {
      const support = panel("Accès support temporaire");
      support.append(make("p", "muted", "La session est limitée à cette organisation, en lecture seule, et expire automatiquement après 30 minutes."));
      const enter = make("button", "support-entry-button", "Entrer en mode support");
      enter.type = "button";
      enter.hidden = true;
      enter.addEventListener("click", () => openSupportDialog(data));
      support.append(enter);
      const permission = await getClient().rpc("platform_has_permission", {
        p_permission: "platform.support.enter_tenant",
      });
      if (!permission.error && permission.data === true) show(enter, true);
      else support.append(make("p", "row-meta", "Votre compte ne dispose pas de la permission d’accès support."));
      target.append(support);
    }
  }
  function renderMap(target, title, object) {
    const card = panel(title, "half");
    const entries = Object.entries(object || {});
    entries.forEach(([key, value]) => line(card, key, `${value} enregistrements`));
    if (!entries.length) card.append(make("p", "empty", "Aucune donnée."));
    target.append(card);
  }
  function renderEmployees(data) {
    const target = el("platform-content");
    (data.employees || []).forEach((employee) => {
      const card = panel(employee.email);
      line(card, "Statut", `Créé le ${date(employee.created_at)} · mis à jour le ${date(employee.updated_at)}`, employee.status);
      line(card, "Autorité propriétaire", employee.owner_authority ? "Présente" : "Absente");
      card.append(make("h3", "row-title", "Rôles"));
      tags(
        card,
        (employee.roles || []).map((role) => `${role.name} (${role.key})`),
      );
      card.append(make("h3", "row-title", "Permissions effectives"));
      tags(card, employee.effective_permissions || []);
      target.append(card);
    });
    if (!(data.employees || []).length) target.append(make("p", "empty", "Aucun employé plateforme."));
  }
  function renderRoles(data) {
    const target = el("platform-content");
    (data.roles || []).forEach((role) => {
      const card = panel(role.name, "half");
      line(card, role.key, `${role.description} · ${role.assigned_employee_count} employés assignés`, role.active ? "active" : "inactive");
      (role.permissions || []).forEach((permission) => {
        const risk = permission.risk === "critical" ? "CRITIQUE" : permission.risk === "high" ? "ÉLEVÉ" : permission.risk === "medium" ? "MOYEN" : "FAIBLE";
        line(card, permission.key, `${permission.description} · risque ${risk} · approbations requises: ${permission.required_approvals}`);
      });
      target.append(card);
    });
  }
  function renderAudit(data) {
    const target = el("platform-content");
    const card = panel("100 derniers événements (consultation seule)");
    (data.events || []).forEach((event) => line(card, `${event.action} · ${event.target_type}${event.target_id ? ` · ${event.target_id}` : ""}`, `${actorLabel(event)} · ${event.permission || "système"} · ${event.tenant || "global"} · ${event.reason} · ${date(event.created_at)}`, event.outcome));
    if (!(data.events || []).length) card.append(make("p", "empty", "Aucun événement d’audit."));
    target.append(card);
  }
  function actorLabel(event) {
    if (event.actor === "Unavailable" && String(event.action || "").startsWith("platform.owner.bootstrap")) return "Bootstrap";
    return event.actor || "Unavailable";
  }
  function renderApprovals(data) {
    const target = el("platform-content");
    const card = panel("Demandes récentes (consultation seule)");
    (data.requests || []).forEach((request) => {
      const approvals = (request.approvals || []).map((approval) => `${approval.approver}: ${approval.decision}`).join(" · ");
      line(card, `${request.action} · ${request.target_type} · ${request.target}`, `${request.requester} · ${request.tenant || "global"} · ${request.reason} · ${request.approval_count}/${request.required_approvals} approbations${approvals ? ` · ${approvals}` : ""} · ${date(request.created_at)}`, request.status);
    });
    if (!(data.requests || []).length) card.append(make("p", "empty", "Aucune demande de gouvernance."));
    target.append(card);
  }
  const renderers = {
    overview: renderOverview,
    tenants: renderTenants,
    tenant: renderTenant,
    employees: renderEmployees,
    roles: renderRoles,
    audit: renderAudit,
    approvals: renderApprovals,
  };
  async function loadSection(section, slug = null) {
    if (app.supportSessionId) return loadSupportSession(app.supportSessionId);
    app.section = section;
    app.tenantSlug = slug;
    const title = el("section-title");
    if (title) title.textContent = titles[section] || titles.overview;
    global.document.querySelectorAll("[data-section]").forEach((button) => button.classList.toggle("active", button.dataset.section === section));
    setFeedback("Chargement…");
    try {
      await verifyIdentity();
      const result = await read(section, slug);
      app.authorized = true;
      clearContent();
      await (renderers[section] || renderOverview)(result);
      setFeedback(`Mis à jour ${date(new Date().toISOString())} · STAGING`);
      show(el("platform-app"), true);
      show(el("platform-login"), false);
      show(el("platform-denied"), false);
      show(el("platform-sign-out"), true);
      if (!app.refreshTimer)
        app.refreshTimer = global.setInterval(() => {
          if (app.authorized) loadSection(app.section, app.tenantSlug);
        }, 45000);
    } catch (error) {
      clearContent();
      app.authorized = false;
      if (app.refreshTimer) global.clearInterval(app.refreshTimer);
      app.refreshTimer = null;
      if (error && error.message === "DENIED") {
        show(el("platform-app"), false);
        show(el("platform-login"), false);
        show(el("platform-denied"), true);
      } else if (error && error.message === "AUTH_REQUIRED") {
        app.client && app.client.auth.signOut({ scope: "local" }).catch(() => {});
        show(el("platform-app"), false);
        show(el("platform-login"), true);
        setFeedback("Connectez-vous avec un compte staging vérifié.", true);
      } else setFeedback(error && error.message === "Configuration staging indisponible." ? error.message : "Impossible de vérifier l’accès plateforme. Réessayez.", true);
    }
  }
  async function signOut() {
    if (app.supportSessionId) {
      try {
        await revokeSupportSession(app.supportSessionId, "Employee signed out while support mode was active");
      } catch (_) {
        /* The server-side expiry still limits any unrevoked session. */
      }
    }
    resetSupportMode();
    if (app.client) await app.client.auth.signOut({ scope: "local" }).catch(() => {});
    app.authorized = false;
    if (app.refreshTimer) global.clearInterval(app.refreshTimer);
    app.refreshTimer = null;
    clearContent();
    show(el("platform-app"), false);
    show(el("platform-denied"), false);
    show(el("platform-login"), true);
    show(el("platform-sign-out"), false);
    setFeedback("");
  }
  async function submitLogin(event) {
    event.preventDefault();
    const output = el("platform-login-status");
    if (output) output.textContent = "Connexion et vérification des droits…";
    try {
      const config = configuration();
      if (!config) throw new Error("Cette interface est disponible uniquement sur le staging.");
      const { error } = await getClient().auth.signInWithPassword({
        email: el("platform-email").value.trim(),
        password: el("platform-password").value,
      });
      if (error) throw new Error("Connexion impossible. Vérifiez vos identifiants staging.");
      await verifyIdentity();
      await loadSection("overview");
      if (app.authorized) {
        el("platform-login-form").reset();
        if (output) output.textContent = "";
      }
    } catch (error) {
      if (output) {
        output.textContent = (error && error.message) || "Connexion indisponible.";
        output.classList.add("error");
      }
    }
  }
  function initialize() {
    if (!global.document) return;
    const form = el("platform-login-form");
    if (!form) return;
    form.addEventListener("submit", submitLogin);
    el("platform-sign-out").addEventListener("click", signOut);
    el("platform-denied-sign-out").addEventListener("click", signOut);
    el("platform-refresh").addEventListener("click", async () => {
      if (app.supportSessionId) {
        try {
          await loadSupportSession(app.supportSessionId);
        } catch (error) {
          await handleSupportSessionFailure(error);
        }
      } else loadSection(app.section, app.tenantSlug);
    });
    el("support-entry-form").addEventListener("submit", submitSupportEntry);
    el("support-entry-cancel").addEventListener("click", () => {
      const dialog = el("support-entry-dialog");
      if (dialog && typeof dialog.close === "function") dialog.close();
      app.pendingSupportTenant = null;
    });
    el("platform-support-exit").addEventListener("click", async () => {
      try {
        await endSupportMode();
      } catch (error) {
        setFeedback((error && error.message) || "Impossible de révoquer la session support.", true);
      }
    });
    el("platform-support-nav")
      .querySelectorAll("[data-support-section]")
      .forEach((button) =>
        button.addEventListener("click", () => {
          loadSupportWorkspace(button.dataset.supportSection).catch((error) => handleSupportSessionFailure(error));
        }),
      );
    global.document.querySelectorAll("[data-section]").forEach((button) => button.addEventListener("click", () => loadSection(button.dataset.section)));
    const config = configuration();
    if (!config) {
      form.querySelector("button[type=submit]").disabled = true;
      el("platform-login-status").textContent = "Cette interface de contrôle est disponible uniquement sur le staging.";
      return;
    }
    getClient()
      .auth.getSession()
      .then(async ({ data, error }) => {
        if (!error && data && data.session) {
          const sessionId = storedSupportSession();
          if (sessionId) {
            app.supportSessionId = sessionId;
            try {
              await loadSupportSession(sessionId);
            } catch (failure) {
              if (failure && (failure.message === "EXPIRED" || failure.message === "DENIED")) await handleSupportSessionFailure(failure);
              else setFeedback("La session support ne peut pas être vérifiée. Actualisez pour réessayer.", true);
            }
          } else loadSection("overview");
        }
      })
      .catch(() => {});
  }
  const api = Object.freeze({
    configuration,
    read,
    openSupportSession,
    readSupportSession,
    readSupportWorkspace,
    readSupportOutboxCandidates,
    retrySupportOutboxEvent,
    supportOutboxRetryAvailable,
    revokeSupportSession,
    loadSupportSession,
    loadSupportWorkspace,
    loadSection,
    renderers,
    signOut,
  });
  global.IgPlatformAdmin = api;
  if (global.document) {
    if (global.document.readyState === "loading")
      global.document.addEventListener("DOMContentLoaded", initialize, {
        once: true,
      });
    else initialize();
  }
})(window);
