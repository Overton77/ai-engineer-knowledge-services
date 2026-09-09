# WS-08 Registered Benchmark Projection Preparation Handoff

## Scope

Added only:

- `packages/application/src/verification-benchmark-projections.ts`
- `packages/application/src/verification-benchmark-projections.test.ts`

No application exports, runner, observation loader, worker, transport,
persistence, provider, filesystem, or migration files changed.

## API

```ts
prepareRegisteredBenchmarkProjections(
  admitted: AdmittedOfflineBenchmarkInputs,
  context: { tenantId: unknown; signal?: AbortSignal },
  ports: { captures, admission, maximumSelectedTextBytes? },
)
```

The result is deeply frozen and contains a null-prototype `byCaseId` dictionary
whose entries have null-prototype `byFragmentId` dictionaries. It returns only
compact IDs, digest, selector status, `locatorValid`, and optionally bounded
UTF-8 `selectedText`; it never returns projection/source byte arrays. The
selected-text cap defaults to 8 KiB and may be configured from 1 byte to 64
KiB. This supports legal verification IDs such as `__proto__` and
`constructor` without prototype lookup or mutation.

## Custody and mechanics

The preparer re-checks the previously admitted tenant/grant/request/handle
bindings and reruns `assertFrozenVerificationBenchmarkDataset`. For **every**
evidence edge it obtains the tenant-scoped canonical capture, verifies exact
capture/source/content-artifact binding, then calls the existing
`VerificationAdmissionService.hydrateAdmittedProjection` structural port with
that source artifact and the edge transformation/projection IDs. It validates
the returned receipt tenant, source, projection ID/digest, byte length, and
SHA-256 bytes before selector work.

Capture, envelope, receipt, and projection byte integrity failures stay
terminal custody errors. The function uses `projectionSelectorResolver`; a
selector that is unresolved, ambiguous, invalid, malformed, or returns a
selected-content digest different from the retained edge digest instead produces
`locatorValid: false`. Text is retained only for resolved, digest-matched,
bounded UTF-8 selections. This preserves intentionally adversarial selector
cases without treating them as parser/admission success or quality success.

Cancellation is checked before and after each awaited capture/projection
operation and consistently becomes the sanitized `BENCHMARK_CANCELLED` error;
the abort reason is never exposed. It is not converted into a mechanical result.

When a resolved, digest-matched selection exceeds the text cap, `locatorValid`
remains true but `selectedText` is omitted. The downstream executor must treat
that omission as unavailable text, never as an empty or usable excerpt.

## Focused validation

From `packages/application`:

```text
corepack pnpm run typecheck
corepack pnpm exec vitest run src/verification-benchmark-projections.test.ts
```

Both pass. The five unit-only tests cover all 31 fixture evidence edges,
selector-digest mismatch as a mechanical false result, foreign capture and
corrupt projection-byte terminal failures, cancellation propagation, deep
freezing/no-byte output, and adversarial object-key safety. They use injected
capture/admission fakes; no provider, filesystem, migration, or external
service is invoked.
