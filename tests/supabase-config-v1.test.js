const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "assets/js/supabase-config.js"), "utf8");

assert.match(
  source,
  /const selected = \{"backend":"staging"/,
  "configuration tests must run against the generated staging artifact, not the repository source config",
);

function load(hostname, search = "") {
  const context = { window: { location: { hostname, search } } };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "supabase-config.js" });
  return context.window.IGLOUE_SUPABASE_CONFIG;
}

const staging = load("test.igloue.fr");
assert.equal(staging.backend, "staging");
assert.equal(staging.projectUrl, "https://fxhdxilvbzojkyyhktnu.supabase.co");
assert.equal(
  staging.verificationGatewayUrl,
  "https://igloue-customer-email-verification-gateway.plain-lab-58bb.workers.dev/customer-email-verification",
);
assert.match(staging.publishableKey, /^sb_publishable_/);
assert.equal(load("test.app.igloue.eu").backend, "staging");

for (const hostname of [
  "igloue.fr",
  "www.igloue.fr",
  "app.igloue.eu",
  "localhost",
  "127.0.0.1",
  "preview.pages.dev",
  "feature-branch.github.io",
  "test.igloue.fr.evil.example",
  "unknown.example",
]) {
  assert.equal(load(hostname), null, `${hostname} has no Supabase configuration`);
}
assert.equal(load("preview.pages.dev", "?ig-dev-backend=local"), null);
assert.equal(/www\.igloue\.fr|sb_secret_|SUPABASE_SERVICE_ROLE_KEY|ZEPTOMAIL_API_TOKEN/i.test(source), false);
console.log("Staging release Supabase configuration tests passed.");
