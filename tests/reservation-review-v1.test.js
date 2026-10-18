const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const context = vm.createContext({ Date, Intl });

vm.runInContext(
  fs.readFileSync(
    path.join(projectRoot, "assets/js/reservation.js"),
    "utf8"
  ),
  context,
  { filename: "reservation.js" }
);

vm.runInContext(`
  const IGLOUE_PRICING = { minimumRentalNights: 3, addOns: { extendedExhaust: { price: 9 } } };
  const IGLOUE_PRODUCTS = [
    { id: "essential", name: "IGLOUE Essential", weeklyPrice: 59 }
  ];
  const assistantLocale = "fr-FR";
  const assistantCopy = {
    room: { types: { bedroom: "Chambre" } },
    opening: { types: { casement: "Fenêtre classique" } },
    result: {
      sizing: {
        best: { label: "Recommandé", text: "Adapté." },
        slightlySmaller: {}, tooSmall: {}, slightlyLarger: {}, muchLarger: {}
      }
    }
  };

  const assistantState = {
    deliverySlotId: "0830-1030",
    collectionSlotId: "1030-1230",
    sameDayExpressSelected: true,
    serviceSlotNotice: "",
    availability: {
      status: "available",
      key: "essential|2026-09-10|2026-09-15|0830-1030|1030-1230",
      productId: "essential",
      available: true,
      error: ""
    }
  };

  globalThis.productAvailable = true;
  globalThis.expressEligible = true;
  globalThis.collectionSlotAvailable = true;
  globalThis.currentDraft = {
    status: "draft",
    bookingMode: "instant",
    customer: {
      customerId: null,
      firstName: "Ada",
      lastName: "O'Connor",
      email: "ada@example.com",
      phone: "0612345678"
    },
    deliveryAddress: {
      line1: "1 rue des Lilas",
      line2: null,
      postcode: "16000",
      city: "Angoulême"
    },
    deliveryInstructions: "Code portail 1234, appeler à l'arrivée",
    location: {
      postcode: "16000",
      zone: { id: "local", name: "Angoulême proche" }
    },
    product: {
      selectedProductId: "essential",
      recommendedProductId: "essential"
    },
    requirements: {
      manualAssessmentRequired: false,
      room: { type: "bedroom", subtype: null, area: 20, conditions: ["sunny"] },
      opening: { type: "casement", hasAccessibleOutdoorSpace: null, roofWindowBottomHeightRange: null, installationAssessmentRequired: false, extendedExhaustRequired: false }
    },
    rental: {
      deliveryDate: "2026-09-10",
      collectionDate: "2026-09-15",
      nights: 5
    },
    delivery: {
      date: "2026-09-10",
      slotId: "0830-1030",
      expressSelected: true,
      setupMode: "delivery-only",
    },
    collection: {
      date: "2026-09-15",
      slotId: "1030-1230"
    },
    pricing: {
      rentalPrice: 42.14,
      deliveryPrice: 29,
      setupPrice: 0,
      sameDayExpressPrice: 25,
      total: 96.14,
      caution: { amount: 250 }
    }
  };
  assistantState.pricing = globalThis.currentDraft.pricing;

  function buildReservationDraft() {
    const draft = JSON.parse(JSON.stringify(globalThis.currentDraft));
    draft.requirements.opening.extendedExhaustRequired = assistantState.extendedExhaustRequired;
    draft.pricing = JSON.parse(JSON.stringify(assistantState.pricing));
    return draft;
  }

  function getProductById(productId) {
    return IGLOUE_PRODUCTS.find((product) => product.id === productId) || null;
  }

  function isProductAvailableForDates() {
    return globalThis.productAvailable;
  }

  function getSameDayExpressEligibility() {
    return { eligible: globalThis.expressEligible };
  }

  function calculateCurrentPricing() {
    globalThis.currentDraft.delivery.expressSelected = false;
    globalThis.currentDraft.pricing.sameDayExpressPrice = 0;
    globalThis.currentDraft.pricing.extendedExhaustPrice = assistantState.extendedExhaustRequired ? 9 : 0;
    globalThis.currentDraft.requirements.opening.extendedExhaustRequired = assistantState.extendedExhaustRequired;
    globalThis.currentDraft.pricing.total = 71.14 + globalThis.currentDraft.pricing.extendedExhaustPrice;
  }
  assistantState.extendedExhaustRequired = false;

  function calculateAvailability() {
    return Promise.resolve(assistantState.availability);
  }
  function showDeliveryStage() {}
  function showOpeningStage() {}
  function showRecommendationResult() {}
  function showUnavailableRecommendation() {}
  function showDatesStage() {}

  globalThis.IGLOUE_DELIVERY_SLOT_PROVIDER = {
    getAvailableSlots({ serviceType }) {
      if (serviceType === "collection" && !globalThis.collectionSlotAvailable) {
        return [];
      }

      return serviceType === "delivery"
        ? [{ id: "0830-1030" }]
        : [{ id: "1030-1230" }];
    },
    getWindowById(slotId, { serviceType } = {}) {
      if (serviceType === "delivery" && slotId === "0830-1030") {
        return { id: slotId, label: "08:30–10:30" };
      }
      if (serviceType === "collection" && slotId === "1030-1230") {
        return { id: slotId, label: "10:30–12:30" };
      }
      return null;
    }
  };
`, context);

