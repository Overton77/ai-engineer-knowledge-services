# Benchmark v1 stage2 readiness reconciliation — 2026-09-08

## Finding

The v3 pack is structurally ready to hand to reviewers as a blank, source-bound atomization queue. It contains 180 immutable candidate rows and the current semantic pack digest `sha256:644f50649e82eb8918cdaa781e475be8a1525eb91562e4ba64f6cff43e2da32c`; the file SHA-256 is `A19B5B1873EFD3D50310108594A09820A1DEEB6D3F1E43A421B69FE01E9744F1`. The current split is development 90, calibration 14, locked_test 76 across six provenance components. Every row remains `candidate_requires_atomization` with null labels, as required before human work.

The authoritative preparation binding is `catalog/verification-benchmarks/diagnostics-companies-benchmark-v1-preparation-v3/manifest.json`, which binds the candidate pool (`sha256:e4b2392399b46764a0a76d7aa60da6509925cd11b4359a9b71c4df87a0ec02f1`) to frozen source manifest `internal/verification-offline-source-preparation-9093b465-16c2-4cc1-b7f4-728d3958b0ed/manifest.json` (`sha256:50a3552cffc639a78d7789865be929baefd64d2342431e2de958e669c21f163e`), fragment registry digest `sha256:d1781f1c5b32dff5fff3a27251c9072386f1673e98d4fb9210090fc4ef6b9831`, and 180 matched candidates. The manifest reports complete parent closure, 82 registered bytes verified, and 16 sources; the split plan is bound by `sha256:7fe9de0125fb434e7ae76db842f254f96659850f2afc416c27b228f9a0698add`.

## Concrete remaining local preparation

The pack is not yet a frozen gold benchmark and should not be represented as one. Its own preparation manifest says `humanGoldCases: 0` and requires atomization, provenance-group review, two blinded annotations per case, expert adjudication, reviewer identity admission, artifact registration, and dataset sealing. Those are the next human-review workflow actions, not missing pack generation.

A separate rights/access gate remains unresolved for handoff beyond restricted internal review: the frozen source manifest scope is explicitly `restricted local preparation; not a labeled benchmark or approved redistribution`, and the acceptance matrix still marks VR-037 partial for approved source manifest/license/access review. The smallest next local action is to attach an authoritative rights/access disposition for each of the 16 frozen sources (or an internal-review authorization covering them) to the preparation manifest before distributing reviewer copies. No labels, qualifications, identities, approvals, or rights were inferred here.

## Boundaries

This note assesses local readiness only. It does not claim human annotation, qualification, gold labels, licensing approval, or benchmark acceptance.
