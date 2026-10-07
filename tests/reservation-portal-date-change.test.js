import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const source = await readFile(new URL("../assets/js/reservation-portal.js", import.meta.url), "utf8");
const html = await readFile(new URL("../reservation-portal.html", import.meta.url), "utf8");
function loadApi() {
  const window = { document: null, location: { hash: "", search: "" } };
  vm.runInNewContext(source, { window, URL, URLSearchParams, Date, Intl, Promise, setTimeout });
  return window.IgReservationPortal;
}

test("date-change controls are separate from extension and include explicit quote and confirmation", () => {
  const api = loadApi();
  assert.match(html, /Modifier les dates/);
  assert.match(html, /date-change-start/);
  assert.match(html, /date-change-end/);
  assert.match(html, /date-change-confirm/);
  assert.match(source, /La réduction de la durée ne donne pas automatiquement lieu à un remboursement\./);
  assert.match(source, /customer-rental-date-change/);
  assert.equal(api.renderDateChangeAvailability({ paid_and_confirmed: true, reservation_status: "confirmed" }), true);
  assert.equal(api.renderDateChangeAvailability({ paid_and_confirmed: false, reservation_status: "confirmed" }), false);
  assert.equal(api.renderDateChangeAvailability({ paid_and_confirmed: true, reservation_status: "pending" }), false);
});

test("date-change request sends portal capability to server without reservation id or browser storage", async () => {
  const api = loadApi();
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push([url, options]);
    return { ok: true, async json() { return { ok: true, quote: { eligible: true,
      oldStartDate: "2039-01-10", oldEndDate: "2039-01-17", newStartDate: "2039-01-11", newEndDate: "2039-01-18",
      currentPaidAmount: 88, currentRentalAmount: 59, newRentalAmount: 59, priceDelta: 0,
      additionalAmountDue: 0, refundOrCreditAmount: 0, currency: "EUR", mode: "automatic" } }; } };
  };
  const token = `p1.${"a".repeat(64)}`;
  const result = await api.dateChangeRequest(token, "quote", { newStartDate: "2039-01-11", newEndDate: "2039-01-18" },
    { projectUrl: "https://fxhdxilvbzojkyyhktnu.supabase.co", publishableKey: "public-test" }, fetchImpl);
  assert.equal(result.quote.priceDelta, 0);
  assert.equal(calls[0][0], "https://fxhdxilvbzojkyyhktnu.supabase.co/functions/v1/customer-rental-date-change");
  assert.deepEqual(JSON.parse(calls[0][1].body), { action: "quote", token, newStartDate: "2039-01-11", newEndDate: "2039-01-18" });
  assert.equal(calls[0][1].cache, "no-store");
  assert.equal(calls[0][1].referrerPolicy, "no-referrer");
  assert.equal(source.includes("localStorage"), false);
  assert.equal(source.includes("sessionStorage"), false);
});

test("change status is accepted only from backend-shaped server state", () => {
  const api = loadApi();
  assert.equal(api.validDateChangeResult({ ok: true, change: { id: "00000000-0000-4000-8000-000000000001", status: "confirmed" } }), true);
  assert.equal(api.validDateChangeResult({ ok: true, change: { id: "00000000-0000-4000-8000-000000000001", status: "paid_from_url" } }), false);
  assert.equal(api.validDateChangeQuote({ ok: true, quote: { eligible: true, oldStartDate: "2039-01-10", oldEndDate: "2039-01-17",
    newStartDate: "2039-01-11", newEndDate: "2039-01-18", currentPaidAmount: 88, currentRentalAmount: 59,
    newRentalAmount: 59, priceDelta: 0, additionalAmountDue: 0, refundOrCreditAmount: 0, currency: "EUR", mode: "automatic" } }), true);
  assert.equal(api.validDateChangeQuote({ ok: true, quote: { eligible: true, oldStartDate: "2039-01-10", oldEndDate: "2039-01-17",
    newStartDate: "2039-01-09", newEndDate: "2039-01-18", currentPaidAmount: 88, currentRentalAmount: 59,
    newRentalAmount: 75.86, priceDelta: 16.86, additionalAmountDue: 16.86, refundOrCreditAmount: 0, currency: "EUR", mode: "payment_required" } }), true);
});

test("checkout return parameters only trigger a capability-scoped backend status check", async () => {
  const api = loadApi();
  const token = `p1.${"a".repeat(64)}`;
  const calls = [];
  const fetchImpl = async (_url, options) => {
    const request = JSON.parse(options.body); calls.push(request);
    return { ok: true, async json() { return { ok: true, change: { id: request.changeId, status: "checkout_created",
      oldStartDate: "2039-01-10", oldEndDate: "2039-01-17", newStartDate: "2039-01-09", newEndDate: "2039-01-18",
      priceDelta: 16.86, additionalAmountDue: 16.86, currency: "EUR", checkoutUrl: null } }; } };
  };
  const change = await api.processDateChangeReturn(token, { projectUrl: "https://fxhdxilvbzojkyyhktnu.supabase.co", publishableKey: "test" },
    "?date_change=success&change_id=00000000-0000-4000-8000-000000000001&session_id=cs_test_untrusted", async () => {}, fetchImpl);
  assert.equal(change.status, "checkout_created");
  assert.equal(calls.length, 21);
  assert.ok(calls.every((call) => call.action === "status" && call.token === token && call.changeId === "00000000-0000-4000-8000-000000000001"));
});

test("paid extension changes delegate to the existing checkout flow and failures preserve original reservation", () => {
  assert.match(source, /quote\.mode === "extension"[\s\S]*Utilisez le parcours de prolongation sécurisé/);
  assert.match(source, /Votre réservation initiale reste intacte/);
  assert.match(source, /dateChangeRequest\(token, "create"/);
});
