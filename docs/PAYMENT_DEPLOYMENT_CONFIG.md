# Payment Edge deployment configuration

Configure these eight deployable functions explicitly in `supabase/config.toml`. All use `verify_jwt = false`; the request boundary is enforced by the function/runtime middleware shown below. `issue-email-verification` is currently a shared module called by `create-reservation`, not a separately deployable function (no `index.ts`).

| Function | Caller and authority | Required function configuration |
| --- | --- | --- |
| `check-availability` | Customer/browser; `withSupabase` requires publishable Supabase auth | enabled, `verify_jwt=false`, function import map and `index.ts` entrypoint |
| `create-reservation` | Customer/browser; `withSupabase` accepts publishable or secret auth; payment capability protects subsequent payment operations | enabled, `verify_jwt=false`, function import map and `index.ts` entrypoint |
| `create-checkout-session` | Customer/browser; `withSupabase` accepts publishable or secret auth; database capability and authoritative RPC checks govern checkout | enabled, `verify_jwt=false`, function import map and `index.ts` entrypoint |
| `stripe-webhook` | Stripe; verifies `stripe-signature` HMAC over the unmodified request body before event processing | enabled, `verify_jwt=false`, function import map and `index.ts` entrypoint |
| `recover-stripe-events` | Internal service only; `withSupabase` requires secret Supabase auth | enabled, `verify_jwt=false`, function import map and `index.ts` entrypoint |
| `execute-stripe-refund` | Internal service only; `withSupabase` requires secret auth and handler verifies exact service-role bearer authority | enabled, `verify_jwt=false`, function import map and `index.ts` entrypoint |
| `payment-operator` | Internal service only; `withSupabase` requires secret auth and handler verifies exact service-role bearer authority | enabled, `verify_jwt=false`, function import map and `index.ts` entrypoint |
| `process-outbox` | Internal service only; `withSupabase` requires secret Supabase auth | enabled, `verify_jwt=false`, function import map and `index.ts` entrypoint |

Do not weaken the in-function authentication boundaries when deploying. The `deno.json` import maps pin the function runtime imports. Keep config and entrypoints aligned; `node tests/edge-function-config-v1.test.js` checks every deployable function directory.

## Environment contract

Supabase's Edge runtime supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to server functions. The service-role key is secret and must remain server-side. `withSupabase` uses the project URL/key for its admin client; the webhook receipt client and internal operator/refund handlers also read them directly. Missing direct service-role configuration returns an unavailable response or prevents receipt persistence; privileged processing must not be treated as successful without the required database authority.

| Variable | Used by | Secret? / expected value | Required and failure behavior | Environment separation |
| --- | --- | --- | --- | --- |
| `SUPABASE_URL` | Supabase-backed functions via `withSupabase`; directly by `stripe-webhook` receipt client | Project API URL; not a credential, but keep server receipt configuration out of browser code | Required for database access; missing webhook receipt config prevents authoritative receipt processing | Must point to the matching local, test, or live project |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase admin client; directly by webhook receipt, refund executor, payment operator | Secret service-role key/JWT; exact bearer comparison in refund/operator | Required for privileged DB access; missing explicit key makes webhook receipt unavailable and operator/refund return 503 | Unique to each Supabase project/environment |
| `STRIPE_SECRET_KEY` | `create-checkout-session`, `execute-stripe-refund` | Secret Stripe API key: `sk_test_…`/`rk_test_…` for test, `sk_live_…`/`rk_live_…` for live | Required; missing, unrecognized, or mode-mismatched key prevents checkout/refund configuration and no Stripe request is made | Must match exact `STRIPE_EXPECTED_LIVEMODE`; use separate test/live keys |
| `STRIPE_WEBHOOK_SECRET` | `stripe-webhook` | Secret endpoint signing secret (`whsec_…`) | Required; missing secret rejects before body/event processing | Separate signing secret for every test/live endpoint |
| `STRIPE_EXPECTED_LIVEMODE` | `stripe-webhook`, `recover-stripe-events`, `create-checkout-session`, `execute-stripe-refund` | Non-secret exact string `true` or `false`; no whitespace/case coercion | Required; missing or malformed value fails closed. Checkout/refund also require key prefix mode agreement | Set explicitly alongside the matching Stripe key and endpoint |
| `IGLOUE_CHECKOUT_SUCCESS_URL` | `create-checkout-session` | Non-secret absolute HTTPS URL with a hostname and no embedded credentials | Required; malformed/missing URL rejects function configuration before Stripe access | Use environment-specific site URLs |
| `IGLOUE_CHECKOUT_CANCEL_URL` | `create-checkout-session` | Non-secret absolute HTTPS URL with a hostname and no embedded credentials | Required; malformed/missing URL rejects function configuration before Stripe access | Use environment-specific site URLs |
| `PAYMENT_CAPABILITY_SECRET` | `create-reservation` and reservation handler fallback | Secret random capability-signing key | Required for capability creation; missing key prevents capability-protected payment work | Keep unique per environment; do not reuse across test/live |
| `IGLOUE_PUBLIC_BASE_URL` | `create-reservation` | Non-secret public site base URL | Optional in current wiring; empty value disables the optional email verification URL path | Set to the matching environment's public site URL when that path is enabled |
| `ZEPTOMAIL_API_TOKEN` | Shared ZeptoMail delivery adapter | Secret provider API token | Required only when that adapter is used; missing token returns a retryable missing-configuration result. Current `create-reservation` wiring uses no-op verification delivery | Use a provider token scoped to the corresponding environment/account |

Never put service-role keys, Stripe secret keys, webhook signing secrets, payment capability signing secrets, or ZeptoMail tokens in browser code, HTML, or public documentation. The public Supabase publishable key is designed for browser use and is not a service credential.

