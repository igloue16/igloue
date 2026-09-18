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

function resetDatesForBranch({ productId = "essential", roomArea = 20, openingType = "casement" } = {}) {
  vm.runInContext(`
    availabilityState.reset();
    alternativeAvailabilityState.reset();
    assistantState.roomArea = ${roomArea};
    assistantState.openingType = "${openingType}";
    assistantState.recommendedProduct = getProductById("${productId}");
    assistantState.idealProduct = assistantState.recommendedProduct;
    showDatesStage(false);
  `, context);
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
resetDatesForBranch();
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
resetDatesForBranch();
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
resetDatesForBranch({ productId: "mobile-duo", roomArea: 21 });
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

console.log("Assistant availability DOM flow passed (34 assertions).");
})().catch((error) => { console.error(error); process.exitCode = 1; });
