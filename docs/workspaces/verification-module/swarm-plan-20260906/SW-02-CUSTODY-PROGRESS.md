# SW-02 claims/report custody progress

## Scope and custody model

This ledger covers claim/report source custody and sealed terminal integration. It does not promote the slice to database parity or production acceptance.

Implemented source boundaries:

- `packages/contracts/src/verification/claims.ts`: exact claim and report-ledger contracts; report assertions bind the complete registered report handle and exact offsets; strict claim/report service, seal, and terminal operation result schemas; producer-declared report coverage is explicitly scoped.
- `packages/application/src/verification-claims.ts`: complete handle hydration, registered capture reconciliation, tenant-scoped trusted projection grants, server-bound producer/verifier principals, native projection admission, deterministic verification, and monotonic report-wide mechanical gates.
- `packages/verification/src/claims/report.ts`: citation completeness, pointer, qualifier, conflict, and cross-section failures can only strengthen a deterministic failure; semantic correctness and undeclared-claim recall remain review concerns.
- `apps/worker/src/verification-claims-sealer.ts`: canonical `sealAuditBundle` and `recordVerificationRun` flow, exact deterministic result artifact, separate signed `verification_report_result` gate, canonical recorded policy inputs/decision, full provenance closure, producer/verifier attempt separation, lease fencing, and exact recovery.
- `packages/persistence/src/verification.ts`: the existing audited recovery path now has a handle-preserving variant using the same signature/content/ownership checks; fenced content-addressed registration validates the live operation lease before registry insertion and before the object becomes available.
- `apps/worker/src/verification-claims-activity.ts`: returns the strict terminal schema, makes the exact audit manifest artifact a direct result ancestor, and uses fenced final-result registration.
- `apps/api/src/index.ts` and `apps/api/src/server.ts`: claims/report operation kinds are admitted only with ownership, tenant-scoped exact projection grants, seal grants, parser identity, and trusted runtime identity; each request is checked against the exact claims/ledger grant before enqueue.
- TypeScript client, CLI, and MCP adapters expose strict dedicated claim/report calls. Unconfigured public routes fail closed.

The permissive prototype `AuditBundleInspectionSchema` was removed. Audit bundles use the native verification seal/inspection format.

## Current verification evidence

All commands ran from `ai-engineer-knowledge-services` with Corepack pnpm 10.34.5.

| Exact command | Result |
| --- | --- |
| `corepack pnpm --filter @aiengineer/knowledge-contracts build` | exit 0; generated contracts, ESM build, declarations |
| `corepack pnpm --filter @aiengineer/knowledge-verification build` | exit 0; ESM build and declarations |
| `corepack pnpm --filter @aiengineer/knowledge-application build` | exit 0 after concurrent parse test fixes; ESM build and declarations |
| `corepack pnpm --filter @aiengineer/knowledge-persistence build` | exit 0; ESM build and declarations |
| `corepack pnpm --filter @aiengineer/knowledge-worker exec vitest run src/verification-claims-sealer.test.ts src/verification-claims-activity.test.ts` | exit 0; 2 files, 5 tests |
| `corepack pnpm --filter @aiengineer/knowledge-api build` | exit 0 |
| `corepack pnpm --filter @aiengineer/knowledge-api exec vitest run src/verification-routes.test.ts` | exit 0; 1 file, 9 tests |

The last combined worker/API batch contained one superseded worker typecheck failure because the new activity fixture used `knowledge-operation-request.v1` instead of canonical `knowledge-operation-request/v1`; the runtime tests and API checks in that batch passed. The literal is corrected and the worker typecheck rerun is pending at this ledger update.

Earlier superseded evidence retained for auditability:

- A first ordered application build failed on concurrently introduced parse digest typing; the parse owner corrected it.
- A later application/worker build failed while parse tests still used an old unfenced interface and widened `contractVersion`; those parse tests were corrected.
- One attempted command targeted the nonexistent `packages/persistence/src/verification-claims-principals.test.ts` and exited 1; `verification-metric-principals.test.ts`, which covers the shared principal implementation, subsequently passed 9 tests.
- Before the latest custody changes, package suites passed: contracts 47 tests, application 198 tests, worker 63 tests with 5 skipped, API 64 tests with 5 skipped, client 7 tests, CLI 17 tests, and MCP 18 tests with 1 skipped. These are historical results and will not be represented as validation of the final source until the final ordered rerun completes.

## Pending checks and native blockers

Pending: final worker typecheck, focused activity/sealer rerun, API route/bootstrap checks, client/CLI/MCP checks, source hashes, and independent R3 review refresh.

Native database and Storage execution remains blocked because local Docker/database control is unreachable. Migration `ai-engineer-db-contract/supabase/migrations/20260907010000_verification_claim_report_artifact_types.sql` is drafted but unapplied. No database reset, migration apply, Storage write, provider call, paid call, or environment mutation was attempted. Until the canonical migration is applied and native DB/Storage tests run, artifact-type FK parity and real transaction/object-store fencing are source-verified only and must not be claimed as accepted.

## Final focused verification update (2026-09-07)