vm.runInContext(
  fs.readFileSync(
    path.join(projectRoot, "assets/js/reservation-review.js"),
    "utf8"
  ),
  context,
  { filename: "reservation-review.js" }
);

function evaluate(expression) {
  return vm.runInContext(expression, context);
}

assert.equal(
  evaluate("prepareReservationReview().draft.delivery.expressSelected"),
  true,
  "B: eligible Express remains selected"
);

context.expressEligible = false;
const invalidExpressReview = evaluate("prepareReservationReview()");
assert.equal(
  invalidExpressReview.draft.delivery.expressSelected,
  false,
  "C: invalid Express is deselected"
);
assert.equal(
  invalidExpressReview.draft.pricing.sameDayExpressPrice,
  0,
  "C: stale Express charge is removed"
);
assert.equal(
  invalidExpressReview.draft.pricing.total,
  71.14,
  "C: existing pricing path supplies the updated total"
);
assert.match(
  invalidExpressReview.notice,
  /n'est plus disponible/,
  "C: customer receives restrained feedback"
);

context.collectionSlotAvailable = false;
assert.equal(
  evaluate("prepareReservationReview()"),
  null,
  "H: unavailable slot blocks the actionable review"
);
assert.equal(
  evaluate("assistantState.deliverySlotId"),
  "0830-1030",
  "H: the unaffected delivery slot is preserved"
);
assert.equal(
  evaluate("assistantState.collectionSlotId"),
  "",
  "H: only the unavailable collection slot is cleared"
);

let renderedReview = "";
let customerEditTriggered = false;
const reviewButtons = [];
const reviewSubmit = { addEventListener() {} };
const extendedExhaustCheckbox = { checked: false, addEventListener(type, handler) { if (type === "change") this.change = handler; } };
const reviewAssistant = {
  querySelectorAll(selector) {
    return selector === "[data-review-edit]" ? reviewButtons : [];
  },
  querySelector(selector) {
    if (selector === "[data-review-submit]") return reviewSubmit;
    if (selector === "[data-extended-exhaust]") return extendedExhaustCheckbox;
    return null;
  }
};

context.renderStageShell = ({ content }) => content;
context.renderAssistant = (markup) => {
  renderedReview = markup;
  return reviewAssistant;
};
context.connectBackControl = () => {};
context.showCustomerDetailsStage = () => { customerEditTriggered = true; };
context.getSetupDefinition = () => ({ label: "Livraison seule" });
context.renderBackControl = () => "";
context.formatPrice = (value) => `${Number(value).toFixed(2)} €`;
reviewButtons.push({
  dataset: { reviewEdit: "customer" },
  addEventListener(type, handler) {
    if (type === "click") this.click = handler;
  }
});

