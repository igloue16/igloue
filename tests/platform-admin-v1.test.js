const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "assets/js/platform-admin.js"), "utf8");
const html = fs.readFileSync(path.join(root, "platform-admin.html"), "utf8");

function load(hostname = "test.igloue.fr", rpcResult = { environment: "staging" }) {
  const rpcCalls = [];
  let clientOptions;
  const config = { backend: "staging", projectUrl: "https://staging.example.test", publishableKey: "sb_publishable_staging" };
  const window = {
    location: { hostname },
    crypto: { randomUUID: () => "00000000-0000-4000-8000-00000000f001" },
    IGLOUE_SUPABASE_CONFIG: config,
    supabase: { createClient(url, key, options) {
      clientOptions = { url, key, options };
      return { rpc: async (name, args) => {
        rpcCalls.push({ name, args });
        if (rpcResult && Object.hasOwn(rpcResult, name)) return rpcResult[name];
        return rpcResult && Object.hasOwn(rpcResult, "data") ? rpcResult : { data: rpcResult, error: null };
      } };
    } },
  };
  vm.runInNewContext(source, { window, Date, Intl, String, Object, Error, URLSearchParams }, { filename: "platform-admin.js" });
  return { api: window.IgPlatformAdmin, get rpcCalls() { return rpcCalls; }, get rpcCall() { return rpcCalls.at(-1); }, get clientOptions() { return clientOptions; } };
}

test("platform read API is staging-only and uses the database RPC", async () => {
  const loaded = load();
  assert.deepEqual(loaded.api.configuration(), { backend: "staging", projectUrl: "https://staging.example.test", publishableKey: "sb_publishable_staging" });
  const result = await loaded.api.read("tenant", "tenant-slug");
  assert.equal(result.environment, "staging");
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.rpcCall)), { name: "platform_control_plane_read_v1", args: { p_section: "tenant", p_slug: "tenant-slug" } });
  assert.equal(loaded.clientOptions.options.auth.persistSession, true, "only the normal Supabase Auth session is persisted");
});

test("production hostname cannot initialize the platform console", async () => {
  const loaded = load("igloue.fr");
  assert.equal(loaded.api.configuration(), null);
  await assert.rejects(loaded.api.read("overview"), /configuration staging/i);
});

test("backend permission denial is propagated as a closed-access result", async () => {
  const loaded = load("test.igloue.fr", { data: null, error: { code: "42501", message: "platform access denied" } });
  await assert.rejects(loaded.api.read("overview"), /DENIED/);
});

test("support session starts from a tenant slug with explicit read-only scope and fixed expiry", async () => {
  const loaded = load("test.igloue.fr", {
    platform_open_support_session_for_tenant: { data: "session-uuid", error: null },
  });
  const result = await loaded.api.openSupportSession("tenant-a", "Customer asked for help with reservation status");
  assert.equal(result, "session-uuid");
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.rpcCall)), {
    name: "platform_open_support_session_for_tenant",
    args: { p_organisation_slug: "tenant-a", p_reason: "Customer asked for help with reservation status", p_ttl_seconds: 1800 },
  });
});

test("support view requires server response for the exact session and fails closed when revoked", async () => {
  const valid = { session: { id: "session-uuid", access_mode: "read" }, tenant: { slug: "tenant-a" } };
  const loaded = load("test.igloue.fr", { platform_support_session_read_v1: { data: valid, error: null } });
  assert.deepEqual(JSON.parse(JSON.stringify(await loaded.api.readSupportSession("session-uuid"))), valid);
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.rpcCall)), {
    name: "platform_support_session_read_v1", args: { p_session: "session-uuid" },
  });

  const denied = load("test.igloue.fr", { platform_support_session_read_v1: { data: null, error: { code: "42501", message: "revoked" } } });
  await assert.rejects(denied.api.readSupportSession("session-uuid"), /DENIED/);

  const expired = load("test.igloue.fr", { platform_support_session_read_v1: { data: { error: "expired" }, error: null } });
  await assert.rejects(expired.api.readSupportSession("session-uuid"), /EXPIRED/);
});

test("support workspace requests are session-bound RPC reads with allowlisted sections", async () => {
  const expected = { items: [{ reference: "A1B2C3D4", status: "confirmed" }] };
  const loaded = load("test.igloue.fr", { platform_support_workspace_read_v1: { data: expected, error: null } });
  assert.deepEqual(JSON.parse(JSON.stringify(await loaded.api.readSupportWorkspace("session-uuid", "reservations"))), expected);
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.rpcCall)), {
    name: "platform_support_workspace_read_v1",
    args: { p_session: "session-uuid", p_section: "reservations", p_reservation_reference: null },
  });
  const detail = load("test.igloue.fr", { platform_support_workspace_read_v1: { data: { reference: "A1B2C3D4" }, error: null } });
  await detail.api.readSupportWorkspace("session-uuid", "reservation", "A1B2C3D4");
  assert.equal(detail.rpcCall.args.p_reservation_reference, "A1B2C3D4");
  const denied = load("test.igloue.fr", { platform_support_workspace_read_v1: { data: null, error: { code: "42501", message: "expired" } } });
  await assert.rejects(denied.api.readSupportWorkspace("session-uuid", "summary"), /DENIED/);
});

