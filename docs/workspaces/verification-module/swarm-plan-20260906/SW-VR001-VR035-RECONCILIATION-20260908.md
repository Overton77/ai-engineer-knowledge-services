# VR-001 / VR-035 reconciliation — 2026-09-08

## VR-001 — single owner of generic verification algorithms

**Status remains partial for a concrete current reason.** EV-150 proves the Knowledge Services facade delegates production entrypoints to the KS `packages/verification` implementation, and its nine-test differential/typecheck evidence is current. EV-152 independently proves canonical database ownership and generated type pins across the active consumers. Neither proof removes the separate legacy generic implementation or cuts its remaining experiment consumers over.

The current repository still contains executable `research_ingestion_systems_agent/packages/verification-core/src/index.ts`, and both `experiments/source-attribution-lab/package.json` and `experiments/mission-intake-lab/package.json` pin `@aiengineer/verification-core`. The source package is not merely a retained test fixture. Therefore the actual unmet clause is whole-workspace generic-algorithm ownership: remove or explicitly quarantine those non-test consumers and legacy package implementation behind the retained immutable rollback/test fixture, then re-run the consumer inventory/cutover audit. No Cloud, remote packaging, or deployment gate is needed to establish this exact row.

## VR-035 — optional high-assurance signatures/attestations

**Status remains partial for a concrete format-support reason.** Current `packages/verification/src/provenance/seal.ts` supports canonical Ed25519 audit-bundle seals, verifies payload/manifest/lineage and rejects tampering; the retained EV136 replay and current VR-035 audit prove that path. The current audit explicitly records no retained or implemented in-toto attestation and no SLSA provenance attestation. Since the specification names optional artifact signatures/in-toto/SLSA attestations as high-assurance support, the missing evidence is support/verification for the in-toto/SLSA formats (or an explicit contract decision narrowing the requirement), not another generic signature replay or Cloud gate.

## Evidence binding

EV-150 receipt SHA-256: `7c512998695a942f05a62036f2d8897c868be88344328ad06debcf33127a14b0`.
EV-152 receipt SHA-256: `e02b9ec9dcf1cfca0e0538b0278752505d8c5bf88283da807058b1fb3398db3f`.
VR-035 audit receipt SHA-256: `f67f64f9d38654e1f7d989f48d10f9a26ce9ec579a3e6a6215391b9164f7a5dd`.
Current KS facade `packages/verification/src/index.ts` SHA-256: `ef7909760ef44797881a57289cc9eac7ed9a5d3b75317023b4bdaa9ff626da25`.
Current legacy core source SHA-256: `3daeda7d373cf56c847b02c452ddd5f3517e52a5473890913386c44b47fdc7b4`.
Current seal source SHA-256: `d4a1d18d1146934592a7f29b2b9229d517ec8b7dede170a52680b74699257beb`.

## Correction: VR-001 source review (2026-09-08)

The earlier VR-001 gap statement is withdrawn. The current `research_ingestion_systems_agent/packages/verification-core/src/index.ts` is explicitly a historical experiment compatibility facade: it imports `prototypeSha256`, locator resolvers, and `verifyPrototypeBundle` from `@aiengineer/knowledge-verification`, and its `verifyBundle` only validates legacy schemas around the KS-owned mechanics. The experiment package pins are therefore compatibility consumers, not duplicate generic algorithm implementations. EV-150's production delegation/cutover proof and EV-152's active consumer/database ownership proof bind this source state. On this source review, VR-001's exact single-owner requirement is **proved**; the matrix's partial status is stale relative to EV-150/152 and this corrected audit.

## VR-035 bounded contract finding

The existing seal path truthfully supports optional canonical Ed25519 artifact signatures: `sealAuditBundle` accepts an optional signer and `inspectAuditBundle` verifies a supplied Ed25519 seal or reports unsigned. It does not expose a standard in-toto/SLSA attestation contract. If the acceptance clause requires one of those standard formats, the smallest missing core/public path is an optional attestation envelope bound to the canonical manifest/payload digest (statement digest, predicate type, builder/material references, and attestation artifact handle), validated during seal/inspection and surfaced by the typed audit-inspection proof. No such adapter is implemented or evidenced here; VR-035 remains partial until the requirement is explicitly narrowed to Ed25519 or that bounded standard-attestation path is added and tested.
