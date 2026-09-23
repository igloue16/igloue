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

export type ZeptoMailResult =
  | { ok: true }
  | { ok: false; code: "INVALID_REQUEST" | "INVALID_SENDER" | "MISSING_CONFIGURATION" | "DELIVERY_FAILED" };

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
    return { ok: false, code: "INVALID_REQUEST" };
  }

  const sender = typeof input?.sender === "string" ? input.sender.trim().toLowerCase() : "";
  if (!ALLOWED_SENDERS.has(sender)) {
    return { ok: false, code: "INVALID_SENDER" };
  }

  const htmlBody = input?.htmlBody;
  const textBody = input?.textBody;
  if (!nonEmpty(htmlBody, 1_000_000) && !nonEmpty(textBody, 1_000_000)) {
    return { ok: false, code: "INVALID_REQUEST" };
  }

  const token = (dependencies.getToken ?? defaultToken)()?.trim();
  if (!token) {
    return { ok: false, code: "MISSING_CONFIGURATION" };
  }

  const payload: Record<string, unknown> = {
    from: { address: sender },
    to: [{ email_address: { address: input.recipient.trim() } }],
    subject: input.subject.trim(),
  };
  if (nonEmpty(htmlBody, 1_000_000)) payload.htmlbody = htmlBody;
  if (nonEmpty(textBody, 1_000_000)) payload.textbody = textBody;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await (dependencies.fetchImpl ?? fetch)(ZEPTOMAIL_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Zoho-enczapikey ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, code: "DELIVERY_FAILED" };
    return { ok: true };
  } catch {
    return { ok: false, code: "DELIVERY_FAILED" };
  } finally {
    clearTimeout(timeout);
  }
}
