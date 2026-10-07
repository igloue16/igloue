const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const verification = require("../assets/js/customer-email-verification.js");

async function run() {
  const calls = [];
  let resolveSend;
  const states = [];
  const controller = verification.createController({
    send(payload) { calls.push(payload); return new Promise((resolve) => { resolveSend = resolve; }); },
    onState(state) { states.push(state); }
  });
  const pending = controller.requestCode();
  const duplicate = await controller.requestCode();
  assert.equal(duplicate, false, "double click while pending does not issue another request");
  assert.equal(calls.length, 1);
  assert.equal(controller.state().busy, true);
  resolveSend({ ok: true, status: "code_sent", challengeId: "challenge", expiresInSeconds: 600, resendAfterSeconds: 1 });
  assert.equal(await pending, true);
  assert.match(controller.state().message, /Code envoyé/);
  assert.equal(controller.state().canConfirm, true);
  assert.equal(await controller.confirm("12345"), false, "five digits rejected");
  assert.equal(await controller.confirm("1234567"), false, "seven digits rejected");

  let lastPayload;
  const requestFlow = verification.createController({
    send: async (payload) => {
      if (payload.action === "request") return { ok: true, status: "code_sent", challengeId: "c1", expiresInSeconds: 600, resendAfterSeconds: 60 };
      lastPayload = payload; return { ok: true, verified: true };
    }
  });
  assert.equal(await requestFlow.requestCode(), true);
  assert.equal(await requestFlow.confirm("001234"), true, "leading zero remains part of the OTP string");
  assert.equal(lastPayload.code, "001234");
  assert.equal(requestFlow.state().verified, true, "successful OTP enters the verified state");
  assert.equal(requestFlow.state().challengeId, null);
  assert.doesNotMatch(JSON.stringify(requestFlow.state()), /001234/);
  const otpNodes = { message: {}, requestButton: {}, form: {}, confirmButton: {}, input: { value: "001234" }, verificationContent: {}, nextStage: {}, checkoutButton: {}, checkoutMessage: {}, paymentCapability: "B".repeat(43), holdExpiresAt: "2099-01-01T00:00:00Z" };
  verification.renderVerificationState(requestFlow.state(), otpNodes);
  assert.equal(otpNodes.verificationContent.hidden, true, "successful OTP replaces all verification UI");
  assert.equal(otpNodes.nextStage.hidden, false, "successful OTP reveals the payment-ready state");
  assert.equal(otpNodes.checkoutButton.disabled, false, "successful OTP keeps the manual Checkout fallback usable");

  let ambiguityCalls = 0;
  const ambiguous = verification.createController({
    send: async (payload) => {
      ambiguityCalls++;
      return payload.action === "request"
        ? { ok: false, code: "delivery_status_unknown", challengeId: "pending-challenge" }
        : { ok: true, verified: true };
    }
  });
  assert.equal(await ambiguous.requestCode(), false);
  assert.equal(ambiguityCalls, 1, "ambiguous send does not replay automatically");
  assert.equal(ambiguous.state().challengeId, "pending-challenge", "server-confirmed issued challenge remains usable");
  assert.match(ambiguous.state().message, /Vérifiez votre boîte/);

  const already = verification.createController({ send: async () => ({ ok: true, status: "already_verified" }) });
  assert.equal(await already.requestCode(), true);
  assert.equal(already.state().verified, true);
  assert.match(already.state().message, /déjà vérifiée/);

  for (const code of ["verification_rate_limited", "rate_limited", "verification_code_invalid", "delivery_unavailable", "delivery_status_unknown", "proof_invalid", "server_error"]) {
    const item = verification.createController({ send: async (payload) => payload.action === "request"
      ? { ok: false, code }
      : { ok: true, verified: true } });
    await item.requestCode();
    assert.ok(item.state().message.length > 0, `${code} has safe copy`);
  }
  const gatewayLimited = verification.createController({ send: async () => ({ ok: false, code: "rate_limited", retryAfterSeconds: 60 }) });
  assert.equal(await gatewayLimited.requestCode(), false);
  assert.equal(gatewayLimited.state().canRequest, false, "gateway limit applies a bounded retry cooldown");
  assert.ok(states.some((state) => state.busy), "loading state is observable while a call is pending");
  assert.equal(Object.hasOwn(globalThis, "localStorage"), false, "test has no storage dependency");
  const source = fs.readFileSync(path.join(__dirname, "../assets/js/customer-email-verification.js"), "utf8");
  assert.doesNotMatch(source, /localStorage|console\.(?:log|error)/, "OTP and capability are not persistently stored or logged");
  const savedSession = verification.createSessionRecord("reservation", "capability", "challenge", 1000, "B".repeat(43), "2099-01-01T00:00:00Z");
  assert.deepEqual(Object.keys(savedSession).sort(), ["capability", "challengeId", "expiresAt", "holdExpiresAt", "paymentCapability", "reservationId"]);
  assert.doesNotMatch(JSON.stringify(savedSession), /001234|otp|verification_code/i, "session persistence contains no OTP");
  assert.equal(savedSession.expiresAt, 1000 + 30 * 24 * 60 * 60 * 1000);
  assert.equal(savedSession.paymentCapability, "B".repeat(43), "refresh retains the scoped payment capability");
  assert.match(source, /inputmode="numeric"/);
  assert.match(source, /autocomplete="one-time-code"/);

  const senderCalls = [];
  let senderUrl;
  const send = verification.createApiSender("reservation", "capability", { verificationGatewayUrl: "https://gateway.example.test/customer-email-verification", publishableKey: "sb_publishable_public_key_123456" }, async (url, init) => {
    senderUrl = url;
    senderCalls.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ ok: true, status: "code_sent", challengeId: "challenge", expires_in_seconds: 600, resend_after_seconds: 60 }), { status: 200 });
  });
  await send({ action: "request" });
  assert.equal(senderUrl, "https://gateway.example.test/customer-email-verification");
  assert.equal(senderCalls[0].reservationId, "reservation");
  assert.equal(senderCalls[0].capability, "capability");
  assert.doesNotMatch(JSON.stringify(senderCalls), /code|verification_code/);
  const timeoutSend = verification.createApiSender("r", "c", { verificationGatewayUrl: "https://gateway.example.test/customer-email-verification", publishableKey: "sb_publishable_public_key_123456" }, async () => { throw new DOMException("aborted", "AbortError"); });
  assert.equal((await timeoutSend({ action: "request" })).code, "delivery_status_unknown");
  let directFallbackCalls = 0;
  const noGateway = verification.createApiSender("r", "c", { projectUrl: "https://db.example.test", publishableKey: "sb_publishable_public_key_123456" }, async () => { directFallbackCalls++; });
  assert.equal((await noGateway({ action: "status" })).code, "server_error");
  assert.equal(directFallbackCalls, 0, "missing gateway config fails closed without a direct Supabase fallback");
  assert.doesNotMatch(source, /functions\/v1\/customer-email-verification/);
  assert.doesNotMatch(source, /IGLOUE_VERIFICATION_GATEWAY_SECRET|SUPABASE_SERVICE_ROLE_KEY|sb_secret_/i);
  const statusFlow = verification.createController({ send: async () => ({ ok: true, status: "already_verified" }) });
  assert.equal(await statusFlow.checkStatus(), true);
  assert.equal(statusFlow.state().verified, true, "refresh/status query restores verified state without reissuing a code");
  const nodes = { message: {}, requestButton: {}, form: {}, confirmButton: {}, input: { value: "111111" }, verificationContent: {}, nextStage: {}, checkoutButton: {}, checkoutMessage: {}, paymentCapability: "B".repeat(43), holdExpiresAt: "2099-01-01T00:00:00Z" };
  verification.renderVerificationState(statusFlow.state(), nodes);
  assert.equal(nodes.nextStage.hidden, false, "authoritative verified status opens the next stage after refresh");
  assert.equal(nodes.verificationContent.hidden, true, "verified status completely hides the prior verification form and message");
  assert.equal(nodes.checkoutButton.disabled, false);
  assert.notEqual(nodes.checkoutButton.hidden, true, "the manual Checkout fallback remains visible");
  assert.equal(nodes.input.value, "", "success clears the one-time code");
  assert.match(source, /customer-email-verification__check/, "the verified state includes the success check icon");
  assert.match(source, /Adresse e-mail vérifiée/, "the verified state has its own clear heading");
  const unverified = verification.createController({ send: async () => ({ ok: false, code: "verification_code_invalid" }) });
  await unverified.confirm("123456");
  const failureNodes = { ...nodes, verificationContent: {}, nextStage: {}, checkoutButton: {}, input: { value: "123456" } };
  verification.renderVerificationState(unverified.state(), failureNodes);
  assert.equal(failureNodes.nextStage.hidden, true, "failed verification does not advance");
  const expiredNodes = { ...nodes, verificationContent: {}, nextStage: {}, checkoutButton: {}, checkoutMessage: {}, holdExpiresAt: "2000-01-01T00:00:00Z" };
  verification.renderVerificationState(statusFlow.state(), expiredNodes);
  assert.equal(expiredNodes.checkoutButton.disabled, true, "expired hold cannot start payment");

  let checkoutBody;
  const checkout = await verification.createCheckoutSessionSender(
    "00000000-0000-4000-8000-000000000001", "B".repeat(43),
    { projectUrl: "https://staging.supabase.co/", publishableKey: "sb_publishable_test" },
    async (url, init) => {
      assert.equal(url, "https://staging.supabase.co/functions/v1/create-checkout-session");
      checkoutBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ ok: true, checkout: { url: "https://checkout.stripe.com/c/pay/test" } }), { status: 200 });
    },
  )();
  assert.deepEqual(checkout, { ok: true, url: "https://checkout.stripe.com/c/pay/test" });
  assert.equal(checkoutBody.paymentCapability, "B".repeat(43));
  assert.equal(checkoutBody.idempotencyKey, "reservation-checkout-v1:00000000-0000-4000-8000-000000000001");
  const badCheckout = await verification.createCheckoutSessionSender("00000000-0000-4000-8000-000000000001", "B".repeat(43), { projectUrl: "https://staging.supabase.co", publishableKey: "sb_publishable_test" }, async () => new Response(JSON.stringify({ ok: true, checkout: { url: "https://attacker.example/" } }), { status: 200 }))();
  assert.equal(badCheckout.ok, false, "checkout only redirects to Stripe's hosted checkout");
  let paymentStatusRequest;
  const paymentStatus = await verification.createPaymentStatusSender(
    "00000000-0000-4000-8000-000000000001", "B".repeat(43), "cs_test_123456789",
    { projectUrl: "https://staging.supabase.co/", publishableKey: "sb_publishable_test" },
    async (url, init) => {
      assert.equal(url, "https://staging.supabase.co/functions/v1/customer-payment-status");
      paymentStatusRequest = { body: JSON.parse(init.body), cache: init.cache };
      return new Response(JSON.stringify({ ok: true, state: "pending", amount: 153, currency: "EUR" }), { status: 200 });
    },
  )();
  assert.deepEqual(paymentStatus, { ok: true, state: "pending", amount: 153, currency: "EUR" });
  assert.equal(paymentStatusRequest.body.sessionId, "cs_test_123456789");
  assert.equal(paymentStatusRequest.body.paymentCapability, "B".repeat(43));
  assert.equal(paymentStatusRequest.cache, "no-store");
  let liveStatusCalled = false;
  const liveStatus = await verification.createPaymentStatusSender(
    "00000000-0000-4000-8000-000000000001", "B".repeat(43), "cs_live_123456789",
    { projectUrl: "https://staging.supabase.co", publishableKey: "sb_publishable_test" },
    async () => { liveStatusCalled = true; return new Response(JSON.stringify({ ok: false, error: { code: "INVALID_REQUEST" } }), { status: 400 }); },
  )();
  assert.equal(liveStatus.ok, false, "server rejection of a live Checkout ID remains a non-success response");
  assert.equal(liveStatusCalled, true, "the server is authoritative about whether a Checkout ID belongs to this environment");

  const countdowns = [];
  const scheduled = [];
  let clock = 0;
  let timerId = 0;
  let continued = 0;
  const transition = verification.createAutoCheckoutTransition({
    seconds: 3,
    setTimeoutImpl(callback, delay) {
      const timer = { id: ++timerId, at: clock + delay, callback };
      scheduled.push(timer);
      return timer.id;
    },
    clearTimeoutImpl(id) {
      const index = scheduled.findIndex((timer) => timer.id === id);
      if (index >= 0) scheduled.splice(index, 1);
    },
    onCountdown(seconds) { countdowns.push(seconds); },
    onContinue() { continued += 1; },
  });
  async function advance(ms) {
    const end = clock + ms;
    while (scheduled.length && scheduled[0].at <= end) {
      scheduled.sort((a, b) => a.at - b.at);
      const timer = scheduled.shift();
      clock = timer.at;
      timer.callback();
      await Promise.resolve();
    }
    clock = end;
    await Promise.resolve();
  }
  assert.equal(transition.start(), true);
  assert.deepEqual(countdowns, [3]);
  await advance(2999);
  assert.equal(continued, 0, "automatic Checkout does not begin before the three-second countdown");
  await advance(1);
  assert.equal(continued, 1, "automatic Checkout begins after three seconds");
  assert.deepEqual(countdowns, [3, 2, 1, 0]);

  class FakeElement {
    constructor(tagName) {
      this.tagName = tagName;
      this.children = [];
      this.attributes = {};
      this.hidden = false;
      this.listeners = {};
      this.classes = new Set();
      this.classList = {
        add: (name) => this.classes.add(name),
        remove: (name) => this.classes.delete(name),
      };
    }
    append(...nodes) { this.children.push(...nodes); }
    appendChild(node) { this.children.push(node); return node; }
    replaceChildren(...nodes) { this.children = [...nodes]; }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    focus() {}
  }
  globalThis.document = { createElement: (tag) => new FakeElement(tag) };
  globalThis.location = { search: "?checkout=success&session_id=cs_test_123456789" };
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = () => 1;
  globalThis.clearTimeout = () => {};
  const returnStates = [
    { ok: true, state: "pending", amount: 153, currency: "EUR" },
    { ok: true, state: "confirmed", amount: 153, currency: "EUR" },
  ];
  const returnContainer = new FakeElement("aside");
  returnContainer.appendChild(new FakeElement("old-checkout-content"));
  const returnScreen = verification.renderCheckoutReturn(
    returnContainer,
    { reservationId: "00000000-0000-4000-8000-000000000001", paymentCapability: "B".repeat(43) },
    { projectUrl: "https://staging.supabase.co", publishableKey: "sb_publishable_test" },
    async () => new Response(JSON.stringify({ ok: true, ...returnStates.shift() }), { status: 200 }),
  );
  await new Promise((resolve) => setImmediate(resolve));
  const card = returnContainer.children[0];
  const title = card.children.find((child) => child.tagName === "h2");
  assert.equal(returnContainer.children.length, 1, "return card replaces the previous checkout content");
  assert.match(title.textContent, /Paiement en cours/, "success URL alone stays in the pending state");
  assert.doesNotMatch(title.textContent, /Paiement confirmé/, "URL parameters cannot claim payment success");
  await returnScreen.refresh();
  assert.equal(title.textContent, "Paiement confirmé", "server-confirmed payment changes the confirmation heading");
  assert.equal(card.children.find((child) => child.tagName === "h3").textContent, "Réservation confirmée");
  assert.equal(card.children.find((child) => child.className === "customer-payment-confirmation__summary").children[3].textContent, "153,00 €");
  assert.equal(card.classes.has("is-confirmed"), true);
  globalThis.setTimeout = realSetTimeout;
  globalThis.clearTimeout = realClearTimeout;
  delete globalThis.document;
  delete globalThis.location;
  const css = fs.readFileSync(path.join(__dirname, "../assets/css/reservation-review.css"), "utf8");
  assert.match(css, /customer-payment-confirmation-shell[^}]*place-items:\s*center/s, "confirmation shell centers the opaque card");
  assert.match(css, /customer-payment-confirmation\s*\{[^}]*background:\s*#fff/s, "confirmation card uses an opaque readable surface");
  console.log("Customer email verification frontend tests passed.");
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
