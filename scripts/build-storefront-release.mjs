import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestFlag = process.argv.indexOf("--manifest");
const manifestPath = manifestFlag >= 0
  ? path.resolve(root, process.argv[manifestFlag + 1] ?? "")
  : path.join(root, "release", "storefront-manifest.json");
if (!manifestPath.startsWith(`${path.join(root, "release")}${path.sep}`)) throw new Error("Manifest must be in the release directory");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const mode = process.argv[2];
const optionAt = process.argv.indexOf(mode === "build" ? "--out" : "--dir");
const requestedPath = optionAt >= 0 ? process.argv[optionAt + 1] : null;
const sourceFlag = process.argv.indexOf("--source-ref");
const sourceRef = sourceFlag >= 0 ? process.argv[sourceFlag + 1] : null;

const CONFIG_PATH = "assets/js/supabase-config.js";
const STAGING_URL = "https://fxhdxilvbzojkyyhktnu.supabase.co";
const STAGING_HOSTNAMES = Object.freeze(["test.igloue.fr", "test.app.igloue.eu"]);
const STAGING_GATEWAY = "https://igloue-customer-email-verification-gateway.plain-lab-58bb.workers.dev/customer-email-verification";
const GENERATED_KIND = "staging-supabase-config-v1";

function fail(message) {
  console.error(`Storefront release validation failed: ${message}`);
  process.exit(1);
}

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function required(env, name) {
  const value = typeof env[name] === "string" ? env[name].trim() : "";
  if (!value) throw new Error(`Missing required build variable: ${name}`);
  return value;
}

function resolveStagingConfig(env = process.env) {
  if (required(env, "IGLOUE_STOREFRONT_BUILD_TARGET") !== "staging") {
    throw new Error("IGLOUE_STOREFRONT_BUILD_TARGET must be explicitly set to staging");
  }
  for (const name of ["IGLOUE_STOREFRONT_PRODUCTION_SUPABASE_URL", "IGLOUE_STOREFRONT_PRODUCTION_SUPABASE_PUBLISHABLE_KEY"]) {
    if (Object.hasOwn(env, name)) throw new Error(`Production configuration is forbidden in a staging build (${name})`);
  }
  const projectUrl = required(env, "IGLOUE_STOREFRONT_STAGING_SUPABASE_URL");
  if (projectUrl !== STAGING_URL) throw new Error("Configured Supabase URL does not match the staging project");
  const publishableKey = required(env, "IGLOUE_STOREFRONT_STAGING_SUPABASE_PUBLISHABLE_KEY");
  if (!/^sb_publishable_[A-Za-z0-9_-]{1,160}$/.test(publishableKey)) {
    throw new Error("IGLOUE_STOREFRONT_STAGING_SUPABASE_PUBLISHABLE_KEY must be a Supabase publishable key");
  }
  return Object.freeze({ projectUrl, publishableKey });
}

function renderStagingConfig(config) {
  const selected = JSON.stringify({
    backend: "staging",
    projectUrl: config.projectUrl,
    publishableKey: config.publishableKey,
    verificationGatewayUrl: STAGING_GATEWAY,
    allowedHostnames: STAGING_HOSTNAMES,
  });
  return `(function configureIgloueSupabase(global) {\n  "use strict";\n  const selected = ${selected};\n  const hostname = String((global.location || {}).hostname || "").toLowerCase();\n  global.IGLOUE_SUPABASE_CONFIG = selected.allowedHostnames.includes(hostname)\n    ? Object.freeze({\n      backend: selected.backend,\n      projectUrl: selected.projectUrl,\n      publishableKey: selected.publishableKey,\n      verificationGatewayUrl: selected.verificationGatewayUrl,\n    })\n    : null;\n})(window);\n`;
}

if (!["build", "verify"].includes(mode) || !requestedPath) {
  fail("usage: node scripts/build-storefront-release.mjs build --out <empty-path> | verify --dir <artifact-path>");
}

if (manifest.schema_version !== 1 || manifest.artifact_only !== true) fail("unsupported manifest schema");
if (!/^[a-f0-9]{40}$/.test(manifest.source_public_main ?? "") || (manifest.pr29_source_private_main && !/^[a-f0-9]{40}$/.test(manifest.pr29_source_private_main))) {
  fail("source revision provenance must contain full commit IDs");
}
const ancestry = spawnSync("git", ["merge-base", "--is-ancestor", manifest.source_public_main, "HEAD"], { cwd: root });
if (ancestry.status !== 0) fail("declared public-main source revision is not an ancestor of the checked-out source");
if (sourceRef && sourceRef !== manifest.source_public_main) fail("source-ref must equal the public revision recorded in the selected manifest");

