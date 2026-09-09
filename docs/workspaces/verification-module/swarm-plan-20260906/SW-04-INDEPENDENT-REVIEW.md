# SW-04 independent review — human annotation package

Reviewed 2026-09-06. This review is read-only; no provider, database, or source-package mutation was performed.

## Scope and source identity

| File | SHA-256 |
| --- | --- |
| `packages/evaluation/src/verification-human-review.ts` | `6cd3c295ca60cdf3bb16f515afdd90a4b519c0460259387e6020867e85aeef88` |
| `packages/evaluation/src/verification-human-review.test.ts` | `3af8ff88106c3926e1d921c2f0cb940b281266c39c6cfaaa4d9975741552effc` |
| `scripts/export-diagnostics-human-review-pack.ts` | `9918c71a402a0407422aca9cd2e972fd9eedff593a104fac228222e05fcf8967` |
| generated `...human-review-v1/pack.json` | `2396ff3bd9cece939599e1aa2d20604531f6209e5d90757d0470a15f267772ae` |

Generated artifact hashes match SW-04's ledger: `review.html` is `d4b7b98c98e7e8b8165a73159645a9bbbd7cc9c87f230e34a41fc2f6e8b05b29`; `submission.template.json` is `0e3341d0c1ffe8c62071a24bb70bd65064d7ba78c3f25cbc4a73714ab598768e`.

## What passed

- Focused evaluation tests passed: `corepack pnpm --filter @aiengineer/knowledge-evaluation test` (52 tests) and `typecheck` (exit 0).
- The generated 180-pack joins to the frozen candidate pool and fragment registry correctly for the checked artifact: all 180 cases matched candidate ID, fragment ID, capture, projection artifact/digest, source key/class, selector, and selected-content digest. There were no duplicate case IDs and no pre-filled labels.
- The current importer rejects missing annotator identity, unknown and duplicate case IDs, invalid labels, and changed excerpt digests. Its only reported outcome is `human_single_annotator` with `annotatorCount: 1`; it does not label the output gold or adjudicated.
- HTML is self-contained, has 180 rows/selects/textareas, and contains no script element. The renderer escapes ampersand, angle brackets, and double quotes, which covers its text and double-quoted attribute interpolation.
- Re-running the existing generator is guarded by `wx` and fails after artifacts exist. The review does not treat that as a complete atomicity proof (see finding 4).

## Findings

### [P1] Import trusts a mutable pack object without recomputing its digest

`importHumanAnnotations` compares `submission.packDigest` with the mutable `pack.packDigest`, then takes `target.excerptDigest` from the same mutable object. `exportHumanReviewPack` applies `Object.freeze` only to the outer object: `cases`, individual cases, and nested selector objects remain writable. A caller that has altered a loaded/in-memory case's excerpt and excerpt digest can retain the original `packDigest` and submit a matching altered digest; the importer accepts it. This defeats the stated tamper check at the ingestion boundary.

Recompute the canonical digest from every pack field except `packDigest` at import, reject a mismatch before reading cases, and deep-freeze or construct immutable copies. Add a regression that mutates a case/excerpt digest after export and expects rejection.

### [P1] Export binding does not enforce candidate-to-fragment identity or every custody field

The lookup key in `exportHumanReviewPack` is only `captureId:projectionArtifactId:selectedContentDigest`. It does not require `fragment.candidateId === candidate.fragmentId`, `fragment.projectionDigest === candidate.projectionDigest`, exact source key/class, or selector equality. The checked generated data happens to match all 180 rows, but a duplicate fragment with the same three-key tuple can be selected while the pack reports the candidate's other identity fields. This can bind the displayed excerpt to a different fragment than its `fragmentId`.

Match on the candidate's frozen fragment ID (the registry's `candidateId` in this input), then assert projection digest, source identity, and canonical selector equality before exporting. Add a collision fixture that has identical capture/projection/selected-content keys and differing fragment IDs/excerpts.

### [P1] The rendered review page cannot export a valid submission

`renderHumanReviewHtml` renders 180 select and rationale controls, but the result has no `<form>`, submit/export control, or client-side/download serialization. Inspection reported `form_count=0`, `submit_count=0`, and `script_count=0`. A reviewer can enter text, but cannot produce the required `submission.template.json`-shaped artifact from the page. The generated HTML therefore does not meet the promised rendered reviewable artifact workflow.

Add an explicit offline export path that serializes only the pack digest, human identity/qualification, submission timestamp, and labelled rows (including the exact excerpt digest) to JSON; preserve the no-network/no-provider property. Add a browser test that completes one row and validates the exported JSON through `importHumanAnnotations`.

### [P2] Nine generated excerpts exceed the stated 1,200-character maximum

The exporter advertises a 1,200-character bound, but the truncation branch concatenates 590 characters, a marker, and 590 characters. The marker itself pushes the final length to 1,235. The generated pack has 9 excerpts over 1,200 (maximum 1,235). Either reduce the retained prefixes/suffixes to account for marker length or document and test the actual maximum.

