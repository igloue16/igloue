import { verifyStripeSignature } from "../functions/stripe-webhook/signature.ts";

// Local opt-in only. Prepare the ignored supabase/functions/.env.local with
// STRIPE_WEBHOOK_SECRET=<dedicated whsec_local_e2e_ fake value>
// STRIPE_EXPECTED_LIVEMODE=false, then serve with:
// npx.cmd supabase functions serve stripe-webhook --env-file supabase/functions/.env.local
// In another shell set P3E3D_LOCAL_E2E=1 and STRIPE_WEBHOOK_SECRET to that
// same fake value, then run:
// deno.exe test --allow-env=P3E3D_LOCAL_E2E,STRIPE_WEBHOOK_SECRET,HTTP_PROXY,HTTPS_PROXY,ALL_PROXY,http_proxy,https_proxy,all_proxy --allow-read=supabase/integration --allow-net=127.0.0.1:54321 --allow-run=docker.exe supabase/integration/p3e3d-local-webhook.test.ts

const API_ENDPOINT = "http://127.0.0.1:54321/functions/v1/stripe-webhook";
const PROJECT_ID = "igloue";
const DATABASE_CONTAINER = "supabase_db_igloue";
const EDGE_CONTAINER = "supabase_edge_runtime_igloue";
const WEBHOOK_SECRET_PREFIX = "whsec_local_e2e_";

const RESERVATION_ID = "00000000-0000-4000-8000-00000000d301";
const ATTEMPT_ID = "00000000-0000-4000-8000-00000000d302";
const ALLOCATION_ID = "00000000-0000-4000-8000-00000000d303";
const DELIVERY_JOB_ID = "00000000-0000-4000-8000-00000000d304";
const COLLECTION_JOB_ID = "00000000-0000-4000-8000-00000000d305";
const CUSTOMER_ID = "00000000-0000-4000-8000-00000000d306";
const MACHINE_ID = "P3E3D-LOCAL-E2E-MACHINE";
const EVENT_ID = "evt_local_p3e3d_0001";
const SESSION_ID = "cs_local_p3e3d_0001";
const PAYMENT_INTENT_ID = "pi_local_p3e3d_0001";

const optedIn = Deno.env.get("P3E3D_LOCAL_E2E") === "1";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown, message: string) {
  assert(Object.is(actual, expected), `${message}: expected ${String(expected)}, got ${String(actual)}`);
}

export function requireLoopbackEndpoint(value: string): URL {
  const url = new URL(value);
  assert(url.protocol === "http:", "local webhook endpoint must use HTTP");
  assert(url.hostname === "127.0.0.1" || url.hostname === "localhost", "webhook target must be loopback");
  assert(url.port === "54321", "webhook target must use the configured local Supabase API port");
  assert(url.pathname === "/functions/v1/stripe-webhook", "webhook target path is fixed");
  assert(url.username === "" && url.password === "" && url.search === "" && url.hash === "", "webhook target cannot contain credentials or overrides");
  return url;
}

export function requireTestLivemode(value: boolean) {
  assert(value === false, "local integration event livemode must be false");
}

export function requireFakeWebhookSecret(value: string | undefined): string {
  assert(value !== undefined && value.startsWith(WEBHOOK_SECRET_PREFIX) && value.length >= 32,
    "STRIPE_WEBHOOK_SECRET must be a dedicated whsec_local_e2e_ fake value of at least 32 characters");
  return value;
}

function projectLabelMatches(labels: Record<string, string | undefined> | undefined): boolean {
  if (!labels) return false;
  return labels["com.supabase.cli.project"] === PROJECT_ID ||
    labels["com.supabase.project"] === PROJECT_ID ||
    labels["com.docker.compose.project"] === PROJECT_ID;
}

type InspectedContainer = {
  Id?: string;
  Name?: string;
  Config?: { Image?: string; Env?: string[]; Labels?: Record<string, string | undefined> };
  State?: { Running?: boolean };
};

