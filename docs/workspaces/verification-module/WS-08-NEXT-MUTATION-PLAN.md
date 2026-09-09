# WS-08 Next Mutation Plan: offline recorded benchmark run

Updated 2026-09-05. This is a read-only assessment; it admits no new route,
operation kind, worker, provider, migration, or catalog entry.

## Recommendation

Implement **`runBenchmark` in its already-declared `offline_recorded` mode** as
the next mutation. Keep it to registered, frozen dataset and experiment
artifacts plus registered recorded provider observations. It should never
perform fresh provider dispatch. This is the smallest remaining mutation that
reuses a complete execution core without copying a verification algorithm:

- `packages/evaluation/src/verification-benchmark.ts` already provides frozen
  dataset validation, deterministic checkpoint identity, run execution,
  summaries, and paired comparison primitives.
- `packages/application/src/verification-benchmark.ts` already authenticates
  the diagnostics catalog/grant inputs, binds projections and selectors through
  `VerificationAdmissionService`, and composes recorded provider observations.
- `packages/application/src/verification-benchmark-response-replay.ts` can
  re-run a retained response through the real adapters with a memory fetch and
  guarantees zero external requests.
- `packages/contracts/src/verification/requests.ts` already restricts the
  public request to `{ dataset, experimentDefinition, executionMode:
  "offline_recorded" }` artifact references.

Do **not** first expose generic `compareBenchmarkRuns`: it needs two durable,
sealed benchmark-run records, and none is yet written by the public command.
Do not expose `verifyClaims`, `verifyReport`, or `requestAdjudication` first:
their domain helpers exist, but no application layer owns their assertion,
selector, source-authority, policy, and reviewer bindings. `extractStructuredData`
already has provider adapters and the downstream extraction verifier, but lacks
a trusted registered extraction profile-to-provider runtime mapping and a
production extraction executor.

## Exact production gate

The first slice must support a **single registered offline profile** only. The
runtime-owned profile maps the accepted dataset and experiment definition
digests to the exact admitted artifact types and runner version; it is not
caller-selected. Before execution it must:

1. authenticate tenant/mission/work-item/attempt from the existing operation
   context and accept `runBenchmark` only through the current strict request
   schema;
2. hydrate both requested artifacts through the tenant-scoped registered
   artifact resolver; require available state, exact ID/digest, bounded bytes,
   `VerificationBenchmarkDatasetSchema`, `frozen: true`, and a manifest digest
   that recomputes exactly;
3. hydrate the runtime-owned experiment/recorded-observation artifacts and
   require their dataset digest, case digests, arm matrix, runner version,
   response digests, and schema digests to bind exactly to the dataset;
4. use only `VerificationAdmissionService` to hydrate each retained projection
   and resolve selectors. A capture, projection, selector, or selected-content
   digest mismatch is terminal and produces no partial benchmark result;
5. permit only `networkPolicy: "offline"`; recorded response replay may use the
   memory-only adapter path and must prove external request count is zero;
6. persist each checkpoint/result and the final compact run manifest as
   registered immutable artifacts under the operation tenant. Associate the
   canonical evaluation run with the durable operation before its terminal
   receipt is written; cancellation/fencing checks belong before each persisted
   checkpoint and before completion;
7. return a compact receipt result handle and disclose the existing limits:
   engineering expectations are not human-gold quality, calibration, clinical,
   population, or causal claims. A policy pass must not relabel those limits.

The current diagnostics demo cannot be published directly: it takes filesystem
catalog/output directories, reads a local preparation manifest, writes files,
and uses a file checkpoint store. Its hardcoded offline baseline and explicit
provider-arm unavailable failures are useful reuse behavior, not a public
transport contract.

## Required vertical changes

1. Add one admitted canonical operation kind and step, for example
   `verification_benchmark: replay_recorded_and_register`, to the operation
   surface and repository admission allowlist. Reuse the existing activity
   registry/lease fencing/canonical receipt pattern; do not run the benchmark
   in an API handler.
2. Add a benchmark application executor with injected trusted profile catalog,
   tenant artifact resolver, evaluation persistence/checkpoint port, policy
   catalog, and clock. It invokes the existing runner, selector admission,
   recorded-arm composer, and statistics functions; it does not duplicate them.
3. Add the corresponding worker handler and runtime factory config. Production
   config must fail closed when the offline profile, registered digest bindings,
   persistence port, or runtime identity are missing.
4. Add an authenticated HTTP route/client/CLI/MCP command only after the
   operation and handler exist. Derive the actor and operation context from the
   trusted transport boundary; accept neither raw responses, source bytes,
   provider keys, policy decisions, profile names, nor reviewer identity.
5. Add a compact benchmark-run read after persistence exists. It may return
   IDs, immutable artifact references/digests, state, and bounded limitation
   flags. It must not expose raw provider bytes, source excerpts, labels,
   receipt bodies, or internal cost/accounting records.

## Focused proof

Use a fresh tenant, registered frozen diagnostics dataset/experiment and
recorded observations, an authorized `runBenchmark` request, and the normal
worker. Assert one operation and one evaluation run, exact input/output digest
bindings, zero provider fetches, durable checkpoint/result artifacts, and a
terminal compact receipt. Retry the identical request to obtain the same
operation; change an artifact digest under the same identity and require
nonretryable drift. Replay the saved result artifact through the recorded
response helper and require the same run manifest digest. A foreign tenant read
must be hidden. This proof has no provider, paid, or remote calls.

## Deferrals

`compareBenchmarkRuns` follows once two trusted sealed runs exist and must load
both by tenant-scoped canonical IDs before calling
`compareVerificationBenchmarkExperiment`. `requestAdjudication` requires a
trusted reviewer identity and immutable queue/decision persistence; the
existing human-review module validates packets and submissions but is not a
queue. `verifyClaims`/`verifyReport` require server-owned admitted assertion
and source-family/selector catalogs, semantic-judge custody, and policy replay.
`extractStructuredData` requires a runtime-owned profile and provider dispatch
ledger; it cannot trust the public `registered_default` string as authority.