### [P2] Generator can leave a permanently partial immutable directory

The generator creates the final directory, then writes `pack.json`, `review.html`, and template sequentially with `wx`. A failure after the first write leaves a partial directory that cannot be rerun because the completed file already exists. Generate in a unique staging directory, verify all digests, then atomically move/rename into an absent final directory; or preflight every final target before writing any file.

### [P2] Submission time is unchecked and not tied to an admitted review event

The importer includes `submittedAt` in its digest but does not require or parse it. This is not a label-integrity bypass by itself, and the provenance remains honestly single-annotator, but a later audit cannot rely on its timestamp. Require an ISO timestamp or assign one at the trusted import boundary when that boundary exists.

## Conclusion

The concrete generated artifact currently has correct 180-row source identity joins and honest single-human wording, but the import tamper boundary, general fragment binding, and usable HTML export need repair before treating the package as a safe human-label intake path. No acceptance row is recommended from this review.

## Addendum — v2 browser export verification (2026-09-06)

The author produced immutable `diagnostics-companies-benchmark-v1-human-review-v2`, addressing the review findings with exact fragment-ID/custody checks, import-time pack digest recomputation, submission timestamp parsing, a 2,000-character limit consistent with D-013, staging-directory generation, and a browser download surface.

I independently drove the generated `review.html` in installed Chrome with Playwright. The test read the immutable generated HTML and `pack.json`, set that exact HTML as browser content, confirmed all 180 selects were initially blank, filled annotator identity and qualification, selected `abstain` and a rationale for the first case, clicked **Download submission JSON**, parsed the actual browser download, and verified:

- it contains the v2 pack's exact `packDigest`;
- it states `human_single_annotator` and preserves the entered human identity/qualification;
- it includes exactly the selected row, with its source pack `caseId`, unchanged `excerptDigest`, selected label, and rationale.

No downloaded submission was imported, persisted, or used as a label. This was a synthetic UI proof only.

Receipt: `corepack pnpm --filter @aiengineer/mission-dashboard e2e` exited 0 on 2026-09-06; `e2e/human-review-v2.spec.ts` passed alongside the dashboard landing test (2/2). The same run followed dashboard `typecheck` (0), Vitest (11 tests, 0), and import-boundary lint (0). The browser proof uses `page.setContent` rather than a networked service, so no KS HTTP endpoint, provider, or database was touched.

## Addendum — v3 atomization and serializer review (2026-09-06)

Reviewed the v3 source and immutable generated artifact without editing human-review code. Source hashes: `verification-human-review.ts` `807AE71DFC001774D495BFB1A04E86620DAB66D79EB615F6AAFDF29BF9999631`; focused tests `CD12750C5D9CF2D7124E88B9C555C71D152457C11492796D60A86C565AD4B864`; generator `5157C8DE34096ED1005180F87AC363C59E8D93D1F145534FF5AFC53FEC1D1D3E`. The generated v3 `pack.json` is `A19B5B1873EFD3D50310108594A09820A1DEEB6D3F1E43A421B69FE01E9744F1`, its `review.html` is `CBA19B219131A020866330B216AFC541D63A1383742F6064310DE08863C87E5D`, and the pack digest is `sha256:644f50649e82eb8918cdaa781e475be8a1525eb91562e4ba64f6cff43e2da32c`.

The checked pack has 180 cases, all with an empty atomization proposition, zero qualifiers, and `labels: null`. The importer recomputes the pack digest, requires canonical ISO milliseconds for `submittedAt`, binds every submitted case to its exact excerpt digest, rejects unknown/duplicate cases, requires a nonempty bounded proposition and nonempty bounded qualifier strings, and preserves the honest `human_single_annotator` provenance. A changed proposition changes the submission digest; it does not silently turn a source candidate into a gold assertion.

The generator's candidate-to-fragment binding now keys the fragment registry by the candidate's immutable fragment ID and checks selected-content digest, capture, projection ID/digest, source key/class, and canonical selector equality. It also rejects duplicate fragment registry keys and duplicate candidate fragment IDs.

The offline renderer escapes text/attribute content and serializes the browser seed with `<`, `>`, `&`, U+2028, and U+2029 escaped before placing it in the inline script. Its export code reads only reviewer-controlled form values plus prebound case ID/excerpt digest, splits qualifiers on newlines, and creates a local JSON Blob. Static review found no network call, label import, or persistence path. The existing Chrome receipt supplied by the coordinator, `e2e/human-review-v3.spec.ts`, exercised this download with a synthetic proposition and two newline-separated qualifiers, preserving the exact `packDigest`, case ID, and excerpt digest. The provided evaluation receipt reports 55 focused tests passed; no second shared-suite run was started during concurrent integration work.

No additional defect was found in this bounded v3 review. This remains a reviewable human-label export package, not evidence that a human label was imported, adjudicated, or converted to benchmark gold.
