# WS-08 sealed replay activity handoff

Updated 2026-09-05.

## Delivered activity adapter

`apps/worker/src/verification-sealed-replay-activity.ts` exports:

```ts
verificationSealedReplayActivityHandler({
  repository, operations, replay, storageBucket, now, fallback?
})
```

It registers exactly `verification_replay:hydrate_and_recompute`. The activity
strictly parses only the established `verification-service-request.v1`
`replayRun` envelope and `ReplayRunRequestSchema`, which permits only
`deterministic_only` or `recorded_provider_outputs`. The trusted replay function
receives `{ tenantId, runId, context }`; it has no provider route, credential, or
caller trust input.

The handler checks canonical operation state before replay, after replay, and
after CAS registration. On a matched trusted replay it records a restricted
`verification-operation-result` artifact with the compact shape:

```ts
output: {
  result: { valid: true },
  replayMatched: true,
  sourceRunId,
  manifestDigest,
  deterministicResultDigest,
  policyOutcome,
  replayedArtifactIds
}
```

The source run identity and all returned digest values are validated. Result
parents come only from trusted replayed registered-artifact IDs, never from the
caller envelope. The handler does not store source bytes, provider raw output,
or runtime identity material in the operation result.

## Legacy fallback boundary

An optional existing extraction `CanonicalActivityHandler` is invoked only when
the trusted replay throws the exact message `SEALED_REPLAY_RUN_NOT_FOUND`. A
missing fallback leaves that code terminal. Integrity, ownership, authorization,
policy, malformed output, and every other replay error remain on the sealed
path and cannot fall back to legacy extraction replay.

## Focused unit-only validation

`apps/worker/src/verification-sealed-replay-activity.test.ts` uses injected
fakes to cover successful compact result/CAS registration, dedicated not-found
fallback, integrity failure non-fallback, strict caller-extra rejection,
cancellation before registration, and failure-message scrubbing.

```text
node_modules/.bin/vitest.cmd run apps/worker/src/verification-sealed-replay-activity.test.ts
# 6 passed
```

The root-owned runtime adapter requires the newly added persistence replay
binding method to be built into the persistence declaration surface before full
worker TypeScript validation. This activity's own focused test passed without
provider calls or shared fixture mutation.
