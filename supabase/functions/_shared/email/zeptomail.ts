const ZEPTOMAIL_ENDPOINT = "https://api.zeptomail.eu/v1.1/email";
const DEFAULT_TIMEOUT_MS = 10_000;

const ALLOWED_SENDERS = new Set([
  "commandes@igloue.fr",
  "support@igloue.fr",
  "contact@igloue.fr",
  "compta@igloue.fr",
]);

type ZeptoMailInput = {
  sender: string;
  recipient: string;
  subject: string;
  htmlBody?: string;
  textBody?: string;
};

type ZeptoMailDependencies = {
  fetchImpl?: typeof fetch;
  getToken?: () => string | undefined;
  timeoutMs?: number;
};

export type ZeptoMailErrorCode =
  | "provider_timeout"
  | "provider_unavailable"
  | "provider_rate_limited"
  | "delivery_rejected"
  | "missing_configuration"
  | "invalid_message"
  | "invalid_sender"
  | "delivery_failed";

export type ZeptoMailResult =
  | { ok: true }
  | { ok: false; code: ZeptoMailErrorCode; retryable: boolean };

function nonEmpty(value: unknown, maximum: number) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
}

function validEmail(value: unknown) {
  return typeof value === "string" &&
    value.length <= 254 &&
    /^\S+@\S+\.\S+$/.test(value.trim());
}

function defaultToken() {
  const value = Deno.env.get("ZEPTOMAIL_API_TOKEN")?.trim();
  return value || undefined;
}

export async function sendZeptoMail(
  input: ZeptoMailInput,
  dependencies: ZeptoMailDependencies = {},
): Promise<ZeptoMailResult> {
  if (!validEmail(input?.recipient) || !nonEmpty(input?.subject, 998)) {
    return { ok: false, code: "invalid_message", retryable: false };
  }

  const sender = typeof input?.sender === "string" ? input.sender.trim().toLowerCase() : "";
  if (!ALLOWED_SENDERS.has(sender)) {
    return { ok: false, code: "invalid_sender", retryable: false };
  }

  const htmlBody = input?.htmlBody;
  const textBody = input?.textBody;
  if (!nonEmpty(htmlBody, 1_000_000) && !nonEmpty(textBody, 1_000_000)) {
    return { ok: false, code: "invalid_message", retryable: false };
  }

  let token: string | undefined;
  try {
    token = (dependencies.getToken ?? defaultToken)()?.trim();
  } catch {
    return { ok: false, code: "delivery_failed", retryable: true };
  }
  if (!token) {
    return { ok: false, code: "missing_configuration", retryable: true };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const payload: Record<string, unknown> = {
      from: { address: sender },
      to: [{ email_address: { address: input.recipient.trim() } }],
      subject: input.subject.trim(),
    };
    if (nonEmpty(htmlBody, 1_000_000)) payload.htmlbody = htmlBody;
    if (nonEmpty(textBody, 1_000_000)) payload.textbody = textBody;

    const response = await (dependencies.fetchImpl ?? fetch)(ZEPTOMAIL_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Zoho-enczapikey ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (response.ok) return { ok: true };
    if (response.status === 408) return { ok: false, code: "provider_timeout", retryable: true };
    if (response.status === 429) return { ok: false, code: "provider_rate_limited", retryable: true };
    if (response.status >= 500 && response.status <= 599) {
      return { ok: false, code: "provider_unavailable", retryable: true };
    }
    if (response.status >= 400 && response.status <= 499) {
      return { ok: false, code: "delivery_rejected", retryable: false };
    }
    return { ok: false, code: "delivery_failed", retryable: true };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { ok: false, code: "provider_timeout", retryable: true };
    }
    return { ok: false, code: "provider_unavailable", retryable: true };
  } finally {
    clearTimeout(timeout);
  }
}
