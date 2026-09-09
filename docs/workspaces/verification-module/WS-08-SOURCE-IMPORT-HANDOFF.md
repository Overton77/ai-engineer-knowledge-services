# WS-08 source import admission handoff

## Delivered scope

`packages/application/src/verification-benchmark-source-import.ts` exports:

- `RegisteredBenchmarkSourceImportCatalog`
- `RegisteredBenchmarkSourceImportAdmission`
- `RegisteredBenchmarkSourceImportGrant`
- `RegisteredBenchmarkSourceImportResult`

The trusted grant binds the exact benchmark `tenantId`, dataset artifact ID/digest, offline experiment artifact ID/digest, imported manifest ID/digest, and the complete original-artifact-ID to imported-copy ID/digest map. `prepare(admitted, tenantId, signal?)` returns only prepared selector mechanics plus compact imported-manifest and provenance mapping references. It returns no source bytes.

## Admission boundaries

- The admitted dataset/experiment pair, frozen dataset digest, and offline mode are checked before resolver I/O. A missing catalog grant fails before an artifact read.
- The real resolver is called only with the caller's benchmark tenant and imported artifact IDs. It authenticates the imported manifest and every imported copy.
- The manifest is limited to 1 MiB; it permits at most 128 artifacts. Every artifact is capped at 8 MiB and manifest plus copies at 32 MiB.
- Manifest bytes must hash exactly to `dataset.sourcePreparationDigest`. The strict retained-manifest parser validates all 82 original handles and captures, one original tenant, full capture content-handle equality, registry-handle equality, and complete artifact parent closure.
- Every mapping is complete and unique by original identity. Imported IDs can only coalesce when their digest is identical. Each authenticated copy must match its registered imported handle and the original retained handle's digest and byte length.
- The internal `SourceImportArchive` contains only authenticated copy bytes keyed by original identity. Its resolver is authorization-ticketed, consumes each ticket on hydrate, exposes only the original tenant, rejects parser calls and writes, and has no external resolver or source-tenant fallback.
- Existing `VerificationAdmissionService` uses the historical sealed native parser deployment `sha256:1669a3f9674b2e0a70ba1c8686c1cb3647492b8268bdfa7a9a4452fb0530fb37` with `VERIFICATION_PARSER_LIMITS`; `prepareBenchmarkProjectionDataset` processes every dataset evidence edge under the internal original tenant. Selector failures remain mechanical `locatorValid: false` outcomes.
- Abort is checked before and after each real resolver await and inside the private archive. It raises the sanitized `BENCHMARK_CANCELLED` code.

## Validation

`pnpm --filter @aiengineer/knowledge-application typecheck` passed.

`pnpm --filter @aiengineer/knowledge-application test -- verification-benchmark-source-import.test.ts` passed 4/4. The test reads the retained source-preparation manifest and all 82 artifact files into a benchmark-tenant-only in-memory resolver. It covers successful full projection preparation, missing grant before I/O, changed copied bytes, cancellation before I/O and immediately after authorization, and asserts no resolver invocation carries an original-tenant or original artifact ID.

## Integration input

Root's local source-import proof can construct one `RegisteredBenchmarkSourceImportGrant` from the canonical imported manifest record and all 82 payload mappings, instantiate `RegisteredBenchmarkSourceImportAdmission(catalog, trustedResolver)`, then call `prepare(admittedInputs, benchmarkTenant, signal)`. The returned `mappings` include every original/imported identity and digest for custody audit.