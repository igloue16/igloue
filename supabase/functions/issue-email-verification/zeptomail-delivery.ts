import { sendZeptoMail } from "../_shared/email/zeptomail.ts";
import type { VerificationEmailDelivery } from "./delivery.ts";

export const VERIFICATION_EMAIL_SENDER = "commandes@igloue.fr";
const VERIFICATION_EMAIL_SUBJECT = "Confirmez votre adresse e-mail — IGLOUE";

type SendVerificationMessage = (input: {
  sender: string;
  recipient: string;
  subject: string;
  htmlBody: string;
  textBody: string;
}) => Promise<{ ok: boolean }>;

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) =>
    ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[character]!);
}

export function createZeptoMailVerificationEmailDelivery(
  send: SendVerificationMessage = sendZeptoMail,
): VerificationEmailDelivery {
  return {
    async sendVerificationEmail(input) {
      const url = input.verificationUrl;
      const safeUrl = escapeHtml(url);
      const textBody = [
        "Bonjour,",
        "",
        "Confirmez votre adresse e-mail pour poursuivre votre demande auprès d’IGLOUE :",
        url,
        "",
        "Ce lien expire dans 30 minutes.",
        "Si vous n’êtes pas à l’origine de cette demande, ignorez ce message.",
      ].join("\n");
      const htmlBody = [
        '<!doctype html><html lang="fr"><body style="margin:0;padding:24px;font-family:Arial,sans-serif;color:#14222c">',
        '<main style="max-width:560px;margin:0 auto">',
        "<p>Bonjour,</p>",
        "<p>Confirmez votre adresse e-mail pour poursuivre votre demande auprès d’IGLOUE.</p>",
        `<p><a href="${safeUrl}" style="display:inline-block;padding:12px 18px;background:#cf995b;color:#14222c;text-decoration:none;font-weight:bold;border-radius:6px">Confirmer mon adresse e-mail</a></p>`,
        `<p>Si le bouton ne fonctionne pas, utilisez ce lien :<br><a href="${safeUrl}">${safeUrl}</a></p>`,
        "<p>Ce lien expire dans 30 minutes.</p>",
        "<p>Si vous n’êtes pas à l’origine de cette demande, ignorez ce message.</p>",
        "</main></body></html>",
      ].join("");

      try {
        const result = await send({
          sender: VERIFICATION_EMAIL_SENDER,
          recipient: input.destination,
          subject: VERIFICATION_EMAIL_SUBJECT,
          htmlBody,
          textBody,
        });
        return { status: result.ok ? "delivered" : "failed" };
      } catch {
        return { status: "failed" };
      }
    },
  };
}
