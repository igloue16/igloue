import {
  getServerDeliveryZoneByPostcode,
  isServerProductAvailableInZone,
} from "./delivery.ts";
import { buildServerOperationalPeriod } from "./operations.ts";
import {
  calculateBasketPricing,
  normalizeBasketInput,
  normalizeProductAuthority,
  staticProductAuthority,
  validateBasketProducts,
  validateBasketSetup,
} from "./basket.ts";
import { normalizeBilling, normalizeRecipient } from "./context.ts";
import {
  validateCustomer,
  validateDeliveryAddress,
  validateProductId,
  validateRentalDates,
  validateServiceChoices,
} from "./validation.ts";
import { noOpVerificationEmailDelivery, type VerificationEmailDelivery } from "../issue-email-verification/delivery.ts";
import { orchestrateEmailVerification } from "../issue-email-verification/orchestrate.ts";
import { derivePaymentCapability, paymentCapabilityHash } from "./payment-capability.ts";

const MAX_BODY_BYTES = 16 * 1024;
const CORS_HEADERS = Object.freeze({
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "apikey, content-type, x-client-info",
  "access-control-max-age": "86400",
});

export type ReservationRpcClient = {
  rpc(name: string, parameters: Record<string, unknown>): Promise<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
};

type Dependencies = {
  supabaseAdmin: ReservationRpcClient;
  now?: Date;
  logError?: (...args: unknown[]) => void;
  lookupCustomerEmail?: (reservationId: string, customerId: string) => Promise<string | null>;
  publicBaseUrl?: string;
  verificationDelivery?: VerificationEmailDelivery;
  paymentCapabilitySecret?: string;
  loadProducts?: (productIds: string[]) => Promise<unknown>;
};

