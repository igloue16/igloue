const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const authSource = fs.readFileSync(path.join(root, "assets/js/admin-auth.js"), "utf8");
const appSource = fs.readFileSync(path.join(root, "assets/js/admin-app.js"), "utf8");
const boardSource = fs.readFileSync(path.join(root, "assets/js/operations-board.js"), "utf8");
const html = fs.readFileSync(path.join(root, "admin/index.html"), "utf8");
const configToml = fs.readFileSync(path.join(root, "supabase/config.toml"), "utf8");

function createSdkEnvironment() {
  let session = null;
  let user = null;
  let membershipRows = [];
  let signInResult = null;
  let updateUserResult = null;
  const authListeners = new Set();
  let operationsBoardResult = null;
  let functionResult = null;
  const calls = { createdWith: null, signIns: [], signOuts: [], updatedPasswords: [], tableQueries: [], rpcCalls: [], functionInvokes: [], replacedUrl: null };

  const client = {
    auth: {
      async signInWithPassword(credentials) {
        calls.signIns.push(credentials);
        if (signInResult) return signInResult;
        user = {
          id: "user-a",
          email: credentials.email,
          email_confirmed_at: "2026-01-01T00:00:00Z",
          app_metadata: { role: "service_role" },
          user_metadata: { organisation_id: "untrusted-org" }
        };
        session = { access_token: "test-session", user };
        for (const listener of authListeners) listener("SIGNED_IN", session);
        return { data: { user, session }, error: null };
      },
      async signOut(options) {
        calls.signOuts.push(options);
        session = null;
        user = null;
        for (const listener of authListeners) listener("SIGNED_OUT", null);
        return { error: null };
      },
      async getSession() { return { data: { session }, error: null }; },
      async getUser() { return { data: { user }, error: null }; },
      async updateUser(attributes) {
        calls.updatedPasswords.push(attributes.password);
        return updateUserResult || { data: { user }, error: null };
      },
      onAuthStateChange(callback) {
        authListeners.add(callback);
        return { data: { subscription: { unsubscribe: () => authListeners.delete(callback) } } };
      }
    },
    from(table) {
      calls.tableQueries.push({ table, filters: [] });
      const record = calls.tableQueries.at(-1);
      const builder = {
        select(columns) { record.columns = columns; return builder; },
        eq(column, value) { record.filters.push([column, value]); return builder; },
        then(resolve, reject) {
          const rows = membershipRows.filter((row) =>
            record.filters.every(([column, value]) => row[column] === value)
          );
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        }
      };
      return builder;
    },
    async rpc(name, parameters) {
      calls.rpcCalls.push({ name, parameters });
      return { data: operationsBoardResult, error: null };
    },
    functions: {
      async invoke(name, options) {
        calls.functionInvokes.push({ name, options });
        return functionResult || { data: null, error: null };
      }
    }
  };

  const context = vm.createContext({ URL, URLSearchParams, queueMicrotask, Promise });
  context.window = context;
  context.location = { pathname: "/admin/", href: "https://test.igloue.fr/admin/" };
  context.history = { replaceState(_state, _title, url) { calls.replacedUrl = url; } };
  context.IGLOUE_SUPABASE_CONFIG = {
    projectUrl: "https://example.supabase.co",
    publishableKey: "sb_publishable_test_key"
  };
  context.supabase = {
    createClient(url, key, options) {
      calls.createdWith = { url, key, options };
      return client;
    }
  };
  vm.runInContext(authSource, context, { filename: "admin-auth.js" });

  return {
    auth: context.IGLOUE_ADMIN_AUTH,
    calls,
    setUser(nextUser, nextSession = { access_token: "restored-session" }) {
      user = nextUser;
      session = nextUser ? { ...nextSession, user: nextUser } : null;
    },
    setMemberships(rows) { membershipRows = rows; },
    setOperationsBoardResult(value) { operationsBoardResult = value; },
    setFunctionResult(value) { functionResult = value; },
    setSignInResult(result) { signInResult = result; },
    setUpdateUserResult(result) { updateUserResult = result; },
    async detectInviteCallback(params = { type: "invite", access_token: "callback-token-must-not-leak" }) {
      await context.IGLOUE_ADMIN_AUTH.getSession();
      const callback = calls.createdWith.options.auth.detectSessionInUrl;
      return callback(new URL("https://test.igloue.fr/admin/"), params);
    }
  };
}

