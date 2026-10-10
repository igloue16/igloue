const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "assets/js/handover-verification.js"), "utf8");
const html = fs.readFileSync(path.join(root, "admin/index.html"), "utf8");

class Element {
  constructor(tag = "div") { this.tagName = tag; this.hidden = false; this.value = ""; this.textContent = ""; this.dataset = {}; this.listeners = new Map(); this.children = []; this.disabled = false; this.srcObject = null; this.files = []; this.attributes = {}; this.className = ""; this.parentElement = null; this.type = ""; }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  emit(name, event = {}) { return this.listeners.get(name)?.({ target: this, preventDefault() {}, ...event }); }
  replaceChildren(...nodes) { this.children = []; for (const node of nodes) this.append(node); }
  append(node) { this.children.push(node); if (node && typeof node === "object") node.parentElement = this; }
  setAttribute(name, value) { this.attributes[name] = value; }
  focus() { this.focused = true; }
  pause() {}
  async play() {}
  querySelectorAll(selector) { const all = []; const visit = (node) => { for (const child of node.children || []) { const match = /^\[data-([a-z-]+)\]$/.exec(selector); const dataKey = match && match[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase()); if (match && child.dataset?.[dataKey] !== undefined || selector === ".handover-field-error" && child.className === "handover-field-error" || selector === "[data-machine-id]" && child.dataset?.machineId || selector === "textarea" && child.tagName === "textarea") all.push(child); visit(child); } }; visit(this); return all; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { let node = this; while (node) { if (selector === ".handover-equipment-card" && node.className === "handover-equipment-card") return node; node = node.parentElement; } return null; }
  getContext() { return { scale() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, clearRect() {}, drawImage() {} }; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 560, height: 180 }; }
  setPointerCapture() {}
  toBlob(callback, type = "image/png") { callback({ type, size: 100 }); }
}

const serviceJobId = "00000000-0000-4000-8000-00000000e851";
const requestId = "00000000-0000-4000-8000-00000000e861";
const idempotencyKey = "00000000-0000-4000-8000-00000000e862";
const handoverContext = (confirmed = false, inProgress = false) => ({
  serviceJobId, reservationId: "reservation-1", reservationReference: "AB12CD34", jobStatus: confirmed ? "completed" : "handover_in_progress",
  jobVersion: 4, scheduledDate: "2026-10-09", timeSlot: "08:00–10:00", address: { line1: "Test Road", postcode: "16000", city: "Angouleme" },
  reservationStatus: confirmed ? "ongoing" : "confirmed", paymentStatus: "paid", inspection: { id: "inspection-1", status: confirmed ? "completed" : "draft", summaryNote: "", subjects: confirmed ? [] : [{ subjectId: "subject-1", reservationItemId: "item-1", machineId: "machine-1", productName: "Air unit", serialNumber: "SER-1", condition: null, checklist: [], equipmentVerified: false, photoAttached: false }] },
  handover: confirmed ? { id: "handover-1", status: "confirmed", idempotencyKey, signedName: "Synthetic Customer", signatureAttached: true } : inProgress ? { id: "handover-1", status: "in_progress", idempotencyKey, signatureAttached: false } : null
});

function setup({ auth = {}, mediaDevices, BarcodeDetector, randomUUID = () => requestId, environment = {} } = {}) {
  const ids = ["ops-jobs", "handover-panel", "handover-status", "handover-code", "handover-video", "handover-result", "handover-scan", "handover-submit", "handover-job-summary", "handover-close", "handover-code-form"];
  const nodes = new Map(ids.map((id) => [id, new Element()]));
  const doc = { getElementById: (id) => nodes.get(id) || null, createElement: (tag) => new Element(tag) };
  const context = vm.createContext({ setTimeout, clearTimeout, Promise, Uint8Array });
  context.window = context; context.navigator = mediaDevices ? { mediaDevices } : {};
  context.crypto = { randomUUID }; context.BarcodeDetector = BarcodeDetector; context.devicePixelRatio = 1; context.addEventListener = () => {};
  vm.runInContext(source, context, { filename: "handover-verification.js" });
  const controller = context.IGLOUE_HANDOVER_VERIFICATION.createController(auth, doc, { randomUUID, ...environment });
  controller.init();
  return { controller, nodes, context };
}

