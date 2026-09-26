import {
  type AuthorityOutcome,
  type ClaimedPaymentEvent,
  recoverStripeEventsBatch,
  type RecoveryDependencies,
} from "./worker.ts";

type RpcResult = { data: unknown; error: unknown | null };
type SupabaseAdmin = {
  rpc(name: string, parameters: Record<string, unknown>): Promise<RpcResult>;
};

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scalar(value: unknown): unknown {
  if (Array.isArray(value)) {
    if (value.length !== 1) return null;
    const first = value[0];
    if (object(first)) {
      const values = Object.values(first);
      return values.length === 1 ? values[0] : null;
    }
    return first;
  }
  return value;
}

function claimRows(value: unknown): ClaimedPaymentEvent[] {
  if (!Array.isArray(value)) throw new Error("invalid recovery claim response");
  return value.map((item) => {
    if (
      !object(item) || typeof item.event_id !== "string" ||
      typeof item.claim_token !== "string" ||
      typeof item.attempt_count !== "number" ||
      !Number.isInteger(item.attempt_count)
    ) {
      throw new Error("invalid recovery claim response");
    }
    return {
      event_id: item.event_id,
      claim_token: item.claim_token,
      attempt_count: item.attempt_count,
    };
  });
}

function authorityOutcome(value: unknown): AuthorityOutcome | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!object(row)) return null;
  return row.outcome === "paid_confirmed" ||
      row.outcome === "paid_already_confirmed" ||
      row.outcome === "requires_review" || row.outcome === "already_paid" ||
      row.outcome === "already_requires_review" ||
      row.outcome === "not_authoritative"
    ? row.outcome
    : null;
}

export function createRecoveryDependencies(
  supabaseAdmin: SupabaseAdmin,
  expectedLivemode: boolean | null,
): RecoveryDependencies {
  return {
    async claim(limit) {
      if (expectedLivemode === null) {
        throw new Error("livemode configuration unavailable");
      }
      const result = await supabaseAdmin.rpc(
        "claim_payment_provider_event_recovery",
        {
          p_limit: limit,
          p_expected_livemode: expectedLivemode,
        },
      );
      if (result.error) throw new Error("recovery claim failed");
      return claimRows(result.data);
    },
    async applyAuthority(eventId) {
      const result = await supabaseAdmin.rpc("apply_provider_payment_outcome", {
        p_event_id: eventId,
      });
      if (result.error) throw new Error("payment authority failed");
      return authorityOutcome(result.data);
    },
    async recordResult(eventId, claimToken, result, errorClass) {
      const rpcResult = await supabaseAdmin.rpc(
        "record_payment_provider_event_recovery",
        {
          p_event_id: eventId,
          p_claim_token: claimToken,
          p_result: result,
          p_error_class: errorClass ?? null,
        },
      );
      if (rpcResult.error) throw new Error("recovery result unavailable");
      const outcome = scalar(rpcResult.data);
      if (
        outcome !== "completed" && outcome !== "terminal" &&
        outcome !== "retry_scheduled" && outcome !== "retry_exhausted" &&
        outcome !== "lost_claim"
      ) {
        throw new Error("invalid recovery result response");
      }
      return outcome;
    },
  };
}

export async function handleRecoveryRequest(
  request: Request,
  dependencies: RecoveryDependencies,
) {
  if (request.method !== "POST") {
    return Response.json({ ok: false, error: { code: "METHOD_NOT_ALLOWED" } }, {
      status: 405,
    });
  }
  try {
    const result = await recoverStripeEventsBatch(dependencies);
    return Response.json({ ok: true, ...result });
  } catch {
    return Response.json(
      { ok: false, error: { code: "RECOVERY_UNAVAILABLE" } },
      { status: 503 },
    );
  }
}
