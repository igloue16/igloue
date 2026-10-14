import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import vm from "node:vm";
import { test } from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(path.join(root, "release/storefront-manifest.json"), "utf8"));
const rollbackManifest = JSON.parse(await readFile(path.join(root, "release/storefront-rollback-manifest.json"), "utf8"));
const builder = path.join(root, "scripts/build-storefront-release.mjs");
const STAGING_URL = "https://fxhdxilvbzojkyyhktnu.supabase.co";
const STAGING_KEY = "sb_publishable_StagingFixture_123";
const SYNTHETIC_PRODUCTION_URL = "https://synthetic-production.supabase.invalid";
const PRODUCTION_KEY = "sb_publishable_ProductionFixture_456";

function pinnedProductionConfig() {
  const source = execFileSync("git", ["show", `${manifest.source_public_main}:assets/js/supabase-config.js`], {
    cwd: root,
    encoding: "utf8",
  });
  const hosted = source.match(/const hosted\s*=\s*\{([\s\S]*?)\n\s*\};/)?.[1] ?? "";
  const projectUrl = hosted.match(/projectUrl:\s*["']([^"']+)["']/)?.[1];
  const publishableKey = hosted.match(/publishableKey:\s*["']([^"']+)["']/)?.[1];
  assert.ok(projectUrl && publishableKey, "pinned source contains parseable production browser config");
  return { projectUrl, publishableKey };
}

function stagingEnv(overrides = {}) {
  const env = { ...process.env };
  delete env.IGLOUE_STOREFRONT_PRODUCTION_SUPABASE_URL;
  delete env.IGLOUE_STOREFRONT_PRODUCTION_SUPABASE_PUBLISHABLE_KEY;
  return Object.assign(env, {
    IGLOUE_STOREFRONT_BUILD_TARGET: "staging",
    IGLOUE_STOREFRONT_STAGING_SUPABASE_URL: STAGING_URL,
    IGLOUE_STOREFRONT_STAGING_SUPABASE_PUBLISHABLE_KEY: STAGING_KEY,
  }, overrides);
}

async function bundleText(directory) {
  const chunks = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, item.name);
    if (item.isDirectory()) chunks.push(await bundleText(full));
    else chunks.push(await readFile(full, "utf8"));
  }
  return chunks.join("\n");
}

function loadConfig(source, hostname) {
  const context = vm.createContext({ window: { location: { hostname } } });
  vm.runInContext(source, context);
  return context.window.IGLOUE_SUPABASE_CONFIG;
}

async function filesUnder(directory, prefix = "") {
  const result = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isDirectory()) result.push(...await filesUnder(path.join(directory, item.name), rel));
    else result.push(rel);
  }
  return result.sort();
}

