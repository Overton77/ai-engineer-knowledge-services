# Diagnostics source capture handoff

Coordinator, 2026-09-05. These are actual acquisition observations; they are not human gold labels or clinical findings.

## Capture inventory

**Additional approved conflict source:** `gl-immune-age-19.json` / `.md` / `.receipt.json`, captured at `2026-09-05T02:45:09Z` from [Generation Lab's immune-age article](https://www.generationlab.com/blog/immune-age-test), HTTP 200. The page displays October 15, 2025 and author Alina Su. Article text explicitly states 19 systems and enumerates them, while the same captured page's footer states 21 organs/systems. This is authentic captured count inconsistency, not a synthetic mutation. A displayed publication date does not prove when the product itself changed. Raw SHA-256 `1611a7417ec6fa51cecf595d2f94766175e7579d598103e800b79ff97a9c2c0c`; Markdown SHA-256 `a6fb865c8dcc1f5054588d0bca082d6010dc831eb60ed946f7b31b6da25f30ad`. Coordinator approves this bounded source addition for spec 15.9.3. Original 13-source manifest and 14-projection index remain unchanged; merge this separately receipted addition into the proposed frozen registry. Corporate rights remain reserved/internal restricted.

`../../../../internal/verification-source-captures/20260905/` contains the 13 specified seed captures, raw provider JSON including HTML, Markdown projections, per-source receipts, `manifest.json`, and `projection-index.json`. Every seed response reports HTTP 200. Source-specific SHA-256 digests and UTF-16 license-text offsets are in the index. Capture command: `node --env-file=ai-engineer-knowledge-services/.env internal/verification-capture-sources.mjs` from the parent workspace, exit 0. It invokes Firecrawl CLI 1.23.1 with maxAge=0, three concurrent captures, no browser actions or gate bypass. Credential values are neither in receipts nor stdout.

An additional specified publication-link target, `https://link.springer.com/article/10.1007/s11357-024-01460-1`, was followed from `gl-research` and captured as `paper-rectification.json`. Its referring link is present in the immutable `gl-research` Markdown and links array. Coordinator approves this source within specification section 15.9.1.

## Observed benchmark facts to annotate

- `tru-about`: turnaround is “2–4 weeks” after lab receipt.
- `tru-product`: turnaround is “3–4 weeks” after lab receipt. Preserve page/product context and a visible conflict set.
- `gl-science`: 460 biomarkers and 21 systems; its triplicate section says one user sample, with replicate-pair percentages 99.40%, 99.53%, 99.47%. These do not establish population clinical accuracy.
- The science Markdown contains 920 `cg[0-9]{8}` occurrences but exactly 460 unique CpG identifiers (the rendered page repeats the list). Include a duplicate-layout test so raw occurrence counts do not become inflated biomarker counts.
- `gl-faq`: current capture says 21 distinct systems. The additional `gl-immune-age-19` capture supplies authentic 19 wording in article content and 21 in its footer. Preserve article/footer and publication/retrieval contexts; do not assert a dated product transition without further evidence.
- `gl-terms`: report is informational/pre-clinical, not diagnosis/treatment, and calls for qualified healthcare-provider consultation. Preserve these qualifications in reports.
- `tru-education`: explicitly says the test is not a diagnosis and must be interpreted in context.
- `gl-comparison`: interested-party source; cannot establish independent head-to-head superiority.

## Rights/access handling

- `paper-pace` includes CC0/public-domain dedication; preserve attribution and affiliation/conflict metadata despite the permissive license.
- `paper-noise` includes CC BY 3.0; retain authors, article attribution, URL, license, and adaptation notice.
- `paper-rectification` includes CC BY 4.0; retain author attribution, URL/license, change notice, and conflict-of-interest scope.
- `paper-omic` includes CC BY-NC-ND 4.0. Course/commercial redistribution and adapted full text are not automatically licensed. Keep the complete capture restricted; use source metadata and limited attributed quotations for the report, pending rights review.
- Corporate pages are not openly licensed by mere public availability. `gl-terms` explicitly reserves content rights. Full provider captures stay under internal restricted storage, outside the redistributable package. Use short evidence excerpts and digest/locator/restricted-handle lineage; do not label a generic internal-use decision as a copyright license.
- TruDiagnostic's overview Markdown includes a public `ExampleAdvancedTruAge.pdf` sample-report link. This may be acquired anonymously with the referring-page selector recorded. Generation Lab sample-report links point to a form anchor; no form was submitted and no gate was bypassed.
- Public TruDiagnostic PDF acquisition completed via `node internal/verification-capture-public-pdf.mjs`: HTTP 200, 4,019,343 bytes, SHA-256 `b5d7f9798de00dd73dd6f287f95876f0dce09cb085c701e630d99f14bd4f4ea1`. Receipt includes the parent Markdown digest and exact UTF-16 referring-link offsets. PDF magic bytes checked; parsing/sandbox proof remains WS-04 work. Full sample-report bytes remain restricted.
- Rights evidence and source approval are separate from gold-label review. Human/qualified review gates remain distinct.

## Required next steps

Build the frozen benchmark format from these real inputs, retaining immutable digest bindings and source-specific rights decisions. Bind every admitted leaf to selectors in the frozen evidence projection, and bind projections to the full restricted capture digest. Generate a source manifest with approval/restriction state rather than silently shipping full raw corporate content.
