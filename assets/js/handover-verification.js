(function installHandoverVerification(global) {
  "use strict";

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const QR_TOKEN = /^hv1\.[A-Za-z0-9_-]{43}$/;
  const ACTIVE_JOB_STATUSES = new Set(["arrived", "handover_in_progress"]);
  const RESUME_STORAGE_KEY = "igloue.handover.resume.v1";

  function requestUuid(environment = {}) {
    if (typeof environment.randomUUID === "function") return environment.randomUUID();
    if (global.crypto && typeof global.crypto.randomUUID === "function") return global.crypto.randomUUID();
    return "";
  }

  function canVerifyDelivery(job) {
    return Boolean(job && job.type === "delivery" && UUID.test(String(job.serviceJobId || "")) &&
      ACTIVE_JOB_STATUSES.has(String(job.status || "")) && job.state !== "completed" && job.state !== "cancelled");
  }

  function createController(auth, document, environment = {}) {
    const byId = (id) => document.getElementById(id);
    const jobs = byId("ops-jobs");
    const panel = byId("handover-panel");
    const status = byId("handover-status");
    const codeInput = byId("handover-code");
    const video = byId("handover-video");
    const result = byId("handover-result");
    const scanButton = byId("handover-scan");
    const submitButton = byId("handover-submit");
    const mediaDevices = environment.mediaDevices || global.navigator && global.navigator.mediaDevices;
    const Detector = environment.BarcodeDetector || global.BarcodeDetector;
    let stream = null;
    let timer = null;
    let scanning = false;
    let scanTarget = null;
    let activeJobId = null;
    let activeJobDate = null;
    let activeContext = null;
    let openingJobId = null;
    let pendingSignatureFileId = null;
    let pendingSignatureKey = null;
    const pendingActions = new Set();
    // Keep an upload attempt stable across a retry in this page. If the upload
    // succeeded but its response was lost, the same key lets tenant-files
    // return the original record instead of creating another object.
    const pendingPhotoUploads = new WeakMap();

    function readResumeMarker() {
      try {
        const raw = global.sessionStorage && global.sessionStorage.getItem(RESUME_STORAGE_KEY);
        const marker = raw && JSON.parse(raw);
        if (!marker || !UUID.test(String(marker.serviceJobId || "")) || !/^\d{4}-\d{2}-\d{2}$/.test(String(marker.scheduledDate || ""))) return null;
        return { serviceJobId: marker.serviceJobId, scheduledDate: marker.scheduledDate, unsaved: marker.unsaved === true };
      } catch { return null; }
    }
    function clearResumeMarker() {
      try { global.sessionStorage && global.sessionStorage.removeItem(RESUME_STORAGE_KEY); } catch { /* Storage can be unavailable in restricted browser contexts. */ }
    }
    function hasUnsavedValues() {
      if (!activeContext || !activeContext.inspection || !result) return false;
      const subjects = activeContext.inspection.subjects || [];
      const note = result.querySelector("textarea");
      if (note && String(note.value || "").trim() !== String(activeContext.inspection.summaryNote || "").trim()) return true;
      for (const control of result.querySelectorAll("[data-condition-for]")) {
        const subject = subjects.find((item) => item.subjectId === control.dataset.conditionFor);
        if (subject && String(control.value || "") !== String(subject.condition || "")) return true;
      }
      for (const control of result.querySelectorAll("[data-checklist-key]")) {
        const subject = subjects.find((item) => item.subjectId === control.dataset.subjectId);
        const item = subject && (subject.checklist || []).find((entry) => entry.key === control.dataset.checklistKey);
        if (item && String(control.value || "") !== String(item.result || "")) return true;
      }
      const signerName = result.querySelector("[data-signer-name]");
      if (signerName && String(signerName.value || "").trim()) return true;
      const signature = result.querySelector("[data-signature-canvas]");
      if (signature && signature.dataset.signatureDraft === "true") return true;
      return [...result.querySelectorAll("[data-photo-input]")].some((input) => Boolean(input.files && input.files.length && input.dataset.photoSaved !== "true"));
    }
    function syncResumeMarker() {
      if (!activeJobId || !activeJobDate || !activeContext || !activeContext.handover || activeContext.handover.status !== "in_progress") return;
      try {
        global.sessionStorage && global.sessionStorage.setItem(RESUME_STORAGE_KEY, JSON.stringify({
          serviceJobId: activeJobId, scheduledDate: activeJobDate, unsaved: hasUnsavedValues()
        }));
      } catch { /* Backend resume remains available manually if storage is disabled. */ }
    }
    function photoRetryStorageKey(subjectId) { return `igloue.handover.photo-retry.v1.${activeJobId}.${subjectId}`; }
    function readPhotoRetry(subjectId) {
      try {
        const raw = global.sessionStorage && global.sessionStorage.getItem(photoRetryStorageKey(subjectId));
        const value = raw && JSON.parse(raw);
        return value && UUID.test(String(value.idempotencyKey || "")) && /^[0-9a-f]{64}$/i.test(String(value.fingerprint || "")) ? value : null;
      } catch { return null; }
    }
    function writePhotoRetry(subjectId, value) {
      try { global.sessionStorage && global.sessionStorage.setItem(photoRetryStorageKey(subjectId), JSON.stringify(value)); } catch { /* In-page retry remains available when browser storage is blocked. */ }
    }
    function clearPhotoRetry(subjectId) {
      try { global.sessionStorage && global.sessionStorage.removeItem(photoRetryStorageKey(subjectId)); } catch { /* Best-effort local retry metadata cleanup. */ }
    }
    async function photoFingerprint(file) {
      const cryptoApi = environment.crypto || global.crypto;
      if (!file || typeof file.arrayBuffer !== "function" || !cryptoApi || !cryptoApi.subtle || typeof cryptoApi.subtle.digest !== "function") throw new Error("photo_fingerprint_unavailable");
      const digest = await cryptoApi.subtle.digest("SHA-256", await file.arrayBuffer());
      return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
    }
    function noteDraftChange() { syncResumeMarker(); }
    function onPageHide() {
      syncResumeMarker();
      // Android camera/gallery intents can background or suspend the document.
      // Release camera resources and one-time customer input, but keep the
      // active job and rendered draft intact; pagehide is not an explicit close.
      stopCamera(); clearCredentials();
    }
    function onBeforeUnload(event) {
      if (!hasUnsavedValues()) return;
      syncResumeMarker();
      event.preventDefault();
      event.returnValue = "";
      return "";
    }

    function setStatus(message, kind = "info") {
      if (!status) return;
      status.textContent = message;
      status.dataset.state = kind;
    }
    function stopCamera() {
      scanning = false;
      if (timer !== null) { (environment.clearTimeout || global.clearTimeout)(timer); timer = null; }
      if (stream) { for (const track of stream.getTracks()) track.stop(); stream = null; }
      if (video) { video.pause && video.pause(); video.srcObject = null; video.hidden = true; }
      scanTarget = null;
    }
    function clearCredentials() { if (codeInput) codeInput.value = ""; }
    function clearResult() {
      if (result) { result.replaceChildren(); result.hidden = true; result.className = "handover-result"; }
    }
    function textNode(parent, tag, text, className) {
      const node = document.createElement(tag);
      node.textContent = String(text ?? "");
      if (className) node.className = className;
      parent.append(node);
      return node;
    }
    function button(parent, label, handler, className = "handover-primary") {
      const node = document.createElement("button");
      node.type = "button";
      node.className = className;
      node.textContent = label;
      node.addEventListener("click", handler);
      parent.append(node);
      return node;
    }
    function field(parent, label, control) {
      const wrap = document.createElement("label");
      wrap.className = "handover-field";
      textNode(wrap, "span", label);
      wrap.append(control);
      parent.append(wrap);
      return wrap;
    }
    function selectControl(items, value) {
      const select = document.createElement("select");
      select.className = "handover-input";
      for (const [key, label] of items) {
        const option = document.createElement("option"); option.value = key; option.textContent = label; select.append(option);
      }
      select.value = value || "";
      return select;
    }
    function formatServerTime(value) {
      const date = value ? new Date(value) : null;
      if (!date || Number.isNaN(date.getTime())) return "";
      return new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" }).format(date);
    }
    function actionAvailable(key) { if (pendingActions.has(key)) return false; pendingActions.add(key); return true; }
    function finishAction(key, control) { pendingActions.delete(key); if (control) control.disabled = false; }
    function showFieldError(node, message) {
      if (!node) return;
      node.hidden = !message;
      node.textContent = message || "";
    }
    function errorText(parent, className, message = "") {
      const node = textNode(parent, "p", message, className);
      node.hidden = !message;
      node.setAttribute("role", "alert");
      return node;
    }
    async function renderSavedPhoto(unit, state, image) {
      const evidence = unit.photoEvidence;
      if (!evidence || !evidence.fileId) return;
      state.replaceChildren();
      textNode(state, "p", evidence.savedAt
        ? `✓ Enregistré · ${formatServerTime(evidence.savedAt)} (heure de Paris)`
        : "✓ Enregistré · actualisation de l’heure serveur en attente.", "handover-complete-note");
      image.hidden = true;
      image.alt = "Photo de l’équipement enregistrée";
      image.referrerPolicy = "no-referrer";
      image.loading = "lazy";
      image.className = "handover-photo-thumbnail";
      try {
        if (!auth || typeof auth.downloadDeliveryEvidence !== "function") throw new Error("download_unavailable");
        const response = await auth.downloadDeliveryEvidence(evidence.fileId);
        if (!response || !response.ok || !response.data || !response.data.url) throw new Error("download_unavailable");
        image.src = response.data.url;
        image.hidden = false;
        state.append(image);
      } catch {
        textNode(state, "p", "Aperçu indisponible pour le moment. La photo reste enregistrée dans le dossier sécurisé.", "handover-hint");
        button(state, "Recharger l’aperçu", () => void renderSavedPhoto(unit, state, image), "handover-secondary");
      }
    }
    function errorMessage(httpStatus) {
      if (httpStatus === 401) return "Votre session a expiré. Reconnectez-vous puis réessayez.";
      if (httpStatus === 403) return "Vous n’êtes pas autorisé à intervenir sur cette livraison.";
      if (httpStatus === 422 || httpStatus === 400) return "Code invalide, expiré, révoqué ou déjà utilisé. Demandez au client de vérifier son code.";
      return "Le service est momentanément indisponible. Vérifiez la connexion puis réessayez.";
    }

    async function refreshBoard() {
      const app = global.IGLOUE_ADMIN_APP_CONTROLLER;
      if (app && typeof app.refreshOperationsBoard === "function") await app.refreshOperationsBoard();
    }

    async function loadContext() {
      const response = await auth.getDeliveryHandover(activeJobId);
      if (!response || response.ok !== true || !response.data || response.data.serviceJobId !== activeJobId) throw new Error("handover_unavailable");
      activeContext = response.data;
      return activeContext;
    }

    function renderEquipment(context) {
      const list = document.createElement("div");
      list.className = "handover-equipment-list";
      const subjects = context.inspection && Array.isArray(context.inspection.subjects) ? context.inspection.subjects : [];
      subjects.forEach((unit, index) => {
        const card = document.createElement("article");
        card.className = "handover-equipment-card";
        card.dataset.machineId = unit.machineId;
        textNode(card, "h4", `${unit.productName || "Équipement"}${unit.serialNumber ? ` · ${unit.serialNumber}` : ""}`);
        if (unit.equipmentVerified) textNode(card, "p", "Équipement identifié pour cette réservation.", "handover-complete-note");
        else {
          const input = document.createElement("input");
          input.type = "text"; input.autocomplete = "off"; input.maxLength = 120; input.className = "handover-input";
          input.setAttribute("aria-label", `Identifiant de l’équipement ${index + 1}`);
          field(card, "Code QR ou numéro de série", input);
          button(card, "Scanner le QR de l’équipement", () => void startScan({ kind: "equipment", machineId: unit.machineId, input }), "handover-secondary");
          button(card, "Vérifier l’équipement", async () => {
            const code = String(input.value || "").trim(); input.value = "";
            await verifyEquipment(unit, code);
          });
        }
        const condition = selectControl([["", "Choisir l’état"], ["good", "Bon état"], ["minor_issue", "Défaut mineur"], ["damaged", "Endommagé"]], unit.condition);
        field(card, "État constaté", condition);
        condition.dataset.conditionFor = unit.subjectId;
        (unit.checklist || []).forEach((item) => {
          const checklist = selectControl([["not_checked", "À contrôler"], ["pass", "Conforme"], ["issue", "Anomalie"], ["not_applicable", "Non applicable"]], item.result);
          checklist.dataset.checklistKey = item.key;
          checklist.dataset.subjectId = unit.subjectId;
          field(card, item.label, checklist);
        });
        if (!(unit.checklist || []).length) textNode(card, "p", "Aucun point de contrôle n’est configuré pour cette organisation.", "handover-hint");
        const photoState = document.createElement("div"); photoState.className = "handover-photo-state"; card.append(photoState);
        const photoImage = document.createElement("img"); photoImage.hidden = true;
        const photoEvidence = unit.photoEvidence && unit.photoEvidence.fileId ? unit.photoEvidence : null;
        if (photoEvidence) {
          clearPhotoRetry(unit.subjectId);
          void renderSavedPhoto(unit, photoState, photoImage);
        } else if (unit.photoAttached) {
          textNode(photoState, "p", "Photo associée côté serveur; ses métadonnées sécurisées doivent être actualisées avant l’aperçu.", "handover-hint");
        } else {
          textNode(photoState, "p", "Ajouter une photo de l’équipement.", "handover-hint");
          const file = document.createElement("input"); file.type = "file"; file.accept = "image/*"; file.setAttribute("capture", "environment"); file.className = "handover-input"; file.dataset.photoInput = "true";
          const fileField = field(card, "Photo de l’état", file);
          const photoError = errorText(card, "handover-field-error");
          file.dataset.photoError = "true";
          file.addEventListener("change", () => { pendingPhotoUploads.delete(file); file.dataset.photoSaved = "false"; noteDraftChange(); });
          const uploadButton = button(card, "Enregistrer la photo", () => void uploadPhoto(unit, file, uploadButton, photoState, photoImage, photoError), "handover-primary");
        }
        const conditionError = errorText(card, "handover-field-error"); conditionError.dataset.conditionError = unit.subjectId;
        const checklistError = errorText(card, "handover-field-error"); checklistError.dataset.checklistError = unit.subjectId;
        const equipmentError = errorText(card, "handover-field-error"); equipmentError.dataset.equipmentError = unit.subjectId;
        const saveInspectionButton = button(card, "Enregistrer le contrôle", () => void saveInspection(unit, condition, card, saveInspectionButton), "handover-secondary");
        list.append(card);
      });
      return list;
    }

    function drawSignatureCanvas(canvas) {
      const ratio = Math.max(1, Math.min(3, global.devicePixelRatio || 1));
      const width = Math.max(280, canvas.clientWidth || 560);
      canvas.width = width * ratio; canvas.height = 180 * ratio;
      const ctx = canvas.getContext("2d");
      ctx.scale(ratio, ratio); ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.strokeStyle = "#173a48";
      let drawing = false; let drew = false;
      const point = (event) => { const r = canvas.getBoundingClientRect(); return { x: event.clientX - r.left, y: event.clientY - r.top }; };
      canvas.addEventListener("pointerdown", (event) => { drawing = true; drew = true; canvas.dataset.signatureDraft = "true"; canvas.setPointerCapture && canvas.setPointerCapture(event.pointerId); const p = point(event); ctx.beginPath(); ctx.moveTo(p.x,p.y); });
      canvas.addEventListener("pointermove", (event) => { if (!drawing) return; const p = point(event); ctx.lineTo(p.x,p.y); ctx.stroke(); });
      const end = () => { drawing = false; };
      canvas.addEventListener("pointerup", end); canvas.addEventListener("pointercancel", end); canvas.addEventListener("pointerleave", end);
      return { hasInk: () => drew, clear: () => { ctx.clearRect(0,0,width,180); drew=false; canvas.dataset.signatureDraft = "false"; } };
    }

    function renderWorkflow(context) {
      if (!result) return;
      result.replaceChildren(); result.hidden = false; result.className = "handover-result handover-result-workflow";
      textNode(result, "h3", "Remise de l’équipement");
      textNode(result, "p", `Réservation ${context.reservationReference} · ${String(context.scheduledDate || "").split("-").reverse().join("/")} · ${context.timeSlot || "Horaire non renseigné"}`);
      textNode(result, "p", [context.address && context.address.line1, context.address && context.address.postcode, context.address && context.address.city].filter(Boolean).join(" · "));
      if (context.handover && context.handover.status === "confirmed") {
        clearResumeMarker();
        if (context.handover.confirmedAt) renderCompletedScreen(context);
        else {
          textNode(result, "p", "Le serveur indique une remise confirmée, mais l’heure de confirmation n’est pas disponible. Actualisez avant de quitter.", "handover-hint");
          button(result, "Vérifier à nouveau", () => void reconcileHandover(), "handover-secondary");
        }
        return;
      }
      result.append(renderEquipment(context));
      const note = document.createElement("textarea"); note.rows = 3; note.maxLength = 2000; note.className = "handover-input";
      note.value = context.inspection && context.inspection.summaryNote || "";
      field(result, "Notes de remise", note);
      const conditions = context.inspection && context.inspection.subjects || [];
      const findings = conditions.some((unit) => ["minor_issue", "damaged"].includes(unit.condition) || (unit.checklist || []).some((item) => item.result === "issue"));
      if (findings) textNode(result, "p", "Le client doit lire et reconnaître les anomalies signalées avant de signer.", "handover-attention-note");
      if (!context.handover || !context.handover.signatureAttached) {
        const name = document.createElement("input"); name.type = "text"; name.maxLength = 160; name.autocomplete = "name"; name.className = "handover-input"; name.dataset.signerName = "true";
        const nameField = field(result, "Nom du client signataire", name);
        const signatureError = errorText(result, "handover-field-error"); signatureError.dataset.signatureError = "true";
        const canvas = document.createElement("canvas"); canvas.className = "handover-signature-canvas"; canvas.dataset.signatureCanvas = "true"; canvas.setAttribute("aria-label", "Zone de signature du client");
        result.append(canvas);
        const signature = drawSignatureCanvas(canvas);
        button(result, "Effacer la signature", () => signature.clear(), "handover-secondary");
        let acknowledgement = null;
        if (findings) {
          acknowledgement = document.createElement("input"); acknowledgement.type = "checkbox";
          const label = document.createElement("label"); label.className = "handover-acknowledgement"; label.append(acknowledgement); textNode(label, "span", "Je confirme avoir lu les observations ci-dessus."); result.append(label);
        }
        const signatureButton = button(result, "Enregistrer la signature du client", () => void saveSignature(canvas, signature, name, acknowledgement, note, signatureButton, signatureError), "handover-primary");
      } else {
        const evidence = context.handover.signatureEvidence;
        const savedAt = evidence && evidence.savedAt;
        textNode(result, "p", savedAt
          ? `✓ Enregistré · signature de ${context.handover.signedName || "client"} · ${formatServerTime(savedAt)} (heure de Paris)`
          : `Signature enregistrée au nom de ${context.handover.signedName || "client"}; actualisation de l’heure serveur nécessaire.`,
        savedAt ? "handover-complete-note" : "handover-hint");
        if (context.handover.findingsAcknowledged) textNode(result, "p", "Les observations ont été reconnues par le client.");
      }
      const validation = document.createElement("div"); validation.className = "handover-validation"; validation.hidden = true; validation.setAttribute("role", "alert"); validation.dataset.confirmValidation = "true"; result.append(validation);
      const confirmButton = button(result, "Confirmer la remise", () => void confirm(context, note, confirmButton, validation), "handover-confirm-button");
      button(result, "Vérifier le statut enregistré", () => void reconcileHandover(), "handover-secondary");
      syncResumeMarker();
    }

    function renderCompletedScreen(context) {
      result.replaceChildren(); result.hidden = false; result.className = "handover-result handover-result-completed";
      textNode(result, "p", "✓ Remise terminée", "handover-completed-title");
      textNode(result, "p", `Réservation ${context.reservationReference || "—"}`);
      const equipment = (context.inspection && context.inspection.subjects || []).map((unit) => `${unit.productName || "Équipement"}${unit.serialNumber ? ` · ${unit.serialNumber}` : ""}`);
      if (equipment.length) textNode(result, "p", `Équipement : ${equipment.join(", ")}`);
      const completedAt = context.handover && context.handover.confirmedAt;
      textNode(result, "p", completedAt ? `Confirmée par le serveur le ${formatServerTime(completedAt)} (heure de Paris).` : "Confirmation serveur reçue; l’horodatage sera actualisé au prochain chargement.", "handover-complete-note");
      button(result, "Retour au planning", async () => { close(); await refreshBoard(); }, "handover-primary");
    }

    async function reconcileHandover() {
      setStatus("Vérification de l’état enregistré côté serveur…", "loading");
      try {
        const fresh = await loadContext();
        if (fresh.handover && fresh.handover.status === "confirmed" && fresh.handover.confirmedAt) {
          renderCompletedScreen(fresh);
          setStatus("Remise confirmée par le serveur.", "success");
          await refreshBoard();
          return true;
        }
        setStatus("Le serveur n’a pas confirmé la remise. Vos champs restent affichés; corrigez les points signalés puis réessayez.", "error");
        return false;
      } catch {
        setStatus("Impossible de vérifier l’état serveur. Vos champs sont conservés; réessayez quand la connexion revient.", "error");
        return false;
      }
    }

    async function showExistingWorkflow() {
      setStatus("Chargement de la remise enregistrée…", "loading");
      try {
        const context = await loadContext();
        if (context.handover && ["in_progress", "confirmed"].includes(context.handover.status)) {
          renderWorkflow(context); setStatus(context.handover.status === "confirmed" ? "Remise confirmée." : "Reprise de la remise enregistrée.", "success"); return true;
        }
      } catch {
        // A failed fetch is not proof that no handover exists. Fail closed so
        // staff cannot be misled into treating a resumed job as a new one.
        setStatus("La remise enregistrée n’a pas pu être chargée. Vérifiez la connexion puis réessayez.", "error");
        return null;
      }
      return false;
    }

    async function verify(credentialType, credential) {
      stopCamera(); clearResult(); clearCredentials();
      if (!activeJobId || !auth || typeof auth.verifyCustomerHandover !== "function") { setStatus("Vérification indisponible. Actualisez le planning puis réessayez.", "error"); return false; }
      if (submitButton) submitButton.disabled = true; if (scanButton) scanButton.disabled = true;
      setStatus("Vérification du client en cours…", "loading");
      try {
        const requestId = requestUuid(environment);
        if (!UUID.test(requestId)) throw new Error("request_id_unavailable");
        const response = await auth.verifyCustomerHandover({ serviceJobId: activeJobId, credentialType, credential, requestId });
        if (!response || response.ok !== true || !response.data) { setStatus(errorMessage(response && response.status), "error"); return false; }
        const key = requestUuid(environment);
        const prepared = await auth.prepareDeliveryHandover(activeJobId, response.data.request_id, key);
        if (!prepared || prepared.ok !== true) { setStatus(prepared && prepared.status === 403 ? "Vous n’êtes pas autorisé à préparer cette remise." : "Le client est vérifié, mais la remise n’a pas pu être préparée. Actualisez pour reprendre sans revérifier.", "error"); return false; }
        const context = await loadContext(); renderWorkflow(context);
        setStatus("Client vérifié. Vous pouvez commencer le contrôle de l’équipement.", "success");
        return true;
      } catch { setStatus("La connexion a été interrompue. Actualisez la remise pour vérifier son état côté serveur.", "error"); return false; }
      finally { clearCredentials(); if (submitButton) submitButton.disabled = false; if (scanButton) scanButton.disabled = false; stopCamera(); }
    }

    async function verifyEquipment(unit, raw) {
      const code = String(raw || "").trim();
      if (!code) { setStatus("Scannez le QR de l’équipement ou saisissez son numéro de série.", "error"); return; }
      setStatus("Vérification de l’équipement…", "loading");
      try {
        const result = await auth.verifyDeliveryEquipment(activeJobId, code);
        if (!result || result.ok !== true || !result.data || result.data.verified !== true || result.data.machineId !== unit.machineId) { setStatus("Cet équipement ne correspond pas à la réservation.", "error"); return; }
        await reloadWorkflow("Équipement reconnu.");
      } catch { setStatus("Impossible de vérifier cet équipement. Réessayez.", "error"); }
    }
    async function saveInspection(unit, condition, card, saveButton) {
      const actionKey = `inspection:${unit.subjectId}`;
      if (!actionAvailable(actionKey)) return;
      if (saveButton) saveButton.disabled = true;
      const conditionError = [...card.querySelectorAll("[data-condition-error]")].find((node) => node.dataset.conditionError === unit.subjectId);
      const checklistError = [...card.querySelectorAll("[data-checklist-error]")].find((node) => node.dataset.checklistError === unit.subjectId);
      if (!condition.value || condition.value === "not_tested") {
        showFieldError(conditionError, "Choisissez l’état constaté avant d’enregistrer.");
        setStatus("Un état doit être renseigné pour chaque équipement.", "error"); finishAction(actionKey, saveButton); return;
      }
      showFieldError(conditionError, "");
      const checklist = [...card.querySelectorAll("[data-checklist-key]")].map((item) => ({ item_key: item.dataset.checklistKey, result: item.value, note: null }));
      if (checklist.some((item) => item.result === "not_checked" || !item.result)) {
        showFieldError(checklistError, "Terminez chaque point de contrôle affiché avant d’enregistrer.");
        setStatus("Un ou plusieurs points de contrôle restent à renseigner.", "error"); finishAction(actionKey, saveButton); return;
      }
      showFieldError(checklistError, "");
      if (saveButton) saveButton.textContent = "Enregistrement…";
      setStatus("Enregistrement du contrôle côté serveur…", "loading");
      try {
        const saved = await auth.updateDeliveryInspection(activeJobId, unit.subjectId, condition.value,
          String(result.querySelector("textarea")?.value || "").trim() || null, checklist);
        if (!saved || saved.ok !== true) { setStatus("Échec de l’enregistrement du contrôle. Vos champs sont conservés; corrigez ou réessayez.", "error"); return; }
        unit.condition = condition.value;
        for (const item of unit.checklist || []) {
          const control = [...card.querySelectorAll("[data-checklist-key]")].find((node) => node.dataset.checklistKey === item.key);
          if (control) item.result = control.value;
        }
        if (activeContext && activeContext.inspection) activeContext.inspection.summaryNote = String(result.querySelector("textarea")?.value || "").trim();
        syncResumeMarker();
        setStatus("✓ Enregistré côté serveur.", "success");
      } catch { setStatus("Échec de l’enregistrement du contrôle. Vos champs sont conservés; vérifiez la connexion puis réessayez.", "error"); }
      finally { if (saveButton) saveButton.textContent = "Enregistrer le contrôle"; finishAction(actionKey, saveButton); }
    }
    async function normalizePhoto(file) {
      const maxBytes = 9 * 1024 * 1024;
      const sourceType = String(file && file.type || "").toLowerCase();
      const supportedPhotoTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/avif", "image/heic", "image/heif"]);
      if (!file || !supportedPhotoTypes.has(sourceType)) throw new Error("photo_type");
      if (file.size > 40 * 1024 * 1024) throw new Error("photo_size");
      if (["image/jpeg", "image/png"].includes(sourceType) && file.size <= maxBytes) return file;
      const decode = environment.createImageBitmap || global.createImageBitmap;
      if (typeof decode !== "function") {
        if (["image/jpeg", "image/png"].includes(sourceType) && file.size <= 10 * 1024 * 1024) return file;
        throw new Error("photo_conversion_unavailable");
      }
      let bitmap;
      try { bitmap = await decode(file); } catch { throw new Error("photo_decode"); }
      try {
        const maxEdge = 2048;
        const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("photo_conversion_unavailable");
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        for (const quality of [0.88, 0.76, 0.64, 0.52]) {
          const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
          if (blob && blob.type === "image/jpeg" && blob.size <= maxBytes) return blob;
        }
        throw new Error("photo_size");
      } finally { if (typeof bitmap.close === "function") bitmap.close(); }
    }
    function photoErrorMessage(statusCode) {
      if (statusCode === 401) return "Votre session a expiré. Reconnectez-vous puis réessayez la photo.";
      if (statusCode === 403) return "Vous n’êtes pas autorisé à ajouter une photo à cette remise.";
      if (statusCode === 413) return "Cette photo reste trop volumineuse. Prenez une photo moins détaillée puis réessayez.";
      if (statusCode === 415) return "Format non pris en charge. Prenez une photo JPG ou PNG.";
      if (statusCode === 422) return "La photo n’a pas été acceptée. Reprenez-la avec l’appareil photo puis réessayez.";
      return "La photo n’a pas pu être enregistrée. Vérifiez la connexion; vous pouvez réessayer sans perdre la sélection.";
    }
    async function uploadPhoto(unit, input, uploadButton, photoState, photoImage, photoError) {
      const actionKey = `photo:${unit.subjectId}`;
      if (!actionAvailable(actionKey)) return;
      const file = input.files && input.files[0];
      if (!file) { setStatus("Prenez ou sélectionnez une photo de l’équipement.", "error"); finishAction(actionKey); return; }
      if (uploadButton) uploadButton.disabled = true;
      if (uploadButton) uploadButton.textContent = "Enregistrement…";
      showFieldError(photoError, "");
      photoState.replaceChildren(); textNode(photoState, "p", "Enregistrement sécurisé de la photo…", "handover-hint");
      setStatus("Préparation et envoi sécurisé de la photo…", "loading");
      try {
        let pending = pendingPhotoUploads.get(input);
        if (!pending || pending.file !== file) {
          const fingerprint = await photoFingerprint(file);
          const priorAttempt = readPhotoRetry(unit.subjectId);
          if (priorAttempt && priorAttempt.fingerprint !== fingerprint) throw new Error("photo_retry_mismatch");
          const idempotencyKey = priorAttempt ? priorAttempt.idempotencyKey : requestUuid(environment);
          pending = { file, fingerprint, normalized: null, idempotencyKey, fileId: null };
          if (!UUID.test(pending.idempotencyKey)) throw new Error("request_id_unavailable");
          pendingPhotoUploads.set(input, pending);
          writePhotoRetry(unit.subjectId, { fingerprint, idempotencyKey });
        }
        if (!pending.normalized) pending.normalized = await normalizePhoto(file);
        if (!pending.fileId) {
          const organisation = await auth.getSelectedOrganisation();
          const upload = await auth.uploadDeliveryEvidence({ file: pending.normalized, organisationId: organisation.id, reservationId: activeContext.reservationId, inspectionId: activeContext.inspection.id, kind: "delivery_photo", idempotencyKey: pending.idempotencyKey });
          if (!upload || upload.ok !== true || !upload.data || !upload.data.fileId) { setStatus(photoErrorMessage(upload && upload.status), "error"); return; }
          pending.fileId = upload.data.fileId;
        }
        const linked = await auth.attachDeliveryEvidence(activeJobId, pending.fileId, "delivery_photo", unit.machineId);
        if (!linked || linked.ok !== true || !linked.data || linked.data.attached !== true) {
          const message = linked && linked.status === 403 ? "Vous n’êtes pas autorisé à associer cette photo." : "La photo n’est pas encore associée à la remise. Vos champs sont conservés; réessayez sans créer un nouveau fichier.";
          showFieldError(photoError, message); setStatus(message, "error"); photoState.replaceChildren(); textNode(photoState, "p", "Échec — réessayez après vérification de la connexion.", "handover-field-error"); return;
        }
        // The association RPC is the persistence confirmation. Keep its file
        // ID locally only until a fresh authorized read returns metadata.
        unit.photoEvidence = { fileId: pending.fileId, savedAt: null };
        unit.photoAttached = true;
        pendingPhotoUploads.delete(input); clearPhotoRetry(unit.subjectId); input.dataset.photoSaved = "true"; input.value = "";
        const card = input.closest && input.closest(".handover-equipment-card");
        if (card) {
          const wrapper = input.parentElement; if (wrapper) wrapper.hidden = true;
          if (uploadButton) uploadButton.hidden = true;
        }
        photoState.replaceChildren();
        textNode(photoState, "p", "✓ Enregistré · synchronisation de l’heure serveur…", "handover-complete-note");
        try {
          const fresh = await loadContext();
          const updated = (fresh.inspection && fresh.inspection.subjects || []).find((subject) => subject.subjectId === unit.subjectId);
          if (updated && updated.photoEvidence && updated.photoEvidence.fileId === pending.fileId && updated.photoEvidence.savedAt) {
            Object.assign(unit, updated);
          }
        } catch { /* RPC success already confirms the association; refresh fills the server timestamp later. */ }
        await renderSavedPhoto(unit, photoState, photoImage);
        syncResumeMarker();
        setStatus("✓ Photo enregistrée côté serveur.", "success");
      } catch (error) {
        const message = error && error.message === "photo_type" ? "Choisissez une image. Les autres fichiers ne sont pas acceptés." : error && error.message === "photo_decode" ? "Ce format photo ne peut pas être converti sur cet appareil. Choisissez JPG ou PNG." : error && error.message === "photo_size" ? "La photo est trop volumineuse. Prenez une photo moins détaillée puis réessayez." : error && error.message === "photo_conversion_unavailable" ? "La conversion de cette photo n’est pas disponible. Choisissez un JPG ou PNG de moins de 9 Mo." : error && error.message === "photo_fingerprint_unavailable" ? "L’envoi sécurisé n’est pas disponible sur cet appareil. Rechargez la page ou choisissez une photo JPG ou PNG." : error && error.message === "photo_retry_mismatch" ? "Une tentative précédente n’a pas été confirmée. Resélectionnez la même photo pour reprendre son envoi avant d’en choisir une autre." : "Échec de l’enregistrement de la photo. Votre sélection est conservée; vérifiez la connexion puis réessayez.";
        showFieldError(photoError, message); setStatus(message, "error");
        photoState.replaceChildren(); textNode(photoState, "p", "Échec — la sélection est conservée. Réessayez.", "handover-field-error");
      } finally { if (uploadButton) { uploadButton.disabled = false; uploadButton.textContent = "Réessayer l’enregistrement de la photo"; } finishAction(actionKey); }
    }
    async function saveSignature(canvas, signature, name, acknowledgement, note, saveButton, signatureError) {
      const actionKey = "signature";
      if (!actionAvailable(actionKey)) return;
      if (saveButton) saveButton.disabled = true;
      if (!signature.hasInk() || !String(name.value || "").trim()) {
        showFieldError(signatureError, "Saisissez le nom du client et recueillez la signature avant l’enregistrement.");
        setStatus("Le nom et la signature du client sont nécessaires.", "error"); finishAction(actionKey, saveButton); return;
      }
      showFieldError(signatureError, "");
      const checkboxes = result.querySelectorAll("[data-condition-for]");
      for (const select of checkboxes) {
        if (!select.value) { setStatus("Enregistrez l’état de chaque équipement avant la signature.", "error"); finishAction(actionKey, saveButton); return; }
      }
      let latest;
      try {
        const subjects = activeContext.inspection.subjects;
        for (const unit of subjects) {
          const card = [...result.querySelectorAll("[data-machine-id]")].find((item) => item.dataset.machineId === unit.machineId);
          const condition = card && card.querySelector("[data-condition-for]");
          if (!unit.equipmentVerified || !condition || !condition.value || !unit.photoAttached) { setStatus("Identifiez, contrôlez et photographiez chaque équipement avant la signature.", "error"); finishAction(actionKey, saveButton); return; }
          const checklist = [...card.querySelectorAll("[data-checklist-key]")].map((item) => ({ item_key: item.dataset.checklistKey, result: item.value, note: null }));
          const saved = await auth.updateDeliveryInspection(activeJobId, unit.subjectId, condition.value, String(note.value || "").trim() || null, checklist);
          if (!saved || !saved.ok) { setStatus("Échec de l’enregistrement d’un contrôle. Les champs restent affichés; réessayez.", "error"); finishAction(actionKey, saveButton); return; }
        }
        latest = await loadContext();
      } catch { setStatus("Échec de l’actualisation des contrôles. Vos champs et la signature restent affichés; vérifiez la connexion.", "error"); finishAction(actionKey, saveButton); return; }
      const hasFindings = latest.inspection.subjects.some((unit) => ["minor_issue", "damaged"].includes(unit.condition) || unit.checklist.some((item) => item.result === "issue"));
      if (hasFindings && !(acknowledgement && acknowledgement.checked)) { showFieldError(signatureError, "Le client doit reconnaître les anomalies avant de signer."); setStatus("Le client doit reconnaître les anomalies avant de signer.", "error"); finishAction(actionKey, saveButton); return; }
      const canvasBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!canvasBlob) { showFieldError(signatureError, "La signature n’a pas pu être préparée sur cet appareil."); setStatus("La signature ne peut pas être préparée sur cet appareil.", "error"); finishAction(actionKey, saveButton); return; }
      let organisation;
      try { organisation = await auth.getSelectedOrganisation(); }
      catch { showFieldError(signatureError, "Votre organisation n’est plus disponible. Reconnectez-vous; la signature affichée reste sur cet écran."); setStatus("Impossible de préparer l’enregistrement. Reconnectez-vous puis reprenez la signature.", "error"); finishAction(actionKey, saveButton); return; }
      if (!organisation || !organisation.id) { showFieldError(signatureError, "Votre organisation n’est plus disponible. Reconnectez-vous; la signature affichée reste sur cet écran."); setStatus("Impossible de préparer l’enregistrement. Reconnectez-vous puis reprenez la signature.", "error"); finishAction(actionKey, saveButton); return; }
      if (saveButton) saveButton.textContent = "Enregistrement…";
      setStatus("Enregistrement sécurisé de la signature…", "loading");
      try {
        const upload = await auth.uploadDeliveryEvidence({ file: canvasBlob, organisationId: organisation.id, reservationId: activeContext.reservationId, inspectionId: activeContext.inspection.id, kind: "signature", idempotencyKey: pendingSignatureKey || (pendingSignatureKey = requestUuid(environment)) });
        if (!upload || !upload.ok || !upload.data || !upload.data.fileId) { showFieldError(signatureError, "Échec de l’envoi de la signature. Elle reste affichée; réessayez."); setStatus("Échec de l’enregistrement de la signature. Elle reste affichée; réessayez.", "error"); return; }
        pendingSignatureFileId = upload.data.fileId;
        const findings = activeContext.inspection.subjects.some((unit) => ["minor_issue", "damaged"].includes(unit.condition) || unit.checklist.some((item) => item.result === "issue"));
        const linked = await auth.attachDeliveryEvidence(activeJobId, pendingSignatureFileId, "signature", null, String(name.value).trim(), Boolean(acknowledgement && acknowledgement.checked));
        if (!linked || !linked.ok || !linked.data || linked.data.attached !== true) { const message = findings && !(acknowledgement && acknowledgement.checked) ? "Le client doit reconnaître les anomalies avant de signer." : "Échec de l’association de la signature. Le tracé et le fichier restent disponibles pour réessayer."; showFieldError(signatureError, message); setStatus(message, "error"); return; }
        // attachDeliveryEvidence is the durable server confirmation. A follow-up
        // read supplies the canonical timestamp and restores the saved state.
        if (saveButton) { saveButton.disabled = true; saveButton.textContent = "✓ Signature enregistrée"; }
        setStatus("✓ Signature enregistrée côté serveur. Vérification de l’heure serveur…", "success");
        try {
          const fresh = await loadContext();
          const evidence = fresh.handover && fresh.handover.signatureEvidence;
          if (evidence && evidence.fileId === pendingSignatureFileId && evidence.savedAt && fresh.handover.signedAt) {
            pendingSignatureFileId = null; pendingSignatureKey = null;
            renderWorkflow(fresh);
            setStatus(`✓ Signature enregistrée · ${formatServerTime(evidence.savedAt)} (heure de Paris).`, "success");
          }
        } catch { /* Preserve the canvas and field values; reconcile can read the saved state later. */ }
      } catch { showFieldError(signatureError, "Échec de l’association de la signature. Le tracé est conservé; vérifiez la connexion puis réessayez."); setStatus("Échec de l’enregistrement de la signature. Le tracé et les champs restent affichés.", "error"); }
      finally { if (saveButton && saveButton.textContent === "Enregistrement…") { saveButton.disabled = false; saveButton.textContent = "Réessayer l’enregistrement de la signature"; } finishAction(actionKey, saveButton && saveButton.textContent === "✓ Signature enregistrée" ? null : saveButton); }
    }
    function validateConfirmation(context, validation) {
      const errors = [];
      validation.replaceChildren();
      validation.hidden = true;
      if (!context || !context.handover || context.handover.status !== "in_progress") errors.push("La vérification du client ou la préparation de la remise manque. Reprenez la remise depuis le planning.");
      if (context && (context.paymentStatus !== "paid" || !["confirmed", "ongoing"].includes(context.reservationStatus))) errors.push("La réservation n’est plus éligible à la remise. Contactez un responsable.");
      const subjects = context && context.inspection && Array.isArray(context.inspection.subjects) ? context.inspection.subjects : [];
      if (!subjects.length) errors.push("Aucun équipement n’est lié à cette inspection. La remise ne peut pas être confirmée.");
      for (const unit of subjects) {
        const card = [...result.querySelectorAll("[data-machine-id]")].find((node) => node.dataset.machineId === unit.machineId);
        if (!unit.equipmentVerified) {
          const message = "Scannez l’équipement réservé et enregistrez sa vérification.";
          showFieldError(card && [...card.querySelectorAll("[data-equipment-error]")].find((node) => node.dataset.equipmentError === unit.subjectId), message);
          errors.push(`${unit.productName || "Équipement"} : identifiant non vérifié.`);
        }
        if (!unit.condition || unit.condition === "not_tested") {
          showFieldError(card && [...card.querySelectorAll("[data-condition-error]")].find((node) => node.dataset.conditionError === unit.subjectId), "Choisissez et enregistrez l’état constaté.");
          errors.push(`${unit.productName || "Équipement"} : état constaté manquant.`);
        }
        const checklist = Array.isArray(unit.checklist) ? unit.checklist : [];
        if (!checklist.length) {
          showFieldError(card && [...card.querySelectorAll("[data-checklist-error]")].find((node) => node.dataset.checklistError === unit.subjectId), "Aucun point de contrôle n’est configuré. Demandez au responsable de configurer la checklist avant de terminer la remise.");
          errors.push(`${unit.productName || "Équipement"} : checklist de livraison non configurée.`);
        } else if (checklist.some((item) => !item.result || item.result === "not_checked")) {
          showFieldError(card && [...card.querySelectorAll("[data-checklist-error]")].find((node) => node.dataset.checklistError === unit.subjectId), "Enregistrez chaque point de contrôle affiché.");
          errors.push(`${unit.productName || "Équipement"} : points de contrôle incomplets.`);
        }
        if (!unit.photoEvidence || !unit.photoEvidence.fileId || !unit.photoEvidence.savedAt) {
          const message = "La photo doit être associée et confirmée par le serveur avant la remise.";
          showFieldError(card && [...card.querySelectorAll("[data-photo-error]")].find((node) => node.dataset.photoError === "true"), message);
          errors.push(`${unit.productName || "Équipement"} : photo enregistrée manquante.`);
        }
      }
      const handover = context && context.handover;
      if (!handover || !handover.signatureEvidence || !handover.signatureEvidence.fileId || !handover.signatureEvidence.savedAt || !handover.signedAt) {
        errors.push("La signature du client n’est pas enregistrée et confirmée par le serveur.");
        const signatureError = [...result.querySelectorAll("[data-signature-error]")].find((node) => node.dataset.signatureError === "true");
        showFieldError(signatureError, "Enregistrez la signature du client avant la confirmation.");
      }
      if (handover && context && subjects.some((unit) => ["minor_issue", "damaged"].includes(unit.condition) || (unit.checklist || []).some((item) => item.result === "issue")) && !handover.findingsAcknowledged) {
        errors.push("Le client doit reconnaître les anomalies avant la confirmation.");
      }
      if (errors.length) {
        validation.hidden = false;
        textNode(validation, "strong", "À compléter avant de confirmer :");
        const list = document.createElement("ul");
        for (const message of errors) textNode(list, "li", message);
        validation.append(list);
        setStatus("La remise reste en cours. Complétez les éléments indiqués; aucune confirmation n’a été envoyée.", "error");
        return false;
      }
      return true;
    }

    async function confirm(context, note, confirmButton, validation) {
      const actionKey = "confirm";
      if (!actionAvailable(actionKey)) return;
      if (confirmButton) confirmButton.disabled = true;
      setStatus("Vérification des éléments enregistrés côté serveur…", "loading");
      try {
        const fresh = await loadContext();
        if (!validateConfirmation(fresh, validation)) return;
        if (!UUID.test(String(fresh.handover.idempotencyKey || ""))) { setStatus("La remise doit être actualisée avant confirmation.", "error"); return; }
        if (confirmButton) confirmButton.textContent = "Confirmation en cours…";
        setStatus("Confirmation sécurisée en cours…", "loading");
        const response = await auth.confirmDeliveryHandover(activeJobId, fresh.jobVersion, fresh.handover.idempotencyKey);
        if (!response || !response.ok || !response.data || response.data.status !== "confirmed") {
          const message = response && response.status === 401 ? "Votre session a expiré. Reconnectez-vous; vos champs sont conservés."
            : response && response.status === 403 ? "Vous n’êtes pas autorisé à confirmer cette remise. Contactez un responsable."
              : response && [400, 409, 422].includes(response.status) ? "Le serveur refuse la confirmation. Vérifiez les champs signalés et actualisez l’état de la remise."
                : "La confirmation n’a pas été reçue. Vos champs restent affichés; vérifiez la connexion puis contrôlez l’état serveur.";
          setStatus(message, "error");
          if (validation) { validation.hidden = false; textNode(validation, "p", message); }
          return;
        }
        // Never display completion from a local click or a lost response. A
        // fresh protected read must confirm the persisted terminal state.
        const completed = await loadContext();
        if (completed.handover && completed.handover.status === "confirmed" && completed.handover.confirmedAt) {
          renderCompletedScreen(completed);
          setStatus("Remise terminée et confirmée par le serveur.", "success");
          await refreshBoard();
        } else {
          setStatus("Le serveur n’a pas encore confirmé la remise. Vos champs restent affichés; vérifiez à nouveau le statut.", "error");
        }
      } catch {
        setStatus("La réponse a été interrompue. Aucune page de fin n’est affichée; vos champs restent conservés. Vérifiez le statut côté serveur avant toute nouvelle tentative.", "error");
      } finally {
        if (confirmButton) { confirmButton.disabled = false; confirmButton.textContent = "Confirmer la remise"; }
        finishAction(actionKey);
      }
    }
    async function reloadWorkflow(message = "") {
      const context = await loadContext(); renderWorkflow(context); if (message) setStatus(message, "success");
    }
    async function progressDelivery(buttonNode) {
      const jobId = buttonNode.dataset.serviceJobId;
      const target = buttonNode.dataset.deliveryProgress;
      if (!UUID.test(String(jobId || "")) || !["en_route", "arrived"].includes(target)) return;
      buttonNode.disabled = true;
      try {
        const context = await auth.getDeliveryHandover(jobId);
        if (!context || !context.ok || !context.data) throw new Error("job unavailable");
        const response = await auth.progressDelivery(jobId, context.data.jobVersion, target);
        if (!response || !response.ok) { setStatus(errorMessage(response && response.status), "error"); return; }
        await refreshBoard();
      } catch { setStatus("Le statut de la livraison n’a pas changé. Actualisez le planning.", "error"); }
      finally { buttonNode.disabled = false; }
    }
    async function open(job) {
      if (!job || !job.serviceJobId || job.type !== "delivery") return false;
      const permittedStatus = ACTIVE_JOB_STATUSES.has(job.status);
      if (!permittedStatus) return false;
      // Rapid repeated taps on mobile should not fan out duplicate protected
      // reads or let a slower response replace a different job's panel.
      if (openingJobId) return openingJobId === job.serviceJobId;
      openingJobId = job.serviceJobId;
      try {
        stopCamera(); clearCredentials(); clearResult(); activeJobId = job.serviceJobId; activeJobDate = job.scheduledDate; activeContext = null;
        pendingSignatureFileId = null; pendingSignatureKey = null;
        panel.hidden = false;
        // The panel follows the full operations list. On mobile, without this
        // scroll a successful resume can look like an inert button because the
        // opened panel and its status sit below the fold.
        if (panel && typeof panel.scrollIntoView === "function") {
          panel.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        const summary = byId("handover-job-summary");
        if (summary) summary.textContent = `Réservation ${job.reservationReference || "—"} · ${String(job.scheduledDate || "").split("-").reverse().join("/")}`;
        const existing = await showExistingWorkflow();
        if (existing === true || existing === null) return true;
        setStatus("Demandez au client de présenter son QR code ou son code à 8 chiffres.", "info");
        codeInput && codeInput.focus && codeInput.focus();
        return true;
      } finally {
        openingJobId = null;
      }
    }
    function close(options = {}) {
      stopCamera(); clearCredentials(); clearResult(); activeJobId = null; activeContext = null;
      activeJobDate = null;
      pendingSignatureFileId = null; pendingSignatureKey = null;
      if (options.preserveResume !== true) clearResumeMarker();
      if (panel) panel.hidden = true;
      setStatus("Demandez au client de présenter son code.", "info");
    }
    async function resumePendingFromBoard(board) {
      const marker = readResumeMarker();
      if (!marker || !board || !board.metadata || board.metadata.selectedDate !== marker.scheduledDate) return false;
      const job = Array.isArray(board.jobs) && board.jobs.find((item) => item && item.serviceJobId === marker.serviceJobId);
      if (!job) return false;
      if (!canVerifyDelivery(job)) { clearResumeMarker(); return false; }
      const opened = await open(job);
      if (opened && activeContext && activeContext.handover && activeContext.handover.status === "in_progress" && marker.unsaved) {
        setStatus("La page a été interrompue. Les données enregistrées ont été rechargées; les modifications non enregistrées peuvent avoir été perdues. Vérifiez les champs avant de continuer.", "error");
      }
      return opened;
    }
    function pendingResumeDate() {
      const marker = readResumeMarker();
      return marker ? marker.scheduledDate : null;
    }
    function confirmNavigationAway() {
      if (!hasUnsavedValues()) return true;
      return typeof global.confirm === "function" && global.confirm("Des modifications ne sont pas enregistrées. Si vous quittez maintenant, les champs enregistrés côté serveur pourront être rechargés, mais les autres devront être ressaisis. Continuer ?");
    }
    function requestClose() {
      if (!confirmNavigationAway()) return false;
      close(); return true;
    }
    async function scanLoop(detector) {
      if (!scanning || !video || !stream) return;
      try {
        const codes = await detector.detect(video);
        const value = codes && codes[0] && String(codes[0].rawValue || "");
        if (value) {
          const target = scanTarget; stopCamera();
          if (target && target.kind === "equipment") { if (target.input) target.input.value = value.slice(0,120); await verifyEquipment({ machineId: target.machineId }, value); return; }
          if (!QR_TOKEN.test(value)) { setStatus("Ce QR code n’est pas un code client valide. Essayez le code à 8 chiffres.", "error"); return; }
          await verify("qr_token", value); return;
        }
      } catch { stopCamera(); setStatus("Impossible de lire le QR code. Utilisez la saisie manuelle.", "error"); return; }
      if (scanning) timer = (environment.setTimeout || global.setTimeout)(() => void scanLoop(detector), 250);
    }
    async function startScan(target = { kind: "customer" }) {
      if (!activeJobId) return;
      if (!Detector || !mediaDevices || typeof mediaDevices.getUserMedia !== "function") { setStatus("Le scan QR n’est pas disponible sur cet appareil. Utilisez la saisie manuelle.", "error"); return; }
      stopCamera(); scanTarget = target; setStatus("Autorisez l’accès à la caméra pour scanner le QR code.", "info");
      try {
        stream = await mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (!activeJobId) { stopCamera(); return; }
        video.srcObject = stream; video.hidden = false; await video.play();
        const detector = new Detector({ formats: ["qr_code"] }); scanning = true;
        setStatus(target.kind === "equipment" ? "Placez le QR de l’équipement dans le cadre." : "Placez le QR du client dans le cadre.", "loading");
        await scanLoop(detector);
      } catch (error) {
        stopCamera(); const denied = error && ["NotAllowedError", "PermissionDeniedError"].includes(error.name);
        setStatus(denied ? "Accès à la caméra refusé. Utilisez la saisie manuelle." : "Caméra indisponible. Utilisez la saisie manuelle.", "error");
      }
    }
    function onJobsClick(event) {
      const progress = event.target && event.target.closest && event.target.closest("[data-delivery-progress]");
      if (progress) { event.preventDefault(); void progressDelivery(progress); return; }
      const target = event.target && event.target.closest && event.target.closest("[data-verify-delivery]");
      if (!target) return;
      event.preventDefault();
      const board = global.IGLOUE_ADMIN_APP_CONTROLLER && global.IGLOUE_ADMIN_APP_CONTROLLER.getState().board;
      const job = board && Array.isArray(board.jobs) && board.jobs.find((item) => item.serviceJobId === target.dataset.verifyDelivery);
      void open(job);
    }
    function onCodeSubmit(event) {
      event.preventDefault(); const code = String(codeInput && codeInput.value || ""); clearCredentials();
      if (!/^\d{8}$/.test(code)) { setStatus("Saisissez les 8 chiffres du code client.", "error"); return; }
      void verify("numeric_code", code);
    }
    function init() {
      jobs && jobs.addEventListener("click", onJobsClick);
      result && ["input", "change", "pointerdown"].forEach((eventName) => result.addEventListener(eventName, noteDraftChange));
      const closeButton = byId("handover-close"); closeButton && closeButton.addEventListener("click", requestClose);
      scanButton && scanButton.addEventListener("click", () => void startScan());
      const codeForm = byId("handover-code-form"); codeForm && codeForm.addEventListener("submit", onCodeSubmit);
      global.addEventListener && global.addEventListener("pagehide", onPageHide);
      global.addEventListener && global.addEventListener("beforeunload", onBeforeUnload);
    }
    return Object.freeze({ init, open, close, verify, canVerifyDelivery, normalizePhoto, resumePendingFromBoard, pendingResumeDate, hasUnsavedValues, confirmNavigationAway });
  }

  global.IGLOUE_HANDOVER_VERIFICATION = Object.freeze({ createController, canVerifyDelivery });
})(window);
