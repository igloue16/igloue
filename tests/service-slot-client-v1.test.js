const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const context = vm.createContext({
  console,
  IGLOUE_SUPABASE_CONFIG: { projectUrl: "https://stage.example.test", publishableKey: "sb_publishable_test" },
});
context.window = context;
let capturedRequest;
context.fetch = async (url, options) => {
  assert.equal(url, "https://stage.example.test/functions/v1/service-slot-availability");
  assert.equal(options.headers.apikey, "sb_publishable_test");
  assert.equal("authorization" in Object.fromEntries(Object.entries(options.headers).map(([key, value]) => [key.toLowerCase(), value])), false);
  const request = JSON.parse(options.body);
  capturedRequest = request;
  return Response.json({ ok: true, serviceDate: request.serviceDate, serviceType: request.serviceType, windows: request.includeAlternatives ? [] : [
    { id: "morning", label: "08:00–10:00", startTime: "08:00:00", endTime: "10:00:00", timeZone: "Europe/Paris", remainingCapacity: 1, available: true },
    ...(request.includeAlternatives ? [] : [{ id: "full", label: "Full", startTime: "10:00", endTime: "12:00", timeZone: "Europe/Paris", remainingCapacity: 0, available: false }]),
    { id: "hidden", label: "ignored", startTime: "10:00", endTime: "12:00", available: true },
  ], alternatives: request.includeAlternatives ? { earlier: { date: "2026-10-14", timeZone: "Europe/Paris", windows: [
    { id: "morning", label: "08:00–10:00", startTime: "08:00", endTime: "10:00" }], pricing: { currentRental: 70, proposedRental: 80,
      rentalImpact: 10, deliveryCharge: 29, collectionCharge: 0, setupCharge: 0, extendedExhaustCharge: 9, expressCharge: 0, schedulingSurcharge: 0, currentTotal: 99, total: 118, depositAmount: 250,
      delta: 19, currency: "EUR", vat: { status: "not_configured" } } }, later: null, horizonDays: 14 } : null });
};
vm.runInContext(fs.readFileSync(path.resolve(__dirname, "../assets/js/availability.js"), "utf8"), context);
vm.runInContext(fs.readFileSync(path.resolve(__dirname, "../assets/js/service-slot-client.js"), "utf8"), context);

(async () => {
  const result = await context.IGLOUE_SERVICE_SLOT_CLIENT.loadAvailableSlots({
    productId: "product-a", date: "2026-10-14", serviceType: "delivery",
  });
  assert.equal(result.length, 1, "malformed response rows are excluded");
  assert.equal(result[0].label, "08:00–10:00");
  assert.equal(context.IGLOUE_DELIVERY_SLOT_PROVIDER.getWindowById("morning", {
    productId: "product-a", date: "2026-10-14", serviceType: "delivery",
  }).available, true);
  const suggestion = await context.IGLOUE_SERVICE_SLOT_CLIENT.loadAvailability({ productId: "product-a", date: "2026-10-15",
    serviceType: "delivery", includeAlternatives: true, quoteContext: { startDate: "2026-10-15", endDate: "2026-10-22",
      postcode: "16000", setupMode: "none", extendedExhaustSelected: true, items: [{ productId: "product-a", quantity: 1 }] } });
  assert.equal(suggestion.windows.length, 0);
  assert.equal(capturedRequest.quoteContext.extendedExhaustSelected, true);
  assert.equal(suggestion.alternatives.earlier.pricing.extendedExhaustCharge, 9);
  assert.equal(suggestion.alternatives.earlier.pricing.total, 118);
  assert.equal(suggestion.alternatives.earlier.pricing.delta, 19);
  assert.equal(context.IGLOUE_DELIVERY_SLOT_PROVIDER.getWindowById("morning", {
    productId: "product-a", date: "2026-10-14", serviceType: "delivery",
  }).available, true, "alternative suggestions are not cached as authoritative capacity for another date");
  console.log("Service slot client allowlist and backend cache passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