const entries = manifest.files;
if (!Array.isArray(entries) || !Number.isSafeInteger(manifest.expected_file_count) || entries.length !== manifest.expected_file_count) {
  fail("manifest file count does not match expected_file_count");
}
const approved = new Map();
for (const entry of entries) {
  const rel = entry.path;
  if (typeof rel !== "string" || rel.startsWith("/") || rel.includes("\\") || rel.split("/").includes("..") || path.posix.normalize(rel) !== rel) {
    fail(`unsafe manifest path: ${String(rel)}`);
  }
  if (approved.has(rel)) fail(`duplicate manifest path: ${rel}`);
  const allowed = rel === "CNAME"
    || ["index.html", "reservation-portal.html", "delivery-status.html", "verify-email/index.html"].includes(rel)
    || /^assets\/(css|js|images)\//.test(rel);
  if (!allowed || rel.startsWith("assets/js/admin-") || rel.includes("platform-admin") || rel.includes("operations-board")) {
    fail(`path is outside the storefront-only boundary: ${rel}`);
  }
  if (rel === CONFIG_PATH) {
    // The manifest pins the source bytes; the emitted digest is derived from the
    // validated staging inputs and checked again when the artifact is deployed.
    if (entry.generated !== GENERATED_KIND || !/^[a-f0-9]{64}$/.test(entry.source_sha256 ?? "") || !Number.isSafeInteger(entry.source_bytes) || entry.source_bytes < 0) {
      fail("staging config manifest metadata is invalid");
    }
    if (Object.hasOwn(entry, "sha256") || Object.hasOwn(entry, "bytes")) fail("generated config must use the staging-input hash verifier");
  } else if (!/^[a-f0-9]{64}$/.test(entry.sha256 ?? "") || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || Object.hasOwn(entry, "generated")) {
    fail(`invalid hash metadata: ${rel}`);
  }
  approved.set(rel, entry);
}
for (const requiredPath of ["CNAME", "index.html", "reservation-portal.html", "delivery-status.html", "verify-email/index.html", CONFIG_PATH, "assets/js/assistant.js", "assets/js/calendar.js", "assets/js/service-slot-client.js", "assets/js/reservation-client.js", "assets/js/reservation-review.js", "assets/js/reservation-portal.js"]) {
  if (!approved.has(requiredPath)) fail(`required customer file is not allowlisted: ${requiredPath}`);
}
if ([...approved.values()].filter((entry) => entry.generated === GENERATED_KIND).length !== 1) fail("manifest must contain exactly one generated staging config");

async function walk(directory, prefix = "") {
  const found = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${item.name}` : item.name;
    const abs = path.join(directory, item.name);
    const info = await lstat(abs);
    if (info.isSymbolicLink()) fail(`symbolic links are not allowed in the artifact: ${rel}`);
    if (item.isDirectory()) found.push(...await walk(abs, rel));
    else if (item.isFile()) found.push(rel);
    else fail(`unsupported filesystem entry in artifact: ${rel}`);
  }
  return found;
}

function readPinnedSource(rel, revision) {
  const sourceFile = spawnSync("git", ["show", `${revision}:${rel}`], { cwd: root, maxBuffer: 32 * 1024 * 1024 });
  if (sourceFile.status !== 0) throw new Error(`Source file is unavailable at the reviewed revision: ${rel}`);
  return sourceFile.stdout;
}

function expectedBytes(entry, env) {
  if (entry.generated === GENERATED_KIND) return Buffer.from(renderStagingConfig(resolveStagingConfig(env)), "utf8");
  return null;
}

async function verifyDirectory(directory, env) {
  const actual = await walk(directory);
  const actualSet = new Set(actual);
  for (const rel of approved.keys()) if (!actualSet.has(rel)) fail(`approved file is missing: ${rel}`);
  for (const rel of actual) if (!approved.has(rel)) fail(`unapproved file is present: ${rel}`);
  for (const [rel, entry] of approved) {
    const bytes = await readFile(path.join(directory, ...rel.split("/")));
    if (entry.generated === GENERATED_KIND) {
      const expected = expectedBytes(entry, env);
      if (bytes.length !== expected.length || hash(bytes) !== hash(expected)) fail(`generated staging config hash mismatch: ${rel}`);
    } else {
      const digest = hash(bytes);
      if (bytes.length !== entry.bytes || digest !== entry.sha256) fail(`size or SHA-256 mismatch: ${rel}`);
    }
  }
  console.log(`Verified ${actual.length} allowlisted storefront files; static hashes and generated staging config digest matched.`);
}

const target = path.resolve(requestedPath);
let stagingConfig;
try {
  stagingConfig = resolveStagingConfig(process.env);
} catch (error) {
  fail(error instanceof Error ? error.message : "staging build configuration is invalid");
}

if (mode === "verify") {
  await verifyDirectory(target, process.env);
} else {
  if (target === root) fail("build output cannot be the repository root");
  try {
    await mkdir(target, { recursive: false });
  } catch {
    fail("build output path must not already exist; choose a fresh temporary path");
  }
  try {
    for (const rel of approved.keys()) {
      const destination = path.join(target, ...rel.split("/"));
      await mkdir(path.dirname(destination), { recursive: true });
      const sourceRevision = sourceRef ?? "HEAD";
      const sourceFile = readPinnedSource(rel, sourceRevision);
      const entry = approved.get(rel);
      let output = sourceFile;
      if (entry.generated === GENERATED_KIND) {
        if (sourceFile.length !== entry.source_bytes || hash(sourceFile) !== entry.source_sha256) fail(`pinned source config hash mismatch: ${rel}`);
        output = Buffer.from(renderStagingConfig(stagingConfig), "utf8");
      }
      await writeFile(destination, output, { flag: "wx" });
    }
    await verifyDirectory(target, process.env);
  } catch (error) {
    await rm(target, { recursive: true, force: true });
    throw error;
  }
}
