# SW-02 public audit inspection progress

## Scope and invariants

Wire `inspectAuditBundle` as a durable operation across contracts, application submission, worker, HTTP, TypeScript client, CLI, MCP, and generated OpenAPI. The operation must admit only an exact tenant-bound audit artifact granted by server configuration before enqueue, use only server-owned signature keys and replay/runtime/projection trust, preserve typed safe inspection failures, retain bounded cancellation/deadline behavior, and register its compact terminal result through the current lease-fenced artifact path. It must never expose raw evidence, policy bodies, storage credentials, object keys, caller-supplied keys, or a policy-admission claim.

The implementation will reuse `VerificationAuditInspectionApplicationService` and canonical report-aware `replayVerificationAudit`; no inspection, signature, deterministic, report-gate, or policy algorithm will be duplicated.

## Initial source checkpoint

The operation vocabulary and canonical step already exist as `verification_audit_bundle` / `inspect_audit_bundle_and_register`, but the application submit method intentionally throws `CAPABILITY_NOT_ADMITTED`, `productionWorkerStepsByKind` does not advertise the operation, and no configured worker handler exists. The request schema is already strict and accepts only `{ verificationContractVersion, auditBundle: { artifactId, digest } }`.

The current compact result schema lives in application source. It must move to contracts so the worker terminal receipt and every transport can validate the same public shape; application will import and re-export it for compatibility. A separate strict durable operation-result schema is required to bind operation ID, request digest, compact output, and the fenced result artifact handle.

Worker trust composition requires bounded server-owned configuration for:

- exact audit artifact grants, keyed by tenant plus full `{ artifactId, digest }` reference;
- Ed25519 public keys keyed by manifest `keyId`;
- historical verifier/runtime principal binding from native `evidence.verification_run` ownership;
- native projection admission envelopes revalidated from configured claims projection grants and the existing `VerificationAdmissionService`.

API admission must parse the same exact artifact grant catalog before enabling the operation. The enable flag alone must never enqueue work. Worker startup must fail closed unless the audit grant catalog, trusted public keys, native repository/admission, and replay trust dependencies are all configured.

## Artifact vocabulary preflight

The activity needs one fenced compact terminal artifact. Existing vocabulary `deterministic_verification_result` can represent the operation result, but a dedicated `verification_audit_inspection_result` type would make custody and reads unambiguous. No native writes will start until the coordinator decides and, if selected, applies the canonical migration. Source work and focused in-memory tests can proceed meanwhile.

## Current status

Source integration now includes the strict contracts result/operation-result/public-resource schemas; exact tenant + artifact digest grant catalog; application submission and compact inspection read services; worker activity and trusted runtime composition; configured API admission; TypeScript client, CLI, and MCP submission/read surfaces; and generated OpenAPI registration. The worker reuses the proven canonical inspection and report-aware replay services, reconstructs historical principals from native run ownership, and rehydrates each granted projection admission envelope. It writes only the compact result through `registerFencedContentAddressedArtifact` using the reserved `verification_audit_inspection_result` vocabulary.

The terminal read is not metadata-only. It checks the operation kind/state, exact step/input/receipt identity, fencing token, request digest, audit parent, result registration type/bucket, transformation signature, full internal handle, content digest, and canonical result bytes, then re-reads terminal state to reject drift. Its public projection removes object keys and internal producer/storage fields.

Canonical migration `20260907011000` is locally applied and package DB contract `0.2.31` is installed with independent 137-migration and 72-artifact-type parity. No audit inspection operation has yet been enqueued and no audit result artifact has yet been written. Ordered package builds and focused behavioral tests are the next checkpoint; native worker/HTTP/CLI/MCP proof follows only after those checks pass.

## Source verification checkpoint

The first dependency-ordered build exposed and fixed one contracts import mismatch and two worker typing gaps. The stable commands then completed with exit `0`:

- `corepack pnpm --filter @aiengineer/knowledge-contracts build`
- `corepack pnpm --filter @aiengineer/knowledge-application build`
- `corepack pnpm --filter @aiengineer/knowledge-persistence build`
- `corepack pnpm --filter @aiengineer/knowledge-client build`
- `corepack pnpm --filter @aiengineer/knowledge-worker typecheck`
- `corepack pnpm --filter @aiengineer/knowledge-api typecheck`
- `corepack pnpm --filter @aiengineer/knowledge-cli typecheck`
- `corepack pnpm --filter @aiengineer/knowledge-mcp typecheck`

Package test runs completed with exit `0`: contracts 52/52, application 213/213, worker 72 passed with 5 skipped, API 69 passed with 5 skipped, client 9/9, CLI 19/19, MCP 20 passed with 1 skipped, and persistence 72 passed with 14 skipped. These package scripts execute their full local suites even when focused file arguments follow `--`; the counts therefore cover the existing package suites plus the new audit cases.

Review-driven hardening in this checkpoint:

