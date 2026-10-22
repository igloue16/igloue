# Storefront Booking Recovery — Staging Release Proposal (Session 34)

## Provenance and worktrees

- Development repository: `igloue16/igloue-platform`.
- PR #49 source merge: `abd332ee6fb13e7ea52eb5056bfc108a91eb194d` (feature commit `67dab96a34af38d2e2acc9981b9156731cc33e6e`).
- Publisher repository: `igloue16/igloue`.
- Publisher base: `eaed3a50bc928d8232401b45518fb8658afcd98a`.
- Local release branch: `codex/staging-storefront-booking-recovery-20261023`.
- Publisher and development files have diverged. The PR patch did not apply cleanly to the publisher's newer customer flow. Only the three PR #49 behaviors below were ported; publisher-only edits were preserved.

## Exact storefront files in the artifact

Only these three existing allowlisted paths change. SHA-256 values and byte counts are for the Git-normalized UTF-8 file content recorded by `release/storefront-manifest.json`:

| Path | SHA-256 | Bytes |
| --- | --- | ---: |
| `assets/js/assistant.js` | `6325225d1cbf3a5a7b959c5fd5c00fa233d8bbaa265393b764a10ecfc5b1f444` | 124314 |
| `assets/js/availability-client.js` | `c295600d24530fc720be732e3c33e1120441d8219f796d293ac89ce5a8db2ca1` | 2801 |
| `assets/css/assistant.css` | `f0191120b72754fa639dd216cc9533a8cdda9205bd08ae6186a2976f57f77dcb` | 54743 |

The release allowlist remains 59 files. The release changes no page, `CNAME`, Supabase config source or environment value. The new test and internal documentation files are outside the Pages artifact; admin files remain outside the existing allowlist. `assets/js/supabase-config.js` remains generated at build time by the existing staging-only builder.

## Staging build dependencies and protections

Publisher CI must supply `IGLOUE_STOREFRONT_BUILD_TARGET=staging`, `IGLOUE_STOREFRONT_STAGING_SUPABASE_URL`, and `IGLOUE_STOREFRONT_STAGING_SUPABASE_PUBLISHABLE_KEY`. The builder pins the URL to the staging project, accepts only a publishable-key format, rejects production Supabase variables, and emits a hostname-gated config for `test.igloue.fr` and `test.app.igloue.eu`. No credential values are stored in this document.

The `igloue16/igloue` Pages workflow is restricted to a successful `Frontend CI` run caused by a push to that repository's `main`; a pull-request CI run cannot deploy. The `github-pages` environment allows only `main`, requires owner review, and has `can_admins_bypass=false`. Production automatic deployments are separate from this workflow; the repository Pages custom domain is `test.igloue.fr`. The production `igloue.fr` host is not in the generated staging config allowlist.

## Verification

- `node tests/availability-client-v1.test.js`: passed, including the 12-second abort path and timeout fallback when `AbortController` is unavailable.
- Publisher Frontend CI initially exposed a browser-like release-test context without `AbortController`; the client now supports that context while retaining the bounded timeout. The regression is covered by the focused client test; CI rerun is pending.
- `node tests/assistant-availability-dom-v1.test.js`: passed, including unit switching, selection retention, retry and stale-response handling.
- Clean-room artifact test run: 30 subtests across 18 storefront test files passed. The source-tree Supabase config test expects generated staging configuration and is therefore run against the generated artifact.
- `node scripts/build-storefront-release.mjs verify --dir <proposal-artifact>`: passed; all 59 allowlisted files matched, including generated staging config using a synthetic publishable-key fixture.
- `node scripts/check-storefront-syntax.mjs --dir <proposal-artifact>`: passed; 25 allowlisted browser JavaScript files syntax-checked.
- `git diff --check`: passed.
- The commit-pinned release suite must pass in publisher Frontend CI before merge.
- No real browser walkthrough, booking, email or payment was performed.
## Approval and rollback

After a reviewed release PR is merged into `igloue16/igloue:main`, a successful main-push `Frontend CI` run builds and verifies the artifact. The separate `Publish reviewed storefront artifact` workflow then waits at the `github-pages` environment for required owner approval before deployment. No deployment is authorized by this preparation.

Rollback uses the existing `workflow_dispatch` path on publisher `main` with `confirm_rollback=true`. It rebuilds the pinned `release/storefront-rollback-manifest.json` artifact and is subject to the same required environment approval. The existing allowlist and generated staging configuration keep rollback scoped to the staging storefront.

## Remaining release requirement

Run a real desktop and mobile browser walkthrough of switching units, retaining date/slot choices, retrying a failed check, receiving a confirmed unavailable result, and proceeding to customer details only after current availability confirmation. The available session tooling does not provide a browser, so deployment readiness remains **NO-GO** until that verification is completed.
