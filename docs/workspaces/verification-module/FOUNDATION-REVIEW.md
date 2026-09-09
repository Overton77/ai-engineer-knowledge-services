# Foundation coordinator review

2026-09-05. Review of in-progress implementation; listed fixes need handoff-test confirmation before closure. Review is independent of implementation authorship.

| ID | Finding | Required regression evidence | State |
| --- | --- | --- | --- |
| F-01 | Draft JSON Pointer regex admitted only one path token. | Root, nested `/a/b`, empty-key tokens, escaped slash/tilde, malformed escapes. | Fixed; EV-007/008 regression passed |
| F-02 | Claim vocabulary omitted DB `event` and `provenance`. | Lossless union/mapping for actual DB seed; no fallback coercion. | Fixed in contract; EV-007 passed; DB migration remains WS-03 |
| F-03 | Metric evidence used arbitrary minimum count instead of required facets. | Timeless/point/interval facet requirements and missing value/unit/identity/period rejection. | Fixed; EV-007/008 regression passed |
| F-04 | Pixel boxes could exceed image boundaries; abbreviated repository IDs were ambiguous. | Coordinate bounds; full immutable commit identity at verification boundary. | Fixed; EV-007 regression passed |
| F-05 | Identity calculation silently ignored extra operands; decimal input unbounded. | Exact operation cardinality; bounded digits and precision. | Fixed; EV-007/008 regression passed |
| F-06 | Per-assertion producer could disagree with top-level producer. | Same-verifier assertion hidden under independent bundle producer must fail. | Fixed; EV-008 regression passed |
| F-07 | Calculation operand IDs were not replayed against verified observations. | Missing/fabricated/mismatched/failed operands and dependency cycles fail; valid chains replay. | Fixed; EV-008 regression passed |
| F-08 | Projection byte length was not verified; optional capture length weakened binding. | Raw and projection length mismatch rejected. | Fixed; EV-007/008 regression passed |
| F-09 | JCS implementation accepted lone Unicode surrogates and non-JSON object classes. | RFC 8785 strings/keys/numeric/order vectors; Date/Map/nonfinite rejection. | Fixed; EV-008 regression passed |
| F-10 | Empty assertion/metric bundles could bypass deployment separation checks. | Global separation enforced; empty verification intent cannot be admitted. | Fixed; EV-007/008 regression passed |
| F-11 | Multi-fragment selectors did not enforce order/non-overlap and admitted invented joiner text. | Reversed/overlapping/duplicate/mixed-basis fragments rejected; omission separators bounded. | Fixed; EV-007/008 regression passed |
| F-12 | Normalized text offsets were indexed by code point and/or transformed text but sliced against raw UTF-16 source. | Astral characters and CRLF normalization preserve exact raw source ranges and selected bytes. | Fixed; EV-008 probe and regression passed |

## Baseline evidence

Coordinator ran prototype `corepack pnpm test:verification`: exit 0, all five original tests pass. Log at `../../../../internal/verification-prototype-baseline-20260905.log`. Legacy direct metric behavior is weaker than new v1 requirements; preserving parity does not authorize its source-value gaps in admitted v1 operations.

Actual local Postgres `evidence.claim_type` codes: attribute, capability, compatibility, definition, event, measurement, provenance, recommendation, relationship. Latest applied canonical migration was `20260904015000` when reviewed.

Coordinator selector probe `node ai-engineer-knowledge-services/node_modules/tsx/dist/cli.mjs internal/verification-selector-review.ts` reproduced F-12 before fix: `😀 one` / quote `one` returned not_found; `A\r\nB` / quote `B` with LF normalization returned a newline as resolved evidence. The probe reports each assertion and exits 1 on a mismatch. Rerun after remediation is required.

Canonicalization requirement checked against [RFC 8785 section 3.2.2.2](https://www.rfc-editor.org/info/rfc8785/): invalid lone surrogates must cause an error, including object keys. No Unicode normalization is applied by JCS.

## Deferred to explicit later owners

- WS-04 verifies extracted leaf values, not merely locator eligibility.
- WS-03 binds registered bytes/projections and identity/tenant relations in canonical persistence.
- WS-05 evaluates assertion atomicity/qualifiers and authority rather than trusting declared booleans.
- WS-08 resolves trusted runtime identities and capabilities before calling pure core; caller strings are not deployment attestation.
- WS-09 verifies parser execution sandboxes and source/schema limits at actual runtime boundaries.
