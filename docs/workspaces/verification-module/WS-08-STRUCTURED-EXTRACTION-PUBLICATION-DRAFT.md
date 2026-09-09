# WS-08 structured extraction publication draft

Updated 2026-09-06 UTC. `extraction_publication_contracts` owns the bounded
contracts and application builders for pre-dispatch execution provenance and
accepted-candidate final publication. The coordinator owns persistence,
migrations, actual Storage/SQL proof, terminal receipts, and review.

## Implemented scope

- `packages/contracts/src/verification/structured-extraction-publication.ts`
  and focused contract tests/exports;
- `packages/application/src/verification-structured-extraction-publication.ts`
  and focused builder tests/exports;
- this draft and the matching `STATUS.md` update.

`StructuredExtractionExecutionArtifactBuilder.prepare` snapshots all caller
input, freshly authorizes and hydrates the complete producer-profile handle and
optional required dirty-state handle, parses canonical producer-profile bytes,
and registers `verification_structured_extraction_execution`. Its strict v1
payload binds canonical operation/step/producer/request identity, the full
profile handle, deployment/capability/platform/container/code identity,
synthetic-or-live execution and network policy, parser/extractor/canonicalizer
versions, and the lifecycle-supplied canonical creation time. A clean claim
requires a committed 40- or 64-hex Git identity; `uncommitted` requires a full
dirty-state artifact. The payload has no provider URL, key, prompt, policy, or
invented normalizer field.

The execution transformation signature is a pipe SHA-256 over this exact order:

```text
verification-structured-extraction-execution-artifact.v1
payload digest
tenant ID
operation ID
operation step ID
producer attempt ID
request digest
step input digest
profile digest
canonical runtime digest
execution mode
createdAt
ordered parents (profile ID, then dirty-state ID iff dirty)
```

`StructuredExtractionPublicationArtifactBuilder.publish` accepts an explicit
application-owned snapshot matching the retained persistence lifecycle, the
registered execution artifact, and one strict original provider-call snapshot.
Before signing or writing, it freshly hydrates the exact execution, profile,
dirty source, raw cost-evidence response, candidate, provenance, and optional
precontext artifacts. It parses canonical native execution, profile,
candidate, provenance, and precontext envelopes; recomputes their payload and
output/precontext hashes; reconstructs the candidate-builder transformation
signatures and ordered ancestry; and binds all original identity, capture,
dispatch-fence, request/raw/envelope/transport, and canonical timing fields.

The provider-call snapshot binds ordinal `0..8`, budget, registered provider
and model, registered configuration digest, reservation, truthful settled or
unknown cost, pricing basis, and the full raw-response cost-evidence handle.
Unknown dispatched/uncertain cost is `null`, never zero. Settled cost is
nonnegative and no larger than the reservation. `supplierBillingVerified` is
fixed false; no pricing rate is invented. Its SQL-reproducible helper omits the
configuration digest because the execution/profile payload already owns that
custody, and hashes this exact order:

```text
verification-structured-extraction-provider-call.v1
provider attempt ID | budget ID | provider ID | model | attempt ordinal
reservation cost micros | state | actual cost micros or "unknown"
pricing basis | raw cost-evidence artifact ID | raw cost-evidence digest | false
```

The final v1 manifest embeds both the execution artifact and its strictly
decoded payload, fixes output status to `unverified_candidate`, labels schema
validation `shape_only`, and requires an Ed25519 seal with purpose
`artifact_custody_only`. The signature is custody evidence and makes no
quality-verification claim. The publication transformation signature hashes,
in order, its own payload digest, detached-seal payload digest,
tenant/operation/step/producer IDs, execution/candidate/provenance digests,
provider-call digest, original dispatch fence, all three canonical lifecycle
times, and the exact ordered parent IDs. Public contract generation now emits
the runtime, execution, lifecycle snapshot, provider-call, and final publication
JSON Schemas and OpenAPI components.

No persistence, migration, worker, transport, provider dispatch, quality
verification, failure-result publication, or terminal success behavior is
owned by this task.

## Focused evidence

The following commands pass in `ai-engineer-knowledge-services`:

```powershell
corepack pnpm --filter @aiengineer/knowledge-contracts test
corepack pnpm --filter @aiengineer/knowledge-contracts typecheck
corepack pnpm --filter @aiengineer/knowledge-contracts build
corepack pnpm --filter @aiengineer/knowledge-application test
corepack pnpm --filter @aiengineer/knowledge-application typecheck
corepack pnpm --filter @aiengineer/knowledge-application build
```

Contracts pass 8 files/37 tests. Application passes 29 files/182 tests. The
new focused suites contribute three contract tests and seven application tests,
covering strict/no-secret shapes, dirty/runtime/network constraints, required
custody signature, unverified output semantics, unknown/settled cost rules,
exact SQL hashes and ancestry, forged profile denial before writes, native
candidate drift, dirty-source drift, precontext drift, provider/accounting
drift, and cancellation after signing before publication registration.

This is implementation evidence for coordinator review. The coordinator still
owns the required pre-dispatch DB guard, final fenced persistence, exact success
receipt, migration replacement, actual Storage/SQL proof, and independent
review. Durable failure outcomes remain a separate next slice.
