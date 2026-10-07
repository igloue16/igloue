(function customerEmailVerification(global) {
  "use strict";

  const MESSAGES = Object.freeze({
    ready:
      "Vous pouvez demander un code envoyé à l’adresse enregistrée pour cette réservation.",
    code_sent:
      "Code envoyé. Saisissez les six chiffres reçus par e-mail. Il est valable dix minutes après son émission.",
    already_verified: "Cette adresse e-mail est déjà vérifiée.",
    verified: "Adresse e-mail vérifiée.",
    verification_rate_limited:
      "Veuillez patienter avant de demander un nouveau code.",
    rate_limited: "Veuillez patienter avant de demander un nouveau code.",
    verification_code_invalid:
      "Ce code est invalide, expiré ou déjà utilisé. Demandez un nouveau code si nécessaire.",
    delivery_unavailable:
      "L’e-mail n’a pas pu être envoyé. Attendez une minute avant de réessayer.",
    delivery_status_unknown:
      "L’envoi n’a pas pu être confirmé. Vérifiez votre boîte e-mail avant de demander un autre code.",
    proof_invalid:
      "La session de réservation n’est plus valide. Recommencez votre demande.",
    server_error: "La vérification est indisponible pour le moment.",
    verification_status_unknown:
      "Le résultat n’a pas pu être confirmé. Contrôlez le statut avant de renvoyer un code.",
    invalid_request: "Vérifiez le code à six chiffres saisi.",
  });
  const SESSION_KEY = "igloue.customer-email-verification.v1";

  function createController(options) {
    let busy = false;
    let challengeId = options.initialChallengeId || null;
    let verified = false;
    let expiresInSeconds = 0;
    let resendAt = 0;
    let message = challengeId ? MESSAGES.code_sent : MESSAGES.ready;

    function state() {
      return {
        busy,
        verified,
        challengeId,
        message,
        expiresInSeconds,
        resendAfterSeconds: Math.max(
          0,
          Math.ceil((resendAt - Date.now()) / 1000),
        ),
        canRequest: !busy && !verified && Date.now() >= resendAt,
        canConfirm: !busy && !verified && Boolean(challengeId),
      };
    }

    function emit() {
      if (typeof options.onState === "function") options.onState(state());
    }

    async function perform(action, extra) {
      if (busy || verified) return false;
      busy = true;
      emit();
      let result;
      try {
        result = await options.send({ action, ...extra });
      } catch {
        result = { ok: false, code: "delivery_status_unknown" };
      }
      busy = false;
      if (
        result && result.ok === true && result.status === "already_verified"
      ) {
        verified = true;
        challengeId = null;
        message = MESSAGES.already_verified;
      } else if (
        result && result.ok === true && result.status === "code_sent" &&
        typeof result.challengeId === "string"
      ) {
        challengeId = result.challengeId;
        if (typeof options.onChallenge === "function") {
          options.onChallenge(challengeId);
        }
        expiresInSeconds = Number.isInteger(result.expiresInSeconds)
          ? result.expiresInSeconds
          : 600;
        resendAt = Date.now() +
          (Number.isInteger(result.resendAfterSeconds)
              ? result.resendAfterSeconds
              : 60) * 1000;
        message = MESSAGES.code_sent;
      } else if (result && result.ok === true && result.verified === true) {
        verified = true;
        challengeId = null;
        message = MESSAGES.verified;
      } else if (
        result && result.ok === true && result.status === "unverified"
      ) {
        message = MESSAGES.ready;
      } else {
        const code = result && typeof result.code === "string"
          ? result.code
          : "server_error";
        message = MESSAGES[code] || MESSAGES.server_error;
        if (
          action === "request" && typeof result.challengeId === "string" &&
          code === "delivery_status_unknown"
        ) {
          challengeId = result.challengeId;
          if (typeof options.onChallenge === "function") {
            options.onChallenge(challengeId);
          }
        } else if (
          action === "request" &&
          ["delivery_status_unknown", "delivery_unavailable"].includes(code)
        ) {
          challengeId = null;
          if (typeof options.onChallenge === "function") {
            options.onChallenge(null);
          }
        }
        if (["verification_rate_limited", "rate_limited"].includes(code)) {
          const retry = Number.isInteger(result.retryAfterSeconds)
            ? result.retryAfterSeconds
            : 60;
          resendAt = Date.now() + Math.max(1, Math.min(retry, 3600)) * 1000;
        }
      }
      emit();
      return result && result.ok === true;
    }

    return Object.freeze({
      state,
      refresh() {
        emit();
      },
      async checkStatus() {
        const result = await perform("status", {});
        if (!result && !verified) {
          message = MESSAGES.verification_status_unknown;
          emit();
        }
        return result;
      },
      requestCode() {
        if (!state().canRequest) return Promise.resolve(false);
        return perform("request", {});
      },
      confirm(code) {
        if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
          message = MESSAGES.invalid_request;
          emit();
          return Promise.resolve(false);
        }
        if (!state().canConfirm) return Promise.resolve(false);
        return perform("confirm", { challengeId, code });
      },
    });
  }

  function createApiSender(reservationId, capability, config, fetchImpl) {
    return async (payload) => {
      const gatewayUrl = String(config.verificationGatewayUrl || "").trim();
      if (!gatewayUrl) return { ok: false, code: "server_error" };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      try {
        const response = await (fetchImpl || global.fetch)(
          gatewayUrl,
          {
            method: "POST",
            headers: {
              apikey: config.publishableKey,
              "content-type": "application/json",
            },
            cache: "no-store",
            referrerPolicy: "no-referrer",
            signal: controller.signal,
            body: JSON.stringify({
              action: payload.action,
              reservationId,
              capability,
              ...(payload.challengeId
                ? { challengeId: payload.challengeId }
                : {}),
              ...(payload.code ? { code: payload.code } : {}),
            }),
          },
        );
        let value;
        try {
          value = await response.json();
        } catch {
          return { ok: false, code: "server_error" };
        }
        if (response.ok && value && value.ok === true) {
          if (value.status === "code_sent") {
            return {
              ok: true,
              status: value.status,
              challengeId: value.challengeId,
              expiresInSeconds: value.expires_in_seconds,
              resendAfterSeconds: value.resend_after_seconds,
            };
          }
          if (value.status === "already_verified") {
            return { ok: true, status: value.status };
          }
          if (value.status === "unverified") {
            return { ok: true, status: value.status };
          }
          if (value.verified === true) return { ok: true, verified: true };
        }
        const detail = value && value.error;
        return {
          ok: false,
          code: detail && typeof detail.code === "string"
            ? detail.code
            : "server_error",
          retryAfterSeconds: detail && detail.retry_after_seconds,
          challengeId: payload.action === "request" &&
              typeof value.challengeId === "string"
            ? value.challengeId
            : undefined,
        };
      } catch {
        return {
          ok: false,
          code: payload.action === "confirm"
            ? "verification_status_unknown"
            : payload.action === "request"
            ? "delivery_status_unknown"
            : "server_error",
        };
      } finally {
        clearTimeout(timer);
      }
    };
  }

  function renderVerificationState(next, elements) {
    elements.message.textContent = next.message;
    elements.requestButton.disabled = !next.canRequest;
    elements.requestButton.textContent = next.resendAfterSeconds > 0 && !next.verified
      ? `Renvoyer un code (${next.resendAfterSeconds}s)`
      : "Recevoir un code";
    elements.form.hidden = !next.challengeId || next.verified;
    elements.confirmButton.disabled = next.busy || next.verified;
    elements.requestButton.hidden = next.verified;
    elements.nextStage.hidden = !next.verified;
    if (next.verified) {
      elements.input.value = "";
      if (!elements.paymentCapability) {
        elements.checkoutButton.disabled = true;
        elements.checkoutMessage.textContent = "Votre adresse est vérifiée. Reprenez votre réservation pour accéder à son paiement sécurisé.";
      } else if (!elements.holdExpiresAt || Date.parse(elements.holdExpiresAt) <= Date.now()) {
        elements.checkoutButton.disabled = true;
        elements.checkoutMessage.textContent = "Le délai de réservation a expiré. Recommencez votre réservation pour continuer.";
      } else {
        elements.checkoutButton.disabled = false;
        elements.checkoutMessage.textContent = "Votre réservation peut maintenant être finalisée.";
      }
    }
  }

  function createCheckoutSessionSender(reservationId, paymentCapability, config, fetchImpl) {
    return async () => {
      if (!/^[0-9a-f-]{36}$/i.test(reservationId) ||
          !/^[A-Za-z0-9_-]{43}$/.test(paymentCapability || "") ||
          !config || typeof config.projectUrl !== "string" ||
          typeof config.publishableKey !== "string") {
        return { ok: false, code: "INVALID_REQUEST" };
      }
      const projectUrl = config.projectUrl.replace(/\/+$/, "");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      try {
        const response = await (fetchImpl || global.fetch)(
          `${projectUrl}/functions/v1/create-checkout-session`,
          {
            method: "POST",
            headers: {
              apikey: config.publishableKey,
              "content-type": "application/json",
            },
            cache: "no-store",
            referrerPolicy: "no-referrer",
            signal: controller.signal,
            body: JSON.stringify({
              reservationId,
              paymentCapability,
              idempotencyKey: `reservation-checkout-v1:${reservationId}`,
            }),
          },
        );
        const payload = await response.json();
        const checkoutUrl = payload && payload.checkout && payload.checkout.url;
        if (response.ok && payload.ok === true && typeof checkoutUrl === "string") {
          const url = new URL(checkoutUrl);
          if (url.protocol === "https:" && url.hostname === "checkout.stripe.com") {
            return { ok: true, url: url.href };
          }
        }
        return {
          ok: false,
          code: payload && payload.error && typeof payload.error.code === "string"
            ? payload.error.code
            : "PAYMENT_UNAVAILABLE",
        };
      } catch {
        return { ok: false, code: "PAYMENT_STATUS_UNKNOWN" };
      } finally {
        clearTimeout(timer);
      }
    };
  }

  function createPaymentStatusSender(reservationId, paymentCapability, sessionId, config, fetchImpl) {
    return async () => {
      if (!/^[0-9a-f-]{36}$/i.test(reservationId) ||
          !/^[A-Za-z0-9_-]{43}$/.test(paymentCapability || "") ||
          !/^cs_(?:test|live)_[A-Za-z0-9]+$/.test(sessionId || "") ||
          !config || typeof config.projectUrl !== "string" ||
          typeof config.publishableKey !== "string") {
        return { ok: false, code: "INVALID_REQUEST" };
      }
      const projectUrl = config.projectUrl.replace(/\/+$/, "");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await (fetchImpl || global.fetch)(
          `${projectUrl}/functions/v1/customer-payment-status`,
          {
            method: "POST",
            headers: { apikey: config.publishableKey, "content-type": "application/json" },
            cache: "no-store",
            referrerPolicy: "no-referrer",
            signal: controller.signal,
            body: JSON.stringify({ reservationId, paymentCapability, sessionId }),
          },
        );
        const payload = await response.json();
        if (response.ok && payload && payload.ok === true &&
            (payload.state === "confirmed" || payload.state === "pending") &&
            typeof payload.amount === "number" && Number.isFinite(payload.amount) &&
            payload.currency === "EUR") {
          return { ok: true, state: payload.state, amount: payload.amount, currency: payload.currency };
        }
        return { ok: false, code: payload && payload.error && typeof payload.error.code === "string" ? payload.error.code : "PAYMENT_STATUS_UNKNOWN" };
      } catch {
        return { ok: false, code: "PAYMENT_STATUS_UNKNOWN" };
      } finally {
        clearTimeout(timer);
      }
    };
  }

  function renderCheckoutReturn(container, saved, config, fetchImpl = global.fetch) {
    if (!container || !global.location || !global.document) return null;
    const params = new URLSearchParams(global.location.search || "");
    const checkout = params.get("checkout");
    if (checkout !== "success" && checkout !== "cancelled") return null;
    if (checkout === "success") {
      for (const child of Array.from(container.children)) child.hidden = true;
    }
    const panel = global.document.createElement("section");
    panel.className = "customer-email-verification customer-payment-confirmation";
    panel.setAttribute("role", "status");
    panel.setAttribute("aria-live", "polite");
    const heading = global.document.createElement("h3");
    const message = global.document.createElement("p");
    panel.append(heading, message);
    container.appendChild(panel);
    container.hidden = false;

    if (checkout === "cancelled") {
      heading.textContent = "Paiement non finalisé";
      message.textContent = "Votre réservation reste en attente. Aucun paiement n’est confirmé.";
      return { panel, refresh: async () => ({ ok: false, code: "CANCELLED" }) };
    }

    heading.textContent = "Vérification de votre paiement";
    const sessionId = params.get("session_id") || "";
    if (!saved || !saved.paymentCapability || !sessionId) {
      message.textContent = "Le paiement n’est pas encore confirmé. Reprenez la page de réservation dans ce navigateur pour vérifier son état.";
      return { panel, refresh: async () => ({ ok: false, code: "PAYMENT_STATUS_UNKNOWN" }) };
    }

    const sendStatus = createPaymentStatusSender(saved.reservationId, saved.paymentCapability, sessionId, config, fetchImpl);
    let stopped = false;
    let timer = null;
    const refresh = async () => {
      const result = await sendStatus();
      if (stopped) return result;
      if (result.ok && result.state === "confirmed") {
        heading.textContent = "Paiement confirmé";
        message.textContent = `Votre réservation est confirmée. Paiement reçu : ${result.amount.toFixed(2).replace(".", ",")} €.`;
        stopped = true;
      } else {
        heading.textContent = "Vérification de votre paiement";
        message.textContent = "Votre paiement attend encore la confirmation du serveur. Cette page se met à jour automatiquement.";
      }
      return result;
    };
    let tries = 0;
    const poll = async () => {
      const result = await refresh();
      tries += 1;
      if (!stopped && tries < 9) timer = global.setTimeout(poll, 1500);
      else if (!stopped) message.textContent = "Le paiement n’est pas encore confirmé. Actualisez cette page dans quelques instants pour vérifier à nouveau.";
      return result;
    };
    poll();
    return { panel, refresh: () => { if (timer) global.clearTimeout(timer); stopped = false; tries = 0; return poll(); } };
  }

  function mount(container, reservationId, capability, config, session = {}) {
    if (
      !container || typeof reservationId !== "string" ||
      typeof capability !== "string" || !config
    ) return null;
    saveSession(reservationId, capability, session.challengeId || null, session.paymentCapability || null, session.holdExpiresAt || null);
    const section = global.document.createElement("section");
    section.className = "customer-email-verification";
    section.setAttribute(
      "aria-labelledby",
      "customer-email-verification-title",
    );
    section.innerHTML =
      '<h3 id="customer-email-verification-title">Vérification de votre adresse e-mail</h3><p data-email-verification-message role="status" aria-live="polite"></p><button type="button" data-email-verification-request>Recevoir un code</button><form data-email-verification-form hidden><label for="customer-email-verification-code">Code à six chiffres</label><input id="customer-email-verification-code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required><button type="submit" data-email-verification-confirm>Vérifier le code</button></form>';
    const nextStage = global.document.createElement("section");
    nextStage.hidden = true;
    nextStage.innerHTML = '<h4>Adresse e-mail vérifiée</h4><p data-checkout-message role="status" aria-live="polite">Votre réservation peut maintenant être finalisée.</p><button type="button" data-checkout-start>Continuer vers le paiement sécurisé</button>';
    section.appendChild(nextStage);
    container.appendChild(section);
    const message = section.querySelector("[data-email-verification-message]");
    const requestButton = section.querySelector(
      "[data-email-verification-request]",
    );
    const form = section.querySelector("[data-email-verification-form]");
    const input = section.querySelector("[name=code]");
    const confirmButton = section.querySelector(
      "[data-email-verification-confirm]",
    );
    const checkoutMessage = nextStage.querySelector("[data-checkout-message]");
    const checkoutButton = nextStage.querySelector("[data-checkout-start]");
    const paymentCapability = session.paymentCapability || null;
    const holdExpiresAt = session.holdExpiresAt || null;
    const controller = createController({
      send: createApiSender(reservationId, capability, config),
      initialChallengeId: session.challengeId || null,
      onChallenge(challengeId) {
        saveSession(reservationId, capability, challengeId, paymentCapability, holdExpiresAt);
      },
      onState(next) {
        renderVerificationState(next, {
          message, requestButton, form, confirmButton, input, nextStage,
          checkoutButton, checkoutMessage, paymentCapability, holdExpiresAt,
        });
        if (next.verified && countdown) global.clearInterval(countdown);
      },
    });
    container.hidden = false;
    const countdown = global.setInterval(() => controller.refresh(), 1000);
    checkoutButton.disabled = !paymentCapability || !holdExpiresAt || Date.parse(holdExpiresAt) <= Date.now();
    checkoutButton.addEventListener("click", async () => {
      if (!controller.state().verified || checkoutButton.disabled) return;
      if (!holdExpiresAt || Date.parse(holdExpiresAt) <= Date.now()) {
        renderVerificationState(controller.state(), {
          message, requestButton, form, confirmButton, input, nextStage,
          checkoutButton, checkoutMessage, paymentCapability, holdExpiresAt,
        });
        return;
      }
      checkoutButton.disabled = true;
      checkoutMessage.textContent = "Préparation du paiement sécurisé…";
      const result = await createCheckoutSessionSender(reservationId, paymentCapability, config)();
      if (result.ok) {
        global.location.assign(result.url);
        return;
      }
      checkoutButton.disabled = false;
      checkoutMessage.textContent = result.code === "PAYMENT_WINDOW_CLOSED"
        ? "Le délai de réservation a expiré. Recommencez votre réservation pour continuer."
        : "Le paiement sécurisé n’a pas pu être préparé. Vérifiez l’état de votre réservation avant de réessayer.";
    });
    requestButton.addEventListener("click", () => controller.requestCode());
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      controller.confirm(input.value).then((success) => {
        if (success) input.value = "";
        if (
          !success &&
          controller.state().message === MESSAGES.verification_status_unknown
        ) {
          controller.checkStatus().then((verified) => {
            if (verified) input.value = "";
          });
        }
        if (controller.state().verified) global.clearInterval(countdown);
      });
    });
    controller.checkStatus();
    return controller;
  }

  function createSessionRecord(
    reservationId,
    capability,
    challengeId,
    now = Date.now(),
    paymentCapability = null,
    holdExpiresAt = null,
  ) {
    return {
      reservationId,
      capability,
      challengeId: challengeId || null,
      paymentCapability,
      holdExpiresAt,
      expiresAt: now + 30 * 24 * 60 * 60 * 1000,
    };
  }

  function saveSession(reservationId, capability, challengeId, paymentCapability = null, holdExpiresAt = null) {
    try {
      global.sessionStorage.setItem(
        SESSION_KEY,
        JSON.stringify(
          createSessionRecord(reservationId, capability, challengeId, Date.now(), paymentCapability, holdExpiresAt),
        ),
      );
    } catch {
      /* The in-memory flow remains usable when session storage is unavailable. */
    }
  }

  function clearSession() {
    try {
      global.sessionStorage.removeItem(SESSION_KEY);
    } catch { /* No-op in restricted browser contexts. */ }
  }

  function restoreSession() {
    if (!global.document) return;
    let saved;
    try {
      const raw = global.sessionStorage && global.sessionStorage.getItem(SESSION_KEY);
      if (raw) saved = JSON.parse(raw);
    } catch {
      clearSession();
      saved = null;
    }
    if (
      !saved || typeof saved.reservationId !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(saved.reservationId) ||
      typeof saved.capability !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(saved.capability) ||
      !Number.isFinite(saved.expiresAt) || saved.expiresAt <= Date.now() ||
      !(saved.challengeId === null ||
        typeof saved.challengeId === "string" &&
          /^[0-9a-f-]{36}$/i.test(saved.challengeId)) ||
      !(saved.paymentCapability === null ||
        saved.paymentCapability === undefined ||
        typeof saved.paymentCapability === "string" &&
          /^[A-Za-z0-9_-]{43}$/.test(saved.paymentCapability)) ||
      !(saved.holdExpiresAt === null ||
        saved.holdExpiresAt === undefined ||
        typeof saved.holdExpiresAt === "string" &&
          Number.isFinite(Date.parse(saved.holdExpiresAt)))
    ) {
      clearSession();
      saved = null;
    }
    const root = global.document.querySelector(
      "[data-customer-email-verification-session]",
    );
    if (root && saved) {
      mount(
        root,
        saved.reservationId,
        saved.capability,
        global.IGLOUE_SUPABASE_CONFIG || {},
        { challengeId: saved.challengeId, paymentCapability: saved.paymentCapability || null, holdExpiresAt: saved.holdExpiresAt || null },
      );
    }
    if (root) renderCheckoutReturn(root, saved || null, global.IGLOUE_SUPABASE_CONFIG || {});
  }

  const api = Object.freeze({
    createController,
    createApiSender,
    mount,
    restoreSession,
    createSessionRecord,
    createCheckoutSessionSender,
    createPaymentStatusSender,
    renderCheckoutReturn,
    renderVerificationState,
  });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (global) global.IGLOUE_CUSTOMER_EMAIL_VERIFICATION = api;
  restoreSession();
})(typeof window !== "undefined" ? window : globalThis);
