const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class Element {
  constructor(tag = "div", attrs = {}, parent = null) {
    this.tagName = tag.toUpperCase();
    this.attributes = attrs;
    this.parentNode = parent;
    this.children = [];
    this.listeners = {};
    this.hidden = false;
    this.disabled = false;
    this.textContent = "";
    this.scrollTop = 0;
    this.classList = {
      toggle: (name, value) => {
        const names = new Set((this.attributes.class || "").split(/\s+/).filter(Boolean));
        if (value) names.add(name); else names.delete(name);
        this.attributes.class = [...names].join(" ");
      },
      contains: (name) => (this.attributes.class || "").split(/\s+/).includes(name)
    };
  }

  get dataset() {
    return Object.fromEntries(Object.entries(this.attributes)
      .filter(([key]) => key.startsWith("data-"))
      .map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value]));
  }

  set innerHTML(value) {
    this.html = String(value);
    this.children = parseElements(this.html, this);
  }

  get innerHTML() { return this.html || ""; }

  addEventListener(type, handler) {
    (this.listeners[type] ||= []).push(handler);
  }

  click() {
    if (this.disabled) return;
    for (const handler of this.listeners.click || []) handler({ target: this, preventDefault() {} });
  }

  dispatchEvent(event) {
    for (const handler of this.listeners[event.type] || []) handler(event);
  }

  focus() {}

  closest(selector) {
    let current = this;
    while (current) {
      if (matches(current, selector)) return current;
      current = current.parentNode;
    }
    return null;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const found = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (matches(child, selector)) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }
}

function parseElements(html, parent) {
  const roots = [];
  const stack = [parent];
  const tagPattern = /<\/?([a-zA-Z][\w-]*)([^>]*)>/g;
  let match;
  while ((match = tagPattern.exec(html))) {
    if (match[0].startsWith("</")) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const attrs = {};
    for (const attribute of match[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g)) {
      attrs[attribute[1]] = attribute[2] || "";
    }
    const element = new Element(match[1], attrs, stack[stack.length - 1]);
    stack[stack.length - 1].children.push(element);
    if (stack.length === 1) roots.push(element);
    if (!/\/\s*>$/.test(match[0]) && !["input", "img", "br", "hr", "meta", "link", "use"].includes(match[1])) {
      stack.push(element);
    }
  }
  return roots;
}