class FakeElement {
  constructor() {
    this.hidden = true;
    this.value = "";
    this.textContent = "";
    this.disabled = false;
    this.dataset = {};
    this.listeners = new Map();
    this.children = [];
    this.attributes = {};
  }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  emit(name, event = {}) { return this.listeners.get(name)?.(event); }
  setAttribute(name, value) { this.attributes[name] = value; }
  reset() { this.value = ""; }
  replaceChildren(...children) { this.children = [...children]; }
  append(child) { this.children.push(child); }
}

function createFakeDocument() {
  const ids = [
    "admin-login-form", "admin-email", "admin-password", "admin-login-button",
    "admin-membership-selector", "admin-organisation", "admin-organisation-submit",
    "admin-authorized", "admin-organisation-name", "admin-sign-out", "admin-retry", "admin-status",
    "admin-invite-form", "admin-invite-password", "admin-invite-password-confirm", "admin-invite-button", "admin-invite-invalid",
    "ops-feedback", "ops-summary", "ops-jobs", "ops-date", "ops-timezone", "ops-filter", "ops-refresh"
  ];
  const nodes = new Map(ids.map((id) => [id, new FakeElement()]));
  const card = new FakeElement();
  return {
    body: new FakeElement(),
    getElementById: (id) => nodes.get(id) || null,
    querySelector: (selector) => selector === ".admin-card" ? card : null,
    createElement: () => new FakeElement(),
    nodes
  };
}

function createAppContext() {
  const context = vm.createContext({ queueMicrotask, Promise });
  context.window = context;
  vm.runInContext(appSource, context, { filename: "admin-app.js" });
  return context.IGLOUE_ADMIN_APP;
}

async function settle() { await new Promise((resolve) => setImmediate(resolve)); }

