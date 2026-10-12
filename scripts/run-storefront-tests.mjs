import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siteFlag = process.argv.indexOf("--site");
const site = siteFlag >= 0 ? path.resolve(process.argv[siteFlag + 1] ?? "") : null;
if (!site) throw new Error("Usage: node scripts/run-storefront-tests.mjs --site <verified-site-directory>");

const storefrontTests = [
  "alternative-availability-v1.test.js",
  "assistant-availability-dom-v1.test.js",
  "availability-client-v1.test.js",
  "availability-integration-v1.test.js",
  "availability-v1.test.js",
  "customer-details-v1.test.js",
  "customer-email-verification-v1.test.js",
  "email-verification-v1.test.js",
  "reservation-attempt-v1.test.js",
  "reservation-client-v1.test.js",
  "reservation-lifecycle-v1.test.js",
  "reservation-portal-breakdown.test.js",
  "reservation-portal-date-change.test.js",
  "reservation-portal-extension.test.js",
  "reservation-review-v1.test.js",
  "reservation-submit-v1.test.js",
  "service-slot-client-v1.test.js",
  "supabase-config-v1.test.js",
];

const temp = await mkdtemp(path.join(os.tmpdir(), "igloue-storefront-cleanroom-"));
try {
  await cp(site, temp, { recursive: true });
  const testsDir = path.join(temp, "tests");
  await mkdir(testsDir);
  for (const file of storefrontTests) {
    await cp(path.join(root, "tests", file), path.join(testsDir, file));
  }

  const regression = spawnSync(process.execPath, ["--test", ...storefrontTests.map((file) => path.join("tests", file))], {
    cwd: temp,
    stdio: "inherit",
  });
  if (regression.status !== 0) throw new Error(`Clean-room customer regression suite exited ${regression.status ?? "without a status"}`);

  const releaseBoundary = spawnSync(process.execPath, ["--test", "tests/storefront-release.test.js"], {
    cwd: root,
    stdio: "inherit",
  });
  if (releaseBoundary.status !== 0) throw new Error(`Release boundary suite exited ${releaseBoundary.status ?? "without a status"}`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
