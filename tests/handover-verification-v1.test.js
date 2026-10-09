const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "assets/js/handover-verification.js"), "utf8");
const html = fs.readFileSync(path.join(root, "admin/index.html"), "utf8");

class Element {
  constructor(tag = "div") { this.tagName = tag; this.hidden = false; this.value = ""; this.textContent = ""; this.dataset = {}; this.listeners = new Map(); this.children = []; this.disabled = false; this.srcObject = null; this.files = []; this.attributes = {}; this.className = ""; }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  emit(name, event = {}) { return this.listeners.get(name)?.(event); }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  append(node) { this.children.push(node); }
  setAttribute(name, value) { this.attributes[name] = value; }
  focus() { this.focused = true; }
  pause() {}
  async play() {}
  querySelectorAll() { return []; }
  getContext() { return { scale() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, clearRect() {} }; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 560, height: 180 }; }
  setPointerCapture() {}
  toBlob(callback) { callback({ type: "image/png", size: 100 }); }
}

const serviceJobId = "00000000-0000-4000-8000-00000000e851";
const requestId = "00000000-0000-4000-8000-00000000e861";
const idempotencyKey = "00000000-0000-4000-8000-00000000e862";
const handoverContext = (confirmed = false) => ({
  serviceJobId, reservationId: "reservation-1", reservationReference: "AB12CD34", jobStatus: confirmed ? "completed" : "handover_in_progress",
  jobVersion: 4, scheduledDate: "2026-10-09", timeSlot: "08:00–10:00", address: { line1: "Test Road", postcode: "16000", city: "Angouleme" },
  reservationStatus: confirmed ? "ongoing" : "confirmed", paymentStatus: "paid", inspection: { id: "inspection-1", status: confirmed ? "completed" : "draft", summaryNote: "", subjects: confirmed ? [] : [{ subjectId: "subject-1", reservationItemId: "item-1", machineId: "machine-1", productName: "Air unit", serialNumber: "SER-1", condition: null, checklist: [], equipmentVerified: false, photoAttached: false }] },
  handover: confirmed ? { id: "handover-1", status: "confirmed", idempotencyKey, signedName: "Synthetic Customer", signatureAttached: true } : null
});

function setup({ auth = {}, mediaDevices, BarcodeDetector, randomUUID = () => requestId } = {}) {
  const ids = ["ops-jobs", "handover-panel", "handover-status", "handover-code", "handover-video", "handover-result", "handover-scan", "handover-submit", "handover-job-summary", "handover-close", "handover-code-form"];
  const nodes = new Map(ids.map((id) => [id, new Element()]));
  const doc = { getElementById: (id) => nodes.get(id) || null, createElement: (tag) => new Element(tag) };
  const context = vm.createContext({ setTimeout, clearTimeout, Promise, Uint8Array });
  context.window = context; context.navigator = mediaDevices ? { mediaDevices } : {};
  context.crypto = { randomUUID }; context.BarcodeDetector = BarcodeDetector; context.devicePixelRatio = 1; context.addEventListener = () => {};
  vm.runInContext(source, context, { filename: "handover-verification.js" });
  const controller = context.IGLOUE_HANDOVER_VERIFICATION.createController(auth, doc, { randomUUID });
  controller.init();
  return { controller, nodes, context };
}

