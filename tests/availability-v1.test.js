const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const context = vm.createContext({ console, Date, Intl });

[
  "delivery.js",
  "schedule-provider.js",
  "bookings-provider.js",
  "availability.js"
].forEach((filename) => {
  vm.runInContext(
    fs.readFileSync(path.join(projectRoot, "assets/js", filename), "utf8"),
    context,
    { filename }
  );
});

function evaluate(expression) {
  return vm.runInContext(expression, context);
}

function availableIds(date, serviceType = "delivery") {
  return Array.from(evaluate(`
    getAvailableIgloueServiceSlots({
      date: "${date}",
      serviceType: "${serviceType}",
      postcode: "16000",
      now: { date: "2026-09-09", hour: 8, minute: 0 }
    }).map((slot) => slot.id)
  `));
}

const allSlots = [
  "0830-1030",
  "1030-1230",
  "1230-1430",
  "1430-1630",
  "1630-1830",
  "1830-2030"
];

assert.deepEqual(availableIds("2026-09-10"), allSlots, "A: free day");
assert.deepEqual(
  availableIds("2026-09-11"),
  ["1430-1630", "1630-1830", "1830-2030"],
  "B: early shift plus buffer"
);
assert.deepEqual(
  availableIds("2026-09-12"),
  ["0830-1030"],
  "C: afternoon shift plus buffer"
);
assert.deepEqual(availableIds("2026-09-13"), [], "D: closed day");
assert.equal(
  availableIds("2026-09-15", "delivery").includes("1030-1230"),
  false,
  "E: full delivery slot"
);
assert.equal(
  availableIds("2026-09-15", "collection").includes("1430-1630"),
  false,
  "E: full collection slot"
);
assert.equal(
  evaluate(`IGLOUE_AVAILABILITY_PROVIDER.hasAvailableSameDaySlot({
    postcode: "16000",
    deliveryDate: "2026-09-10",
    now: { date: "2026-09-10", hour: 9, minute: 0 }
  })`),
  true,
  "F: Express before cutoff with a remaining slot"
);
assert.equal(
  evaluate(`IGLOUE_AVAILABILITY_PROVIDER.hasAvailableSameDaySlot({
    postcode: "16000",
    deliveryDate: "2026-09-10",
    now: { date: "2026-09-10", hour: 10, minute: 1 }
  })`),
  false,
  "G: Express after cutoff"
);
assert.equal(
  evaluate(`evaluateIgloueServiceSlots({
    date: "2026-09-10",
    serviceType: "delivery",
    postcode: "99999",
    now: { date: "2026-09-09", hour: 8, minute: 0 }
  })[0].reasonUnavailable`),
  "outside-service-area",
  "J: unsupported postcode"
);

console.log("Availability V1 scenarios A–G and service-area revalidation passed.");
