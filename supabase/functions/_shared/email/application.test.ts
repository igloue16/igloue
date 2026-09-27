import assert from "node:assert/strict";
import { normalizeLocale } from "./locale.ts";
import { buildReservationConfirmationEmail } from "./templates.ts";

const reservation = {
  recipientEmail: "test@example.com",
  customerFirstName: "Camille",
  reservationReference: "TEST-2026-001",
  productSummary: "1 × IGLOUE Essential",
  startDate: "2026-07-12T12:00:00Z",
  endDate: "2026-07-19T12:00:00Z",
  totalAmount: "88.00",
  deliveryAddress: "12 rue du Test, 75001 Paris",
};

Deno.test("normalizes supported, regional, missing, and unsupported locales", () => {
  assert.equal(normalizeLocale("fr"), "fr");
  assert.equal(normalizeLocale("fr-FR"), "fr");
  assert.equal(normalizeLocale("en"), "en");
  assert.equal(normalizeLocale("en-GB"), "en");
  assert.equal(normalizeLocale("en-US"), "en");
  assert.equal(normalizeLocale(undefined), "fr");
  assert.equal(normalizeLocale("de-DE"), "fr");
  assert.equal(normalizeLocale(""), "fr");
});

Deno.test("builds a provider-neutral French confirmation message", () => {
  const message = buildReservationConfirmationEmail(reservation, "fr");
  assert.deepEqual(Object.keys(message).sort(), ["from", "htmlBody", "locale", "subject", "template", "textBody", "to"]);
  assert.equal(message.locale, "fr");
  assert.equal(message.template, "reservation_confirmation");
  assert.equal(message.subject, "Réservation confirmée — IGLOUE");
  assert.match(message.textBody, /Votre réservation/);
  assert.match(message.textBody, /Dates de location/);
  assert.match(message.textBody, /12 juillet 2026/);
  assert.match(message.textBody, /88,00/);
  assert.match(message.htmlBody, /IGLOUE Essential/);
  assert.match(message.htmlBody, /12 rue du Test/);
  assert.match(message.textBody, /paiement, s’il est requis/);
  assert.match(message.textBody, /commandes@igloue\.fr/);
  assert.equal("htmlbody" in message, false);
  assert.equal("email_address" in message, false);
  assert.equal("Authorization" in message, false);
});

Deno.test("builds an English confirmation message and applies regional locale normalization", () => {
  const message = buildReservationConfirmationEmail(reservation, "en-GB");
  assert.equal(message.locale, "en");
  assert.equal(message.subject, "Reservation confirmed — IGLOUE");
  assert.match(message.textBody, /Your reservation/);
  assert.match(message.htmlBody, /Hello Camille/);
});

Deno.test("falls back to French for an unsupported locale", () => {
  const message = buildReservationConfirmationEmail(reservation, "es");
  assert.equal(message.locale, "fr");
  assert.equal(message.subject, "Réservation confirmée — IGLOUE");
});

Deno.test("escapes dynamic values in HTML while retaining readable text", () => {
  const message = buildReservationConfirmationEmail({
    ...reservation,
    customerFirstName: "<Camille & Co>",
    reservationReference: '"REF<1>"',
    productSummary: "1 × Clim & Confort",
    deliveryAddress: "<12 rue & 75001>",
  }, "fr");
  assert.match(message.htmlBody, /&lt;Camille &amp; Co&gt;/);
  assert.match(message.htmlBody, /&quot;REF&lt;1&gt;&quot;/);
  assert.match(message.htmlBody, /Clim &amp; Confort/);
  assert.match(message.htmlBody, /&lt;12 rue &amp; 75001&gt;/);
  assert.equal(message.htmlBody.includes("<Camille & Co>"), false);
  assert.match(message.textBody, /<Camille & Co>/);
});

Deno.test("omits unavailable customer name and address without adding placeholders", () => {
  const message = buildReservationConfirmationEmail({
    ...reservation,
    customerFirstName: "  ",
    deliveryAddress: "",
  }, "fr");
  assert.match(message.textBody, /^Bonjour,/);
  assert.doesNotMatch(message.textBody, /Adresse de livraison/);
  assert.doesNotMatch(message.htmlBody, /Adresse de livraison/);
});
