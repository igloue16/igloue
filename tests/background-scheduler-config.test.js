const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20261030000000_schedule_background_recovery_and_outbox.sql",
);
const migration = fs.readFileSync(migrationPath, "utf8");
const helperStart = migration.indexOf(
  "create function private.enqueue_internal_edge_call",
);
const helperEnd = migration.indexOf("\n$$;", helperStart);
const helper = migration.slice(helperStart, helperEnd);
const correctiveMigration = fs.readFileSync(
  path.join(
    process.cwd(),
    "supabase/migrations/20261101000000_fix_background_scheduler_secret_auth.sql",
  ),
  "utf8",
);
const correctiveStart = correctiveMigration.indexOf(
  "create or replace function private.enqueue_internal_edge_call",
);
const correctiveEnd = correctiveMigration.indexOf("\n$$;", correctiveStart);
const correctiveHelper = correctiveMigration.slice(
  correctiveStart,
  correctiveEnd,
);

assert.match(
  migration,
  /create extension if not exists pg_net with schema extensions/i,
);
assert.match(migration, /igloue-provider-event-recovery/);
assert.match(migration, /igloue-confirmation-outbox/);
assert.match(migration, /igloue_internal_functions_base_url/);
assert.match(migration, /igloue_internal_edge_secret_key/);
assert.match(helper, /'Content-Type',\s*'application\/json'/);
assert.match(helper, /'apikey',\s*v_edge_secret_key/);
assert.doesNotMatch(helper, /Authorization/i);
assert.match(correctiveHelper, /'Content-Type',\s*'application\/json'/);
assert.match(correctiveHelper, /'apikey',\s*v_edge_secret_key/);
assert.doesNotMatch(correctiveHelper, /Authorization/i);
assert.doesNotMatch(migration, /https:\/\/[a-z0-9-]+\.supabase\.co/i);
assert.doesNotMatch(migration, /sb_secret_[A-Za-z0-9_-]{8,}/);
assert.doesNotMatch(migration, /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\./);

console.log(
  "Background scheduler config contains no project URL or credential values.",
);
