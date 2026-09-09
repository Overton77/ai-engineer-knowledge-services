# SW-VR036 implementation gap audit — 2026-09-08

Status: **partial**. This read-only audit made no application, database, Cloud, provider, or test changes. It does not alter the acceptance matrix.

## What is already durable

Mission Control exposes authenticated, tenant- and mission-scoped launch, read, and cancel actions for verificationWorkflow. The dashboard uses that API through its server proxy and does not write orchestration or evidence tables directly. The launcher can submit replayVerificationRun as a generic, producer-supplied dispatch body; the live view can cancel a running workflow.

Knowledge Services separately has the durable selected-run replay use case. It is absent from the dashboard allowlist and has no selected-run control.

## VR036 gaps that are concrete engineering

1. **Selected-run replay.** Add a dashboard server projection/control that starts only the existing KS replay route after authenticated tenant ownership and replay-capability checks. It needs a generated idempotency key, compact accepted/terminal projection, and truthful disabled/denied/unavailable states. Do not accept a browser-provided source request or derive a replay locally. This is now the next bounded implementation slice.
2. **Retry/reconcile.** Neither the MC execution port nor the dashboard has a durable retry/reconcile command. This needs an explicit MC command contract tied to an existing workflow/operation and recovery semantics before a button is added.
3. **Verification promotion and suspension.** No verification-specific durable command, capability, or dashboard route exists. Existing generic knowledge promotion records do not establish verification promotion. A future proposal/decision control can be engineered, but final promotion stays human-authorized and must not be automated.
4. **Execution discovery.** The live page requires a workflow ID because MC does not expose an execution list. A tenant-scoped compact receipt/execution projection would make existing launch/cancel/replay controls discoverable without exposing grants, leases, credentials, or raw workflow history.

The larger Mission Control graph/compiler/revision/spawn/command/peek system is intentionally outside the CPH/VR036 verification requirement. It is not a prerequisite for the existing verificationWorkflow command surface.

## CPH / Eve reconciliation against 02 §3.4

The retained Eve evidence proves a KS-direct runtime/admission boundary, not Eve to Mission Control to Temporal Cloud. EV-135 explicitly excludes Temporal/full Eve rollout; EV-136 also excludes Temporal. The authored Eve runtime builds KnowledgeClient from KNOWLEDGE_API_BASE_URL and calls KS claims:verify / reports:verify routes; it has no MC execution transport or MC workflow-ID read path. The narrow CPH HTTP bridge is only a planned local upstream boundary and its receipt expressly has productionOrCloudAcceptance false.

Therefore the full CPH primary lane is unproved. The verified direct-KS path is a permitted **degraded lane only** if labeled as such.

Section 3.4 still requires, for each Cursor and Eve lane: a registered restricted transcript, report artifact, assertion ledger, KS operation IDs, MC workflow ID, receipt, and short review; then one benchmark-comparison artifact over identical frozen inputs that records claim outcomes, cost, latency, and deterministic failures. Existing promoted matrix rows and the Cursor/Cloud evidence do not supply the required Eve MC workflow, paired identical-input comparison, or CPH receipt closure.

The authored Eve tool can target the existing MC adapter without copied verification logic: replace its direct KnowledgeClient submission transport with a bounded client of the existing MC VerificationDispatchRequest launch/read API, preserving its host-issued scoped grant and request digest. That adapter and a real Eve-to-MC-to-Cloud proof are still absent. It must not expose Temporal credentials or make browser/filesystem receipt reads.

The dashboard CPH page correctly displays an explicit unsupported state. The smallest safe completion is a compact tenant-scoped server projection of registered CPH receipts/handles; it must not enumerate arbitrary filesystem files or expose raw transcripts/credentials.

## Evidence limits

This audit inspected source and retained receipts only. It asserts no human approval, paid model run, Cloud execution, deployed configuration, or new acceptance promotion.
## Progress update: selected-run replay and CPH DTO

Implemented the next bounded VR036 slice in Mission Control dashboard:

- The allowlist admits only POST verification/runs/{UUID}:replay; retry, reconcile, cancellation, and arbitrary run paths remain rejected.
- The server BFF accepts only replayMode, derives runId from the validated path, constructs the exact KS replay request, and derives a stable idempotency key from the signed dashboard scope and run/mode. Browser authority fields are rejected.
- The selected verified-run inspector exposes deterministic replay only after dashboard role state permits control. Accepted acknowledgements link to the compact operation projection; unavailable, denied, and failed states remain explicit.
- The dashboard DTO now has a strict CPH receipt projection for the MC read surface. It projects compact scoped IDs, operation/workflow provenance, declared components, hashes, and timestamp; extra transcript, lease, credential, and raw fields are dropped.

Validation after pinned dependency restoration: dashboard typecheck passed; focused dashboard server suite passed **11 files / 56 tests**. The new browser replay test is present at apps/dashboard/e2e/replay.spec.ts; it was not run because this bounded task did not start or rebuild a dashboard server.

Remaining VR036 work remains unchanged: durable MC retry/reconcile, verification promotion/suspension proposal and human decision commands, execution discovery, and full primary Eve-to-MC-to-Temporal CPH evidence plus paired benchmark comparison.
## Validation update: production dashboard and CPH projection

