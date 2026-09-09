# SW-04 progress — human annotation preparation

## Bounded slice: frozen candidate review pack

Added `packages/evaluation/src/verification-human-review.ts` and focused tests. The exporter joins the frozen preparation-v3 curation queue to the frozen fragment registry by capture, projection artifact, and selected-content digest. It emits 180 source-bound candidate rows with exact bounded excerpts (maximum 1,200 characters), excerpt and selected-content digests, source/capture/selector identities, and `candidate_requires_atomization` status. No labels or engineering expectations are copied into the review pack.

The importer validates pack digest, annotator identity and qualification, `annotatorCount: 1`, `human_single_annotator` provenance, allowed categorical labels, duplicate/unknown cases, rationale, and exact excerpt digests. It reports human single annotator status only; it cannot promote gold or accept model-generated labels.

Generated immutable pack:

- `catalog/verification-benchmarks/diagnostics-companies-benchmark-v1-human-review-v1/pack.json` — 180 cases; SHA-256 `2396FF3BD9CECE939599E1AA2D20604531F6209E5D90757D0470A15F267772AE`; semantic pack digest `sha256:48a223cf06f1605266bef824e9c446e841758954f20af80791c680c2a5eac84e`.
- `catalog/verification-benchmarks/diagnostics-companies-benchmark-v1-human-review-v1/review.html` — self-contained reviewer form; SHA-256 `D4B7B98C98E7E8B8165A73159645A9BBBD7CC9C87F230E34A41FC2F6E8B05B29`.
- `catalog/verification-benchmarks/diagnostics-companies-benchmark-v1-human-review-v1/submission.template.json` — blank identity/labels template; SHA-256 `0E3341D0C1FFE8C62071A24BB70BD65064D7BA78C3F25CBC4A73714AB598768E`.

## Proofs

- `corepack pnpm --version` — exit 0, `10.34.5`.
- `corepack pnpm --filter @aiengineer/knowledge-evaluation typecheck` — exit 0.
- `corepack pnpm --filter @aiengineer/knowledge-evaluation test` — exit 0; 6 files, 52 tests.
- `corepack pnpm exec tsx scripts/export-diagnostics-human-review-pack.ts` — initial generation exit 0; output count 180 and semantic pack digest above.
- Re-running the same export — exit 1 with `EEXIST`, proving the generated pack is immutable.

## V2 remediation

`SW-04-HUMAN-REVIEW-V2-REMEDIATION.md` records the v2 import/export hardening. Focused evaluation typecheck and tests pass. V2 generation currently fails closed with `HUMAN_REVIEW_EXCERPT_TOO_LARGE` because the frozen source contains excerpts beyond the non-truncating 1,200-character limit; no v2 directory is produced and v1 is preserved as historical failed review.

The reviewer excerpt limit is now the D-013-authorized 2,000 UTF-16 characters. The generated immutable v2 directory contains 180 blank cases, semantic pack digest `sha256:cf45f4504c4b7fa0475d373d7f66356c35a5b35d5a9ecb27fcf5cc51026afe1e`, and the recorded file hashes in the remediation note. Evaluation tests passed 54/54. The HTML-export serialization is asserted in the focused test; no browser surface was available in this session for interactive download verification. The retained internal synthetic submission is explicitly non-human and has not been imported.

The 180 rows remain candidates rather than atomized assertions or independent observations, and retain the known six-component 90/14/76 split limitation. No provider calls, remote reads, full captures, or labels were used. Human action remaining: atomize/review each candidate, provide a qualified human identity, and complete the independent annotation(s); D-015 permits recording a single annotator as `human_single_annotator`, not adjudicated gold.

## V3 remediation — atomized annotation submission

Version 3 preserves v1 and v2 unchanged and corrects the semantic-label boundary. Every pack row remains a source-bound `candidate_requires_atomization` candidate with blank `atomicProposition`, empty qualifiers, and `labels: null`; a reviewer must supply a nonempty, human-authored atomic proposition and any material qualifiers in every selected-label submission. The importer checks the selected row's exact excerpt digest and includes the proposition and qualifiers in the canonical submission digest. It cannot establish that a typed identity represents a real human; authenticated operator attestation remains required before import is treated as human evidence.

The exporter rejects duplicate candidate IDs, duplicate source-fragment IDs, duplicate registry fragment keys, and any mismatch in capture, projection artifact/digest, selector, source, or selected-content binding. It rejects excerpts longer than the D-013-authorized 2,000 UTF-16-character local-review limit without truncating them. Submission timestamps must be canonical UTC ISO-8601 milliseconds (`YYYY-MM-DDTHH:mm:ss.sssZ`).

The standalone HTML form uses index-derived DOM IDs and a fixed case lookup map, so raw case IDs never become selectors. Its embedded JSON escapes `<`, `>`, `&`, U+2028, and U+2029 before insertion into a script, preventing `</script>`-based data injection. The form exports a blank-label submission until the reviewer selects a label; a selected row contains the exact case/excerpt binding, proposition, qualifiers, and rationale.

Generated immutable v3 catalog:

- `catalog/verification-benchmarks/diagnostics-companies-benchmark-v1-human-review-v3/pack.json` — 180 blank candidates; semantic pack digest `sha256:644f50649e82eb8918cdaa781e475be8a1525eb91562e4ba64f6cff43e2da32c`; SHA-256 `A19B5B1873EFD3D50310108594A09820A1DEEB6D3F1E43A421B69FE01E9744F1`.
- `catalog/verification-benchmarks/diagnostics-companies-benchmark-v1-human-review-v3/review.html` — SHA-256 `CBA19B219131A020866330B216AFC541D63A1383742F6064310DE08863C87E5D`.
- `catalog/verification-benchmarks/diagnostics-companies-benchmark-v1-human-review-v3/submission.template.json` — blank identity, qualification, timestamp, and labels; SHA-256 `A4080CB899AFC3C4172E6C2E5051393FC6A82BFB2749D514C6ADB0A12E4F49BD`.

Focused proof on 2026-09-06: `corepack pnpm --filter @aiengineer/knowledge-evaluation exec vitest run src/verification-human-review.test.ts` exited 0 (5 tests), including proposition/digest mutation, noncanonical timestamp, fragment duplication, and hostile script-data cases. `corepack pnpm --filter @aiengineer/knowledge-evaluation typecheck` exited 0. `corepack pnpm exec tsx scripts/export-diagnostics-human-review-pack.ts` exited 0 and atomically generated v3. No interactive browser was available in this session; the exported payload logic is covered at serialization/binding level, but an interactive download remains a release-environment check.

No human labels were produced or imported by this work.
