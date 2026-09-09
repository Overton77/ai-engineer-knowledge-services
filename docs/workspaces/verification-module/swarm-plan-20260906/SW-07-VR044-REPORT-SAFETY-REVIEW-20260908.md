# VR-044 report safety review

VR-044 requires that reports contain no patient-specific advice and preserve medical and informational-use qualifications. Section 15.9.4 of the verification-module specification requires no patient-specific medical advice in generated reports; the frozen benchmark requirements also retain diagnostic/non-diagnostic, informational-use, and clinician-correlation limitations.

## Retained output evidence

The superseding independent receipt [verification-vr044-report-safety-audit-99025576-3126-4aa6-8c5b-ec1b8667dc17.json](../../../../../../../internal/verification-vr044-report-safety-audit-99025576-3126-4aa6-8c5b-ec1b8667dc17.json), SHA-256 `2f52e5911fde13dc9329e340261d7b74b5c53518b265601faab9a3acacdc143b`, checks the exact EV130 retained output bytes for all three mini reports in Markdown, HTML, and coverage JSON. The earlier `9d50…` receipt is retained as pre-correction preparation.

Each report contains the fixed informational/non-recommendation qualification. The Generation Lab report also retains the three selected source qualifications: no medical practice/advice, clinician consultation before acting on pre-clinical recommendations, and informational-only/warranty limits. All report bytes matched the EV130 coverage receipt. The audit found neither rendered adversarial assertions nor a patient-directed treatment imperative in these exact outputs.

## Enforced future-output boundary

The review found that the report block builder previously had fixed notices but did not reject unsafe block selection. `verification-diagnostics-report-coverage.ts` now enforces the public-report policy:

- `informational_only` is required for the three public reports;
- rendered assertions must be literal source statements, never adversarial cases; and
- a bounded patient-directed treatment-imperative guard rejects direct instructions in the **resolved text that is rendered** for a literal source block.

Focused report-coverage tests pass 6/6, including missing qualification, an adversarial medical mutation, and a harmless assertion whose matching-digest resolved text is a patient-directed imperative. Application typecheck passes.

The application was rebuilt using the installed local `tsup.cmd` and `tsc.cmd`. The parity receipt [verification-vr044-frozen-report-parity-6ed0b4a1-0b14-44bd-916f-75a99b549f52.json](../../../../../../../internal/verification-vr044-frozen-report-parity-6ed0b4a1-0b14-44bd-916f-75a99b549f52.json), SHA-256 `ff5b0a05093873e59b36f753ca36d507b93eae793bfc679cf4d897d6a13df7b9`, rebuilds the three reports from the current frozen v1 catalog plus retained field-ledger resolutions. All 29 assertion blocks, rendered Markdown values, and report digests exactly match EV130. It did not regenerate, overwrite, or replace any EV130 output file.

The direct-imperative guard is intentionally not presented as a semantic safety classifier. A literal source statement such as “For patient Jane Doe, discontinue insulin immediately” is outside its grammar and therefore is not a universal medical-safety guarantee. The exact frozen-report conclusion instead rests on the manual inspection of all 29 rendered factual statements, their catalog/EV130 integrity binding, literal-only structure, and required qualifications. It makes no clinical, semantic-quality, human-label, or provider claim.

## Recommendation

Recommend VR-044 as **proved for the stated report-output safety row**. This does not establish clinical correctness, broader product safety outside these reports, or human review authority.
