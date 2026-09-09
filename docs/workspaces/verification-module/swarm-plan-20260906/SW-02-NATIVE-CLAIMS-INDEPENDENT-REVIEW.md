# SW-02 native claims/report proof — independent review

Date: 2026-09-07  
Scope: read-only review of the unexecuted `scripts/prove-verification-claims-report-worker.ts` draft. No database, Storage, parser, provider, environment, or filesystem mutation was performed by this reviewer.

## Draft assessment

The draft exercises production implementations rather than fabricating a terminal receipt: `PostgresVerificationRepository`, `PostgresKnowledgeOperationService`, `CanonicalDurableKnowledgeWorker`, the registered claims/report activity handlers, `createVerificationClaimsAuditSealer`, native artifact storage, and `PostgresVerificationClaimsRuntimePrincipals` are composed directly. It creates a random namespace and operation/mission/work-item/attempt UUIDs, while only reading the existing frozen capture/projection closure. It does not reset or modify existing fixture rows.

It rehydrates a retained native projection through `VerificationAdmissionService` before claim construction and resolves a real selector from its stored content. The parser port always throws, so a parser invocation fails the proof; the planned receipt records zero parser/provider dispatches. The recovery scenario injects interruption only at the durable worker's `completeStep`, after actual handler/sealer result registration, then waits for expiry and has a new canonical worker recover the operation. It separately proves expired and cancelled leases reject fenced artifact registration and terminal receipt completion before a fresh worker reclaims the expired operation.

Readback is meaningful: it hydrates and parses strict claims/report terminal schemas, compares the canonical registered result bytes, verifies the signed audit bundle with a process-created Ed25519 public key, loads the persisted audit bundle, and queries `evidence.verification_run` for separated producer/verifier ownership. The report assertion deliberately requests an unavailable independent qualifier, so the proof expects a signed monotonic `fail` policy gate rather than manufacturing a pass.

## Execution gate

Do not execute this snapshot yet. The claims/report native projection port currently omits the exact `receipt.captureId === requested captureId` check found during independent source review. The draft correctly uses a genuine native receipt, but execution must wait for that production custody repair and hostile receipt test. Re-review the script after the repair because it snapshots source hashes into its durable receipt.

No other draft-level defect blocks the planned bounded proof. A successful run may establish local PostgreSQL/Storage behavior for the specified interruption, lease-expiry, cancellation, signature, and recovery paths only. It cannot establish parser execution, provider/semantic evidence, remote behavior, or untested object-store race windows.

## Snapshot

| File | SHA-256 |
| --- | --- |
| `scripts/prove-verification-claims-report-worker.ts` | `090A462A8B2394B233FAC53FB96F6C6FED085A73DAEF24FDB80547E9E0542A24` |

Expected execution command after the source gate is repaired: `corepack pnpm exec tsx scripts/prove-verification-claims-report-worker.ts`.

## Capture-ID remediation recheck

The native projection receipt now must name the requested capture ID, and the focused fixture mutates only that receipt field to prove rejection. Current source/test hashes are `3C466ADE0D4CE496B7CEDB94EDE6630A3C2C6BC003CB13DC67719B9E138C978A` and `E8CCF7DB09C5E9D3000093095C1793EE8FA92BED2D9BFAAF6AF17D60205BA01A`. The draft-level execution gate is cleared in source; retain final focused-test evidence with the execution receipt.

## Native execution correction (in progress)

First native execution reached the production report path and failed before a terminal result: `verifyReport` used concurrent report/ledger hydration, while `createTrustedArtifactResolver()` permits a single authorization/hydration ticket. This is a real integration defect (`ARTIFACT_HYDRATION_NOT_AUTHORIZED`), not a proof-environment failure. The implementation owner is converting this hydration to sequential execution and adding regression coverage; no successful native-proof conclusion may be drawn until the revised scoped checks and proof receipt are available.

## Report replay finding — P1 (2026-09-07)

`apps/worker/src/verification-claims-sealer.ts:115` seals the report result after `applyReportWideMechanicalGates` and serializes that gated result into the manifest and recorded policy inputs (`:147-156`). `packages/verification/src/provenance/replay.ts:57-70` recomputes only `verifyDeterministicBundle` and demands its digest equal the sealed deterministic result. It neither hydrates nor validates the `verification_report_result` gate artifact, report artifact, or report ledger, and never recomputes `verifyReportWide` or reapplies its mechanical gates. A genuine report whose wide gate changes the base deterministic result will fail `DETERMINISTIC_REPLAY_DRIFT`; audit inspection cannot establish an exact report replay.

Implement a report-aware replay path that hydrates exact retained report, ledger, and gate artifact; validates their complete bindings and signed gate digest; recomputes report-wide mechanics from retained inputs and replayed evidence; applies the gates before deterministic/policy digest comparisons. Add a successful native report audit-inspection case after this repair. This blocks report replay proof, but does not invalidate the separate claims recovery/lease scenarios.

## Independent post-execution audit (2026-09-07)

