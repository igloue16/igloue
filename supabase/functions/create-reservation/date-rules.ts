import { IGLOUE_SERVER_PRICING } from "./pricing.ts";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MILLISECONDS_PER_DAY = 86_400_000;

export type BookingDateValidation =
  | {
      ok: true;
      startDate: string;
      endDate: string;
      nights: number;
    }
  | {
      ok: false;
      code: "INVALID_DATES";
      error: string;
    };

export function getParisDateValue(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );

  return `${values.year}-${values.month}-${values.day}`;
}

function parseIsoDate(value: unknown) {
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) {
    return null;
  }

  const date = new Date(`${value}T12:00:00Z`);

  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    return null;
  }

  return date;
}

function addOneDay(value: string) {
  const date = parseIsoDate(value);

  if (!date) {
    return null;
  }

  return new Date(date.getTime() + MILLISECONDS_PER_DAY)
    .toISOString()
    .slice(0, 10);
}

export function validateBookingDates(
  startValue: unknown,
  endValue: unknown,
  now = new Date(),
): BookingDateValidation {
  if (typeof startValue !== "string" || startValue.trim() === "") {
    return {
      ok: false,
      code: "INVALID_DATES",
      error: "Invalid rental startDate",
    };
  }

  if (typeof endValue !== "string" || endValue.trim() === "") {
    return {
      ok: false,
      code: "INVALID_DATES",
      error: "Invalid rental endDate",
    };
  }

  const startDate = startValue.trim();
  const endDate = endValue.trim();
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);

  if (!start || !end) {
    return {
      ok: false,
      code: "INVALID_DATES",
      error: "Invalid rental dates",
    };
  }

  if (end <= start) {
    return {
      ok: false,
      code: "INVALID_DATES",
      error: "Rental endDate must be after startDate",
    };
  }

  const today = getParisDateValue(now);
  const firstBookable = addOneDay(today);

  if (!firstBookable || startDate < firstBookable) {
    return {
      ok: false,
      code: "INVALID_DATES",
      error: "Rental startDate must be tomorrow or later",
    };
  }

  const nights = Math.round(
    (end.getTime() - start.getTime()) / MILLISECONDS_PER_DAY,
  );

  if (nights < IGLOUE_SERVER_PRICING.minimumRentalNights) {
    return {
      ok: false,
      code: "INVALID_DATES",
      error: `Minimum rental is ${IGLOUE_SERVER_PRICING.minimumRentalNights} nights`,
    };
  }

  return { ok: true, startDate, endDate, nights };
}
