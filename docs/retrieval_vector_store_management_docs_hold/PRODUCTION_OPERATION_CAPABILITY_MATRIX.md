# Production operation capability matrix

This file is the operational truth for durable mutation admission. The complete
`OperationKind` enum is a wire-contract vocabulary, not a promise that every
kind is executable in the current production slice.

The executable catalog is mechanically defined in
`packages/application/src/surface.ts` and checked against the actual worker
registry. A production PostgreSQL admission rejects every unlisted kind with
`CAPABILITY_NOT_ADMITTED:<operation-kind>` **before** parsing caller data or
writing an operation, step, event, or outbox row. HTTP renders that failure as
an RFC 9457-style `503` problem with code `CAPABILITY_NOT_ADMITTED`. Dedicated
API-owned work is not admitted through generic worker mutation endpoints.

## Executable operations

| Operation kind | Owner | Complete ordered steps | Durable effect |
| --- | --- | --- | --- |
| `source_discovery` | worker | `discover` | Bounded candidate normalization, canonical URL deduplication, stable ranking and digested result receipt |
| `source_resolution` | worker | `resolve` | URL/DOI/arXiv/OpenReview identity normalization, stable source identities and digested resolution receipt |
| `vector_store_create` | worker | `create` | Operation-bound immutable owner/store identity, class mapping, bounded quotas/retention/deletion policy and exact replay |
| `vector_store_documents` | worker | `validate`, `attach` | Owner-authorized atomic attachment of bounded canonical document/version/representation triples |
| `vector_store_ingestion` | worker | `prepare`, `embed`, `index` | Verifies the complete attachment→transformation→chunk→promotion→embedding→publication chain and persists stage checkpoints |
| `capture` | worker | `acquire`, `seal` | Exact acquisition, private artifact persistence, byte/digest replay verification |
| `transformation` | worker | `convert`, `inspect` | Provider-routed conversion, representation/node persistence, fidelity inspection |
| `chunk_set` | worker | `chunk`, `verify` | Deterministic chunks/spans plus reconstruction verification |
| `chunk_preview` | worker | `preview` | Non-publishing deterministic chunk result recorded in the durable receipt |
| `chunk_comparison` | worker | `compare` | Bounded profile comparison with token/QA/output-digest metrics |
| `source_vetting` | worker | `vet` | Deterministic vetting proposal and review subject; never self-publishes |
| `representation_decision` | worker | `decide` | Guarded reviewer decision with independent reviewer authority |
| `promotion_proposal` | worker | `propose` | Candidate projection materialization and guarded review subject |
| `promotion_decision` | worker | `decide` | Guarded promotion decision; proposer cannot self-authorize publication |
| `embedding_run` | worker | `embed`, `verify` | Server-side embedding, fixed-dimension/digest persistence and verification |
| `space_publication` | worker | `publish`, `verify` | Control-plane-only staged pointer switch and post-switch verification |
| `publication_verification` | worker | `verify` | Exact-versus-ANN recall check for a versioned space |
| `publication_rollback` | worker | `rollback`, `verify` | Control-plane-only guarded rollback and active-pointer verification |
| `vector_store_evaluation` | worker | `evaluate` | Exact-versus-ANN recall evaluation |
| `evaluation_dataset` | worker | `freeze` | Immutable deterministic dataset freeze |
| `evaluation_run` | worker | `evaluate`, `report` | Deterministic metric calculation and report output |
| `experiment` | worker | `record` | Frozen-dataset multi-arm results and control-relative quality/latency/cost deltas |
| `evidence_packet` | worker | `packet` | Validated normalized evidence packet persistence |
| `representation_comparison` | worker | `compare` | Structural-path alignment across representation-scoped node IDs and localized digest differences |
| `retrieval_run` | API | `retrieve`, `packet` | API-owned embedding/search/fusion/packet transaction; only `/v1/retrieval-runs` may admit it |

Every worker-owned step above must appear exactly once in
`createProductionActivityRegistry(...)`. The parity test fails if a catalog
step has no handler, if a handler is omitted from the catalog, or if an owner is
duplicated. The worker also supplies this registry-derived kind list to the
PostgreSQL leasing query, so it cannot steal API-owned retrieval.

## Deferred contract operations

These names remain in the versioned wire enum so clients can understand stored
historical records and future compatible additions. They are not production
mutation capabilities in this slice.

| Deferred kind | Why it is not admitted |
| --- | --- |
| `capture_inspection` | Capture sealing is part of `capture`; no separate persisted inspection contract |
| `capture_comparison` | No durable comparison result schema/repository |
| `vector_store_search` | Canonical search is `retrieval_run`; the legacy store-search mutation cannot bypass planning/evidence rules |
| `document` | Documents are persisted by the transformation workflow, not a free-standing generic record mutation |
| `document_version` | Versions are persisted by transformation under capture lineage |
| `representation` | Representations are produced by transformation; arbitrary representation writes are forbidden |
| `representation_inspection` | The required inspection is the second `transformation` step |
| `chunk_set_inspection` | Reconstruction verification is the second `chunk_set` step |
| `review` | Review subjects are created by governed producers; an unconstrained generic review mutation would bypass subject guards |
| `review_decision` | Decisions use the subject-specific `representation_decision` and `promotion_decision` contracts |

## A2A boundary

`A2ATask` includes a required `operationInput`. The adapter submits that real
input and adds a reserved `a2a` binding containing task/callback lineage. A
caller cannot supply or replace the reserved field. `document_preparation`,
`retrieval`, `vector_store_ingestion`, and `evidence_packet_construction` are executable only when routed
to their corresponding admitted owner and their operation-specific input
validates. Vector-store ingestion requires the exact `knowledge.vector-store-ingestion/v1` chain contract; incomplete lineage is rejected rather than queued.

The required `operationInput` addition is part of the unreleased v1 contract in
this workspace. Generated JSON Schema and OpenAPI artifacts must be regenerated
with `pnpm --filter @aiengineer/knowledge-contracts generate` after changes.