Receipt [`internal/verification-claims-report-worker-6649ef0a-3f32-4360-9ee3-7e9fdd11f8e1.json`](../../../../../../internal/verification-claims-report-worker-6649ef0a-3f32-4360-9ee3-7e9fdd11f8e1.json) hashes to `d752e87e4c979d442705a3196d0c9445438bd86622e4fb6fca04e0c7261e8814`. I performed a second, read-only local PostgreSQL/Storage audit and wrote [`internal/verification-claims-report-worker-independent-audit-6649ef0a-3f32-4360-9ee3-7e9fdd11f8e1.json`](../../../../../../internal/verification-claims-report-worker-independent-audit-6649ef0a-3f32-4360-9ee3-7e9fdd11f8e1.json), SHA-256 `66cc974f9aed9cc644414847f2fcc32e3e1d62f6706bf831534c13f73a509101`.

The audit independently fetched all three terminal operation-result objects, the two signed manifests, and both retained native projection artifacts from Storage; all seven existed at the recorded byte length and SHA-256. Both audit signatures verified with the receipt public key: claims run `d68fd153-e769-572e-abdc-11a480ece955` is `review`; report run `b3b7f770-48f4-576e-a446-6032c5a15805` is `failed` with retained gate digest `sha256:2415175ec228a997cfd0ec0559c3d31ec5683a96dda9eda115132ec77a086524`.

Read-only SQL found exactly four isolated operations: three succeeded with exactly one matching successful receipt and step each (two claims, one report); the cancellation operation is `cancelled` with zero receipts and zero artifacts for its producer attempt. It found exactly three verification runs, each with a producer attempt distinct from the verifier attempt and with the recorded manifest/result artifact IDs. All seven sampled artifact rows are `available`. The retained failed pre-run journal names two attempted operation IDs; neither row remains in the database, consistent with its pre-terminal collision failure. This evidence covers the six receipt checks only. It does not establish OS-crash recovery, all object-store interleavings, remote operation, semantic admission, or exact report canonical replay; the latter remains the separate P1 above.

## R5 report-aware replay and inspection recheck (2026-09-07)

The report canonical-replay P1 is closed at the reviewed source and local native-proof boundary. `verifyReportWideFromLedger` is now the single pure report-wide computation used by both `VerificationClaimsApplicationService.verifyReport` and provenance replay. `replayReportGate` requires a gate for report-only assertion bundles, rejects unexpected gates for other bundles, exact-hydrates the gate plus its two retained report/ledger parents, verifies the three-parent result/report/ledger closure and full ledger-to-signed-bundle/report bindings, recomputes the wide result from retained canonical bytes, reapplies the monotonic gates, and compares the exact typed gate body and result digest before policy replay. The worker tests include a missing-qualifier report gate replay and rejection of tampered retained gate bytes.

The r5 receipt [`internal/verification-claims-report-worker-22c6b3e4-b5d6-4d34-923b-4846e37fdfaa.json`](../../../../../../internal/verification-claims-report-worker-22c6b3e4-b5d6-4d34-923b-4846e37fdfaa.json) hashes to `68469dd00fe88c51a547cdf40fccfeeaef4119600cf26861fb580c1ceebded65` and records eight checks, including exact claims replay and exact report gate/policy replay, with zero parser/provider dispatches. The separate local facade receipt [`internal/verification-claims-report-audit-inspection-22c6b3e4-b5d6-4d34-923b-4846e37fdfaa.json`](../../../../../../internal/verification-claims-report-audit-inspection-22c6b3e4-b5d6-4d34-923b-4846e37fdfaa.json), hash `f40b21b073f13adab6ecb801c791e651cdd9c0041476304cc44bf99bb4850fa4`, records exact signed/deterministic/policy replay for both manifests and report outcome `fail`.

Reviewed source snapshot: `packages/application/src/verification-claims.ts` `058014A802D483C97C4C134854C0984918B024AC8318DD82E6FB97B1A1B691FE`; `packages/verification/src/claims/report.ts` `C590D61D6056907A7B3BF89B2EAB68EEB456E12C04A8E126386C4B8DFCD953F5`; `packages/verification/src/provenance/replay.ts` (captured through the verification build) and `packages/application/src/verification-replay.ts` `A2B6E55043E4065278154465F0DB13BE6A85BBA933C70B95291F14E279EF89E1`; `apps/worker/src/verification-claims-sealer.ts` `C5735481BA02EEBCDBB62DC3703885D9062A1A217F6C1F9D7A8F75AC078CDAB3`.

No additional replay/custody blocker was found in this bounded review. Public audit-inspection transport remains deliberately unwired (`publicTransportEnabled: false` in the facade receipt), so this is an internal application-facade proof, not public API/queue/client/CLI/MCP availability or deployment proof.

Correction to the source snapshot: `packages/verification/src/provenance/replay.ts` SHA-256 is `5003E24686C5520715AA298BB99069A86CD5B392F259CE00D788C5DFE7EC2A88`.
