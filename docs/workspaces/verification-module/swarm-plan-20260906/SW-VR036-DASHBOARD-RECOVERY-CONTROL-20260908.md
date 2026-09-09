# VR036 dashboard retry/reconcile control — 2026-09-08

Implemented the bounded recovery slice in Mission Control Dashboard.

- `DASHBOARD_VERIFICATION_OPERATION_KNOWLEDGE_TOKENS_JSON` is optional and fail-closed. Each strict, server-owned grant binds the signed subject, tenant, mission, work item, attempt, operation, exact KS credential, service actor, and capability version.
- Allowed only exact `POST /operations/:uuid:retry|reconcile`. The BFF rejects browser bodies, derives a stable correlation/idempotency key, reads the exact operation first with the configured credential, verifies all configured scope and a verification operation kind, and then builds the complete KS `MutationEnvelope` itself.
- Manual retry is exposed only for failed `verification_replay` or `verification_extraction` operations with non-quality `VERIFICATION_INFRASTRUCTURE_FAILURE`. The receipt automatic-retry flag may be false after exhaustion; it is preserved. Provider-capable, unknown, and quality/policy failures are denied. Reconcile accepts queued/running operations.
- DTO projection and the operations inspector add truthful recovery controls. Actual eligibility remains server-enforced.

Validation:
- `corepack pnpm --filter @aiengineer/mission-dashboard test -- src/server/proxy-auth.test.ts --maxWorkers=1` — 11 files, 59 tests passed.
- `corepack pnpm --filter @aiengineer/mission-dashboard typecheck` — passed.

Native recovery is now proved by the scoped synthetic-activity fixture below. Earlier preparation had no native mutation proof; that limitation is superseded by the retained receipt.

## Dashboard mocked browser recovery controls — 2026-09-08

Added `ai-engineer-mission-control/apps/dashboard/e2e/recovery.spec.ts`: operator retry sends only the scoped recovery POST and renders upstream denial; queued reconcile is visible but disabled to viewers. No browser request carries an envelope or context. Updated isolated VR036 Playwright config to include it.

Validation: dashboard production build passed; `playwright test --config playwright.vr036.config.ts` passed 6/6 (CPH, drift, replay, recovery).

## Native recovery audit — 2026-09-08

Independently read `internal/verification-dashboard-native-recovery-08a8496f-a46d-4d94-803a-d633dce9a83b.json` and its helper. The receipt reports an explicitly synthetic callback fixture but real signed BFF, KS HTTP control, Postgres lease/receipt/reconciliation, and scoped canonical worker. It records automatic retry exhaustion (`retryable:false`), one manual retry event, reconcile, terminal success, terminal retry denial, and zero provider attempts. SHA-256: `f88eb5928f6b8baead0ef994d6fe0d4753acdcb0bf3b82aa4a696a49a6ecb1e0`.

Corrected a concrete UI mismatch: the inspector now offers retry only for the same `verification_replay|verification_extraction` plus non-quality `VERIFICATION_INFRASTRUCTURE_FAILURE` subset enforced by the BFF. Typecheck passed.


## Current-source validation — 2026-09-08T23:06:20.5001199Z

Rebuilt dashboard after the final inspector eligibility edit and ran the isolated VR036 production-start suite: build passed; Playwright 6/6 passed. Receipt: internal/verification-dashboard-vr036-current-source-validation-20260908.json.
