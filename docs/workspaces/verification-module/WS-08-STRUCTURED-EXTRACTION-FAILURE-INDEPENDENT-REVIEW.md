# WS-08 structured extraction failure — independent review

Date: 2026-09-06 UTC  
Scope: bounded captured-failure contract, builder, persistence adapter, and migration `20260906032500`; no terminal-receipt or worker-completion review.

## Finding

### Historical candidate — provider configuration snapshot omitted from the accounting digest (closed; not actionable)

`StructuredExtractionProviderCallSnapshotSchema` makes `configurationDigest` part of the signed failure manifest, and the application builder checks it against the admitted producer profile. The persistence boundary and SQL admission do not preserve that check:

- [`verification-structured-extraction-publication.ts`](../../../packages/application/src/verification-structured-extraction-publication.ts) lines 166–182 compute `structuredExtractionProviderCallDigest` without `configurationDigest`.
- [`verification-structured-extraction-failure.ts`](../../../packages/persistence/src/verification-structured-extraction-failure.ts) lines 50–53 accept that digest and verify the seal, but do not compare the field to a canonical provider/profile fact.
- [`20260906032500_verification_structured_extraction_failure.sql`](../../../../ai-engineer-db-contract/supabase/migrations/20260906032500_verification_structured_extraction_failure.sql) lines 77–83 independently recompute the same incomplete digest. The provider-attempt row has no configuration-digest column to consult.

The initial review treated a directly supplied valid signature as an untrusted input. That is not the implemented trust boundary. The only issuer path first calls `StructuredExtractionCapturedReplayService.assertReplayResult` on the issuer-branded preparation and replay result, then hydrates the immutable registered producer profile and requires `providerCall.configurationDigest === profile.providerConfigurationDigest === registered.configurationDigest` before signing. The execution ancestry binds that profile. Persistence verifies the complete sealed manifest with the required server-owned Ed25519 verifier; it does not accept a caller-selected signer or verifier.

No untrusted path was identified that can alter the configuration field while retaining an accepted seal. Doing so requires compromise or misuse of the trusted signing authority, which could forge every signed manifest field and is outside this bounded SQL-admission model. The deliberately shared provider-call digest covers durable provider-accounting facts, while the signed manifest and verified execution/profile ancestry carry configuration custody. No migration or shared-digest change is recommended from this review.

## Checks that passed review

- Active operation, exact running step, lease token, fencing token, holder identity, and expiry are revalidated under `FOR UPDATE` before initialize and publish; the trigger repeats the live-claim check.
- Lifecycle, execution, operation attempt, request, profile, source-custody, capture, and timestamp bindings are rechecked against locked canonical rows.
- The failure path enforces null candidate/precontext/provenance at the retaining boundary and the lifecycle exclusion trigger prevents later candidate retention once a failure checkpoint exists.
- Parent order and transformation signature are independently recomputed in application and SQL; SQL also verifies artifact type, digest, producer attempt, creation time, metadata parents, and signature.
- Native failure classification is constrained to HTTP `300–599` for `PROVIDER_HTTP_FAILURE` and `2xx` for the three captured producer-contract failures. The documented local proof covers both adapters and the HTTP-503/schema-200 cases.

## Review status

**STATUS: REVIEW COMPLETE — no actionable finding in the bounded slice. One provider-snapshot candidate was reviewed and closed because its proposed mutation requires trusted signing authority. No stale-lease, identity, no-candidate, metadata-order, failure-code, or untrusted provider-snapshot admission bypass was found.**
