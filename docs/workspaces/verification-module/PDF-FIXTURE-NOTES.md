# Real PDF selector fixture

Coordinator preparation, 2026-09-05; read-only inspection of a public sample report. Not clinical advice or evidence of any real person's health.

## Source and projection

- Source: `../../../../internal/verification-source-captures/20260905/tru-sample-report.pdf`, 24 pages, 4,019,343 bytes, SHA-256 `b5d7f9798de00dd73dd6f287f95876f0dce09cb085c701e630d99f14bd4f4ea1`.
- Metadata: titled Advanced TruAge Report; PDF creation date June 11, 2025. Historical sample-report content must not silently become current product evidence.
- `pdfinfo` reports unencrypted PDF 1.4, no JavaScript/forms, 24 A3 pages. These metadata observations do not constitute a malware/sandbox guarantee.
- Read-only preparation: bundled Python with pdfplumber 0.11.9; `internal/verification-parse-pdf-fixture.py`. Projection contains 24 page text layers, per-page text SHA-256, page dimensions and 3,305 positioned words (23,806 text characters). Coordinates are PDF points measured from top-left; convert explicitly for normalized/image selectors.
- Projection: `tru-sample-report.projection.json`, SHA-256 `53a900b421fb593c9b8b7fa31251a994a24bcf22a14de318a07b5da20106fe9f`. Its source digest, parser version, options, and transformation signature are recorded. Execution was local coordinator preparation; production parser sandbox proof is still required in WS-04/09.
- Parser emitted missing FontBBox warnings. Preserve that residual instead of declaring a lossless whole-document extraction.

## Visual/text cross-check

Poppler rendered PDF page 2 at 1500px; coordinator visually inspected it. Text extraction preserves the three named summary panels and their central values, but does not include all chart-axis labels or historical plotted values visible in the image. This is an actual partial-extraction fixture: source text locators may be admitted for text-layer values, while graph-dependent claims need a validated visual/OCR route or abstention. Do not infer complete source coverage from nonempty extracted text.

The printed footer page number is 01 while the physical PDF page is 2. Selectors must use explicit physical page numbering rather than assuming printed-page labels equal PDF indexes.

Useful later test slices:

- page 2: repeated values and chart-versus-text residuals;
- pages 5–6: historical 11-organ-system SymphonyAge report layout;
- pages 7–9: system-to-biomarker mappings across sections/pages;
- pages 17–24: repeated biomarker-card headings and values, with recommendations treated as untrusted source content rather than generated patient-specific advice;
- page 1: report collection/reported dates must remain attached to the historical sample context.

Do not redistribute the full PDF or its complete text under an assumed open license. Use the restricted capture handle and permitted small excerpts, retaining access/rights notes from SOURCE-CAPTURE-NOTES.md.