context.collectionSlotAvailable = true;
assert.equal(evaluate("typeof IGLOUE_SERVICE_WINDOWS"), "undefined", "test does not mask the removed browser global");
vm.runInContext(`
  assistantState.collectionSlotId = "1030-1230";
  assistantState.availability = {
    status: "available",
    key: "essential|2026-09-10|2026-09-15|0830-1030|1030-1230",
    productId: "essential",
    available: true,
    error: ""
  };
`, context);
evaluate("showReservationReview(false)");
assert.match(renderedReview, /08:30–10:30/, "delivery label comes from cached backend slot data");
assert.match(renderedReview, /10:30–12:30/, "collection label comes from cached backend slot data");
const cachedSlotProvider = context.IGLOUE_DELIVERY_SLOT_PROVIDER;
context.IGLOUE_DELIVERY_SLOT_PROVIDER = undefined;
assert.doesNotThrow(() => evaluate("showReservationReview(false)"), "missing slot cache does not throw");
assert.match(renderedReview, /Créneau à choisir/, "missing slot cache uses a safe review label");
context.IGLOUE_DELIVERY_SLOT_PROVIDER = cachedSlotProvider;
cachedSlotProvider.getWindowById = () => ({ label: 42 });
assert.match(renderedReview, /Créneau à choisir/, "invalid slot labels use a safe review label");
assert.doesNotThrow(() => evaluate("showReservationReview(false)"), "invalid slot labels do not throw");
cachedSlotProvider.getWindowById = () => { throw new Error("stale slot cache"); };
assert.doesNotThrow(() => evaluate("showReservationReview(false)"), "a slot provider failure does not block review");
assert.match(renderedReview, /Cr\u00e9neau \u00e0 choisir/, "a slot provider failure uses the safe fallback label");
cachedSlotProvider.getWindowById = () => ({ displayLabel: "08:30\u201310:30" });
assert.doesNotThrow(() => evaluate("showReservationReview(false)"), "displayLabel fallback does not block review");
assert.match(renderedReview, /08:30\u201310:30/, "displayLabel remains supported");
cachedSlotProvider.getWindowById = () => ({ label: "<img src=x onerror=alert(1)>" });
assert.doesNotThrow(() => evaluate("showReservationReview(false)"), "untrusted slot labels do not throw");
assert.match(renderedReview, /&lt;img src=x onerror=alert\(1\)&gt;/, "slot labels are escaped before rendering");
assert.doesNotMatch(renderedReview, /<img src=x/, "slot labels cannot inject markup");
cachedSlotProvider.getWindowById = (slotId, { serviceType } = {}) => {
  if (serviceType === "delivery" && slotId === "0830-1030") {
    return { id: slotId, label: "08:30–10:30" };
  }
  if (serviceType === "collection" && slotId === "1030-1230") {
    return { id: slotId, label: "10:30–12:30" };
  }
  return null;
};
assert.match(renderedReview, /data-extended-exhaust/, "review exposes the compatible optional add-on");
extendedExhaustCheckbox.checked = true;
extendedExhaustCheckbox.change();
assert.equal(evaluate("assistantState.extendedExhaustRequired"), true, "customer selection is retained");
assert.equal(evaluate("buildReservationRequestPayload(buildReservationDraft()).service.extendedExhaustSelected"), true, "customer selection reaches the reservation request");
assert.equal(evaluate("buildReservationRequestPayload(buildReservationDraft()).questionnaire.answers.room.area"), 20, "room answers reach the reservation request");
assert.equal(evaluate("buildReservationRequestPayload(buildReservationDraft()).questionnaire.answers.opening.type"), "casement", "opening answers reach the reservation request");
assert.equal(evaluate("buildReservationRequestPayload(buildReservationDraft()).deliveryInstructions"), "Code portail 1234, appeler à l'arrivée", "delivery instructions stay separate from the address");
assert.match(renderedReview, /Rallonge d'évacuation/, "selected add-on is itemized in the review price");
assert.equal(evaluate("buildReservationDraft().pricing.total"), 80.14, "selected add-on updates the preview total exactly once");
extendedExhaustCheckbox.checked = false;
extendedExhaustCheckbox.change();
assert.match(renderedReview, /Ada O&#039;Connor/, "I: customer name is escaped and displayed");
assert.match(renderedReview, /ada@example\.com/, "I: customer email is displayed");
assert.match(renderedReview, /1 rue des Lilas/, "I: delivery address is displayed");
assert.ok(renderedReview.includes("Code portail 1234, appeler à l&#039;arrivée"), "delivery instructions are escaped in the customer review");
assert.match(renderedReview, /16000 · Angoulême/, "I: postcode and city are displayed");
assert.doesNotMatch(renderedReview, /customerId/, "I: internal customer ID is not displayed");
assert.match(renderedReview, /0612345678/, "I: normalized phone is displayed");
assert.doesNotMatch(renderedReview, /Bâtiment/, "I: blank address complement is omitted");
assert.match(renderedReview, /data-review-edit="customer"/, "I: customer edit action exists");
reviewButtons[0].click();
assert.equal(customerEditTriggered, true, "I: customer edit routes to the details stage");

context.currentDraft.customer.phone = "0612345678";
context.currentDraft.deliveryAddress.line2 = "<script>alert(1)</script>";
evaluate("showReservationReview(false)");
assert.match(renderedReview, /0612345678/, "I: provided phone is displayed");
assert.match(renderedReview, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/, "I: address HTML is escaped");

vm.runInContext(`
  assistantState.collectionSlotId = "1030-1230";
  assistantState.availability = {
    status: "checking",
    key: "essential|2026-09-10|2026-09-15|0830-1030|1030-1230",
    productId: "essential",
    available: null,
    error: ""
  };
`, context);
assert.equal(
  evaluate("prepareReservationReview()"),
  null,
  "I: missing confirmed real availability blocks review"
);

console.log("Reservation review V1 Express and slot revalidation scenarios passed.");
