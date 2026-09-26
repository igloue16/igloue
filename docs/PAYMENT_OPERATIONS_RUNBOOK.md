# Payment operations runbook

Use this runbook for the environment being investigated. These checks are read-only unless a specific trusted operator action is described. Run scheduled-job and Vault checks as a database operator. Do not paste keys, customer details, raw provider payloads, or rendered messages into tickets.

Severity and response targets:

| Severity | Response target | Conditions |
| --- | --- | --- |
| CRITICAL | Begin investigation within 5 minutes; stop further financial actions until reconciled. | Proven contradictory payment/refund/reservation state, duplicate refund evidence, or both background jobs absent/disabled while eligible work is accumulating. |
| URGENT | Acknowledge within 30 minutes and assign an operator. | A paid review case older than 15 minutes; exhausted technical provider recovery; a prepared refund attempt older than 15 minutes without authoritative outcome; terminal outbox failure; refund conflict/mismatch; or a required scheduler invocation absent for over 2 minutes. |
| WARNING | Review within one business day. | Recovery has reached attempt 6 or later and remains retryable; outbox lease is expired by over 2 minutes; isolated webhook/configuration failures without confirmed financial inconsistency. |
| INFO | Review during routine operations. | Expected backoff, active leases, deterministic ignored events, pending refund evidence, and empty queues. |

The one-minute scheduler cadence, five-minute outbox retry, 15-minute outbox lease, provider recovery's 30-second exponential backoff (capped at one hour) and eight-attempt limit inform these thresholds. A prepared refund has no automatic timeout retry: age is a prompt to reconcile evidence, never authority to send another refund.

## A. Paid `requires_review` cases

Use the internal `payment-operator` Edge Function, authenticated with the environment's `sb_secret` API key and service-role bearer token. Keep both credentials in a trusted operator shell or secret manager; never put values in command history or this document. Requests use `apikey` and `Authorization: Bearer …` headers.

```http
POST /functions/v1/payment-operator
Content-Type: application/json

{"action":"list","limit":25}
```

The list is capped at 50 and returns the precise unresolved paid-exception queue: exception, reservation and payment-attempt IDs; reason/status; paid time; amount/currency. It omits customer PII. Inspect an item with `{"action":"inspect","exceptionId":"<uuid>"}`. Use the returned evidence and internal booking/provider records to decide:

- `refund_required` when the paid amount must be returned under the applicable cancellation/hold outcome. Then use `prepare_refund` to create/retrieve the durable refund attempt; the separate refund executor is the operation that contacts Stripe.
- `no_refund_required` only when the payment is valid and retaining it is the correct documented business outcome.
- `manual_investigation_complete` only when investigation is complete but neither of the above dispositions is appropriate yet.

Resolution records an audited disposition and removes the case from the unresolved queue. It does not issue a refund, change reservation/payment state, or contact the customer. To confirm, repeat `list` and verify the exception ID is absent; use `inspect` to review its recorded disposition. If evidence is incomplete, leave unresolved and escalate. Do not resolve a case just to clear the queue.

**URGENT:** any unresolved paid case older than 15 minutes. The DB queue itself is authoritative. First action: inspect and compare payment evidence with reservation state; use the trusted operator API only after the business outcome is clear. No automatic retry resolves the human decision.

## B. Provider-event recovery

Run these read-only queries with a trusted database role. They expose internal identifiers and short error classes; keep results restricted.

```sql
-- Technical exhaustion and deterministic terminal outcomes are distinct.
select id, provider_event_id, event_type, status, recovery_attempt_count,
       recovery_error_class, recovery_terminal_at, last_error_code
from public.payment_provider_events
where recovery_terminal_at is not null
   or recovery_error_class = 'retry_exhausted'
order by recovery_terminal_at desc nulls last, created_at desc;

-- Due retryable work, excluding work currently protected by a live lease.
select id, provider_event_id, recovery_attempt_count, recovery_next_attempt_at,
       recovery_last_attempt_at, recovery_error_class
from public.payment_provider_events
where status = 'received' and matched_at is not null
  and conflict_detected_at is null and recovery_terminal_at is null
  and recovery_attempt_count < 8 and recovery_next_attempt_at <= now()
  and (recovery_lease_until is null or recovery_lease_until <= now())
order by recovery_next_attempt_at;

-- Failed receipt/conflicting payloads and impossible processed/match markers.
select id, provider_event_id, event_type, status, last_error_code,
       matched_at, conflict_detected_at, processed_at
from public.payment_provider_events
where status = 'failed'
   or (status = 'processed' and (processed_at is null or matched_at is null))
   or (status = 'received' and processed_at is not null)
   or (conflict_detected_at is not null and status <> 'failed');
```

