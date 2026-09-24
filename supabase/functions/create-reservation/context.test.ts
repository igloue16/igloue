import assert from "node:assert/strict";
import { normalizeBilling, normalizeRecipient } from "./context.ts";

const customer = { firstName: "Ada", lastName: "Loue", email: "ada@example.com", phone: "0612345678" };
const address = { line1: "1 Rue Test", line2: null, postcode: "16000", city: "Angouleme" };

Deno.test("defaults recipient and personal billing to reservation snapshots", () => {
  const recipient = normalizeRecipient(undefined, customer);
  const billing = normalizeBilling(undefined, customer, address);
  assert.equal(recipient.ok, true);
  assert.equal(billing.ok, true);
  if (recipient.ok) assert.deepEqual(recipient.recipient, { firstName: "Ada", lastName: "Loue", phone: "0612345678" });
  if (billing.ok) assert.equal(billing.mode, "personal");
});

Deno.test("normalizes other recipient and business billing", () => {
  const recipient = normalizeRecipient({ mode: "other", firstName: "Marie", lastName: "Test", phone: "+33 6 12 34 56 78" }, customer);
  const billing = normalizeBilling({ mode: "business", billingName: "Marie Test", companyName: "Acme", billingEmail: "billing@example.com", billingAddress: { line1: "2 Rue B", postcode: "75001", city: "Paris", country: "FR" } }, customer, address);
  assert.equal(recipient.ok, true);
  assert.equal(billing.ok, true);
  if (recipient.ok) assert.equal(recipient.recipient.phone, "0612345678");
  if (billing.ok) assert.equal(billing.companyName, "Acme");
});

Deno.test("rejects stale or incomplete context fields", () => {
  assert.equal(normalizeRecipient({ mode: "self", firstName: "stale" }, customer).ok, false);
  assert.equal(normalizeRecipient({ mode: "other", firstName: "Only", lastName: "Name", phone: "bad" }, customer).ok, false);
  assert.equal(normalizeBilling({ mode: "personal", billingName: "stale" }, customer, address).ok, false);
  assert.equal(normalizeBilling({ mode: "business", billingName: "Acme", billingEmail: "bad", billingAddress: {} }, customer, address).ok, false);
});
