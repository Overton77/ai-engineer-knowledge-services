# SW-02 independent review R3

Date: 2026-09-07  
Scope: read-only refresh of the two R2 P1 findings in claims/report API admission and final result custody. No database, Storage, provider, or environment-secret action was performed.

## Source snapshot

| File | SHA-256 |
| --- | --- |
| `packages/persistence/src/verification.ts` | `838999C7A0ADA64F4855A21E5532219E924869B8C08B21E5C03ED96A80C14683` |
| `apps/worker/src/verification-claims-activity.ts` | `D59D1D80E6C4F9D01FFB305D77CFA51690DB64686FC9B28A3C03314D88CB6A87` |
| `apps/api/src/index.ts` | `03306454C6D37CCB179EED0811F69C65D3BBE5CC58D1EDDEF432604696715271` |
| `apps/api/src/server.ts` | `62A4B7B1848CBF4FED2807C4FF434AFAF80705E3E432A42ED5486E499A4227EC` |

## R2 finding disposition

### API admission: source-level fix verified

The API now rejects enabled claims/report configuration unless projection grants, seal-policy grants, trusted ownership context, and worker-runtime identity configuration are all present and syntactically valid (`apps/api/src/index.ts:83-98`). It creates a server-owned projection grant catalog and provides `isClaimsRequestAdmitted` only after successful configuration. The claim/report routes require that callback and reject ungranted assertion/ledger handles before enqueue (`apps/api/src/server.ts:572-573`).

The focused route test includes denied no-enqueue and admitted cases. This closes the R2 source defect: a configured API cannot expose these routes solely from the old enable flag. It is still a deployment requirement to run an actual worker with matching grants; configuration/unit tests cannot prove worker availability or cross-process configuration coherence.

### Final operation-result artifact fencing: source-level fix verified

The activity now calls `registerFencedContentAddressedArtifact` and passes the exact worker step ID, lease token, fencing token, and holder identity (`apps/worker/src/verification-claims-activity.ts:45`). The persistence wrapper derives the content-addressed handle, checks the live operation/attempt/lease before reuse, and passes the same fence into `registerArtifact`. `registerArtifact` performs the live-lease check inside both the pending-registration transaction and the available-state transition transaction (`packages/persistence/src/verification.ts:181-260,280-304`). The activity test asserts fence propagation and sealed-manifest ancestry.

This closes the R2 missing-fence source finding. A native Postgres concurrency proof is still required: force cancellation and natural lease expiry after the precheck, during object write, and at the available-state transition; verify no available terminal artifact can be published or reused by the stale claimant. Mock tests cannot establish transaction/lease linearization or object-write orphan recovery.

## Other reviewed invariants retained

- Claims/report requests remain artifact ID/digest-only and runtime identity remains server-owned.
- Report ledger preserves exact assertion/bundle bijection and derives pointer and semantic/authority states server-side.
- The sealer records a deterministic-only decision and forbids policy pass, with complete parent closure and run recovery binding.
- The API response remains the strict accepted-operation DTO; internal full handles are not returned by the submit routes.

## Independent command evidence

All commands used Corepack pnpm 10.34.5 and exited 0:

1. `corepack pnpm --filter @aiengineer/knowledge-contracts build`
2. `corepack pnpm --filter @aiengineer/knowledge-application build`
3. `corepack pnpm --filter @aiengineer/knowledge-application exec vitest run src/verification-claims.test.ts` — 1 file, 2 tests passed.
4. `corepack pnpm --filter @aiengineer/knowledge-worker exec vitest run src/verification-claims-sealer.test.ts src/verification-claims-activity.test.ts` — 2 files, 5 tests passed.
5. `corepack pnpm --filter @aiengineer/knowledge-api exec vitest run src/verification-routes.test.ts` — 1 file, 9 tests passed.

These are source and fixture proofs. They do not establish native SQL/object-store concurrency, a deployed worker, or end-to-end public operation execution.

## Base-capture/projection reconciliation refresh (2026-09-07)

The native-base-capture correction is present: when the registered capture has no `canonicalProjectionArtifact`, claim/report reconciliation compares the declared capture with that caller-supplied projection removed. The projection remains independently hydrated and passed through the configured native admission port, so this change permits the native persistence representation without trusting the caller projection as part of the base registration. The new focused fixture covers that positive path and projection-handle drift.

### P1 — native receipt capture identity is not checked

`VerificationClaimsApplicationService.#admitNativeProjections` validates the native receipt source and projection handles, but omits `hydrated.receipt.captureId === capture.captureId`. The equivalent metric implementation checks this exact field. A faulty or compromised admission-port response can therefore bind matching handles under another capture ID, while the claims closure records the requested capture ID. Require the receipt capture ID to equal the requested capture ID and add a hostile mismatched-capture test before treating projection custody as closed.

Snapshot: `packages/application/src/verification-claims.ts` SHA-256 `8F81D10BD43E8F8F737D52EB4DD5FB37F1D9AD2A14644A8BB8F3332B756A873D`; `packages/application/src/verification-claims.test.ts` SHA-256 `BCEE302AAEB944C7373755EC837CF765BD69E53042932CF2747E7D48BC508A74`.
