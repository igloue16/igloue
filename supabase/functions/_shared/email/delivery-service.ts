import type { TransactionalEmailMessage } from "./model.ts";
import { sendZeptoMail } from "./zeptomail.ts";

type TransportInput = {
  sender: string;
  recipient: string;
  subject: string;
  htmlBody: string;
  textBody: string;
};

type TransportResult = { ok: true } | { ok: false };
type EmailTransport = (input: TransportInput) => Promise<TransportResult>;

export type EmailDeliveryResult =
  | { status: "delivered" }
  | { status: "failed" };

export type EmailDeliveryDependencies = {
  transport?: EmailTransport;
};

export async function deliverTransactionalEmail(
  message: TransactionalEmailMessage,
  dependencies: EmailDeliveryDependencies = {},
): Promise<EmailDeliveryResult> {
  const transport: EmailTransport = dependencies.transport ?? sendZeptoMail;

  try {
    const result = await transport({
      sender: message.from.address,
      recipient: message.to.address,
      subject: message.subject,
      htmlBody: message.htmlBody,
      textBody: message.textBody,
    });
    return result.ok ? { status: "delivered" } : { status: "failed" };
  } catch {
    return { status: "failed" };
  }
}
