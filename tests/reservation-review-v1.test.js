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
  const IGLOUE_SERVICE_WINDOWS = [
    { id: "0830-1030", displayLabel: "08:30–10:30" },
    { id: "1030-1230", displayLabel: "10:30–12:30" }
  ];
  const IGLOUE_PRICING = { minimumRentalNights: 3 };
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
    availability: { idealAvailable: true }
  };

  globalThis.productAvailable = true;
  globalThis.expressEligible = true;
  globalThis.collectionSlotAvailable = true;
  globalThis.currentDraft = {
    status: "draft",
    bookingMode: "instant",
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
      room: { type: "bedroom", area: 20, conditions: [] },
      opening: { type: "casement", roofWindowBottomHeightRange: null }
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
      setupMode: "delivery-only"
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

  function buildReservationDraft() {
    return JSON.parse(JSON.stringify(globalThis.currentDraft));
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
    globalThis.currentDraft.pricing.total = 71.14;
  }

  function calculateAvailability() {}
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

console.log("Reservation review V1 Express and slot revalidation scenarios passed.");
