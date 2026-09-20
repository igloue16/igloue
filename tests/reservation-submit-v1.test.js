const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const context = vm.createContext({ Date, Intl, console });
context.window = context;
context.crypto = { randomUUID: () => "attempt-1" };
context.CustomEvent = class CustomEvent {
  constructor(type, init = {}) {
    this.type = type;
    Object.assign(this, init);
  }
};

vm.runInContext(fs.readFileSync(path.join(root, "assets/js/reservation.js"), "utf8"), context);
vm.runInContext(`
  const IGLOUE_SERVICE_WINDOWS = [
    { id: "0830-1030", displayLabel: "08:30–10:30" },
    { id: "1630-1830", displayLabel: "16:30–18:30" }
  ];
  const IGLOUE_PRICING = { minimumRentalNights: 3 };
  const IGLOUE_PRODUCTS = [{ id: "essential", name: "IGLOUE Essential", weeklyPrice: 59 }];
  const assistantLocale = "fr-FR";
  const assistantCopy = {
    room: { types: { bedroom: "Chambre" } },
    opening: { types: { casement: "Fenêtre classique" } },
    result: { sizing: {
      best: { label: "Recommandé", text: "Adapté." },
      slightlySmaller: {}, tooSmall: {}, slightlyLarger: {}, muchLarger: {}
    } }
  };
  const assistantState = {
    availability: {
      status: "available",
      key: "essential|2027-07-12|2027-07-19|0830-1030|1630-1830"
    }
  };
  const currentDraft = {
    customer: { firstName: "Ada", lastName: "Loue", email: "ada@example.com", phone: null },
    deliveryAddress: { line1: "1 Rue Test", line2: null, postcode: "16000", city: "Angouleme" },
    location: { postcode: "16000", zone: { id: "local", name: "Angoulême proche" } },
    product: { selectedProductId: "essential", recommendedProductId: "essential" },
    requirements: {
      manualAssessmentRequired: false,
      room: { type: "bedroom", area: 20, conditions: [] },
      opening: { type: "casement", roofWindowBottomHeightRange: null }
    },
    rental: { deliveryDate: "2027-07-12", collectionDate: "2027-07-19", nights: 7 },
    delivery: { date: "2027-07-12", slotId: "0830-1030", expressSelected: false, setupMode: "none" },
    collection: { date: "2027-07-19", slotId: "1630-1830" },
    pricing: { rentalPrice: 59, deliveryPrice: 29, setupPrice: 0, sameDayExpressPrice: 0, total: 88, caution: { amount: 250 } }
  };
  function buildReservationDraft() { return JSON.parse(JSON.stringify(currentDraft)); }
  function getProductById(id) { return IGLOUE_PRODUCTS.find((product) => product.id === id) || null; }
  function getSameDayExpressEligibility() { return { eligible: true }; }
  function showDeliveryStage() {}
  function showOpeningStage() {}
  function showRecommendationResult() {}
  function showUnavailableRecommendation() {}
  function showDatesStage() {}
`, context);

vm.runInContext(fs.readFileSync(path.join(root, "assets/js/reservation-attempt.js"), "utf8"), context);
vm.runInContext(fs.readFileSync(path.join(root, "assets/js/reservation-review.js"), "utf8"), context);

let submit;
let status;
let renderedAssistant;
const dispatched = [];
let resolveRequest;
const calls = [];

context.renderStageShell = ({ content }) => content;
context.renderBackControl = () => "";
context.connectBackControl = () => {};
context.pushStage = () => {};
context.getSetupDefinition = () => ({ label: "Sans mise en service" });
context.formatPrice = (value) => `${Number(value).toFixed(2)} €`;
context.renderAssistant = () => {
  submit = {
    disabled: false,
    textContent: "Continuer la réservation",
    setAttribute() {},
    removeAttribute() {},
    addEventListener(type, handler) { if (type === "click") this.click = handler; }
  };
  status = {
    hidden: true,
    textContent: "",
    focus() {}
  };
  renderedAssistant = {
    querySelectorAll() { return []; },
    querySelector(selector) {
      if (selector === "[data-review-submit]") return submit;
      if (selector === "[data-reservation-status]") return status;
      return null;
    },
    dispatchEvent(event) { dispatched.push(event); }
  };
  return renderedAssistant;
};

context.IGLOUE_RESERVATION_CLIENT = {
  createReservation(input) {
    calls.push(input);
    return new Promise((resolve) => { resolveRequest = resolve; });
  }
};

vm.runInContext("showReservationReview(false)", context);
const firstClick = submit.click();
const secondClick = submit.click();

assert.equal(calls.length, 1, "pending duplicate clicks produce one request");
assert.equal(submit.disabled, true, "submit is disabled while the request is pending");
assert.equal(status.hidden, false, "checking status is visible");
assert.match(status.textContent, /enregistrons/i);
assert.equal(calls[0].idempotencyKey, "attempt-1");
assert.equal(Object.hasOwn(calls[0], "pricing"), false, "browser pricing is not sent");
assert.equal(Object.hasOwn(calls[0], "customerId"), false, "customer ID is not sent");
assert.equal(Object.hasOwn(calls[0], "machineId"), false, "machine ID is not sent");
assert.equal(dispatched.length, 1, "compatibility event is dispatched once");

resolveRequest({
  status: "success",
  reservation: { status: "pending", reference: "public-reference", holdExpiresAt: "2027-07-12T08:30:00Z" }
});

(async () => {
  await firstClick;
  await secondClick;
  assert.equal(submit.disabled, true, "successful submission remains guarded");
  assert.match(status.textContent, /enregistrée/i);
  assert.doesNotMatch(status.textContent, /public-reference|machine|allocation|customer/i);

  let retryResolve;
  context.IGLOUE_RESERVATION_CLIENT.createReservation = (input) => {
    calls.push(input);
    return new Promise((resolve) => { retryResolve = resolve; });
  };
  vm.runInContext("showReservationReview(false)", context);
  const retryClick = submit.click();
  assert.equal(calls.length, 2, "same material draft can be retried");
  assert.equal(calls[1].idempotencyKey, calls[0].idempotencyKey, "retry reuses the existing attempt key");
  retryResolve({ status: "error", code: "NO_MACHINE_AVAILABLE" });
  await retryClick;
  assert.equal(submit.disabled, false, "retryable failure re-enables submission");
  assert.match(status.textContent, /plus disponible/i);
  console.log("Reservation submit integration tests passed (16 assertions).");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
