const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const assistantSource = fs.readFileSync(
  path.join(root, "assets/js/assistant.js"),
  "utf8"
);
assert.doesNotMatch(assistantSource, /getAlternativeAvailability\s*\(/);
assert.doesNotMatch(assistantSource, /isProductAvailableForDates\s*\(/);
const context = vm.createContext({});
context.window = context;
vm.runInContext(
  fs.readFileSync(
    path.join(root, "assets/js/alternative-availability-state.js"),
    "utf8"
  ),
  context,
  { filename: "alternative-availability-state.js" }
);

const selection = {
  startDate: "2027-07-12",
  endDate: "2027-07-19",
  deliverySlotId: "0830-1030",
  collectionSlotId: "1630-1830"
};
const candidates = [
  { id: "split-12" },
  { id: "essential" }
];

let resolveFirst;
let resolveSecond;
const calls = [];
const coordinator = context.IGLOUE_ALTERNATIVE_AVAILABILITY_STATE.create(
  (request) => {
    calls.push(request);
    return calls.length === 1
      ? new Promise((resolve) => { resolveFirst = resolve; })
      : new Promise((resolve) => { resolveSecond = resolve; });
  }
);

(async () => {
  const pending = coordinator.check(selection, candidates);
  assert.equal(coordinator.getState().status, "checking");
  await Promise.resolve();
  assert.equal(calls.length, 1, "candidate checks are sequential");
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), {
    ...selection,
    productId: "split-12"
  });

  const duplicate = coordinator.check(selection, candidates);
  assert.strictEqual(duplicate, pending, "same candidate selection reuses pending work");

  resolveFirst({
    status: "unavailable",
    available: false,
    productId: "split-12"
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls.length, 2, "the next candidate starts after the first resolves");
  resolveSecond({
    status: "available",
    available: true,
    productId: "essential"
  });
  const result = await pending;
  assert.equal(result.status, "complete");
  assert.deepEqual(
    JSON.parse(JSON.stringify(result.results.map(({ productId, status, available }) => ({ productId, status, available })))),
    [
      { productId: "split-12", status: "unavailable", available: false },
      { productId: "essential", status: "available", available: true }
    ]
  );

  coordinator.reset();
  let resolveStale;
  const staleCoordinator = context.IGLOUE_ALTERNATIVE_AVAILABILITY_STATE.create(
    () => new Promise((resolve) => { resolveStale = resolve; })
  );
  const stalePending = staleCoordinator.check(selection, [{ id: "split-12" }]);
  await Promise.resolve();
  staleCoordinator.reset();
  resolveStale({ status: "available", available: true, productId: "split-12" });
  await stalePending;
  assert.equal(staleCoordinator.getState().status, "idle", "reset prevents stale results from rendering");

  const noCandidates = await coordinator.check(selection, []);
  assert.equal(noCandidates.status, "complete");
  assert.equal(noCandidates.results.length, 0);

  let resolveChangedSelection;
  const changedSelection = { ...selection, startDate: "2027-07-13" };
  const changedPending = coordinator.check(changedSelection, [{ id: "split-12" }]);
  await Promise.resolve();
  assert.notEqual(
    coordinator.getState().key,
    context.IGLOUE_ALTERNATIVE_AVAILABILITY_STATE.candidateKey(selection, []),
    "a date change creates a new alternative selection key"
  );
  resolveChangedSelection = resolveSecond;
  resolveChangedSelection({ status: "unavailable", available: false, productId: "split-12" });
  await changedPending;

  console.log("Alternative availability coordinator tests passed (13 assertions).");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
