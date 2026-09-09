# SW-04 human review v3 remediation

## Purpose

V1 and v2 are retained as immutable historical artifacts. V3 removes the false implication that a source excerpt can itself be a semantic-gold assertion. Each row is an unlabeled source-bound candidate and explicitly requires human atomization before an entailment label may be submitted.

## Submission contract

A selected label must provide a nonempty atomic proposition, rationale, exact row excerpt digest, and an array of material qualifiers. The canonical submission digest covers those fields, so changing the proposition or qualifier changes the receipt. Import recomputes the pack digest, validates canonical UTC ISO-8601 milliseconds, requires one declared human annotator and qualification, rejects unknown/duplicate rows, and rejects wrong excerpt bindings. Typed identity and provenance remain claims until authenticated operator attestation is applied at a later boundary.

## Export safety and custody

The exporter rejects duplicate candidate IDs, duplicate candidate fragment IDs, duplicate registry fragment identifiers, and drift in source, capture, projection, selector, or selected-content fields. It rejects evidence over 2,000 UTF-16 characters rather than truncating it. The browser form uses numeric index-derived element IDs and a data lookup map instead of interpolating source IDs into selectors. Serialized JSON escapes script-significant characters, including a hostile `</script>` case.

## Immutable v3 output

- Pack: `catalog/verification-benchmarks/diagnostics-companies-benchmark-v1-human-review-v3/pack.json`
  - 180 candidate rows, all `candidate_requires_atomization`, all blank propositions and labels.
  - Semantic pack digest: `sha256:644f50649e82eb8918cdaa781e475be8a1525eb91562e4ba64f6cff43e2da32c`.
  - File SHA-256: `A19B5B1873EFD3D50310108594A09820A1DEEB6D3F1E43A421B69FE01E9744F1`.
- HTML: `review.html`, SHA-256 `CBA19B219131A020866330B216AFC541D63A1383742F6064310DE08863C87E5D`.
- Blank template: `submission.template.json`, SHA-256 `A4080CB899AFC3C4172E6C2E5051393FC6A82BFB2749D514C6ADB0A12E4F49BD`.

## Validation and limitation

`corepack pnpm --filter @aiengineer/knowledge-evaluation exec vitest run src/verification-human-review.test.ts` passed 5/5 tests, and the package typecheck passed. The v3 generator completed through staging and atomic rename. The test environment had no interactive browser surface, so the generated HTML submission logic is exercised by focused serialization and binding tests rather than a download event. No human labels or attestations were generated, imported, or certified.

### Human-review browser readiness — 2026-09-08

Root verified the v3 review.html and pack.json hashes, then ran node internal/verification-human-review-browser.mjs against a disposable exact HTML copy in real local Chrome. Clean receipt internal/verification-human-review-browser-75b52e3f-6375-45b1-8d82-a9c0bbc8b586.json passes:180 candidate controls, blank export0labels, synthetic one-row download with exact pack/case/excerpt binding and two preserved qualifier lines, zero network attempts, immutable source unchanged, temporary fixture/browser downloads removed. No annotation was imported, retained as human work or used for scoring. First smoke receipt859056da failed on an overly exact accessible-name matcher; the matcher was corrected without changing the form. D-015 reviewer selection has been asked; actual human labels remain absent. This is UI mechanics evidence, not a benchmark-quality promotion.
