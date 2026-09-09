# WS-10 Mission Control dispatch handoff

## Dispatch adapter status — 2026-09-05

Mission Control now has a bounded Activity-side adapter in
`ai-engineer-mission-control/apps/worker/src/verification-dispatch.ts`.
It uses the public `KnowledgeClient` methods:

- `captureVerificationSource` for the `captureSource` capability;
- `verifyExtraction`;
- `verifyMetricObservation`;
- `replayVerificationRun`;
- `getVerificationOperation`, `getReceipt`, and generic `cancelOperation` for
  authorized reconciliation.

The adapter accepts only registered artifact references and routing identity
(tenant, mission, work item, attempt, correlation, and mission execution).
It rejects capture acquisition requests, source bytes, raw payload fields, and
credential-shaped fields before dispatch. It recomputes a canonical SHA-256
request digest inside the activity. Its idempotency key binds operation plus
tenant/mission/work-item/attempt identity and deliberately excludes the digest:
a changed request under that same durable identity reaches Knowledge Services as
an `IDEMPOTENCY_CONFLICT`; a deliberate rerun needs a new attempt identity.

Submission recovery repeats the same strict request with the same authenticated
routing and idempotency key a bounded number of times. Completion requires a
matching tenant/operation/idempotency receipt. Full receipt bodies and service
status stay inside the activity; workflow results contain only operation ID,
receipt ID, state, disposition, and idempotency key. Quality rejection is a
terminal recorded result and is not resubmitted. Cancellation recovers an
unknown accepted operation with the same key, invokes `cancelOperation` using a
trusted runtime-provided `OperationContext`, then waits for the cancelled state.
An exhausted recovery returns explicit `reconciliation_unresolved`, never
success.

The adapter now mirrors the CLI completion contract. It verifies the requested
operation kind and accepts a successful completion only when the receipt has the
matching operation-specific completion kind and `outcome: "succeeded"`:
`register_and_admit`, `verify_and_register`, `verify_metric_and_register`, or
`hydrate_and_recompute`. It scans newest receipts first but skips unrelated
receipts. Capture quality is true after that receipt; extraction, metric, and
replay quality are read from the validated `body.output.result.valid` flag, so a
durably succeeded operation with `valid: false` becomes the terminal
`quality_rejected` outcome. Internal step receipt idempotency keys are not
assumed to equal the submission key.

`assertVerificationDispatchLaunchInput` is exported for the Mission Control
workflow starter. It uses the public strict request schemas, rejects unknown
top-level/context fields, requires registered capture artifacts, validates the
request digest, and rejects byte/credential-shaped values before a workflow is
started. The Activity invokes it again as defense in depth.

Bounded settings are independently constrained: submission attempts at most
100, polling attempts at most 10,000, and poll intervals at most five minutes.
The configured 120 polls at one second is valid. `KnowledgeClientError` status
408, 429, and 5xx responses are retried with the same identity; other 4xx
responses remain terminal request failures.

Focused fake-client tests are unit-only and cover receipt matching, transport
recovery, retryable HTTP classification, quality terminality, wrong receipt and
operation kinds, altered-payload conflict identity, cancellation recovery, and
pre-history source-acquisition/unknown-field rejection. They are not a
substitute for the real Knowledge Services/Temporal proof.

## Integration notes

- `cancelOperation` requires a complete trusted `OperationContext`, including
  actor and operation ID; the Mission runtime factory must supply it. It must
  not be placed in workflow input.
- `verifyMetricObservation` is supported by the public client and the current
  metric worker handler, even though an older verification executor enumerated
  only capture/extraction/replay.
- The public client calls the capture method `captureVerificationSource`; this
  is the adapter mapping for the external `captureSource` capability name.
- The Mission Control `executeStage` placeholder remains separate work. This
  handoff does not claim end-to-end workflow integration or production readiness.
