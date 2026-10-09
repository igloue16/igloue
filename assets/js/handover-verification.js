(function installHandoverVerification(global) {
  "use strict";

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const QR_TOKEN = /^hv1\.[A-Za-z0-9_-]{43}$/;
  const STAFF_JOB_STATUSES = new Set(["assigned", "en_route", "arrived", "handover_in_progress"]);

  function requestUuid(environment) {
    if (typeof environment.randomUUID === "function") return environment.randomUUID();
    if (global.crypto && typeof global.crypto.randomUUID === "function") return global.crypto.randomUUID();
    if (!global.crypto || typeof global.crypto.getRandomValues !== "function") return "";
    const bytes = global.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = bytes[6] & 0x0f | 0x40;
    bytes[8] = bytes[8] & 0x3f | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function canVerifyDelivery(job) {
    return Boolean(job && job.type === "delivery" && UUID.test(String(job.serviceJobId || "")) &&
      STAFF_JOB_STATUSES.has(String(job.status || "")) && job.state !== "completed" && job.state !== "cancelled");
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
    let activeJobId = null;

    function setStatus(message, kind = "info") {
      if (!status) return;
      status.textContent = message;
      status.dataset.state = kind;
    }

    function stopCamera() {
      scanning = false;
      if (timer !== null) {
        (environment.clearTimeout || global.clearTimeout)(timer);
        timer = null;
      }
      if (stream) {
        for (const track of stream.getTracks()) track.stop();
        stream = null;
      }
      if (video) {
        video.pause && video.pause();
        video.srcObject = null;
        video.hidden = true;
      }
    }

    function clearCredentials() {
      if (codeInput) codeInput.value = "";
    }

    function clearResult() {
      if (result) {
        result.replaceChildren();
        result.hidden = true;
        result.className = "handover-result";
      }
    }

    function appendText(parent, tag, text, className) {
      const node = document.createElement(tag);
      node.textContent = text;
      if (className) node.className = className;
      parent.append(node);
      return node;
    }

    function displaySuccess(value) {
      if (!result) return;
      result.replaceChildren();
      result.hidden = false;
      result.className = "handover-result handover-result-success";
      appendText(result, "h3", "Client vérifié — vous pouvez poursuivre la remise.");
      appendText(result, "p", `Réservation ${value.reservation_reference}`);
      const date = String(value.schedule.date).split("-").reverse().join("/");
      const slot = value.schedule.time_slot ? ` · ${value.schedule.time_slot}` : "";
      appendText(result, "p", `Livraison prévue le ${date}${slot}.`);
      const list = document.createElement("ul");
      for (const item of value.equipment) {
        const detail = item.serial_number ? ` · ${item.serial_number}` : "";
        appendText(list, "li", `${item.product_name}${detail}`);
      }
      result.append(list);
    }

    function errorMessage(httpStatus) {
      if (httpStatus === 401) return "Votre session a expiré. Reconnectez-vous puis réessayez.";
      if (httpStatus === 403) return "Vous n’êtes pas autorisé à vérifier cette livraison.";
      if (httpStatus === 422 || httpStatus === 400) return "Code invalide, expiré, révoqué ou déjà utilisé. Demandez au client de vérifier son code.";
      return "La vérification est indisponible. Vérifiez la connexion puis réessayez.";
    }

    async function verify(credentialType, credential) {
      stopCamera();
      clearResult();
      clearCredentials();
      if (!activeJobId || !auth || typeof auth.verifyCustomerHandover !== "function") {
        setStatus("La vérification est indisponible. Fermez le panneau et actualisez le planning.", "error");
        return false;
      }
      if (submitButton) submitButton.disabled = true;
      if (scanButton) scanButton.disabled = true;
      setStatus("Vérification en cours…", "loading");
      try {
        const requestId = requestUuid(environment);
        if (!UUID.test(requestId)) {
          setStatus("La vérification est indisponible sur cet appareil. Actualisez le planning puis réessayez.", "error");
          return false;
        }
        const response = await auth.verifyCustomerHandover({
          serviceJobId: activeJobId,
          credentialType,
          credential,
          requestId
        });
        if (!response || response.ok !== true || !response.data) {
          setStatus(errorMessage(response && response.status), "error");
          return false;
        }
        displaySuccess(response.data);
        setStatus("Vérification réussie. Aucune donnée de réservation ou d’équipement n’a été modifiée.", "success");
        return true;
      } catch {
        setStatus(errorMessage(0), "error");
        return false;
      } finally {
        clearCredentials();
        if (submitButton) submitButton.disabled = false;
        if (scanButton) scanButton.disabled = false;
        stopCamera();
      }
    }

    async function scanLoop(detector) {
      if (!scanning || !video || !stream) return;
      try {
        const codes = await detector.detect(video);
        const value = codes && codes[0] && String(codes[0].rawValue || "");
        if (value) {
          stopCamera();
          if (!QR_TOKEN.test(value)) {
            setStatus("Ce QR code n’est pas un code de livraison valide. Essayez le code à 8 chiffres.", "error");
            return;
          }
          await verify("qr_token", value);
          return;
        }
      } catch {
        stopCamera();
        setStatus("Impossible de lire le QR code. Saisissez le code à 8 chiffres.", "error");
        return;
      }
      if (scanning) timer = (environment.setTimeout || global.setTimeout)(() => void scanLoop(detector), 250);
    }

    async function startScan() {
      if (!activeJobId) return;
      if (!Detector || !mediaDevices || typeof mediaDevices.getUserMedia !== "function") {
        setStatus("Le scan QR n’est pas disponible sur cet appareil. Saisissez le code à 8 chiffres.", "error");
        return;
      }
      stopCamera();
      clearResult();
      setStatus("Autorisez l’accès à la caméra pour scanner le QR code.", "info");
      try {
        stream = await mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (!activeJobId) { stopCamera(); return; }
        video.srcObject = stream;
        video.hidden = false;
        await video.play();
        const detector = new Detector({ formats: ["qr_code"] });
        scanning = true;
        setStatus("Placez le QR code du client dans le cadre.", "loading");
        await scanLoop(detector);
      } catch (error) {
        stopCamera();
        const denied = error && ["NotAllowedError", "PermissionDeniedError"].includes(error.name);
        setStatus(denied
          ? "Accès à la caméra refusé. Saisissez le code à 8 chiffres."
          : "Caméra indisponible. Saisissez le code à 8 chiffres.", "error");
      }
    }

    function open(job) {
      if (!canVerifyDelivery(job)) return false;
      stopCamera();
      clearCredentials();
      clearResult();
      activeJobId = job.serviceJobId;
      panel.hidden = false;
      const summary = byId("handover-job-summary");
      if (summary) summary.textContent = `Réservation ${job.reservationReference || "—"} · ${String(job.scheduledDate || "").split("-").reverse().join("/")}`;
      setStatus("Demandez au client de présenter son QR code ou son code à 8 chiffres.", "info");
      codeInput && codeInput.focus && codeInput.focus();
      return true;
    }

    function close() {
      stopCamera();
      clearCredentials();
      clearResult();
      activeJobId = null;
      if (panel) panel.hidden = true;
      setStatus("Demandez au client de présenter son code.", "info");
    }

    function onJobsClick(event) {
      const target = event.target && event.target.closest && event.target.closest("[data-verify-delivery]");
      if (!target) return;
      event.preventDefault();
      const board = global.IGLOUE_ADMIN_APP_CONTROLLER && global.IGLOUE_ADMIN_APP_CONTROLLER.getState().board;
      const job = board && Array.isArray(board.jobs) && board.jobs.find((item) => item.serviceJobId === target.dataset.verifyDelivery);
      open(job);
    }

    function onCodeSubmit(event) {
      event.preventDefault();
      const code = String(codeInput && codeInput.value || "");
      clearCredentials();
      if (!/^\d{8}$/.test(code)) {
        setStatus("Saisissez les 8 chiffres du code client.", "error");
        return;
      }
      void verify("numeric_code", code);
    }

    function init() {
      jobs && jobs.addEventListener("click", onJobsClick);
      const closeButton = byId("handover-close");
      closeButton && closeButton.addEventListener("click", close);
      scanButton && scanButton.addEventListener("click", () => void startScan());
      const codeForm = byId("handover-code-form");
      codeForm && codeForm.addEventListener("submit", onCodeSubmit);
      global.addEventListener && global.addEventListener("pagehide", close);
    }

    return Object.freeze({ init, open, close, verify, canVerifyDelivery });
  }

  global.IGLOUE_HANDOVER_VERIFICATION = Object.freeze({ createController, canVerifyDelivery });
})(window);
