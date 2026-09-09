# SW-VR007 leaf contract audit — 2026-09-08

## Scope and result

This is a bounded read-only audit of the production `verifyExtraction` request → admission → worker → persisted-result path against specification §10.2 and acceptance row VR-007. VR-007 remains **partial**. The deterministic verifier enforces the mechanics needed to reject an unbound or incorrect leaf, but the accepted result does not return or persist one evidence record per accepted leaf containing the accepted value, raw value, derivation, source fragment, capture, and complete lineage. A human-gold field audit is therefore still required for acceptance.

## Contract and production trace

- The specification says every candidate leaf should return or be augmented with `path`, `value`, `rawValue`, `derivation`, an evidence fragment, and diagnostic provider confidence (`docs/specifications/verification-module.md:441-456`). VR-007 requires every accepted extracted leaf to have value, derivation, source fragment, and lineage (`docs/workspaces/verification-module/ACCEPTANCE-MATRIX.md:15`).
- The HTTP boundary accepts `POST /v1/verification/extractions::verify`, parses `VerifyExtractionRequestSchema`, and submits a queued operation (`apps/api/src/server.ts:725`). The shared application boundary validates the request, enforces one capture, and submits `verification_extraction` with the request envelope (`packages/application/src/verification-service.ts:247-252`, `301-313`).
- The worker registry admits `verification_extraction:verify_and_register`; its handler delegates to the trusted executor (`apps/worker/src/verification-activities.ts:59-70`).
- The executor hydrates the registered profile and candidate artifacts, binds all profile evidence to the single requested capture, hydrates the profile's source artifact, admits the schema, and calls admission verification (`packages/application/src/verification-service.ts:449-469`). It then registers a ledger result artifact whose `output` contains `{ request, result }`, with only profile/candidate/source registration handles as bound parents (`packages/application/src/verification-service.ts:516-524`).
- Admission limits evidence and projection count, hydrates each admitted projection through the capture/transformation/projection relation, and passes authenticated projection bytes plus normalized evidence edges into the pure verifier (`packages/application/src/verification-admission.ts:320-330`). This supplies capture ID, projection artifact ID/digest, selector, and optional selected-content digest to verification, but does not build a leaf evidence record.
- The pure verifier validates candidate shape, requires one rule and one evidence edge for every candidate leaf, verifies representation digest and capture binding, uniquely re-resolves the selector, derives a scalar selected value, compares it with the candidate leaf, and emits a check (`packages/verification/src/extraction/verification.ts:192-206`, `229-282`). Its public result type is only `{ valid, candidateValid, checks }` (`packages/verification/src/extraction/verification.ts:36-37`). No accepted leaf value, raw selected value, derivation, fragment ID, capture receipt, selector resolution, or parent lineage is included in that result.
- Replay recomputes the same check-only result and rejects drift by canonical comparison (`packages/application/src/verification-service.ts:472-484`). This protects deterministic mechanics but cannot reconstruct a persisted accepted-leaf ledger because the original result has no such projection.

## What exists elsewhere

`verifyDiagnosticsExtractionOutput` creates a richer benchmark-only `fieldResults` shape with `evidenceBinding` containing capture ID, fragment artifact, selector, selected-content digest, quote and quote offset (`packages/application/src/verification-benchmark.ts:263-288`). Its field ledger is separately described as recomputable from provider output and a granted fragment (`packages/application/src/verification-benchmark.ts:291-296`). That path is diagnostics/benchmark evidence, not the public `verifyExtraction` result; the offline runner labels the experiment `engineering_expectations_only` and marks claim-ledger entries `humanGoldScoringEligible: false` (`packages/application/src/verification-benchmark.ts:449-465`). It cannot establish VR007 production closure or human-gold correctness.

## Exact gaps

1. **Accepted leaf value/raw value:** checks compare the candidate to a selected scalar, but the result drops both values. `rawValue` is not a production field, and normalized comparisons do not preserve the source spelling.
2. **Derivation:** the system knows the comparison/normalization rule and can infer a mechanical relation, but no accepted-leaf `derivation` field is emitted or persisted.
3. **Source fragment/capture:** input evidence has capture/projection/transformation IDs and selectors, but the result has no leaf-level fragment reference or resolved selected-content record. The result's bound artifacts are only profile, candidate, and source registrations (`verification-service.ts:463-469`, `516-524`).
4. **Lineage:** artifact-level result parents are present, but accepted-leaf lineage from leaf → selector → projection/transformation → capture/source is absent from the result contract. A result-level parent list cannot satisfy “every accepted leaf” lineage.
5. **Human gold:** provider confidence is intentionally diagnostic until calibrated against held-out human labels (`verification-module.md:456`), and the existing benchmark explicitly excludes human-gold eligibility. No production accepted-leaf audit or held-out labels were found in this path.

## Next implementation plan

1. Add a versioned accepted-leaf evidence contract shared by verification and contracts. Each record should include path, candidate value, raw selected value, derivation/comparison metadata, capture ID, fragment/projection and transformation references, selector and selected-content digest, and an ordered artifact lineage rooted at the registered source. Keep provider confidence optional and diagnostic.
2. Have `verifyExtractionFields` construct records only after candidate validation, immutable representation verification, unique selector resolution, scalar extraction, and successful comparison. Return them alongside checks; reject any record whose required lineage or digest binding is absent.
3. Have admission map each record to the authenticated `ProjectionAdmissionReceipt` so source/capture/transformation handles are server-derived rather than caller-authoritative. Persist the records in the `verifyExtraction` result artifact and include their artifact IDs in the result transformation signature/parents.
4. Extend replay to recompute and canonical-compare the accepted-leaf evidence records, including raw selected bytes/digests and lineage, then add contract tests covering scalar, normalized, array, and rejected/ambiguous selector cases.
5. Run a separate human-gold audit over the admitted modality/field inventory. Record held-out labels and calibration evidence for any confidence use; do not promote VR007 from the deterministic mechanics proof alone.

No provider calls, database writes, code edits, or tests were performed for this audit.
