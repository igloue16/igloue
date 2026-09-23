import { tokenHashBytea } from "../issue-email-verification/token.ts";

const PURPOSE = "IGLOUE/payment-capability/v1:";

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
  try {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=");
    if (binary.length !== 32) return null;
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

export async function derivePaymentCapability(idempotencyKey: string, secret: string): Promise<string> {
  const keyBytes = new TextEncoder().encode(secret);
  const inputBytes = new TextEncoder().encode(PURPOSE + idempotencyKey);
  const keyBuffer = new Uint8Array(keyBytes.byteLength);
  keyBuffer.set(keyBytes);
  const inputBuffer = new Uint8Array(inputBytes.byteLength);
  inputBuffer.set(inputBytes);
  const key = await crypto.subtle.importKey(
    "raw",
    keyBuffer.buffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, inputBuffer.buffer));
  return encodeBase64Url(signature);
}

export async function paymentCapabilityHash(rawCapability: string): Promise<string> {
  const bytes = decodeBase64Url(rawCapability);
  if (!bytes) throw new Error("invalid payment capability");
  return tokenHashBytea(bytes);
}
