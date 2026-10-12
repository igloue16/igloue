const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "assets/js/reservation-portal.js"), "utf8");
const html = fs.readFileSync(path.join(root, "reservation-portal.html"), "utf8");
function fakePage() {
  const elements = new Map();
  const makeElement = () => ({ children: [], hidden: false, className: "", _text: "",
    set textContent(value) { this._text = String(value); this.children = []; },
    get textContent() { return this._text + this.children.map((child) => child.textContent).join(""); },
    replaceChildren(...children) { this._text = ""; this.children = [...children]; },
    append(...children) { this.children.push(...children); } });
  const window = { document: undefined };
  vm.runInNewContext(source, { window, URL, URLSearchParams, Intl, Date, Object, Number, String, Error }, { filename: "reservation-portal.js" });
  window.document = { getElementById(id) { if (!elements.has(id)) elements.set(id, makeElement()); return elements.get(id); }, createElement() { return makeElement(); } };
  return { api: window.IgReservationPortal, elements };
}
function model(breakdown = null) {
  return { ok: true, reference: "A1B2C3D4", reservation_status: "confirmed", payment_status: "paid", paid_and_confirmed: true,
    rental_start: "2027-07-12T12:00:00Z", rental_end: "2027-07-19T12:00:00Z", product_name: "IGLOUE Essential",
    delivery: null, collection: null, price: { total: breakdown ? 97 : 88, delivery: 29, options: 0, options_breakdown: breakdown, deposit: 0, currency: "EUR" }, email_verified: true };
}
assert.match(html, /portal-extended-exhaust-row/);
const legacy = fakePage();
assert.equal(legacy.api.validPayload(model(null)), true, "historical reservations with null options breakdown remain valid");
legacy.api.render(model(null));
assert.equal(legacy.elements.get("portal-extended-exhaust-row").hidden, true);
const selected = fakePage();
const breakdown = { setup: { mode: "none", amount: 0 }, sameDayExpress: { selected: false, amount: 0 }, extendedExhaust: { selected: true, amount: 9 } };
assert.equal(selected.api.validPayload(model(breakdown)), true);
selected.api.render(model(breakdown));
assert.equal(selected.elements.get("portal-extended-exhaust-row").hidden, false);
assert.match(selected.elements.get("portal-extended-exhaust-price").textContent, /9,00/u);
assert.equal(selected.api.validPayload(model({ ...breakdown, extendedExhaust: { selected: false, amount: 9 } })), false, "inconsistent breakdown rejected");
console.log("Public customer portal extended exhaust and legacy breakdown tests passed.");
