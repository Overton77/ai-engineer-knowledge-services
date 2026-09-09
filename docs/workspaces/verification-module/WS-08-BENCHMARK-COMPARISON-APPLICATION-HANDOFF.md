# WS-08 benchmark comparison application handoff

Updated 2026-09-05. This is the registered profile and application computation
slice. It adds no persistence row, lifecycle, operation kind, worker, API, CLI,
MCP surface, migration, provider call, or acceptance evidence.

## Registered profile contract

`VerificationBenchmarkComparisonProfileSchema` is a strict registered artifact
with schema version `verification-benchmark-comparison-profile.v1`. It binds the
verification contract version, tenant, `paired_default` or `regression_gate`
profile ID, positive version, one to 16 declared arm pairs, cluster unit,
uint32 seed, 100–10,000 bootstrap replicates, Holm correction, one of the nine
kernel engineering metrics as primary, and an optional observed-decrease
threshold.

Pair IDs and ordered baseline/candidate arm tuples must be unique. Equal arm IDs
across the two distinct runs remain valid. A `paired_default` profile must have
a null gate. A `regression_gate` profile must declare
`maximumAllowedObservedDecrease` between zero and one. Unknown fields and
caller-defined thresholds are rejected.

`VerificationBenchmarkComparisonProfileCatalog` is immutable deployment
authority. Its key is tenant plus profile ID and its value is one exact
registered artifact ID and digest. A public `comparisonProfile` name cannot
authorize bytes on its own, and duplicate trusted grants fail at startup.

## Application admission and computation

`VerificationBenchmarkComparisonApplicationService.prepare` accepts a trusted
tenant and the existing strict `CompareBenchmarkRunsRequestSchema`. Its injected
ports are the EV-070 verified publication reader, a factory that creates a
fresh `TrustedArtifactResolver` for every artifact, and the registered profile
catalog.

The service proceeds in this order:

1. parse the tenant and unchanged public request and resolve its exact profile
   artifact grant;
2. authorize, hydrate, byte-hash and schema-validate that profile;
3. load the baseline and candidate signed canonical completed publication
   snapshots from the verified read port;
4. independently authorize, hydrate and byte-hash each registered dataset and
   runner payload;
5. validate frozen dataset and complete runner digests, then require exact
   publication bindings for dataset digest/version/count/provenance, run and
   experiment identities, runner version/seed/repetition, run/checkpoint times,
   runner manifest, recomputed checkpoint plan, full arm set/control flags and
   per-arm summary digests;
6. require every registered arm pair to exist on its declared side;
7. bound aggregate statistical work before the first kernel call;
8. execute each declared pair using the comparison kernel with local correction
   `none`, then apply Holm once to the complete pair × nine metrics × two tests
   family.

Every await is followed by cancellation checking. Artifact defaults are 8 MiB
per artifact and 32 MiB aggregate, and both limits are deployment bounded.
Registration tenant, full handle where publication-owned, byte count, byte
SHA-256, artifact ID and digest must match. No parser, provider, filesystem or
network fallback exists.

Aggregate statistic work is fixed at at most five million cluster operations:

```text
arm pairs × 9 metrics × clusters ×
  (bootstrap replicates + sign-flip assignments)
```

Sign-flip assignments are `2^clusters` through 16 clusters and the registered
replicate count above 16, matching the existing exact-enumeration versus Monte
Carlo implementation. This bound is checked once across all pairs before any
calculation. The kernel separately enforces single repetition.

## Deterministic result and preparation brand

The result binds the request digest and exact profile, source operation,
publication artifact/payload, dataset artifact/semantic manifest, experiment
artifact, runner artifact/manifest and experiment-definition identities for
both sides. Pair results preserve their declared pair IDs and unadjusted local
families. `globalInference` contains one pair-prefixed 18-test family per pair
and its sole Holm adjustment. The result has a canonical `resultDigest` and no
clock-derived fields.

The engineering regression block reports the registered primary metric,
per-pair deltas and observed decreases, maximum observed decrease, declared
threshold and `not_requested`, `pass` or `fail`. Its interpretation is explicitly
`observed_engineering_threshold_only`. It cannot become a promotion decision.
Human-gold quality, population inference, calibration, source authority,
clinical correctness and promotion claims remain false.

The returned input snapshot and result are deeply frozen. A module-private
WeakMap brands the original prepared object with its tenant, canonical public
request digest and result digest. A later same-process publisher must call
`assertPreparedVerificationBenchmarkComparison` with the expected tenant and
request. A clone, fabricated object, other tenant, changed run IDs or different
profile name fails the brand/identity check.

## Files and focused checks

- `packages/contracts/src/verification/benchmark-comparison.ts`
- `packages/contracts/src/verification/benchmark-comparison.test.ts`
- `packages/contracts/src/verification/index.ts`
- `packages/application/src/verification-benchmark-comparison.ts`
- `packages/application/src/verification-benchmark-comparison.test.ts`
- `packages/application/src/index.ts`
- `scripts/prove-verification-benchmark-comparison-application.ts`
- `scripts/tsconfig.verification-benchmark-comparison-application.json`
- this handoff

