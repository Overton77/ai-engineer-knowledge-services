# WS-10 Temporal cancellation proof handoff

## Helper scope — 2026-09-05

`ai-engineer-mission-control/scripts/prove-verification-temporal-cancellation.ts`
exports `proveVerificationTemporalCancellation`. It is a local-only proof helper
for the preserved Temporal development server at `127.0.0.1:7233`, namespace
`verification-local`.

The caller supplies a fresh tenant-scoped metric request and routing context,
an exact external-execution grant, a fresh attempt/mission execution identity,
and `waitForQueuedOperation`. The callback must resolve only after the real
authenticated Knowledge Services API reports the submitted operation as
`queued`; this proof intentionally runs without a Knowledge worker so the
accepted operation remains cancellable.

The helper starts the registered `verificationWorkflow` on a dedicated task
queue using the existing Mission runtime factory. After authoritative queued
observation, it calls `handle.cancel()`, awaits either the compact cancelled
activity outcome or an actual Temporal SDK `CancelledFailure` chain, then uses
the public `KnowledgeClient` to require the same operation's state to be
`cancelled`. It rejects an orphaned queued operation and rejects arbitrary
workflow failures masquerading as cancellation.

It writes an immutable proof receipt and standalone Temporal history under the
shared parent-workspace `internal/` directory, checks that the bearer token is absent from
history, and runs `Worker.runReplayHistory` against the retained history. Its
returned object contains only bounded boolean checks for aggregate evidence;
paths are emitted in the receipt/log output. It does not reset state, start a
Knowledge worker, invoke providers, or write to remote systems.

The first accepted/queued cancellation path is implemented. An uncertain-submit
variant is deferred until the accepted cancellation proof is complete; it would
use an HTTP fetch fault at the client boundary and the same real API, not a
database or worker simulation.
