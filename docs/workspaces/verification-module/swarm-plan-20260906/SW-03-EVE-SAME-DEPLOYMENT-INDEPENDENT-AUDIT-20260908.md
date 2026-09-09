# SW-03 Eve same-deployment independent audit — 2026-09-08

## Result

The clean native `same_deployment` run is valid bounded rejection evidence. The Eve build and strict eval both exited 0 because the authored tool lifecycle completed and faithfully returned a terminal failure. The public compact tool receipt is `failed` with `INVALID_STATE_TRANSITION`; the retained native non-admission terminal records the underlying worker failure `PRODUCER_VERIFIER_INDEPENDENT`.

The independent auditor `internal/audit-verification-eve-same-deployment.mjs` passed and wrote `internal/verification-eve-same-deployment-independent-audit-2b588a74-ccc7-444c-bc26-dddc7fa41b2e.json`. It verified the domain-separated Ed25519 Eve attestation and exact operation, request, tenant and runtime lineage; actual Eve mock-runtime lineage; producer deployment identity equal to the attested verifier deployment identity; exactly one failed activity lease attempt; zero verification runs; zero canonical provider custody rows; zero rejected external fetches measured by the retained trap counter; the bounded authored catalog; all five post-run source hashes; and cleanup.

No CAS/manifest replay is expected because the worker rejects before sealing. Four producer fixture artifacts remain registered in shared local CAS; none is a verifier result or signed run.

## Error and retry semantics

The native worker source checks `deploymentSeparation.status` immediately after deterministic verification and before either sealer or result registration. Its focused claims/report test asserts `PRODUCER_VERIFIER_INDEPENDENT`, `retryable: false`, and zero calls to both sinks. The public compact failure projection does not expose retryability, so this audit establishes non-retryability from the retained source/test snapshot and supplied passing worker-test log, not from the terminal DTO.

## VR-003 assessment

**Keep VR-003 partial in this bounded review.** EV-136 supplies a native established-separation positive control, EV-135 supplies independently reviewed persistence/concurrency ownership guards, and this run supplies the missing native same-deployment rejection before sealing. That is strong cross-layer evidence.

The exact row also requires complete contract, engine and DB-constraint evidence. This audit did not reopen the earlier contract/SQL receipts or independently re-run those gates, and the five-file snapshot is explicitly post-run rather than a complete executed-source closure. The coordinator can promote VR-003 after one focused reconciliation confirms the current contract invariant, engine derivation, canonical SQL constraint, EV-135 DB negative and this native worker negative all refer to the same producer/verifier identity semantics. No new provider or native proof is needed for that reconciliation.

## Scope

This is local mockModel Eve evidence with no Mission Control/Temporal, parser, provider, human action or remote deployment. It does not promote VR-024 or establish live Eve inference, recovery or cancellation.
