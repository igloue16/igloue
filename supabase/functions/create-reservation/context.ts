import { normalizeFrenchPhone } from "./validation.ts";

type Customer = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
};

type Address = {
  line1: string;
  line2: string | null;
  postcode: string;
  city: string;
};

function nonEmpty(value: unknown, maximum: number) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maximum;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function keysOnly(value: Record<string, unknown>, allowed: readonly string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

export function normalizeRecipient(input: unknown, customer: Customer) {
  if (input === undefined) {
    return { ok: true as const, recipient: { firstName: customer.firstName, lastName: customer.lastName, phone: customer.phone } };
  }
  if (!object(input) || !keysOnly(input, ["mode", "firstName", "lastName", "phone"])) {
    return { ok: false as const, code: "INVALID_RECIPIENT" };
  }
  const mode = input.mode === undefined ? "self" : input.mode;
  if (mode === "self") {
    if (Object.keys(input).some((key) => key !== "mode")) return { ok: false as const, code: "INVALID_RECIPIENT" };
    return { ok: true as const, recipient: { firstName: customer.firstName, lastName: customer.lastName, phone: customer.phone } };
  }
  if (mode !== "other" || !nonEmpty(input.firstName, 100) || !nonEmpty(input.lastName, 100)) {
    return { ok: false as const, code: "INVALID_RECIPIENT" };
  }
  const phone = normalizeFrenchPhone(input.phone);
  if (!phone) return { ok: false as const, code: "INVALID_RECIPIENT" };
  const firstName = input.firstName as string;
  const lastName = input.lastName as string;
  return {
    ok: true as const,
    recipient: { firstName: firstName.trim(), lastName: lastName.trim(), phone },
  };
}

export function normalizeBilling(input: unknown, customer: Customer, address: Address) {
  const base = {
    billingName: `${customer.firstName} ${customer.lastName}`.trim(),
    companyName: null as string | null,
    billingEmail: customer.email,
    billingAddressLine1: address.line1,
    billingAddressLine2: address.line2,
    billingPostcode: address.postcode,
    billingCity: address.city,
    billingCountry: "FR",
  };
  if (input === undefined) return { ok: true as const, mode: "personal", ...base };
  if (!object(input) || !keysOnly(input, ["mode", "billingName", "companyName", "billingEmail", "billingAddress"])) {
    return { ok: false as const, code: "INVALID_BILLING" };
  }
  const mode = input.mode === undefined ? "personal" : input.mode;
  if (mode === "personal") {
    if (Object.keys(input).some((key) => key !== "mode")) return { ok: false as const, code: "INVALID_BILLING" };
    return { ok: true as const, mode: "personal", ...base };
  }
  if (mode !== "business" && mode !== "custom") return { ok: false as const, code: "INVALID_BILLING" };
  if (mode === "business" && !nonEmpty(input.companyName, 200)) return { ok: false as const, code: "INVALID_BILLING" };
  if (!nonEmpty(input.billingName, 100) || !nonEmpty(input.billingEmail, 254) || !object(input.billingAddress)) {
    return { ok: false as const, code: "INVALID_BILLING" };
  }
  const billingAddress = input.billingAddress as Record<string, unknown>;
  if (!keysOnly(billingAddress, ["line1", "line2", "postcode", "city", "country"]) ||
      !nonEmpty(billingAddress.line1, 200) ||
      (billingAddress.line2 !== undefined && billingAddress.line2 !== null && !nonEmpty(billingAddress.line2, 200)) ||
      !nonEmpty(billingAddress.postcode, 32) || !nonEmpty(billingAddress.city, 100) ||
      !nonEmpty(billingAddress.country, 100)) {
    return { ok: false as const, code: "INVALID_BILLING" };
  }
  const billingName = input.billingName as string;
  const billingEmail = input.billingEmail as string;
  const line1 = billingAddress.line1 as string;
  const postcode = billingAddress.postcode as string;
  const city = billingAddress.city as string;
  const country = billingAddress.country as string;
  return {
    ok: true as const,
    mode,
    billingName: billingName.trim(),
    companyName: typeof input.companyName === "string" ? input.companyName.trim() : null,
    billingEmail: billingEmail.trim(),
    billingAddressLine1: line1.trim(),
    billingAddressLine2: typeof billingAddress.line2 === "string" ? billingAddress.line2.trim() : null,
    billingPostcode: postcode.trim(),
    billingCity: city.trim(),
    billingCountry: country.trim(),
  };
}
