<!-- BEGIN GENERATED: semantic-map -->
## Code navigation: packages

Business algorithms, contracts, adapters, and use-case composition.

Full interfaces, dependencies, tests, and architecture: [semantic map](../docs/agents/CODE-MAP.md). Paths in the rows below are repository-relative.

| Module | Responsibility | Enter |
|---|---|---|
| [acquisition](../docs/agents/CODE-MAP.md#acquisition) | Admitted source acquisition through HTTP, Firecrawl, manual upload, repository, and paper adapters. | packages/acquisition/src/index.ts |
| [application](../docs/agents/CODE-MAP.md#application) | Composes knowledge use cases, capability admission, preparation, and verification surfaces. | packages/application/src/index.ts |
| [chunking](../docs/agents/CODE-MAP.md#chunking) | Builds bounded chunks with strategy profiles, overlap controls, and source spans. | packages/chunking/src/index.ts |
| [client-typescript](../docs/agents/CODE-MAP.md#client-typescript) | Typed HTTP client for cross-repository consumers of the Knowledge Services contract. | packages/client-typescript/src/index.ts |
| [config](../docs/agents/CODE-MAP.md#config) | Validates server, authentication, and semantic-provider configuration. | packages/config/src/index.ts |
| [contracts](../docs/agents/CODE-MAP.md#contracts) | Versioned Zod schemas and types shared by transports, application composition, and clients. | packages/contracts/src/index.ts |
| [conversion](../docs/agents/CODE-MAP.md#conversion) | Converts captured inputs and wraps external Docling and isolated native parser routes. | packages/conversion/src/index.ts |
| [db-read](../docs/agents/CODE-MAP.md#db-read) | Executes knowledge-read-intent.v1 into a digested snapshot under bounded read-only roles, with a SQL guard and artifact ledger. | packages/db-read/src/index.ts |
| [documents](../docs/agents/CODE-MAP.md#documents) | Constructs immutable document nodes and source locators from structural blocks. | packages/documents/src/index.ts |
| [domain](../docs/agents/CODE-MAP.md#domain) | Shared digest, identity, idempotency, error, authority, and state-machine primitives. | packages/domain/src/index.ts |
| [embeddings](../docs/agents/CODE-MAP.md#embeddings) | Embedding adapter requests, cache/route identity, bounded batches, and receipts. | packages/embeddings/src/index.ts |
| [ingestion](../docs/agents/CODE-MAP.md#ingestion) | Deterministic planner and apply of knowledge-ingestion-intent.v1 through temporal.* helpers, with receipts and duplicate handling. | packages/ingestion/src/index.ts |
| [evaluation](../docs/agents/CODE-MAP.md#evaluation) | Retrieval evaluations, benchmark statistics/comparisons, and human review structures. | packages/evaluation/src/index.ts |
| [observability](../docs/agents/CODE-MAP.md#observability) | In-memory operation telemetry, SLO summaries, and manifest reconciliation. | packages/observability/src/index.ts |
| [persistence](../docs/agents/CODE-MAP.md#persistence) | Postgres, storage, operation ledger, verification records, and runtime wiring adapters. | packages/persistence/src/index.ts |
| [policy](../docs/agents/CODE-MAP.md#policy) | Authorization, capability, retrieval, promotion, and verification admission decisions. | packages/policy/src/index.ts |
| [projections](../docs/agents/CODE-MAP.md#projections) | Produces domain projections whose assertions remain bound to source evidence. | packages/projections/src/index.ts |
| [retrieval](../docs/agents/CODE-MAP.md#retrieval) | Plans and executes policy-scoped lexical, semantic, graph, rerank, and diversity retrieval. | packages/retrieval/src/index.ts |
| [runtime](../docs/agents/CODE-MAP.md#runtime) | Content-addressed artifacts and operation/step/lease/event/receipt primitives. | packages/runtime/src/index.ts |
| [schema-workspace](../docs/agents/CODE-MAP.md#schema-workspace) | Loads and searches the pinned db-contract schema workspace, compares migration heads, and materializes scoped bundles. | packages/schema-workspace/src/index.ts |
| [testkit](../docs/agents/CODE-MAP.md#testkit) | Curated evaluation corpora, embedding bundles, retrieval fixtures, and operational test assets. | packages/testkit/src/index.ts |
| [vector-backends](../docs/agents/CODE-MAP.md#vector-backends) | Vector-store adapters and publication handling for exact and Postgres search. | packages/vector-backends/src/index.ts |
| [verification](../docs/agents/CODE-MAP.md#verification) | Evidence verification algorithms behind deterministic, selector, claim, semantic, and provenance facades. | packages/verification/src/index.ts |

Descriptions are maintained in `.agent-docs/modules.json` at the repository root. Do not edit this generated block.
<!-- END GENERATED: semantic-map -->
