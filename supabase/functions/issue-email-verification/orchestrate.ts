import {
  issueEmailVerificationToken,
  type EmailVerificationRpc,
} from "./service.ts";
import type { VerificationEmailDelivery } from "./delivery.ts";

export type VerificationOrchestrationResult =
  | { status: "delivered" }
  | { status: "issuance_failed" }
  | { status: "delivery_failed" }
  | { status: "configuration_failed" };

export function buildVerificationUrl(publicBaseUrl: string, rawToken: string) {
  const base = publicBaseUrl.trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s/]+(?:\/[^\s]*)?$/i.test(base)) return null;
  return `${base}/verify-email#credential=${encodeURIComponent(rawToken)}`;
}

export async function orchestrateEmailVerification(input: {
  reservationId: string;
  destination: string;
  publicBaseUrl: string;
  rpc: EmailVerificationRpc;
  delivery: VerificationEmailDelivery;
}): Promise<VerificationOrchestrationResult> {
  const issued = await issueEmailVerificationToken(input.reservationId, { rpc: input.rpc });
  if (issued.status !== "issued") return { status: "issuance_failed" };

  const verificationUrl = buildVerificationUrl(input.publicBaseUrl, issued.token);
  if (!verificationUrl) return { status: "configuration_failed" };

  try {
    const result = await input.delivery.sendVerificationEmail({
      destination: input.destination,
      verificationUrl,
      expiresAt: issued.expiresAt,
    });
    return result.status === "delivered"
      ? { status: "delivered" }
      : { status: "delivery_failed" };
  } catch {
    return { status: "delivery_failed" };
  }
}
