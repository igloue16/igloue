(function installHandoverVerification(global) {
  "use strict";

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const QR_TOKEN = /^hv1\.[A-Za-z0-9_-]{43}$/;
  const ACTIVE_JOB_STATUSES = new Set(["arrived", "handover_in_progress"]);

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
    let activeContext = null;
    let pendingSignatureFileId = null;
    let pendingSignatureKey = null;

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
        const photoStatus = unit.photoAttached ? "Photo de l’équipement enregistrée." : "Ajouter une photo de l’équipement.";
        textNode(card, "p", photoStatus, unit.photoAttached ? "handover-complete-note" : "handover-hint");
        if (!unit.photoAttached) {
          const file = document.createElement("input"); file.type = "file"; file.accept = "image/jpeg,image/png"; file.setAttribute("capture", "environment"); file.className = "handover-input";
          field(card, "Photo de l’état", file);
          button(card, "Enregistrer la photo", () => void uploadPhoto(unit, file));
        }
        button(card, "Enregistrer le contrôle", () => void saveInspection(unit, condition, card), "handover-secondary");
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
      canvas.addEventListener("pointerdown", (event) => { drawing = true; drew = true; canvas.setPointerCapture && canvas.setPointerCapture(event.pointerId); const p = point(event); ctx.beginPath(); ctx.moveTo(p.x,p.y); });
      canvas.addEventListener("pointermove", (event) => { if (!drawing) return; const p = point(event); ctx.lineTo(p.x,p.y); ctx.stroke(); });
      const end = () => { drawing = false; };
      canvas.addEventListener("pointerup", end); canvas.addEventListener("pointercancel", end); canvas.addEventListener("pointerleave", end);
      return { hasInk: () => drew, clear: () => { ctx.clearRect(0,0,width,180); drew=false; } };
    }

    function renderWorkflow(context) {
      if (!result) return;
      result.replaceChildren(); result.hidden = false; result.className = "handover-result handover-result-workflow";
      textNode(result, "h3", "Remise de l’équipement");
      textNode(result, "p", `Réservation ${context.reservationReference} · ${String(context.scheduledDate || "").split("-").reverse().join("/")} · ${context.timeSlot || "Horaire non renseigné"}`);
      textNode(result, "p", [context.address && context.address.line1, context.address && context.address.postcode, context.address && context.address.city].filter(Boolean).join(" · "));
      if (context.handover && context.handover.status === "confirmed") {
        textNode(result, "p", "Cette remise est confirmée par le serveur.", "handover-confirmed");
        button(result, "Actualiser le planning", () => void refreshBoard(), "handover-secondary");
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
        const name = document.createElement("input"); name.type = "text"; name.maxLength = 160; name.autocomplete = "name"; name.className = "handover-input";
        field(result, "Nom du client signataire", name);
        const canvas = document.createElement("canvas"); canvas.className = "handover-signature-canvas"; canvas.setAttribute("aria-label", "Zone de signature du client");
        result.append(canvas);
        const signature = drawSignatureCanvas(canvas);
        button(result, "Effacer la signature", () => signature.clear(), "handover-secondary");
        let acknowledgement = null;
        if (findings) {
          acknowledgement = document.createElement("input"); acknowledgement.type = "checkbox";
          const label = document.createElement("label"); label.className = "handover-acknowledgement"; label.append(acknowledgement); textNode(label, "span", "Je confirme avoir lu les observations ci-dessus."); result.append(label);
        }
        button(result, "Enregistrer la signature du client", () => void saveSignature(canvas, signature, name, acknowledgement, note));
      } else {
        textNode(result, "p", `Signature enregistrée au nom de ${context.handover.signedName || "client"}.`, "handover-complete-note");
        if (context.handover.findingsAcknowledged) textNode(result, "p", "Les observations ont été reconnues par le client.");
      }
      button(result, "Confirmer la remise", () => void confirm(context, note), "handover-confirm-button");
    }

    async function showExistingWorkflow() {
      setStatus("Chargement de la remise enregistrée…", "loading");
      try {
        const context = await loadContext();
        if (context.handover && ["in_progress", "confirmed"].includes(context.handover.status)) {
          renderWorkflow(context); setStatus(context.handover.status === "confirmed" ? "Remise confirmée." : "Reprise de la remise enregistrée.", "success"); return true;
        }
      } catch { /* new handover still requires fresh customer verification */ }
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
    async function saveInspection(unit, condition, card) {
      if (!condition.value || condition.value === "not_tested") { setStatus("Contrôlez et choisissez l’état de chaque équipement.", "error"); return; }
      const checklist = [...card.querySelectorAll("[data-checklist-key]")].map((item) => ({ item_key: item.dataset.checklistKey, result: item.value, note: null }));
      if (checklist.some((item) => item.result === "not_checked")) { setStatus("Terminez chaque point de contrôle affiché.", "error"); return; }
      try {
        const saved = await auth.updateDeliveryInspection(activeJobId, unit.subjectId, condition.value,
          String(result.querySelector("textarea")?.value || "").trim() || null, checklist);
        if (!saved || saved.ok !== true) { setStatus("Le contrôle n’a pas été enregistré. Vérifiez la connexion.", "error"); return; }
        await reloadWorkflow("État et observations enregistrés.");
      } catch { setStatus("Le contrôle n’a pas été enregistré. Réessayez.", "error"); }
    }
    async function uploadPhoto(unit, input) {
      const file = input.files && input.files[0];
      if (!file || !["image/jpeg", "image/png"].includes(file.type) || file.size > 10 * 1024 * 1024) { setStatus("Choisissez une photo JPG ou PNG de 10 Mo maximum.", "error"); return; }
      try {
        const upload = await auth.uploadDeliveryEvidence({ file, organisationId: (await auth.getSelectedOrganisation()).id, reservationId: activeContext.reservationId, inspectionId: activeContext.inspection.id, kind: "delivery_photo", idempotencyKey: requestUuid(environment) });
        input.value = "";
        if (!upload || upload.ok !== true) { setStatus("La photo privée n’a pas été téléversée.", "error"); return; }
        const linked = await auth.attachDeliveryEvidence(activeJobId, upload.data.fileId, "delivery_photo", unit.machineId);
        if (!linked || linked.ok !== true) { setStatus("Photo téléversée mais liaison incomplète. Le contrôle reste à reprendre.", "error"); return; }
        await reloadWorkflow("Photo enregistrée dans le dossier privé de la remise.");
      } catch { input.value = ""; setStatus("La photo n’a pas pu être enregistrée. Réessayez.", "error"); }
    }
    async function saveSignature(canvas, signature, name, acknowledgement, note) {
      if (!signature.hasInk() || !String(name.value || "").trim()) { setStatus("Saisissez le nom du client et recueillez sa signature.", "error"); return; }
      const checkboxes = result.querySelectorAll("[data-condition-for]");
      for (const select of checkboxes) {
        if (!select.value) { setStatus("Enregistrez l’état de chaque équipement avant la signature.", "error"); return; }
      }
      const subjects = activeContext.inspection.subjects;
      for (const unit of subjects) {
        const card = [...result.querySelectorAll("[data-machine-id]")].find((item) => item.dataset.machineId === unit.machineId);
        const condition = card && card.querySelector("[data-condition-for]");
        if (!unit.equipmentVerified || !condition || !condition.value || !unit.photoAttached) { setStatus("Identifiez, contrôlez et photographiez chaque équipement avant la signature.", "error"); return; }
        const checklist = [...card.querySelectorAll("[data-checklist-key]")].map((item) => ({ item_key: item.dataset.checklistKey, result: item.value, note: null }));
        const saved = await auth.updateDeliveryInspection(activeJobId, unit.subjectId, condition.value, String(note.value || "").trim() || null, checklist);
        if (!saved || !saved.ok) { setStatus("Enregistrez tous les contrôles avant la signature.", "error"); return; }
      }
      const latest = await loadContext();
      const hasFindings = latest.inspection.subjects.some((unit) => ["minor_issue", "damaged"].includes(unit.condition) || unit.checklist.some((item) => item.result === "issue"));
      if (hasFindings && !(acknowledgement && acknowledgement.checked)) { renderWorkflow(latest); setStatus("Le client doit reconnaître les anomalies avant de signer.", "error"); return; }
      const canvasBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!canvasBlob) { setStatus("La signature ne peut pas être préparée sur cet appareil.", "error"); return; }
      const organisation = await auth.getSelectedOrganisation();
      try {
        const upload = await auth.uploadDeliveryEvidence({ file: canvasBlob, organisationId: organisation.id, reservationId: activeContext.reservationId, inspectionId: activeContext.inspection.id, kind: "signature", idempotencyKey: pendingSignatureKey || (pendingSignatureKey = requestUuid(environment)) });
        if (!upload || !upload.ok) { setStatus("La signature privée n’a pas pu être enregistrée.", "error"); return; }
        pendingSignatureFileId = upload.data.fileId;
        const findings = activeContext.inspection.subjects.some((unit) => ["minor_issue", "damaged"].includes(unit.condition) || unit.checklist.some((item) => item.result === "issue"));
        const linked = await auth.attachDeliveryEvidence(activeJobId, pendingSignatureFileId, "signature", null, String(name.value).trim(), Boolean(acknowledgement && acknowledgement.checked));
        if (!linked || !linked.ok) { setStatus(findings && !(acknowledgement && acknowledgement.checked) ? "Le client doit reconnaître les anomalies avant de signer." : "Signature téléversée mais liaison incomplète. Réessayez sans recommencer.", "error"); return; }
        pendingSignatureFileId = null; pendingSignatureKey = null;
        await reloadWorkflow("Signature du client enregistrée.");
      } catch { setStatus("La signature n’a pas pu être associée à la remise. Réessayez.", "error"); }
    }
    async function confirm(context, note) {
      if (!context.handover || !UUID.test(String(context.handover.idempotencyKey || ""))) { setStatus("La remise doit être actualisée avant confirmation.", "error"); return; }
      setStatus("Confirmation sécurisée en cours…", "loading");
      try {
        const response = await auth.confirmDeliveryHandover(activeJobId, context.jobVersion, context.handover.idempotencyKey);
        if (!response || !response.ok || !response.data || response.data.status !== "confirmed") { setStatus("La remise n’est pas confirmée. Vérifiez les contrôles, les photos et la signature.", "error"); await reloadWorkflow(); return; }
        await reloadWorkflow("Remise confirmée et enregistrée par le serveur.");
        await refreshBoard();
      } catch { setStatus("La réponse est interrompue. Actualisez la remise pour vérifier son statut côté serveur.", "error"); }
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
      stopCamera(); clearCredentials(); clearResult(); activeJobId = job.serviceJobId; activeContext = null;
      pendingSignatureFileId = null; pendingSignatureKey = null;
      panel.hidden = false;
      const summary = byId("handover-job-summary");
      if (summary) summary.textContent = `Réservation ${job.reservationReference || "—"} · ${String(job.scheduledDate || "").split("-").reverse().join("/")}`;
      if (await showExistingWorkflow()) return true;
      setStatus("Demandez au client de présenter son QR code ou son code à 8 chiffres.", "info");
      codeInput && codeInput.focus && codeInput.focus();
      return true;
    }
    function close() {
      stopCamera(); clearCredentials(); clearResult(); activeJobId = null; activeContext = null;
      pendingSignatureFileId = null; pendingSignatureKey = null;
      if (panel) panel.hidden = true;
      setStatus("Demandez au client de présenter son code.", "info");
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
      const closeButton = byId("handover-close"); closeButton && closeButton.addEventListener("click", close);
      scanButton && scanButton.addEventListener("click", () => void startScan());
      const codeForm = byId("handover-code-form"); codeForm && codeForm.addEventListener("submit", onCodeSubmit);
      global.addEventListener && global.addEventListener("pagehide", close);
    }
    return Object.freeze({ init, open, close, verify, canVerifyDelivery });
  }

  global.IGLOUE_HANDOVER_VERIFICATION = Object.freeze({ createController, canVerifyDelivery });
})(window);
