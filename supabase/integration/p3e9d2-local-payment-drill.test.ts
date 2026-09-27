import { handleCheckoutRequest } from "../functions/create-checkout-session/handler.ts";
import type { CheckoutAdapter, CheckoutRequest } from "../functions/create-checkout-session/stripe.ts";
import { handleProcessOutboxRequest } from "../functions/process-outbox/handler.ts";
import type { WorkerDependencies, ClaimedOutboxEvent, ReservationLoadResult } from "../functions/process-outbox/worker.ts";
import { createPaymentOperatorDependencies, handlePaymentOperatorRequest } from "../functions/payment-operator/handler.ts";
import { createExecutionDependencies, handleExecuteRefundRequest } from "../functions/execute-stripe-refund/handler.ts";
import type { StripeRefundAdapter } from "../functions/execute-stripe-refund/stripe.ts";
import { createRecoveryDependencies, createRefundRecoveryDependencies, handleRecoveryRequest } from "../functions/recover-stripe-events/handler.ts";
import { verifyStripeSignature } from "../functions/stripe-webhook/signature.ts";

const API = "http://127.0.0.1:54321";
const DB = "supabase_db_igloue";
const EDGE = "supabase_edge_runtime_igloue";
const MACHINE_IDS = ["P3E9D2-LOCAL-E01", "P3E9D2-LOCAL-E02", "P3E9D2-LOCAL-E03"];
const SESSION_ID = "cs_local_p3e9d2_fake_001";
const PI_ID = "pi_local_p3e9d2_fake_001";
const optedIn = Deno.env.get("P3E9D2_LOCAL_E2E") === "1";
let assertions = 0;
let deliveries = 0;
let reservationIds: string[] = [];
let customerIds: string[] = [];
let machinesAdded = false;
let outboxDiagnostic = "";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function check(value: unknown, message: string) {
  assertions++;
  assert(value, message);
}
function env(name: string): string {
  const value = Deno.env.get(name)?.trim();
  assert(value, "Missing required local test environment: " + name);
  return value;
}
function q(value: string): string {
  return "'" + value.replaceAll("'", "''") + "'";
}
async function docker(args: string[], input?: string): Promise<string> {
  const child = new Deno.Command("docker.exe", {
    args, stdin: input === undefined ? "null" : "piped", stdout: "piped", stderr: "piped",
  }).spawn();
  if (input !== undefined) {
    const writer = child.stdin.getWriter();
    await writer.write(new TextEncoder().encode(input));
    await writer.close();
  }
  const result = await child.output();
  assert(result.success, "Local Docker operation failed: " + new TextDecoder().decode(result.stderr).trim().slice(0, 600));
  return new TextDecoder().decode(result.stdout).trim();
}
async function sql(statement: string): Promise<string> {
  return await docker(["exec", "-i", DB, "psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-f", "-"], statement);
}
async function json<T>(query: string): Promise<T> {
  return JSON.parse(await sql("select row_to_json(q)::text from (" + query + ") q limit 1;")) as T;
}
async function rpc(name: string, args: Record<string, unknown>) {
  const key = env("LOCAL_SUPABASE_SERVICE_ROLE_KEY");
  const response = await fetch(API + "/rest/v1/rpc/" + name, {
    method: "POST", headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const data = await response.json().catch(() => null);
  return response.ok ? { data, error: null } : { data: null, error: { code: String(response.status) } };
}
async function one<T>(table: string, query: string): Promise<T | null> {
  const key = env("LOCAL_SUPABASE_SERVICE_ROLE_KEY");
  const response = await fetch(API + "/rest/v1/" + table + "?" + query, {
    headers: { apikey: key, Authorization: "Bearer " + key },
  });
  if (!response.ok) throw new Error("Local database read failed with status " + response.status);
  return ((await response.json()) as T[])[0] ?? null;
}
async function guardLocal() {
  check(new URL(API).hostname === "127.0.0.1", "fixed loopback endpoint");
  check(Deno.env.get("STRIPE_EXPECTED_LIVEMODE") === "false", "explicit test livemode");
  check(env("STRIPE_WEBHOOK_SECRET").startsWith("whsec_local_e2e_"), "fake local webhook secret");
  check(env("LOCAL_SUPABASE_PUBLISHABLE_KEY").startsWith("sb_publishable_"), "local publishable key");
  check(env("LOCAL_SUPABASE_SERVICE_ROLE_KEY").startsWith("eyJ"), "local service-role key");
  for (const name of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) {
    check(!Deno.env.get(name)?.trim(), "proxy is unset: " + name);
  }
  const context = JSON.parse(await docker(["context", "inspect"])) as Array<{ Endpoints?: { docker?: { Host?: string } } }>;
  const host = context[0]?.Endpoints?.docker?.Host ?? "";
  check(host.startsWith("npipe://") || host.startsWith("unix://"), "local Docker daemon");
  const containers = JSON.parse(await docker(["inspect", DB, EDGE])) as Array<{
    Name?: string; State?: { Running?: boolean }; Config?: { Image?: string; Labels?: Record<string, string> };
  }>;
  for (const name of [DB, EDGE]) {
    const item = containers.find((entry) => entry.Name?.replace(/^\//, "") === name);
    check(item?.State?.Running === true, name + " running");
    check(item?.Config?.Labels?.["com.supabase.cli.project"] === "igloue", name + " is local igloue project");
  }
  check((containers.find((item) => item.Name?.replace(/^\//, "") === DB)?.Config?.Image ?? "").includes("supabase/postgres"), "expected local Supabase database image");
}
async function setupMachines() {
  const ids = MACHINE_IDS.map(q).join(",");
  const state = await json<{ count: string }>("select count(*)::text as count from public.physical_machines where id in (" + ids + ")");
  assert(state.count === "0", "P3E9D2 machine fixture collision; refusing overwrite");
  await sql("insert into public.physical_machines(id,product_id,serial_number,status,active,current_location,condition) values " +
    MACHINE_IDS.map((id) => "(" + q(id) + ",'essential'," + q(id + "-serial") + ",'available',true,'local-p3e9d2','test-fixture')").join(",") + ";");
  machinesAdded = true;
}
function datePlus(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
async function reserve() {
  const body = {
    idempotencyKey: "p3e9d2-" + crypto.randomUUID(),
    customer: { firstName: "Local", lastName: "P3E9D2", email: "p3e9d2-" + crypto.randomUUID() + "@example.invalid", phone: "0612345678" },
    items: [{ productId: "essential", quantity: 1 }],
    deliveryAddress: { line1: "1 Local Test Street", line2: null, postcode: "16000", city: "Angouleme" },
    rental: { startDate: datePlus(14), endDate: datePlus(21) },
    service: { deliverySlotId: "0830-1030", collectionSlotId: "0830-1030", setupMode: "none", expressSelected: false },
  };
  const response = await fetch(API + "/functions/v1/create-reservation", {
    method: "POST", headers: { apikey: env("LOCAL_SUPABASE_PUBLISHABLE_KEY"), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json() as Record<string, unknown>;
  assert(response.ok && result.ok === true, "real local create-reservation boundary failed with status " + response.status + " " + JSON.stringify(result));
  const reservation = result.reservation as Record<string, unknown>;
  const pricing = result.pricing as Record<string, unknown>;
  assert(typeof reservation.reference === "string" && typeof result.paymentCapability === "string", "reservation ID/capability absent");
  reservationIds.push(reservation.reference);
  const state = await json<{ customer_id: string; organisation_id: string; status: string; payment_status: string; item_count: string; linked_count: string; exact_link: boolean }>(
    "select r.customer_id,r.organisation_id,r.status,r.payment_status,count(distinct ri.id)::text as item_count,count(distinct a.id)::text as linked_count,bool_and(a.reservation_item_id=ri.id) as exact_link from public.reservations r join public.reservation_items ri on ri.reservation_id=r.id join public.allocations a on a.reservation_id=r.id and a.reservation_item_id=ri.id where r.id=" + q(reservation.reference) + "::uuid group by r.id",
  );
  customerIds.push(state.customer_id);
  check(state.status === "pending" && state.payment_status === "not_started", "reservation starts pending/unpaid");
  check(state.item_count === "1" && state.linked_count === "1" && state.exact_link, "normalized item links to exact held allocation");
  check(typeof pricing.totalAmount === "number" && Number(pricing.totalAmount) > 0, "reservation total is server calculated");
  return { id: reservation.reference, org: state.organisation_id, capability: result.paymentCapability as string, amount: Number(pricing.totalAmount) };
}
async function checkout(reservation: Awaited<ReturnType<typeof reserve>>, suffix: string) {
  const sessionId = "cs_local_p3e9d2_" + suffix;
  const paymentIntentId = "pi_localp3e9d2" + suffix.replaceAll("_", "");
  const calls: Array<{ input: CheckoutRequest; key: string }> = [];
  const fake: CheckoutAdapter = { async createCheckoutSession(input, key) {
    calls.push({ input, key });
    return { id: sessionId, url: "https://checkout.stripe.com/c/pay/" + sessionId, paymentIntentId };
  } };
  const response = await handleCheckoutRequest(new Request(API + "/functions/v1/create-checkout-session", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reservationId: reservation.id, paymentCapability: reservation.capability, idempotencyKey: "p3e9d2-checkout-" + reservation.id }),
  }), { supabaseAdmin: { rpc }, stripeAdapter: fake, successUrl: "https://localhost/success", cancelUrl: "https://localhost/cancel" });
  const result = await response.json() as Record<string, unknown>;
  assert(response.ok && result.ok === true, "fake-transport Checkout handler failed with status " + response.status);
  const state = await json<{ attempt_id: string; amount: string; currency: string; checkout_expires_at: string; hold_expires_at: string; session_id: string; pi_id: string }>(
    "select pa.id as attempt_id,pa.amount::text,pa.currency,pa.checkout_expires_at::text,a.hold_expires_at::text,pa.provider_checkout_session_id as session_id,pa.provider_payment_intent_id as pi_id from public.payment_attempts pa join public.allocations a on a.reservation_id=pa.reservation_id where pa.reservation_id=" + q(reservation.id) + "::uuid",
  );
  check(calls.length === 1, "one injected fake Stripe call");
  check(calls[0].input.amount === reservation.amount && calls[0].input.currency === "EUR", "fake Stripe received DB-authoritative amount and EUR");
  check(state.session_id === sessionId && state.pi_id === paymentIntentId, "Checkout and PaymentIntent IDs persisted");
  check(state.currency === "EUR" && Number(state.amount) === reservation.amount, "payment attempt amount/currency are authoritative");
  check(Math.ceil(Date.parse(state.checkout_expires_at) / 1000) === calls[0].input.expiresAt, "explicit checkout expiry persisted");
  check(Date.parse(state.hold_expires_at) >= Date.parse(state.checkout_expires_at), "allocation hold extends through checkout expiry");
  const eligible = await rpc("prepare_reservation_payment_checkout", { p_payment_attempt_id: state.attempt_id, p_organisation_id: reservation.org });
  const row = Array.isArray(eligible.data) ? eligible.data[0] : null;
  check(!eligible.error && row?.eligible === true, "local checkout eligibility RPC returns true");
  return { attempt: state.attempt_id, sessionId, paymentIntentId };
}
async function signedWebhook(reservationId: string, attemptId: string, eventId: string, sessionId: string, paymentIntentId: string) {
  const amount = await json<{ cents: number }>("select (amount*100)::integer as cents from public.payment_attempts where id=" + q(attemptId) + "::uuid");
  const event = {
    id: eventId, type: "checkout.session.completed", created: Math.floor(Date.now() / 1000), livemode: false,
    data: { object: { object: "checkout.session", id: sessionId, mode: "payment", status: "complete", payment_status: "paid",
      amount_total: amount.cents, currency: "eur", payment_intent: paymentIntentId, client_reference_id: attemptId,
      metadata: { payment_attempt_id: attemptId, reservation_id: reservationId } } },
  };
  const raw = new TextEncoder().encode(JSON.stringify(event));
  const timestamp = Math.floor(Date.now() / 1000);
  const prefix = new TextEncoder().encode(String(timestamp) + ".");
  const signed = new Uint8Array(prefix.length + raw.length);
  signed.set(prefix);
  signed.set(raw, prefix.length);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env("STRIPE_WEBHOOK_SECRET")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, signed));
  const signature = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  check((await verifyStripeSignature(raw, "t=" + timestamp + ",v1=" + signature, env("STRIPE_WEBHOOK_SECRET"), new Date())).ok, "signature accepted by production verifier");
  return await fetch(API + "/functions/v1/stripe-webhook", {
    method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": "t=" + timestamp + ",v1=" + signature }, body: raw,
  });
}
async function signedRefundWebhook(eventId: string, providerRefundId: string, paymentIntentId: string, amountCents: number) {
  const event = { id: eventId, type: "refund.updated", created: Math.floor(Date.now() / 1000), livemode: false,
    data: { object: { object: "refund", id: providerRefundId, payment_intent: paymentIntentId, amount: amountCents, currency: "eur", status: "succeeded" } } };
  const raw = new TextEncoder().encode(JSON.stringify(event));
  const timestamp = Math.floor(Date.now() / 1000);
  const prefix = new TextEncoder().encode(String(timestamp) + ".");
  const signed = new Uint8Array(prefix.length + raw.length);
  signed.set(prefix); signed.set(raw, prefix.length);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env("STRIPE_WEBHOOK_SECRET")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, signed));
  const signature = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return await fetch(API + "/functions/v1/stripe-webhook", { method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": "t=" + timestamp + ",v1=" + signature }, body: raw });
}
async function cleanup() {
  if (reservationIds.length) {
    const ids = reservationIds.map((id) => q(id) + "::uuid").join(",");
    await sql("begin; alter table public.payment_refund_attempts disable trigger payment_refund_attempts_append_only; alter table public.payment_refund_history disable trigger payment_refund_history_append_only; alter table public.payment_exception_history disable trigger payment_exception_history_append_only;" +
      " delete from public.payment_refund_provider_events where receipt_event_id in (select id from public.payment_provider_events where provider_event_id like 'evt_localp3e9d2refund%' or payment_attempt_id in (select id from public.payment_attempts where reservation_id in (" + ids + ")));" +
      " delete from public.payment_refund_attempts where refund_id in (select id from public.payment_refunds where reservation_id in (" + ids + "));" +
      " delete from public.payment_refund_history where reservation_id in (" + ids + "); delete from public.payment_refunds where reservation_id in (" + ids + ");" +
      " delete from public.payment_exception_history where reservation_id in (" + ids + "); delete from public.payment_exceptions where reservation_id in (" + ids + ");" +
      " delete from public.outbox_events where aggregate_type='reservation' and aggregate_id in (" + ids + ");" +
      " delete from public.payment_provider_events where provider_event_id like 'evt_localp3e9d2refund%' or payment_attempt_id in (select id from public.payment_attempts where reservation_id in (" + ids + "));" +
      " delete from public.payment_attempts where reservation_id in (" + ids + ");" +
      " delete from public.reservation_payment_capabilities where reservation_id in (" + ids + "); delete from public.reservation_billing_details where reservation_id in (" + ids + ");" +
      " delete from public.reservation_security_tokens where reservation_id in (" + ids + "); delete from public.service_jobs where reservation_id in (" + ids + ");" +
      " delete from public.allocations where reservation_id in (" + ids + "); delete from public.reservation_items where reservation_id in (" + ids + ");" +
      " delete from public.reservations where id in (" + ids + ");" +
      " delete from public.customers where id in (" + customerIds.map((id) => q(id) + "::uuid").join(",") + ");" +
      " alter table public.payment_refund_attempts enable trigger payment_refund_attempts_append_only; alter table public.payment_refund_history enable trigger payment_refund_history_append_only; alter table public.payment_exception_history enable trigger payment_exception_history_append_only; commit;");
  }
  if (machinesAdded) await sql("delete from public.physical_machines where id in (" + MACHINE_IDS.map(q).join(",") + ");");
}

Deno.test({
  name: "P3E9D2 local reservation, Checkout, signed payment webhook replay, and fake outbox delivery",
  ignore: !optedIn,
  async fn() {
    await guardLocal();
    await setupMachines();
    try {
      const reservation = await reserve();
      const payment = await checkout(reservation, "happy_001");
      const eventId = "evt_local_p3e9d2_" + crypto.randomUUID().replaceAll("-", "");
      const first = await signedWebhook(reservation.id, payment.attempt, eventId, payment.sessionId, payment.paymentIntentId);
      assert(first.status === 200, "real local webhook returned " + first.status);
      const before = await json<{ reservation_status: string; payment_status: string; attempt_status: string; paid_at: string; allocation_status: string; hold_expires_at: string | null; event_status: string; matched: boolean; outbox_count: string }>(
        "select r.status as reservation_status,r.payment_status,pa.status as attempt_status,pa.paid_at::text,a.status as allocation_status,a.hold_expires_at::text,pe.status as event_status,(pe.matched_at is not null) as matched,(select count(*)::text from public.outbox_events o where o.aggregate_type='reservation' and o.aggregate_id=r.id and o.event_type='reservation.confirmed') as outbox_count from public.reservations r join public.payment_attempts pa on pa.reservation_id=r.id join public.allocations a on a.reservation_id=r.id join public.payment_provider_events pe on pe.payment_attempt_id=pa.id where r.id=" + q(reservation.id) + "::uuid and pe.provider_event_id=" + q(eventId),
      );
      check(before.reservation_status === "confirmed" && before.payment_status === "paid", "webhook paid and confirmed reservation");
      check(before.attempt_status === "paid" && Boolean(before.paid_at), "attempt paid_at set");
      check(before.allocation_status === "reserved" && before.hold_expires_at === null, "allocation reserved and hold cleared");
      check(before.event_status === "processed" && before.matched, "provider receipt matched and processed");
      check(before.outbox_count === "1", "one confirmation outbox event");
      const replay = await signedWebhook(reservation.id, payment.attempt, eventId, payment.sessionId, payment.paymentIntentId);
      assert(replay.status === 200, "webhook replay returned " + replay.status);
      const after = await json<{ paid_at: string; outbox_count: string; event_count: string }>(
        "select pa.paid_at::text,(select count(*)::text from public.outbox_events where aggregate_type='reservation' and aggregate_id=r.id and event_type='reservation.confirmed') as outbox_count,(select count(*)::text from public.payment_provider_events where provider='stripe' and provider_event_id=" + q(eventId) + ") as event_count from public.payment_attempts pa join public.reservations r on r.id=pa.reservation_id where r.id=" + q(reservation.id) + "::uuid",
      );
      check(after.paid_at === before.paid_at && after.outbox_count === "1" && after.event_count === "1", "webhook replay preserves timestamp and event counts");

      const deps: WorkerDependencies = {
        async claim(limit): Promise<ClaimedOutboxEvent[]> {
          const recovered = await rpc("recover_stale_outbox_events", { p_limit: 100 });
          assert(!recovered.error, "outbox stale lease recovery RPC");
          const result = await rpc("claim_outbox_events", { p_limit: limit });
          assert(!result.error && Array.isArray(result.data), "outbox claim RPC");
          return result.data as ClaimedOutboxEvent[];
        },
        async loadReservation(event): Promise<ReservationLoadResult> {
          try {
            const row = await one<Record<string, unknown>>("reservations",
              "select=id,organisation_id,status,customer_id,product_id,rental_start,rental_end,total_amount,customer:customers!reservations_customer_id_fkey(organisation_id,first_name,last_name,email),product:products!reservations_product_id_fkey(name)&id=eq." + encodeURIComponent(event.aggregate_id));
            outboxDiagnostic = row ? JSON.stringify({ status: row.status, customer: Boolean(row.customer), product: Boolean(row.product) }) : "not_found";
            return row ? { status: "ok", reservation: row as never } : { status: "not_found" };
          } catch (error) {
            outboxDiagnostic = error instanceof Error ? error.message : "read failed";
            throw error;
          }
        },
        async deliver(message) {
          check(message.to.address.endsWith("@example.invalid"), "fake email receives fixture address only");
          deliveries++;
          return { status: "delivered" };
        },
        async complete(eventId, claimToken) {
          const result = await rpc("complete_outbox_event", { p_event_id: eventId, p_claim_token: claimToken });
          return !result.error && (result.data === true || (Array.isArray(result.data) && Object.values(result.data[0] ?? {})[0] === true));
        },
        async retry(eventId, claimToken, delay, code) {
          const result = await rpc("retry_outbox_event", { p_event_id: eventId, p_claim_token: claimToken, p_retry_delay_seconds: delay, p_error_code: code });
          return !result.error && result.data === true;
        },
        async fail(eventId, claimToken, code) {
          const result = await rpc("fail_outbox_event", { p_event_id: eventId, p_claim_token: claimToken, p_error_code: code });
          return !result.error && result.data === true;
        },
      };
      deliveries = 0;
      const processed = await handleProcessOutboxRequest(new Request(API + "/functions/v1/process-outbox", { method: "POST" }), deps);
      const counts = await processed.json() as { ok: boolean; claimed: number; completed: number };
      check(processed.ok && counts.ok && counts.claimed >= 1 && counts.completed >= 1, "outbox claims and completes confirmation " + JSON.stringify({ counts, deliveries, outboxDiagnostic }));
      check(deliveries === 1, "injected fake email delivery occurred once");
      const second = await handleProcessOutboxRequest(new Request(API + "/functions/v1/process-outbox", { method: "POST" }), deps);
      const secondCounts = await second.json() as { ok: boolean; claimed: number };
      check(secondCounts.ok && secondCounts.claimed === 0 && deliveries === 1, "completed event is not redelivered");

      const reviewReservation = await reserve();
      const reviewPayment = await checkout(reviewReservation, "review_002");
      const cancel = await rpc("cancel_reservation", { p_reservation_id: reviewReservation.id });
      check(!cancel.error, "second reservation cancelled through existing lifecycle RPC");
      const reviewEvent = "evt_local_p3e9d2_" + crypto.randomUUID().replaceAll("-", "");
      const reviewWebhook = await signedWebhook(reviewReservation.id, reviewPayment.attempt, reviewEvent, reviewPayment.sessionId, reviewPayment.paymentIntentId);
      check(reviewWebhook.status === 200, "late paid webhook for cancelled hold is acknowledged");
      const reviewState = await json<{ reservation_status: string; payment_status: string; attempt_status: string; allocation_status: string; exception_count: string; unresolved_count: string }>(
        "select r.status as reservation_status,r.payment_status,pa.status as attempt_status,a.status as allocation_status,(select count(*)::text from public.payment_exceptions e where e.payment_attempt_id=pa.id) as exception_count,(select count(*)::text from public.payment_exceptions e where e.payment_attempt_id=pa.id and e.status='unresolved') as unresolved_count from public.reservations r join public.payment_attempts pa on pa.reservation_id=r.id join public.allocations a on a.reservation_id=r.id where r.id=" + q(reviewReservation.id) + "::uuid",
      );
      check(reviewState.reservation_status === "cancelled" && reviewState.payment_status === "requires_review" && reviewState.attempt_status === "requires_review", "unsafe late payment enters requires_review without confirming reservation");
      check(reviewState.allocation_status === "released", "late payment does not resurrect released inventory");
      check(reviewState.exception_count === "1" && reviewState.unresolved_count === "1", "one unresolved payment exception is recorded");

      const serviceKey = env("LOCAL_SUPABASE_SERVICE_ROLE_KEY");
      const operatorDependencies = createPaymentOperatorDependencies({ rpc }, serviceKey);
      const operator = async (body: Record<string, unknown>) => {
        const result = await handlePaymentOperatorRequest(new Request(API + "/functions/v1/payment-operator", {
          method: "POST", headers: { Authorization: "Bearer " + serviceKey, "Content-Type": "application/json" }, body: JSON.stringify(body),
        }), operatorDependencies);
        return { response: result, payload: await result.json() as Record<string, unknown> };
      };
      const listed = await operator({ action: "list", limit: 50 });
      const listedCases = listed.payload.cases as Array<Record<string, unknown>>;
      const caseRow = listedCases.find((item) => item.reservationId === reviewReservation.id);
      check(listed.response.ok && listed.payload.ok === true && Boolean(caseRow), "operator list returns the paid review case");
      const exceptionId = String(caseRow?.exceptionId ?? "");
      const inspected = await operator({ action: "inspect", exceptionId });
      const inspectedCase = inspected.payload.case as Record<string, unknown>;
      check(inspected.payload.ok === true && inspectedCase.paymentStatus === "requires_review" && inspectedCase.reservationId === reviewReservation.id, "operator inspect returns coherent payment case");
      const resolutionKey = crypto.randomUUID();
      const resolutionBody = { action: "resolve", exceptionId, disposition: "refund_required", idempotencyKey: resolutionKey };
      const resolved = await operator(resolutionBody);
      const resolvedAgain = await operator(resolutionBody);
      const resolvedData = resolved.payload.resolution as Record<string, unknown>;
      const replayData = resolvedAgain.payload.resolution as Record<string, unknown>;
      check(resolved.payload.ok === true && resolvedData.outcome === "resolved", "operator resolves to refund_required");
      check(resolvedAgain.payload.ok === true && replayData.outcome === "already_resolved" && replayData.resolvedAt === resolvedData.resolvedAt, "same operator resolution key replays stably");
      const afterResolve = await operator({ action: "list", limit: 50 });
      check(!(afterResolve.payload.cases as Array<Record<string, unknown>>).some((item) => item.exceptionId === exceptionId), "resolved exception leaves unresolved queue");

      const prepKey = crypto.randomUUID();
      const prepared = await operator({ action: "prepare_refund", exceptionId, idempotencyKey: prepKey });
      const refund = prepared.payload.refund as Record<string, unknown>;
      check(prepared.payload.ok === true && refund.outcome === "prepared", "operator prepares one refund obligation");
      const providerCalls: Array<{ input: { paymentIntentId: string; expectedAmount: number; currency: string }; key: string }> = [];
      const fakeRefund: StripeRefundAdapter = { async createFullRefund(input, key) {
        providerCalls.push({ input, key });
        return { id: "re_localp3e9d2success", status: "succeeded", amount: input.expectedAmount, currency: "EUR", paymentIntentId: input.paymentIntentId };
      } };
      const refundResponse = await handleExecuteRefundRequest(new Request(API + "/functions/v1/execute-stripe-refund", {
        method: "POST", headers: { Authorization: "Bearer " + serviceKey, "Content-Type": "application/json" }, body: JSON.stringify({ refundId: refund.refundId }),
      }), createExecutionDependencies({ rpc }, fakeRefund, serviceKey));
      const refundPayload = await refundResponse.json() as Record<string, unknown>;
      check(refundResponse.ok && refundPayload.ok === true && providerCalls.length === 1, "refund executor uses injected fake Stripe only: " + JSON.stringify({ status: refundResponse.status, payload: refundPayload, providerCalls: providerCalls.length }));
      const execution = await json<{ refund_status: string; refund_amount: string; refund_currency: string; attempt_status: string; attempt_amount: string; attempt_currency: string; payment_intent_id: string; reservation_payment_status: string; refunded_at: string | null; reservation_status: string; allocation_status: string }>(
        "select pr.status as refund_status,pr.amount::text as refund_amount,pr.currency as refund_currency,pa.status as attempt_status,pa.amount::text as attempt_amount,pa.currency as attempt_currency,pa.provider_payment_intent_id as payment_intent_id,r.payment_status as reservation_payment_status,pa.refunded_at::text,r.status as reservation_status,a.status as allocation_status from public.payment_refunds pr join public.payment_attempts pa on pa.id=pr.payment_attempt_id join public.reservations r on r.id=pr.reservation_id join public.allocations a on a.reservation_id=r.id where pr.id=" + q(String(refund.refundId)) + "::uuid",
      );
      check(providerCalls[0].input.paymentIntentId === reviewPayment.paymentIntentId && providerCalls[0].input.expectedAmount === Number(execution.attempt_amount) && providerCalls[0].input.currency === "EUR", "refund uses DB-authoritative PaymentIntent, amount, and currency");
      check(providerCalls[0].key === "igloue:refund:" + String(refund.providerAttemptId), "refund idempotency key derives from immutable provider attempt");
      check(execution.refund_status === "succeeded" && execution.attempt_status === "refunded" && Boolean(execution.refunded_at), "refund obligation and payment are finalized: " + JSON.stringify(execution));
      check(execution.reservation_payment_status === "refunded" && execution.reservation_status === "cancelled" && execution.allocation_status === "released", "refund does not change reservation lifecycle or inventory");
      const refundWebhookEvent = "evt_localp3e9d2refund" + crypto.randomUUID().replaceAll("-", "");
      const refundWebhookFirst = await signedRefundWebhook(refundWebhookEvent, "re_localp3e9d2success", reviewPayment.paymentIntentId, Math.round(Number(execution.refund_amount) * 100));
      const refundWebhookDiagnostic = await json<{ receipt: Record<string, unknown> | null; normalized: Record<string, unknown> | null }>(
        "select (select row_to_json(e) from (select provider_event_id,status,last_error_code from public.payment_provider_events where provider_event_id=" + q(refundWebhookEvent) + ") e) as receipt,(select row_to_json(re) from (select processing_status,processing_outcome,processing_error_code,refund_status,provider_refund_id,matched_payment_refund_id from public.payment_refund_provider_events re join public.payment_provider_events pe on pe.id=re.receipt_event_id where pe.provider_event_id=" + q(refundWebhookEvent) + ") re) as normalized",
      );
      let applyDiagnostic = "not_called";
      if (refundWebhookFirst.status !== 200) {
        const receiptId = await json<{ id: string }>("select id::text from public.payment_provider_events where provider_event_id=" + q(refundWebhookEvent));
        const direct = await fetch(API + "/rest/v1/rpc/apply_payment_refund_provider_event", { method: "POST", headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey, "Content-Type": "application/json" }, body: JSON.stringify({ p_event_id: receiptId.id }) });
        applyDiagnostic = direct.status + " " + await direct.text();
      }
      check(refundWebhookFirst.status === 200, "signed successful refund webhook replay is acknowledged: " + refundWebhookFirst.status + " " + await refundWebhookFirst.clone().text() + " " + JSON.stringify(refundWebhookDiagnostic) + " direct_apply=" + applyDiagnostic);
      const refundAfterFirst = await json<{ refund_status: string; attempt_status: string; refunded_at: string; history_count: string }>(
        "select pr.status as refund_status,pa.status as attempt_status,pa.refunded_at::text,(select count(*)::text from public.payment_refund_history h where h.refund_id=pr.id) as history_count from public.payment_refunds pr join public.payment_attempts pa on pa.id=pr.payment_attempt_id where pr.id=" + q(String(refund.refundId)) + "::uuid",
      );
      const refundWebhookReplay = await signedRefundWebhook(refundWebhookEvent, "re_localp3e9d2success", reviewPayment.paymentIntentId, Math.round(Number(execution.refund_amount) * 100));
      check(refundWebhookReplay.status === 200, "exact refund webhook replay is acknowledged");
      const recovery = await handleRecoveryRequest(
        new Request(API + "/functions/v1/recover-stripe-events", { method: "POST" }),
        createRecoveryDependencies({ rpc }, false),
        createRefundRecoveryDependencies({ rpc }, false),
      );
      const recovered = await recovery.json() as { ok: boolean; refunds?: { claimed: number; processed: number } };
      check(recovery.ok && recovered.ok && recovered.refunds?.claimed === 0 && recovered.refunds.processed === 0, "recovery safely leaves the already-finalized webhook receipt unclaimed");
      const refundAfterReplay = await json<{ refund_status: string; attempt_status: string; refunded_at: string; history_count: string }>(
        "select pr.status as refund_status,pa.status as attempt_status,pa.refunded_at::text,(select count(*)::text from public.payment_refund_history h where h.refund_id=pr.id) as history_count from public.payment_refunds pr join public.payment_attempts pa on pa.id=pr.payment_attempt_id where pr.id=" + q(String(refund.refundId)) + "::uuid",
      );
      check(refundAfterReplay.refund_status === "succeeded" && refundAfterReplay.attempt_status === "refunded" && refundAfterReplay.refunded_at === refundAfterFirst.refunded_at && refundAfterReplay.history_count === refundAfterFirst.history_count, "refund webhook replay leaves terminal state, timestamp, and history stable");
    } finally {
      await cleanup();
    }
    console.log("P3E9D2 local drill passed " + assertions + " assertions; no provider or email traffic.");
  },
});
