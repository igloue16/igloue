(function installIgloueAdminApp(global) {
  "use strict";

  function createController(auth, document) {
    const state = {
      status: "checking",
      memberships: [],
      selectedOrganisation: null,
      board: null,
      boardFilter: "all",
      boardMessage: "Chargement du planning…",
      message: "Vérification de votre session…"
    };
    let revision = 0;
    let boardRevision = 0;
    let unsubscribe = null;

    const byId = (id) => document.getElementById(id);
    const show = (id, visible) => { const node = byId(id); if (node) node.hidden = !visible; };
    const setMessage = (message) => { if (byId("admin-status")) byId("admin-status").textContent = message; };
    const handover = global.IGLOUE_HANDOVER_VERIFICATION &&
      global.IGLOUE_HANDOVER_VERIFICATION.createController(auth, document);

    function render() {
      document.body.dataset.adminState = state.status;
      setMessage(state.message);
      show("admin-login-form", ["signed_out", "signing_in", "invalid_credentials", "email_not_confirmed", "auth_unavailable", "invite_invalid"].includes(state.status));
      show("admin-invite-form", ["invite_password", "invite_submitting", "invite_password_error"].includes(state.status));
      show("admin-invite-invalid", state.status === "invite_invalid");
      show("admin-membership-selector", state.status === "needs_selection");
      show("admin-authorized", state.status === "ready");
      show("admin-sign-out", ["ready", "needs_selection", "no_membership", "invite_password", "invite_password_error", "invite_submitting", "invite_invalid"].includes(state.status));
      show("admin-retry", state.status === "auth_unavailable");

      const button = byId("admin-login-button");
      if (button) button.disabled = state.status === "signing_in";
      const inviteButton = byId("admin-invite-button");
      if (inviteButton) inviteButton.disabled = state.status === "invite_submitting";
      const card = document.querySelector(".admin-card");
      if (card) card.setAttribute("aria-busy", String(["checking", "signing_in", "invite_submitting"].includes(state.status)));

      const select = byId("admin-organisation");
      if (select && typeof document.createElement === "function") {
        select.replaceChildren();
        for (const membership of state.memberships) {
          const option = document.createElement("option");
          option.value = membership.id;
          option.textContent = membership.name || membership.slug;
          select.append(option);
        }
      }
      if (state.selectedOrganisation && byId("admin-organisation-name")) {
        byId("admin-organisation-name").textContent = state.selectedOrganisation.name || state.selectedOrganisation.slug;
      }
      renderBoard();
    }

    function renderBoard() {
      const feedback = byId("ops-feedback");
      const summary = byId("ops-summary");
      const jobs = byId("ops-jobs");
      if (!feedback || !summary || !jobs) return;
      feedback.textContent = state.boardMessage;
      summary.replaceChildren();
      jobs.replaceChildren();
      if (state.status !== "ready" || !state.board) return;
      const renderer = global.IGLOUE_OPERATIONS_BOARD;
      if (!renderer || typeof renderer.render !== "function") {
        feedback.textContent = "Le planning opérationnel est indisponible.";
        return;
      }
      const view = renderer.render(state.board, state.boardFilter);
      const dateControl = byId("ops-date");
      if (dateControl && dateControl.value !== view.date) dateControl.value = view.date;
      const timezone = byId("ops-timezone");
      if (timezone) timezone.textContent = view.timezone;
      feedback.textContent = `Journée ${view.date.split("-").reverse().join("/")} · ${view.timezone}`;
      summary.innerHTML = view.summary;
      jobs.innerHTML = view.jobs;
    }

    async function loadOperationsBoard(scheduledDate = null) {
      if (handover && !handover.confirmNavigationAway()) return false;
      const resumeDate = scheduledDate || handover && typeof handover.pendingResumeDate === "function" && handover.pendingResumeDate();
      const requestRevision = ++boardRevision;
      const organisationId = state.selectedOrganisation && state.selectedOrganisation.id;
      if (state.status !== "ready" || !organisationId || typeof auth.loadDailyOperationsBoard !== "function") return;
      handover && handover.close({ preserveResume: true });
      state.board = null;
      state.boardMessage = "Chargement du planning…";
      render();
      try {
        const board = await auth.loadDailyOperationsBoard(resumeDate || null);
        if (requestRevision !== boardRevision || state.status !== "ready" ||
            !state.selectedOrganisation || state.selectedOrganisation.id !== organisationId) return;
        state.board = board;
        state.boardMessage = "";
        if (handover && typeof handover.resumePendingFromBoard === "function") await handover.resumePendingFromBoard(board);
      } catch {
        if (requestRevision !== boardRevision) return;
        state.board = null;
        state.boardMessage = "Impossible de charger le planning. Vérifiez votre accès puis réessayez.";
      }
      render();
    }

    async function processSession(session) {
      const currentRevision = ++revision;
      state.status = "checking";
      state.memberships = [];
      state.selectedOrganisation = null;
      state.board = null;
      state.boardMessage = "Chargement du planning…";
      boardRevision += 1;
      state.message = "Vérification de votre session…";
      render();

      if (!session) {
        const invitationStatus = auth.getInvitationStatus(null, null);
        if (invitationStatus === "invalid") auth.discardInvitationCallback();
        state.status = invitationStatus === "invalid" ? "invite_invalid" : "signed_out";
        if (invitationStatus === "invalid") state.message = "Invitation expir\u00e9e ou invalide. Demandez un nouvel envoi \u00e0 votre administrateur.";
        state.message = "Connectez-vous avec votre compte équipe.";
        render();
        return;
      }

      try {
        const user = await auth.getCurrentUser();
        if (currentRevision !== revision) return;
        if (!user) {
          state.status = "signed_out";
          state.message = "Connectez-vous avec votre compte équipe.";
          render();
          return;
        }
        const invitationStatus = auth.getInvitationStatus(session, user);
        if (invitationStatus === "invalid") {
          auth.discardInvitationCallback();
          state.status = "invite_invalid";
          render();
          return;
        }
        if (invitationStatus === "pending") {
          state.status = "invite_password";
          state.message = "Cr\u00e9ez votre mot de passe pour terminer la configuration de votre acc\u00e8s.";
          render();
          return;
        }
        if (!user.emailConfirmed) {
          await auth.signOut();
          if (currentRevision !== revision) return;
          state.status = "email_not_confirmed";
          state.message = "Confirmez votre adresse e-mail avant de vous connecter.";
          render();
          return;
        }

        const loaded = await auth.loadActiveMemberships();
        if (currentRevision !== revision) return;
        state.memberships = loaded;
        if (loaded.length === 0) {
          state.status = "no_membership";
          state.message = "Votre compte est connecté, mais aucun accès actif à une organisation n’est configuré.";
          render();
        } else if (loaded.length === 1) {
          state.selectedOrganisation = auth.selectOrganisation(loaded[0].id);
          state.status = state.selectedOrganisation ? "ready" : "no_membership";
          state.message = state.selectedOrganisation ? "Accès à votre organisation vérifié." : "Aucun accès actif à une organisation n’est configuré.";
          render();
          if (state.status === "ready") await loadOperationsBoard(null);
        } else {
          state.status = "needs_selection";
          state.message = "Plusieurs organisations sont accessibles. Choisissez celle à ouvrir.";
          render();
        }
      } catch {
        if (currentRevision !== revision) return;
        state.status = "auth_unavailable";
        state.message = "Impossible de vérifier votre accès pour le moment. Réessayez plus tard.";
        render();
      }
    }

    async function handleLogin(event) {
      if (event && typeof event.preventDefault === "function") event.preventDefault();
      const email = byId("admin-email") && byId("admin-email").value;
      const password = byId("admin-password") && byId("admin-password").value;
      state.status = "signing_in";
      state.message = "Connexion en cours…";
      render();
      const result = await auth.signIn(email, password);
      if (!result.ok) {
        state.status = result.reason === "email_not_confirmed" ? "email_not_confirmed" :
          result.reason === "auth_unavailable" ? "auth_unavailable" : "invalid_credentials";
        state.message = state.status === "email_not_confirmed"
          ? "Confirmez votre adresse e-mail avant de vous connecter."
          : state.status === "auth_unavailable"
            ? "Le service de connexion est indisponible. Réessayez plus tard."
            : "Adresse e-mail ou mot de passe incorrect.";
        render();
        return;
      }
      try {
        await processSession(await auth.getSession());
      } catch {
        state.status = "auth_unavailable";
        state.message = "Impossible de vérifier votre accès pour le moment. Réessayez plus tard.";
        render();
      }
    }

    async function handleInvitationCompletion(event) {
      if (event && typeof event.preventDefault === "function") event.preventDefault();
      const password = byId("admin-invite-password") && byId("admin-invite-password").value;
      const confirmation = byId("admin-invite-password-confirm") && byId("admin-invite-password-confirm").value;
      state.status = "invite_submitting";
      state.message = "Enregistrement de votre mot de passe\u2026";
      render();
      const result = await auth.completeInvitation(password, confirmation);
      if (!result.ok) {
        state.status = result.reason === "invalid_invitation" ? "invite_invalid" : "invite_password_error";
        state.message = result.reason === "password_mismatch"
          ? "Les deux mots de passe ne correspondent pas."
          : result.reason === "weak_password"
            ? "Utilisez au moins 12 caract\u00e8res avec une minuscule, une majuscule et un chiffre."
            : result.reason === "password_rejected"
              ? "Ce mot de passe n\u2019a pas \u00e9t\u00e9 accept\u00e9. V\u00e9rifiez les exigences et r\u00e9essayez."
              : "Cette invitation est expir\u00e9e ou invalide. Demandez une nouvelle invitation \u00e0 votre administrateur.";
        render();
        return;
      }
      const form = byId("admin-invite-form");
      if (form && typeof form.reset === "function") form.reset();
      try {
        await processSession(await auth.getSession());
      } catch {
        state.status = "auth_unavailable";
        state.message = "Impossible de v\u00e9rifier votre acc\u00e8s pour le moment. R\u00e9essayez plus tard.";
        render();
      }
    }
    async function handleSignOut() {
      ++revision;
      boardRevision += 1;
      handover && handover.close();
      state.status = "signing_out";
      state.message = "Déconnexion…";
      state.memberships = [];
      state.selectedOrganisation = null;
      state.board = null;
      state.boardMessage = "Connectez-vous pour consulter le planning.";
      render();
      await auth.signOut();
      state.status = "signed_out";
      state.message = "Vous êtes déconnecté.";
      render();
    }

    function handleOrganisationChoice() {
      const select = byId("admin-organisation");
      const verified = select && auth.selectOrganisation(select.value);
      if (!verified) {
        state.status = "needs_selection";
        state.selectedOrganisation = null;
        state.message = "Cette organisation ne fait pas partie de vos accès vérifiés.";
        render();
        return;
      }
      state.selectedOrganisation = verified;
      state.status = "ready";
      state.message = "Accès à votre organisation vérifié.";
      render();
      void loadOperationsBoard(null);
    }

    async function init() {
      handover && handover.init();
      const form = byId("admin-login-form");
      form && form.addEventListener("submit", handleLogin);
      const inviteForm = byId("admin-invite-form");
      inviteForm && inviteForm.addEventListener("submit", handleInvitationCompletion);
      const signOutButton = byId("admin-sign-out");
      signOutButton && signOutButton.addEventListener("click", handleSignOut);
      const choiceButton = byId("admin-organisation-submit");
      choiceButton && choiceButton.addEventListener("click", handleOrganisationChoice);
      const retryButton = byId("admin-retry");
      retryButton && retryButton.addEventListener("click", () => initSession());
      const refreshBoard = byId("ops-refresh");
      refreshBoard && refreshBoard.addEventListener("click", () => {
        const date = byId("ops-date") && byId("ops-date").value;
        void loadOperationsBoard(date || null);
      });
      const dateControl = byId("ops-date");
      dateControl && dateControl.addEventListener("change", () => void loadOperationsBoard(dateControl.value || null));
      const filterControl = byId("ops-filter");
      filterControl && filterControl.addEventListener("change", () => {
        state.boardFilter = ["all", "delivery", "collection", "attention"].includes(filterControl.value) ? filterControl.value : "all";
        render();
      });

      try {
        unsubscribe = auth.subscribe(({ event, session }) => {
          if (event === "SIGNED_OUT") {
            ++revision;
            handover && handover.close();
            state.status = "signed_out";
            state.memberships = [];
            state.selectedOrganisation = null;
            state.board = null;
            state.boardMessage = "Connectez-vous pour consulter le planning.";
            boardRevision += 1;
            state.message = "Vous êtes déconnecté.";
            render();
          } else if (event === "TOKEN_REFRESHED") {
            // Supabase refreshes the access token in place. Re-running the
            // full membership bootstrap here hid the admin shell and closed
            // an active handover during Android camera/gallery interruptions.
            // Protected RPCs still authorize every operation server-side.
            return;
          } else if (["INITIAL_SESSION", "SIGNED_IN", "USER_UPDATED"].includes(event)) {
            queueMicrotask(() => processSession(session));
          }
        });
        await initSession();
      } catch {
        state.status = "auth_unavailable";
        state.message = "Le service de connexion est indisponible.";
        render();
      }
    }

    async function initSession() {
      try { await processSession(await auth.getSession()); }
      catch {
        const invitationStatus = auth.getInvitationStatus(null, null);
        if (invitationStatus === "invalid") auth.discardInvitationCallback();
        state.status = invitationStatus === "invalid" ? "invite_invalid" : "auth_unavailable";
        state.message = "Impossible de vérifier votre session pour le moment.";
        render();
      }
    }

    function destroy() { unsubscribe && unsubscribe(); }
    function getState() {
      return {
        status: state.status,
        message: state.message,
        memberships: state.memberships.map((membership) => ({ ...membership })),
        selectedOrganisation: state.selectedOrganisation ? { ...state.selectedOrganisation } : null,
        board: state.board,
        boardMessage: state.boardMessage
      };
    }

    render();
    return Object.freeze({ init, destroy, getState, refreshOperationsBoard: loadOperationsBoard, signOut: handleSignOut, chooseOrganisation: handleOrganisationChoice });
  }

  // TODO(Security): before production, require and verify MFA assurance for owner/admin accounts.
  const api = Object.freeze({ createController });
  global.IGLOUE_ADMIN_APP = api;

  if (global.document) {
    const start = () => {
      if (!global.IGLOUE_ADMIN_AUTH) return;
      const controller = createController(global.IGLOUE_ADMIN_AUTH, global.document);
      controller.init();
      global.IGLOUE_ADMIN_APP_CONTROLLER = controller;
    };
    if (global.document.readyState === "loading") global.document.addEventListener("DOMContentLoaded", start, { once: true });
    else start();
  }
})(window);
