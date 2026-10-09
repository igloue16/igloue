const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "assets/js/handover-verification.js"), "utf8");
const html = fs.readFileSync(path.join(root, "admin/index.html"), "utf8");

class Element {
  constructor() { this.hidden = false; this.value = ""; this.textContent = ""; this.dataset = {}; this.listeners = new Map(); this.children = []; this.disabled = false; this.srcObject = null; }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  emit(name, event = {}) { return this.listeners.get(name)?.(event); }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  append(node) { this.children.push(node); }
  focus() { this.focused = true; }
  pause() {}
  async play() {}
}

function setup({ auth, mediaDevices, BarcodeDetector, randomUUID } = {}) {
  const ids = ["ops-jobs", "handover-panel", "handover-status", "handover-code", "handover-video", "handover-result", "handover-scan", "handover-submit", "handover-job-summary", "handover-close", "handover-code-form"];
  const nodes = new Map(ids.map((id) => [id, new Element()]));
  const doc = { getElementById: (id) => nodes.get(id) || null, createElement: () => new Element() };
  const context = vm.createContext({ setTimeout, clearTimeout, Promise });
  context.window = context;
  context.navigator = mediaDevices ? { mediaDevices } : {};
  context.crypto = { randomUUID: randomUUID || (() => "00000000-0000-4000-8000-00000000e861") };
  context.BarcodeDetector = BarcodeDetector;
  context.addEventListener = () => {};
  vm.runInContext(source, context, { filename: "handover-verification.js" });
  const controller = context.IGLOUE_HANDOVER_VERIFICATION.createController(auth, doc);
  controller.init();
  return { controller, nodes, context };
}

const job = { type: "delivery", serviceJobId: "00000000-0000-4000-8000-00000000e851", status: "assigned", state: "upcoming", reservationReference: "AB12CD34", scheduledDate: "2026-10-09" };
const success = { ok: true, data: { reservation_reference: "AB12CD34", schedule: { date: "2026-10-09", time_slot: "early", status: "assigned" }, equipment: [{ product_name: "Équipement de test", serial_number: "SER-1" }] } };

async function run() {
  const outcomes = [];
  assert.equal(setup({ auth: {} }).controller.canVerifyDelivery(job), true, "assigned delivery with UUID is eligible");
  for (const invalid of [
    { ...job, type: "collection" }, { ...job, status: "scheduled" }, { ...job, state: "completed" },
    { ...job, serviceJobId: "not-a-uuid" }
  ]) assert.equal(setup({ auth: {} }).controller.canVerifyDelivery(invalid), false, "ineligible jobs do not expose verification");

  const calls = [];
  const manual = setup({ auth: { async verifyCustomerHandover(request) { calls.push(request); return success; } } });
  assert.equal(manual.controller.open(job), true);
  manual.nodes.get("handover-code").value = "12345678";
  let prevented = false;
  manual.nodes.get("handover-code-form").emit("submit", { preventDefault() { prevented = true; } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(prevented, true);
  assert.equal(manual.nodes.get("handover-code").value, "", "numeric credential is cleared immediately and after request");
  assert.equal(calls[0].credentialType, "numeric_code");
  assert.equal(calls[0].serviceJobId, job.serviceJobId);
  assert.equal(calls[0].requestId, "00000000-0000-4000-8000-00000000e861");
  assert.equal(manual.nodes.get("handover-status").dataset.state, "success");
  assert.match(manual.nodes.get("handover-result").children[0].textContent, /Client vérifié/);
  manual.nodes.get("handover-code").value = "87654321";
  manual.controller.close();
  assert.equal(manual.nodes.get("handover-code").value, "", "closing the panel clears credentials");
  assert.equal(manual.nodes.get("handover-panel").hidden, true);

  for (const [httpStatus, expected] of [
    [401, /session a expiré/], [403, /pas autorisé/], [400, /invalide, expiré/], [422, /invalide, expiré/], [503, /indisponible/], [0, /indisponible/]
  ]) {
    const denied = setup({ auth: { async verifyCustomerHandover() { return { ok: false, status: httpStatus }; } } });
    denied.controller.open(job);
    await denied.controller.verify("numeric_code", "12345678");
    assert.match(denied.nodes.get("handover-status").textContent, expected, `HTTP ${httpStatus} receives safe French copy`);
    assert.doesNotMatch(denied.nodes.get("handover-status").textContent, /database|stack|token/i);
    outcomes.push(httpStatus);
  }

  let stopCount = 0;
  const qrToken = `hv1.${"Q".repeat(43)}`;
  const track = { stop() { stopCount += 1; } };
  const qrCalls = [];
  class Detector { async detect() { return [{ rawValue: qrToken }]; } }
  const qr = setup({
    auth: { async verifyCustomerHandover(request) { qrCalls.push(request); return success; } },
    mediaDevices: { async getUserMedia() { return { getTracks: () => [track] }; } }, BarcodeDetector: Detector
  });
  qr.controller.open(job);
  qr.nodes.get("handover-scan").emit("click");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(qrCalls.length, 1, "explicit scan action submits scanned QR credential");
  assert.equal(qrCalls[0].credentialType, "qr_token");
  assert.equal(qr.nodes.get("handover-video").srcObject, null, "camera stream is detached after scan");
  assert.equal(stopCount, 1, "camera track is stopped after scan");
  qr.controller.close();

  let scanningTrackStops = 0;
  let streamReady;
  const opened = new Promise((resolve) => { streamReady = resolve; });
  class EmptyDetector { async detect() { return []; } }
  const closeDuringScan = setup({
    auth: { async verifyCustomerHandover() { throw new Error("should not submit after close"); } },
    mediaDevices: { async getUserMedia() { const liveTrack = { stop() { scanningTrackStops += 1; } }; const active = { getTracks: () => [liveTrack] }; streamReady(); return active; } },
    BarcodeDetector: EmptyDetector
  });
  closeDuringScan.controller.open(job);
  closeDuringScan.nodes.get("handover-scan").emit("click");
  await opened;
  await new Promise((resolve) => setTimeout(resolve, 0));
  closeDuringScan.controller.close();
  assert.equal(scanningTrackStops, 1, "closing the panel stops an active camera track");
  assert.equal(closeDuringScan.nodes.get("handover-video").srcObject, null, "closing detaches the camera stream");

  const unavailable = setup({ auth: {} });
  unavailable.controller.open(job);
  unavailable.nodes.get("handover-scan").emit("click");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(unavailable.nodes.get("handover-status").textContent, /code à 8 chiffres/);

  let deniedTrackStops = 0;
  const cameraDenied = setup({
    auth: {},
    mediaDevices: { async getUserMedia() { const error = new Error("private detail"); error.name = "NotAllowedError"; throw error; } },
    BarcodeDetector: Detector
  });
  cameraDenied.controller.open(job);
  cameraDenied.nodes.get("handover-scan").emit("click");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(cameraDenied.nodes.get("handover-status").textContent, /caméra refusé/);
  assert.doesNotMatch(cameraDenied.nodes.get("handover-status").textContent, /private detail/);

  assert.match(html, /handover-verification\.js/);
  assert.match(html, /V&#233;rifier la livraison/);
  assert.match(source, /getUserMedia\(/, "camera access is handled in the explicit scan path");
  assert.match(source, /stopCamera\(\)/, "camera cleanup path is present");
  assert.doesNotMatch(source + html, /localStorage|sessionStorage|console\.(?:log|warn|error)/);
  console.log(`Handover verification UI tests passed (QR, numeric, eligibility, safe errors, camera cleanup; statuses ${outcomes.join(", ")}).`);
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
