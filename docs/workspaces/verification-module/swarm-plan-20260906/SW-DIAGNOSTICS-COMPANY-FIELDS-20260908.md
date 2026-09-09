# Diagnostics company fields — 2026-09-08

## Scope

Implemented a provider-neutral, diagnostics-only company field plan for the mandatory 15.9.2 field families. The plan enumerates 47 slots and marks unsupported slots `unavailable`; it does not create facts, gold labels, semantic admission, or quality/promotion claims.

## Native execution

`executeDiagnosticsCompanyFieldPlan` reads the sealed `diagnostics-companies-v1` dataset and registered source-preparation captures through `VerificationAdmissionService`. Each supported literal is selected with the original unique HTML selector plus a half-open UTF-16 `textRange`. `verifyExtractionWithEvidence` therefore verifies the exact leaf bytes and returns the canonical source, projection, transformation, parser, and capture lineage.

The bounded literal parser covers retained evidence for turnaround ranges/start events, sample type, methylation-site and biomarker lower bounds, SymphonyAge, OMICmAge, DunedinPACE, and Generation Lab biomarker/system counts. Its numeric normalization is separately identified as `bounded_literal_parser.v1`; the canonical extraction derivation remains separately retained. Units preserve the captured wording (`body_system`, `system`, or `organs_and_systems`). Product and source version remain null because the frozen evidence does not establish them; capture time is a separate field.

Only the two known scoped disagreements receive conflict sets: Tru turnaround wording (2–4 versus 3–4 weeks) and Generation Lab system-count wording (19 versus 21). Distinct algorithms and ordinary many-valued fields are not treated as conflicts.

## Verification

- `vitest run src/verification-diagnostics-company-fields.test.ts`: 3 passed.
- Tests execute both companies against the actual frozen selected bytes through the real admission service, assert deterministic plan replay, exact selector ranges and custody, numeric units/qualifiers, the known conflict boundaries, explicit unavailable slots, and a malformed capture rejection.
- `tsc --noEmit`: passed for `packages/application`.
- External/provider requests: 0.

## Limits

The executable map is intentionally bounded to unambiguous literals in the frozen v1 source cases. Remaining mandatory fields stay explicit unavailable until registered source evidence and a corresponding bounded field rule exist. This evidence is mechanical extraction coverage only; it does not establish real-world correctness or semantic acceptance.