- cancellation polling is serialized, aborts on native lookup failure, and cannot overlap slow reads;
- content-addressed recovery was checked against `registerFencedContentAddressedArtifact`, whose reusable branch revalidates the live lease and returns the original immutable metadata;
- configured audit grants now label only `claims` or `report`; API admission verifies the exact retained manifest maps to one succeeded native operation of that kind before enqueue, and the worker repeats the operation-kind check from native replay binding;
- the terminal read hashes the parsed durable step, binds authenticated context to canonical operation ownership, and joins the receipt's success event to verify the operation/step transition, guarded output digest, and recorded fencing token. This authenticates terminal completion fencing; the artifact write itself is guarded separately by the repository's live-lease transaction.

The native proof script `scripts/prove-verification-audit-inspection-transports.ts` typechecks with exit `0` under its isolated tsconfig. It writes an immutable startup journal before SQL/Storage mutation and covers claims/report across raw HTTP, TypeScript client, CLI, and MCP submission plus typed terminal reads, a simulated post-result `completeStep` interruption with replacement fencing, cancellation, wrong-digest pre-enqueue denial, canonical replay equality against the retained r5 facade receipt, and zero parser/provider dispatch. It has not yet been executed.

## Native execution journal

Attempt `65b770b6-8ae5-4f7b-837d-c9e68ffa1fff` stopped before any audit operation submission or result-artifact write because the proof harness passed a full assertions handle into the strict projection-grant catalog, which accepts only `{ artifactId, digest }`. The pre-mutation journal and immutable failure receipt are retained at `../internal/verification-audit-inspection-public-startup-65b770b6-8ae5-4f7b-837d-c9e68ffa1fff.json` and `../internal/verification-audit-inspection-public-failure-65b770b6-8ae5-4f7b-837d-c9e68ffa1fff.json`. Its isolated mission/work/attempt fixture rows remain retained. The harness now projects the exact reference shape before catalog construction; no product source was weakened.

Attempt `914354ee-3bfa-4224-a2c0-b4c796c7f615` completed eight worker-backed claims/report inspection operations plus the cancellation scenario, then its first terminal HTTP read returned 503. Read-only diagnosis over the retained operation narrowed this to PostgreSQL's canonical bigint representation: the success event stores `fencingToken` as a decimal string while the receipt body stores the same safe value as a number. The reader now requires an exact decimal string equal to the separately validated positive safe receipt integer. The retained operation reads successfully after the fix, and the focused persistence test passes 2/2. Its startup and failure receipts remain immutable under `../internal/verification-audit-inspection-public-{startup-,failure-}914354ee-3bfa-4224-a2c0-b4c796c7f615.json`.

## Native public proof success

Command `corepack pnpm exec tsx scripts/prove-verification-audit-inspection-transports.ts` completed with exit `0` for namespace `cccd810b-776d-4b39-a7dd-a4d6c0927f04`. The immutable receipt is `../internal/verification-audit-inspection-public-cccd810b-776d-4b39-a7dd-a4d6c0927f04.json`, SHA-256 `601f53f104f4908b743045cf6f25f6f3fcc2c3378c6902e8a60bc820ca3ca92e`; its startup journal is retained beside it.

The receipt records seven passing controls: exact claims/report grants before enqueue; worker-backed raw HTTP, TypeScript client, CLI, and MCP submission plus terminal reads for both run families; byte-exact equality with the earlier canonical signed facade results; replacement after an injected post-result/pre-`completeStep` interruption with a higher fencing token; cancellation with no receipt; wrong-digest denial with no operation; and no object keys in any public result. It created eight succeeded inspection operations and one cancelled operation, with zero parser and zero provider dispatch. Claims preserved the signed `review` outcome and payload digest `sha256:6ae4513675e3c0d0f90c93dca1d86c4da5358b7bdb79c47ad571fe17a74691c2`; reports preserved the signed `fail` outcome and payload digest `sha256:6276123c07645283cf76dbc35dcd5a06fdf86ccf3638ce96386894ef1e99d3d4`.

The proof remains explicitly bounded to claims/report audit bundles, local development PostgreSQL and Storage, and a simulated `completeStep` interruption rather than an operating-system process kill. It makes no public support claim for metric, extraction, or benchmark audit manifests.

## Independent full native audit

The coordinator's read-only SQL and Storage audit passed for all eight succeeded result objects and both source signatures, and confirmed zero cancellation receipts or produced artifacts, decimal-string event fencing against the numeric receipt token, receipt output hashes, and exact parent closure. Its immutable receipt is `../internal/verification-audit-inspection-full-audit-cccd810b-776d-4b39-a7dd-a4d6c0927f04.json`, SHA-256 `bfd69857cace22f15f7208e6acf15d9ab0290b26ecd6b8641c551bb3fa0076a7`. The thirteen frozen source hashes match `../internal/verification-EV111-source`. The coordinator accepted this bounded public claims/report audit-inspection slice as EV111; the previously stated family and process-crash limitations remain.