test("support outbox candidates are loaded through the session-bound allowlist RPC", async () => {
  const expected = { items: [{ event_id: "event-uuid", status: "failed", can_retry: true }] };
  const loaded = load("test.igloue.fr", { platform_support_outbox_retry_candidates_v1: { data: expected, error: null } });
  assert.deepEqual(JSON.parse(JSON.stringify(await loaded.api.readSupportOutboxCandidates("session-uuid"))), expected);
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.rpcCall)), {
    name: "platform_support_outbox_retry_candidates_v1",
    args: { p_session: "session-uuid" },
  });
  await assert.rejects(loaded.api.readSupportOutboxCandidates(null), /DENIED/);
});

test("outbox retry sends a reason and fresh idempotency key to the dedicated RPC", async () => {
  const loaded = load("test.igloue.fr", {
    platform_support_retry_outbox_event_v1: { data: { event_id: "event-uuid", status: "pending", replayed: false }, error: null },
  });
  const result = await loaded.api.retrySupportOutboxEvent("session-uuid", "event-uuid", "Retry failed event after provider outage");
  assert.equal(result.status, "pending");
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.rpcCall)), {
    name: "platform_support_retry_outbox_event_v1",
    args: {
      p_session: "session-uuid",
      p_event_id: "event-uuid",
      p_reason: "Retry failed event after provider outage",
      p_idempotency_key: "00000000-0000-4000-8000-00000000f001",
    },
  });
  await assert.rejects(loaded.api.retrySupportOutboxEvent("session-uuid", "event-uuid", "too short"), /REASON_REQUIRED/);
  const denied = load("test.igloue.fr", {
    platform_support_retry_outbox_event_v1: { data: null, error: { code: "42501", message: "permission denied" } },
  });
  await assert.rejects(denied.api.retrySupportOutboxEvent("session-uuid", "event-uuid", "Retry failed event after provider outage"), /DENIED/);
});

test("outbox retry action is available only for failed eligible events", () => {
  const { api } = load("test.igloue.fr");
  assert.equal(api.supportOutboxRetryAvailable({ event_id: "e1", status: "failed", can_retry: true }), true);
  assert.equal(api.supportOutboxRetryAvailable({ event_id: "e1", status: "failed", can_retry: false }), false);
  assert.equal(api.supportOutboxRetryAvailable({ event_id: "e1", status: "processing", can_retry: true }), false);
  assert.equal(api.supportOutboxRetryAvailable({ event_id: "e1", status: "completed", can_retry: true }), false);
  assert.equal(api.supportOutboxRetryAvailable({ status: "failed", can_retry: true }), false);
});

test("support exit requires backend confirmation of revocation", async () => {
  const valid = load("test.igloue.fr", { platform_revoke_support_session: { data: true, error: null } });
  assert.equal(await valid.api.revokeSupportSession("session-uuid", "Employee manually exited support mode"), true);
  assert.deepEqual(JSON.parse(JSON.stringify(valid.rpcCall)), {
    name: "platform_revoke_support_session",
    args: { p_session: "session-uuid", p_reason: "Employee manually exited support mode" },
  });

  const failed = load("test.igloue.fr", { platform_revoke_support_session: { data: false, error: null } });
  await assert.rejects(failed.api.revokeSupportSession("session-uuid", "Employee manually exited support mode"), /confirmer/i);
});

test("page labels staging, provides controlled support flow, and has no direct privileged-table path", () => {
  assert.match(html, /STAGING/);
  for (const section of ["overview", "tenants", "employees", "roles", "audit", "approvals"]) assert.match(html, new RegExp(`data-section="${section}"`));
  assert.match(html, /Entrer en mode support/);
  assert.match(html, /lecture seule/i);
  assert.match(html, /platform-support-exit/);
  for (const section of ["summary", "reservations", "customers", "equipment", "communications", "issues", "audit"]) assert.match(html, new RegExp(`data-support-section="${section}"`));
  assert.match(html, /minlength="20"/);
  assert.doesNotMatch(html, /approve|reject|suspend|impersonat/i);
  assert.doesNotMatch(source, /\.from\s*\(/);
  assert.doesNotMatch(source, /localStorage|user_metadata|app_metadata/);
  assert.match(source, /SUPPORT_SESSION_KEY/);
  assert.match(source, /platform_support_session_read_v1/);
  assert.match(source, /platform_support_workspace_read_v1/);
  assert.match(source, /platform_support_outbox_retry_candidates_v1/);
  assert.match(source, /platform_support_retry_outbox_event_v1/);
  assert.match(source, /function supportOutboxRetryAvailable\(event\)/);
  assert.match(source, /ACTIONS DE SUPPORT/);
  assert.match(source, /Confirmer le r\u00e9essai/);
  assert.match(source, /reason\.minLength = 20/);
  assert.match(source, /handleSupportSessionFailure/);
  assert.doesNotMatch(source, /platform\.support\.write/);
  assert.match(source, /platform_control_plane_read_v1/);
  assert.match(html, /name="referrer" content="no-referrer"/);
});

test("rendered content is constructed with text nodes rather than HTML interpolation", () => {
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|outerHTML/);
  assert.match(source, /textContent\s*=/);
  assert.match(source, /createElement\(/);
});

test("support equipment copy uses generic equipment terminology", () => {
  assert.match(source, /Équipements physiques/);
  assert.match(source, /Répartition des équipements affichés/);
  assert.match(source, /Aucun équipement/);
  assert.match(source, /Équipement \$\{m\.unit\}/);
  assert.doesNotMatch(source, /"Machines physiques"|"Répartition des unités affichées|"Aucune machine\."|"Aucune machine"/);
});
