const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20261030000000_schedule_background_recovery_and_outbox.sql",
);
const migration = fs.readFileSync(migrationPath, "utf8");

assert.match(migration, /create extension if not exists pg_net with schema extensions/i);
assert.match(migration, /igloue-provider-event-recovery/);
assert.match(migration, /igloue-confirmation-outbox/);
assert.match(migration, /igloue_internal_functions_base_url/);
assert.match(migration, /igloue_internal_edge_secret_key/);
assert.doesNotMatch(migration, /https:\/\/[a-z0-9-]+\.supabase\.co/i);
assert.doesNotMatch(migration, /sb_secret_[A-Za-z0-9_-]{8,}/);
assert.doesNotMatch(migration, /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\./);

console.log("Background scheduler config contains no project URL or credential values.");
