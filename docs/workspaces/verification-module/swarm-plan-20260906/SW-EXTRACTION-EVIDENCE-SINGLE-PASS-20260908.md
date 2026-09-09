# Extraction evidence single-pass capture — 2026-09-08

The extraction verifier now captures accepted scalar candidate values, raw selected values, evidence bindings, and selected-content digests during its existing deterministic selector resolution pass. `verifyExtractionFieldsWithEvidence` consumes that capture only after the complete legacy result is valid, so it does not perform a second selector resolution or spend a second scan budget. The legacy `verifyExtractionFields` result remains its existing three-field shape.

Evidence emission remains all-or-none after candidate, field, duplicate, and total checks. Duplicate `resultPath` entries in cross-field totals now fail closed for the evidence contract rather than silently selecting one computation. Tests cover a counting structured-table resolver with one resolution, scalar component custody, duplicate totals, and the existing malformed/tampered paths.

Focused extraction and contract evidence tests passed (22), as did `packages/verification` typecheck. Immutable central receipt: `C:/Users/Pinda/Proyectos/aiengineer/internal/verification-extraction-evidence-single-pass-20260908.json`.
