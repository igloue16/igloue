const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const context = vm.createContext({
  console,
  document: {
    addEventListener() {}
  },
  window: {
    location: {
      href: "http://localhost/operations.html"
    }
  }
});

[
  "assets/js/fleet-allocation.js",
  "assets/js/operations-view.js"
].forEach((file) => {
  vm.runInContext(
    fs.readFileSync(path.join(root, file), "utf8"),
    context,
    { filename: file }
  );
});

function evaluate(expression) {
  return vm.runInContext(expression, context);
}

assert.strictEqual(evaluate('isOperationalDate("2026-09-10")'), true);
assert.strictEqual(evaluate('isOperationalDate("2024-02-29")'), true);
assert.strictEqual(evaluate('isOperationalDate("2025-02-29")'), false);
assert.strictEqual(evaluate('isOperationalDate("2026-13-10")'), false);
assert.strictEqual(evaluate('isOperationalDate("2026-04-31")'), false);
assert.strictEqual(evaluate('isOperationalDate("10-09-2026")'), false);
assert.strictEqual(evaluate('shiftOperationalDate("2026-09-10", -1)'), "2026-09-09");
assert.strictEqual(evaluate('shiftOperationalDate("2026-09-10", 1)'), "2026-09-11");

console.log("Operations date validation and navigation scenarios passed.");
