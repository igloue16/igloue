const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { credentialFromHash, submitCredential } = require("../assets/js/email-verification.js");

const credential = "A".repeat(43);

test("reads only a canonical credential from the URL fragment, never query", () => {
  assert.equal(credentialFromHash(`#credential=${credential}`), credential);
  assert.equal(credentialFromHash(`?credential=${credential}`), null);
  assert.equal(credentialFromHash(`#credential=${credential}=`), null);
  assert.equal(credentialFromHash(`#credential=${credential}&redirect=https://attacker.test`), null);
});

test("maps explicit submit outcomes to safe frontend states", async () => {
  assert.equal(await submitCredential(credential, async (value) => value === credential), "success");
  assert.equal(await submitCredential(credential, async () => false), "invalid");
  assert.equal(await submitCredential(credential, async () => { throw new Error("private"); }), "failure");
  assert.equal(await submitCredential("bad", async () => true), "invalid");
});

test("landing route scrubs the fragment and does not persist or log credentials", () => {
  const root = path.resolve(__dirname, "..");
  const page = fs.readFileSync(path.join(root, "verify-email/index.html"), "utf8");
  const script = fs.readFileSync(path.join(root, "assets/js/email-verification-page.js"), "utf8");
  assert.match(page, /name="referrer" content="no-referrer"/);
  assert.match(script, /history\.replaceState\([\s\S]*window\.location\.pathname \+ window\.location\.search/);
  assert.match(script, /JSON\.stringify\(\{ credential: value \}\)/);
  assert.doesNotMatch(script, /localStorage|sessionStorage|console\.(log|error)/);
});