`retry_exhausted` is a technical failure after the bounded eight attempts and requires investigation (URGENT). `not_authoritative` and other deterministic terminal outcomes are not retry instructions; review their recorded reason as needed, but do not reset or replay them by editing the database. Repeated retryable failures use automatic backoff. Attempt 6+ is WARNING; exhausted technical recovery is URGENT. Check function configuration, provider mode, webhook receipts, and recent worker HTTP outcomes. The worker handles at most 10 checkout events and 10 refund events per invocation.

An ignored event is not automatically an incident. Investigate `conflicting_payload_digest`, refund conflict/mismatch/unknown errors and livemode mismatch as URGENT; deterministic `refund_not_eligible` or pending provider evidence is not itself an alert. A failed receipt or impossible status/matching combination from the query is URGENT pending reconciliation. Do not manually mark events processed or alter matching fields.

## C. Refund attempts and obligations

```sql
select r.id as refund_id, r.payment_exception_id, r.obligation_status,
       r.status as refund_status, r.created_at,
       a.id as latest_attempt_id, a.attempt_number,
       a.status as latest_attempt_status, a.prepared_at, a.finalized_at,
       a.provider_refund_id
from public.payment_refunds r
left join lateral (
  select ra.* from public.payment_refund_attempts ra
  where ra.refund_id = r.id
  order by ra.attempt_number desc limit 1
) a on true
where r.obligation_status = 'open'
order by r.created_at, a.attempt_number;
```

An open obligation with no active prepared attempt, or with a failed latest attempt, needs an operator to reconcile. A failed attempt is eligible for a replacement only after authoritative Stripe failure evidence has finalized it; `prepare_refund` then creates a new attempt with a new idempotency key. A request replay for the same attempt uses its existing `refundId` and idempotency identity. The `payment-operator` preparation API will not create a replacement while an attempt is prepared or succeeded.

A `prepared` attempt older than 15 minutes is URGENT because its Stripe outcome may be ambiguous. Check the Stripe dashboard/API and webhook receipt/reconciliation evidence first. If provider evidence is pending, allow the webhook/recovery path to settle it. Never create another refund while an attempt is prepared, pending, or ambiguous. Only a confirmed failed attempt permits a replacement. Repeated failed attempts or any mismatch/conflict require URGENT escalation to the payment owner; do not change ledger rows manually.

## D. Confirmation outbox

```sql
select id, event_type, aggregate_type, aggregate_id, status, attempt_count,
       available_at, last_attempt_at, lease_expires_at, last_error_code
from public.outbox_events
where status = 'failed'
   or (status = 'processing' and lease_expires_at <= now() - interval '2 minutes')
order by coalesce(lease_expires_at, available_at), created_at;
```

Transient delivery failures are requeued for five minutes later. The every-minute worker first recovers up to 100 expired leases, then claims up to 10 events; a 15-minute lease protects active work. A stale processing row is WARNING after two minutes beyond lease expiry. `failed` is terminal and URGENT: confirm whether the customer confirmation needs manual follow-up through the approved support process. Do not edit the business record to imitate delivery or send duplicate messages without checking delivery evidence. Outbox delivery does not control payment or reservation authority.

## E. Scheduler and Vault health

The expected jobs are `igloue-provider-event-recovery` and `igloue-confirmation-outbox`, each scheduled as `* * * * *`. The existing `igloue-expired-hold-cleanup` job runs every five minutes and must remain configured.

```sql
select jobname, schedule, active, jobid
from cron.job
where jobname in (
  'igloue-provider-event-recovery',
  'igloue-confirmation-outbox',
  'igloue-expired-hold-cleanup'
)
order by jobname;

select j.jobname, d.status, d.return_message, d.start_time, d.end_time
from cron.job_run_details d
join cron.job j on j.jobid = d.jobid
where j.jobname in ('igloue-provider-event-recovery', 'igloue-confirmation-outbox')
order by d.start_time desc
limit 20;
```

Confirm both worker jobs appear exactly once, are active and use the expected cadence. The cron command returns a `pg_net` request ID; correlate that ID with `net._http_response.id` and inspect HTTP status/body for sanitized worker counts. No corresponding request for a successful cron tick can mean a missing/blank Vault value: the helper safely queues no request. Check required entries without reading secret values:

