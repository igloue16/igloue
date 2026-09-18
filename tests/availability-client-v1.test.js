const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const clientSource = fs.readFileSync(path.join(root, "assets/js/availability-client.js"), "utf8");
assert.equal(/service_role|sb_secret|SUPABASE_SERVICE_ROLE_KEY/i.test(clientSource), false, "client has no privileged credential dependency");
let requests = [];
let response = { ok: true, json: async () => ({ ok: true, available: true, productId: "essential" }) };
const context = vm.createContext({
  console,
  fetch: async (url, options) => {
    requests.push({ url, options });
    return response;
  }
});
context.window = context;
vm.runInContext(fs.readFileSync(path.join(root, "assets/js/supabase-config.js"), "utf8"), context);
context.IGLOUE_SUPABASE_CONFIG = { projectUrl: "https://demo.supabase.co", publishableKey: "sb_publishable_test" };
vm.runInContext(fs.readFileSync(path.join(root, "assets/js/availability-client.js"), "utf8"), context);

const request = { productId: "essential", startDate: "2027-07-12", endDate: "2027-07-19", deliverySlotId: "0830-1030", collectionSlotId: "1630-1830" };
const check = () => vm.runInContext(`IGLOUE_AVAILABILITY_CLIENT.checkAvailability(${JSON.stringify(request)})`, context);

(async () => {
  requests = [];
  let result = await check();
  assert.equal(requests[0].url, "https://demo.supabase.co/functions/v1/check-availability");
  assert.equal(requests[0].options.method, "POST");
  assert.equal(requests[0].options.headers.apikey, "sb_publishable_test");
  assert.deepEqual(JSON.parse(requests[0].options.body), { productId: "essential", rental: { startDate: request.startDate, endDate: request.endDate }, service: { deliverySlotId: request.deliverySlotId, collectionSlotId: request.collectionSlotId } });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { status: "available", available: true, productId: "essential" });
  response = { ok: true, json: async () => ({ ok: true, available: false, productId: "essential" }) };
  assert.deepEqual(JSON.parse(JSON.stringify(await check())), { status: "unavailable", available: false, productId: "essential" });
  response = { ok: true, json: async () => ({ ok: true, available: true, productId: "essential", available_count: 2, machine_ids: ["hidden"] }) };
  result = await check();
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { status: "available", available: true, productId: "essential" });
  response = { ok: true, json: async () => ({ ok: true, available: "yes", productId: "essential" }) };
  assert.equal((await check()).status, "error");
  response = { ok: true, json: async () => ({ ok: true, available: true }) };
  assert.equal((await check()).status, "error");
  response = { ok: true, json: async () => { throw new Error("invalid json"); } };
  assert.equal((await check()).status, "error");
  response = { ok: true, json: async () => ({ ok: true, available: true, productId: "max-pro" }) };
  assert.equal((await check()).status, "error");
  response = { ok: false, json: async () => ({ error: "database detail" }) };
  assert.equal((await check()).status, "error");
  context.fetch = async () => { throw new Error("offline"); };
  assert.equal((await check()).status, "error");
  context.fetch = async (url, options) => {
    requests.push({ url, options });
    return response;
  };
  context.IGLOUE_SUPABASE_CONFIG = {
    projectUrl: "https://YOUR_PROJECT_REF.supabase.co",
    publishableKey: "sb_publishable_REPLACE_WITH_PROJECT_KEY"
  };
  requests = [];
  assert.equal((await check()).status, "error");
  assert.equal(requests.length, 0);
  context.IGLOUE_SUPABASE_CONFIG = { projectUrl: "https://demo.supabase.co/", publishableKey: "sb_publishable_test" };
  response = { ok: true, json: async () => ({ ok: true, available: true, productId: "essential" }) };
  requests = [];
  assert.equal((await check()).status, "available");
  assert.equal(requests[0].url, "https://demo.supabase.co/functions/v1/check-availability");
  console.log("Availability client V1 tests passed (19 assertions / 14 scenarios).");
})().catch((error) => { console.error(error); process.exitCode = 1; });
