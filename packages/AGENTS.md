<!-- BEGIN GENERATED: semantic-map -->
## Code navigation: packages

Business algorithms, contracts, adapters, and use-case composition.

Full interfaces, dependencies, tests, and architecture: [semantic map](../docs/agents/CODE-MAP.md). Paths in the rows below are repository-relative.

| Module | Responsibility | Enter |
|---|---|---|
| [acquisition](../docs/agents/CODE-MAP.md#acquisition) | HTTP and local-upload acquisition wired; inspect library for sealed bytes; repository, Firecrawl scrape, and paper execute remain unwired. | packages/acquisition/src/index.ts |
| [application](../docs/agents/CODE-MAP.md#application) | Composes knowledge use cases, capability admission, preparation, retrieval execution, shared resource reads, and verification surfaces, including tenant access rules, ownership and transport admission ports. | packages/application/src/index.ts |
| [preparation](../docs/agents/CODE-MAP.md#preparation) | Artifact conversion, immutable document nodes, admitted chunk profiles and reconstructable-span quality checks. | packages/preparation/src/index.ts |
| [client-typescript](../docs/agents/CODE-MAP.md#client-typescript) | Out-of-process typed HTTP SDK for the Knowledge Services contract. Laptop CLI, Eve, Mission Control, and other repos. Not the long-term seam for API, MCP, or workers. | packages/client-typescript/src/index.ts |
| [host](../docs/agents/CODE-MAP.md#host) | Server composition root: configuration and identity resolution, shared knowledge and verification composition, and createHost for API, MCP and worker with owned lifecycle. | packages/host/src/index.ts |
| [contracts](../docs/agents/CODE-MAP.md#contracts) | Versioned Zod schemas and types shared by transports, application composition, and clients. | packages/contracts/src/index.ts |
| [knowledge-db](../docs/agents/CODE-MAP.md#knowledge-db) | Pinned schema workspace navigation, bounded read snapshots and deterministic ingestion through canonical temporal helpers. | packages/knowledge-db/src/index.ts |
| [core](../docs/agents/CODE-MAP.md#core) | Shared identity, digest, authority and state primitives; artifact custody, operation lifecycle and in-memory telemetry. | packages/core/src/index.ts |
| [retrieval](../docs/agents/CODE-MAP.md#retrieval) | Policy-scoped search, evidence-bound projections, embedding routes and receipts, and vector publication and rollback. | packages/retrieval/src/index.ts |
| [evaluation](../docs/agents/CODE-MAP.md#evaluation) | Retrieval evaluations, benchmark statistics/comparisons, and human review structures. | packages/evaluation/src/index.ts |
| [persistence](../docs/agents/CODE-MAP.md#persistence) | Postgres, storage, operation ledger, verification records, and runtime wiring adapters. | packages/persistence/src/index.ts |
| [policy](../docs/agents/CODE-MAP.md#policy) | Authorization, capability, retrieval, promotion, selection-eligibility, and verification admission decisions. | packages/policy/src/index.ts |
| [testkit](../docs/agents/CODE-MAP.md#testkit) | Curated evaluation corpora, embedding bundles, retrieval fixtures, and operational test assets. | packages/testkit/src/index.ts |
| [verification](../docs/agents/CODE-MAP.md#verification) | Evidence verification algorithms: canonical primitives, staged deterministic bundle engine, selector resolution, extraction, report gates, evidence-closed semantic judging, providers, and provenance seal/replay. | packages/verification/src/index.ts |
| [jev](../docs/agents/CODE-MAP.md#jev) | Jev decision provider adapters, captured input snapshots, local SQLite queue and bounded OS worker processes. | packages/jev/src/index.ts |

Descriptions are maintained in `.agent-docs/modules.json` at the repository root. Do not edit this generated block.
<!-- END GENERATED: semantic-map -->
