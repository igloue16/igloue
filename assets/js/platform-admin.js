(function installPlatformAdmin(global) {
  "use strict";

  const titles = { overview: "Vue d’ensemble", tenants: "Organisations", tenant: "Fiche organisation", employees: "Employés plateforme", roles: "Rôles et permissions", audit: "Audit plateforme", approvals: "Demandes de gouvernance" };
  const labels = { active: "ACTIF", inactive: "INACTIF", suspended: "SUSPENDU", revoked: "RÉVOQUÉ", pending: "EN ATTENTE", approved: "APPROUVÉ", rejected: "REFUSÉ", expired: "EXPIRÉ", failed: "ÉCHEC", resolved: "RÉSOLU", dismissed: "CLOS", success: "SUCCÈS", applied: "APPLIQUÉ" };
  const app = { client: null, section: "overview", tenantSlug: null, refreshTimer: null, authorized: false };

  function el(id) { return global.document && global.document.getElementById(id); }
  function make(tag, className, text) {
    const node = global.document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }
  function show(node, visible) { if (node) node.hidden = !visible; }
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
    return Number.isNaN(parsed.getTime()) ? "—" : new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
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
      auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: false }
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
    const { data, error } = await db.rpc("platform_control_plane_read_v1", { p_section: section, p_slug: slug || null });
    if (error) {
      const code = String(error.code || "");
      if (code === "42501" || /access denied|permission/i.test(String(error.message || ""))) throw new Error("DENIED");
      throw new Error("Lecture plateforme indisponible.");
    }
    if (!data || typeof data !== "object") throw new Error("Réponse plateforme invalide.");
    return data;
  }
  function clearContent() {
    const content = el("platform-content");
    if (content) content.replaceChildren();
  }
  function renderOverview(data) {
    const target = el("platform-content");
    const org = data.organisations || {};
    metricGrid(target, [["Organisations", org.total], ["Organisations actives", org.active], ["Organisations suspendues", org.suspended], ["Employés plateforme actifs", data.active_platform_employees]]);
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
  function renderTenant(data) {
    const target = el("platform-content");
    const head = panel("");
    const headTitle = head.querySelector("h2");
    headTitle.textContent = "";
    const headLine = make("div", "detail-head");
    const back = make("button", "back-button", "← Organisations");
    back.type = "button";
    back.addEventListener("click", () => loadSection("tenants"));
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
    line(counts, "Clients / produits / machines", `${data.customers ?? 0} / ${data.products ?? 0} / ${data.machines ?? 0}`);
    line(counts, "Incidents ouverts", data.open_incidents ?? 0);
    target.append(counts);
    renderMap(target, "Réservations par état", data.reservations);
    renderMap(target, "Interventions par état", data.service_jobs);
    const incidents = panel("Incidents récents");
    (data.recent_incidents || []).forEach((incident) => line(incidents, `${incident.category} · ${incident.severity}`, date(incident.created_at), incident.status));
    if (!(data.recent_incidents || []).length) incidents.append(make("p", "empty", "Aucun incident ouvert récent."));
    target.append(incidents);
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
      tags(card, (employee.roles || []).map((role) => `${role.name} (${role.key})`));
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
    (data.events || []).forEach((event) => line(card, `${event.action} · ${event.target_type}${event.target_id ? ` · ${event.target_id}` : ""}`,
      `${actorLabel(event)} · ${event.permission || "système"} · ${event.tenant || "global"} · ${event.reason} · ${date(event.created_at)}`, event.outcome));
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
  const renderers = { overview: renderOverview, tenants: renderTenants, tenant: renderTenant, employees: renderEmployees, roles: renderRoles, audit: renderAudit, approvals: renderApprovals };
  async function loadSection(section, slug = null) {
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
      (renderers[section] || renderOverview)(result);
      setFeedback(`Mis à jour ${date(new Date().toISOString())} · STAGING`);
      show(el("platform-app"), true);
      show(el("platform-login"), false);
      show(el("platform-denied"), false);
      show(el("platform-sign-out"), true);
      if (!app.refreshTimer) app.refreshTimer = global.setInterval(() => { if (app.authorized) loadSection(app.section, app.tenantSlug); }, 45000);
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
        email: el("platform-email").value.trim(), password: el("platform-password").value
      });
      if (error) throw new Error("Connexion impossible. Vérifiez vos identifiants staging.");
      await verifyIdentity();
      await loadSection("overview");
      if (app.authorized) {
        el("platform-login-form").reset();
        if (output) output.textContent = "";
      }
    } catch (error) {
      if (output) { output.textContent = error && error.message || "Connexion indisponible."; output.classList.add("error"); }
    }
  }
  function initialize() {
    if (!global.document) return;
    const form = el("platform-login-form");
    if (!form) return;
    form.addEventListener("submit", submitLogin);
    el("platform-sign-out").addEventListener("click", signOut);
    el("platform-denied-sign-out").addEventListener("click", signOut);
    el("platform-refresh").addEventListener("click", () => loadSection(app.section, app.tenantSlug));
    global.document.querySelectorAll("[data-section]").forEach((button) => button.addEventListener("click", () => loadSection(button.dataset.section)));
    const config = configuration();
    if (!config) {
      form.querySelector("button[type=submit]").disabled = true;
      el("platform-login-status").textContent = "Cette interface de contrôle est disponible uniquement sur le staging.";
      return;
    }
    getClient().auth.getSession().then(({ data, error }) => {
      if (!error && data && data.session) loadSection("overview");
    }).catch(() => {});
  }

  const api = Object.freeze({ configuration, read, loadSection, renderers, signOut });
  global.IgPlatformAdmin = api;
  if (global.document) {
    if (global.document.readyState === "loading") global.document.addEventListener("DOMContentLoaded", initialize, { once: true });
    else initialize();
  }
})(window);
