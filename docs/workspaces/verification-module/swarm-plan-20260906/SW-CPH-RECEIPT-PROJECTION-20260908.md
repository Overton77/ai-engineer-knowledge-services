# CPH receipt projection — 2026-09-08

Implemented a bounded CPH receipt read surface through Mission Control and the dashboard. Mission Control exposes `GET /v1/verification/cph/receipts` only after bearer authentication, tenant/mission headers, and a read grant. The configured CPH catalog is a strict server-side allowlist (`MISSION_CPH_RECEIPTS_JSON`) of receipt ID, operation ID, tenant/mission/work-item/attempt scope, label, and `real`/`stand_in` provenance. The adapter reads the existing Knowledge Services operation and receipt resources, checks exact scope and receipt membership, and projects only compact receipt metadata and input/output digests; upstream receipt bodies/private fields are stripped.

The dashboard allowlist admits only this GET route, forwards the signed session tenant and mission to Mission Control, and renders the compact projection. Missing configuration remains an explicit unavailable response; no arbitrary path or internal file read is introduced. Cross-tenant headers, malformed catalog rows, upstream scope mismatch, and raw/private fields are covered by focused route/proxy tests.

Files: `ai-engineer-mission-control/apps/api/src/cph-receipts.ts`, `apps/api/src/verification-http.ts`, `apps/api/src/runtime.ts`, `apps/api/src/verification-http.test.ts`, `apps/dashboard/src/server/allowed-paths.ts`, `apps/dashboard/src/server/proxy-auth.test.ts`, and `apps/dashboard/src/features/harness/cph-page.tsx`.

Validation was blocked after the workspace package manager removed/recreated `ai-engineer-mission-control/node_modules` and stopped on the pre-existing frozen-lockfile override mismatch (`ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`). No lockfile or production database changes were made.

## Root correction and validation

Restored453 packages using pinned pnpm10.34.5 from the MC working directory, offline/frozen-lockfile/ignore-scripts; no lockfile change. Global pnpm11 commands from the parent directory caused the interruption. Future commands must use `corepack pnpm` with MC as their working directory.

Root strengthened the projection before acceptance: bounded256KiB upstream response and10s shared fetch deadline; exact receipt ID, operation kind and attempt checks; capability filtering; strict UUID/digest/time projection; recorded component provenance; and actual Temporal workflow/operation/receipt binding. Added nine custody/boundary tests, with18 focused API tests total passing and typecheck passing. Added the missing dashboard DTO branch through Terra and expanded the view with component provenance and workflow navigation. Terra ran56 dashboard tests, typecheck, production build and4/4 isolated mocked browser tests; independent API-contract review passed.

Native retained-Cursor proof passed real KS HTTP/Postgres reads plus actual Temporal Cloud execution read and MC401/403/200 responses. Receipt `internal/verification-cph-native-read-627e7109-217b-4d66-8bdf-aea3a0e2f84f.json`, SHA256 `cfce67da20dfad826a679b6e06e6ab93aad0136be261433c3fb1b1fa7245e69b`. No new workflow/provider call/database mutation; all proof connections/servers closed. The exact non-secret catalog is retained alongside it. This validates the receipt read feature, not the missing Eve primary lane or paired CPH experiment.
