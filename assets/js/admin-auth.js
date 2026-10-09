(function installIgloueAdminAuth(global) {
  "use strict";

  let client = null;
  let currentUser = null;
  let memberships = [];
  let selectedOrganisation = null;
  let accessRevision = 0;
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
    accessRevision += 1;
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
    accessRevision += 1;
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
    accessRevision += 1;
    const match = memberships.find((membership) => membership.id === String(organisationId || ""));
    selectedOrganisation = match || null;
    return match ? { ...match } : null;
  }

  async function loadDailyOperationsBoard(scheduledDate = null) {
    if (!currentUser || !currentUser.emailConfirmed || !selectedOrganisation ||
        !memberships.some((membership) => membership.id === selectedOrganisation.id)) {
      throw new Error("ADMIN_OPERATIONS_ACCESS_UNAVAILABLE");
    }
    if (scheduledDate !== null && (typeof scheduledDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate))) {
      throw new Error("ADMIN_OPERATIONS_DATE_INVALID");
    }
    const organisationId = selectedOrganisation.id;
    const userId = currentUser.id;
    const requestRevision = ++accessRevision;
    try {
      const { data, error } = await getClient().rpc("get_admin_daily_operations_board_v1", {
        p_organisation_id: organisationId,
        p_scheduled_date: scheduledDate
      });
      if (error || !data || typeof data !== "object" || Array.isArray(data) ||
          !data.metadata || data.metadata.organisationName !== selectedOrganisation.name ||
          typeof data.metadata.timezone !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(data.metadata.localToday) ||
          !/^\d{4}-\d{2}-\d{2}$/.test(data.metadata.selectedDate) ||
          !data.summary || !["deliveriesToday", "collectionsToday", "overdueJobs", "completedJobs", "attentionJobs"]
            .every((key) => Number.isInteger(data.summary[key]) && data.summary[key] >= 0) || !Array.isArray(data.jobs)) {
        throw new Error("Invalid operations board response");
      }
      if (requestRevision !== accessRevision || !currentUser || currentUser.id !== userId ||
          !selectedOrganisation || selectedOrganisation.id !== organisationId ||
          !memberships.some((membership) => membership.id === organisationId)) {
        throw new Error("Operations board request superseded");
      }
      return data;
    } catch {
      throw new Error("ADMIN_OPERATIONS_BOARD_UNAVAILABLE");
    }
  }

  async function verifyCustomerHandover(request) {
    if (!currentUser || !currentUser.emailConfirmed) return { ok: false, status: 401 };
    const value = request || {};
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const validCredential = value.credentialType === "qr_token"
      ? typeof value.credential === "string" && /^hv1\.[A-Za-z0-9_-]{43}$/.test(value.credential)
      : value.credentialType === "numeric_code" && typeof value.credential === "string" && /^\d{8}$/.test(value.credential);
    if (!uuid.test(String(value.serviceJobId || "")) || !uuid.test(String(value.requestId || "")) || !validCredential) {
      return { ok: false, status: 400 };
    }
    try {
      const { data, error } = await getClient().functions.invoke("verify-customer-handover", {
        body: {
          serviceJobId: value.serviceJobId,
          credentialType: value.credentialType,
          credential: value.credential,
          requestId: value.requestId
        }
      });
      if (error) {
        const responseStatus = Number(error.status || error.context && error.context.status);
        return { ok: false, status: [401, 403, 422, 400, 503].includes(responseStatus) ? responseStatus : 0 };
      }
      if (!data || data.ok !== true || data.verification_status !== "verified" ||
          data.operation !== "delivery" || data.service_job_id !== value.serviceJobId ||
          typeof data.verification_id !== "string" || typeof data.reservation_reference !== "string" ||
          !/^[A-F0-9]{8}$/.test(data.reservation_reference) || !data.schedule ||
          !/^\d{4}-\d{2}-\d{2}$/.test(String(data.schedule.date || "")) ||
          !(data.schedule.time_slot === null || typeof data.schedule.time_slot === "string") ||
          typeof data.schedule.status !== "string" || !Array.isArray(data.equipment) ||
          data.equipment.length < 1 || data.equipment.length > 20) return { ok: false, status: 503 };
      const equipment = [];
      for (const item of data.equipment) {
        if (!item || typeof item.equipment_id !== "string" || typeof item.product_name !== "string" ||
            !(item.serial_number === null || typeof item.serial_number === "string")) return { ok: false, status: 503 };
        equipment.push({ equipment_id: item.equipment_id, product_name: item.product_name, serial_number: item.serial_number });
      }
      return { ok: true, data: {
        reservation_reference: data.reservation_reference,
        schedule: { date: data.schedule.date, time_slot: data.schedule.time_slot, status: data.schedule.status },
        equipment
      } };
    } catch {
      return { ok: false, status: 0 };
    }
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
    loadDailyOperationsBoard,
    verifyCustomerHandover,
    getActiveMemberships: () => memberships.map((membership) => ({ ...membership })),
    getSelectedOrganisation: () => selectedOrganisation ? { ...selectedOrganisation } : null,
    subscribe
  });
})(window);
