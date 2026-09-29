(function installIgloueAdminAuth(global) {
  "use strict";

  let client = null;
  let currentUser = null;
  let memberships = [];
  let selectedOrganisation = null;
  let inviteCallbackDetected = false;
  let inviteCallbackError = false;
  const listeners = new Set();

  function detectAuthCallback(url, params) {
    const type = String(params.type || "").toLowerCase();
    const hasAuthError = Boolean(params.error || params.error_code || params.error_description);
    if (type === "invite" || hasAuthError) {
      inviteCallbackDetected = true;
      inviteCallbackError = hasAuthError;
    }
    // Let Supabase JS consume implicit and PKCE callbacks. Never retain callback
    // parameters themselves: they can contain short-lived credentials.
    return Boolean(params.access_token || params.error || params.error_description || params.error_code || params.code);
  }

  function clearAuthCallbackUrl() {
    try {
      if (global.history && typeof global.history.replaceState === "function" && global.location) {
        global.history.replaceState({}, "", global.location.pathname || "/admin/");
      }
    } catch { /* URL cleanup must not turn a completed password update into a failure. */ }
  }

  function getClient() {
    if (client) return client;
    const config = global.IGLOUE_SUPABASE_CONFIG || {};
    const sdk = global.supabase;
    const projectUrl = String(config.projectUrl || "");
    const publishableKey = String(config.publishableKey || "");

    if (!sdk || typeof sdk.createClient !== "function" ||
        !/^https?:\/\//i.test(projectUrl) || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey)) {
      throw new Error("ADMIN_AUTH_CONFIGURATION_UNAVAILABLE");
    }

    client = sdk.createClient(projectUrl, publishableKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: detectAuthCallback,
        persistSession: true
      }
    });
    return client;
  }

  function clearAdminState() {
    currentUser = null;
    memberships = [];
    selectedOrganisation = null;
  }

  function emit(event, session) {
    if (event === "SIGNED_OUT") clearAdminState();
    for (const listener of listeners) {
      try { listener({ event, session: session || null }); } catch { /* UI listeners cannot affect auth state. */ }
    }
  }

  function confirmed(user) {
    return Boolean(user && (user.email_confirmed_at || user.confirmed_at || user.email_confirmed === true));
  }

  function passwordPolicy(password) {
    return typeof password === "string" && password.length >= 12 &&
      /[a-z]/.test(password) && /[A-Z]/.test(password) && /[0-9]/.test(password);
  }

  function authFailure(error) {
    const message = String(error && error.message || "").toLowerCase();
    const code = String(error && error.code || "").toLowerCase();
    if (code === "email_not_confirmed" || message.includes("email not confirmed")) {
      return { ok: false, reason: "email_not_confirmed" };
    }
    return { ok: false, reason: "invalid_credentials" };
  }

  async function signIn(email, password) {
    clearAdminState();
    const normalizedEmail = String(email || "").trim();
    const suppliedPassword = String(password || "");
    if (!normalizedEmail || !suppliedPassword) return { ok: false, reason: "invalid_credentials" };

    try {
      const { data, error } = await getClient().auth.signInWithPassword({
        email: normalizedEmail,
        password: suppliedPassword
      });
      if (error || !data || !data.user) return authFailure(error || {});
      if (!confirmed(data.user)) {
        await getClient().auth.signOut({ scope: "local" }).catch(() => {});
        clearAdminState();
        return { ok: false, reason: "email_not_confirmed" };
      }
      currentUser = { id: data.user.id, email: data.user.email || normalizedEmail, emailConfirmed: true };
      return { ok: true };
    } catch {
      return { ok: false, reason: "auth_unavailable" };
    }
  }

  async function signOut() {
    clearAdminState();
    inviteCallbackDetected = false;
    inviteCallbackError = false;
    clearAuthCallbackUrl();
    try {
      const { error } = await getClient().auth.signOut({ scope: "local" });
      return error ? { ok: false, reason: "sign_out_unavailable" } : { ok: true };
    } catch {
      return { ok: false, reason: "sign_out_unavailable" };
    }
  }

  async function getSession() {
    try {
      const { data, error } = await getClient().auth.getSession();
      if (error) throw error;
      return data && data.session ? data.session : null;
    } catch {
      throw new Error("ADMIN_SESSION_UNAVAILABLE");
    }
  }

  async function getCurrentUser() {
    try {
      const { data, error } = await getClient().auth.getUser();
      if (error) throw error;
      const user = data && data.user;
      if (!user) {
        currentUser = null;
        return null;
      }
      currentUser = {
        id: user.id,
        email: user.email || "",
        emailConfirmed: confirmed(user),
        invited: Boolean(user.invited_at)
      };
      return { ...currentUser };
    } catch {
      throw new Error("ADMIN_USER_UNAVAILABLE");
    }
  }

  function getInvitationStatus(session, user) {
    if (inviteCallbackError) return "invalid";
    if (!inviteCallbackDetected) return "none";
    if (!session || !user || !user.invited) return "invalid";
    return "pending";
  }

  function discardInvitationCallback() {
    inviteCallbackDetected = false;
    inviteCallbackError = false;
    clearAuthCallbackUrl();
  }

  async function completeInvitation(password, confirmation) {
    if (!passwordPolicy(password)) return { ok: false, reason: "weak_password" };
    if (password !== confirmation) return { ok: false, reason: "password_mismatch" };

    try {
      const auth = getClient().auth;
      const { data: sessionData, error: sessionError } = await auth.getSession();
      if (sessionError || !sessionData || !sessionData.session) return { ok: false, reason: "invalid_invitation" };
      const { data: userData, error: userError } = await auth.getUser();
      if (userError || !userData || !userData.user || !userData.user.invited_at || !inviteCallbackDetected || inviteCallbackError) {
        return { ok: false, reason: "invalid_invitation" };
      }

      const { error } = await auth.updateUser({ password });
      if (error) return { ok: false, reason: "password_rejected" };

      inviteCallbackDetected = false;
      inviteCallbackError = false;
      clearAuthCallbackUrl();
      return { ok: true };
    } catch {
      return { ok: false, reason: "password_rejected" };
    }
  }

  async function loadActiveMemberships() {
    memberships = [];
    selectedOrganisation = null;
    if (!currentUser || !currentUser.emailConfirmed) throw new Error("ADMIN_MEMBERSHIP_UNAVAILABLE");
    try {
      const db = getClient();
      const { data, error } = await db
        .from("organisation_members")
        .select("organisation_id, active, organisations!organisation_members_organisation_fkey(id, slug, name)")
        .eq("active", true);
      if (error || !Array.isArray(data)) throw error || new Error("Membership response unavailable");

      memberships = data.flatMap((row) => {
        const organisation = Array.isArray(row.organisations) ? row.organisations[0] : row.organisations;
        if (row.active !== true || !organisation || !row.organisation_id || organisation.id !== row.organisation_id) return [];
        return [{ id: organisation.id, slug: String(organisation.slug || ""), name: String(organisation.name || "") }];
      });

      if (memberships.length === 1) selectedOrganisation = memberships[0];
      return memberships.map((membership) => ({ ...membership }));
    } catch {
      memberships = [];
      selectedOrganisation = null;
      throw new Error("ADMIN_MEMBERSHIP_UNAVAILABLE");
    }
  }

  function selectOrganisation(organisationId) {
    const match = memberships.find((membership) => membership.id === String(organisationId || ""));
    selectedOrganisation = match || null;
    return match ? { ...match } : null;
  }

  function subscribe(listener) {
    if (typeof listener !== "function") return () => {};
    listeners.add(listener);
    const { data } = getClient().auth.onAuthStateChange((event, session) => {
      emit(event, session);
    });
    return () => {
      listeners.delete(listener);
      data && data.subscription && data.subscription.unsubscribe();
    };
  }

  global.IGLOUE_ADMIN_AUTH = Object.freeze({
    signIn,
    signOut,
    getSession,
    getCurrentUser,
    loadActiveMemberships,
    getInvitationStatus,
    discardInvitationCallback,
    completeInvitation,
    selectOrganisation,
    getActiveMemberships: () => memberships.map((membership) => ({ ...membership })),
    getSelectedOrganisation: () => selectedOrganisation ? { ...selectedOrganisation } : null,
    subscribe
  });
})(window);
