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
  "availability-state.js", "assistant.js"
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

console.log("Assistant availability DOM flow passed (9 assertions).");
})().catch((error) => { console.error(error); process.exitCode = 1; });
