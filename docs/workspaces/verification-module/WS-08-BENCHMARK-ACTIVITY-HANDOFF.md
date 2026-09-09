# WS-08 benchmark worker activity handoff

## Delivered scope

`apps/worker/src/verification-benchmark-activity.ts` adds the bounded canonical handler for operation kind `verification_benchmark` and step `replay_recorded_and_register`.

The handler accepts only `verification-service-request.v1` / `runBenchmark` input and performs this trusted sequence:

1. checks the canonical operation is running and resolves runtime identity from configured dependencies;
2. requires the configured runtime `attemptId` to equal the canonical activity context attempt;
3. derives the benchmark run UUID from tenant and canonical operation identity;
4. prepares `RegisteredDiagnosticsOfflineBenchmark` with an abort signal;
5. derives the exact checkpoint plan, initializes `PostgresVerificationBenchmarkRunStore` with the active claim and a proposed start time, and uses its retained lifecycle/checkpoints with `runVerificationBenchmark`;
6. builds the registered publication and publishes it with that same canonical claim.

The durable store preserves the first accepted start/completion times on retries. The registered offline executor has no provider dispatch capability; retries traverse preparation/checkpoint recovery and publication exact-retry paths only.

The returned canonical handler result uses the sealed `verification_run_manifest` artifact as `resultArtifact`. Its compact output is restricted to `benchmarkRunId`, `evalRunIds`, `manifestDigest`, and the all-false engineering-only `qualityClaims`. It does not fabricate a deterministic verification result, a `valid` flag, public-read output, or operation terminal state.

## Cancellation and failure boundaries

A bounded non-overlapping recursive operation-status poll aborts the same signal passed to preparation, runner, and publication preparation. The `stopped` guard and pending timeout are cleared in `finally`, so a slow operation read cannot accumulate polls. If a polling read itself fails, its infrastructure cause is retained rather than relabelled as cancellation. Cancelled/inactive/stale conditions are emitted as non-retryable canonical activity failures. Strict input, runtime-attempt, durable-binding, publication-custody, and unsupported quality-claim errors are terminal; only unknown infrastructure, object-store, and explicitly unavailable registered-artifact bytes remain retryable.

The handler relies on `createCanonicalActivityExecutor` for initial canonical operation/claim ownership validation and does not replace canonical worker completion or receipt logic.

## Focused validation (unit-only)

`apps/worker/src/verification-benchmark-activity.test.ts` has six injected-port tests:

- trusted preparation → durable initialization → runner → publication builder → fenced publisher order, and compact all-false quality disclosure;
- periodic cancellation polling aborts an in-flight preparation and prevents initialization/publication;
- incomplete durable runner failure prevents builder/publisher calls;
- a trusted runtime identity whose attempt differs from the canonical context is rejected before preparation;
- unsupported quality claims are refused before publishing;
- a transient polling database failure remains a retryable infrastructure failure and publication is not called.

Executed successfully:

```text
corepack pnpm --filter @aiengineer/knowledge-worker exec tsc --noEmit
corepack pnpm --filter @aiengineer/knowledge-worker exec vitest run src/verification-benchmark-activity.test.ts
# 6 passed
```

These are unit-only adapter checks. Runtime index registration and a worker process-death/fencing proof remain root-owned and have not been claimed here.


