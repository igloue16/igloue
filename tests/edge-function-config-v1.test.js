const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const supabaseRoot = path.join(root, "supabase");
const functionsRoot = path.join(supabaseRoot, "functions");
const config = fs.readFileSync(path.join(supabaseRoot, "config.toml"), "utf8");
const deployable = fs.readdirSync(functionsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((name) => fs.existsSync(path.join(functionsRoot, name, "index.ts")))
  .sort();
const sections = new Map(
  [...config.matchAll(/^\[functions\.([a-z0-9-]+)\]\s*\r?\n([\s\S]*?)(?=^\[|$(?![\s\S]))/gm)]
    .map((match) => [match[1], match[2]]),
);

assert.deepEqual([...sections.keys()].sort(), deployable, "each deployable function has one explicit config section");
for (const name of deployable) {
  const section = sections.get(name);
  assert.ok(section, `${name} has an explicit config section`);
  assert.match(section, /^enabled\s*=\s*true\s*$/m, `${name} is explicitly enabled`);
  assert.match(section, /^verify_jwt\s*=\s*(true|false)\s*$/m, `${name} has explicit JWT behavior`);
  const entrypoint = section.match(/^entrypoint\s*=\s*"([^"]+)"\s*$/m)?.[1];
  assert.ok(entrypoint, `${name} has an explicit entrypoint`);
  assert.ok(fs.existsSync(path.resolve(supabaseRoot, entrypoint)), `${name} entrypoint exists`);
  const importMap = section.match(/^import_map\s*=\s*"([^"]+)"\s*$/m)?.[1];
  if (importMap) assert.ok(fs.existsSync(path.resolve(supabaseRoot, importMap)), `${name} import map exists`);
  if (/from\s+["'](?:@|npm:|jsr:)/.test(fs.readFileSync(path.resolve(supabaseRoot, entrypoint), "utf8"))) {
    assert.ok(importMap, `${name} bare imports have explicit import map`);
  }
}

for (const name of ["recover-stripe-events", "execute-stripe-refund", "payment-operator", "process-outbox"]) {
  const source = fs.readFileSync(path.join(functionsRoot, name, "index.ts"), "utf8");
  assert.match(source, /withSupabase\(\s*\{\s*auth:\s*\["secret"\]/, `${name} requires internal secret auth`);
}
for (const name of ["check-availability", "create-reservation", "create-checkout-session"]) {
  const source = fs.readFileSync(path.join(functionsRoot, name, "index.ts"), "utf8");
  assert.match(source, /withSupabase\(\s*\{\s*auth:\s*\[[^\]]*"publishable"/, `${name} allows publishable customer auth`);
}
const webhookSource = fs.readFileSync(path.join(functionsRoot, "stripe-webhook", "handler.ts"), "utf8");
assert.match(webhookSource, /if\s*\(!dependencies\.secret\)[\s\S]{0,100}WEBHOOK_CONFIGURATION_ERROR/, "webhook fails closed without signing secret");
assert.match(webhookSource, /verifyStripeSignature/, "webhook authenticates the raw Stripe request signature");
const checkoutSource = fs.readFileSync(path.join(functionsRoot, "create-checkout-session", "handler.ts"), "utf8");
assert.match(checkoutSource, /stripeSecretMatchesExpectedLivemode/, "checkout enforces Stripe key mode");
assert.match(checkoutSource, /if\s*\([\s\S]{0,200}!secret[\s\S]{0,200}checkout configuration unavailable/, "checkout fails closed for missing Stripe key");
const refundSource = fs.readFileSync(path.join(functionsRoot, "execute-stripe-refund", "index.ts"), "utf8");
assert.match(refundSource, /stripeSecretMatchesExpectedLivemode/, "refund execution enforces Stripe key mode");
assert.match(refundSource, /!serviceRoleKey\s*\|\|\s*!stripeSecret/, "refund execution fails closed for missing authority or Stripe key");
const reservationSource = fs.readFileSync(path.join(functionsRoot, "create-reservation", "handler.ts"), "utf8");
assert.match(reservationSource, /if\s*\(!paymentCapabilitySecret\)\s*return errorResponse\(500, "INTERNAL_ERROR"\)/, "reservation fails closed without payment capability secret");
for (const name of ["execute-stripe-refund", "payment-operator"]) {
  const source = fs.readFileSync(path.join(functionsRoot, name, "handler.ts"), "utf8");
  assert.match(source, /authorization[\s\S]{0,180}serviceRoleKey|serviceRoleKey[\s\S]{0,180}authorization/i, `${name} checks internal service authority`);
}

const browserFiles = [path.join(root, "index.html"), path.join(root, "operations.html")];
for (const directory of ["assets/js"]) {
  for (const file of fs.readdirSync(path.join(root, directory), { withFileTypes: true, recursive: true })) {
    if (file.isFile() && file.name.endsWith(".js")) browserFiles.push(path.join(file.parentPath, file.name));
  }
}
const secretNames = /SUPABASE_SERVICE_ROLE_KEY|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|PAYMENT_CAPABILITY_SECRET|ZEPTOMAIL_API_TOKEN/;
for (const file of browserFiles) {
  assert.equal(secretNames.test(fs.readFileSync(file, "utf8")), false, `${path.relative(root, file)} exposes no server secret env names`);
}

console.log(`Edge function configuration checks passed (${deployable.length} functions).`);