Commands run from `ai-engineer-knowledge-services`:

```text
corepack pnpm --filter @aiengineer/knowledge-contracts typecheck
corepack pnpm --filter @aiengineer/knowledge-contracts test -- benchmark-comparison.test.ts
corepack pnpm --filter @aiengineer/knowledge-application typecheck
corepack pnpm --filter @aiengineer/knowledge-application test -- verification-benchmark-comparison.test.ts
```

At handoff, contracts typecheck passes with seven files and 34 tests passing;
application typecheck passes with 23 files and 122 tests passing. The new tests
cover strict profile/gate modes, duplicate pairs, bounds, same-ID cross-run
pairs, one global Holm family, engineering threshold pass, failure and not-requested
states, WeakMap identity, profile-name non-authority, changed profile bytes,
signed checkpoint-plan drift, missing registered arm, aggregate bootstrap plus
sign-flip work denial, cancellation after publication I/O, exact hydration
sequence, signed dataset byte drift, deterministic result digest and all-false quality claims.

```text
corepack pnpm --filter @aiengineer/knowledge-contracts build
corepack pnpm --filter @aiengineer/knowledge-application build
```

Both ESM bundles and TypeScript declaration builds pass.

## Actual registered-profile proof

The guarded local-storage application proof passed on 2026-09-05 against the
two independently signed canonical completed EV-070 publications used by the
comparison-kernel proof. It registered tenant-granted `paired_default` and
`regression_gate` profile artifacts, prepared four declared pairs for each,
and applied one global 72-test Holm family per result. Each side contained the
same 43 frozen cases and four source-family clusters. The replay observations
produced zero engineering deltas, so the paired profile returned
`not_requested` and the zero-tolerance regression profile returned `pass`.
This is an observed engineering threshold outcome only.

The proof also demonstrated preparation-brand clone and changed-request
rejection, an ungranted tenant/profile rejection, exact-profile byte mismatch
rejection, unchanged input snapshots, all-false quality claims and zero
external provider requests. Its result artifacts retain the exact profile and
both publication artifacts as parents. They are internal computation results,
not durable signed comparison publications.

- Receipt:
  `internal/verification-benchmark-comparison-application-a8f9486b-c122-4b7b-b9b5-e5c986dfaa9a.json`
- Receipt SHA-256:
  `026745c52ec033e663a79e2d553d26249ca91147be49b95100b7942eec622f1a`
- Baseline publication artifact:
  `73a1e6e0-f143-56b5-ae80-1c6464d55c87` /
  `sha256:90b557793172ccd7578c9b811885cbe706a860db95c548ce9488ba54fda49a53`
- Candidate publication artifact:
  `b3eb025c-e1b6-50fa-a4e8-3db76bbdd54d` /
  `sha256:d373330c39f692c999af7357512b58afe54611f05a70f6acd3e01878bb7ad54a`
- Paired profile artifact:
  `22d2b9d6-df4a-59f8-a7fa-30e3f1899492` /
  `sha256:f90a9693eb7efd6b746730ba75182478c6ea76ce9b5a980d3293df6656f86249`
- Paired internal result artifact:
  `11d51516-dd94-52cb-ab5d-bdb51d920217` /
  `sha256:948d6225771851de85e9bf4a42fac4ac4fa38f8a3fb95449528576ee6ba6db21`
  with result digest
  `sha256:faa5157f11c4032f543087ffc8d43889d43a96a524f3f3337aed4077216dcda6`
- Regression-gate profile artifact:
  `959d7bf6-d450-5bc2-ae32-cea57ff1b709` /
  `sha256:7b85fb32d295630520253cd33fb6b7c00d268b95758e299f5e2f0c0daa9e68ee`
- Regression-gate internal result artifact:
  `34abb59f-54ef-520a-a78d-ff344dffcd14` /
  `sha256:096a55eae6b786e406190eb0b55160ea01539b39fcedd4aef5fa5859222d7b0c`
  with result digest
  `sha256:7f7d02d4d63880d697ea9afa450485f147468439a5a7d899a98ab3bbe9909c3e`

The receipt includes the complete artifact handles and the worker runtime
identity used by the proof. The strict proof-script typecheck and the focused
10-test application suite pass.

Two earlier receipts are superseded. Receipt
`internal/verification-benchmark-comparison-application-b62ab51d-00a6-4b0e-89b6-d38ed9080edf.json`
used the broader historical `verification_benchmark_profile_file` type. Receipt
`internal/verification-benchmark-comparison-application-b68402a1-eeb2-4140-ade9-deadd3570640.json`
used the comparison profile type but predates the result semantic-digest
binding. The current proof uses new version-3 profile bytes and the v2
pipe-delimited UTF-8 transformation signature that binds the registered result
bytes, ordered parents and internal result digest. All earlier CAS
registrations remain immutable.

## Remaining integration

The coordinator owns the durable comparison row/lifecycle, signed publication,
operation/step integration, worker and public transports. This handoff makes
no EV or broader WS-08 acceptance claim.
