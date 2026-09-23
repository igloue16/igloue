import type { TransactionalEmailMessage } from "./model.ts";
import { sendZeptoMail } from "./zeptomail.ts";

type TransportInput = {
  sender: string;
  recipient: string;
  subject: string;
  htmlBody: string;
  textBody: string;
};

export type TransactionalEmailErrorCode =
  | "provider_timeout"
  | "provider_unavailable"
  | "provider_rate_limited"
  | "delivery_rejected"
  | "missing_configuration"
  | "invalid_message"
  | "invalid_sender"
  | "delivery_failed";

type TransportResult =
  | { ok: true }
  | { ok: false; code: TransactionalEmailErrorCode; retryable: boolean };
type EmailTransport = (input: TransportInput) => Promise<TransportResult>;

export type EmailDeliveryResult =
  | { status: "delivered" }
  | { status: "retryable_failure"; errorCode: TransactionalEmailErrorCode }
  | { status: "terminal_failure"; errorCode: TransactionalEmailErrorCode };

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
    if (result.ok) return { status: "delivered" };
    return result.retryable
      ? { status: "retryable_failure", errorCode: result.code }
      : { status: "terminal_failure", errorCode: result.code };
  } catch {
    return { status: "retryable_failure", errorCode: "delivery_failed" };
  }
}
