import {
  calculateServerRentalPrice,
  IGLOUE_SERVER_PRICING,
} from "./pricing.ts";
import { IGLOUE_SERVER_ALLOWED_SETUP_MODES } from "./validation.ts";

export const MAX_BASKET_UNITS = 8;

export type BasketUnit = {
  productId: string;
  unitIndex: number;
};

export type ProductAuthority = {
  id: string;
  active: boolean;
  weeklyPrice: number;
  depositAmount: number;
};

export type BasketPricing = {
  currency: string;
  weeklyPrice: number;
  items: Array<{
    productId: string;
    unitRentalPrice: number;
    lineTotal: number;
  }>;
  rentalSubtotal: number;
  deliveryFee: number;
  setupPrice: number;
  expressPrice: number;
  totalAmount: number;
  depositAmount: number | null;
  depositPolicyPending: boolean;
};

function invalid(code: string) {
  return { ok: false as const, code };
}

function finiteMoney(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function moneyCents(value: number) {
  const cents = value * 100;
  if (!Number.isSafeInteger(Math.round(cents)) || Math.abs(cents - Math.round(cents)) > 1e-8) {
    throw new Error("invalid authoritative money");
  }
  return Math.round(cents);
}

function fromCents(value: number) {
  return value / 100;
}

export function normalizeBasketInput(input: {
  productId?: unknown;
  items?: unknown;
}) {
  if (input.productId !== undefined && input.items !== undefined) {
    return invalid("AMBIGUOUS_BASKET");
  }

  if (input.items === undefined) {
    if (typeof input.productId !== "string" || input.productId.trim() === "") {
      return invalid("INVALID_BASKET");
    }
    return {
      ok: true as const,
      legacy: true,
      units: [{ productId: input.productId.trim(), unitIndex: 0 }],
    };
  }

  if (!Array.isArray(input.items) || input.items.length === 0) {
    return invalid("INVALID_BASKET");
  }

  const seen = new Set<string>();
  const units: BasketUnit[] = [];
  for (const item of input.items) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return invalid("INVALID_BASKET_ITEM");
    }
    const value = item as Record<string, unknown>;
    if (Object.keys(value).some((key) => !["productId", "quantity"].includes(key))) {
      return invalid("INVALID_BASKET_ITEM");
    }
    if (typeof value.productId !== "string" || value.productId.trim() === "") {
      return invalid("INVALID_PRODUCT");
    }
    if (typeof value.quantity !== "number" || !Number.isInteger(value.quantity) || value.quantity <= 0) {
      return invalid("INVALID_QUANTITY");
    }
    const productId = value.productId.trim();
    if (seen.has(productId)) return invalid("DUPLICATE_PRODUCT");
    seen.add(productId);
    if (units.length + value.quantity > MAX_BASKET_UNITS) {
      return invalid("BASKET_TOO_LARGE");
    }
    for (let index = 0; index < value.quantity; index += 1) {
      units.push({ productId, unitIndex: index });
    }
  }

  return { ok: true as const, legacy: false, units };
}

export function staticProductAuthority(): ProductAuthority[] {
  return Object.entries(IGLOUE_SERVER_PRICING.products).map(([id, product]) => ({
    id,
    active: true,
    weeklyPrice: product.weeklyPrice,
    depositAmount: product.depositAmount,
  }));
}

export function normalizeProductAuthority(rows: unknown): ProductAuthority[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (typeof row !== "object" || row === null) return [];
    const value = row as Record<string, unknown>;
    const weeklyPrice = finiteMoney(value.weekly_price ?? value.weeklyPrice);
    const depositAmount = finiteMoney(value.deposit_amount ?? value.depositAmount);
    if (typeof value.id !== "string" || weeklyPrice === null || depositAmount === null) return [];
    return [{
      id: value.id,
      active: value.active === true,
      weeklyPrice,
      depositAmount,
    }];
  });
}

export function validateBasketProducts(units: BasketUnit[], products: ProductAuthority[]) {
  const byId = new Map(products.map((product) => [product.id, product]));
  for (const unit of units) {
    const product = byId.get(unit.productId);
    if (!product || !product.active) return invalid("INVALID_PRODUCT");
  }
  return { ok: true as const, products: byId };
}

export function validateBasketSetup(units: BasketUnit[], setupMode: unknown) {
  if (typeof setupMode !== "string") return invalid("INVALID_SETUP");
  for (const unit of units) {
    const allowed = IGLOUE_SERVER_ALLOWED_SETUP_MODES[
      unit.productId as keyof typeof IGLOUE_SERVER_ALLOWED_SETUP_MODES
    ];
    if (!allowed || !(allowed as readonly string[]).includes(setupMode)) {
      return invalid("INVALID_SETUP");
    }
  }
  return { ok: true as const };
}

export function calculateBasketPricing(input: {
  units: BasketUnit[];
  products: ProductAuthority[];
  nights: number;
  deliveryFee: number;
  setupMode: string;
  expressSelected: boolean;
}): BasketPricing | { error: string } {
  const validation = validateBasketProducts(input.units, input.products);
  if (!validation.ok) return { error: validation.code };
  const setupValidation = validateBasketSetup(input.units, input.setupMode);
  if (!setupValidation.ok) return { error: setupValidation.code };

  const items = input.units.map((unit) => {
    const product = validation.products.get(unit.productId)!;
    const lineTotal = calculateServerRentalPrice(product.weeklyPrice, input.nights);
    return {
      productId: unit.productId,
      unitRentalPrice: product.weeklyPrice,
      lineTotal,
    };
  });
  const rentalSubtotalCents = items.reduce((sum, item) => sum + moneyCents(item.lineTotal), 0);
  const deliveryFeeCents = moneyCents(input.deliveryFee);
  const setupValue = IGLOUE_SERVER_PRICING.setup[input.setupMode as keyof typeof IGLOUE_SERVER_PRICING.setup];
  if (typeof setupValue !== "number") return { error: "INVALID_SETUP" };
  const setupPriceCents = moneyCents(setupValue);
  const expressPriceCents = moneyCents(input.expressSelected ? IGLOUE_SERVER_PRICING.addOns.sameDayExpress : 0);
  const totalAmount = fromCents(rentalSubtotalCents + deliveryFeeCents + setupPriceCents + expressPriceCents);

  return {
    currency: IGLOUE_SERVER_PRICING.currency,
    weeklyPrice: items[0]?.unitRentalPrice ?? 0,
    items,
    rentalSubtotal: fromCents(rentalSubtotalCents),
    deliveryFee: fromCents(deliveryFeeCents),
    setupPrice: fromCents(setupPriceCents),
    expressPrice: fromCents(expressPriceCents),
    totalAmount,
    depositAmount: input.units.length === 1
      ? validation.products.get(input.units[0].productId)!.depositAmount
      : null,
    depositPolicyPending: input.units.length > 1,
  };
}
