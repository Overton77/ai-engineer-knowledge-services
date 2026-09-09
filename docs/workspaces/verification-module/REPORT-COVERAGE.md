# Mini-report assertion coverage

The offline diagnostics command emits `report-coverage.json` alongside the three mini reports. Each report's JSON is its complete canonical representation: fixed heading and notice blocks, dataset-derived assertions, exact UTF-16 Markdown spans, text digests, capture and projection references, and local evidence targets.

An assertion is never inferred from arbitrary prose. The renderer accepts explicit case references and fixed contextual text; it rejects foreign cases, duplicate assertion blocks, additional context properties, invalid references, and changed resolution digests. Unresolved evidence remains visible. The current report model accepts one evidence fragment per assertion and rejects multiple fragments explicitly.

`mechanicallyResolved` counts exact selector/digest custody. It does not establish entailment, independent corroboration, clinical correctness, or publication approval. `unmappedCaseIds` lists frozen cases not displayed in that report; it is distinct from missing evidence for a displayed assertion. Complete semantic report verification remains a separate quality gate.

HTML links each assertion to its entry in `evidence-appendix.html`. That entry exposes the selector, selected fragment, baseline result, and recorded semantic assessment when one exists. It links back to `run-ledger.json`. Source snapshot metadata is available through `source-ledger.json`.

The output manifest and content-addressed verification bundle include the coverage artifact. Auditing a report rebuilds it from the frozen dataset, actual resolution records, and fixed authored blocks, then compares text, spans, evidence references, and digests exactly.
