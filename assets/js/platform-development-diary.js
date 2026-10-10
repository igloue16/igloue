(function installPlatformDevelopmentDiary(global) {
  "use strict";
  const labels = {
    category: { bug: "Bug", security: "Sécurité", improvement: "Amélioration", performance: "Performance", ui: "Interface" },
    severity: { critical: "Critique", high: "Élevée", medium: "Moyenne", low: "Faible" },
    status: { open: "Ouvert", investigating: "En cours d’analyse", fixing: "Correction en cours", testing: "En test", resolved: "Résolu", closed: "Clos" },
  };
  const el = (tag, className, text) => {
    const node = global.document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  };
  const options = (select, entries, value) => entries.forEach(([key, label]) => {
    const option = el("option", "", label); option.value = key; option.selected = key === value; select.append(option);
  });
  function inputField(parent, name, labelText, value, opts = {}) {
    const label = el("label", "diary-field", labelText);
    let control;
    if (opts.choices) {
      control = el("select", "diary-input"); control.name = name; options(control, opts.choices, value);
    } else if (opts.tenants) {
      control = el("select", "diary-input diary-tenant-select"); control.name = name; control.multiple = true; control.size = Math.min(6, Math.max(3, opts.tenants.length));
      const selected = new Set(Array.isArray(value) ? value : []);
      options(control, opts.tenants.map((item) => [item.slug, item.name]), null);
      for (const option of control.options) option.selected = selected.has(option.value);
      label.append(el("small", "diary-help", "Aucune sélection correspond à un ticket plateforme. Ctrl/Cmd permet plusieurs organisations."));
    } else {
      control = el(opts.multiline ? "textarea" : "input", "diary-input"); control.name = name;
      if (opts.multiline) control.rows = opts.rows || 3;
      else control.type = opts.type || "text";
      if (opts.required) control.required = true;
      if (opts.maxLength) control.maxLength = opts.maxLength;
      if (opts.type === "datetime-local") control.value = localDateInput(value);
      else control.value = value == null ? "" : String(value);
    }
    label.append(control); parent.append(label); return control;
  }
  function button(text, className, handler, type = "button") {
    const node = el("button", className, text); node.type = type;
    if (handler) node.addEventListener("click", handler);
    return node;
  }
  function date(value) {
    if (!value) return "—";
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? "—" : new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
  }
  function localDateInput(value) {
    const parsed = value ? new Date(value) : new Date();
    if (Number.isNaN(parsed.getTime())) return "";
    const pad = (part) => String(part).padStart(2, "0");
    return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
  }
  function activityLine(parent, title, detail, when) {
    const row = el("article", "diary-timeline-entry");
    row.append(el("strong", "", title), el("time", "row-meta", date(when)));
    if (detail) row.append(el("p", "diary-timeline-detail", detail));
    parent.append(row);
  }
  function renderList(target, data, api) {
    const heading = el("section", "panel diary-dashboard");
    heading.append(el("h2", "", "Journal de développement"));
    const toolbar = el("div", "diary-toolbar");
    toolbar.append(button("Nouveau ticket", "primary-button", () => api.startDevelopmentDiaryIssue()));
    const exportButton = button("Exporter Excel (.xlsx)", "quiet-button", async () => {
      exportButton.disabled = true;
      try {
        const bytes = await api.exportDevelopmentDiary();
        const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
        const objectUrl = global.URL.createObjectURL(blob); const link = el("a", "diary-download-link", "Télécharger le classeur Excel");
        link.href = objectUrl; link.download = `igloue-development-diary-${new Date().toISOString().slice(0, 10)}.xlsx`;
        heading.prepend(link); link.click(); global.setTimeout(() => global.URL.revokeObjectURL(objectUrl), 30000);
      } catch (error) { api.setFeedback(error.message || "Export refusé ou indisponible.", true); }
      finally { exportButton.disabled = false; }
    });
    toolbar.append(exportButton, el("span", "diary-count", `${data.total} ticket(s)`)); heading.append(toolbar);

    const filters = el("form", "diary-filter-form");
    inputField(filters, "search", "Rechercher par référence, titre, description ou liens", api.diaryFilter().search, { maxLength: 160 });
    inputField(filters, "tenant_slug", "Organisation", api.diaryFilter().tenant_slug, { choices: [["all", "Toutes les organisations"], ["platform", "Plateforme uniquement"], ...data.tenants.map((x) => [x.slug, x.name])] });
    inputField(filters, "status", "Statut", api.diaryFilter().status, { choices: [["all", "Tous les statuts"], ...Object.entries(labels.status)] });
    inputField(filters, "category", "Catégorie", api.diaryFilter().category, { choices: [["all", "Toutes les catégories"], ...Object.entries(labels.category)] });
    inputField(filters, "severity", "Gravité", api.diaryFilter().severity, { choices: [["all", "Toutes les gravités"], ...Object.entries(labels.severity)] });
    inputField(filters, "sort_by", "Trier par", api.diaryFilter().sort_by, { choices: [["activity", "Activité récente"], ["observed", "Date observée"], ["severity", "Gravité"], ["created", "Création"]] });
    inputField(filters, "sort_direction", "Ordre", api.diaryFilter().sort_direction, { choices: [["desc", "Décroissant"], ["asc", "Croissant"]] });
    filters.append(button("Appliquer les filtres", "quiet-button", null, "submit"));
    filters.addEventListener("submit", (event) => {
      event.preventDefault(); const values = new FormData(filters);
      api.setDevelopmentDiaryFilter({ search: String(values.get("search") || "").trim(), tenant_slug: String(values.get("tenant_slug") || "all"),
        status: String(values.get("status") || "all"), category: String(values.get("category") || "all"), severity: String(values.get("severity") || "all"),
        sort_by: String(values.get("sort_by") || "activity"), sort_direction: String(values.get("sort_direction") || "desc"), page: 1 })
        .catch(() => api.setFeedback("Lecture du journal indisponible.", true));
    });
    heading.append(filters);

    const rows = el("div", "diary-issue-list");
    if (!data.issues.length) rows.append(el("p", "empty", "Aucun ticket ne correspond à ces filtres."));
    data.issues.forEach((issue) => {
      const row = button("", "diary-issue-row", () => api.openDevelopmentDiaryIssue(issue.reference).catch(() => api.setFeedback("Impossible d’ouvrir ce ticket.", true)));
      const content = el("span", "diary-issue-main");
      content.append(el("strong", "diary-issue-ref", issue.reference), el("span", "diary-issue-title", issue.title));
      const tenants = (issue.tenants || []).map((tenant) => tenant.name).join(", ") || "Plateforme";
      content.append(el("small", "diary-help", `${tenants} · ${labels.category[issue.category] || issue.category} · ${date(issue.updated_at)}`));
      const badges = el("span", "diary-issue-tags"); badges.append(el("span", `status ${issue.severity}`, labels.severity[issue.severity] || issue.severity), el("span", `status ${issue.status}`, labels.status[issue.status] || issue.status));
      row.append(content, badges); rows.append(row);
    });
    heading.append(rows);
    const page = api.diaryFilter().page; const pages = Math.max(1, Math.ceil(data.total / data.page_size));
    const pager = el("div", "diary-pager");
    const prior = button("Page précédente", "quiet-button", () => api.setDevelopmentDiaryFilter({ page: Math.max(1, page - 1) })); prior.disabled = page <= 1;
    const next = button("Page suivante", "quiet-button", () => api.setDevelopmentDiaryFilter({ page: Math.min(pages, page + 1) })); next.disabled = page >= pages;
    pager.append(prior, el("span", "diary-count", `Page ${page} sur ${pages}`), next); heading.append(pager); target.append(heading);
  }
  function renderDetail(target, issue, tenantOptions, isNew, api) {
    const panel = el("section", "panel diary-detail");
    panel.append(button("← Retour aux tickets", "quiet-button", () => api.closeDevelopmentDiaryIssue()));
    panel.append(el("h2", "", isNew ? "Nouveau ticket" : `${issue.reference} · ${issue.title}`));
    const form = el("form", "diary-ticket-form"); const fields = el("div", "diary-form-grid"); form.append(fields);
    const related = (issue.related || []).map((x) => x.reference).join(", ");
    inputField(fields, "title", "Titre", issue.title, { required: true, maxLength: 240 });
    inputField(fields, "component", "Composant / zone concernée", issue.component, { required: true, maxLength: 160 });
    inputField(fields, "category", "Catégorie", issue.category || "bug", { choices: Object.entries(labels.category) });
    inputField(fields, "severity", "Gravité", issue.severity || "medium", { choices: Object.entries(labels.severity) });
    inputField(fields, "status", "Statut", issue.status || "open", { choices: Object.entries(labels.status) });
    inputField(fields, "first_observed_at", "Première observation", issue.first_observed_at || new Date().toISOString(), { type: "datetime-local", required: true });
    inputField(fields, "description", "Description détaillée", issue.description, { multiline: true, rows: 4, required: true, maxLength: 12000 });
    inputField(fields, "reproduction_steps", "Étapes de reproduction", issue.reproduction_steps, { multiline: true, rows: 3, maxLength: 8000 });
    inputField(fields, "expected_behavior", "Comportement attendu", issue.expected_behavior, { multiline: true, maxLength: 6000 });
    inputField(fields, "actual_behavior", "Comportement constaté", issue.actual_behavior, { multiline: true, maxLength: 6000 });
    inputField(fields, "fix_description", "Description de la correction", issue.fix_description, { multiline: true, rows: 3, maxLength: 8000 });
    inputField(fields, "fixed_at", "Date de correction", issue.fixed_at, { type: "datetime-local" });
    inputField(fields, "release_version", "Version / release", issue.release_version, { maxLength: 120 });
    inputField(fields, "deployment_stage", "Étape de déploiement", issue.deployment_stage || "not_released", { choices: [["not_released", "Non publié"], ["staging", "Staging"], ["production", "Production"]] });
    inputField(fields, "deployed_at", "Date de déploiement", issue.deployed_at, { type: "datetime-local" });
    inputField(fields, "verified_at", "Date de vérification réussie", issue.verified_at, { type: "datetime-local" });
    inputField(fields, "github_references", "Liens GitHub (un par ligne)", (issue.github_references || []).join("\n"), { multiline: true, rows: 2, help: "Liens du dépôt igloue16 uniquement." });
    inputField(fields, "tenant_slugs", "Organisations concernées", (issue.tenants || []).map((x) => x.slug), { tenants: tenantOptions });
    inputField(fields, "related_refs", "Tickets associés", related, { help: "Références BUG-… séparées par des virgules." });
    const feedback = el("p", "diary-action-message"); feedback.setAttribute("role", "status"); feedback.setAttribute("aria-live", "polite");
    const save = button(isNew ? "Créer le ticket" : "Enregistrer les modifications", "primary-button", null, "submit"); form.append(save, feedback);
    form.addEventListener("submit", async (event) => {
      event.preventDefault(); if (save.disabled) return; save.disabled = true; feedback.textContent = "Enregistrement…";
      const values = new FormData(form); const timestamp = (name) => { const value = String(values.get(name) || ""); return value ? new Date(value).toISOString() : null; };
      const payload = { title: String(values.get("title") || "").trim(), component: String(values.get("component") || "").trim(),
        category: String(values.get("category") || ""), severity: String(values.get("severity") || ""), status: String(values.get("status") || "open"),
        first_observed_at: timestamp("first_observed_at"), description: String(values.get("description") || "").trim(),
        reproduction_steps: String(values.get("reproduction_steps") || ""), expected_behavior: String(values.get("expected_behavior") || ""),
        actual_behavior: String(values.get("actual_behavior") || ""), fix_description: String(values.get("fix_description") || ""), fixed_at: timestamp("fixed_at"),
        release_version: String(values.get("release_version") || ""), deployment_stage: String(values.get("deployment_stage") || "not_released"),
        deployed_at: timestamp("deployed_at"), verified_at: timestamp("verified_at"),
        github_references: String(values.get("github_references") || "").split(/[\s,]+/).map((x) => x.trim()).filter(Boolean),
        tenant_slugs: Array.from(form.elements.namedItem("tenant_slugs").selectedOptions).map((x) => x.value),
        related_refs: String(values.get("related_refs") || "").split(/[\s,]+/).map((x) => x.trim().toUpperCase()).filter(Boolean) };
      try { const result = await api.saveDevelopmentDiaryIssue(isNew ? null : issue.reference, payload); await api.openDevelopmentDiaryIssue(result.reference); }
      catch (error) { feedback.textContent = error.message || "Ticket non enregistré."; feedback.classList.add("error"); save.disabled = false; }
    });
    panel.append(form);
    if (!isNew) renderExistingDetails(panel, issue, api, feedback);
    target.append(panel);
  }
  function renderExistingDetails(panel, issue, api, feedback) {
    const comments = el("section", "diary-subpanel"); comments.append(el("h3", "", `Commentaires (${issue.comments.length})`));
    issue.comments.forEach((comment) => activityLine(comments, comment.author || "Employé plateforme", comment.body, comment.created_at));
    if (!issue.comments.length) comments.append(el("p", "empty", "Aucun commentaire."));
    const commentForm = el("form", "diary-comment-form"); const comment = inputField(commentForm, "body", "Ajouter un commentaire daté", "", { multiline: true, required: true, maxLength: 8000 });
    const add = button("Ajouter le commentaire", "quiet-button", null, "submit"); commentForm.append(add);
    commentForm.addEventListener("submit", async (event) => { event.preventDefault(); if (add.disabled) return; add.disabled = true; feedback.textContent = "Ajout du commentaire…";
      try { await api.addDevelopmentDiaryComment(issue.reference, comment.value); await api.openDevelopmentDiaryIssue(issue.reference); }
      catch (error) { feedback.textContent = error.message || "Commentaire non enregistré."; add.disabled = false; }
    }); comments.append(commentForm); panel.append(comments);

    const attachments = el("section", "diary-subpanel"); attachments.append(el("h3", "", `Pièces jointes privées (${issue.attachments.length})`));
    issue.attachments.forEach((file) => {
      const row = el("article", "diary-attachment"); row.append(el("strong", "", file.filename), el("span", "row-meta", `${file.media_type} · ${Math.ceil(file.byte_size / 1024)} Ko · SHA-256 ${file.sha256}`));
      const open = button("Préparer le téléchargement sécurisé", "support-secondary-button", async () => {
        open.disabled = true; feedback.textContent = "Vérification de l’accès au fichier…";
        try { const url = await api.getDevelopmentDiaryAttachmentUrl(file.id); const link = el("a", "diary-download-link", "Ouvrir le fichier (lien temporaire, 60 s)");
          link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer"; row.append(link); feedback.textContent = "Accès autorisé. Le lien expire dans une minute."; }
        catch (error) { feedback.textContent = error.message || "Fichier indisponible."; open.disabled = false; }
      }); row.append(open); attachments.append(row);
    });
    const uploadForm = el("form", "diary-upload-form"); const label = el("label", "diary-field", "Ajouter une capture ou une pièce justificative privée");
    const file = el("input", "diary-input"); file.type = "file"; file.name = "file"; file.accept = ".png,.jpg,.jpeg,.pdf,image/png,image/jpeg,application/pdf";
    label.append(file, el("small", "diary-help", "PNG, JPEG ou PDF · 10 Mo maximum. Ne joignez jamais de secrets ni de données personnelles de clients."));
    const upload = button("Téléverser la pièce jointe", "quiet-button", null, "submit"); uploadForm.append(label, upload);
    uploadForm.addEventListener("submit", async (event) => { event.preventDefault(); if (upload.disabled) return; upload.disabled = true; feedback.textContent = "Téléversement et validation serveur…";
      try { await api.uploadDevelopmentDiaryAttachment(issue.reference, file.files && file.files[0]); await api.openDevelopmentDiaryIssue(issue.reference); }
      catch (error) { feedback.textContent = error.message || "Le fichier n’a pas été enregistré."; feedback.classList.add("error"); upload.disabled = false; }
    }); attachments.append(uploadForm); panel.append(attachments);

    const history = el("section", "diary-subpanel"); history.append(el("h3", "", `Historique d’activité (${issue.activity.length})`));
    issue.activity.slice().reverse().forEach((item) => {
      const fields = Array.isArray(item.fields) ? item.fields.join(", ") : "";
      const before = item.before && Object.keys(item.before).length ? `Avant : ${JSON.stringify(item.before)}` : "";
      const after = item.after && Object.keys(item.after).length ? `Après : ${JSON.stringify(item.after)}` : "";
      activityLine(history, `${item.action} · ${item.actor || "Compte indisponible"}`, [fields, before, after].filter(Boolean).join(" · "), item.created_at);
    }); panel.append(history);
  }
  function render(target, data, api) {
    if (!target || !api) return;
    target.replaceChildren();
    if (data && Array.isArray(data.issues)) renderList(target, data, api);
    else if (data && data.reference) renderDetail(target, data, data.tenant_options || data.tenants || [], false, api);
    else if (api.isNewDevelopmentDiaryIssue()) renderDetail(target, {}, data && data.tenants || [], true, api);
    else target.append(el("p", "empty", "Réponse du journal invalide."));
  }
  global.IgPlatformDiary = Object.freeze({ render });
})(window);
