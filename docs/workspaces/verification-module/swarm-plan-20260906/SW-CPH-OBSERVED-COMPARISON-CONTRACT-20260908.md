# CPH observed-lane comparison contract — 2026-09-08

Implemented two internal pure Node modules for root review:

- `internal/verification-cph-observed-comparison-contract-20260908.mjs`
- `internal/verification-cph-observed-comparison-contract-20260908.test.mjs`

Validation: `node --test internal/verification-cph-observed-comparison-contract-20260908.test.mjs` passed 9/9.

`computeObservedComparison(input)` accepts exactly two unique `cursor_cloud` and `eve` lanes. Tenant, operation, receipt, and run references are UUID identities; workflow IDs are 64 hex characters; report, assertion, and transcript references are tenant-scoped registered artifact handles. Frozen input binds case, capture, source/projection artifact IDs, selector digest, and selected-content digest identically across lanes.

The result is `verification-cph-observed-comparison.v1`, descriptive only: one case and one observation per lane, `humanGold:false`, `population:false`, and `promotion:false`. Counts come only from a supplied verified deterministic report summary (`assertionsTotal`, `assertionsPassed`, capture counts, and failed check codes). Report outcomes are compared separately; per-claim admission remains `null` with an explicit reason. Cost and duration are nullable, require measurement source/scope, require currency for known cost, require `unit:"ms"` for duration, and compare only when scopes match. Deltas are always `cursor_cloud − eve`. No database, provider, model, ranking, or statistical inference is performed.
