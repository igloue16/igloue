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

function fail(message) {
  console.error(`Storefront release validation failed: ${message}`);
  process.exit(1);
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
  if (!/^[a-f0-9]{64}$/.test(entry.sha256 ?? "") || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0) fail(`invalid hash metadata: ${rel}`);
  approved.set(rel, entry);
}
for (const required of ["CNAME", "index.html", "reservation-portal.html", "delivery-status.html", "verify-email/index.html", "assets/js/supabase-config.js", "assets/js/assistant.js", "assets/js/calendar.js", "assets/js/service-slot-client.js", "assets/js/reservation-client.js", "assets/js/reservation-review.js", "assets/js/reservation-portal.js"]) {
  if (!approved.has(required)) fail(`required customer file is not allowlisted: ${required}`);
}

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

async function verifyDirectory(directory) {
  const actual = await walk(directory);
  const actualSet = new Set(actual);
  for (const rel of approved.keys()) if (!actualSet.has(rel)) fail(`approved file is missing: ${rel}`);
  for (const rel of actual) if (!approved.has(rel)) fail(`unapproved file is present: ${rel}`);
  for (const [rel, entry] of approved) {
    const bytes = await readFile(path.join(directory, ...rel.split("/")));
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (bytes.length !== entry.bytes || hash !== entry.sha256) fail(`size or SHA-256 mismatch: ${rel}`);
  }
  console.log(`Verified ${actual.length} allowlisted storefront files; all sizes and SHA-256 hashes match.`);
}

const target = path.resolve(requestedPath);
if (mode === "verify") {
  await verifyDirectory(target);
} else {
  if (target === root || (target !== path.parse(root).root && !target.startsWith(`${root}${path.sep}`) && !target.startsWith(`${path.resolve(process.env.RUNNER_TEMP ?? path.dirname(target))}${path.sep}`))) {
    fail("build output must be outside the source tree or within the repository");
  }
  try {
    await mkdir(target, { recursive: false });
  } catch {
    fail("build output path must not already exist; choose a fresh temporary path");
  }
  try {
    for (const rel of approved.keys()) {
      const destination = path.join(target, ...rel.split("/"));
      await mkdir(path.dirname(destination), { recursive: true });
      if (sourceRef) {
        const sourceFile = spawnSync("git", ["show", `${sourceRef}:${rel}`], { cwd: root, maxBuffer: 32 * 1024 * 1024 });
        if (sourceFile.status !== 0) fail(`source file is unavailable at ${sourceRef}: ${rel}`);
        await writeFile(destination, sourceFile.stdout, { flag: "wx" });
      } else {
        await writeFile(destination, await readFile(path.join(root, ...rel.split("/"))), { flag: "wx" });
      }
    }
    await verifyDirectory(target);
  } catch (error) {
    await rm(target, { recursive: true, force: true });
    throw error;
  }
}