function response(body: unknown, status: number) {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

function errorResponse(status: number, code: string) {
  return response({ ok: false, error: { code } }, status);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readBoundedJson(request: Request): Promise<unknown> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > MAX_BODY_BYTES) {
    throw new Error("PAYLOAD_TOO_LARGE");
  }
  if (!request.body) {
    return null;
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new Error("PAYLOAD_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("INVALID_REQUEST");
  }
}

function validationError(result: { code?: string }) {
  return result.code || "INVALID_REQUEST";
}

function holdExpiry(value: unknown) {
  if (value === null || value === undefined) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

export function createOptionsResponse() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function handleReservationRequest(
  request: Request,
  dependencies: Dependencies,
) {
  if (request.method === "OPTIONS") return createOptionsResponse();
  if (request.method !== "POST") {
    return errorResponse(405, "METHOD_NOT_ALLOWED");
  }

  let body: unknown;
  try {
    body = await readBoundedJson(request);
  } catch (error) {
    if (error instanceof Error && error.message === "PAYLOAD_TOO_LARGE") {
      return errorResponse(413, "PAYLOAD_TOO_LARGE");
    }
    return errorResponse(400, "INVALID_REQUEST");
  }

  if (!isObject(body) || !hasOnlyKeys(body, [
    "idempotencyKey", "customer", "productId", "items", "deliveryAddress", "rental", "service",
    "recipient", "billing",
  ])) {
    return errorResponse(400, "INVALID_REQUEST");
  }
  const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  if (!idempotencyKey || idempotencyKey.length > 200) {
    return errorResponse(400, "INVALID_REQUEST");
  }

  if (isObject(body.customer) && !hasOnlyKeys(body.customer, ["firstName", "lastName", "email", "phone"])) {
    return errorResponse(400, "INVALID_CUSTOMER");
  }
  if (isObject(body.deliveryAddress) && !hasOnlyKeys(body.deliveryAddress, ["line1", "line2", "postcode", "city"])) {
    return errorResponse(400, "INVALID_ADDRESS");
  }
  if (isObject(body.rental) && !hasOnlyKeys(body.rental, ["startDate", "endDate"])) {
    return errorResponse(400, "INVALID_DATES");
  }
  if (isObject(body.service) && !hasOnlyKeys(body.service, ["deliverySlotId", "collectionSlotId", "setupMode", "expressSelected"])) {
    return errorResponse(400, "INVALID_REQUEST");
  }
  if (isObject(body.recipient) && !hasOnlyKeys(body.recipient, ["mode", "firstName", "lastName", "phone"])) {
    return errorResponse(400, "INVALID_RECIPIENT");
  }
  if (isObject(body.billing) && !hasOnlyKeys(body.billing, ["mode", "billingName", "companyName", "billingEmail", "billingAddress"])) {
    return errorResponse(400, "INVALID_BILLING");
  }

  const customerValidation = validateCustomer(body.customer);
  if (!customerValidation.ok) return errorResponse(400, validationError(customerValidation));
  const basket = normalizeBasketInput({ productId: body.productId, items: body.items });
  if (!basket.ok) return errorResponse(400, basket.code);
  if (basket.units.length !== 1) return errorResponse(409, "MULTI_ITEM_NOT_YET_AVAILABLE");
  const productId = basket.units[0].productId;
  const productValidation = validateProductId(productId);
  if (!productValidation.ok) return errorResponse(400, validationError(productValidation));
  const addressValidation = validateDeliveryAddress(body.deliveryAddress);
  if (!addressValidation.ok) return errorResponse(400, validationError(addressValidation));
  const rentalValidation = validateRentalDates(body.rental, dependencies.now ?? new Date());
  if (!rentalValidation.ok) return errorResponse(400, validationError(rentalValidation));
  const serviceValidation = validateServiceChoices(body.service, productId);
  if (!serviceValidation.ok) return errorResponse(400, validationError(serviceValidation));
  const recipient = normalizeRecipient(body.recipient, customerValidation.customer);
  if (!recipient.ok) return errorResponse(400, recipient.code);
  const billing = normalizeBilling(body.billing, customerValidation.customer, addressValidation.address);
  if (!billing.ok) return errorResponse(400, billing.code);

  const operationalPeriodResult = buildServerOperationalPeriod(
    rentalValidation.rental.startDate,
    serviceValidation.service.deliverySlotId,
    rentalValidation.rental.endDate,
    serviceValidation.service.collectionSlotId,
  );
  if (!operationalPeriodResult.ok) return errorResponse(400, "INVALID_SERVICE_WINDOW");

  const deliveryZone = getServerDeliveryZoneByPostcode(addressValidation.address.postcode);
  if (!deliveryZone) return errorResponse(400, "INVALID_ADDRESS");
  if (!isServerProductAvailableInZone(productId, deliveryZone.id)) {
    return errorResponse(400, "INVALID_PRODUCT");
  }

  let products = staticProductAuthority();
  if (dependencies.loadProducts) {
    try {
      products = normalizeProductAuthority(await dependencies.loadProducts([productId]));
    } catch (exception) {
      dependencies.logError?.("product authority lookup failed", exception);
      return errorResponse(503, "PRODUCT_UNAVAILABLE");
    }
  }
  const productAuthority = validateBasketProducts(basket.units, products);
  if (!productAuthority.ok) return errorResponse(400, productAuthority.code);
  const setupAuthority = validateBasketSetup(basket.units, serviceValidation.service.setupMode);
  if (!setupAuthority.ok) return errorResponse(400, setupAuthority.code);
  const pricing = calculateBasketPricing({
    units: basket.units,
    products,
    nights: rentalValidation.rental.nights,
    deliveryFee: deliveryZone.price,
    setupMode: serviceValidation.service.setupMode,
    expressSelected: serviceValidation.service.expressSelected,
  });
  if ("error" in pricing) return errorResponse(400, pricing.error);

  const paymentCapabilitySecret = dependencies.paymentCapabilitySecret ?? Deno.env.get("PAYMENT_CAPABILITY_SECRET")?.trim();
  if (!paymentCapabilitySecret) return errorResponse(500, "INTERNAL_ERROR");

  let paymentCapability: string;
  let paymentCapabilityHashValue: string;
  try {
    paymentCapability = await derivePaymentCapability(idempotencyKey, paymentCapabilitySecret);
    paymentCapabilityHashValue = await paymentCapabilityHash(paymentCapability);
  } catch {
    return errorResponse(500, "INTERNAL_ERROR");
  }

  let data: unknown;
  let error: { code?: string; message?: string } | null;
  try {
    ({ data, error } = await dependencies.supabaseAdmin.rpc("create_reservation_with_payment_capability", {
    p_capability_hash: paymentCapabilityHashValue,
    p_first_name: customerValidation.customer.firstName,
    p_last_name: customerValidation.customer.lastName,
    p_email: customerValidation.customer.email,
    p_phone: customerValidation.customer.phone,
    p_product_id: productId,
    p_rental_start: `${rentalValidation.rental.startDate}T12:00:00Z`,
    p_rental_end: `${rentalValidation.rental.endDate}T12:00:00Z`,
    p_delivery_address_line_1: addressValidation.address.line1,
    p_delivery_address_line_2: addressValidation.address.line2,
    p_delivery_postcode: addressValidation.address.postcode,
    p_delivery_city: addressValidation.address.city,
    p_delivery_zone: deliveryZone.id,
    p_weekly_price_at_booking: pricing.weeklyPrice,
    p_delivery_fee: pricing.deliveryFee,
    p_options_total: pricing.setupPrice + pricing.expressPrice,
    p_deposit_amount: pricing.depositAmount,
    p_total_amount: pricing.totalAmount,
    p_delivery_date: rentalValidation.rental.startDate,
    p_delivery_time_slot: serviceValidation.service.deliverySlotId,
    p_collection_date: rentalValidation.rental.endDate,
    p_collection_time_slot: serviceValidation.service.collectionSlotId,
    p_idempotency_key: idempotencyKey,
    p_operational_start: operationalPeriodResult.operationalPeriod.operationalStart,
    p_operational_end: operationalPeriodResult.operationalPeriod.operationalEnd,
    p_recipient_first_name: recipient.recipient.firstName,
    p_recipient_last_name: recipient.recipient.lastName,
    p_recipient_phone: recipient.recipient.phone,
    p_billing_mode: billing.mode,
    p_billing_name: billing.billingName,
    p_billing_company_name: billing.companyName,
    p_billing_email: billing.billingEmail,
    p_billing_address_line_1: billing.billingAddressLine1,
    p_billing_address_line_2: billing.billingAddressLine2,
    p_billing_postcode: billing.billingPostcode,
    p_billing_city: billing.billingCity,
    p_billing_country: billing.billingCountry,
    p_unit_rental_price: pricing.items[0].unitRentalPrice,
    p_line_total: pricing.items[0].lineTotal,
    }));
  } catch (exception) {
    dependencies.logError?.("create_reservation_transaction threw", exception);
    return errorResponse(500, "INTERNAL_ERROR");
  }

  if (error) {
    dependencies.logError?.("create_reservation_transaction failed", error);
    if (error.code === "P0003") {
      return errorResponse(409, "IDEMPOTENCY_CONFLICT");
    }
    if (error.code === "P1001" && error.message === "Too many active holds") {
      return errorResponse(409, "TOO_MANY_ACTIVE_HOLDS");
    }
    if (
      error.code === "P0001" && error.message === "No eligible machine available" ||
      error.code === "23P01"
    ) return errorResponse(409, "NO_MACHINE_AVAILABLE");
    return errorResponse(500, "INTERNAL_ERROR");
  }

  const created = Array.isArray(data) ? data[0] : data;
  if (!isObject(created) || typeof created.reservation_id !== "string" || typeof created.reservation_status !== "string") {
    dependencies.logError?.("create_reservation_transaction returned malformed data");
    return errorResponse(500, "INTERNAL_ERROR");
  }

  if (created.reservation_status === "pending" && created.payment_capability_matched !== true) {
    return errorResponse(409, "PAYMENT_CAPABILITY_UNAVAILABLE");
  }

  if (created.created_new === true && dependencies.lookupCustomerEmail && dependencies.publicBaseUrl) {
    try {
      const destination = await dependencies.lookupCustomerEmail(
        created.reservation_id,
        typeof created.customer_id === "string" ? created.customer_id : "",
      );
      if (destination) {
        await orchestrateEmailVerification({
          reservationId: created.reservation_id,
          destination,
          publicBaseUrl: dependencies.publicBaseUrl,
          rpc: dependencies.supabaseAdmin,
          delivery: dependencies.verificationDelivery ?? noOpVerificationEmailDelivery,
        });
      }
    } catch (exception) {
      dependencies.logError?.("email verification orchestration failed", exception);
    }
  }

  if (created.reservation_status === "cancelled") {
    return errorResponse(409, "RESERVATION_EXPIRED");
  }
  if (!["pending", "confirmed", "ongoing", "completed"].includes(created.reservation_status)) {
    return errorResponse(503, "RESERVATION_UNAVAILABLE");
  }
  const expires = created.reservation_status === "pending"
    ? holdExpiry(created.hold_expires_at)
    : null;
  if (created.reservation_status === "pending") {
    if (!expires) return errorResponse(503, "RESERVATION_UNAVAILABLE");
    const now = (dependencies.now ?? new Date()).getTime();
    if (Date.parse(expires) <= now) return errorResponse(409, "RESERVATION_EXPIRED");
  }

  const result = {
    ok: true,
    reservation: {
      reference: created.reservation_id,
      status: created.reservation_status,
      holdExpiresAt: expires,
    },
    productId,
    rental: rentalValidation.rental,
    deliveryZone: { name: deliveryZone.name },
    pricing: {
      currency: pricing.currency,
      rentalPrice: pricing.rentalSubtotal,
      deliveryFee: pricing.deliveryFee,
      setupPrice: pricing.setupPrice,
      expressPrice: pricing.expressPrice,
      totalAmount: pricing.totalAmount,
      depositAmount: pricing.depositAmount,
    },
    ...(created.reservation_status === "pending" && expires ? { paymentCapability } : {}),
  };
  return response(result, 201);
}
