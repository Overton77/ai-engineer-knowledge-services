# WS-08 structured extraction candidate retention draft

Updated 2026-09-06. This draft records a bounded application-layer retention
builder. It is not an acceptance record and does not claim canonical operation
completion, a live provider call, provider quality, billing accuracy, a
verification seal, source authority, or calibration.

## Implemented boundary

`StructuredExtractionCapturedReplayService` now brands each accepted or known
failed replay result to its issuing service instance and original prepared
profile. Its assertion rejects a clone, a result from another instance, changed
result or preparation data, changed precontext bytes, and tenant, operation, or
provider-attempt drift. The brand keeps a private byte copy, so later mutation
of the caller-visible `Uint8Array` is detectable.

`StructuredExtractionCandidateBuilder` accepts that issuing replay service and
an artifact registration port. It accepts only an unchanged `accepted` result,
revalidates the output with the admitted extraction schema, takes synchronous
copies before its first write, and emits these application artifacts:

- `verification_extraction_candidate`: a canonical, operation-scoped envelope
  containing the unverified output and its separate canonical output digest;
- `verification_structured_extraction_precontext`: an optional scoped envelope
  containing the exact emitted precontext bytes as base64 and their digest;
- `verification_structured_extraction_provenance`: an immutable provenance
  record that binds the candidate, optional precontext, profile, schema, source,
  representation, transformation, transport, response envelope, request, and
  raw response.

The scoped envelopes prevent content-addressed identity collisions when two
operations produce identical output or precontext bytes but require different
immutable parent metadata. The raw precontext artifact type is not reused.

Candidate parent order is profile, extraction schema, source, representation,
transformation, transport checkpoint, response envelope, request, then raw
response. The optional precontext parent order is transport checkpoint,
response envelope, request, raw response, then profile. Provenance begins with
candidate and optional precontext, followed by the candidate ancestry.

Every transformation signature is SHA-256 over this pipe-joined ordered input:

```text
verification-structured-extraction-artifact.v1
artifact type
payload digest
tenant ID
operation ID
provider attempt ID
original dispatch fencing token
profile artifact ID
profile digest
prompt digest
schema digest
ordered parent artifact IDs
```

All fields are validated UUIDs, digests, a positive integer, or fixed artifact
types, so SQL can reproduce the byte string without JSON serialization.
Returned handles are parsed in full and checked for tenant, canonical creation
time, payload digest, byte length, exact ordered parents, and transformation
signature. Cancellation is checked before and after every write. A failed
replay produces no candidate or precontext.

The lifecycle caller supplies canonical lowercase UUIDs for the operation,
provider attempt, and producer attempt plus a canonical UTC millisecond
`createdAt`. The builder does not read the clock. Its result remains
`unverified_candidate` and contains no verification, authority, or calibration
claim.

## Focused evidence

The following commands pass in `ai-engineer-knowledge-services`:

```powershell
corepack pnpm --filter @aiengineer/knowledge-application exec vitest run src/verification-structured-extraction-candidate.test.ts
corepack pnpm --filter @aiengineer/knowledge-application typecheck
corepack pnpm --filter @aiengineer/knowledge-application build
```

The focused Vitest run passes one file and five tests. It covers exact ancestry
and signature reconstruction, distinct content-addressed candidate identities
for equal output under two operations, emitted-precontext retention with
mutation during a write, clone/other-instance/altered/scope rejection before
writes, failed replay with zero writes, returned digest/size/parents/signature
drift, and cancellation before and after a write. The complete application test
command also passed 28 files and 175 tests during development.

## Remaining work

This builder deliberately stops before durable extraction lifecycle and
terminal publication. Canonical checkpoint identity, operation lease/fence
guards, terminal transitions, configured worker and public transports, process
recovery, supplier reconciliation, live-provider evidence, independent
verification, human gold, calibration, deployment, and final audit remain
separate work.