test("storefront release is the exact 59-file allowlist with static and generated-config hashes verified", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "igloue-storefront-release-test-"));
  const site = path.join(temp, "site");
  try {
    execFileSync(process.execPath, [builder, "build", "--out", site], { cwd: root, stdio: "pipe", env: stagingEnv() });
    assert.equal(manifest.expected_file_count, 59, "the initial reviewed release contains 59 files");
    assert.equal(manifest.files.length, manifest.expected_file_count);
    assert.deepEqual(await filesUnder(site), manifest.files.map((entry) => entry.path).sort());
    execFileSync(process.execPath, [builder, "verify", "--dir", site], { cwd: root, stdio: "pipe", env: stagingEnv() });
    assert.equal((await readFile(path.join(site, "CNAME"), "utf8")).trim(), "test.igloue.fr");
    for (const page of ["index.html", "reservation-portal.html", "delivery-status.html", "verify-email/index.html"]) {
      assert.ok(manifest.files.some((entry) => entry.path === page), `${page} remains published`);
    }
    assert.ok(manifest.files.some((entry) => entry.path === "assets/js/supabase-config.js"), "browser staging config stays available");
    const configManifest = manifest.files.find((entry) => entry.path === "assets/js/supabase-config.js");
    assert.equal(configManifest.generated, "staging-supabase-config-v1");
    assert.match(configManifest.source_sha256, /^[a-f0-9]{64}$/);
    assert.equal(Object.hasOwn(configManifest, "sha256"), false);
    const published = await bundleText(site);
    const pinnedProduction = pinnedProductionConfig();
    assert.ok(published.includes(STAGING_URL));
    assert.ok(published.includes(STAGING_KEY));
    assert.ok(!published.includes(SYNTHETIC_PRODUCTION_URL));
    assert.ok(!published.includes(PRODUCTION_KEY));
    assert.ok(!published.includes(pinnedProduction.projectUrl), "pinned production Supabase URL is absent");
    assert.ok(!published.includes(pinnedProduction.publishableKey), "pinned production publishable key is absent");
    assert.equal(/sb_secret_[A-Za-z0-9_-]+|SUPABASE_SERVICE_ROLE_KEY|ZEPTOMAIL_API_TOKEN/i.test(published), false);
    const configSource = await readFile(path.join(site, "assets/js/supabase-config.js"), "utf8");
    assert.equal(loadConfig(configSource, "test.igloue.fr").projectUrl, STAGING_URL);
    assert.equal(loadConfig(configSource, "test.app.igloue.eu").backend, "staging");
    for (const hostname of ["igloue.fr", "www.igloue.fr", "app.igloue.eu", "preview.pages.dev", "feature-branch.github.io", "unknown.example"]) {
      assert.equal(loadConfig(configSource, hostname), null, `${hostname} fails closed`);
    }
    assert.equal(manifest.files.some((entry) => /^(admin|supabase|docs|tests|scripts|archive)\//.test(entry.path)), false);

    const tampered = path.join(temp, "tampered");
    await cp(site, tampered, { recursive: true });
    const supabaseDir = path.join(tampered, "supabase");
    await mkdir(supabaseDir);
    await writeFile(path.join(supabaseDir, "config.toml"), "not approved");
    const rejected = spawnSync(process.execPath, [builder, "verify", "--dir", tampered], { cwd: root, encoding: "utf8", env: stagingEnv() });
    assert.notEqual(rejected.status, 0, "unexpected backend files are rejected");

    const tamperedConfig = path.join(temp, "tampered-config");
    await cp(site, tamperedConfig, { recursive: true });
    const configPath = path.join(tamperedConfig, "assets/js/supabase-config.js");
    await writeFile(configPath, `${await readFile(configPath, "utf8")}\n// tampered`);
    const configRejected = spawnSync(process.execPath, [builder, "verify", "--dir", tamperedConfig], { cwd: root, encoding: "utf8", env: stagingEnv() });
    assert.notEqual(configRejected.status, 0, "modified generated config fails its computed hash check");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("generated staging artifact preserves availability endpoint and payload contract", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "igloue-storefront-availability-artifact-"));
  const site = path.join(temp, "site");
  try {
    execFileSync(process.execPath, [builder, "build", "--out", site], { cwd: root, stdio: "pipe", env: stagingEnv() });
    let captured;
    const context = vm.createContext({ window: { location: { hostname: "test.igloue.fr" } } });
    context.window.fetch = async (url, options) => {
      captured = { url, options };
      return { ok: true, json: async () => ({ ok: true, available: true, productId: "essential" }) };
    };
    vm.runInContext(await readFile(path.join(site, "assets/js/supabase-config.js"), "utf8"), context);
    vm.runInContext(await readFile(path.join(site, "assets/js/availability-client.js"), "utf8"), context);
    const result = await context.window.IGLOUE_AVAILABILITY_CLIENT.checkAvailability({
      productId: "essential",
      startDate: "2026-10-20",
      endDate: "2026-10-23",
      deliverySlotId: "0830-1030",
      collectionSlotId: "0830-1030",
    });
    assert.deepEqual(JSON.parse(JSON.stringify(result)), { status: "available", available: true, productId: "essential" });
    assert.equal(captured.url, `${STAGING_URL}/functions/v1/check-availability`);
    assert.equal(captured.options.method, "POST");
    assert.equal(captured.options.headers.apikey, STAGING_KEY);
    assert.deepEqual(JSON.parse(captured.options.body), {
      productId: "essential",
      rental: { startDate: "2026-10-20", endDate: "2026-10-23" },
      service: { deliverySlotId: "0830-1030", collectionSlotId: "0830-1030" },
    });

    for (const hostname of ["igloue.fr", "preview-branch.github.io"]) {
      let calls = 0;
      const denied = vm.createContext({ window: { location: { hostname } } });
      denied.window.fetch = async () => { calls += 1; throw new Error("unexpected network request"); };
      vm.runInContext(await readFile(path.join(site, "assets/js/supabase-config.js"), "utf8"), denied);
      vm.runInContext(await readFile(path.join(site, "assets/js/availability-client.js"), "utf8"), denied);
      const deniedResult = await denied.window.IGLOUE_AVAILABILITY_CLIENT.checkAvailability({ productId: "essential" });
      assert.equal(deniedResult.status, "error");
      assert.equal(calls, 0, `${hostname} cannot initialize a Supabase request`);
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("release content retains customer date, quote, portal, and extended-exhaust entry points", async () => {
  const required = new Set(manifest.files.map((entry) => entry.path));
  for (const asset of [
    "assets/js/assistant.js",
    "assets/js/calendar.js",
    "assets/js/service-slot-client.js",
    "assets/js/reservation-review.js",
    "assets/js/reservation-client.js",
    "assets/js/reservation-attempt.js",
    "assets/js/reservation-portal.js",
  ]) assert.ok(required.has(asset), `${asset} is in the release allowlist`);
  const assistant = await readFile(path.join(root, "assets/js/assistant.js"), "utf8");
  const review = await readFile(path.join(root, "assets/js/reservation-review.js"), "utf8");
  const submit = await readFile(path.join(root, "assets/js/reservation-client.js"), "utf8");
  const portal = await readFile(path.join(root, "assets/js/reservation-portal.js"), "utf8");
  assert.match(assistant, /extendedExhaustSelected/);
  assert.match(assistant, /alternative/i);
  assert.match(review, /extendedExhaustSelected/);
  assert.match(submit, /extendedExhaustSelected/);
  assert.match(portal, /extendedExhaust/);
});

test("rollback artifact rebuilds from its pinned public source revision", async () => {
  assert.equal(rollbackManifest.expected_file_count, 59);
  const temp = await mkdtemp(path.join(os.tmpdir(), "igloue-storefront-rollback-test-"));
  const site = path.join(temp, "site");
  try {
    const env = stagingEnv();
    execFileSync(process.execPath, [
      builder,
      "build",
      "--manifest",
      "release/storefront-rollback-manifest.json",
      "--source-ref",
      rollbackManifest.source_public_main,
      "--out",
      site,
    ], { cwd: root, stdio: "pipe", env });
    assert.deepEqual(await filesUnder(site), rollbackManifest.files.map((entry) => entry.path).sort());
    execFileSync(process.execPath, [builder, "verify", "--manifest", "release/storefront-rollback-manifest.json", "--dir", site], { cwd: root, stdio: "pipe", env });
    const configSource = await readFile(path.join(site, "assets/js/supabase-config.js"), "utf8");
    assert.equal(loadConfig(configSource, "test.igloue.fr").projectUrl, STAGING_URL);
    assert.equal(loadConfig(configSource, "igloue.fr"), null, "rollback retains staging-only configuration");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("staging release build fails closed for missing, ambiguous, production, or malformed inputs", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "igloue-storefront-invalid-build-"));
  const run = (env, name) => spawnSync(process.execPath, [builder, "build", "--out", path.join(temp, name)], {
    cwd: root, encoding: "utf8", env,
  });
  try {
    for (const [name, env] of [
      ["missing-target", { ...stagingEnv(), IGLOUE_STOREFRONT_BUILD_TARGET: "" }],
      ["wrong-target", { ...stagingEnv(), IGLOUE_STOREFRONT_BUILD_TARGET: "production" }],
      ["wrong-url", { ...stagingEnv(), IGLOUE_STOREFRONT_STAGING_SUPABASE_URL: SYNTHETIC_PRODUCTION_URL }],
      ["production-config", { ...stagingEnv(), IGLOUE_STOREFRONT_PRODUCTION_SUPABASE_PUBLISHABLE_KEY: PRODUCTION_KEY }],
      ["bad-key", { ...stagingEnv(), IGLOUE_STOREFRONT_STAGING_SUPABASE_PUBLISHABLE_KEY: "service_role" }],
    ]) {
      const result = run(env, name);
      assert.notEqual(result.status, 0, `${name} is rejected`);
    }
    assert.deepEqual(await readdir(temp), [], "invalid config never creates a release directory");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
