import { encodeVerificationToken, tokenHashBytea } from "./token.ts";

const TOKEN_BYTE_LENGTH = 32;
const TOKEN_LIFETIME_MS = 30 * 60 * 1000;

export type EmailVerificationRpc = {
  rpc(name: string, parameters: Record<string, unknown>): Promise<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
};

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function issueEmailVerificationToken(
  reservationId: unknown,
  dependencies: { rpc: EmailVerificationRpc; now?: Date },
) {
  if (!isUuid(reservationId)) {
    return { status: "error" as const, code: "INVALID_REQUEST" };
  }

  const rawBytes = new Uint8Array(TOKEN_BYTE_LENGTH);
  crypto.getRandomValues(rawBytes);
  const rawToken = encodeVerificationToken(rawBytes);
  const tokenHash = await tokenHashBytea(rawBytes);
  const now = dependencies.now ?? new Date();
  const requestedExpiry = new Date(now.getTime() + TOKEN_LIFETIME_MS).toISOString();

  const { data, error } = await dependencies.rpc.rpc("issue_email_verification_token", {
    p_reservation_id: reservationId,
    p_token_hash: tokenHash,
    p_requested_expires_at: requestedExpiry,
  });

  if (error) {
    if (error.code === "P0004") return { status: "error" as const, code: "COOLDOWN" };
    return { status: "error" as const, code: "NOT_ELIGIBLE" };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object" || typeof row.token_id !== "string") {
    return { status: "error" as const, code: "INTERNAL_ERROR" };
  }

  // This raw value exists only as the return value to a future trusted email
  // adapter. It is never logged, persisted, or returned by a browser handler.
  return {
    status: "issued" as const,
    token: rawToken,
    tokenId: row.token_id,
    reservationId: row.reservation_id,
    customerId: row.customer_id,
    organisationId: row.organisation_id,
    expiresAt: row.expires_at,
  };
}
