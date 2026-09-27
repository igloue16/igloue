import { normalizeLocale } from "./locale.ts";
import type { SupportedLocale, TransactionalEmailMessage } from "./model.ts";

export type ReservationConfirmationData = {
  recipientEmail: string;
  customerFirstName: string;
  reservationReference: string;
  productSummary: string;
  startDate: string;
  endDate: string;
  totalAmount: string;
  deliveryAddress?: string;
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDate(value: string, locale: SupportedLocale) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "fr-FR", {
    dateStyle: "long",
    timeZone: "Europe/Paris",
  }).format(date);
}

function formatAmount(value: string, locale: SupportedLocale) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return value;
  return new Intl.NumberFormat(locale === "en" ? "en-GB" : "fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(amount);
}

export function buildReservationConfirmationEmail(
  data: ReservationConfirmationData,
  locale?: unknown,
): TransactionalEmailMessage {
  const resolvedLocale: SupportedLocale = normalizeLocale(locale);
  const firstName = data.customerFirstName.trim();
  const startDate = formatDate(data.startDate, resolvedLocale);
  const endDate = formatDate(data.endDate, resolvedLocale);
  const totalAmount = formatAmount(data.totalAmount, resolvedLocale);
  const values = {
    firstName: escapeHtml(firstName),
    reference: escapeHtml(data.reservationReference),
    productSummary: escapeHtml(data.productSummary),
    startDate: escapeHtml(startDate),
    endDate: escapeHtml(endDate),
    deliveryAddress: escapeHtml(data.deliveryAddress?.trim() ?? ""),
    totalAmount: escapeHtml(totalAmount),
  };

  if (resolvedLocale === "en") {
    const greeting = firstName ? `Hello ${firstName},` : "Hello,";
    const addressText = data.deliveryAddress?.trim()
      ? `\nDelivery address: ${data.deliveryAddress.trim()}`
      : "";
    const addressHtml = values.deliveryAddress
      ? `<p>Delivery address: ${values.deliveryAddress}</p>`
      : "";
    return {
      template: "reservation_confirmation",
      locale: "en",
      from: { address: "commandes@igloue.fr", name: "IGLOUE" },
      to: { address: data.recipientEmail },
      subject: "Reservation confirmed — IGLOUE",
      textBody: `${greeting}\n\nYour reservation ${data.reservationReference} is confirmed.\nProduct: ${data.productSummary}\nRental dates: ${startDate} to ${endDate}${addressText}\nTotal: ${totalAmount}.\n\nPayment, if applicable, may follow a separate step.\nQuestions? Contact commandes@igloue.fr.`,
      htmlBody: `<!doctype html><html lang="en"><body><p>${firstName ? `Hello ${values.firstName},` : "Hello,"}</p><p>Your reservation <strong>${values.reference}</strong> is confirmed.</p><p>Product: ${values.productSummary}<br>Rental dates: ${values.startDate} to ${values.endDate}</p>${addressHtml}<p>Total: <strong>${values.totalAmount}</strong>.</p><p>Payment, if applicable, may follow a separate step.</p><p>Questions? Contact <a href="mailto:commandes@igloue.fr">commandes@igloue.fr</a>.</p></body></html>`,
    };
  }

  const greeting = firstName ? `Bonjour ${firstName},` : "Bonjour,";
  const addressText = data.deliveryAddress?.trim()
    ? `\nAdresse de livraison : ${data.deliveryAddress.trim()}`
    : "";
  const addressHtml = values.deliveryAddress
    ? `<p>Adresse de livraison : ${values.deliveryAddress}</p>`
    : "";
  return {
    template: "reservation_confirmation",
    locale: "fr",
    from: { address: "commandes@igloue.fr", name: "IGLOUE" },
    to: { address: data.recipientEmail },
    subject: "Réservation confirmée — IGLOUE",
    textBody: `${greeting}\n\nVotre réservation ${data.reservationReference} est confirmée.\nProduit : ${data.productSummary}\nDates de location : du ${startDate} au ${endDate}${addressText}\nTotal : ${totalAmount}.\n\nCette confirmation concerne votre réservation. Le paiement, s’il est requis, peut suivre une étape séparée.\nPour toute question : commandes@igloue.fr.`,
    htmlBody: `<!doctype html><html lang="fr"><body><p>${firstName ? `Bonjour ${values.firstName},` : "Bonjour,"}</p><p>Votre réservation <strong>${values.reference}</strong> est confirmée.</p><p>Produit : ${values.productSummary}<br>Dates de location : du ${values.startDate} au ${values.endDate}</p>${addressHtml}<p>Total : <strong>${values.totalAmount}</strong>.</p><p>Cette confirmation concerne votre réservation. Le paiement, s’il est requis, peut suivre une étape séparée.</p><p>Pour toute question : <a href="mailto:commandes@igloue.fr">commandes@igloue.fr</a>.</p></body></html>`,
  };
}
