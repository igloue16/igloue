import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { test } from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(path.join(root, "release/storefront-manifest.json"), "utf8"));
const rollbackManifest = JSON.parse(await readFile(path.join(root, "release/storefront-rollback-manifest.json"), "utf8"));
const builder = path.join(root, "scripts/build-storefront-release.mjs");

async function filesUnder(directory, prefix = "") {
  const result = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isDirectory()) result.push(...await filesUnder(path.join(directory, item.name), rel));
    else result.push(rel);
  }
  return result.sort();
}

test("storefront release is an exact 59-file customer allowlist with matching hashes", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "igloue-storefront-release-test-"));
  const site = path.join(temp, "site");
  try {
    execFileSync(process.execPath, [builder, "build", "--out", site], { cwd: root, stdio: "pipe" });
    assert.equal(manifest.expected_file_count, 59, "the initial reviewed release contains 59 files");
    assert.equal(manifest.files.length, manifest.expected_file_count);
    assert.deepEqual(await filesUnder(site), manifest.files.map((entry) => entry.path).sort());
    execFileSync(process.execPath, [builder, "verify", "--dir", site], { cwd: root, stdio: "pipe" });
    assert.equal((await readFile(path.join(site, "CNAME"), "utf8")).trim(), "test.igloue.fr");
    for (const page of ["index.html", "reservation-portal.html", "delivery-status.html", "verify-email/index.html"]) {
      assert.ok(manifest.files.some((entry) => entry.path === page), `${page} remains published`);
    }
    assert.ok(manifest.files.some((entry) => entry.path === "assets/js/supabase-config.js"), "browser staging config stays available");
    assert.equal(manifest.files.some((entry) => /^(admin|supabase|docs|tests|scripts|archive)\//.test(entry.path)), false);

    const tampered = path.join(temp, "tampered");
    await cp(site, tampered, { recursive: true });
    const supabaseDir = path.join(tampered, "supabase");
    await mkdir(supabaseDir);
    await writeFile(path.join(supabaseDir, "config.toml"), "not approved");
    const rejected = spawnSync(process.execPath, [builder, "verify", "--dir", tampered], { cwd: root, encoding: "utf8" });
    assert.notEqual(rejected.status, 0, "unexpected backend files are rejected");
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
    execFileSync(process.execPath, [
      builder,
      "build",
      "--manifest",
      "release/storefront-rollback-manifest.json",
      "--source-ref",
      rollbackManifest.source_public_main,
      "--out",
      site,
    ], { cwd: root, stdio: "pipe" });
    assert.deepEqual(await filesUnder(site), rollbackManifest.files.map((entry) => entry.path).sort());
    execFileSync(process.execPath, [builder, "verify", "--manifest", "release/storefront-rollback-manifest.json", "--dir", site], { cwd: root, stdio: "pipe" });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
