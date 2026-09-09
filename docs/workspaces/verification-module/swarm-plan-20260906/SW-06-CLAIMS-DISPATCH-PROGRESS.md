# SW-06 claims/report dispatch progress

## Scope

Added only `ai-engineer-mission-control/apps/worker/src/verification-claims-dispatch.test.ts`. Fixtures are parsed through the EV103 vendored `VerificationClaimsOperationResultSchema` and `VerificationReportOperationResultSchema` before dispatch.

## Coverage

- `review` and `abstain` map to `review_required`; `fail` maps to `quality_rejected`.
- Forged `pass` / `pass_with_warnings`, operation or request-digest drift, and missing/malformed sealed records resolve to `reconciliation_unresolved` without resubmission.
- Assertions/ledger, report, tenant, and manifest-parent correlation drift resolve to `reconciliation_unresolved`.
- Every terminal case submits once and checks the selected client method plus tenant, mission, work item, attempt, and Mission Control external-execution context.

## Evidence

- `corepack pnpm --filter @aiengineer/mission-kernel build` — exit 0.
- `corepack pnpm --filter @aiengineer/mission-worker exec vitest run src/verification-claims-dispatch.test.ts` — exit 0; 7 tests.
- `corepack pnpm --filter @aiengineer/mission-worker typecheck` — exit 0.

No Temporal, native database, provider, or live Knowledge Services call was made. This is dispatch-contract coverage, not an end-to-end proof.