| Exact command | Result |
| --- | --- |
| `corepack pnpm --filter @aiengineer/knowledge-worker typecheck` | exit 0 |
| `corepack pnpm --filter @aiengineer/knowledge-worker exec vitest run src/verification-claims-sealer.test.ts src/verification-claims-activity.test.ts` | exit 0; 2 files, 5 tests |
| `corepack pnpm --filter @aiengineer/knowledge-api typecheck` | exit 0 |
| `corepack pnpm --filter @aiengineer/knowledge-api exec vitest run src/verification-routes.test.ts src/bootstrap.test.ts` | exit 0; 2 files, 14 tests |
| `corepack pnpm --filter @aiengineer/knowledge-client build` | exit 0 |
| `corepack pnpm --filter @aiengineer/knowledge-client exec vitest run src/client.test.ts` | exit 0; 1 file, 7 tests |
| `corepack pnpm --filter @aiengineer/knowledge-cli typecheck` | exit 0 |
| `corepack pnpm --filter @aiengineer/knowledge-cli exec vitest run src/commands.test.ts` | exit 0; 1 file, 11 tests |
| `corepack pnpm --filter @aiengineer/knowledge-mcp typecheck` | exit 0 |
| `corepack pnpm --filter @aiengineer/knowledge-mcp exec vitest run src/catalog.test.ts src/verification-tools.test.ts` | exit 0; 2 files, 8 tests |
| `corepack pnpm --filter @aiengineer/knowledge-persistence exec vitest run src/verification-fenced-artifact.test.ts src/verification-run-recording.test.ts src/verification-metric-principals.test.ts` | exit 0; 3 files, 23 tests |
| `corepack pnpm --filter @aiengineer/knowledge-application exec vitest run src/verification-claims.test.ts` | exit 0; 1 file, 2 tests |
| `corepack pnpm --filter @aiengineer/knowledge-worker build` | exit 0 |

Independent R3 refresh passed its claims application (2), worker sealer/activity (5), and API route (9) checks. Code is stable and build ownership is released to the coordinator for the single full-workspace `corepack pnpm verify` run.

## Source SHA-256 snapshot

```text
b8fbe206cedabb2938fc0d7275c4bb4998cb64747b79572e6878701de48d9640  packages/contracts/src/verification/claims.ts
056e773eff43034eaca827647633e83cbf8927b69f2e7287d48f7143751885bb  packages/contracts/src/verification/index.ts
97ea05b84f65da5e4ce95ad71b6d7c36069522ba45c63d56b399e49103ada4ea  packages/contracts/scripts/generate-contract-artifacts.ts
ae99d50f497391cb3c8e15e3b373dad6bd43ad2a3483c54921d1bed842dae610  packages/verification/src/claims/report.ts
1834541921af787379bea135ef05158d51325ec6ffe2d5e788a0dce0825c6ebf  packages/application/src/verification-claims.ts
441337d0277c1d2077c125a78f9245ae49b6561f9b69ced95e924df41e8d52b7  packages/application/src/verification-service.ts
af590fb25d7d33fae9d133c009659ced0aa3335fd4c761549ae5a2e907e3aa58  packages/application/src/index.ts
838999c7a0ada64f4855a21e5532219e924869b8c08b21e5c03ed96a80c14683  packages/persistence/src/verification.ts
e448663e73b629a676ba15b1bfca0e3547f289e5a1eddef4ce7fc3a0bba74e3f  packages/persistence/src/verification-claims-principals.ts
47da214d062e4219060ebeb963787d3001646566d732786c8e5ea2087af53a28  packages/persistence/src/verification-fenced-artifact.test.ts
c5735481ba02eebcdbb62dc3703885d9062a1a217f6c1f9d7a8f75ac078cdab3  apps/worker/src/verification-claims-sealer.ts
ac7559fe8c9355986b7069d484ae899f755989d7d140b48e8bd26992148cfe5e  apps/worker/src/verification-claims-sealer.test.ts
d59d1d80e6c4f9d01ffb305d77cfa51690db64686fc9b28a3c03314d88cb6a87  apps/worker/src/verification-claims-activity.ts
d7d472f6ec65f055a31d05466b5cc26abb1883d3eec4d0c6ea1d2d98add16421  apps/worker/src/verification-claims-activity.test.ts
c26b4a4414d13f9ba22c62a86027819733320454196802a2cac3e0d69bfdf65d  apps/worker/src/index.ts
03306454c6d37ccb179eed0811f69c65d3bbe5cc58d1eddef432604696715271  apps/api/src/index.ts
62a4b7b1848cbf4fed2807c4ff434afaf80705e3e432a42ed5486e499a4227ec  apps/api/src/server.ts
3228a681544e4d6b9c7d05052d0ead9c8f31a85eb150a956526416353fdbc788  apps/api/src/verification-routes.test.ts
29d36d23764b357abc85aa33f64a058877fd3c3aec593951cc854ff2a5d3b652  packages/client-typescript/src/client.ts
7a01e2170525197713da43be800caba594e2b3aabaa9ac76b5b2d7bbce087b51  apps/cli/src/commands.ts
52caaba57295140b4907fa25cc49c9efa9aa2e887fb95a666816b272acedb32b  apps/mcp/src/catalog.ts
143b0cdd5d624e551acf4c8bcbf38e3ecad4afaed5a552f94c2e0762807329cd  apps/mcp/src/index.ts
```

## Native claims/report proof update (2026-09-07)

Root confirmed direct loopback PostgreSQL and Storage availability, applied migration `20260907010000_verification_claim_report_artifact_types.sql`, and installed DB contract 0.2.30 with vocabulary parity. A bounded native worker proof is being prepared with isolated operation/mission/work-item/attempt UUIDs and the already registered `verification-frozen-source-registry-7a74a7a8-0dc4-4591-8bb1-5781ebddef42.json` capture/projection custody. It will not invoke the unavailable Docker parser or inject a successful parser/provider result.

Read-only proof planning exposed one source blocker before any native mutation: claims/report capture reconciliation compares a declared capture including `canonicalProjectionArtifact` with the base capture returned by `PostgresVerificationRepository.getRegisteredCapture`. The existing metric service correctly compares the declared base capture and then independently validates the native projection admission envelope. The claims service needs the same narrow reconciliation rule before a genuine admitted projection can reach its native envelope check. This finding was sent to the coordinator; no native proof mutation has started.
