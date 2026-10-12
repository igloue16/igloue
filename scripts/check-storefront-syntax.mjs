import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const flag = process.argv.indexOf("--dir");
const directory = flag >= 0 ? path.resolve(process.argv[flag + 1] ?? "") : null;
if (!directory) throw new Error("Usage: node scripts/check-storefront-syntax.mjs --dir <verified-site-directory>");

const { files } = JSON.parse(await readFile(path.join(root, "release", "storefront-manifest.json"), "utf8"));
const javascript = files.filter((entry) => entry.path.endsWith(".js"));
for (const entry of javascript) {
  const result = spawnSync(process.execPath, ["--check", path.join(directory, ...entry.path.split("/"))], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`Syntax-checked ${javascript.length} allowlisted browser JavaScript files.`);
