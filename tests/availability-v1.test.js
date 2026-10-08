const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../assets/js/availability.js"), "utf8");
const context = vm.createContext({});
context.window = context;
vm.runInContext(source, context, { filename: "availability.js" });

const provider = context.IGLOUE_DELIVERY_SLOT_PROVIDER;
assert.ok(provider, "backend service-window cache is available to the page");

const deliveryRequest = { productId: "tenant-a-product", date: "2026-10-08", serviceType: "delivery" };
assert.deepEqual(Array.from(provider.getAvailableSlots(deliveryRequest)), [], "an unqueried date has no invented slots");
assert.equal(provider.hasAvailableSameDaySlot({ deliveryDate: deliveryRequest.date, productId: deliveryRequest.productId }), false);

assert.equal(provider.setAvailableSlots(deliveryRequest, [
  { id: "available", label: "08:00–10:00", available: true, remainingCapacity: 1 },
  { id: "full", label: "10:00–12:00", available: false, remainingCapacity: 0 },
  { label: "malformed", available: true },
]), true);
assert.deepEqual(
  Array.from(provider.getAvailableSlots(deliveryRequest), (slot) => slot.id),
  ["available"],
  "only backend rows with remaining capacity are selectable",
);
assert.equal(provider.hasAvailableSameDaySlot({ deliveryDate: deliveryRequest.date, productId: deliveryRequest.productId }), true);
assert.equal(provider.hasAvailableSameDaySlot({ deliveryDate: deliveryRequest.date, productId: "tenant-b-product" }), false,
  "availability cache is scoped by product and cannot bleed between tenants");
assert.equal(provider.getWindowById("full", deliveryRequest).available, false,
  "a full backend window remains visible only as non-selectable data");

provider.clear();
assert.deepEqual(Array.from(provider.getAvailableSlots(deliveryRequest)), [], "clearing the backend cache removes availability");
assert.equal(provider.hasAvailableSameDaySlot({ deliveryDate: deliveryRequest.date, productId: deliveryRequest.productId }), false);

console.log("Availability V1 backend-cache scenarios passed (no browser-invented schedule).");
