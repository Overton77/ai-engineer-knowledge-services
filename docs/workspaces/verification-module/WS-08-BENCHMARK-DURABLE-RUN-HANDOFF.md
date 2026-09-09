# WS-08 durable offline benchmark state handoff

## Final implementation

`PostgresVerificationBenchmarkRunStore` is exported from `packages/persistence/src/verification-benchmark-run.ts`. It accepts only a canonical operation, full live `LeasedStep`, exact admitted dataset/experiment handles, fixed offline runner inputs, original start time, and `createVerificationBenchmarkCheckpointPlan` output. `initialize()` returns a runner-compatible checkpoint store and lifecycle object; it does not register or publish a result artifact.

The canonical state is `evaluation.verification_benchmark_run` and `evaluation.verification_benchmark_checkpoint`.

- A run is unique per tenant/operation and binds the exact registered dataset and experiment artifacts, runner configuration, canonical checkpoint plan, and original persisted start time.
- A checkpoint is keyed by the runner's existing context digest. It is append-only and its result JSON is validated against the matching stored plan entry: run ID, key, case, arm, repetition, digest, and bounded canonical completion timestamp.
- Every state mutation locks the operation first and validates the active step, holder, token, fence, expiry, and operation running state. Stale or cancelled execution cannot initialize, save, or complete.
- Exact run retries return the stored original start time. They canonical-compare persisted JSONB plans and recompute any caller-provided plan digest before a save or completion. Checkpoint retries canonical-compare the result; drift fails.
- Completion requires the entire planned matrix, persists one database completion timestamp, and cannot precede the run start or latest checkpoint.

The migration sequence is `06029000` through `06029400`:

- durable run/checkpoint rows and terminal manifest artifact type;
- no checkpoint after completion;
- defensive removal of an obsolete singular `eval_run` draft relation;
- null-safe admitted-operation request checks;
- SQL-side checkpoint result-plan and time binding.

No aggregate `evaluation.eval_run` is created. A truthful multi-arm publication relationship remains a later `benchmark_run_arm` design, with one real evaluation run per actual experiment arm.

## Evidence

- Root’s final local durable replay ran the admitted 43-case × 4-arm matrix after migration `06029400`: 172 checkpoints, 26 checks passed. Receipt: `../../../../internal/verification-registered-replay-0fb07c1b-4b78-4177-8939-942701e5382a.json`; manifest digest `sha256:0766ce337fee2b6e1e7aa2707e3b062debb49549db2db2282c01199b204a5195`.
- Root independently audited all172 persisted checkpoint values/digests, the plan, start/completion timestamps and registered dataset/experiment: `../../../../internal/verification-durable-benchmark-audit-20260905.json`. The proof operation is cancelled after testing; no canonical manifest was published.
- Root’s separate real adapter harness passes18 checks, including concurrent exact retry, changed/off-plan/forged-plan/cross-operation denial, timestamp bounds, cancellation and natural lease expiry/replacement with increased fencing token: `../../../../internal/verification-benchmark-durable-negatives-fc797663-aee6-4563-b470-b2a3da63416d.json`. It uses synthetic checkpoint decisions with registered frozen inputs and makes no quality claim. Independent DB audit confirms all three proof operations cancelled, zero unreleased leases and exactly two intentionally retained checkpoints.
- The local-only negative SQL transaction passed and rolled back cleanly: missing operation request fields, an off-plan key, mismatched result identity, and a future timestamp were each rejected. Log: `internal/verification-benchmark-durable-negative-20260905.log`.
- Persistence typecheck, focused durable-store unit tests, and persistence build pass.
- Full KS typecheck/test/build72/72 uncached passes: `../../../../internal/verification-contract-0212-full-verify-20260905.log`. Persistence has47 passed/14 skipped tests; skipped tests are not accepted as runtime evidence. Database-contract0.2.12 includes the migrations and regenerated types, with canonical/installed byte parity: `../../../../internal/verification-contract-0212-audit-20260905.json`.

## Remaining boundaries

Checkpoint JSON is authoritative fenced state. CAS checkpoint exports, terminal run-manifest registration/sealing, per-arm evaluation publication, worker operation admission, and process-death resume proof remain separate work. They must retain the same operation lease/fence and exact admitted input bindings.
