import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const source = await readFile(new URL("../assets/js/reservation-portal.js", import.meta.url), "utf8");
function loadApi() {
  const window = { document: null, location: { hash: "", search: "" } };
  vm.runInNewContext(source, { window, URLSearchParams, Date, Intl, Promise, setTimeout });
  return window.IgReservationPortal;
}

test("extension UI only appears for backend paid and confirmed reservations", () => {
  const api = loadApi();
  assert.equal(api.renderExtensionAvailability({ paid_and_confirmed: true, reservation_status: "confirmed" }), true);
  assert.equal(api.renderExtensionAvailability({ paid_and_confirmed: true, reservation_status: "ongoing" }), true);
  assert.equal(api.renderExtensionAvailability({ paid_and_confirmed: false, reservation_status: "confirmed" }), false);
  assert.equal(api.renderExtensionAvailability({ paid_and_confirmed: true, reservation_status: "pending" }), false);
});

test("extension status accepts only backend-shaped states and Checkout data", () => {
  const api = loadApi();
  const valid = { ok: true, extension: { id: "00000000-0000-4000-8000-000000000001", status: "checkout_created",
    previousEndDate: "2027-07-19", newEndDate: "2027-07-22", addedDays: 3, additionalAmount: 42,
    currency: "EUR", checkoutUrl: "https://checkout.stripe.com/c/pay/session" } };
  assert.equal(api.validExtensionStatus(valid), true);
  assert.equal(api.validExtensionStatus({ ...valid, extension: { ...valid.extension, status: "paid_from_query" } }), false);
  assert.equal(api.validExtensionStatus({ ...valid, extension: { ...valid.extension, checkoutUrl: "javascript:alert(1)" } }), false);
});

test("extension request sends capability only to the configured backend and never uses browser storage", async () => {
  const api = loadApi();
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push([url, init]);
    return { ok: true, async json() { return { ok: true, quote: { currentEndDate: "2027-07-19", newEndDate: "2027-07-22", addedDays: 3, additionalAmount: 42, currency: "EUR" } }; } };
  };
  const result = await api.extensionRequest(`p1.${"a".repeat(64)}`, "quote", { newEndDate: "2027-07-22" },
    { projectUrl: "https://fxhdxilvbzojkyyhktnu.supabase.co", publishableKey: "public-test-key" }, fetchImpl);
  assert.equal(result.quote.additionalAmount, 42);
  assert.equal(calls[0][0], "https://fxhdxilvbzojkyyhktnu.supabase.co/functions/v1/customer-rental-extension");
  assert.equal(calls[0][1].cache, "no-store");
  assert.equal(calls[0][1].referrerPolicy, "no-referrer");
  assert.equal(JSON.parse(calls[0][1].body).token, `p1.${"a".repeat(64)}`);
  assert.equal(source.includes("localStorage"), false);
  assert.equal(source.includes("sessionStorage"), false);
});

test("success/cancel URL query parameters cannot themselves establish payment truth", () => {
  const api = loadApi();
  const text = source.slice(source.indexOf("async function processExtensionReturn"), source.indexOf("async function start()"));
  assert.match(text, /extensionRequest\(token, "status"/);
  assert.doesNotMatch(text, /session_id/);
  assert.equal(typeof api.processExtensionReturn, "function");
});

test("date minimum is strictly after the current backend rental end", () => {
  assert.match(source, /Date\.UTC\(year, month - 1, day \+ 1\)/);
});
