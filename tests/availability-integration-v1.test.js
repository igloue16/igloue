const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "assets/js/availability-state.js"),
  "utf8"
);
const assistantSource = fs.readFileSync(
  path.join(__dirname, "..", "assets/js/assistant.js"),
  "utf8"
);
const reviewSource = fs.readFileSync(
  path.join(__dirname, "..", "assets/js/reservation-review.js"),
  "utf8"
);
assert.match(assistantSource, /IGLOUE_AVAILABILITY_CLIENT\.checkAvailability/);
assert.doesNotMatch(assistantSource, /getAlternativeAvailability\s*\(/);
assert.doesNotMatch(assistantSource, /create-reservation|fetch\s*\(/);
assert.doesNotMatch(reviewSource, /getProductFleetAvailability\s*\(/);
assert.doesNotMatch(reviewSource, /isProductAvailableForDates\s*\(/);
const context = vm.createContext({});
context.window = context;
vm.runInContext(source, context, { filename: "availability-state.js" });

const selection = {
  productId: "essential",
  startDate: "2027-07-12",
  endDate: "2027-07-19",
  deliverySlotId: "0830-1030",
  collectionSlotId: "1630-1830"
};

(async () => {
  const calls = [];
  let resolveFirst;
  const firstRequest = new Promise((resolve) => { resolveFirst = resolve; });
  let resolveSecond;
  const secondRequest = new Promise((resolve) => { resolveSecond = resolve; });
  const coordinator = context.IGLOUE_AVAILABILITY_STATE.create((request) => {
    calls.push(request);
    return calls.length === 1
      ? firstRequest
      : calls.length === 2
        ? secondRequest
        : Promise.resolve({ status: "available", available: true, productId: request.productId });
  });

  const incomplete = await coordinator.check({ ...selection, collectionSlotId: "" });
  assert.equal(incomplete.status, "idle", "incomplete selection stays idle");
  assert.equal(calls.length, 0, "incomplete selection does not call the API");

  const pending = coordinator.check(selection);
  assert.equal(coordinator.getState().status, "checking", "complete selection enters checking state");
  await Promise.resolve();
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), selection, "all five selection values reach the client");

  const changedSelection = { ...selection, startDate: "2027-07-13" };
  const latest = coordinator.check(changedSelection);
  assert.equal(coordinator.getState().key, context.IGLOUE_AVAILABILITY_STATE.selectionKey(changedSelection));
  resolveFirst({ status: "unavailable", available: false, productId: "essential" });
  await pending;
  assert.equal(coordinator.getState().status, "checking", "stale response cannot overwrite newer state");
  resolveSecond({ status: "available", available: true, productId: "essential" });
  const latestResult = await latest;
  assert.equal(latestResult.status, "available", "new selection resolves independently");
  assert.equal(coordinator.getState().status, "available");

  const unavailableCoordinator = context.IGLOUE_AVAILABILITY_STATE.create(() =>
    Promise.resolve({ status: "unavailable", available: false, productId: "essential" })
  );
  assert.equal((await unavailableCoordinator.check(selection)).status, "unavailable", "unavailable remains distinct");

  const errorCoordinator = context.IGLOUE_AVAILABILITY_STATE.create(() =>
    Promise.resolve({ status: "error", available: null, error: "offline" })
  );
  const errorResult = await errorCoordinator.check(selection);
  assert.equal(errorResult.status, "error", "technical errors remain distinct");
  assert.equal(errorResult.available, null, "technical errors do not become unavailable");

  const changedSlot = { ...changedSelection, deliverySlotId: "1030-1230" };
  coordinator.reset();
  const slotResult = await coordinator.check(changedSlot);
  assert.equal(slotResult.status, "available", "changing service slot creates a new check");
  assert.notEqual(slotResult.key, context.IGLOUE_AVAILABILITY_STATE.selectionKey(changedSelection));

  const changedProduct = { ...changedSlot, productId: "max-pro" };
  const productResult = await coordinator.check(changedProduct);
  assert.equal(productResult.productId, "max-pro", "changing product creates a new check");
  assert.notEqual(productResult.key, slotResult.key);

  console.log("Availability integration V1 state tests passed (22 assertions / 12 scenarios).");
})().catch((error) => { console.error(error); process.exitCode = 1; });
