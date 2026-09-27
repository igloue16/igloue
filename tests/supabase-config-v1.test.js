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
assert.match(local.publishableKey, /^sb_publishable_/);

const localhost = load({ hostname: "localhost", search: "?ig-dev-backend=local" });
assert.equal(localhost.backend, "local");
assert.equal(localhost.projectUrl, "http://127.0.0.1:54321");

const staging = load({ hostname: "test.igloue.fr", search: "" });
assert.equal(staging.backend, "staging");
assert.equal(staging.projectUrl, "https://fxhdxilvbzojkyyhktnu.supabase.co");
assert.match(staging.publishableKey, /^sb_publishable_/);

const production = load({ hostname: "igloue.fr", search: "" });
assert.equal(production.backend, "hosted");
assert.equal(production.projectUrl, "https://ksciaqmlvdycrnoqjzgt.supabase.co");

const wwwProduction = load({ hostname: "www.igloue.fr", search: "" });
assert.equal(wwwProduction.backend, "hosted");
assert.equal(wwwProduction.projectUrl, production.projectUrl);

const unknown = load({ hostname: "preview.igloue.fr", search: "" });
assert.equal(unknown.backend, "hosted");
assert.equal(unknown.projectUrl, production.projectUrl);

const similarHostname = load({ hostname: "test.igloue.fr.evil.example", search: "" });
assert.equal(similarHostname.backend, "hosted");
assert.equal(similarHostname.projectUrl, production.projectUrl);

const hostedWithoutSwitch = load({ hostname: "localhost", search: "" });
assert.equal(hostedWithoutSwitch.backend, "hosted");
assert.match(hostedWithoutSwitch.projectUrl, /^https:\/\//);

const hostedOnProduction = load({ hostname: "igloue.example", search: "?ig-dev-backend=local" });
assert.equal(hostedOnProduction.backend, "hosted");
assert.match(hostedOnProduction.projectUrl, /^https:\/\//);

assert.equal(/service_role|secret|eyJ/i.test(source), false);
assert.equal(/sb_secret_/i.test(source), false);
console.log("Supabase configuration selection tests passed.");
