import { normalizeLocale } from "./locale.ts";
import type { SupportedLocale, TransactionalEmailMessage } from "./model.ts";

export type ReservationConfirmationData = {
  recipientEmail: string;
  customerName: string;
  reservationReference: string;
  productName: string;
  startDate: string;
  endDate: string;
  totalAmount: string;
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function buildReservationConfirmationEmail(
  data: ReservationConfirmationData,
  locale?: unknown,
): TransactionalEmailMessage {
  const resolvedLocale: SupportedLocale = normalizeLocale(locale);
  const values = {
    customerName: escapeHtml(data.customerName),
    reservationReference: escapeHtml(data.reservationReference),
    productName: escapeHtml(data.productName),
    startDate: escapeHtml(data.startDate),
    endDate: escapeHtml(data.endDate),
    totalAmount: escapeHtml(data.totalAmount),
  };

  if (resolvedLocale === "en") {
    return {
      template: "reservation_confirmation",
      locale: "en",
      from: { address: "commandes@igloue.fr", name: "IGLOUE" },
      to: { address: data.recipientEmail },
      subject: "Your IGLOUE reservation",
      textBody: `Hello ${data.customerName},\n\nYour reservation ${data.reservationReference} for ${data.productName} is recorded from ${data.startDate} to ${data.endDate}. Total: ${data.totalAmount}.`,
      htmlBody: `<p>Hello ${values.customerName},</p><p>Your reservation <strong>${values.reservationReference}</strong> for ${values.productName} is recorded from ${values.startDate} to ${values.endDate}.</p><p>Total: <strong>${values.totalAmount}</strong>.</p>`,
    };
  }

  return {
    template: "reservation_confirmation",
    locale: "fr",
    from: { address: "commandes@igloue.fr", name: "IGLOUE" },
    to: { address: data.recipientEmail },
    subject: "Votre réservation IGLOUE",
    textBody: `Bonjour ${data.customerName},\n\nVotre réservation ${data.reservationReference} pour ${data.productName} est enregistrée du ${data.startDate} au ${data.endDate}. Total : ${data.totalAmount}.`,
    htmlBody: `<p>Bonjour ${values.customerName},</p><p>Votre réservation <strong>${values.reservationReference}</strong> pour ${values.productName} est enregistrée du ${values.startDate} au ${values.endDate}.</p><p>Total : <strong>${values.totalAmount}</strong>.</p>`,
  };
}
