# Verification Test Matrix

This is the minimum proof plan. Every test stores its code revision, configuration digest, fixture/dataset version, provider/model identity, timestamps, and output artifact IDs in the run manifest.

| Layer | Required test families | Principal failure caught | Owner | Gate |
|---|---|---|---|---|
| Contracts | schema round-trip, unknown version, backward/forward compatibility, canonical JSON, taxonomy mapping | silent contract or hash drift | WS-01 | P0 |
| Deterministic core | digest, locator cardinality, source binding, identity, units, dates, ranges, arithmetic, independence, monotonic failure | accepting mechanically invalid evidence | WS-02 | P0 |
| Provenance | byte-to-projection lineage, selector replay, hash mismatch, missing object, orphan row/object, append-only behavior | non-replayable or fabricated lineage | WS-03 | P0 |
| Tenant/security | cross-tenant reads, signed URL expiry, RLS/grants, SSRF, decompression/schema bombs, parser sandbox, secret/redaction scans | data leakage or hostile-input compromise | WS-03/09 | P0 |
| Extraction | exact/normalized field score, evidence locator score, tables, repeated text, OCR coordinates, scanned PDFs, conflicting values | correct-looking value with wrong evidence | WS-04 | P0 |
| Claim decomposition | atomicity, qualifier retention, report offsets, reconstruction, claim-selection recall | missed or distorted verifiable assertions | WS-05 | P0 |
| Semantic verification | full/partial/unsupported/contradicted gold set, evidence-closed prompt, evidence swaps, counterfactuals, judge disagreement | topical citation or judge bias counted as support | WS-05 | P0 |
| Attribution faithfulness | source ablation, source replacement, citation permutation, influence/sensitivity | post-hoc citations that did not ground output | WS-05/07 | P0 |
| Provider conformance | capabilities, raw capture, error mapping, timeouts, retries, ZDR, schema limits, URLs, usage/cost metadata | provider-specific behavior leaking into policy | WS-06 | P0 |
| Benchmark harness | split leakage, deterministic sampling, paired arms, repetitions, resumability, partial failure, sealed manifest | invalid or non-reproducible comparisons | WS-07 | P0 |
| Statistics | clustered bootstrap, paired tests, multiple comparisons, calibration, risk–coverage, slice denominators | misleading averages or false promotion | WS-07 | P0 |
| Transport parity | same fixture through in-process, HTTP, client, CLI, MCP, worker | divergent semantics across consumers | WS-08 | P0 |
| Orchestration | idempotency, duplicate delivery, cancellation, retry classes, heartbeat, reconciliation, Temporal replay | duplicate or lost durable work | WS-10 | P0 |
| Cross-framework | Cursor Cloud, EVE, alternate client with shared operation envelope | framework-owned forks or missing identity | WS-10 | P0 |
| Dashboard/review | authorization, redaction, evidence drilldown, review conflict, adjudication audit, control permissions | misleading UI or unauthorized action | WS-11 | P0 |
| Resilience | provider outage, storage outage, DB outage, judge drift, corrupt artifact, replay incompatibility | unsafe degradation | WS-09 | P0 |
| Final audit | clean-environment build, all gates, sealed pilot replay, acceptance-matrix proof audit | completion declared from partial evidence | WS-12 | P0 |
| Diagnostics-company pack | frozen/live capture diff, biomarker and algorithm extraction, count/timeline conflicts, interested-party authority, paper-to-product applicability, adversarial swaps, mini-report citation coverage, offline demo | polished report that conceals unsupported or stale claims | WS-03/04/05/07/08/09 | P0 |

## Benchmark slices that must be reported

- modality and parser route;
- document length, layout complexity, scan/OCR quality, language, and table density;
- claim type, qualifier count, evidence-hop count, contradiction type, and citation distance;
- source authority tier and source conflict;
- provider/model/version, warm/cold cache, and retry path;
- criticality, tenant/data classification, and human-review outcome.

Do not publish an aggregate metric without its denominator, confidence interval, excluded cases, and worst material slice.

## Mandatory adversarial transformations

- delete, swap, duplicate, truncate, or move a citation;
- alter a number, unit, sign, currency, date, entity, negation, or qualifier;
- replace evidence with a topically related but non-supporting fragment;
- inject contradictory passages or a lower-authority source;
- reorder repeated text so excerpt-only locators become ambiguous;
- corrupt source bytes, canonical projection, manifest, or selector digest;
- insert prompt injection into source, provider metadata, benchmark case, or reviewer-visible text.

The verifier should fail monotonically: degrading the evidence must not improve admission without an explicit, explainable policy change.
