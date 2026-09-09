# WS-08 benchmark comparison kernel handoff

Updated 2026-09-05. This handoff covers an evaluation-package kernel only. It
does not add a route, application service, persistence adapter, migration,
provider call, public request profile, or acceptance evidence.

## Interface and trust boundary

`compareVerificationBenchmarkRuns` accepts two independent operands. Each
operand contains its frozen `VerificationBenchmarkDataset`, complete
`VerificationBenchmarkRun`, and the arm ID selected by the trusted caller. The
comparison options declare `source_family` or `report_cluster` clustering, a
32-bit nonnegative seed, 100–10,000 resamples, and either no adjustment or Holm
family-wise adjustment.

The kernel assumes that the future application service has already established
tenant authorization, canonical succeeded-operation ownership, sealed
publication visibility, and trusted publication signatures. It validates the
hydrated runner payloads themselves. It does not accept artifact bytes, parse a
signature, resolve a tenant, or infer an arm pair from an untrusted request.

The same arm ID is valid across distinct runs. Equal arm IDs and equal
configuration digests are useful for deterministic replay and regression
checks, and can legitimately produce zero observed change. The kernel rejects
equal run IDs even when different arms are named: its policy is a strict
cross-run comparison, so a single-run arm experiment continues to use the
existing `compareVerificationBenchmarkArms` helper.

## Admission before calculation

Both datasets independently pass the frozen dataset schema, every complete
case self-digest, and the dataset manifest self-digest. Both runs independently
pass the existing summary/run validator, including exact manifest digest,
complete arm/case/repetition matrix, checkpoint schema and digest, and
checkpoint context binding. Arm definitions pass the frozen arm schema.
Canonical run and checkpoint times must fall between the run start and
completion. Both network policies must be `offline`.

After those independent checks, the kernel requires the exact sorted
`{caseId, caseDigest}` matrix and dataset manifest digest on both sides. It also
requires the selected arms to have the same complete case/repetition key
matrix. It never changes a run ID, arm ID, checkpoint, or signed row to create a
synthetic composite run.

Only repetition zero is supported. A valid run with two or more repetitions is
rejected with the typed
`BENCHMARK_COMPARISON_REPETITION_ONE_REQUIRED` limitation. Averaging repeated
rows before the existing cluster procedures would silently change the sampling
unit; valid nested case/repetition/cluster inference remains future work.

All failures use `VerificationBenchmarkRunComparisonError` with a stable code
and, where relevant, `baseline` or `candidate` side attribution. Dedicated
codes distinguish dataset/case semantic drift, invalid run manifests, arm
schema drift, checkpoint digest drift, checkpoint context drift, incomplete
matrices, timing, non-offline runs, missing selected arms, self-comparison,
unsupported repetitions, and invalid statistical options.

## Result semantics

The result binds the original run manifest, experiment definition, arm, arm
configuration, dataset manifest, and full case-matrix digest identities. Its
own `comparisonDigest` is the canonical digest of every other result field.
Code-unit ordering is used for cases, hypotheses, and cluster rows; seeded
statistics therefore do not depend on host locale.

Nine paired binary engineering dimensions are reported separately:

- schema validity;
- locator resolution validity;
- locator expectation agreement;
- field mechanics;
- support agreement;
- authority agreement;
- world-correctness agreement;
- policy agreement;
- composite engineering-expectation agreement.

The composite predicate is stated in the machine result and is exactly:
`failureClass === none`, schema valid, locator validity equal to the expected
locator validity, and support, authority, world correctness, and policy equal
to their engineering expectations. Field mechanics remains a separate
dimension because the existing benchmark composite predicate does not include
it.

Every dimension returns its common paired denominator; baseline and candidate
success counts and Wilson 95% intervals; candidate-minus-baseline delta;
observed regression, improvement, or no-change classification; discordant-pair
counts; exact McNemar result; whole-cluster paired bootstrap interval; and
equal-cluster-weighted sign-flip result. The chosen cluster unit, cluster count,
per-cluster composite counts/deltas, seed, resample request and bounds,
estimands, 18-test hypothesis family, and correction results are explicit.

Wilson intervals are labelled nominal and descriptive with independence
unverified. Bootstrap intervals are labelled descriptive, McNemar is nominal
and exploratory, and cluster sign-flip results are exploratory with cluster
independence unverified. A count of distinct source-family or report-cluster
labels is never named an independent-cluster count.

Recorded call overlap is computed from provider, model, request digest, and
response digest without copying call IDs or signed rows. The result always says
that retained observations reused across runs are replay engineering
observations rather than independent fresh calls.

The claim block is fail-closed: human-gold quality, population inference,
promotion, calibration, source-authority assessment, clinical correctness and
causality are all false. Current V4 engineering cases therefore retain a zero
human-gold denominator even when every engineering expectation agrees.

## Files and focused verification

- `packages/evaluation/src/verification-benchmark-run-comparison.ts`
- `packages/evaluation/src/verification-benchmark-run-comparison.test.ts`
- `packages/evaluation/src/index.ts`
- this handoff

Commands run from `ai-engineer-knowledge-services`:

```text
corepack pnpm --filter @aiengineer/knowledge-evaluation typecheck
```

Result: pass.

```text
corepack pnpm --filter @aiengineer/knowledge-evaluation test
```

Result: five test files and 50 tests pass. New coverage includes a positive
paired change across three source-family clusters; all nine dimensions and
Holm family; distinct identical runs with zero change; report-cluster choice;
Unicode code-unit cluster order; same-run rejection; full case-digest drift
versus dataset metadata drift; altered checkpoint digest; correctly rehashed
checkpoint with the wrong run context; two-repetition denial; online-run
denial; and missing selected-arm denial.

```text
corepack pnpm --filter @aiengineer/knowledge-evaluation build
```

Result: ESM bundle and TypeScript declarations build successfully.

The coordinator then ran the strict actual-data proof against two independently
loaded, signed, canonical completed publications and their exact registered
dataset and runner bytes. It compared four corresponding arm IDs. Every result
contained 43 paired cases and four source-family cluster labels; the expected
recorded-replay deltas were zero across all nine metrics. The proof rehashed
each comparison independently, confirmed the hydrated inputs were unchanged,
reported zero external provider requests, and retained every human-gold,
population and promotion claim as false. The receipt is
`internal/verification-benchmark-comparison-kernel-9950834c-d651-477c-9ddb-5da34e2dd5cc.json`,
file SHA-256
`bb9efd5d39729b176b1dc895884bcb32e055d35fd7e660cd7f34b900e99a0633`.
The coordinator also independently repeated the nine focused kernel tests and
strict proof typecheck. This proves the bounded kernel on actual retained
inputs; it does not prove a durable public compare operation.

## Remaining integration

The coordinator still owns the comparison profile, two-run tenant/signature
loader, canonical succeeded-operation enforcement, application service,
transport projection, and actual persisted comparison proof. Clustered repeated
trial inference needs a separate statistical design before repetitions greater
than one can be admitted. No WS-08 or program acceptance claim is made here.
