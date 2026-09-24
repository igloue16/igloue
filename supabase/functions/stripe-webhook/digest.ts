export async function payloadSha256(rawBody: Uint8Array): Promise<string> {
  const input = new ArrayBuffer(rawBody.byteLength);
  new Uint8Array(input).set(rawBody);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
