# VR025 Cloud lifecycle acceptance audit — 2026-09-08

Scope: read-only reconciliation of VR025 against the authoritative specification, retained local lifecycle proofs, retained Temporal Cloud EV-158 evidence, and current Mission Control activity/dispatch source. No Cloud calls, database writes, provider calls, or source edits were performed.

## Verdict

**VR025 remains partial.** The Cloud proof establishes one real Temporal Cloud workflow through the exact local Knowledge Services worker, typed terminal custody, duplicate-start rejection, and history replay. It does not establish the remaining Cloud lifecycle branches required by the row. The `review_required` terminal is an intentional semantic/policy outcome and is not an orchestration defect.

## Evidence already proved

- The matrix's VR025 row is “Temporal/Mission Control dispatches capabilities with idempotency, cancellation, retry classification, and reconciliation”; its evidence asks for workflow replay, duplicate, cancellation, and worker-loss tests (ACCEPTANCE-MATRIX.md line 33).
- Local EV-044/EV-048 and the retained cancellation receipt prove accepted/queued cancellation, unknown-operation/lost-response cancellation, public cancellation, and local history replay. EV-045/EV-121 add local worker-loss/idempotent recovery and browser-launched duplicate/replay coverage. The matrix explicitly retains VR025 as partial for Cloud/production scope and complete capability inventory (lines 81, 85, 90, 269).
- EV-158 proves actual Cloud completion, duplicate start rejection, typed result, and history replay. Its own limitations state that Cloud final-scope cancellation/recovery is not demonstrated.

## Exact remaining Cloud proof

One bounded Cloud acceptance run can close the missing lifecycle branches if it retains the same source/fixture hashes and operation identity binding:

1. **Cancellation:** start the actual report host on a unique Cloud queue/workflow; wait until the activity is scheduled or heartbeating; issue the authorized workflow cancel; retain Cloud history showing cancel request, activity cancellation, and terminal workflow completion. Read the local operation and typed receipt and require `cancelled`, the same tenant/operation/idempotency/correlation identity, no provider dispatch, and no post-cancel terminal success.
2. **Worker loss and retry classification:** launch the same workflow with the report host worker in a separately stoppable child process. After activity dispatch/heartbeat, terminate only that worker, then restart a worker on the same queue. Require Cloud history to show an activity retry with a later attempt and the same request digest/idempotency key, and require one reconciled terminal operation/receipt with no duplicate provider side effect. Inject one bounded infrastructure failure to prove the activity wrapper's `ApplicationFailure.retryable` classification, then one deterministic request/contract failure to prove `ApplicationFailure.nonRetryable`; completed quality/review outcomes must not blind-retry.
3. **Reconciliation:** after the worker-loss and cancellation branches, independently read the operation, receipt, and Cloud history; require either one authenticated terminal receipt or a typed `reconciliation_unresolved` result with phase and operation identity. A successful run must show no orphaned queued/running operation and no second operation for the stable idempotency key.
4. **Replay and custody:** replay both new Cloud histories with the frozen workflow source, verify exact source hashes, and retain decoded-history secret scans. Keep Cloud namespace/queue/workflow, local KS operation, terminal artifact/receipt, history, and source manifest in one immutable evidence receipt.

Current source supports this sequence: the workflow sets `WAIT_CANCELLATION_COMPLETED` and three activity attempts (verification-workflow.ts lines 5–10); `executeVerification` converts cancellation into non-cancellable cleanup, maps infrastructure errors to retryable ApplicationFailure and request errors to non-retryable (verification-activities.ts lines 13–50); dispatch retries exact idempotent submission and returns typed reconciliation phases (mission-kernel verification-dispatch.ts lines 212–260, 351–368); runtime cancellation binds the same operation and a `:cancel` idempotency suffix (verification-runtime.ts lines 36–45).

The practical host path is the existing actual-report host's deferred/startable Knowledge worker (`startVerificationCloudAgentReportHost`), with a small test-only child-process boundary for worker termination. This is the minimum additional Cloud evidence; semantic quality, human review, provider quality, tunnels, and dashboard promotion are outside VR025.

## Source/evidence hashes

- ACCEPTANCE-MATRIX.md: e31e1ffb0fac24537a613f6faecf0e68d8e83f7f484dc32ea8e0caea1ec5e62b
- verification-module.md: 4d21db8cb5efdf361d8f50b0459c493b12c5b5c301ee6f9e72660b85d6566fee
- verification-activities.ts: f1c57ce85cc836fc66f3c7f937fb1a719e2e20d78ad5ba4eeeb3032a7f85f987
- verification-workflow.ts: 83957d6d19ae240eb66a7d687979d5b52deb70d530c880812e509fa7ebd0c75a
- verification-runtime.ts: 85a5b9bb8a8541a29d5064f3404934a3dffe95271196a228b71e6613abd90d37
- mission-kernel verification-dispatch.ts: 10e00ccccf13d821904cce7d340cf0c155ea7327fa083d59218dde0dbd7461f4
- EV-158 aggregate: 80da3f0e57af7bd03f76ee1225df011134b9a822f9a94950eb36577c813c1312
- retained Temporal Cloud proof: 5d68b6086078a5a88fb8d1f5918dd295a36f169da3f16cb4c43bb92bc1969e97
- retained local cancellation proof: 71af5fba10de6191f03b861c0f7e4d7bde4904e4471afc577879638f0d76aa24
- EV-121 aggregate: 68857c00e6a51ba0297a86c713ed21269a58b6a1e7d5f732fc6dad7193ee74cf

Receipt: internal/verification-vr025-cloud-lifecycle-audit-20260908.json
