const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "assets/js/platform-admin.js"), "utf8");
const html = fs.readFileSync(path.join(root, "platform-admin.html"), "utf8");

function load(hostname = "test.igloue.fr", rpcResult = { environment: "staging" }) {
  let rpcCall;
  let clientOptions;
  const config = { backend: "staging", projectUrl: "https://staging.example.test", publishableKey: "sb_publishable_staging" };
  const window = {
    location: { hostname },
    IGLOUE_SUPABASE_CONFIG: config,
    supabase: { createClient(url, key, options) {
      clientOptions = { url, key, options };
      return { rpc: async (name, args) => { rpcCall = { name, args }; return rpcResult && Object.hasOwn(rpcResult, "data") ? rpcResult : { data: rpcResult, error: null }; } };
    } },
  };
  vm.runInNewContext(source, { window, Date, Intl, String, Object, Error, URLSearchParams }, { filename: "platform-admin.js" });
  return { api: window.IgPlatformAdmin, get rpcCall() { return rpcCall; }, get clientOptions() { return clientOptions; } };
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

test("page labels staging, offers only read sections, and has no direct privileged-table path", () => {
  assert.match(html, /STAGING/);
  for (const section of ["overview", "tenants", "employees", "roles", "audit", "approvals"]) assert.match(html, new RegExp(`data-section="${section}"`));
  assert.doesNotMatch(html, /approve|reject|suspend|impersonat/i);
  assert.doesNotMatch(source, /\.from\s*\(/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|user_metadata|app_metadata/);
  assert.match(source, /platform_control_plane_read_v1/);
  assert.match(html, /name="referrer" content="no-referrer"/);
});

test("rendered content is constructed with text nodes rather than HTML interpolation", () => {
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|outerHTML/);
  assert.match(source, /textContent\s*=/);
  assert.match(source, /createElement\(/);
});