## Stripe event and mode contract

Configure the webhook endpoint for `checkout.session.completed`, `refund.created`, `refund.updated`, and `refund.failed`. The webhook checks the HMAC before parsing the event, then checks event `livemode` against the exact configured expected mode before authoritative database reconciliation. Recovery uses that same expected mode. Checkout creation and refund execution reject a Stripe key whose test/live prefix disagrees with the expected mode. Do not use a test key with `true`, a live key with `false`, or omit the mode setting.

For local development and automated tests, use test-mode Stripe keys and `STRIPE_EXPECTED_LIVEMODE=false`; use local Supabase credentials and non-production callback URLs. Production configuration must independently provide the live key, live webhook signing secret, `STRIPE_EXPECTED_LIVEMODE=true`, production Supabase credentials, and production callback URLs. This document contains no secret values. No production values are checked into the repository.

## Background payment jobs

The migration `20261030000000_schedule_background_recovery_and_outbox.sql`
installs `pg_net` when needed and configures two `pg_cron` jobs. It does not
install or alter `pg_cron` or `supabase_vault`; those extensions must be
available in the Supabase database. The existing hold-cleanup job remains
unchanged.

| Job name | Cadence | Work |
| --- | --- | --- |
| `igloue-provider-event-recovery` | Every minute | POSTs to the internal `recover-stripe-events` Edge Function. The worker claims at most 10 events per batch and retains its database lease, retry backoff, and terminal-event rules. |
| `igloue-confirmation-outbox` | Every minute | POSTs to the internal `process-outbox` Edge Function. Before each claim, it recovers at most 100 expired outbox leases; then it claims at most 10 events. |

The schedule invokes a private, postgres-only helper. At run time, the helper
reads these two named entries from `vault.decrypted_secrets` and builds the
`Authorization: Bearer …` and `apikey` headers for `pg_net`:

- `igloue_internal_functions_base_url`: environment-specific Supabase
  Functions base URL ending in `/functions/v1`.
- `igloue_internal_edge_secret_key`: Supabase secret API key (`sb_secret_…`)
  for the same project. This matches the functions' configured `secret` auth
  mode. The Edge runtime continues to use its own service-role credential for
  database work; that credential is not copied into Vault for these calls.

Neither value is stored in the migration or cron command. If either Vault entry
is absent or blank, the helper does not enqueue a request. The jobs remain
scheduled and begin invoking the functions after both entries are provisioned.
The Edge Functions still enforce their internal secret-auth boundary. Keep
Vault access restricted to trusted operators and database service roles.

### Provision and rotate Vault values

Connect to the target project database with `psql` as a trusted database
operator. Enter the URL and secret API key at the prompts; the key prompt is
hidden. Retrieve a local key from the local Supabase environment and use the
matching project's `sb_secret_…` key for another environment. These commands
use psql variables so the values are not literal SQL text or migration history:

```psql
\prompt 'Functions base URL (ending /functions/v1): ' igloue_functions_base_url
\prompt -s 'Secret API key for this same project: ' igloue_edge_secret_key
select vault.create_secret(:'igloue_functions_base_url', 'igloue_internal_functions_base_url', 'Background Edge invocation URL');
select vault.create_secret(:'igloue_edge_secret_key', 'igloue_internal_edge_secret_key', 'Background Edge invocation credential');
\unset igloue_functions_base_url
\unset igloue_edge_secret_key
```

Run the creation commands once per project. To rotate either value, use the
hidden prompt again and update the existing Vault entry by its name:

```psql
\prompt -s 'Replacement secret API key: ' igloue_edge_secret_key
select vault.update_secret(
  secret_id => (select id from vault.secrets where name = 'igloue_internal_edge_secret_key'),
  new_secret => :'igloue_edge_secret_key'
);
\unset igloue_edge_secret_key
```

For URL changes, use the same `vault.update_secret` call with
`igloue_internal_functions_base_url` and the prompted URL variable. Never put
either value in source control, a migration, a cron command, a ticket, or a
report. Use a local project URL and local secret API key for local testing;
use only the matching environment's credential when provisioning another
project.

### Verify, disable, and re-enable

Inspect the jobs without reading any Vault values:

```sql
select jobname, schedule, command
from cron.job
where jobname in ('igloue-provider-event-recovery', 'igloue-confirmation-outbox');
```

Each name should appear exactly once with schedule `* * * * *`. The command
contains only a call to the private enqueue helper. To inspect recent HTTP
outcomes, query `net._http_response` by the request ID returned by the cron job;
the function response is sanitized batch counts. Do not query or print
`vault.decrypted_secrets` in routine diagnostics.

Disable one or both jobs by name:

```sql
select cron.unschedule(jobid)
from cron.job
where jobname in ('igloue-provider-event-recovery', 'igloue-confirmation-outbox');
```

As the database owner, re-enable them idempotently with:

```sql
select private.configure_background_jobs();
```

If Vault values are missing, no HTTP request is queued and the cron entry
remains available for retry after provisioning. If a function call fails, pg_net
records its HTTP outcome; the next scheduled run retries eligible work. The
database claim tokens and leases remain authoritative, so overlapping calls do
not steal active work. Provider events retain their bounded backoff and
terminalization behavior. Outbox delivery keeps retryable and terminal outcomes
in the existing worker; expired processing leases are requeued immediately
before each outbox claim, while active leases are left alone.

The migration owns extension installation for `pg_net` and idempotent job
creation. Operators own environment-specific Vault provisioning and credential
rotation. No URL or credential needs to be embedded in deployment SQL or job
definitions.
