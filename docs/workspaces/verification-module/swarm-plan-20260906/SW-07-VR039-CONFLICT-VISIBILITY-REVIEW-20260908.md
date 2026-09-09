# VR-039 conflict visibility review — 2026-09-08

## Scope

VR-039 requires known cross-page count, product, and turnaround conflicts to stay visible rather than be silently normalized. This review reads the retained EV130 frozen output; it does not regenerate that output or resolve a factual conflict.

## Retained conflict set

The comparison report retains four separate, evidence-linked statements:

| Conflict | Case IDs | Capture/page context | Preserved scope |
| --- | --- | --- | --- |
| TruDiagnostic turnaround | `tru-turnaround-about-source`, `tru-turnaround-product-source` | `tru-about` and `tru-product`, with distinct captures | “2–4 weeks from the date the lab receives the sample” and “3–4 weeks after our lab receives your sample” |
| Generation Lab system count | `gl-historical-wording-source`, `gl-same-page-footer-source` | article body and footer from the retained `gl-immune-age-19` capture | “19 critical systems” and “21 organs and systems” |

The two turnaround statements also remain in the TruDiagnostic report; the two count statements also remain in the Generation Lab report. The comparison coverage JSON binds every rendered statement to the matching field-ledger selected text, capture, and local evidence-appendix anchor.

## Validation

The new renderer regression in `packages/application/src/verification-benchmark.test.ts` checks all four case IDs, both original scopes, and their placement in the comparison and company reports. Focused application validation passed: 1 file, 12 tests.

Machine audit `internal/verification-vr039-conflict-visibility-audit-33202040-9104-4368-b38d-4198518ac4ea.json` passed. It checks the retained JSON/Markdown reports against the field ledger and source ledger, including selected text, capture IDs, source keys, and appendix links.

## Conclusion

Recommend VR-039 proved for the stated generated-report conflict-visibility row. This proof does not choose a correct count or turnaround, infer a product/version transition, establish human-gold authority, or admit either statement as policy truth.
