# VR-005 / VR-009 scoped operation closure review

This review evaluates the two matrix rows at their stated boundaries. It does not treat the broader selector-modality row VR-006 or human-gold row VR-007 as a dependency.

Machine receipt: [verification-vr005-vr009-supported-operation-audit-1b58a16a-50c4-4f58-ac81-2ecb1b639f0a.json](../../../../../../../internal/verification-vr005-vr009-supported-operation-audit-1b58a16a-50c4-4f58-ac81-2ecb1b639f0a.json), SHA-256 `6e32771f3d861325898cf40f0ba9e217a88b80252779918409d4ba45e4d253e4`.

## VR-005 — machine selectors separate from display excerpts

`SourceFragmentSchema` requires `selector`; `displayExcerpt` is optional presentation text. The engine consumes the selector and selected-content binding, while no replay path accepts a display excerpt as a locator.

The focused adversarial contract regression accepts an ellipsized `displayExcerpt` only when the exact machine selector is present, and rejects an excerpt-only fragment. Runtime regressions separately reject repeated-text ambiguity, declared-offset drift, invalid/reversed/overlapping multi-fragment ellipsis, and HTML fallback disagreement. The retained native replay read 22 existing CAS objects and re-admitted 14 projection artifacts without a provider or write.

**Recommendation:** record VR-005 as proved for its exact matrix statement. The remaining breadth of selector modalities belongs to VR-006 and does not block this row.

## VR-009 — declared deterministic operations

The owner-defined scope is exactly 11 comparisons, 6 calculations, and 3 period semantics. Each has one named runtime positive fixture and a validator-specific boundary-rejection fixture. Scalar negative controls use matching invalid source and candidate values, so they cannot pass merely through unequal evidence. Calculation negatives regenerate the representation bytes, digest, and evidence from the changed result, then require `CROSS_FIELD_TOTAL_REPLAY` to fail:

| Family | Coverage |
| --- | --- |
| Field comparisons | 11/11 positive and 11/11 boundary: exact, normalized text, decimal, percentage, currency, unit, date, datetime, enum, identifier, checksum |
| Exact-decimal calculations | 6/6 positive and 6/6 boundary: identity, sum, difference, product, ratio, percent change |
| Metric periods | 3/3 positive and 3/3 boundary: point, interval, cumulative |

The receipt records each named fixture. New direct regressions cover every remaining scalar rejection, all six calculation operations with changed-result rejection, point timezone presence, and cumulative end-facet binding. Existing controls retain source-bound metric facet, fabricated/missing/failed/cyclic operand, and ratio/percent-change rounding coverage.

Focused tests passed: contracts 12/12 and verification 40/40.

**Recommendation:** record VR-009 as proved for this declared deterministic inventory. This does not extrapolate to undeclared inputs, every selector modality, or human-gold evidence.

## Limits

No provider, capture, database-write, or storage-write action occurred. The matrix coordinator owns status updates.