const job = { type: "delivery", serviceJobId, status: "arrived", state: "due_now", reservationReference: "AB12CD34", scheduledDate: "2026-10-09" };
const verified = { ok: true, data: { request_id: requestId, reservation_reference: "AB12CD34", schedule: { date: "2026-10-09", time_slot: "08:00–10:00", status: "arrived" }, equipment: [{ product_name: "Air unit", serial_number: "SER-1" }] } };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const find = (node, predicate) => { if (predicate(node)) return node; for (const child of node.children || []) { const found = find(child, predicate); if (found) return found; } return null; };

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
  assert.equal(find(manual.nodes.get("handover-result"), (node) => node.value === "12345678"), null, "credential is not rendered or retained in UI controls");
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

  let verifyAfterLoadFailure = false;
  const resumeFailure = setup({ auth: { async getDeliveryHandover() { throw new Error("offline"); }, async verifyCustomerHandover() { verifyAfterLoadFailure = true; } } });
  await resumeFailure.controller.open(job);
  assert.match(resumeFailure.nodes.get("handover-status").textContent, /remise enregistrée n’a pas pu être chargée/i);
  assert.equal(verifyAfterLoadFailure, false, "failed resume lookup never falls through to fresh customer verification");

  const originalSubject = handoverContext(false, true).inspection.subjects[0];
  originalSubject.checklist = [{ key: "cable", label: "Câble", result: "not_checked" }, { key: "accessory", label: "Accessoire", result: "not_checked" }];
  const inspectContext = handoverContext(false, true); inspectContext.inspection.subjects[0] = originalSubject;
  let inspectionSaves = 0; let inspectionLoads = 0;
  const inspectionUI = setup({ auth: {
    async getDeliveryHandover() { inspectionLoads += 1; return { ok: true, data: inspectContext }; },
    async updateDeliveryInspection() { inspectionSaves += 1; return { ok: true }; }
  } });
  await inspectionUI.controller.open(job);
  const inspectionCard = find(inspectionUI.nodes.get("handover-result"), (node) => node.className === "handover-equipment-card");
  const controls = inspectionCard.querySelectorAll("[data-checklist-key]");
  const conditionControl = find(inspectionCard, (node) => node.dataset?.conditionFor === "subject-1");
  conditionControl.value = "good"; controls[0].value = "pass"; controls[1].value = "pass";
  const saveInspectionButton = find(inspectionCard, (node) => node.tagName === "button" && node.textContent === "Enregistrer le contrôle");
  saveInspectionButton.emit("click"); await tick();
  assert.equal(inspectionSaves, 1);
  assert.equal(inspectionLoads, 1, "saving one subject does not tear down and reload the whole inspection form");
  assert.equal(controls[1].value, "pass", "other inspection fields remain usable after save");

  const mobileFile = { type: "image/heic", size: 15 * 1024 * 1024 };
  let bitmapClosed = false;
  const photoConversion = setup({ environment: { async createImageBitmap() { return { width: 4032, height: 3024, close() { bitmapClosed = true; } }; } } });
  const converted = await photoConversion.controller.normalizePhoto(mobileFile);
  assert.equal(converted.type, "image/jpeg", "mobile HEIC capture is normalized to server-accepted JPEG");
  assert.ok(converted.size <= 9 * 1024 * 1024, "converted image stays below private storage limit");
  assert.equal(bitmapClosed, true, "decoded camera image resources are released");
  await assert.rejects(() => photoConversion.controller.normalizePhoto({ type: "application/pdf", size: 10 }), /photo_type/);
  const noDecoder = setup();
  await assert.rejects(() => noDecoder.controller.normalizePhoto({ type: "image/heic", size: 15 }), /photo_conversion_unavailable/);

  const photoContext = handoverContext(false, true);
  const photoCalls = { upload: [], attach: 0 };
  let uploadAttempt = 0;
  const photoUI = setup({ auth: {
    async getDeliveryHandover() { return { ok: true, data: photoContext }; },
    async getSelectedOrganisation() { return { id: "tenant-1" }; },
    async uploadDeliveryEvidence(request) { photoCalls.upload.push(request); uploadAttempt += 1; return uploadAttempt === 1 ? { ok: false, status: 0 } : { ok: true, data: { fileId: "file-1" } }; },
    async attachDeliveryEvidence() { photoCalls.attach += 1; if (photoCalls.attach === 1) return { ok: false, status: 503 }; photoContext.inspection.subjects[0].photoEvidence = { fileId: "file-1", savedAt: "2026-10-10T10:00:00Z", linkedAt: "2026-10-10T10:00:00Z" }; photoContext.inspection.subjects[0].photoAttached = true; return { ok: true, data: { attached: true, fileId: "file-1" } }; },
    async downloadDeliveryEvidence(fileId) { assert.equal(fileId, "file-1"); return { ok: true, data: { url: "https://signed.invalid/temporary" } }; }
  } });
  await photoUI.controller.open(job);
  const photoCard = find(photoUI.nodes.get("handover-result"), (node) => node.className === "handover-equipment-card");
  const photoInput = find(photoCard, (node) => node.type === "file");
  const photoButton = find(photoCard, (node) => node.tagName === "button" && node.textContent === "Enregistrer la photo");
  photoInput.files = [{ type: "image/jpeg", size: 100, name: "capture.jpg" }]; photoInput.value = "C:\\fakepath\\capture.jpg";
  photoButton.emit("click"); await tick();
  assert.equal(photoInput.value, "C:\\fakepath\\capture.jpg", "failed upload retains selected file for retry");
  assert.match(photoUI.nodes.get("handover-status").textContent, /vérifiez la connexion/i);
  photoButton.emit("click"); await tick();
  assert.equal(photoInput.value, "C:\\fakepath\\capture.jpg", "failed evidence association retains selection and file ID");
  assert.match(photoUI.nodes.get("handover-status").textContent, /pas encore associée/i);
  photoButton.emit("click"); await tick();
  assert.equal(photoCalls.upload.length, 2, "retry after successful upload does not upload a duplicate object");
  assert.equal(photoCalls.upload[0].idempotencyKey, photoCalls.upload[1].idempotencyKey, "unknown upload outcome retries with the same idempotency key");
  assert.equal(photoCalls.attach, 2, "association retries using the previously returned file ID");
  assert.equal(photoInput.value, "", "selection clears only after successful association");
  assert.equal(photoCard.children.some((node) => node.className === "handover-photo-state" && find(node, (child) => child.tagName === "img" && child.src === "https://signed.invalid/temporary")), true, "saved thumbnail reloads through the authorized short-lived download path");
  assert.match(photoUI.nodes.get("handover-status").textContent, /Photo enregistrée côté serveur/);
  const persistedPhotoContext = handoverContext(false, true);
  persistedPhotoContext.inspection.subjects[0].photoAttached = true;
  persistedPhotoContext.inspection.subjects[0].photoEvidence = { fileId: "file-1", savedAt: "2026-10-10T10:00:00Z", linkedAt: "2026-10-10T10:00:00Z" };
  const reloadedPhoto = setup({ auth: {
    async getDeliveryHandover() { return { ok: true, data: persistedPhotoContext }; },
    async downloadDeliveryEvidence() { return { ok: true, data: { url: "https://signed.invalid/reloaded" } }; }
  } });
  await reloadedPhoto.controller.open(job); await tick();
  const reloadedCard = find(reloadedPhoto.nodes.get("handover-result"), (node) => node.className === "handover-equipment-card");
  assert.match(find(reloadedCard, (node) => node.className === "handover-photo-state").children[0].textContent, /Enregistré · 10\/10\/2026/);
  assert.equal(find(reloadedCard, (node) => node.tagName === "img").src, "https://signed.invalid/reloaded", "saved photo and server timestamp return after a new page session");
  photoContext.handover.signatureAttached = true; photoContext.handover.signedName = "Synthetic Customer";
  photoContext.handover.signedAt = "2026-10-10T10:01:00Z";
  photoContext.handover.signatureEvidence = { fileId: "signature-file", savedAt: "2026-10-10T10:01:00Z" };
  const reloadedSignature = setup({ auth: { async getDeliveryHandover() { return { ok: true, data: photoContext }; } } });
  await reloadedSignature.controller.open(job);
  assert.match(reloadedSignature.nodes.get("handover-result").children.map((n) => n.textContent).join(" "), /Enregistré · signature de Synthetic Customer/);
  assert.match(reloadedSignature.nodes.get("handover-result").children.map((n) => n.textContent).join(" "), /10\/10\/2026/);

  const incompleteConfirmContext = handoverContext(false, true);
  let incompleteConfirmCalls = 0;
  const blockedConfirm = setup({ auth: {
    async getDeliveryHandover() { return { ok: true, data: incompleteConfirmContext }; },
    async confirmDeliveryHandover() { incompleteConfirmCalls += 1; return { ok: true, data: { status: "confirmed" } }; }
  } });
  await blockedConfirm.controller.open(job);
  const blockedButton = find(blockedConfirm.nodes.get("handover-result"), (node) => node.tagName === "button" && node.textContent === "Confirmer la remise");
  blockedButton.emit("click"); await tick();
  assert.equal(incompleteConfirmCalls, 0, "incomplete server state is never submitted for confirmation");
  assert.match(blockedConfirm.nodes.get("handover-status").textContent, /aucune confirmation n’a été envoyée/i);
  assert.match(find(blockedConfirm.nodes.get("handover-result"), (node) => node.dataset.confirmValidation === "true").children[1].children.map((n) => n.textContent).join(" "), /checklist de livraison non configurée/);

  const completeHandover = handoverContext(false, true);
  Object.assign(completeHandover.inspection.subjects[0], {
    condition: "good", equipmentVerified: true,
    checklist: [{ key: "power", label: "Alimentation", result: "pass" }],
    photoAttached: true, photoEvidence: { fileId: "photo-file", savedAt: "2026-10-10T10:00:00Z" }
  });
  completeHandover.handover.signatureAttached = true;
  completeHandover.handover.signedName = "Synthetic Customer";
  completeHandover.handover.signedAt = "2026-10-10T10:01:00Z";
  completeHandover.handover.signatureEvidence = { fileId: "signature-file", savedAt: "2026-10-10T10:01:00Z" };
  let confirmed = false; let confirmationCalls = 0;
  const confirmedContext = { ...completeHandover, jobStatus: "completed", handover: { ...completeHandover.handover, status: "confirmed", confirmedAt: "2026-10-10T10:02:00Z" } };
  const confirmedUI = setup({ auth: {
    async getDeliveryHandover() { return { ok: true, data: confirmed ? confirmedContext : completeHandover }; },
    async confirmDeliveryHandover() { confirmationCalls += 1; confirmed = true; return { ok: true, data: { status: "confirmed" } }; }
  } });
  await confirmedUI.controller.open(job);
  const confirmButton = find(confirmedUI.nodes.get("handover-result"), (node) => node.tagName === "button" && node.textContent === "Confirmer la remise");
  confirmButton.emit("click"); confirmButton.emit("click"); await tick(); await tick();
  assert.equal(confirmationCalls, 1, "duplicate confirmation submits are suppressed");
  assert.match(find(confirmedUI.nodes.get("handover-result"), (node) => node.className === "handover-completed-title").textContent, /Remise terminée/);
  assert.match(confirmedUI.nodes.get("handover-result").children.map((n) => n.textContent).join(" "), /10\/10\/2026/);

  let interruptedConfirmationCalls = 0;
  const interruptedContext = handoverContext(false, true);
  Object.assign(interruptedContext.inspection.subjects[0], { condition: "good", equipmentVerified: true, checklist: [{ key: "power", label: "Alimentation", result: "pass" }], photoEvidence: { fileId: "photo-file", savedAt: "2026-10-10T10:00:00Z" } });
  interruptedContext.handover.signatureAttached = true; interruptedContext.handover.signatureEvidence = { fileId: "signature-file", savedAt: "2026-10-10T10:01:00Z" }; interruptedContext.handover.signedAt = "2026-10-10T10:01:00Z";
  const interrupted = setup({ auth: {
    async getDeliveryHandover() { return { ok: true, data: interruptedContext }; },
    async confirmDeliveryHandover() { interruptedConfirmationCalls += 1; throw new Error("network interrupted"); }
  } });
  await interrupted.controller.open(job);
  const interruptedResult = interrupted.nodes.get("handover-result");
  const noteField = find(interruptedResult, (node) => node.tagName === "textarea"); noteField.value = "Note à conserver";
  find(interruptedResult, (node) => node.tagName === "button" && node.textContent === "Confirmer la remise").emit("click"); await tick();
  assert.equal(interruptedConfirmationCalls, 1);
  assert.equal(find(interruptedResult, (node) => node.tagName === "textarea").value, "Note à conserver", "interrupted confirmation preserves unfinished values");
  assert.equal(find(interruptedResult, (node) => node.className === "handover-completed-title"), null, "interrupted request never shows false completion");
  assert.match(interrupted.nodes.get("handover-status").textContent, /réponse a été interrompue/i);

  assert.match(source, /getUserMedia\(/, "camera access is behind an explicit button event");
  assert.match(source, /uploadDeliveryEvidence/, "photos and signatures use the existing private storage client");
  assert.match(source, /confirmDeliveryHandover/, "completion uses the backend confirmation RPC");
  assert.match(source, /pointerdown/, "signature capture supports touch input");
  assert.match(html, /handover-verification\.js/);
  assert.match(html, /phase2a3-handover-save-ux-1/, "admin assets use a cache-busting release identifier for this fix");
  assert.doesNotMatch(source + html, /localStorage|sessionStorage|console\.(?:log|warn|error)/);
  console.log("Online handover UI tests passed (eligibility, numeric/QR verification, resumable preparation, safe errors, camera cleanup, and credential clearing).");
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
