const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "assets/js/operations-board.js"), "utf8");
const html = fs.readFileSync(path.join(root, "admin/index.html"), "utf8");
const context = vm.createContext({});
context.window = context;
vm.runInContext(source, context, { filename: "operations-board.js" });
const board = context.IGLOUE_OPERATIONS_BOARD;

const fixture = {
  metadata: { selectedDate: "2026-10-08", timezone: "Europe/Paris" },
  summary: { deliveriesToday: 2, collectionsToday: 1, overdueJobs: 1, completedJobs: 0, attentionJobs: 1 },
  jobs: [
    {
      type: "delivery", state: "overdue", status: "assigned", needsAttention: true,
      customerName: "<img src=x onerror=alert(1)>", customerPhone: "06 12 34 56 78",
      reservationReference: "AB12CD34", scheduledDate: "2026-10-08", paymentStatus: "paid",
      window: { start: "08:00", end: "10:00", label: "Morning" },
      address: { line1: "1 rue Exemple", postcode: "16000", city: "Angouleme" },
      equipment: [{ name: "Climatiseur", quantity: 1, units: [{ serialNumber: "SER-1", status: "reserved", condition: "good" }] }],
      notes: "Call on arrival", warnings: ["allocation_missing"]
    },
    { type: "collection", state: "upcoming", status: "scheduled", needsAttention: false, scheduledDate: "2026-10-08" },
    { type: "delivery", state: "completed", status: "completed", needsAttention: false, scheduledDate: "2026-10-08" },
    { type: "other", state: "upcoming", status: "scheduled", needsAttention: false, scheduledDate: "2026-10-08" }
  ]
};

const all = board.render(fixture);
assert.equal(all.date, "2026-10-08");
assert.equal(all.timezone, "Europe/Paris");
assert.match(all.summary, /Livraisons/);
assert.match(all.jobs, /AB12CD34/);
assert.match(all.jobs, /En retard/);
assert.match(all.jobs, /ops-equipment/);
assert.match(all.jobs, /SER-1/);
assert.match(all.jobs, /Paiement/);
assert.match(all.jobs, /Call on arrival/);
assert.doesNotMatch(all.jobs, /<img src=x/);
assert.match(all.jobs, /&lt;img src=x onerror=alert\(1\)&gt;/);
assert.match(all.jobs, /href="tel:06 12 34 56 78"/);
assert.equal((all.jobs.match(/<details\b/g) || []).length, 3, "unknown service types are excluded");
assert.equal((board.render(fixture, "delivery").jobs.match(/<details\b/g) || []).length, 2);
assert.equal((board.render(fixture, "collection").jobs.match(/<details\b/g) || []).length, 1);
assert.equal((board.render(fixture, "attention").jobs.match(/<details\b/g) || []).length, 1);
assert.match(board.render({ ...fixture, jobs: [] }).jobs, /Aucune intervention/);
assert.match(board.render(null).jobs, /indisponibles/);
assert.match(html, /id="ops-filter"/);
assert.match(html, /id="ops-date"/);
assert.match(html, /operations-board\.js[\s\S]*admin-app\.js/);

console.log("Operations board V1 renderer tests passed (filters, allowlisted rendering, and HTML escaping).");
