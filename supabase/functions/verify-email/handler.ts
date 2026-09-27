import { consumeEmailVerificationToken } from "../issue-email-verification/consume.ts";
import type { EmailVerificationRpc } from "../issue-email-verification/service.ts";

const MAX_BODY_BYTES = 256;
const CORS_HEADERS = Object.freeze({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "apikey, authorization, content-type, x-client-info",
  "Access-Control-Max-Age": "86400",
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
});
const CREDENTIAL = /^[A-Za-z0-9_-]{43}$/;

type Dependencies = { supabaseAdmin: EmailVerificationRpc };

function response(body: Record<string, unknown>, status: number) {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

export function createVerifyEmailOptionsResponse() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

async function readBoundedJson(request: Request): Promise<unknown> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > MAX_BODY_BYTES) {
    throw new Error("INVALID_REQUEST");
  }
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new Error("INVALID_REQUEST");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("INVALID_REQUEST");
  }
}

export async function handleVerifyEmailRequest(
  request: Request,
  dependencies: Dependencies,
) {
  if (request.method === "OPTIONS") return createVerifyEmailOptionsResponse();
  if (request.method !== "POST") {
    return response({ ok: false, error: { code: "METHOD_NOT_ALLOWED" } }, 405);
  }

  let body: unknown;
  try {
    body = await readBoundedJson(request);
  } catch {
    return response({ ok: false, error: { code: "INVALID_REQUEST" } }, 400);
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return response({ ok: false, error: { code: "INVALID_REQUEST" } }, 400);
  }
  const value = body as Record<string, unknown>;
  if (
    Object.keys(value).length !== 1 || Object.keys(value)[0] !== "credential" ||
    typeof value.credential !== "string" || !CREDENTIAL.test(value.credential)
  ) {
    return response({ ok: false, error: { code: "INVALID_REQUEST" } }, 400);
  }

  const result = await consumeEmailVerificationToken(value.credential, {
    rpc: dependencies.supabaseAdmin,
  });
  if (result.status === "verified") return response({ ok: true }, 200);
  return response({
    ok: false,
    error: { code: "INVALID_OR_EXPIRED_CREDENTIAL" },
  }, 400);
}
