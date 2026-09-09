# WS-08 durable offline benchmark checkpoint/run design

## Existing authority

`knowledge_service.operation`, `operation_step`, and `lease` are the canonical execution/fence state. `PostgresCanonicalRepository.#lockValidLease` validates a live token/fence lease; `PostgresVerificationRepository.#assertLiveOperationLease` shows the required lock order for a write that also touches operation state: lock the operation row first, then perform a non-locking live step/lease predicate. This avoids the inverse operation-to-lease lock order used by `completeStep`.

`evaluation.eval_run` is the canonical evaluation-run relationship. It already has tenant-scoped identity and evaluation dataset/version/arm relationships, but its verification-v1 shape represents a single experiment arm and does not carry a canonical operation link or durable benchmark checkpoint lifecycle. It cannot directly represent the admitted multi-arm benchmark matrix without an extension.

## Proposed bounded storage

Add an `evaluation.verification_benchmark_run` extension linked to an aggregate `evaluation.eval_run` row. It has tenant and run identity, one canonical operation identity, exact admitted dataset/experiment artifact IDs and SHA-256 values, runner version, network policy, random seed, immutable original `started_at`, expected checkpoint count and plan digest, and a narrow lifecycle: `running -> completed -> sealed`.

A separate `evaluation.verification_benchmark_checkpoint` table is keyed by tenant/run and the runner's existing `checkpointContextDigest`. Each insert stores the fully validated compact checkpoint result JSON, its checkpoint digest, and its immutable completion time. It is insert-only. Exact duplicate insertion compares all values and returns the existing checkpoint; any changed result or digest is drift.

The run extension later receives one immutable run-manifest artifact ID/digest during its `completed -> sealed` transition. Registration may occur before this guarded DB link, but the state link is lease/fence guarded and can never be replaced. This avoids treating an unfenced file-like checkpoint store as execution state.

## Adapter lifecycle

`PostgresVerificationBenchmarkRunStore` should expose an explicit durable initializer and a runner-compatible checkpoint object:

- `ensureRun(input, lease)` creates or exactly reuses the run state and original start time.
- `checkpoints.load(contextDigest)` reads only a checkpoint for that run.
- `checkpoints.save(contextDigest, result, lease)` validates the result/key relationship and inserts/reuses it inside the operation+lease guarded transaction.
- `complete(lease)` requires the expected checkpoint count, atomically sets the first terminal completion timestamp, and returns that timestamp on every retry.
- `attachRunManifest(artifact, lease)` validates the terminal artifact handle, then performs the sole `completed -> sealed` binding.

Every mutation locks the operation row, requires `status='running'`, and validates the exact step ID, holder identity, lease token, fencing token, unreleased/nonexpired lease, and running step. Cancellation therefore linearizes before the mutation; stale fences fail. The runner itself keeps its matrix/digest validation, and its new lifecycle `complete()` receives the persisted timestamp.

## Open integration choice

The aggregate `eval_run` must be supplied by runtime with valid evaluation dataset/version/experiment relationships. A single `experiment_arm_id` cannot truthfully identify a multi-arm benchmark, so the extension is the run-level owner and preserves the normal evaluation relationship through its FK. The parent needs to select/create the aggregate evaluation relation; this task must not invent an arm alias.

No migration or adapter was created pending root review of this shape and checkpoint-result representation.