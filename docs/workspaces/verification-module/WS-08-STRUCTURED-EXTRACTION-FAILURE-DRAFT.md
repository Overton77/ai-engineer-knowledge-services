# Structured extraction captured-failure publication draft

Date: 2026-09-06 UTC  
Owner: extraction-failure-publication agent  
Status: failure-publication and failed-operation-result contract/application slices implemented; durable checkpoint, SQL admission, terminal receipt, actual proof and independent audit remain coordinator-owned

## Delivered boundary

The new `verification_structured_extraction_failure` artifact publishes only an issuer-branded, captured native provider failure. Its four admitted codes are `PROVIDER_HTTP_FAILURE`, `PROVIDER_RESPONSE_TOO_LARGE`, `PROVIDER_RESPONSE_INVALID`, and `PROVIDER_RESPONSE_SCHEMA_INVALID`. HTTP failure requires status 300–599. The other three codes require a 2xx response. Every published failure fixes `automaticRetry` to `false`, has a derived `provider_http` or `producer_contract` category, and carries a null candidate reference. It has no output, precontext, provenance, validation-quality, or verification-quality claim.

The application builder calls `StructuredExtractionCapturedReplayService.assertReplayResult` on the original preparation and replay objects before cloning or awaiting. It rejects accepted, cloned, changed, cross-issuer, cross-tenant, and cross-operation results. Current adapter failures must have null precontext. The caller supplies a full `retaining` lifecycle snapshot with a null `completedAt`; the durable failure checkpoint supplies the canonical completion timestamp used by the artifact.

Before signing, the builder freshly authorizes and hydrates the complete execution/profile/schema/source/representation/transformation/transport/envelope/request/raw chain. It checks canonical execution and runtime identity, execution transformation metadata, dirty source custody paths and native file bytes, full registered handles, extraction profile/schema and selected projection evidence, provider registration/configuration/model/budget, response wire bindings, raw cost-evidence identity, provider-call state, and all lifecycle/preparation/replay bindings. It snapshots every caller-owned input before the first await.

The signed manifest uses schema `verification-structured-extraction-failure.v1`, contract `verification.v1`, native Ed25519, canonical body bytes, and the custody-only purpose. The exact ordered parent list is execution, profile, optional dirty source custody, schema, source, representation, transformation, transport, response envelope, request, and raw response. The transformation signature is the pipe digest beginning `verification-structured-extraction-failure-artifact.v1` and includes the full failure/timestamp/scope fields plus ordered parents. Registration uses the DB-owned `completedAt` as artifact creation time.

## Public API

Contracts export:

- `StructuredExtractionFailureCodeSchema` and `StructuredExtractionFailureCode`;
- `StructuredExtractionFailureLifecycleSnapshotSchema` and `StructuredExtractionFailureLifecycleSnapshot`;
- `VerificationStructuredExtractionFailureSchema` and `VerificationStructuredExtractionFailure`.

Application exports:

- `StructuredExtractionFailureArtifactBuilder`;
- `StructuredExtractionFailureArtifactPort`;
- `VERIFICATION_STRUCTURED_EXTRACTION_FAILURE_ARTIFACT_TYPE`;
- `structuredExtractionFailureParentArtifactIds`;
- `structuredExtractionFailureTransformationSignature` and its input type.
- `createStructuredExtractionFailureOperationResult`.

Builder construction is `new StructuredExtractionFailureArtifactBuilder(replayService, { artifacts, createResolver, signer })`. `publish` accepts tenant/operation/provider-attempt scope, original preparation and replay result, the retaining lifecycle, DB checkpoint `completedAt`, full execution artifact, provider-call snapshot, and optional cancellation signal. It returns `{ manifest, artifact, payloadDigest }`.

`createStructuredExtractionFailureOperationResult({ manifest, artifact, verifier })` accepts only a full `VerificationStructuredExtractionFailure` manifest, its full registered custody artifact, and a server-owned `AuditBundleSignatureVerifier`. It snapshots inputs before verification, requires the canonical failure body SHA-256 seal, a canonical 64-byte Base64 Ed25519 signature, the provider-call digest, and exact full artifact digest, byte length, completion time, ordered parent list, and native failure transformation signature. It returns only `verification-operation-result.v1` with `status: "failed"`, one of the four native failure codes, the derived category, `automaticRetry: false`, `candidateArtifact: null`, execution/manifest/provider-call references, and the full result artifact. The strict contracts reject candidate, accepted, quality, retry, scope, and forged-shape drift.

## Verification completed

- `corepack pnpm --filter @aiengineer/knowledge-contracts build` — passed; generated JSON Schema/OpenAPI/manifest refreshed.
- `corepack pnpm --filter @aiengineer/knowledge-contracts test` — 10 files, 44 tests passed.
- `corepack pnpm --filter @aiengineer/knowledge-application typecheck` — passed.
- `corepack pnpm --filter @aiengineer/knowledge-application test -- verification-structured-extraction-failure.test.ts` — full application suite ran, 31 files and 193 tests passed.
- `corepack pnpm --filter @aiengineer/knowledge-contracts build` — passed after adding the failed operation-result schema and refreshing generated JSON Schema/OpenAPI/manifest.
- `corepack pnpm --filter @aiengineer/knowledge-contracts test -- structured-extraction-failure-result.test.ts` — 11 files, 46 tests passed.
- `corepack pnpm --filter @aiengineer/knowledge-application typecheck` — passed.
- `corepack pnpm --filter @aiengineer/knowledge-application test -- verification-structured-extraction-failure-result.test.ts` — 32 files, 196 tests passed.
- `corepack pnpm --filter @aiengineer/knowledge-application build` — passed.

The new application tests use actual producer-profile admission and actual captured replay, verify the native Ed25519 signature, exact ancestry and transformation digest, reject unbranded/cloned/changed replay, enforce status/code semantics, prove pre-await input snapshots and post-sign cancellation, and reject execution/runtime/source/source-custody/registered-metadata drift.

## Coordinator integration

The coordinator owns the durable failure checkpoint and publication store, database migration 325+, exact failed terminal receipt, actual local proof, custody audit, and terminal wiring. The checkpoint should consume the exported retaining lifecycle and failure-code types, create the canonical `completedAt`, and pass that timestamp unchanged into `publish`. Database publication admission should reproduce the exported ordered parents and transformation signature and require the registered canonical payload/seal/provider-call digest.
