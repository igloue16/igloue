import { verifyStripeSignature } from "./signature.ts";

export const MAX_BODY_BYTES = 1024 * 1024;

type Dependencies = {
  secret?: string;
  now?: Date;
};

function response(code: string, status: number) {
  return Response.json({ ok: false, error: { code } }, { status });
}

export async function handleStripeWebhookRequest(request: Request, dependencies: Dependencies) {
  if (request.method !== "POST") return response("METHOD_NOT_ALLOWED", 405);
  if (!dependencies.secret) return response("WEBHOOK_CONFIGURATION_ERROR", 500);

  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && /^\d+$/.test(contentLength) && Number(contentLength) > MAX_BODY_BYTES) {
    return response("REQUEST_TOO_LARGE", 413);
  }

  let rawBody: Uint8Array;
  try {
    rawBody = new Uint8Array(await request.arrayBuffer());
  } catch {
    return response("INVALID_REQUEST", 400);
  }
  if (rawBody.byteLength > MAX_BODY_BYTES) return response("REQUEST_TOO_LARGE", 413);

  let verification;
  try {
    verification = await verifyStripeSignature(
      rawBody,
      request.headers.get("stripe-signature"),
      dependencies.secret,
      dependencies.now ?? new Date(),
    );
  } catch {
    return response("WEBHOOK_VERIFICATION_ERROR", 500);
  }
  if (!verification.ok) return response("INVALID_SIGNATURE", 400);

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    return response("INVALID_JSON", 400);
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return response("INVALID_PAYLOAD", 400);
  }

  return response("WEBHOOK_NOT_READY", 503);
}