The dashboard production build passed after the current replay and CPH rendering changes. An isolated Playwright configuration on port 3141 started and stopped only its own production Next server. Its mocked browser suite passed 4/4:

- selected-run deterministic replay acknowledgement;
- drift inbox published, empty, and unavailable states;
- CPH compact receipt with declared component provenance and workflow link;
- CPH unavailable followed by empty state.

The CPH server projection was independently checked against the current KS API contract. MC uses authenticated tenant-scoped KS GET routes for the generic operation resource and durable receipt resource. Their actual response contracts contain the exact operation context, operation kind, receipt membership, receipt operation binding, hashes, outcome, and timestamp that cph-receipts.ts validates. The MC route then authenticates its own principal, binds tenant and mission to a read grant, bounds results to 100, verifies optional Temporal workflow operation/receipt binding, and returns the strict compact DTO. No concrete source-level contract mismatch was found.

This read surface does not close the full CPH evidence gap: it consumes explicitly configured receipts and cannot establish the required real Eve primary MC/Cloud lane, registered restricted transcript, or identical-input paired benchmark-comparison artifact by itself.

## Progress update: replay ownership-context correction

The dashboard replay BFF originally forwarded only `x-mission-id`. That header is
not a verification ownership hint: the KS production resolver requires all of
`x-verification-mission-id`, `x-verification-work-item-id`, and
`x-verification-attempt-id`. The correction adds an optional, strict,
server-only `DASHBOARD_VERIFICATION_REPLAY_KNOWLEDGE_TOKENS_JSON` mapping. Each
mapping binds one signed dashboard subject and tenant/mission scope to one exact
source `runId`, work item, attempt, and KS credential. Replay fails closed with
`REPLAY_AUTHORITY_UNAVAILABLE` before any upstream request when no exact mapping
exists. Browser headers and body fields cannot select the execution context.

Focused dashboard proxy validation passed **11 files / 57 tests** and dashboard
typecheck passed. A native replay still needs a deployed mapping whose service
credential is admitted by the corresponding KS ownership grant; that operational
configuration has not been asserted by these unit checks.

## Independent Eve-to-MC CPH adapter review

Read-only review of the isolated adapter and its retained six-test loopback receipt
found correct exact-grant launch/body/authentication boundaries, but rejected it as
live-proof ready. The adapter currently maps every MC `completed` state to Eve
`succeeded`, while the MC terminal disposition may be `review_required`,
`quality_rejected`, or `completed_without_admission` and its compact contract makes
the disposition, operation ID, and receipt ID optional. The correction must add a
truthful CPH lifecycle `completed` state, reserve `succeeded` for a `succeeded`
disposition, and require the exact terminal operation/receipt binding. Cancellation
also needs an abort-after-launch reconciliation test: an accepted cancel is not
terminal evidence. Immutable audit receipt:
`internal/verification-eve-mc-cph-adapter-independent-audit-20260908.json`
(`sha256:47e51ea951d077335fd79abefddc20ef7d79eb67f460b0c17e1c94ecbdc9f5ea`),
with the lifecycle/disposition correction in immutable successor
`verification-eve-mc-cph-adapter-independent-audit-20260908-r2.json`
(`sha256:2e0251e82e11dfb3bff38630d2f18a738849b9a443741f4e7804cc28d776cd56`).

## Native dashboard replay diagnostic

An isolated local run used the retained sealed metric run
`68458fde-efc9-5b99-acc7-4cdd97048508`, a fresh canonical verifier attempt,
an exact dashboard replay grant, signed dashboard session, KS production API
ownership resolver, and `WORKER_OPERATION_ID` scope. The BFF request was
accepted by KS with the configured server-owned verification headers. The worker
then failed before replay computation with `INVALID_VERIFICATION_REPLAY_INPUT`.
The persisted canonical step proves the cause: the sealed replay activity parses
`invocation.operationInput`, but the registry exposes the inner service request
at `invocation.activity.operationInput`; the former is the guarded wrapper. This
is a concrete shared worker defect, reported for correction before repeating the
native proof. The failed diagnostic operation is retained; no provider call was
made.

## Native dashboard replay proof completed

The downstream diagnostic was configuration-specific: sealed metric replay needs
the retained `verification-metric-profile.v1` artifact and the recorded parser
image digest, rather than treating the observations bundle as its profile. The
repeated POST conflict exposed a BFF defect: stable replay idempotency was paired
with a server-generated, nonstable correlation ID, which changed the authenticated
operation context. Replay now derives both identifiers from the same server-only
digest and ignores browser correlation input.

The completed local proof used the signed dashboard BFF, exact server-owned grant,
KS production ownership resolver, one `WORKER_OPERATION_ID` worker, retained
sealed source run, and two pre-worker duplicate POSTs. It recorded one terminal
operation and one receipt, with no provider calls. Receipt:
`internal/verification-dashboard-native-replay-c830275e-bd5e-4a1a-b8c6-a5b152d8a074.json`
(`sha256:334dac25983f1b7f0c1e21dab691ad17730dfc3a9b683cbdf5de3f493f8256a4`).
Focused dashboard proxy tests passed **11 files / 57 tests** and dashboard
typecheck passed.
