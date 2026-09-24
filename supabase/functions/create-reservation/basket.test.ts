import assert from "node:assert/strict";
import {
  calculateBasketPricing,
  normalizeBasketInput,
  normalizeProductAuthority,
  staticProductAuthority,
} from "./basket.ts";

function units(value: ReturnType<typeof normalizeBasketInput>) {
  assert.equal(value.ok, true);
  if (!value.ok) throw new Error((value as { code: string }).code);
  return value.units;
}

function code(value: ReturnType<typeof normalizeBasketInput>) {
  assert.equal(value.ok, false);
  if (value.ok) throw new Error("expected invalid basket");
  return value.code;
}

Deno.test("normalizes legacy, one-item, and quantity baskets", () => {
  assert.deepEqual(units(normalizeBasketInput({ productId: "essential" })).length, 1);
  assert.deepEqual(units(normalizeBasketInput({ items: [{ productId: "essential", quantity: 1 }] })).length, 1);
  assert.deepEqual(units(normalizeBasketInput({ items: [{ productId: "essential", quantity: 2 }, { productId: "mobile-duo", quantity: 1 }] })).length, 3);
});

Deno.test("rejects ambiguous, malformed, duplicate, and oversized baskets", () => {
  assert.equal(code(normalizeBasketInput({ productId: "essential", items: [] })), "AMBIGUOUS_BASKET");
  assert.equal(code(normalizeBasketInput({ items: [] })), "INVALID_BASKET");
  assert.equal(code(normalizeBasketInput({ items: [{ productId: "essential", quantity: 0 }] })), "INVALID_QUANTITY");
  assert.equal(code(normalizeBasketInput({ items: [{ productId: "essential", quantity: 1.5 }] })), "INVALID_QUANTITY");
  assert.equal(code(normalizeBasketInput({ items: [{ productId: "essential", quantity: 1 }, { productId: "essential", quantity: 1 }] })), "DUPLICATE_PRODUCT");
  assert.equal(code(normalizeBasketInput({ items: [{ productId: "essential", quantity: 9 }] })), "BASKET_TOO_LARGE");
  assert.equal(code(normalizeBasketInput({ items: [{ productId: "essential", quantity: 1, price: 1 }] })), "INVALID_BASKET_ITEM");
});

Deno.test("uses authoritative prices and charges shared fees once", () => {
  const basket = normalizeBasketInput({ items: [{ productId: "essential", quantity: 1 }, { productId: "mobile-duo", quantity: 1 }] });
  const normalizedUnits = units(basket);
  const pricing = calculateBasketPricing({
    units: normalizedUnits,
    products: normalizeProductAuthority([
      { id: "essential", active: true, weekly_price: 59, deposit_amount: 250, browserPrice: 1 },
      { id: "mobile-duo", active: true, weekly_price: 79, deposit_amount: 350 },
    ]),
    nights: 7,
    deliveryFee: 29,
    setupMode: "none",
    expressSelected: false,
  });
  assert.equal("error" in pricing, false);
  if ("error" in pricing) return;
  assert.equal(pricing.rentalSubtotal, 138);
  assert.equal(pricing.deliveryFee, 29);
  assert.equal(pricing.totalAmount, 167);
  assert.equal(pricing.depositAmount, null);
  assert.equal(pricing.depositPolicyPending, true);
});

Deno.test("static authority and setup validation remain deterministic", () => {
  const product = staticProductAuthority().find((value) => value.id === "essential");
  assert.equal(product?.weeklyPrice, 59);
  const basket = normalizeBasketInput({ productId: "essential" });
  const pricing = calculateBasketPricing({ units: units(basket), products: staticProductAuthority(), nights: 7, deliveryFee: 29, setupMode: "none", expressSelected: false });
  assert.equal("error" in pricing, false);
  if ("error" in pricing) return;
  assert.equal(pricing.items[0].lineTotal, 59);
  assert.equal(pricing.totalAmount, 88);
});