function matches(element, selector) {
  const tag = selector.match(/^([\w-]+)/)?.[1];
  if (tag && element.tagName.toLowerCase() !== tag.toLowerCase()) return false;
  const id = selector.match(/#([\w-]+)/)?.[1];
  if (id && element.attributes.id !== id) return false;
  const classes = [...selector.matchAll(/\.([\w-]+)/g)].map((match) => match[1]);
  if (classes.some((name) => !element.classList.contains(name))) return false;
  const attributes = [...selector.matchAll(/\[([^\]=]+)(?:="([^"]*)")?\]/g)];
  return attributes.every(([, name, expected]) =>
    Object.prototype.hasOwnProperty.call(element.attributes, name) &&
    (expected === undefined || element.attributes[name] === expected));
}

const root = path.resolve(__dirname, "..");
const assistantRoot = new Element("main", { "data-assistant": "" });
let domReadyHandler;
let animationCallbacks = [];
const document = {
  documentElement: { lang: "fr-FR" },
  querySelector: (selector) => selector === "[data-assistant]" ? assistantRoot : null,
  addEventListener: (type, handler) => { if (type === "DOMContentLoaded") domReadyHandler = handler; }
};

const context = vm.createContext({
  console,
  Date,
  Intl,
  Set,
  Math,
  JSON,
  document,
  window: null,
  requestAnimationFrame: (callback) => animationCallbacks.push(callback)
});
context.window = context;
context.IGLOUE_SERVICE_SLOT_CLIENT = {
  async loadAvailability(input) {
    const windows = [{ id: input.serviceType === "delivery" ? "0830-1030" : "1630-1830", label: "08:30–10:30",
      startTime: "08:30", endTime: "10:30", timeZone: "Europe/Paris", remainingCapacity: 1, available: true }];
    context.IGLOUE_DELIVERY_SLOT_PROVIDER?.setAvailableSlots({ productId: input.productId, date: input.date, serviceType: input.serviceType }, windows);
    return { windows, alternatives: null };
  }
};

[
  "pricing.js", "delivery.js", "schedule-provider.js", "bookings-provider.js",
  "availability.js", "reservation.js", "products.js", "inventory.js",
  "fleet.js", "fleet-allocation.js", "calendar.js", "supabase-config.js",
  "availability-state.js", "alternative-availability-state.js", "assistant.js"
].forEach((filename) => {
  vm.runInContext(fs.readFileSync(path.join(root, "assets/js", filename), "utf8"), context, { filename });
});

let resolveAvailability;
const calls = [];
context.IGLOUE_AVAILABILITY_CLIENT = {
  checkAvailability(selection) {
    calls.push({ ...selection });
    return new Promise((resolve) => { resolveAvailability = resolve; });
  }
};

vm.runInContext(`
  assistantState.postcode = "16000";
  assistantState.deliveryZone = { id: "local", name: "Angoulême proche" };
  assistantState.deliveryPrice = 29;
  assistantState.roomType = "bedroom";
  assistantState.roomArea = 20;
  assistantState.roomConditions = [];
  assistantState.openingType = "casement";
  assistantState.startDate = "2027-07-12";
  assistantState.endDate = "2027-07-19";
  assistantState.deliverySlotId = "0830-1030";
  assistantState.collectionSlotId = "1630-1830";
  assistantState.recommendedProduct = getProductById("essential");
  assistantState.idealProduct = assistantState.recommendedProduct;
  showDatesStage(false);
`, context);

(async () => {
const continueButton = assistantRoot.querySelector("[data-dates-continue]");
assert.ok(continueButton, "the actual Dates Continue control is rendered");
await new Promise((resolve) => setImmediate(resolve));
const initialSlotButtons = assistantRoot.querySelectorAll("[data-slot-id]");
initialSlotButtons[0].click();
initialSlotButtons[1].click();
continueButton.click();
await Promise.resolve();

assert.equal(calls.length, 1, "Continue makes exactly one real availability request");
assert.deepEqual(calls[0], {
  productId: "essential",
  startDate: "2027-07-12",
  endDate: "2027-07-19",
  deliverySlotId: "0830-1030",
  collectionSlotId: "1630-1830"
});
assert.equal(assistantRoot.querySelector("#assistant-dates-error").textContent, "Vérification de la disponibilité…");
assert.equal(assistantRoot.querySelector("[data-dates-continue]").disabled, true);
assert.equal(assistantRoot.querySelector("[data-assistant-stage=\"recommendation\"]"), null);

assistantRoot.querySelector("[data-dates-continue]").click();
await Promise.resolve();
assert.equal(calls.length, 1, "a pending Continue cannot duplicate the request");

resolveAvailability({ status: "available", available: true, productId: "essential" });
await new Promise((resolve) => setImmediate(resolve));
for (const callback of animationCallbacks.splice(0)) callback();

assert.equal(assistantRoot.querySelector("[data-assistant-stage=\"recommendation\"]") !== null, true);
assert.equal(vm.runInContext("assistantState.availability.status", context), "available");
assert.equal(vm.runInContext("assistantState.availability.key", context), "essential|2027-07-12|2027-07-19|0830-1030|1630-1830");
assert.equal(calls.length, 1);
assert.equal(
  vm.runInContext("alternativeAvailabilityState.getState().status", context),
  "idle",
  "an available ideal product does not trigger alternative checks"
);

const alternativeCalls = [];
let resolveIdealUnavailable;
let resolveMobileDuo;
context.IGLOUE_AVAILABILITY_CLIENT = {
  checkAvailability(selection) {
    alternativeCalls.push({ ...selection });
    if (selection.productId === "essential") {
      return new Promise((resolve) => { resolveIdealUnavailable = resolve; });
    }
    return new Promise((resolve) => { resolveMobileDuo = resolve; });
  }
};

vm.runInContext(`
  availabilityState.reset();
  alternativeAvailabilityState.reset();
  assistantState.recommendedProduct = getProductById("essential");
  assistantState.idealProduct = assistantState.recommendedProduct;
  showDatesStage(false);
`, context);

const unavailableContinue = assistantRoot.querySelector("[data-dates-continue]");
assert.ok(unavailableContinue, "the unavailable flow starts from the real Continue control");
unavailableContinue.click();
await Promise.resolve();
assert.equal(alternativeCalls.length, 1, "the ideal product availability check starts first");
resolveIdealUnavailable({ status: "unavailable", available: false, productId: "essential" });
await new Promise((resolve) => setImmediate(resolve));
assert.match(
  assistantRoot.innerHTML,
  /Nous vérifions les alternatives/,
  "the assistant shows the alternative checking state"
);
assert.equal(alternativeCalls.length, 2, "the suitable alternative check follows the ideal result");
assert.deepEqual(alternativeCalls[1], {
  productId: "mobile-duo",
  startDate: "2027-07-12",
  endDate: "2027-07-19",
  deliverySlotId: "0830-1030",
  collectionSlotId: "1630-1830"
});
resolveMobileDuo({ status: "available", available: true, productId: "mobile-duo" });
await new Promise((resolve) => setImmediate(resolve));
for (const callback of animationCallbacks.splice(0)) callback();

const alternativeButton = assistantRoot.querySelector("[data-select-alternative]");
assert.ok(alternativeButton, "a server-confirmed alternative is rendered");
alternativeButton.click();
assert.equal(
  vm.runInContext("assistantState.recommendedProduct.id", context),
  "mobile-duo"
);
assert.equal(
  vm.runInContext("assistantState.availability.key", context),
  "mobile-duo|2027-07-12|2027-07-19|0830-1030|1630-1830",
  "the confirmed alternative is promoted to the primary exact availability key"
);
assert.equal(alternativeCalls.length, 2, "selecting a confirmed alternative does not recheck it");

async function resetDatesForBranch({ productId = "essential", roomArea = 20, openingType = "casement" } = {}) {
  vm.runInContext(`
    availabilityState.reset();
    alternativeAvailabilityState.reset();
    assistantState.roomArea = ${roomArea};
    assistantState.openingType = "${openingType}";
    assistantState.recommendedProduct = getProductById("${productId}");
    assistantState.idealProduct = assistantState.recommendedProduct;
    showDatesStage(false);
  `, context);
  await new Promise((resolve) => setImmediate(resolve));
  const buttons = assistantRoot.querySelectorAll("[data-slot-id]");
  for (const button of buttons) button.click();
  await new Promise((resolve) => setImmediate(resolve));
}

const allUnavailableCalls = [];
let resolveUnavailableIdeal;
let resolveUnavailableAlternative;
context.IGLOUE_AVAILABILITY_CLIENT = {
  checkAvailability(selection) {
    allUnavailableCalls.push({ ...selection });
    if (selection.productId === "essential") {
      return new Promise((resolve) => { resolveUnavailableIdeal = resolve; });
    }
    return new Promise((resolve) => { resolveUnavailableAlternative = resolve; });
  }
};
await resetDatesForBranch();
assistantRoot.querySelector("[data-dates-continue]").click();
await Promise.resolve();
resolveUnavailableIdeal({ status: "unavailable", available: false, productId: "essential" });
await new Promise((resolve) => setImmediate(resolve));
resolveUnavailableAlternative({ status: "unavailable", available: false, productId: "mobile-duo" });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(assistantRoot.querySelector("[data-select-alternative]"), null, "unavailable alternatives are not offered");
assert.match(assistantRoot.innerHTML, /Aucun modèle adapté disponible/, "no-stock wording appears after all checks finish");
assert.doesNotMatch(assistantRoot.innerHTML, /ne peut pas être vérifiée/, "all-unavailable is not shown as a technical error");

let retryCalls = 0;
context.IGLOUE_AVAILABILITY_CLIENT = {
  checkAvailability(selection) {
    retryCalls += 1;
    return Promise.resolve(
      selection.productId === "essential"
        ? { status: "unavailable", available: false, productId: selection.productId }
        : { status: "error", available: null, productId: selection.productId }
    );
  }
};
await resetDatesForBranch();
assistantRoot.querySelector("[data-dates-continue]").click();
await new Promise((resolve) => setImmediate(resolve));
assert.equal(retryCalls, 2, "all-error branch checks each suitable candidate once");
assert.match(assistantRoot.innerHTML, /Réessayer/, "all-error branch exposes a retry action");
assert.doesNotMatch(assistantRoot.innerHTML, /Aucun modèle adapté disponible/, "technical errors never become no-stock wording");
assistantRoot.querySelector("[data-retry-alternatives]").click();
await new Promise((resolve) => setImmediate(resolve));
assert.equal(retryCalls, 3, "retry performs a fresh real alternative check");

let mixedCalls = 0;
context.IGLOUE_AVAILABILITY_CLIENT = {
  checkAvailability(selection) {
    mixedCalls += 1;
    if (selection.productId === "mobile-duo") {
      return Promise.resolve({ status: "unavailable", available: false, productId: selection.productId });
    }
    if (selection.productId === "split-12") {
      return Promise.resolve({ status: "available", available: true, productId: selection.productId });
    }
    return Promise.resolve({ status: "error", available: null, productId: selection.productId });
  }
};
await resetDatesForBranch({ productId: "mobile-duo", roomArea: 21 });
assistantRoot.querySelector("[data-dates-continue]").click();
await new Promise((resolve) => setImmediate(resolve));
assert.equal(mixedCalls, 3, "mixed branch checks the ideal and both suitable adjacent candidates");
assert.ok(assistantRoot.querySelector("[data-select-alternative=\"split-12\"]"), "confirmed available alternative is shown");
assert.match(assistantRoot.innerHTML, /ne peut pas être vérifiée/, "technical uncertainty remains visible");
assistantRoot.querySelector("[data-select-alternative=\"split-12\"]").click();
assert.equal(vm.runInContext("assistantState.availability.key", context), "split-12|2027-07-12|2027-07-19|0830-1030|1630-1830");
assert.equal(mixedCalls, 3, "selecting the confirmed alternative does not duplicate its request");

vm.runInContext(`
  assistantState.roomArea = 20;
  assistantState.openingType = "terrace";
  assistantState.recommendedProduct = getProductById("essential");
  assistantState.idealProduct = assistantState.recommendedProduct;
`, context);
assert.equal(vm.runInContext("getAlternativeCandidates().length", context), 0, "unsuitable adjacent products are filtered without searching farther");

const slotQuoteRequests = [];
context.IGLOUE_SERVICE_SLOT_CLIENT = {
  loadAvailability(selection) {
    slotQuoteRequests.push(selection);
    const hasSlot = selection.serviceType === "collection" || selection.date === "2027-07-11";
    const windows = hasSlot ? [{ id: selection.serviceType === "delivery" ? "alt-morning" : "1630-1830",
      label: selection.serviceType === "delivery" ? "08:30–10:30" : "16:30–18:30", startTime: "08:30", endTime: "10:30",
      timeZone: "Europe/Paris", remainingCapacity: 1, available: true }] : [];
    context.IGLOUE_SERVICE_WINDOW_CACHE.setAvailableSlots(selection, windows);
    return Promise.resolve({ windows, alternatives: selection.serviceType === "delivery" && selection.date === "2027-07-12" ? {
      earlier: { date: "2027-07-11", timeZone: "Europe/Paris", windows: [{ id: "alt-morning", label: "08:30–10:30",
        startTime: "08:30", endTime: "10:30", timeZone: "Europe/Paris", remainingCapacity: 1, available: true }],
        pricing: { proposedRental: 59, rentalImpact: 0, deliveryCharge: 29, collectionCharge: 0, setupCharge: 0,
          extendedExhaustCharge: 9, expressCharge: 0, schedulingSurcharge: 0, total: 97, delta: 0, depositChargedNow: false } },
      later: null
    } : null });
  },
  loadAvailableSlots(selection) { return this.loadAvailability(selection).then((result) => result.windows); }
};
vm.runInContext(`
  assistantState.startDate = "2027-07-12";
  assistantState.endDate = "2027-07-19";
  assistantState.roomArea = 12;
  assistantState.roomConditions = [];
  assistantState.openingType = "casement";
  assistantState.extendedExhaustRequired = true;
  assistantState.setupMode = "none";
  assistantState.recommendedProduct = getProductById("essential");
  assistantState.idealProduct = assistantState.recommendedProduct;
  showDatesStage(false);
`, context);
await new Promise((resolve) => setImmediate(resolve));
const originalQuote = slotQuoteRequests.find((selection) => selection.date === "2027-07-12");
assert.equal(originalQuote.quoteContext.extendedExhaustSelected, true, "normal slot quote includes selected exhaust add-on");
context.calculateRecommendation = () => Promise.resolve();
const chooseAltDate = assistantRoot.querySelector("[data-alternative-slot]");
assert.ok(chooseAltDate, "nearest alternate date and slot are offered");
const alternateQuoteHtml = assistantRoot.querySelector("[data-side=\"earlier\"]").innerHTML;
assert.match(alternateQuoteHtml, /Rallonge d’évacuation/, "alternate quote displays the exhaust line item");
assert.match(alternateQuoteHtml, /97,00\s*€/u, "alternate quote displays the server calculated total");
chooseAltDate.click();
await new Promise((resolve) => setImmediate(resolve));
assert.equal(vm.runInContext("assistantState.startDate", context), "2027-07-11", "alternate selection updates the calendar range");
const switchedQuote = slotQuoteRequests.find((selection) => selection.date === "2027-07-11");
assert.equal(switchedQuote.quoteContext.extendedExhaustSelected, true, `alternative date recheck retains selected exhaust add-on: ${JSON.stringify(slotQuoteRequests.filter((selection) => selection.date === "2027-07-11"))}`);
assert.equal(vm.runInContext("assistantState.deliverySlotId", context), "alt-morning", "slot selection survives the availability recheck");

// Unit changes retain service selections, while only the current server result
// may enable Continue. Technical failures expose a keyboard-operable retry.
const retryDeliveryDate = "2027-07-11";
const retryCollectionDate = "2027-07-19";
vm.runInContext(`
  assistantState.postcode = "16000";
  assistantState.startDate = "${retryDeliveryDate}";
  assistantState.endDate = "${retryCollectionDate}";
  assistantState.deliverySlotId = "0830-1030";
  assistantState.collectionSlotId = "1630-1830";
  assistantState.roomArea = 20;
  assistantState.openingType = "casement";
  assistantState.recommendedProduct = getProductById("essential");
  assistantState.idealProduct = assistantState.recommendedProduct;
  availabilityState.reset();
`, context);

let resolveOldUnit;
let resolveCurrentUnit;
const unitRequests = [];
context.IGLOUE_AVAILABILITY_CLIENT = {
  checkAvailability(selection) {
    unitRequests.push({ ...selection });
    return new Promise((resolve) => {
      if (selection.productId === "essential") resolveOldUnit = resolve;
      else resolveCurrentUnit = resolve;
    });
  }
};
vm.runInContext('selectProductChoice("essential")', context);
vm.runInContext('selectProductChoice("mobile-duo")', context);
await Promise.resolve();
assert.equal(unitRequests.length, 2, "distinct unit selections are checked independently");
assert.equal(unitRequests[1].deliverySlotId, "0830-1030", "delivery slot is preserved for the new unit check");
assert.equal(unitRequests[1].collectionSlotId, "1630-1830", "collection slot is preserved for the new unit check");
resolveOldUnit({ status: "available", available: true, productId: "essential" });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(vm.runInContext("assistantState.availability.status", context), "checking", "stale unit response cannot confirm the current unit");
assert.ok(Object.hasOwn(assistantRoot.querySelector("[data-reservation-request]").attributes, "disabled"), "Continue stays disabled while current availability is pending");
resolveCurrentUnit({ status: "error", available: null, productId: "mobile-duo" });
await new Promise((resolve) => setImmediate(resolve));
let retryButton = assistantRoot.querySelector("[data-retry-availability]");
assert.ok(retryButton, "technical availability failure offers a retry button");
assert.equal(retryButton.tagName, "BUTTON");
assert.equal(retryButton.attributes.type, "button");
assert.ok(assistantRoot.querySelector('[role="alert"]'), "technical failure is announced");
assert.ok(Object.hasOwn(assistantRoot.querySelector("[data-reservation-request]").attributes, "disabled"), "failed availability cannot proceed");
assert.equal(vm.runInContext("assistantState.startDate", context), retryDeliveryDate, "retry state preserves dates");

let retryRequests = 0;
let resolveRetry;
context.IGLOUE_AVAILABILITY_CLIENT = {
  checkAvailability(selection) {
    retryRequests += 1;
    assert.equal(selection.productId, "mobile-duo");
    assert.equal(selection.startDate, retryDeliveryDate);
    return new Promise((resolve) => { resolveRetry = resolve; });
  }
};
retryButton.click();
retryButton.click();
await Promise.resolve();
assert.equal(retryRequests, 1, "repeated retry clicks cannot start concurrent requests");
assert.equal(vm.runInContext("assistantState.availability.status", context), "checking");
assert.ok(Object.hasOwn(assistantRoot.querySelector("[data-reservation-request]").attributes, "disabled"));
resolveRetry({ status: "error", available: null, productId: "mobile-duo" });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(vm.runInContext("assistantState.availability.status", context), "error", "a failed retry returns to the recoverable error state");
assert.ok(assistantRoot.querySelector("[data-retry-availability]"), "a failed retry remains recoverable");

context.IGLOUE_AVAILABILITY_CLIENT = {
  checkAvailability(selection) {
    retryRequests += 1;
    return Promise.resolve({ status: "available", available: true, productId: selection.productId });
  }
};
retryButton = assistantRoot.querySelector("[data-retry-availability]");
assert.ok(retryButton, "technical retry remains available after unavailable state is rendered");
retryButton.click();
await new Promise((resolve) => setImmediate(resolve));
assert.equal(vm.runInContext("assistantState.availability.status", context), "available");
const confirmedContinue = assistantRoot.querySelector("[data-reservation-request]");
assert.equal(Object.hasOwn(confirmedContinue.attributes, "disabled"), false, "current server confirmation enables Continue");
confirmedContinue.click();
assert.ok(assistantRoot.querySelector("[data-customer-details-form]"), "confirmed availability advances to customer details");

console.log("Assistant availability DOM flow passed, including extended-exhaust alternate-date switching.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
