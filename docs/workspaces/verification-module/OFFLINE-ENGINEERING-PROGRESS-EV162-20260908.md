# Offline engineering progress — EV-162 — 2026-09-08

The runtime/dashboard integration retained in EV-161 remains valid. This checkpoint closes additional executable offline demo gaps; it does **not** complete VR-041, VR-042, the full specification, or release acceptance. Matrix remains **31 proved, 8 partial, 7 missing**.

## Retained installed run

Receipt: `internal/verification-offline-demo-EV162-20260908.json` (workspace root), SHA256 `015ed86422dc69a0f55f28f801eef012232f6dded5f8264d105abd6c8353982b`.
Output: `internal/verification-offline-demo-EV162-20260908/`.

The installed CLI ran outside the KS repository with API credentials removed and fetch disabled. It completed in 20,637 ms, retained 29 hash-checked files, did not open a browser in noninteractive mode, and made zero provider calls. Its deliberate exit code is 2 (`verification_incomplete`).

- 40 native claim requests and all three generated reports execute through the production claim/report service. Fresh service instances reproduce deterministic results and exact report/ledger handles.
- 40 exact and normalized source-statement field checks replay from fresh hash-checked projection reads. These are not full structured-provider extraction coverage.
- Four separately derived mechanical mutations actually change a selected name, biomarker wording, institution or citation digest. Original selections pass and changed candidates/digests fail. Original v1 cases and human-gold material remain unchanged.
- Native report consistency checks detect both known turnaround-range and system-count wording mismatches. Their source statements remain separately visible.
- 38 previously sealed semantic claim assessments replay under their existing identities. They are not reattached as semantic verification of the newly generated reports.
- Generated local content-addressed handles are retained with source/projection/transformation parents. They do not claim canonical database registration.

Five full-demo observations pass: catalog integrity, selector resolution, visible count/timeline conflicts, replay of executed deterministic stages, and artifact inventory. Eight remain unavailable: full extraction coverage; authority/applicability; complete semantic mutation coverage; report semantic/citation correctness; full semantic verdict navigation; paired provider arms; full claim/report semantic coverage; and reviewed immutable refresh completion.

## Validation

The integrated application suite passed 21 tests before the final extraction replay addition. The current v1 regression then passed with source-reloaded field replay, 40 native claims, three reports, four mechanical mutations and both native conflict groups. Five mutation regressions and six closure/builder security tests passed. The installed CLI suite passed 7/7, and the final retained installed run verifies the latest extraction replay implementation. Application typecheck/build and CLI build pass. Expanded complete-command tests have explicit 60-second limits because they now execute and replay the production verifier over all cases.

## Remaining work

Continue full semantic report verification and complete source-bound structured/provider replay coverage. Reuse retained provider records only under their exact dataset/request/custody identities; the separate pilot-v4 extraction asset must not silently substitute for v1. Keep genuine unavailable paths visible, then finish the full-demo audit. Human annotations/adjudication, source rights and sensitive-input vendor approval remain outstanding external inputs; none are invented or implied by these mechanics.

EV-161 sealed evidence is preserved. Its earlier broad statement that all remaining work awaited human inputs is superseded by this current scope statement and STATUS.md.
