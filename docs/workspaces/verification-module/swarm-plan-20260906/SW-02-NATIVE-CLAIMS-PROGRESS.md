# SW-02 native claims/report progress

## 2026-09-07 terminal read core

Owned new source only:
- `packages/contracts/src/verification/claims-report-reads.ts`
- `packages/application/src/verification-claims-report-reads.ts`
- `packages/application/src/verification-claims-report-reads.test.ts`
- `packages/persistence/src/verification-claims-report-reads.ts`
- `packages/persistence/src/verification-claims-report-reads.test.ts`

Implemented a typed terminal read boundary for `verifyClaims` and `verifyReport`. The persistence reader checks durable operation/request/step identity, tenant/actor/attempt binding, terminal receipt and event fencing/output hashes, canonical complete result bytes, result parent linkage to sealed manifest, exact artifact registrations, and a second snapshot. It hydrates the signed audit manifest; report reads locate the unique gate by retained `gateDigest`, validate canonical gate bytes and report/ledger parents, and require the report-wide body to match the terminal result.

The application reader maps only verified terminal records into locator-free resources. It exposes IDs and digests plus deterministic/report-wide summaries; it excludes object keys, full handles, raw bundles, and provider raw text. Pending, failed, cancelled, not-found, invalid, and integrity states are typed.

No package builds or tests were run: shared exports and factory wiring are deliberately deferred while Sol owns the freeze. The two focused test files cover pre-I/O identity rejection and terminal-state non-disclosure; expand them with full terminal fixtures after shared index exports are released.

Limitations: the persistence constructor requires a server-owned audit signature verifier; public routes/client/CLI/MCP exports and composition remain intentionally unwired. This source boundary is not native runtime proof.

## Reader remediation

Replaced the initial compressed persistence implementation with explicit typed methods. The reader now binds the signed audit bundle's `verificationBundle` to the exact hydrated claims artifact/report ledger and its deterministic result to the sealed deterministic-result artifact and terminal verified output. Report gates require one signed output reference, canonical bytes, matching report-wide body/digest, exact three-parent closure, and native artifact type `verification_report_result` in the `ledger` bucket. Terminal fence comparison follows persisted canonical decimal-string encoding.

The public deterministic projection is now an allowlisted status/count/code summary. It omits assertion evidence, selector resolutions, individual check details, deployment identity, raw artifacts, and storage locators.

Focused evidence:
- `corepack pnpm --filter @aiengineer/knowledge-contracts build` — exit 0
- `corepack pnpm --filter @aiengineer/knowledge-application build` — exit 0
- `corepack pnpm --filter @aiengineer/knowledge-persistence typecheck` — exit 0
- `corepack pnpm --filter @aiengineer/knowledge-application exec vitest run src/verification-claims-report-reads.test.ts` — exit 0, 2 tests
- `corepack pnpm --filter @aiengineer/knowledge-persistence exec vitest run src/verification-claims-report-reads.test.ts` — exit 0, 1 test

Limitation: the current focused tests cover invalid identity and state disclosure; retained signed terminal positive/tamper fixtures still need expansion before public transport wiring.

## Read-only retained native proof

`corepack pnpm exec tsx scripts/prove-verification-claims-report-reads.ts` exited 0. Receipt: `internal/verification-claims-report-reads-22c6b3e4-b5d6-4d34-923b-4846e37fdfaa.json`, SHA-256 `b6f9ab763c332da4dca013783c4d24dc575ae2f2c0deeabf2cf8455cfb6bfca0`.

It used real local r5 PostgreSQL and Storage records for claims and report terminal operations, the retained server public key, the typed reader, and a read-only SQL count check. It verified compact claims/report responses, signed manifest references, report-gate reference, absence of locator/raw-bundle/provider/key terms in output, and no operation creation for a missing operation. Parser/provider dispatch counts were zero.

This receipt is not yet proof of injected manifest/gate/receipt tamper paths; those negative fixtures remain required.

## Terminal-read custody remediation and hostile proof

The independent R1 findings are remediated in the core reader. Durable operation and step schemas now discriminate claims from reports instead of accepting independent kind/use-case/name enums. The reader compares operation kind and all canonical operation-context columns, validates the result artifact's fixed producer/media/retention/classification/transformation identity, joins the exact `evidence.verification_run`, and binds its operation, mission/work, producer and verifier attempts, contract and policy versions, bundle, deterministic result, policy artifact, signed manifest, digest columns, and native outcome.

Signed-input closure now requires the request capture set to equal the signed bundle capture set, every exposed source handle to equal the unique signed content/projection set, claims assertions to be an exact signed input, and report assertions to equal the requested/signed claim ledger. Report and ledger handles are exact signed inputs, and the report gate retains its exact signed three-parent closure and canonical transformation signature. The public report-wide projection now exposes numeric measures and counts only; it omits all producer-supplied assertion, citation, pointer, and group identifiers.

Focused checks completed with exit `0`:

- `corepack pnpm --filter @aiengineer/knowledge-contracts build`
- `corepack pnpm --filter @aiengineer/knowledge-application typecheck`
- `corepack pnpm --filter @aiengineer/knowledge-persistence typecheck`
- `corepack pnpm --filter @aiengineer/knowledge-application exec vitest run src/verification-claims-report-reads.test.ts` — 4/4
- `corepack pnpm --filter @aiengineer/knowledge-persistence exec vitest run src/verification-claims-report-reads.test.ts` — 4/4
- `corepack pnpm --filter @aiengineer/knowledge-application build`
- `corepack pnpm --filter @aiengineer/knowledge-persistence build`

The database-enforced read-only native proof `corepack pnpm exec tsx scripts/prove-verification-claims-report-reads.ts` completed with exit `0`. Receipt: `../internal/verification-claims-report-reads-r2-22c6b3e4-b5d6-4d34-923b-4846e37fdfaa.json`, SHA-256 `b904c1d70453dea5bd9708601922100efda271dcc97fc8b6055861f2392732bf`. Its thirteen controls cover genuine compact signed claims/report reads plus in-memory hostile views for native-run reuse, cross-kind rows, terminal event fencing, source-set drift, request capture-set drift, report ledger aliasing, report-gate bytes, and signature rejection. It created and mutated no native row or Storage object and made zero parser/provider dispatches.

## Public audit runbook

Added SW-02-PUBLIC-AUDIT-OPERATOR-RUNBOOK.md from frozen API, CLI, MCP, and EV111 source. It uses placeholders only and names no credentials or human identities.

Runbook corrected: wire route uses one colon; added reads flag, API read prerequisites, worker key-array schema, and knowledge_get_audit_inspection.

## Independent R2

Read-only R2 recorded in SW-02-CLAIMS-REPORT-READS-INDEPENDENT-REVIEW-R2.md: R1 core P1/P2 findings closed; hostile proof limits explicitly retained.

Independent retained hostile proof execution: exit 0; receipt ../internal/verification-claims-report-reads-independent-20260907-r2.json; SHA-256 904c1d70453dea5bd9708601922100efda271dcc97fc8b6055861f2392732bf; 13 checks.

Public transport independent review/execution: SW-02-CLAIMS-REPORT-PUBLIC-READS-REVIEW.md; exit 0, 11 checks; independent receipt ../internal/verification-claims-report-read-transports-independent-20260907-r1.json, SHA-256 6219798a866eda8715e8cd482dc4fdeaec5375feb3dfae82782589954f0e2e3.
