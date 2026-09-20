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

const hostedWithoutSwitch = load({ hostname: "localhost", search: "" });
assert.equal(hostedWithoutSwitch.backend, "hosted");
assert.match(hostedWithoutSwitch.projectUrl, /^https:\/\//);

const hostedOnProduction = load({ hostname: "igloue.example", search: "?ig-dev-backend=local" });
assert.equal(hostedOnProduction.backend, "hosted");
assert.match(hostedOnProduction.projectUrl, /^https:\/\//);

assert.equal(/service_role|secret|eyJ/i.test(source), false);
console.log("Supabase configuration selection tests passed (9 assertions).");
