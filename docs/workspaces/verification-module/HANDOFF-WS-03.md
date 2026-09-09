# WS-03 persistence and provenance handoff

**State:** ready for coordinator review; overall acceptance is not claimed.  
**Implementation owner:** verification-persistence-agent  
**Date:** 2026-09-05

## Delivered boundary

WS-03 adds pure audit sealing, inspection, and deterministic replay beneath `packages/verification/src/provenance`. The signable manifest projection excludes `canonicalization.manifestDigest` and `signatureArtifactId`; the outer detached seal is excluded from its own payload. Full immutable artifact handles, tenant identity, policy artifact/version, parent declarations, explicit lineage edges, and lineage cycles are checked consistently. Public values reject normalized credential and private-reasoning field names while retaining measured `inputTokens`, `outputTokens`, and `tokenUsage`. Ed25519 signatures are optional; malformed signatures and verifier failures return invalid inspections.

The verification persistence adapter composes the existing `ArtifactStore` with `orchestration.artifact`. It reserves a registry row before upload, writes with verification's default no-overwrite Storage mode, rehydrates and verifies digest/byte length, then marks the row available. Failed writes remain registered as `failed` and can be retried safely. Full handle metadata lives in the additive `orchestration.verification_artifact_metadata` table and collisions compare the complete canonical handle. A trusted resolver is created per replay request; each successful authorization produces one matching, consumed hydration ticket.

The canonical DB series is additive and applied locally through `20260905020000`. It supplies tenant-consistent keys, verification artifact lifecycle and metadata, private CAS bucket policies, source/capture/locator/run/finding mappings, producer/verifier deployment separation, append-only judgments, immutable evaluation manifests, and claim taxonomy reconciliation. The revised first migration keeps new legacy-table fields nullable and contains a read-only ownership preflight before composite legacy constraints, so a populated deployment does not fail at an unconditional `ADD ... NOT NULL`. It aborts with named remediation hints if source captures or claims have missing/cross-tenant source, artifact, or attempt ownership. Additive follow-up migrations reconcile the already-applied local development history. The migration never infers ownership, deletes rows, or backfills production data. Existing local rows passed the preflight without a reset; a fresh-chain deployment verification remains required in the final remote audit.

## Stable interfaces

- `sealAuditBundle`, `inspectAuditBundle`, `verificationManifestSignablePayload`, `verificationManifestDigest`, and `auditBundleSignablePayload` define the public sealing boundary.
- `replayAuditBundle` rehydrates registered capture/projection and policy bytes, reruns `verifyDeterministicBundle`, compares deterministic and policy decision digests/outcomes, and returns replayed artifact IDs.
- `TrustedArtifactResolver` requires `authorizeArtifact` before `hydrateRegisteredArtifact`. `PostgresVerificationRepository.createTrustedArtifactResolver()` supplies one request-scoped implementation.
- `VerificationPolicyReplayPort` is the WS-05 boundary. WS-03 persists and verifies policy bytes/version/outcome but does not implement semantic or admission policy.
- `createVerificationArtifactHandle` produces tenant CAS identity and canonical millisecond UTC timestamps; externally supplied noncanonical timestamps fail before SQL rather than changing a sealed handle. `PostgresVerificationRepository` registers artifacts and records captures, resolved locators, canonical claim assertions, runs, and append-only judgments.
- Persistence explicitly requires canonical UUIDs for DB-backed public IDs and fails before SQL with `PERSISTENCE_CANONICAL_UUID_REQUIRED:<field>`. A later transport may map symbolic contract IDs, but WS-03 does not silently coerce them.

## Canonical database and package pin

Migrations introduced or stabilized by WS-03 are `20260905010000_verification_persistence_contract.sql` through `20260905020000_verification_locator_selected_content.sql`. The final local migration list is aligned through `20260905020000`; generated types are current and DB typecheck passes.

Consumers pin `@aiengineer/database-contract@0.2.0` through `packages/persistence/vendor/aiengineer-database-contract-0.2.0.tgz`, SHA-256 `f4499825289438b64c9d336d176ccf7a64a18aa1eef4cc0865d6853c1ca55dfb`. The pin contains the generated contract and complete migration series. Remote deployment was not performed.

The final integrated `corepack pnpm verify` run passed typecheck 42/42 tasks, tests 42/42 tasks, and build 24/24 tasks. Its 956-line log is `../../../../internal/verification-ws03-full-verify-20260905-2316.log`, SHA-256 `63ba1cb05975e6f979e1a8e63d4cec1821b86176f63d64208152f790dceb237d`.

## Real proof

The independent coordinator proof is EV-012 and the authoritative owner proof is EV-013. The owner run passed 25/25 checks against the existing local Supabase Postgres and Storage stack without reset. The final owner run uses tenant `0b7506b7-2e51-4469-be18-ba7729a4a319`, run `11f13bc6-1076-520a-a27a-9ce47a0f42d3`, and sealed manifest artifact `aea4d719-9706-59bf-a3d3-aac3025426b6` with digest `sha256:b0d34b569d6fd7adf1b24c4a71810b803869c6af6d74873ae2d0b4f04ebfafaa`.

Its inner signable manifest digest is `sha256:8b93029f852e7ed582ab6c692c5b912e2ed168d2ce9ab24adb294fe0b39fb7ac`; detached seal payload digest is `sha256:17a35f2033126442aa777ae8a0799cc18621cd2754691991882b1c117c7b4278`. These are deliberately distinct from the stored audit artifact byte digest. EV-012 includes the independent real HTTP/JWT Storage policy coverage.

## Review limits

The proof leaves isolated synthetic rows and registered private objects as evidence. It does not mutate or delete pre-existing research rows. The migration preflight has run only against the current local database; production operators must run a fresh-chain verification, execute the canonical migration preflight, remediate any named ownership failures, and review the resulting plan before remote deployment.

Authorization policy decisions are supplied by composition through `ArtifactAuthorizationPort`; WS-03 proves authorization ordering and request-scoped ticket consumption, not production caller identity resolution. Semantic correctness, actual policy logic, non-text selectors, providers, benchmark statistics, transports, dashboards, and remote rollout remain later workstreams.
