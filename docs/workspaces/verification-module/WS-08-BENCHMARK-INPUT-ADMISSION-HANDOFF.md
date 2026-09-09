# WS-08 Registered Benchmark Input Admission Handoff

## Scope

Added only:

- `packages/application/src/verification-benchmark-inputs.ts`
- `packages/application/src/verification-benchmark-inputs.test.ts`

The contracts owner supplied and exported
`VerificationBenchmarkExperimentDefinitionSchema`; no application export,
worker, transport, persistence, provider, filesystem, or migration change is in
this handoff.

## Reuse and boundary

`OfflineBenchmarkInputCatalog` receives trusted runtime grants keyed by tenant
and the exact public dataset/experiment artifact ID+digest pair. The public
`RunBenchmarkRequestSchema` carries no profile authority. A request must match
one such grant before any artifact authorization or hydration occurs.

`RegisteredBenchmarkInputAdmission.load(request, { tenantId })` then uses the
public `TrustedArtifactResolver` with `verification_admission` purpose. It
checks both dataset and experiment registrations for exact tenant, artifact ID,
digest, byte length, and SHA-256 bytes. Default artifact cap is 4 MiB; runtime
configuration can set 1 byte through 16 MiB. The dataset is strictly parsed and
checked by `assertFrozenVerificationBenchmarkDataset`.

The experiment is strictly parsed using the new canonical
`VerificationBenchmarkExperimentDefinitionSchema`, which is offline-only. Its
dataset manifest digest must equal the admitted frozen dataset manifest and its
runner version must equal the trusted grant. The admission also bounds total
work as `cases * arms * repetitions`: default 4,000, configurable from 1 to
160,000. It deep-freezes the complete admitted output graph before returning typed recorded-observation artifact references and does not
hydrate, replay, execute, or dispatch them. The future worker owns cancellation,
lease fencing, checkpoint persistence, clock/recovery, and result sealing.

## Focused validation

From `packages/application`:

```text
corepack pnpm run typecheck
corepack pnpm exec vitest run src/verification-benchmark-inputs.test.ts
```

Both pass. The eight unit-only tests cover exact admission, strict public input
and pre-I/O trusted grant rejection, foreign/wrong-length registration,
artifact and matrix bounds, experiment dataset/runner binding, deep nested mutation rejection, and malformed
caller tenant. The tests use an injected in-memory resolver; no provider,
filesystem, migration, or external service was used.

