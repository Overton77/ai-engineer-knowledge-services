# WS-10 Temporal worker-loss recovery handoff

## Helper scope — 2026-09-05

`ai-engineer-mission-control/scripts/prove-verification-temporal-recovery.ts`
exports `proveVerificationTemporalRecovery`. It proves the accepted/queued
worker-loss path against the local Temporal server at `127.0.0.1:7233`,
namespace `verification-local`.

The caller provides a fresh tenant/attempt, the real authenticated API and
metric request, a paused Knowledge Services worker, an exact ownership grant,
and callbacks that observe a real queued operation and resume the real service
worker. The helper starts an actual Mission worker child using Node plus `tsx`
against `apps/worker/src/index.ts`, on a workflow-specific task queue. Its
window is hidden and stdout/stderr are retained in a unique shared-workspace
`internal/` log. It explicitly removes inherited Temporal Cloud API-key
variables from the child environment before supplying local Temporal settings.

Once the API reports the operation queued, the helper confirms the original
Mission worker is alive, force-terminates it with `SIGKILL`, and confirms exit;
it does not send a graceful cancellation. It then creates a replacement Worker
on the same queue with the normal runtime factory/workflow path, resumes the
Knowledge Services worker, and requires a terminal quality pass for the exact
original operation ID. The public API must report that same operation as
`succeeded`; a new or orphaned operation fails the proof.

The helper saves standalone workflow history and an immutable receipt with
source hashes under the shared parent-workspace `internal/` directory, confirms
the bearer token is absent from history, and runs `Worker.runReplayHistory`.
It counts exact `EVENT_TYPE_ACTIVITY_TASK_STARTED` events in retained history
as retry evidence, accepting either multiple starts or a final started event
whose recorded attempt is at least two; missing retry evidence fails the proof.
It returns this bounded check alongside accepted queue, forced loss,
replacement, reconciliation, compact outcome, and replay checks in
`{ checks, operationId }`, so the coordinator can perform its separate
one-operation-per-attempt database assertion.

All paths are bounded at two minutes or less per workflow. The helper stops its
original child, shuts down its replacement Worker, and closes Temporal
connections in `finally`. It only calls replacement `shutdown()` while its SDK
state is `INITIALIZED` or `RUNNING`, avoiding a second shutdown after
`runUntil`. It does not restart the Temporal server, reset data, or make
provider/remote calls.

## Coordinator recovery run review — 2026-09-05

The first real SIGKILL/replacement run completed the original operation, but the helper's retry-evidence assertion failed because it compared the SDK's numeric history event type to the JSON enum name. Failed run log: `internal/verification-temporal-recovery-run-a2630e08-d8b0-4413-9f3a-2e565907c137.log`. The coordinator independently fetched workflow `verification-recovery-6aeac62b-c647-4ad0-acf1-23368c95c165` from the live local Temporal server; retained history `internal/verification-recovery-failed-history-6aeac62b.json` reports activity attempt 2. The check now selects the actual activity-start attributes, which are present in both SDK and JSON representations, and retains the requirement for attempt >=2 or two starts. A new complete proof run is underway; the failed assertion was not reported as a passing receipt.

## Coordinator acceptance — 2026-09-05

EV-045 accepts the actual SIGKILL/replacement proof after the corrected run. Receipt `internal/verification-temporal-recovery-9ca2ed04-916c-4cb5-ae78-886eae4396a5.json` and independent audit `internal/verification-temporal-recovery-audit-195cea67-81ff-46ae-97d2-73b3ef306a84.json` prove the original operation succeeded exactly once after a retried Temporal activity, with retained history and replay. The aggregate metric/runtime/Temporal proof now passes 29 checks. Scope remains bounded as recorded in the evidence log.