const job = { type: "delivery", serviceJobId, status: "arrived", state: "due_now", reservationReference: "AB12CD34", scheduledDate: "2026-10-09" };
const verified = { ok: true, data: { request_id: requestId, reservation_reference: "AB12CD34", schedule: { date: "2026-10-09", time_slot: "08:00–10:00", status: "arrived" }, equipment: [{ product_name: "Air unit", serial_number: "SER-1" }] } };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function run() {
  assert.equal(setup().controller.canVerifyDelivery(job), true, "arrived delivery is eligible");
  for (const invalid of [
    { ...job, type: "collection" }, { ...job, status: "assigned" }, { ...job, status: "scheduled" }, { ...job, state: "completed" }, { ...job, serviceJobId: "bad" }
  ]) assert.equal(setup().controller.canVerifyDelivery(invalid), false, "ineligible delivery is hidden");

  const calls = [];
  const mockAuth = {
    async getDeliveryHandover(id) { calls.push(["get", id]); return { ok: true, data: handoverContext() }; },
    async verifyCustomerHandover(request) { calls.push(["verify", request]); return verified; },
    async prepareDeliveryHandover(...args) { calls.push(["prepare", ...args]); return { ok: true, data: { status: "in_progress" } }; }
  };
  const manual = setup({ auth: mockAuth });
  assert.equal(await manual.controller.open(job), true);
  manual.nodes.get("handover-code").value = "12345678";
  let prevented = false;
  manual.nodes.get("handover-code-form").emit("submit", { preventDefault() { prevented = true; } });
  await tick();
  assert.equal(prevented, true);
  assert.equal(manual.nodes.get("handover-code").value, "", "numeric credential clears immediately");
  assert.equal(calls.find((call) => call[0] === "verify")[1].credentialType, "numeric_code");
  assert.equal(calls.find((call) => call[0] === "prepare")[1], serviceJobId);
  assert.equal(calls.find((call) => call[0] === "prepare")[2], requestId, "prepare is bound to the successful verification audit request");
  assert.equal(manual.nodes.get("handover-status").dataset.state, "success");
  assert.match(manual.nodes.get("handover-result").children.map((x) => x.textContent).join(" "), /Remise de l’équipement/);
  assert.equal(JSON.stringify(manual.nodes.get("handover-result")).includes("12345678"), false, "credential is not rendered or retained in UI content");
  manual.nodes.get("handover-code").value = "87654321";
  manual.controller.close();
  assert.equal(manual.nodes.get("handover-code").value, "", "closing the panel clears the credential input");
  assert.equal(manual.nodes.get("handover-panel").hidden, true);

  for (const [httpStatus, expected] of [[401,/session a expiré/],[403,/pas autorisé/],[400,/invalide, expiré/],[422,/invalide, expiré/],[503,/indisponible/],[0,/indisponible/]]) {
    const denied = setup({ auth: { async getDeliveryHandover() { throw new Error("private detail"); }, async verifyCustomerHandover() { return { ok: false, status: httpStatus }; } } });
    await denied.controller.open(job);
    await denied.controller.verify("numeric_code", "12345678");
    assert.match(denied.nodes.get("handover-status").textContent, expected, `HTTP ${httpStatus} receives safe French copy`);
    assert.doesNotMatch(denied.nodes.get("handover-status").textContent, /database|stack|token|private detail/i);
  }

  let stopped = 0; const track = { stop() { stopped += 1; } };
  const qrCalls = [];
  class Detector { async detect() { return [{ rawValue: `hv1.${"Q".repeat(43)}` }]; } }
  const qr = setup({ auth: { ...mockAuth, async verifyCustomerHandover(request) { qrCalls.push(request); return verified; } }, mediaDevices: { async getUserMedia() { return { getTracks: () => [track] }; } }, BarcodeDetector: Detector });
  await qr.controller.open(job); qr.nodes.get("handover-scan").emit("click"); await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(qrCalls.length, 1, "camera starts only after explicit scan action");
  assert.equal(qrCalls[0].credentialType, "qr_token");
  assert.equal(qr.nodes.get("handover-video").srcObject, null, "camera detaches after scan");
  assert.equal(stopped, 1, "camera stream stops after scan");
  qr.controller.close();

  let closeTrackStops = 0; let notifyStream;
  const opened = new Promise((resolve) => { notifyStream = resolve; });
  class EmptyDetector { async detect() { return []; } }
  const closeDuringScan = setup({ auth: mockAuth, mediaDevices: { async getUserMedia() { notifyStream(); return { getTracks: () => [{ stop() { closeTrackStops += 1; } }] }; } }, BarcodeDetector: EmptyDetector });
  await closeDuringScan.controller.open(job); closeDuringScan.nodes.get("handover-scan").emit("click"); await opened; await tick(); closeDuringScan.controller.close();
  assert.equal(closeTrackStops, 1, "closing the panel stops the camera stream");
  assert.equal(closeDuringScan.nodes.get("handover-video").srcObject, null);

  const unsupported = setup(); await unsupported.controller.open(job); unsupported.nodes.get("handover-scan").emit("click"); await tick();
  assert.match(unsupported.nodes.get("handover-status").textContent, /saisie manuelle/);
  let permissionError = new Error("private detail"); permissionError.name = "NotAllowedError";
  const cameraDenied = setup({ mediaDevices: { async getUserMedia() { throw permissionError; } }, BarcodeDetector: Detector });
  await cameraDenied.controller.open(job); cameraDenied.nodes.get("handover-scan").emit("click"); await tick();
  assert.match(cameraDenied.nodes.get("handover-status").textContent, /accès à la caméra refusé/i);
  assert.doesNotMatch(cameraDenied.nodes.get("handover-status").textContent, /private detail/);

  assert.match(source, /getUserMedia\(/, "camera access is behind an explicit button event");
  assert.match(source, /uploadDeliveryEvidence/, "photos and signatures use the existing private storage client");
  assert.match(source, /confirmDeliveryHandover/, "completion uses the backend confirmation RPC");
  assert.match(source, /pointerdown/, "signature capture supports touch input");
  assert.match(html, /handover-verification\.js/);
  assert.doesNotMatch(source + html, /localStorage|sessionStorage|console\.(?:log|warn|error)/);
  console.log("Online handover UI tests passed (eligibility, numeric/QR verification, resumable preparation, safe errors, camera cleanup, and credential clearing).");
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
