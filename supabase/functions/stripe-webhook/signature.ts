export const DEFAULT_TOLERANCE_SECONDS = 300;

export type SignatureFailureReason =
  | "missing_header"
  | "malformed_header"
  | "invalid_timestamp"
  | "timestamp_outside_tolerance"
  | "invalid_signature";

export type SignatureVerification =
  | { ok: true }
  | { ok: false; reason: SignatureFailureReason };

type ParsedSignature = {
  timestamp: number;
  signatures: Uint8Array[];
};

function parseHex(value: string): Uint8Array | null {
  if (value.length === 0 || value.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(value)) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function parseHeader(value: string): ParsedSignature | SignatureFailureReason {
  if (value.trim() === "") return "missing_header";

  let timestampValue: string | undefined;
  const signatures: Uint8Array[] = [];
  for (const part of value.split(",")) {
    const separator = part.indexOf("=");
    if (separator <= 0) return "malformed_header";

    const key = part.slice(0, separator).trim();
    const item = part.slice(separator + 1).trim();
    if (key === "t") {
      if (timestampValue !== undefined || item === "") return "malformed_header";
      timestampValue = item;
    } else if (key === "v1") {
      const signature = parseHex(item);
      if (!signature) return "malformed_header";
      signatures.push(signature);
    }
  }

  if (timestampValue === undefined || signatures.length === 0) return "malformed_header";
  if (!/^\d+$/.test(timestampValue)) return "invalid_timestamp";

  const timestamp = Number(timestampValue);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) return "invalid_timestamp";
  return { timestamp, signatures };
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

function signedPayload(timestamp: number, rawBody: Uint8Array): Uint8Array {
  const prefix = new TextEncoder().encode(`${timestamp}.`);
  const payload = new Uint8Array(prefix.length + rawBody.length);
  payload.set(prefix);
  payload.set(rawBody, prefix.length);
  return payload;
}

export async function verifyStripeSignature(
  rawBody: Uint8Array,
  signatureHeader: string | null,
  secret: string,
  now: Date,
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
): Promise<SignatureVerification> {
  if (signatureHeader === null) return { ok: false, reason: "missing_header" };

  const parsed = parseHeader(signatureHeader);
  if (typeof parsed === "string") return { ok: false, reason: parsed };

  const nowSeconds = now.getTime() / 1000;
  if (!Number.isFinite(nowSeconds) || Math.abs(nowSeconds - parsed.timestamp) > toleranceSeconds) {
    return { ok: false, reason: "timestamp_outside_tolerance" };
  }

  const keyBytes = new TextEncoder().encode(secret);
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes.buffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const payload = signedPayload(parsed.timestamp, rawBody);
  const payloadBuffer = new ArrayBuffer(payload.byteLength);
  new Uint8Array(payloadBuffer).set(payload);
  const expected = new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    key,
    payloadBuffer,
  ));

  if (parsed.signatures.some((candidate) => constantTimeEqual(expected, candidate))) {
    return { ok: true };
  }
  return { ok: false, reason: "invalid_signature" };
}
