# WS-10 uncertain submission cancellation handoff

Updated 2026-09-05. The bounded helper
`ai-engineer-mission-control/scripts/prove-verification-temporal-uncertain-cancellation.ts`
exports:

```ts
proveVerificationTemporalUncertainCancellation({
  baseUrl, token, context, request, missionExecutionId,
}): Promise<Record<string, boolean>>
```

The fixture must provide a fresh locally authorized metric request and leave the
Knowledge Services worker stopped. No callback is needed. The helper starts a
loopback-only HTTP forwarding proxy in front of the supplied local Knowledge API.
For the first real `POST /v1/verification/metrics:verify` that returns `202`, the
proxy reads and records the accepted operation ID and `idempotency-key`, consumes
the upstream response, and closes the caller response before it is delivered.
The Knowledge API has therefore committed its durable acceptance while the
Mission activity receives a transport failure.

The test-only activity wrapper delegates to the normal `executeVerification`
implementation and only observes `Context.current().cancellationSignal`; it
does not change dispatch behavior. The proxy withholds **every** accepted metric
response until that activity-side signal is observed. The helper requests
Temporal cancellation after the first durable queued acceptance, awaits the
activity-side signal (server cancellation acknowledgement alone is insufficient),
then destroys all pending withheld responses. This lets the normal activity's
timeout/retry and heartbeat deliver cancellation before any accepted operation
response can provide an operation ID. Only accepted submissions after that
release are forwarded as cleanup recovery.

The helper records timestamps for durable acceptance, activity cancellation
observation, response release, and cleanup recovery, and requires their order:
acceptance precedes activity cancellation; response release follows it; cleanup
recovery follows release. It also requires zero accepted responses delivered
before cancellation, then checks recovery uses exactly the first idempotency key
and returns the same operation ID. It finally verifies the real public operation
is `cancelled`, accepts only a compact cancelled activity outcome or an SDK
`CancelledFailure`, fetches the actual history, excludes literal/base64/decoded
bearer forms, and replays it.

The standalone custody receipt records the original and recovered operation IDs,
idempotency key, history digest, and source hashes for the helper, shared kernel
dispatch, and worker dispatch/activity/workflow/runtime modules. It makes no DB
reset, provider call, remote write, or Temporal-server restart. It has only been
checked for local import/transpilation; the coordinator owns its one-at-a-time
real fixture execution and must independently confirm the service operation row
count is one for the fresh attempt.