async function docker(args: string[], stdinText?: string): Promise<string> {
  const command = new Deno.Command("docker.exe", {
    args,
    stdin: stdinText === undefined ? "null" : "piped",
    stdout: "piped",
    stderr: "piped",
  });
  const child = command.spawn();
  if (stdinText !== undefined) {
    const writer = child.stdin.getWriter();
    await writer.write(new TextEncoder().encode(stdinText));
    await writer.close();
  }
  const result = await child.output();
  const stdout = new TextDecoder().decode(result.stdout);
  if (!result.success) {
    const stderr = new TextDecoder().decode(result.stderr);
    throw new Error(`local Docker command failed (${result.code}): ${stderr.trim() || "no diagnostic"}`);
  }
  return stdout.trim();
}

async function inspectLocalContainers(secret: string) {
  const contextRaw = await docker(["context", "inspect"]);
  const context = JSON.parse(contextRaw) as Array<{
    Endpoints?: { docker?: { Host?: string } };
  }>;
  const daemonHost = context[0]?.Endpoints?.docker?.Host ?? "";
  assert(daemonHost.startsWith("npipe://") || daemonHost.startsWith("unix://"),
    "Docker context does not identify a local named-pipe or Unix-socket daemon");

  const raw = await docker(["inspect", DATABASE_CONTAINER, EDGE_CONTAINER]);
  const containers = JSON.parse(raw) as InspectedContainer[];
  assert(containers.length === 2, "expected the local database and Edge runtime containers");
  const byName = new Map(containers.map((container) => [container.Name?.replace(/^\//, ""), container]));
  const database = byName.get(DATABASE_CONTAINER);
  const edge = byName.get(EDGE_CONTAINER);
  assert(database && edge, "Supabase containers do not match project igloue names");

  for (const [container, expectedImage, label] of [
    [database, "supabase/postgres", "database"],
    [edge, "supabase/edge-runtime", "Edge runtime"],
  ] as const) {
    assert(container.State?.Running === true, `local Supabase ${label} container is not running`);
    assert(projectLabelMatches(container.Config?.Labels), `Docker metadata does not identify the ${label} container as project igloue`);
    assert(container.Config?.Image?.toLowerCase().includes(expectedImage), `container image does not identify the expected Supabase ${label}`);
  }

  const edgeEnvironment = new Map((edge.Config?.Env ?? []).map((entry) => {
    const separator = entry.indexOf("=");
    return [entry.slice(0, separator), entry.slice(separator + 1)];
  }));
  const runtimeUrl = edgeEnvironment.get("SUPABASE_URL");
  assert(runtimeUrl !== undefined, "local Edge runtime is missing SUPABASE_URL");
  const runtimeTarget = new URL(runtimeUrl);
  assert(runtimeTarget.protocol === "http:" && runtimeTarget.hostname === "kong" && runtimeTarget.port === "8000",
    "Edge runtime SUPABASE_URL does not point to the local Supabase Docker network");
  assert((edgeEnvironment.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").length > 0,
    "local Edge runtime is missing its runtime-supplied service-role key");
  assert(edgeEnvironment.get("STRIPE_EXPECTED_LIVEMODE") === "false",
    "local Edge runtime must be configured with STRIPE_EXPECTED_LIVEMODE=false");
  assert(edgeEnvironment.get("STRIPE_WEBHOOK_SECRET") === secret,
    "Edge runtime does not have the dedicated fake webhook secret supplied to the test");

  return { databaseName: DATABASE_CONTAINER };
}

async function psql(container: string, args: string[], stdinText?: string): Promise<string> {
  return await docker([
    "exec",
    ...(stdinText === undefined ? [] : ["-i"]),
    container,
    "psql",
    "-X",
    "-q",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    "postgres",
    "-d",
    "postgres",
    ...args,
  ], stdinText);
}

async function runFixture(container: string, cleanup: boolean) {
  const sql = await Deno.readTextFile(new URL("./p3e3d-local-webhook-fixture.sql", import.meta.url));
  await psql(container, ["-v", `cleanup=${cleanup ? "true" : "false"}`, "-f", "-"], sql);
}

async function runQuery(container: string, query: string): Promise<Record<string, unknown>> {
  const output = await psql(container, ["-A", "-t", "-c", query]);
  return JSON.parse(output) as Record<string, unknown>;
}

const SNAPSHOT_QUERY = `
select json_build_object(
  'reservation', (select json_build_object('id', r.id, 'status', r.status, 'payment_status', r.payment_status,
    'organisation_id', r.organisation_id, 'total_amount', r.total_amount)
    from public.reservations r where r.id = '${RESERVATION_ID}'),
  'attempt', (select json_build_object('id', pa.id, 'status', pa.status, 'paid_at', pa.paid_at,
    'provider_checkout_session_id', pa.provider_checkout_session_id,
    'provider_payment_intent_id', pa.provider_payment_intent_id, 'currency', pa.currency, 'amount', pa.amount)
    from public.payment_attempts pa where pa.id = '${ATTEMPT_ID}'),
  'allocations', (select coalesce(json_agg(json_build_object('id', a.id, 'machine_id', a.machine_id,
    'status', a.status, 'hold_expires_at', a.hold_expires_at)), '[]'::json)
    from public.allocations a where a.reservation_id = '${RESERVATION_ID}'),
  'events', (select coalesce(json_agg(json_build_object('id', pe.id, 'provider_event_id', pe.provider_event_id,
    'organisation_id', pe.organisation_id, 'payment_attempt_id', pe.payment_attempt_id,
    'matched_at', pe.matched_at, 'status', pe.status, 'processed_at', pe.processed_at)), '[]'::json)
    from public.payment_provider_events pe where pe.provider = 'stripe' and pe.provider_event_id = '${EVENT_ID}'),
  'jobs', (select coalesce(json_agg(json_build_object('id', sj.id, 'job_type', sj.job_type, 'status', sj.status)
    order by sj.job_type), '[]'::json) from public.service_jobs sj where sj.reservation_id = '${RESERVATION_ID}'),
  'outbox_count', (select count(*) from public.outbox_events oe where oe.aggregate_type = 'reservation'
    and oe.aggregate_id = '${RESERVATION_ID}' and oe.event_type = 'reservation.confirmed'),
  'allocation_count_for_machine', (select count(*) from public.allocations a where a.machine_id = '${MACHINE_ID}')
)::text;
`;

let assertionCount = 0;
function check(condition: unknown, message: string) {
  assertionCount += 1;
  assert(condition, message);
}

function checkSuccessSnapshot(snapshot: Record<string, unknown>, paidAt?: unknown) {
  const reservation = snapshot.reservation as Record<string, unknown> | null;
  const attempt = snapshot.attempt as Record<string, unknown> | null;
  const allocations = snapshot.allocations as Array<Record<string, unknown>>;
  const events = snapshot.events as Array<Record<string, unknown>>;
  const jobs = snapshot.jobs as Array<Record<string, unknown>>;

  assert(reservation !== null, "reservation snapshot is missing");
  assert(attempt !== null, "payment-attempt snapshot is missing");

  check(reservation.id === RESERVATION_ID && reservation.status === "confirmed", "reservation is confirmed");
  check(reservation.payment_status === "paid", "reservation payment status is paid");
  check(attempt.id === ATTEMPT_ID && attempt.status === "paid" && Boolean(attempt.paid_at), "payment attempt is paid with paid_at");
  check(attempt.provider_checkout_session_id === SESSION_ID, "Checkout Session ID is preserved");
  check(attempt.provider_payment_intent_id === PAYMENT_INTENT_ID, "fake PaymentIntent ID is persisted");
  check(attempt.currency === "EUR" && Number(attempt.amount) === Number(reservation.total_amount), "attempt amount and EUR currency match the reservation");
  check(allocations.length === 1 && allocations[0].id === ALLOCATION_ID && allocations[0].machine_id === MACHINE_ID, "exact fixture allocation remains the only machine allocation");
  check(allocations[0].status === "reserved" && allocations[0].hold_expires_at === null, "allocation is reserved and hold expiry is cleared");
  check(events.length === 1, "exactly one durable provider event exists");
  const event = events[0];
  check(typeof event.id === "string" && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(event.id) && event.id !== EVENT_ID, "internal provider-event UUID is distinct from the external event ID");
  check(event.provider_event_id === EVENT_ID && event.organisation_id === reservation.organisation_id && event.payment_attempt_id === ATTEMPT_ID, "provider event links to the fixture organisation and attempt");
  check(Boolean(event.matched_at), "provider event has a durable match marker");
  check(event.status === "processed" && Boolean(event.processed_at), "provider event is processed");
  check(jobs.length === 2 && jobs[0].job_type === "collection" && jobs[1].job_type === "delivery", "exact delivery and collection job pair remains");
  check(jobs.every((job) => job.status === "scheduled"), "both service jobs remain scheduled");
  check(Number(snapshot.outbox_count) === 1, "exactly one reservation.confirmed outbox event exists");
  check(Number(snapshot.allocation_count_for_machine) === 1, "no duplicate machine allocation was created");
  if (paidAt !== undefined) check(attempt.paid_at === paidAt, "replay preserves paid_at exactly");
}

async function stripeSignature(body: Uint8Array, secret: string, timestamp: number): Promise<string> {
  const prefix = new TextEncoder().encode(`${timestamp}.`);
  const signedBytes = new Uint8Array(prefix.length + body.length);
  signedBytes.set(prefix);
  signedBytes.set(body, prefix.length);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, signedBytes));
  const hex = Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `t=${timestamp},v1=${hex}`;
}

async function signedRequest(body: Uint8Array, secret: string): Promise<Response> {
  const timestamp = Math.floor(Date.now() / 1000);
  const requestBody = new ArrayBuffer(body.byteLength);
  new Uint8Array(requestBody).set(body);
  return await fetch(API_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": await stripeSignature(body, secret, timestamp),
    },
    body: requestBody,
    signal: AbortSignal.timeout(15_000),
  });
}

Deno.test("P3E3D guards reject non-loopback and live-mode inputs", () => {
  for (const target of [
    "https://127.0.0.1:54321/functions/v1/stripe-webhook",
    "http://example.test:54321/functions/v1/stripe-webhook",
    "http://localhost:54322/functions/v1/stripe-webhook",
    "http://127.0.0.1:54321/functions/v1/stripe-webhook?url=https://example.test",
  ]) {
    let rejected = false;
    try {
      requireLoopbackEndpoint(target);
    } catch {
      rejected = true;
    }
    assert(rejected, `unsafe endpoint was accepted: ${target}`);
  }

  let liveModeRejected = false;
  try {
    requireTestLivemode(true);
  } catch {
    liveModeRejected = true;
  }
  assert(liveModeRejected, "livemode=true was accepted");

  for (const value of [undefined, "whsec_live_looks_real", "short"]) {
    let secretRejected = false;
    try {
      requireFakeWebhookSecret(value);
    } catch {
      secretRejected = true;
    }
    assert(secretRejected, "missing or non-local fake webhook secret was accepted");
  }
});

Deno.test("P3E3D exact raw-body HMAC passes the production verifier", async () => {
  const secret = `${WEBHOOK_SECRET_PREFIX}${"a".repeat(32)}`;
  const timestamp = Math.floor(Date.now() / 1000);
  const rawBody = new TextEncoder().encode('{"id":"evt_local_signature","spaced": true}');
  const header = await stripeSignature(rawBody, secret, timestamp);
  const accepted = await verifyStripeSignature(rawBody, header, secret, new Date(timestamp * 1000));
  assert(accepted.ok, "the real signature verifier rejected the generated exact-body signature");

  const reformattedBody = new TextEncoder().encode('{"id":"evt_local_signature","spaced":true}');
  const rejected = await verifyStripeSignature(reformattedBody, header, secret, new Date(timestamp * 1000));
  assert(!rejected.ok && rejected.reason === "invalid_signature", "signature unexpectedly survived raw-body reformatting");
});

Deno.test({
  name: "P3E3D local signed Stripe webhook success and exact-event replay",
  ignore: !optedIn,
  async fn() {
    requireLoopbackEndpoint(API_ENDPOINT);
    for (const proxyName of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) {
      assert(!(Deno.env.get(proxyName)?.trim()), `proxy environment ${proxyName} must be unset for loopback-only HTTP`);
    }
    const secret = requireFakeWebhookSecret(Deno.env.get("STRIPE_WEBHOOK_SECRET"));
    requireTestLivemode(false);
    const { databaseName } = await inspectLocalContainers(secret);

    const readiness = await fetch(API_ENDPOINT, { method: "GET", signal: AbortSignal.timeout(10_000) });
    assertEquals(readiness.status, 405, "local webhook GET readiness response");
    await readiness.body?.cancel();

    let fixtureCreated = false;
    assertionCount = 0;
    try {
      await runFixture(databaseName, false);
      fixtureCreated = true;

      const event = {
        id: EVENT_ID,
        type: "checkout.session.completed",
        created: Math.floor(Date.now() / 1000),
        livemode: false,
        data: {
          object: {
            object: "checkout.session",
            id: SESSION_ID,
            mode: "payment",
            status: "complete",
            payment_status: "paid",
            amount_total: 7500,
            currency: "eur",
            payment_intent: PAYMENT_INTENT_ID,
            client_reference_id: ATTEMPT_ID,
            metadata: { payment_attempt_id: ATTEMPT_ID, reservation_id: RESERVATION_ID },
          },
        },
      };
      const rawBody = new TextEncoder().encode(JSON.stringify(event));

      const firstResponse = await signedRequest(rawBody, secret);
      const firstResponseText = await firstResponse.text();
      assertEquals(firstResponse.status, 200, "first signed webhook response status");
      assertEquals(firstResponseText, '{"received":true}', "first signed webhook sanitized response");
      const firstSnapshot = await runQuery(databaseName, SNAPSHOT_QUERY);
      checkSuccessSnapshot(firstSnapshot);
      const firstAttempt = firstSnapshot.attempt as Record<string, unknown>;
      const firstPaidAt = firstAttempt.paid_at;

      const replayResponse = await signedRequest(rawBody, secret);
      const replayResponseText = await replayResponse.text();
      assertEquals(replayResponse.status, 200, "exact-event replay response status");
      assertEquals(replayResponseText, '{"received":true}', "exact-event replay sanitized response");
      const replaySnapshot = await runQuery(databaseName, SNAPSHOT_QUERY);
      checkSuccessSnapshot(replaySnapshot, firstPaidAt);

      console.log(`P3E3D local endpoint: ${API_ENDPOINT}`);
      console.log(`P3E3D local success + exact replay: PASS (${assertionCount} state assertions)`);
      console.log(`P3E3D fake IDs: ${EVENT_ID}, ${SESSION_ID}, ${PAYMENT_INTENT_ID}`);
    } finally {
      if (fixtureCreated) {
        await runFixture(databaseName, true);
        const leftovers = await runQuery(databaseName, `
          select json_build_object(
            'reservation', (select count(*) from public.reservations where id = '${RESERVATION_ID}'),
            'attempt', (select count(*) from public.payment_attempts where id = '${ATTEMPT_ID}'),
            'customer', (select count(*) from public.customers where id = '${CUSTOMER_ID}'),
            'machine', (select count(*) from public.physical_machines where id = '${MACHINE_ID}'),
            'allocation', (select count(*) from public.allocations where id = '${ALLOCATION_ID}'),
            'jobs', (select count(*) from public.service_jobs where id in ('${DELIVERY_JOB_ID}', '${COLLECTION_JOB_ID}')),
            'event', (select count(*) from public.payment_provider_events where provider='stripe' and provider_event_id='${EVENT_ID}'),
            'outbox', (select count(*) from public.outbox_events where aggregate_type='reservation' and aggregate_id='${RESERVATION_ID}' and event_type='reservation.confirmed')
          )::text;
        `);
        assertEquals(JSON.stringify(leftovers), JSON.stringify({
          reservation: 0,
          attempt: 0,
          customer: 0,
          machine: 0,
          allocation: 0,
          jobs: 0,
          event: 0,
          outbox: 0,
        }), "targeted fixture cleanup verification");
        console.log("P3E3D targeted fixture cleanup: PASS");
      }
    }
  },
});
