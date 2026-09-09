# SW-CPH-DESCRIPTIVE-COMPARISON-FINAL-AUDIT-20260908

## Verdict

The CPH observed comparison is proved for its bounded descriptive scope. The two actual registration receipts have SHA-256 hashes `3530a44b544d7958856c0ae7541073e9d61ec139d0b3514f2ee20878d57f579f` and `afec5cff0ef1278ccaa2be8aff541d4e2af834c5f40481b0eee74b895923f4d9`. Removing only their per-run `proofId` produces equal canonical receipt content.

Both receipts independently report successful canonical experiment/two-arm registration, operation receipt custody, exact comparison round-trip, identical frozen source bytes, restricted artifact registration, and zero new provider calls. The stable experiment is `b9a91a91-af48-5c78-af38-8457a2f03f6d`; the comparison artifact is `7ff82680-cb2d-5f3f-ac10-05359715d2b2`. The registered comparison has schema `verification-cph-observed-comparison.v1`, one case, one observation per `cursor_cloud` and `eve` lane, and matching tenant, capture, source artifact/digest, projection artifact/digest, selector digest, and selected-content digest.

The evidence is descriptive only: `humanGold=false`, `population=false`, and `promotion=false`. Both reports are `review_required`; per-claim admission remains explicitly unavailable. Cost and duration scopes differ and are left non-comparable. This audit therefore closes the descriptive comparison registration and does not establish a sealed human quality benchmark or a quality promotion.

## Bound sources

- Final immutable audit receipt: `C:/Users/Pinda/Proyectos/aiengineer/internal/verification-cph-descriptive-comparison-final-acceptance-audit-20260908.json`.
- Registration implementation SHA-256: `internal/register-verification-cph-observed-comparison-20260908.mts` = `e1ef9c8b4197284173faa12d5bc5533aeb6ba2d6c544850170dab94ce2f70779`.
- Comparison contract SHA-256: `internal/verification-cph-observed-comparison-contract-20260908.mjs` = `b072a6f17e1e6415256dceb935fc982cad864ec0681a627937632b268c63bc85`.