```sql
select expected.name, exists (
  select 1 from vault.decrypted_secrets s
  where s.name = expected.name and nullif(trim(s.decrypted_secret), '') is not null
) as configured
from (values
  ('igloue_internal_functions_base_url'),
  ('igloue_internal_edge_secret_key')
) as expected(name);
```

Only the names and booleans should be reported. Missing values or an absent/disabled job that delays work over two minutes is URGENT; both worker jobs absent/disabled with accumulating eligible work is CRITICAL. Provision or rotate credentials using the protected procedure in [Payment Edge deployment configuration](PAYMENT_DEPLOYMENT_CONFIG.md). Never print `vault.decrypted_secrets` or copy values into logs.

To pause a job safely during an incident, unschedule only the named worker job, record the incident/change, and preserve the hold-cleanup job. Re-enable through `select private.configure_background_jobs();` after correcting the cause; verify the expected rows and next HTTP response. Do not repeatedly disable/re-enable to force retries.

## F. Stripe webhook health

The endpoint must subscribe to `checkout.session.completed`, `refund.created`, `refund.updated`, and `refund.failed`. The handler verifies the signature on the raw request body and exact expected livemode before reconciliation. `INVALID_SIGNATURE` (400) points to wrong endpoint secret/body handling; verifier failure (500) or configuration/processing failure (503) warrants checking Edge logs and webhook configuration. Repeated livemode mismatches or conflicting receipts are URGENT. Verify the endpoint secret, configured mode, and matching environment without exposing values.

Webhook receipt deduplication and database processing are replay-safe. Stripe retries delivery; the recovery worker retries only eligible matched events. Check receipt status and provider evidence before replaying. Never manually alter an event, payment, refund, or reservation row to force a desired state.

## G. Emergency rules

- Never directly edit payment/refund state to “fix” a customer. Use the trusted operator workflow and authoritative provider evidence.
- Never expose service-role, `sb_secret`, Stripe secret, webhook signing, or payment capability secrets.
- Never create a second refund while one attempt is pending or ambiguous.
- Never resurrect released inventory or confirm a reservation after late payment without the defined exception workflow.
- For proven contradictory financial state, duplicate refund evidence, or unresolved uncertainty about whether money moved, stop further financial actions and escalate to the payment owner immediately.

## Alert condition catalogue

These conditions define operator alerts only; this change installs no notification channel or monitoring service. Evaluate only supported states, and deduplicate repeated observations for the same row.

| Condition | Severity / threshold | Automatic action | Safe first response |
| --- | --- | --- | --- |
| Unresolved paid exception | URGENT, `created_at` older than 15m | None; human disposition required | Inspect evidence and decide disposition. |
| Provider recovery `retry_exhausted` | URGENT, immediately on terminalization | Automatic retries stop at 8 | Inspect configuration/provider evidence; do not reset row. |
| Retryable recovery at attempt 6+ | WARNING, when due and unleased | Backoff retries continue | Check worker health/configuration and expected provider evidence. |
| Open refund with latest attempt failed and no prepared/succeeded replacement | URGENT, immediately; repeat failure escalates | No new attempt is sent automatically | Confirm failed evidence; then trusted operator may prepare replacement. |
| Prepared refund attempt with no outcome | URGENT after 15m | Webhook/recovery may still provide evidence | Reconcile with Stripe before any retry/new attempt. |
| Refund event evidence conflict, amount/currency/payment-intent mismatch, unknown refund, or livemode mismatch | URGENT on observation | Event may be terminal/ignored | Inspect Stripe and local evidence; do not alter rows. |
| Outbox terminal `failed` | URGENT on observation | No automatic retry while terminal | Confirm message delivery status and arrange approved follow-up. |
| Outbox `processing` past lease by >2m | WARNING | Next scheduled invocation recovers expired lease | Check scheduler and worker result; avoid manual resend. |
| Required worker job disabled/missing or no request/HTTP result >2m | URGENT | Work waits; normal claims stop | Check cron, Vault-name booleans and `pg_net` response. |
| Both worker jobs disabled/missing and eligible work accumulating | CRITICAL | Background work is stopped | Restore scheduler/configuration and reconcile queue before financial actions. |
| Structurally contradictory ledger state / duplicate refund evidence | CRITICAL | Stop further financial operations | Preserve evidence and escalate to payment owner. |

An empty queue, active lease, retry inside its backoff window, pending refund evidence, or deterministic ignored outcome alone is INFO and should not page an operator.
