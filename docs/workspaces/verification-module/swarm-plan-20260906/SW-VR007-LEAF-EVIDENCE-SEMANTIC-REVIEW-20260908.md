# SW-VR007 leaf-evidence semantic review — 2026-09-08

## Scope

Read-only review of `packages/verification/src/extraction/evidence.ts`, `packages/contracts/src/verification/extraction-field-evidence.ts`, their production call sites, and the original `verifyExtractionFields` contract. No provider calls, writes, production edits, or full-suite runs.

## Findings

### P0 — helper output cannot satisfy the contract by itself

`AcceptedExtractionLeaf` in `packages/verification/src/extraction/evidence.ts:11-26` has no `lineage` member. The contract schema requires `lineage` with source/native/transformation/projection artifacts and parser custody (`packages/contracts/src/verification/extraction-field-evidence.ts:13-18`). The application layer later grafts lineage from the admitted projection receipt (`packages/application/src/verification-admission.ts:327-342`), so the helper is not independently schema-conformant; callers that use it directly can produce a result that cannot parse as the persisted contract. Keep the layering if intentional, but expose a typed pre-contract result or require a custody callback/receipt input so this gap is explicit and cannot be bypassed.

### P1 — fragment custody is synthetic metadata, not a retained fragment

The helper creates `fragmentId` by hashing capture ID, representation ID/digest, selector, and selected-content digest (`evidence.ts:95-97`). It does not retain or bind a source fragment artifact, byte range, or fragment registry record. The selected content digest is checked by the legacy verifier, but the generated `fragment:<digest>` is only a derived identifier. This meets deterministic identity for the selected bytes, but does not by itself prove that a separately retrievable source fragment exists. The next contract should either name this explicitly as a selected-content fragment digest or bind `fragmentId` to a registered fragment artifact and verify its bytes.

### P1 — source-component fallback can bypass component semantics

`selectedScalar` first extracts `table_cell_value`, `geometry_token_text`, or `transcript_text`, but when extraction returns `undefined` it falls back to UTF-8 decoding `selected.selectedContent` (`evidence.ts:48-58`). Thus malformed/missing component metadata can still be accepted if the selected bytes decode to a scalar. The original verifier rejects invalid source components before scalar fallback (`packages/verification/src/extraction/verification.ts:267-275`). Preserve the legacy behavior by returning a hard selection failure when a declared component is present but malformed; only use byte decoding when no component is declared.

### P1 — derivation kind is lossy for typed comparisons

`evidence.ts:93-94` labels a leaf `direct` whenever candidate and selected scalar are canonically equal, except normalized text. That hides the deterministic operation for equal decimal, percentage, currency, date, datetime, enum, identifier, and checksum comparisons. The contract's `comparison` field retains some type information, but `derivation` no longer says whether parsing/validation was applied. Emit the typed operation consistently (or define `direct` as source transport only and add an explicit comparison operation) so replay/audit can distinguish a literal match from a parsed exact match.

### P2 — coverage and duplicate guarantees are inherited, not contract-level

The helper loops `rules.keys()` (`evidence.ts:83-99`) rather than independently enumerating the candidate's leaf paths. In normal use this is safe because it first calls the legacy verifier, which requires every candidate leaf to have one rule and one evidence edge and rejects duplicate field/evidence paths (`verification.ts:229-282`). The persisted Zod result schema only checks unique accepted paths and does not know the candidate, so it cannot enforce full candidate-leaf coverage on its own (`extraction-field-evidence.ts:21-29`). Keep the legacy precondition but add an explicit accepted-leaf count/path-set assertion in the evidence layer or carry a candidate leaf-path digest.

Duplicate input handling is similarly inherited: `new Map(...)` silently overwrites duplicate paths (`evidence.ts:83-86`), while the preceding legacy verifier rejects duplicates. A future caller that bypasses the legacy call would lose evidence deterministically; make duplicate detection explicit before map construction.

### P2 — optional and computed fields need explicit semantics

For optional schema properties absent from the candidate, no accepted leaf is emitted; a field rule for an absent path is rejected by the legacy `FIELD_RULE_NOT_LEAF` check. That is consistent with “accepted leaf” semantics, but the contract has no status distinguishing optional omission from an unverified/missing extraction. If VR007 audits optional fields, record omission policy separately. Computed totals are attached only when a total rule's `resultPath` matches the leaf path (`evidence.ts:86-97`); arithmetic correctness is delegated to the legacy verifier, so the persisted `computation` metadata is descriptive and should be replay-compared, not treated as its own proof.

## Production adoption and remaining legacy paths

The public `verifyExtraction` executor now calls `verifyExtractionWithEvidence`, persists the enriched result, and includes admitted projection lineage artifacts in result parents (`packages/application/src/verification-service.ts:450-470`). Replay recognizes enriched versus legacy results and recomputes accordingly (`verification-service.ts:473-503`). This closes the previously identified production adoption gap for that operation.

The separate structured extraction worker remains a candidate producer: it retains/publishes a candidate and returns `status: "unverified_candidate"` with candidate, provenance, precontext, execution, and provider-call references (`apps/worker/src/verification-structured-extraction-runtime.ts:96-101`; `packages/application/src/verification-structured-extraction-result.ts:91-107`). It does not call the leaf verifier or emit accepted leaves. This is correct if structured extraction is intentionally pre-verification, but VR007 must be scoped to the subsequent `verifyExtraction` operation; accepting structured extraction output itself would still leave the legacy check-only result path.

## Recommended next actions

1. Make declared source components fail closed in `selectedScalar` and add focused regressions for malformed table/geometry/transcript metadata.
2. Define whether `fragmentId` means selected-content digest or a retained fragment artifact; bind it accordingly in the contract and lineage.
3. Make derivation operation semantics explicit for typed comparisons and add a candidate leaf-path digest or direct path-set assertion.
4. Add explicit duplicate-path rejection before maps are constructed.
5. Keep structured extraction as `unverified_candidate` unless a separate verified extraction stage is formally added; use the enriched `verifyExtraction` result for VR007 evidence and human-gold review.
