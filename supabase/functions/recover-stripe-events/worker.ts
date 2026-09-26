export const RECOVERY_BATCH_LIMIT = 10;

export type ClaimedPaymentEvent = {
  event_id: string;
  claim_token: string;
  attempt_count: number;
};

export type AuthorityOutcome =
  | "paid_confirmed"
  | "paid_already_confirmed"
  | "requires_review"
  | "already_paid"
  | "already_requires_review"
  | "not_authoritative";

export type RecoveryDependencies = {
  claim(limit: number): Promise<ClaimedPaymentEvent[]>;
  applyAuthority(eventId: string): Promise<AuthorityOutcome | null>;
  recordResult(
    eventId: string,
    claimToken: string,
    result: "processed" | "not_authoritative" | "transient_error",
    errorClass?: "authority_rpc_unavailable" | "invalid_authority_response",
  ): Promise<string>;
};

export type RefundRecoveryDependencies = {
  claim(limit: number): Promise<ClaimedPaymentEvent[]>;
  applyAuthority(
    eventId: string,
  ): Promise<
    | "succeeded"
    | "failed"
    | "already_processed"
    | "pending"
    | "ignored"
    | "conflict"
    | null
  >;
  recordResult: RecoveryDependencies["recordResult"];
};

export type RecoveryBatchResult = {
  claimed: number;
  processed: number;
  terminal: number;
  retried: number;
  retryExhausted: number;
  lostClaims: number;
};

function recordOutcome(result: RecoveryBatchResult, outcome: string) {
  if (outcome === "completed") result.processed += 1;
  else if (outcome === "terminal") result.terminal += 1;
  else if (outcome === "retry_scheduled") result.retried += 1;
  else if (outcome === "retry_exhausted") result.retryExhausted += 1;
  else result.lostClaims += 1;
}

export async function recoverStripeEventsBatch(
  dependencies: RecoveryDependencies,
): Promise<RecoveryBatchResult> {
  const events = await dependencies.claim(RECOVERY_BATCH_LIMIT);
  const result: RecoveryBatchResult = {
    claimed: events.length,
    processed: 0,
    terminal: 0,
    retried: 0,
    retryExhausted: 0,
    lostClaims: 0,
  };

  for (const event of events) {
    let authority: AuthorityOutcome | null;
    try {
      authority = await dependencies.applyAuthority(event.event_id);
    } catch {
      try {
        recordOutcome(
          result,
          await dependencies.recordResult(
            event.event_id,
            event.claim_token,
            "transient_error",
            "authority_rpc_unavailable",
          ),
        );
      } catch {
        result.lostClaims += 1;
      }
      continue;
    }

    if (authority === "not_authoritative") {
      try {
        recordOutcome(
          result,
          await dependencies.recordResult(
            event.event_id,
            event.claim_token,
            "not_authoritative",
          ),
        );
      } catch {
        result.lostClaims += 1;
      }
      continue;
    }

    if (authority === null) {
      try {
        recordOutcome(
          result,
          await dependencies.recordResult(
            event.event_id,
            event.claim_token,
            "transient_error",
            "invalid_authority_response",
          ),
        );
      } catch {
        result.lostClaims += 1;
      }
      continue;
    }

    try {
      recordOutcome(
        result,
        await dependencies.recordResult(
          event.event_id,
          event.claim_token,
          "processed",
        ),
      );
    } catch {
      // Payment authority may already have committed. Its event status is
      // durable; the lease will expire without changing that final outcome.
      result.lostClaims += 1;
    }
  }

  return result;
}

export async function recoverStripeRefundEventsBatch(
  dependencies: RefundRecoveryDependencies,
): Promise<RecoveryBatchResult> {
  const events = await dependencies.claim(RECOVERY_BATCH_LIMIT);
  const result: RecoveryBatchResult = {
    claimed: events.length,
    processed: 0,
    terminal: 0,
    retried: 0,
    retryExhausted: 0,
    lostClaims: 0,
  };
  for (const event of events) {
    let authority: Awaited<
      ReturnType<RefundRecoveryDependencies["applyAuthority"]>
    >;
    try {
      authority = await dependencies.applyAuthority(event.event_id);
    } catch {
      authority = null;
    }
    const success = authority === "succeeded" || authority === "failed" ||
      authority === "already_processed";
    const terminal = authority === "pending" || authority === "ignored" ||
      authority === "conflict";
    try {
      recordOutcome(
        result,
        await dependencies.recordResult(
          event.event_id,
          event.claim_token,
          success
            ? "processed"
            : terminal
            ? "not_authoritative"
            : "transient_error",
          authority === null ? "authority_rpc_unavailable" : undefined,
        ),
      );
    } catch {
      result.lostClaims += 1;
    }
  }
  return result;
}
