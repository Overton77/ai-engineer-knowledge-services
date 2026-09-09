# SW-02 claims/report terminal reads independent review

## R1 reviewed snapshot

This review is limited to the new typed terminal-read core. It does not accept or assess public HTTP, client, CLI, MCP, or worker composition, which remain outside this snapshot.

Reviewed files and SHA-256 values:

- `packages/contracts/src/verification/claims-report-reads.ts` — `7695016b45cbb827ba07f503b67765ba5687d242bcb780055f63b5b4d38747c7`
- `packages/application/src/verification-claims-report-reads.ts` — `502b33b0268f54a7e641463935ffbd162cac61ed2f22a42d1296b2677c58866e`
- `packages/application/src/verification-claims-report-reads.test.ts` — `6fab298e82be69a690fb2b863c78cbbfb37e36949cec4da467ed2e4312467054`
- `packages/persistence/src/verification-claims-report-reads.ts` — `54268ef97d56d5a4dfaa3ec220ec5aaa7a5c1410766b351091d39a6700324f58`
- `packages/persistence/src/verification-claims-report-reads.test.ts` — `737eef2ea687b0d26b036271c4bede4f9c50834e31b966c39abcf098aedfc43c`
- `scripts/prove-verification-claims-report-reads.ts` — `6f8f3b8293921e06ecb12814a1e0c3ddf84e486b66f5dbe57a868de750f9a0ab`

The retained positive receipt `../internal/verification-claims-report-reads-22c6b3e4-b5d6-4d34-923b-4846e37fdfaa.json` hashes to `b6f9ab763c332da4dca013783c4d24dc575ae2f2c0deeabf2cf8455cfb6bfca0`.

## Controls already present

The reader validates strict claims/report operation-result schemas, canonical retained result bytes, the full registered result handle, terminal receipt and success-event identity, decimal-string PostgreSQL fencing representation, guarded output digest, tenant-bound hydration, an exact signed audit-bundle signature, deterministic-result bytes referenced by the signed manifest, report-gate media type and native vocabulary, canonical gate bytes, and the report gate's exact deterministic-result/report/ledger three-parent closure. It snapshots terminal state again after Storage hydration. The application projection uses explicit schemas and maps malformed or nonterminal records to typed errors. The implementation calls the canonical audit inspector and does not duplicate report mechanical or policy replay algorithms.

The positive retained proof demonstrates that one genuine claims result and one genuine report result can be read from local PostgreSQL and Storage with the retained public key. It also demonstrates omission of common locator, raw-bundle, provider-response, and key strings. It does not exercise tamper paths and does not enforce a read-only SQL transaction at the database session level.

## Blocking findings

### P1 — native verification-run authority is not joined

The persistence reader accepts an operation, receipt, and signed audit bundle without joining `evidence.verification_run`. An internally consistent terminal operation can therefore reuse a different valid signed run from the same tenant, particularly when the request and deterministic result coincide. The read must bind the sealed `runId`, source `operation_id`, mission and work item, producer and verifier attempts, verification bundle, deterministic result, policy artifact and digest, run manifest and digest, contract version, and native run status to the exact `evidence.verification_run` row. It must also select and compare the operation kind and require the exact mapping `verification_claims` / `verifyClaims` / `verify_claims_and_register` or `verification_report` / `verifyReport` / `verify_report_and_register`; the current independent enums permit cross-kind combinations.

### P1 — request and signed-input closure is incomplete

The request `captureIds` are not compared with the capture set in the signed verification bundle. A claims assertions handle is hydrated and its bundle compared, but the handle is not required as an exact signed manifest input. A report result does not require `assertionsArtifact` to equal `claimLedgerArtifact`. The result `sourceArtifacts` are tenant checked only; they are not required to equal the exact unique content and projection artifact set declared by the signed captures. Remediation must require exact handle identity, not only matching parsed bundle bodies or artifact IDs.

### P2 — the public report-wide value is not compact

The contract exposes `VerificationReportWideSummarySchema` directly. That structure contains identifier arrays and nested identifier groups whose values are producer-defined strings up to 255 characters and whose cardinality can reach thousands. A compact public resource should expose the three numeric citation metrics, source-family counts, and counts for pointer failures, misplaced citations, duplicate/conflict groups, missing qualifiers, consistency/cross-section mismatches, and unsupported high-severity assertions. It should not expose the underlying identifiers or groups.

### P2 — operation-result provenance and canonical context are under-checked

The terminal result handle is content verified, but its media type, producer activity/version, retention class, data classification, parent transformation signature, and exact transformation inputs are not checked. The operation comparison also omits the persisted correlation ID normalization, causation ID normalization, ownership mode, and external run ID that are available in the operation row and already enforced by the audit-inspection read pattern. These bindings should be checked before a terminal resource is released.

## R1 conclusion

The positive path and signature/gate primitives are meaningful, but the read is not ready for public transport composition. The two P1 authority and signed-input closures must be fixed, the public report-wide payload must be reduced, and hostile tests must demonstrate rejection of run reuse, cross-kind rows, capture-set drift, alternate assertions/source handles, report ledger alias drift, result transformation drift, context drift, signature failure, manifest/result/gate tampering, event/fence tampering, terminal drift, and nonterminal or missing operations. The retained native proof should then be rerun without creating or mutating operation rows.

## Remediation checkpoint pending independent R2

Implementation ownership transferred after R1. The current source adds the required native verification-run join, exact operation family and context binding, signed request/capture/assertion/report/ledger/source closure, operation-result and report-gate provenance checks, and count-only report-wide projection. Focused application and persistence tests pass 4/4 each. A database-enforced read-only hostile proof passed thirteen controls; its immutable receipt is `../internal/verification-claims-report-reads-r2-22c6b3e4-b5d6-4d34-923b-4846e37fdfaa.json`, SHA-256 `b904c1d70453dea5bd9708601922100efda271dcc97fc8b6055861f2392732bf`. This checkpoint records implementation evidence only; the R1 conclusion remains open until an independent R2 verifies the current hashes, receipt, and negative coverage.
