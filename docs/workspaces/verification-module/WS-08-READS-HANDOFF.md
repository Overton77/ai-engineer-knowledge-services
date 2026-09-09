# WS-08 sealed verification-run reads handoff

Updated 2026-09-05.

## Delivered boundary

The application read boundary is `VerificationRunReadService` in
`packages/application/src/verification-reads.ts`.

```ts
new VerificationRunReadService({ loadAuditBundle })
```

`VerificationRunAuditBundlePort.loadAuditBundle(tenantId, runId)` is the only
dependency. The persistence adapter remains the authority for canonical
`evidence.verification_run`, registered artifact, seal, policy, result, and
manifest binding validation. The application repeats strict request UUID
validation, parses the returned manifest, and checks the requested tenant and
run IDs before any projection.

The public methods are:

- `getRun({ tenantId, runId })`
- `getRunManifest({ tenantId, runId })`

They return the public contract resources
`VerificationRunSummaryResource` and `VerificationRunManifestResource`.
`VerificationRunReadError` has only `INVALID`, `NOT_FOUND`, and `INTEGRITY`
codes. Exact `VERIFICATION_RUN_NOT_FOUND` is the sole missing-resource mapping;
all other port and binding failures are sanitized as `INTEGRITY`.

## Public projection

`packages/contracts/src/verification/reads.ts` supplies the strict schemas.
Artifact references expose only `{ artifactId, digest, mediaType, sizeBytes }`.
The manifest view also provides bounded input/output artifact lists, stage
timing/status, version/code/runtime metadata, compact provider identity and
pricing-artifact reference, aggregate call costs plus explicit actual,
estimated, reserved, and unknown-dispatched counts, and canonicalization
algorithm/version/digest metadata.

It excludes artifact object keys and handles, bundle/result bodies, source
bytes, provider native configuration and response IDs, judgments/evidence/
public rationale, policy decision body, and detached seal signature/key fields.
No durable operation ID is inferred from a sealed run ID.

## Validation

Unit-only coverage in `packages/application/src/verification-reads.test.ts`
checks:

- compact projection strips raw bundle/provider/storage/seal fields;
- returned tenant and run binding drift becomes a safe integrity error;
- malformed UUID input, missing run, and integrity failure remain distinct;
- mixed provider-cost states retain cost sums and state counts; and
- unsafe aggregate arithmetic and overlong public strings/media types are rejected.

The focused tests passed with:

```text
vitest run packages/application/src/verification-reads.test.ts
# 5 passed
tsc --noEmit -p packages/application/tsconfig.json
tsc --noEmit -p packages/contracts/tsconfig.json
```

The runtime/API/client/CLI/MCP proof is owned by integration. Its existing
guarded proof completed against a sealed persisted run and is logged at
`internal/verification-reads-run-e124ba8a-ff8d-4d96-9657-575bb3c4caee.log`.