(async () => {
  const env = createSdkEnvironment();
  assert.equal(await env.auth.getSession(), null, "signed-out session is null");
  assert.equal(env.calls.tableQueries.length, 0, "no membership query occurs while signed out");

  const signedIn = await env.auth.signIn("  staff@example.com  ", "correct horse battery staple");
  assert.equal(signedIn.ok, true, "successful password sign-in is accepted");
  assert.equal(env.calls.signIns[0].email, "staff@example.com", "email is normalized");
  assert.equal(env.calls.createdWith.key, "sb_publishable_test_key", "client uses publishable key");
  assert.equal(env.calls.createdWith.options.auth.persistSession, true, "browser session persists for restore");
  assert.equal((await env.auth.getSession()).user.id, "user-a", "session can be restored");
  assert.equal((await env.auth.getCurrentUser()).emailConfirmed, true, "current user is verified by Auth");

  env.setMemberships([
    { organisation_id: "org-a", active: true, organisations: { id: "org-a", slug: "igloue", name: "IGLOUE" } },
    { organisation_id: "org-b", active: false, organisations: { id: "org-b", slug: "other", name: "Other" } }
  ]);
  const memberships = await env.auth.loadActiveMemberships();
  assert.equal(memberships.length, 1, "inactive memberships are ignored");
  assert.equal(env.calls.tableQueries[0].table, "organisation_members", "membership is the only auth data query");
  assert.deepEqual(env.calls.tableQueries[0].filters, [["active", true]], "membership query relies on self-membership RLS and filters active rows");
  assert.equal(env.auth.getSelectedOrganisation().id, "org-a", "one active membership is auto-selected");
  assert.equal(env.auth.selectOrganisation("org-unverified"), null, "unverified organisation selection is rejected");
  assert.equal(env.auth.selectOrganisation("org-a").id, "org-a", "verified membership can be selected");

  env.setMemberships([
    { organisation_id: "org-a", active: true, organisations: { id: "org-a", slug: "igloue", name: "IGLOUE" } },
    { organisation_id: "org-b", active: true, organisations: { id: "org-b", slug: "other", name: "Other" } }
  ]);
  assert.equal((await env.auth.loadActiveMemberships()).length, 2, "multiple active memberships are retained");
  assert.equal(env.auth.getSelectedOrganisation(), null, "multiple memberships require an explicit choice");
  assert.equal(env.auth.selectOrganisation("org-b").id, "org-b", "selection is limited to a verified membership");

  env.setOperationsBoardResult({ metadata: { organisationName: "Wrong tenant", timezone: "Europe/Paris", localToday: "2026-10-08", selectedDate: "2026-10-08" },
    summary: { deliveriesToday: 0, collectionsToday: 0, overdueJobs: 0, completedJobs: 0, attentionJobs: 0 }, jobs: [] });
  await assert.rejects(() => env.auth.loadDailyOperationsBoard(), /ADMIN_OPERATIONS_BOARD_UNAVAILABLE/,
    "invalid server response fails closed");
  assert.deepEqual(JSON.parse(JSON.stringify(env.calls.rpcCalls.at(-1))), { name: "get_admin_daily_operations_board_v1",
    parameters: { p_organisation_id: "org-b", p_scheduled_date: null } },
    "board query uses only a verified membership and the dedicated read RPC");
  env.setOperationsBoardResult({ metadata: { organisationName: "Other", timezone: "Europe/Paris", localToday: "2026-10-08", selectedDate: "2026-10-08" },
    summary: { deliveriesToday: 0, collectionsToday: 0, overdueJobs: 0, completedJobs: 0, attentionJobs: 0 }, jobs: [] });
  assert.equal((await env.auth.loadDailyOperationsBoard()).metadata.organisationName, "Other",
    "valid scoped board data is returned after backend response validation");

  const handoverRequest = {
    serviceJobId: "00000000-0000-4000-8000-00000000e851",
    credentialType: "qr_token", credential: `hv1.${"A".repeat(43)}`,
    requestId: "00000000-0000-4000-8000-00000000e861"
  };
  env.setFunctionResult({ data: {
    ok: true, verification_id: "00000000-0000-4000-8000-00000000e862", verification_status: "verified",
    service_job_id: handoverRequest.serviceJobId, operation: "delivery", reservation_reference: "AB12CD34",
    schedule: { date: "2026-10-09", time_slot: "early", status: "assigned" },
    equipment: [{ equipment_id: "unit-1", product_name: "Équipement test", serial_number: null }],
    secret_extra: "must-not-escape"
  }, error: null });
  const handover = await env.auth.verifyCustomerHandover({ ...handoverRequest, organisationId: "untrusted-tenant" });
  assert.equal(handover.ok, true, "authenticated staff verification accepts the allowlisted response");
  assert.deepEqual(JSON.parse(JSON.stringify(env.calls.functionInvokes.at(-1))), {
    name: "verify-customer-handover", options: { body: handoverRequest }
  }, "verification sends only the job-bound credential through the authenticated function client and ignores browser tenant IDs");
  assert.equal(JSON.stringify(handover).includes("secret_extra"), false, "verification response is reduced to permitted display fields");
  for (const httpStatus of [401, 403, 422, 503]) {
    env.setFunctionResult({ data: null, error: { context: { status: httpStatus }, message: "sensitive server detail" } });
    const denied = await env.auth.verifyCustomerHandover(handoverRequest);
    assert.deepEqual(JSON.parse(JSON.stringify(denied)), { ok: false, status: httpStatus }, `HTTP ${httpStatus} is returned without backend details`);
  }
  env.setFunctionResult({ data: {
    ok: true, verification_id: "00000000-0000-4000-8000-00000000e862", verification_status: "verified",
    service_job_id: handoverRequest.serviceJobId, operation: "delivery", reservation_reference: "AB12CD34",
    schedule: { date: "2026-10-09", time_slot: "early", status: "assigned" },
    equipment: [{ equipment_id: "unit-1", product_name: "Équipement test", serial_number: "SER-1" }]
  }, error: null });
  const numericHandover = await env.auth.verifyCustomerHandover({ ...handoverRequest, credentialType: "numeric_code", credential: "12345678" });
  assert.equal(numericHandover.ok, true, "numeric fallback uses the same authenticated verification endpoint");
  assert.equal(env.calls.functionInvokes.at(-1).options.body.credentialType, "numeric_code");
  env.setFunctionResult(null);
  const beforeInvalidCall = env.calls.functionInvokes.length;
  assert.deepEqual(JSON.parse(JSON.stringify(await env.auth.verifyCustomerHandover({ ...handoverRequest, credential: "bad" }))),
    { ok: false, status: 400 }, "malformed credentials fail locally");
  assert.equal(env.calls.functionInvokes.length, beforeInvalidCall, "malformed credentials are never sent");

  const signedOut = await env.auth.signOut();
  assert.equal(signedOut.ok, true, "sign-out succeeds");
  assert.equal(await env.auth.getSession(), null, "sign-out clears the session");
  assert.equal(env.auth.getActiveMemberships().length, 0, "sign-out clears local memberships");
  assert.equal(env.auth.getSelectedOrganisation(), null, "sign-out clears selected organisation");
  assert.deepEqual(JSON.parse(JSON.stringify(await env.auth.verifyCustomerHandover(handoverRequest))),
    { ok: false, status: 401 }, "verification helper refuses to call the Edge Function after sign-out");

  env.setSignInResult({ data: { user: null }, error: { message: "Invalid login credentials" } });
  const invalid = await env.auth.signIn("staff@example.com", "bad-password");
  assert.equal(invalid.reason, "invalid_credentials", "failed sign-in returns a generic credential state");
  assert.equal(JSON.stringify(invalid).includes("Invalid login credentials"), false, "auth server detail is sanitized");

  env.setSignInResult({
    data: { user: { id: "unconfirmed", email: "new@example.com", email_confirmed_at: null } },
    error: null
  });
  const unconfirmed = await env.auth.signIn("new@example.com", "password");
  assert.equal(unconfirmed.reason, "email_not_confirmed", "unconfirmed address has a distinct UI state");
  assert.deepEqual(JSON.parse(JSON.stringify(env.calls.signOuts.at(-1))), { scope: "local" }, "unconfirmed session is immediately cleared");

  const inviteEnv = createSdkEnvironment();
  const invitedUser = { id: "invite-user", email: "invited@example.com", email_confirmed_at: "confirmed", invited_at: "2026-01-01T00:00:00Z" };
  inviteEnv.setUser(invitedUser, { access_token: "fixture-token", user: invitedUser });
  await inviteEnv.detectInviteCallback();
  const inviteSession = await inviteEnv.auth.getSession();
  const inviteCurrentUser = await inviteEnv.auth.getCurrentUser();
  assert.equal(inviteEnv.auth.getInvitationStatus(inviteSession, inviteCurrentUser), "pending", "valid invited callback session requires password setup");
  assert.equal(inviteEnv.calls.createdWith.options.auth.detectSessionInUrl(new URL("https://test.igloue.fr/admin/"), { type: "invite", access_token: "secret" }), true, "Supabase callback handler consumes invite fragment");
  assert.equal(inviteEnv.calls.tableQueries.length, 0, "membership loading has not begun during password setup");
  assert.equal((await inviteEnv.auth.completeInvitation("Ashort123", "Ashort456")).reason, "weak_password", "weak password is rejected client-side");
  assert.equal((await inviteEnv.auth.completeInvitation("GoodPassword123", "DifferentPassword123")).reason, "password_mismatch", "password mismatch is rejected");
  assert.equal(inviteEnv.calls.updatedPasswords.length, 0, "invalid passwords never call updateUser");
  inviteEnv.setMemberships([
    { organisation_id: "org-a", active: true, organisations: { id: "org-a", slug: "igloue", name: "IGLOUE" } }
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(await inviteEnv.auth.completeInvitation("GoodPassword123", "GoodPassword123"))), { ok: true }, "valid invite password is accepted");
  assert.deepEqual(inviteEnv.calls.updatedPasswords, ["GoodPassword123"], "password update uses authenticated updateUser API");
  assert.equal(inviteEnv.calls.replacedUrl, "/admin/", "callback tokens are removed from browser history after completion");
  assert.equal(inviteEnv.auth.getInvitationStatus(inviteSession, inviteCurrentUser), "none", "invite state clears after completion");
  assert.equal((await inviteEnv.auth.loadActiveMemberships()).length, 1, "membership loading is available after password completion");
  assert.equal(inviteEnv.calls.tableQueries.length, 1, "only membership query occurs after invite completion");

  const rejectedInvite = createSdkEnvironment();
  rejectedInvite.setUser(invitedUser, { access_token: "fixture-token", user: invitedUser });
  await rejectedInvite.detectInviteCallback();
  rejectedInvite.setUpdateUserResult({ data: null, error: { message: "sensitive provider detail" } });
  const rejectedPassword = await rejectedInvite.auth.completeInvitation("GoodPassword123", "GoodPassword123");
  assert.deepEqual(JSON.parse(JSON.stringify(rejectedPassword)), { ok: false, reason: "password_rejected" }, "password policy errors are sanitized");
  assert.equal(JSON.stringify(rejectedPassword).includes("sensitive provider detail"), false, "server auth detail is not returned");

  const expiredInvite = createSdkEnvironment();
  await expiredInvite.detectInviteCallback({ type: "invite", error_code: "otp_expired", error_description: "token=do-not-display" });
  assert.equal(expiredInvite.auth.getInvitationStatus(null, null), "invalid", "expired callback is recognized without rendering callback details");
  assert.equal(JSON.stringify(expiredInvite.auth.getInvitationStatus(null, null)).includes("do-not-display"), false, "callback errors are sanitized");
  expiredInvite.auth.discardInvitationCallback();
  assert.equal(expiredInvite.calls.replacedUrl, "/admin/", "invalid callback parameters are removed from browser history");

  const completedInvite = createSdkEnvironment();
  completedInvite.setUser(invitedUser, { access_token: "fixture-token", user: invitedUser });
  const completedSession = await completedInvite.auth.getSession();
  const completedUser = await completedInvite.auth.getCurrentUser();
  assert.equal(completedInvite.auth.getInvitationStatus(completedSession, completedUser), "none", "an existing session without a fresh invite callback uses normal login");

  const signOutInvite = createSdkEnvironment();
  signOutInvite.setUser(invitedUser, { access_token: "fixture-token", user: invitedUser });
  await signOutInvite.detectInviteCallback();
  await signOutInvite.auth.signOut();
  assert.equal(signOutInvite.auth.getInvitationStatus(null, null), "none", "sign-out clears pending invitation state");

  const inactiveOnly = createSdkEnvironment();
  inactiveOnly.setUser({ id: "user-a", email: "staff@example.com", email_confirmed_at: "confirmed" });
  await inactiveOnly.auth.getCurrentUser();
  inactiveOnly.setMemberships([
    { organisation_id: "org-a", active: false, organisations: { id: "org-a", slug: "igloue", name: "IGLOUE" } }
  ]);
  assert.equal((await inactiveOnly.auth.loadActiveMemberships()).length, 0, "inactive-only account has no active membership");

  let membershipResolve;
  const appMemberships = new Promise((resolve) => { membershipResolve = resolve; });
  const appCalls = [];
  const appAuth = {
    subscribe: () => () => {},
    getSession: async () => ({ access_token: "test" }),
    getInvitationStatus: () => "none",
    getCurrentUser: async () => { appCalls.push("verified-user"); return { id: "user-a", emailConfirmed: true }; },
    loadActiveMemberships: async () => { appCalls.push("memberships"); return appMemberships; },
    selectOrganisation: (id) => id === "org-a" ? { id, name: "IGLOUE" } : null,
    signIn: async () => ({ ok: true }),
    signOut: async () => ({ ok: true })
  };
  const doc = createFakeDocument();
  const app = createAppContext().createController(appAuth, doc);
  const initPromise = app.init();
  await settle();
  assert.equal(app.getState().status, "checking", "protected state waits for membership verification");
  assert.equal(doc.getElementById("admin-authorized").hidden, true, "protected admin content stays hidden while membership loads");
  assert.deepEqual(appCalls, ["verified-user", "memberships"], "membership query follows verified Auth user");
  membershipResolve([{ id: "org-a", slug: "igloue", name: "IGLOUE" }]);
  await initPromise;
  assert.equal(app.getState().status, "ready", "one verified organisation unlocks the admin shell");
  assert.equal(doc.getElementById("admin-authorized").hidden, false, "authorized shell renders after membership verification");
  await app.signOut();
  assert.equal(app.getState().status, "signed_out", "sign-out returns app to signed-out state");
  assert.equal(app.getState().memberships.length, 0, "sign-out clears app membership state");
  assert.equal(doc.getElementById("admin-authorized").hidden, true, "sign-out hides protected admin shell");

  const invitationDoc = createFakeDocument();
  const invitationCalls = [];
  let invitationCompleted = false;
  const invitationApp = createAppContext().createController({
    subscribe: () => () => {},
    getSession: async () => ({ user: { id: "invite-user" } }),
    getCurrentUser: async () => ({ id: "invite-user", emailConfirmed: true, invited: true }),
    getInvitationStatus: () => invitationCompleted ? "none" : "pending",
    completeInvitation: async () => { invitationCompleted = true; return { ok: true }; },
    loadActiveMemberships: async () => { invitationCalls.push("memberships"); return []; },
    signOut: async () => ({ ok: true })
  }, invitationDoc);
  await invitationApp.init();
  assert.equal(invitationApp.getState().status, "invite_password", "valid invitation renders password setup state");
  assert.equal(invitationDoc.getElementById("admin-invite-form").hidden, false, "invitation password form is visible");
  assert.equal(invitationDoc.getElementById("admin-authorized").hidden, true, "protected content stays hidden during invitation");
  assert.deepEqual(invitationCalls, [], "membership loading waits for completed invitation");
  await invitationDoc.getElementById("admin-invite-form").emit("submit", { preventDefault() {} });
  assert.equal(invitationApp.getState().status, "no_membership", "completed invite proceeds to membership verification");
  assert.deepEqual(invitationCalls, ["memberships"], "membership loads only after invitation completion");
  assert.equal(invitationDoc.getElementById("admin-authorized").hidden, true, "no dashboard content appears without active membership");

  const multiDoc = createFakeDocument();
  const multiApp = createAppContext().createController({
    subscribe: () => () => {},
    getSession: async () => ({ access_token: "test" }),
    getInvitationStatus: () => "none",
    getCurrentUser: async () => ({ id: "user-a", emailConfirmed: true }),
    loadActiveMemberships: async () => [
      { id: "org-a", slug: "igloue", name: "IGLOUE" },
      { id: "org-b", slug: "other", name: "Other" }
    ],
    selectOrganisation: (id) => ["org-a", "org-b"].includes(id) ? { id, name: id } : null,
    signOut: async () => ({ ok: true })
  }, multiDoc);
  await multiApp.init();
  assert.equal(multiApp.getState().status, "needs_selection", "multiple verified organisations require selection");
  multiDoc.getElementById("admin-organisation").value = "org-unverified";
  multiApp.chooseOrganisation();
  assert.equal(multiApp.getState().status, "needs_selection", "arbitrary organisation ID cannot unlock the shell");
  multiDoc.getElementById("admin-organisation").value = "org-b";
  multiApp.chooseOrganisation();
  assert.equal(multiApp.getState().selectedOrganisation.id, "org-b", "verified organisation selection unlocks shell");

  const signedOutDoc = createFakeDocument();
  let membershipLoadsWhileSignedOut = 0;
  const signedOutApp = createAppContext().createController({
    subscribe: () => () => {},
    getSession: async () => null,
    getInvitationStatus: () => "none",
    getCurrentUser: async () => null,
    loadActiveMemberships: async () => { membershipLoadsWhileSignedOut += 1; return []; }
  }, signedOutDoc);
  await signedOutApp.init();
  assert.equal(signedOutApp.getState().status, "signed_out", "restored signed-out state renders login");
  assert.equal(membershipLoadsWhileSignedOut, 0, "no membership or dashboard query occurs before authentication");
  assert.equal(signedOutDoc.getElementById("admin-authorized").hidden, true, "signed-out user cannot see protected shell");

  const noMembershipDoc = createFakeDocument();
  const noMembershipApp = createAppContext().createController({
    subscribe: () => () => {},
    getSession: async () => ({ access_token: "test" }),
    getInvitationStatus: () => "none",
    getCurrentUser: async () => ({ id: "user-a", emailConfirmed: true }),
    loadActiveMemberships: async () => [],
    signOut: async () => ({ ok: true })
  }, noMembershipDoc);
  await noMembershipApp.init();
  assert.equal(noMembershipApp.getState().status, "no_membership", "authenticated user without active membership is denied");
  assert.equal(noMembershipDoc.getElementById("admin-authorized").hidden, true, "no-membership state keeps protected shell hidden");

  const authConfig = configToml.split("[auth]")[1].split("[auth.rate_limit]")[0];
  const emailConfig = configToml.split("[auth.email]")[1].split("[auth.sms]")[0];
  assert.match(authConfig, /^enable_signup = false$/m, "local Supabase Auth disables public signup");
  assert.match(emailConfig, /^enable_signup = false$/m, "local email provider disables public signup");
  assert.match(emailConfig, /^enable_confirmations = true$/m, "local Supabase Auth requires confirmed email");
  assert.doesNotMatch(html, /sign\s*up|créer\s+un\s+compte/i, "admin page has no public registration flow");
  assert.match(html, /admin-auth\.js[\s\S]*operations-board\.js[\s\S]*admin-app\.js/, "admin page loads auth, board renderer, and app modules in order");
  assert.match(html, /readonly|lecture seule/i, "support workspace is explicitly presented as read-only");
  assert.match(authSource, /rpc\("get_admin_daily_operations_board_v1"/, "board data uses the dedicated backend RPC");
  assert.match(html, /id="admin-invite-form"[\s\S]*autocomplete="new-password"/, "admin page includes an invitation password form");
  assert.match(authSource, /detectSessionInUrl:\s*detectAuthCallback/, "Supabase JS callback detection is enabled for the static page");
  assert.match(authSource, /auth\.updateUser\(\{ password \}\)/, "invite password uses the authenticated updateUser API");
  assert.match(authSource, /history\.replaceState/, "successful invite completion removes callback state from browser history");
  assert.doesNotMatch(authSource + appSource + boardSource, /console\.(?:log|error|warn)\s*\([^\n]*(?:token|callback|session)/i, "admin code never logs auth callback credentials");
  assert.doesNotMatch(authSource + appSource + boardSource, /textContent\s*=\s*[^;]*(?:access_token|refresh_token|error_description)/i, "admin code never renders callback credentials");
  assert.equal(/\.from\s*\(\s*["'](?!organisation_members)/.test(authSource + appSource), false, "admin code makes no customer, payment, or dashboard query");
  assert.equal(/service_role|sb_secret_|SUPABASE_SERVICE_ROLE_KEY|STRIPE_SECRET_KEY|ZEPTOMAIL_API_TOKEN/i.test(authSource + appSource + boardSource + html), false, "admin source contains no server secret key material");
  assert.equal(/localStorage|sessionStorage|location\.search|URLSearchParams/.test(authSource + appSource), false, "organisation selection is not trusted from browser storage or URL");
  console.log("Admin auth V1 tests passed (auth, membership, and route-gating scenarios).");
})().catch((error) => { console.error(error); process.exitCode = 1; });
