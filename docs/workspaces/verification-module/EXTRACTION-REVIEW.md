# Independent extraction review

Coordinator accepts the bounded extraction slice after review, source-hash verification, 40/40 package tests and nine independent schema probes. Parser and persisted-lineage integration remain separate.

| ID | Finding | Required regression | State |
| --- | --- | --- | --- |
| ER-01 | Admitted object property bounds and container enum/const constraints are silently ignored. | Every accepted schema keyword is enforced, or rejected for its node type. | Fixed and reviewed |
| ER-02 | Candidate traversal continues after non-JSON, cyclic or over-budget input failure. | Cycles/non-JSON/oversized outputs fail before recursive validation; additional properties have bounded depth/nodes. | Fixed and reviewed |
| ER-03 | Caller schema and returned Map/Set executable nodes are mutable and can diverge from the retained hash. | Mutating input/returned state or forging an admitted root cannot weaken validation or alter frozen schema identity. | Fixed and reviewed |
| ER-04 | Caller limit overrides can raise all safety bounds arbitrarily. | Hard admission caps cannot be increased by request data. | Fixed and reviewed |
| ER-05 | JSON Schema string length uses UTF-16 units rather than Unicode code points. | Astral characters obey standard string length semantics. | Fixed and reviewed |
| ER-06 | Comparison constraints are accepted on modes that ignore them; ASCII normalization trims Unicode whitespace. | Inapplicable options reject or are enforced; normalization does exactly its declared operation. | Fixed and reviewed |
| ER-07 | Field/evidence/representation/rule inputs lack aggregate resource bounds. | Excessive counts, bytes and pointer/rule sizes reject before hashing/resolution loops. | Fixed and reviewed |
| ER-08 | Unknown total operation falls through to percent-change logic; negative tolerance is not explicitly invalid. | Allowed operation/cardinality and nonnegative tolerance enforced before replay. | Fixed and reviewed |
| ER-09 | Date.UTC special handling rejects valid years 0001–0099; ISO currency validation checks only three letters. | Correct calendar construction or explicit supported range; actual declared currency-code admission. | Fixed and reviewed |
| ER-10 | Structured selectors all fail field verification, leaving table/geometry/transcript field support absent. | Extract only source values/text through explicit supported projection rules; never accept query box/interval metadata as evidence. | Fixed and reviewed |

Evidence byte hashing and selector resolution are correctly performed independently of provider confidence. Registration and tenant authorization still must occur through WS-03 composition before these pure functions receive representations. Empty containers and missing optional fields need explicit benchmark/abstention treatment; shape validity alone is not field correctness.

## Integration requirements beyond scalar checks

`verifyExtractionFields.valid` means the declared mechanical comparisons passed. It is not a semantic assertion that separately selected company, count, period and methodology values belong together. The application must also compose existing metric/entity/period evidence bindings and WS-05 semantic/policy checks before admitting an extracted fact or record. Include a cross-company value-splicing fixture in integration review. Source registration/authorization and typed derivation/evidence output envelopes remain application composition requirements.

## Final independent evidence

Owner source hashes matched exactly. Coordinator full verification package suite passed 40/40; independent schema probes passed 9/9 including enum-array mutation, forged handles, cyclic candidates, Unicode bounds and aggregate preflight. ER-10 now supports explicit table cell values and ordered geometry/transcript source text with declared joining; default structured metadata remains rejected. `currency_code_token` explicitly represents syntax, not ISO registry membership. See EV-018.

## Coordinator follow-up — frozen hard-cap defaults

The exported DEFAULT_EXTRACTION_SCHEMA_LIMITS object is now frozen at runtime as well as readonly in TypeScript. This prevents accidental mutation of the shared hard caps. Only the initializer changed after the owner acceptance hash. Targeted extraction tests remain 11/11. Admission reviewer is asked to inspect the initializer independently.

- `packages/verification/src/extraction/schema.ts`: `af90e3553a73764dac673fc515786b8162f9d51b884b06cdef4ca3c0bdc4f12b`.
- `../internal/verification-extraction-frozen-limits-20260906.log`: `64dce7be0ed4c4ead98c87206425f751c599c40ae0a8dee750d923e0e1039dd4`.
