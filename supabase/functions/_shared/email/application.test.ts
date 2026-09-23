import assert from "node:assert/strict";
import { normalizeLocale } from "./locale.ts";
import { buildReservationConfirmationEmail } from "./templates.ts";

const reservation = {
  recipientEmail: "test@example.com",
  customerName: "Camille Test",
  reservationReference: "TEST-2026-001",
  productName: "IGLOUE Essential",
  startDate: "12 juillet 2026",
  endDate: "19 juillet 2026",
  totalAmount: "88,00 €",
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

Deno.test("builds a provider-neutral French reservation message", () => {
  const message = buildReservationConfirmationEmail(reservation, "fr");
  assert.deepEqual(Object.keys(message).sort(), ["from", "htmlBody", "locale", "subject", "template", "textBody", "to"]);
  assert.equal(message.locale, "fr");
  assert.equal(message.template, "reservation_confirmation");
  assert.equal(message.subject, "Votre réservation IGLOUE");
  assert.match(message.textBody, /Votre réservation/);
  assert.match(message.htmlBody, /IGLOUE Essential/);
  assert.equal("htmlbody" in message, false);
  assert.equal("email_address" in message, false);
  assert.equal("Authorization" in message, false);
});

Deno.test("builds an English reservation message and applies regional locale normalization", () => {
  const message = buildReservationConfirmationEmail(reservation, "en-GB");
  assert.equal(message.locale, "en");
  assert.equal(message.subject, "Your IGLOUE reservation");
  assert.match(message.textBody, /Your reservation/);
  assert.match(message.htmlBody, /Hello Camille Test/);
});

Deno.test("falls back to French for an unsupported locale", () => {
  const message = buildReservationConfirmationEmail(reservation, "es");
  assert.equal(message.locale, "fr");
  assert.equal(message.subject, "Votre réservation IGLOUE");
});

Deno.test("escapes dynamic values in HTML while retaining readable text", () => {
  const message = buildReservationConfirmationEmail({
    ...reservation,
    customerName: "<Camille & Co>",
    reservationReference: '"REF<1>"',
    productName: "Clim & Confort",
  }, "fr");
  assert.match(message.htmlBody, /&lt;Camille &amp; Co&gt;/);
  assert.match(message.htmlBody, /&quot;REF&lt;1&gt;&quot;/);
  assert.match(message.htmlBody, /Clim &amp; Confort/);
  assert.equal(message.htmlBody.includes("<Camille & Co>"), false);
  assert.match(message.textBody, /<Camille & Co>/);
});
