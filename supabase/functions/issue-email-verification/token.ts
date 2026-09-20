// Canonical opaque credential: 32 random bytes encoded as unpadded base64url
// (43 characters). Both issuance and consumption hash the decoded bytes.
export function encodeVerificationToken(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function decodeVerificationToken(value: unknown): Uint8Array | null {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
  try {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=");
    if (binary.length !== 32) return null;
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return encodeVerificationToken(bytes) === value ? bytes : null;
  } catch {
    return null;
  }
}

export async function tokenHashBytea(bytes: Uint8Array): Promise<string> {
  // Copy into a fresh ArrayBuffer-backed view so Deno's Web Crypto typing
  // receives a BufferSource with a concrete ArrayBuffer backing store.
  const input = new Uint8Array(bytes.byteLength);
  input.set(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input.buffer));
  return `\\x${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
