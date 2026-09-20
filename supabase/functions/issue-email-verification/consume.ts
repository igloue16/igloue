import { decodeVerificationToken, tokenHashBytea } from "./token.ts";
import type { EmailVerificationRpc } from "./service.ts";

// Trusted service only. A future scanner-safe POST handler may call this after
// explicit customer confirmation; GET/landing requests must never call it.
export async function consumeEmailVerificationToken(
  rawToken: unknown,
  dependencies: { rpc: EmailVerificationRpc },
) {
  const bytes = decodeVerificationToken(rawToken);
  if (!bytes) return { status: "error" as const, code: "INVALID_TOKEN" };

  try {
    const hash = await tokenHashBytea(bytes);
    const { data, error } = await dependencies.rpc.rpc(
      "consume_email_verification_token",
      { p_token_hash: hash },
    );
    // A consumed credential is never accepted again; double-clicks get the
    // same generic failure and cannot authorize further access.
    if (error || data !== true) {
      return { status: "error" as const, code: "NOT_ELIGIBLE" };
    }
    return { status: "verified" as const };
  } catch {
    // Neither the credential, digest nor raw database messages escape.
    return { status: "error" as const, code: "NOT_ELIGIBLE" };
  }
}
