const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "assets/js/supabase-config.js"), "utf8");

function load(location) {
  const context = { URLSearchParams, window: { location } };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "supabase-config.js" });
  return context.window.IGLOUE_SUPABASE_CONFIG;
}

const local = load({ hostname: "127.0.0.1", search: "?ig-dev-backend=local" });
assert.equal(local.backend, "local");
assert.equal(local.projectUrl, "http://127.0.0.1:54321");
assert.equal(local.verificationGatewayUrl, "http://127.0.0.1:8787/customer-email-verification");
assert.match(local.publishableKey, /^sb_publishable_/);

const localhost = load({ hostname: "localhost", search: "?ig-dev-backend=local" });
assert.equal(localhost.backend, "local");
assert.equal(localhost.projectUrl, "http://127.0.0.1:54321");

const staging = load({ hostname: "test.igloue.fr", search: "" });
assert.equal(staging.backend, "staging");
assert.equal(staging.projectUrl, "https://fxhdxilvbzojkyyhktnu.supabase.co");
assert.equal(
  staging.verificationGatewayUrl,
  "https://igloue-customer-email-verification-gateway.plain-lab-58bb.workers.dev/customer-email-verification",
);
assert.match(staging.publishableKey, /^sb_publishable_/);
const platformStaging = load({ hostname: "test.app.igloue.eu", search: "" });
assert.equal(platformStaging.backend, "staging");

const production = load({ hostname: "igloue.fr", search: "" });
assert.equal(production.backend, "hosted");
assert.equal(production.projectUrl, "https://ksciaqmlvdycrnoqjzgt.supabase.co");
assert.equal(production.verificationGatewayUrl, "");

const wwwProduction = load({ hostname: "www.igloue.fr", search: "" });
assert.equal(wwwProduction.backend, "hosted");
assert.equal(wwwProduction.projectUrl, production.projectUrl);

const unknown = load({ hostname: "preview.igloue.fr", search: "" });
assert.equal(unknown, null);

const similarHostname = load({ hostname: "test.igloue.fr.evil.example", search: "" });
assert.equal(similarHostname, null);

const hostedWithoutSwitch = load({ hostname: "localhost", search: "" });
assert.equal(hostedWithoutSwitch, null);

const hostedOnProduction = load({ hostname: "igloue.example", search: "?ig-dev-backend=local" });
assert.equal(hostedOnProduction, null);

assert.equal(/service_role|secret|eyJ/i.test(source), false);
assert.equal(/sb_secret_/i.test(source), false);
console.log("Supabase configuration selection tests passed.");
