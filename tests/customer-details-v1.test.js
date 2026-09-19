const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class Element {
  constructor(tag = "div", attributes = {}, parent = null) {
    this.tagName = tag.toUpperCase();
    this.attributes = attributes;
    this.parentNode = parent;
    this.children = [];
    this.listeners = {};
    this.hidden = false;
    this.disabled = false;
    this.value = attributes.value || "";
    this.textContent = "";
    this.classList = {
      toggle: (name, enabled) => {
        const names = new Set((this.attributes.class || "").split(/\s+/).filter(Boolean));
        if (enabled) names.add(name); else names.delete(name);
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

  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }

  setAttribute(name, value) { this.attributes[name] = String(value); }

  getAttribute(name) { return this.attributes[name] ?? null; }

  dispatchEvent(event) {
    for (const handler of this.listeners[event.type] || []) handler(event);
  }

  click() {
    if (this.disabled) return;
    for (const handler of this.listeners.click || []) handler({ target: this, preventDefault() {} });
  }

  focus() { this.focused = true; }

  closest() { return this.parentNode || this; }

  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }

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
  const pattern = /<\/?([a-zA-Z][\w-]*)([^>]*)>/g;
  let match;
  while ((match = pattern.exec(html))) {
    if (match[0].startsWith("</")) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const attributes = {};
    for (const attribute of match[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g)) {
      attributes[attribute[1]] = attribute[2] || "";
    }
    const element = new Element(match[1], attributes, stack[stack.length - 1]);
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
const document = {
  documentElement: { lang: "fr-FR" },
  querySelector: (selector) => selector === "[data-assistant]" ? assistantRoot : null,
  addEventListener: () => {}
};
const context = vm.createContext({
  console, Date, Intl, Set, Math, JSON, document,
  window: null,
  requestAnimationFrame: () => {},
  CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init.detail; } }
});
context.window = context;

["pricing.js", "delivery.js", "schedule-provider.js", "bookings-provider.js", "availability.js", "reservation.js", "products.js", "inventory.js", "fleet.js", "fleet-allocation.js", "calendar.js", "supabase-config.js", "availability-state.js", "alternative-availability-state.js", "assistant.js", "reservation-review.js"].forEach((filename) => {
  vm.runInContext(fs.readFileSync(path.join(root, "assets/js", filename), "utf8"), context, { filename });
});

vm.runInContext(`
  assistantState.postcode = "16000";
  assistantState.deliveryZone = { id: "local", name: "Angoulême proche" };
  assistantState.deliveryPrice = 29;
  assistantState.recommendedProduct = getProductById("essential");
  assistantState.idealProduct = assistantState.recommendedProduct;
  assistantState.roomType = "bedroom";
  assistantState.roomArea = 20;
  assistantState.roomConditions = [];
  assistantState.openingType = "casement";
  assistantState.startDate = "2027-07-12";
  assistantState.endDate = "2027-07-19";
  assistantState.deliverySlotId = "0830-1030";
  assistantState.collectionSlotId = "1630-1830";
  assistantState.setupMode = "none";
  assistantState.availability = { status: "available", available: true, productId: "essential", key: "test" };
  assistantState.pricing = {
    rentalPrice: 59, deliveryPrice: 29, setupPrice: 0, sameDayExpressPrice: 0,
    total: 88, actualNights: 7, caution: { amount: 250 }
  };
  showRecommendationResult();
`, context);

const requestButton = assistantRoot.querySelector("[data-reservation-request]");
assert.ok(requestButton, "recommendation exposes the reservation action");
assert.match(assistantRoot.innerHTML, /Continuer la réservation →/, "reservation CTA introduces customer details");
requestButton.click();

const form = assistantRoot.querySelector("[data-customer-details-form]");
assert.ok(form, "customer-details stage renders");
assert.equal(assistantRoot.querySelector("#assistant-postcode"), null, "postcode is not editable in this stage");
assert.match(assistantRoot.innerHTML, /16000/, "existing postcode is displayed");
assert.ok(assistantRoot.querySelector("[data-change-postcode]"), "postcode change action is available");

assistantRoot.querySelector("[data-change-postcode]").click();
assert.ok(assistantRoot.querySelector("#assistant-postcode"), "postcode action returns to the existing delivery stage");
assert.equal(assistantRoot.querySelector("#assistant-postcode").value, "16000");
  vm.runInContext("showRecommendationResult(); showCustomerDetailsStage()", context);

form.dispatchEvent({ type: "submit", preventDefault() {} });
assert.equal(assistantRoot.querySelector("#assistant-first-name").attributes["aria-invalid"], "true");
assert.equal(assistantRoot.querySelector("#assistant-first-name-error").hidden, false);
assert.equal(assistantRoot.querySelector("#assistant-first-name").focused, true, "first invalid field receives focus");

const values = {
  "#assistant-first-name": "Ada",
  "#assistant-last-name": "Lovelace",
  "#assistant-email": "ada@example.com",
  "#assistant-phone": "+33 6 12 34 56 78",
  "#assistant-address-line1": "1 rue des Lilas",
  "#assistant-address-line2": "Bâtiment A",
  "#assistant-city": "Angoulême"
};

const resetDetailsState = () => vm.runInContext(`
  assistantState.customerDetails = { firstName: "", lastName: "", email: "", phone: "" };
  assistantState.deliveryAddress = { line1: "", line2: "", city: "" };
  showCustomerDetailsStage(false);
`, context);

const fillExcept = (missingSelector) => {
  for (const [selector, value] of Object.entries(values)) {
    if (selector === missingSelector) continue;
    const input = assistantRoot.querySelector(selector);
    input.value = value;
    input.dispatchEvent({ type: "input" });
  }
};

for (const [missingSelector, errorSelector] of [
  ["#assistant-first-name", "#assistant-first-name-error"],
  ["#assistant-last-name", "#assistant-last-name-error"],
  ["#assistant-email", "#assistant-email-error"],
  ["#assistant-address-line1", "#assistant-address-line1-error"],
  ["#assistant-city", "#assistant-city-error"]
]) {
  resetDetailsState();
  fillExcept(missingSelector);
  assistantRoot.querySelector("[data-customer-details-form]").dispatchEvent({ type: "submit", preventDefault() {} });
  assert.equal(assistantRoot.querySelector(missingSelector).attributes["aria-invalid"], "true", `${missingSelector} independently blocks progression`);
  assert.equal(assistantRoot.querySelector(errorSelector).hidden, false, `${missingSelector} shows its field error`);
  assert.ok(assistantRoot.querySelector('[data-assistant-stage="customer-details"]'), `${missingSelector} keeps the customer stage open`);
}

resetDetailsState();
fillExcept(null);
assistantRoot.querySelector("#assistant-phone").value = "";
assistantRoot.querySelector("#assistant-phone").dispatchEvent({ type: "input" });
assistantRoot.querySelector("#assistant-address-line2").value = "";
assistantRoot.querySelector("#assistant-address-line2").dispatchEvent({ type: "input" });
assistantRoot.querySelector("[data-customer-details-form]").dispatchEvent({ type: "submit", preventDefault() {} });
assert.equal(assistantRoot.querySelector("#assistant-phone").attributes["aria-invalid"], "false", "blank optional phone is accepted");
assert.equal(assistantRoot.querySelector("#assistant-address-line2").attributes["aria-invalid"], undefined, "blank optional line2 has no validation error");
assert.equal(assistantRoot.querySelector("#assistant-first-name-error").hidden, true, "optional blanks do not add a first-name error");
assert.equal(assistantRoot.querySelector("#assistant-email-error").hidden, true, "optional blanks do not add an email error");

resetDetailsState();
for (const [selector, value] of Object.entries(values)) {
  const input = assistantRoot.querySelector(selector);
  input.value = value;
  input.dispatchEvent({ type: "input" });
}

assistantRoot.querySelector("#assistant-email").value = "not-an-email";
assistantRoot.querySelector("#assistant-email").dispatchEvent({ type: "input" });
form.dispatchEvent({ type: "submit", preventDefault() {} });
assert.equal(assistantRoot.querySelector("#assistant-email").attributes["aria-invalid"], "true", "invalid email is rejected for usability");
assert.equal(assistantRoot.querySelector("#assistant-email-error").hidden, false);

assistantRoot.querySelector("#assistant-email").value = values["#assistant-email"];
assistantRoot.querySelector("#assistant-email").dispatchEvent({ type: "input" });

assistantRoot.querySelector("[data-assistant-back]").click();
assert.ok(assistantRoot.querySelector("[data-reservation-request]"), "back returns to the recommendation stage");
vm.runInContext("showCustomerDetailsStage(false)", context);
assert.equal(assistantRoot.querySelector("#assistant-first-name").value, "Ada", "entered values survive back/forward navigation");
assert.equal(assistantRoot.querySelector("#assistant-address-line2").value, "Bâtiment A", "optional address value survives navigation");

form.dispatchEvent({ type: "submit", preventDefault() {} });
assert.equal(vm.runInContext("assistantState.customerDetails.firstName", context), "Ada");
assert.equal(vm.runInContext("assistantState.customerDetails.phone", context), values["#assistant-phone"]);
assert.equal(vm.runInContext("assistantState.deliveryAddress.line2", context), "Bâtiment A");
assert.equal(vm.runInContext("assistantState.postcode", context), "16000");
assert.equal(assistantRoot.querySelector("[data-assistant-stage=\"recommendation\"]") !== null, false, "valid form proceeds to the existing review stage");
assert.equal(typeof context.fetch, "undefined", "the details stage does not introduce network access");
assert.equal(typeof context.IGLOUE_RESERVATION_CLIENT, "undefined", "reservation client is not invoked");
assert.doesNotMatch(fs.readFileSync(path.join(root, "assets/js/assistant.js"), "utf8"), /prepareAttempt\s*\(/, "no idempotency key is generated");

console.log("Customer-details stage scenarios passed.");
