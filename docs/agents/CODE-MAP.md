<!-- BEGIN GENERATED: semantic-map -->
# Semantic code map

Generated from reviewed module descriptions and current selected source files. Package dependencies/exports/script names are extracted from manifests; relationships and ownership are authored. This is not a complete import graph or proof that a designed capability is implemented.

Paths below are repository-relative. Use the task routes, then search the module heading. Follow accepted architecture docs for decisions; proposed/reference/deprecated documents retain those labels.

## Task routes

- Change an HTTP/MCP/CLI verification surface: [contracts](#contracts) → [application](#application) → [api](#api) → [mcp](#mcp) → [cli](#cli)
- Change locator or evidence verification: [verification](#verification) → [verification-selectors](#verification-selectors) → [verification-deterministic](#verification-deterministic) → [verification-semantic](#verification-semantic)
- Debug worker retry or persistence: [worker](#worker) → [runtime](#runtime) → [persistence](#persistence)
- Change parsing and conversion: [conversion](#conversion) → [verification-parser](#verification-parser) → [docling](#docling)
- Change retrieval or embedding: [retrieval](#retrieval) → [embeddings](#embeddings) → [vector-backends](#vector-backends) → [policy](#policy)
- Find proof and evaluation commands: [script-proofs](#script-proofs) → [script-evaluation](#script-evaluation) → [script-reconciliation](#script-reconciliation)
- Change schema workspace, knowledge read, or ingestion: [schema-workspace](#schema-workspace) → [db-read](#db-read) → [ingestion](#ingestion) → [verification-executor](#verification-executor)

## Modules

| Module | Source | Responsibility | State |
|---|---|---|---|
| [api](#api) | apps/api | Fastify HTTP transport, authentication, resource reads, and verification routes. | implemented |
| [cli](#cli) | apps/cli | Machine-readable knowledge operator/developer commands and selected local demos. | implemented |
| [mcp](#mcp) | apps/mcp | Stateless Streamable HTTP MCP tools over knowledge application behavior. | implemented |
| [verification-executor](#verification-executor) | apps/verification-executor | Sandbox verification executor that also hosts schema, bounded-read, and ingestion operations on CLI, MCP, and HTTP. | implemented |
| [worker](#worker) | apps/worker | Durable knowledge-operation execution, activity dispatch, and verification runtime wiring. | implemented |
| [acquisition](#acquisition) | packages/acquisition | Admitted source acquisition through HTTP, Firecrawl, manual upload, repository, and paper adapters. | implemented |
| [application](#application) | packages/application | Composes knowledge use cases, capability admission, preparation, and verification surfaces. | implemented |
| [chunking](#chunking) | packages/chunking | Builds bounded chunks with strategy profiles, overlap controls, and source spans. | implemented |
| [client-typescript](#client-typescript) | packages/client-typescript | Typed HTTP client for cross-repository consumers of the Knowledge Services contract. | implemented |
| [config](#config) | packages/config | Validates server, authentication, and semantic-provider configuration. | implemented |
| [contracts](#contracts) | packages/contracts | Versioned Zod schemas and types shared by transports, application composition, and clients. | implemented |
| [conversion](#conversion) | packages/conversion | Converts captured inputs and wraps external Docling and isolated native parser routes. | implemented |
| [db-read](#db-read) | packages/db-read | Executes knowledge-read-intent.v1 into a digested snapshot under bounded read-only roles, with a SQL guard and artifact ledger. | partial |
| [documents](#documents) | packages/documents | Constructs immutable document nodes and source locators from structural blocks. | implemented |
| [domain](#domain) | packages/domain | Shared digest, identity, idempotency, error, authority, and state-machine primitives. | implemented |
| [embeddings](#embeddings) | packages/embeddings | Embedding adapter requests, cache/route identity, bounded batches, and receipts. | implemented |
| [ingestion](#ingestion) | packages/ingestion | Deterministic planner and apply of knowledge-ingestion-intent.v1 through temporal.* helpers, with receipts and duplicate handling. | partial |
| [evaluation](#evaluation) | packages/evaluation | Retrieval evaluations, benchmark statistics/comparisons, and human review structures. | implemented |
| [observability](#observability) | packages/observability | In-memory operation telemetry, SLO summaries, and manifest reconciliation. | implemented |
| [persistence](#persistence) | packages/persistence | Postgres, storage, operation ledger, verification records, and runtime wiring adapters. | implemented |
| [policy](#policy) | packages/policy | Authorization, capability, retrieval, promotion, and verification admission decisions. | implemented |
| [projections](#projections) | packages/projections | Produces domain projections whose assertions remain bound to source evidence. | implemented |
| [retrieval](#retrieval) | packages/retrieval | Plans and executes policy-scoped lexical, semantic, graph, rerank, and diversity retrieval. | implemented |
| [runtime](#runtime) | packages/runtime | Content-addressed artifacts and operation/step/lease/event/receipt primitives. | implemented |
| [schema-workspace](#schema-workspace) | packages/schema-workspace | Loads and searches the pinned db-contract schema workspace, compares migration heads, and materializes scoped bundles. | implemented |
| [testkit](#testkit) | packages/testkit | Curated evaluation corpora, embedding bundles, retrieval fixtures, and operational test assets. | implemented |
| [vector-backends](#vector-backends) | packages/vector-backends | Vector-store adapters and publication handling for exact and Postgres search. | implemented |
| [verification](#verification) | packages/verification | Evidence verification algorithms behind deterministic, selector, claim, semantic, and provenance facades. | implemented |
| [verification-deterministic](#verification-deterministic) | packages/verification/src/deterministic | Canonical numeric, selector, and mechanical verification checks. | implemented |
| [verification-selectors](#verification-selectors) | packages/verification/src/selectors | Canonical projection models and deterministic source locator resolution. | implemented |
| [verification-extraction](#verification-extraction) | packages/verification/src/extraction | Schema-bound extraction field verification and evidence comparisons. | implemented |
| [verification-provenance](#verification-provenance) | packages/verification/src/provenance | Verification seals, replay, policy inputs, attestations, and publication bindings. | implemented |
| [verification-claims](#verification-claims) | packages/verification/src/claims | Claim decomposition and report-level evidence structure. | implemented |
| [verification-authority](#verification-authority) | packages/verification/src/authority | Source authority and corroboration assessments. | implemented |
| [verification-semantic](#verification-semantic) | packages/verification/src/semantic | Evidence-closed semantic verification, rescue, and attribution checks. | implemented |
| [verification-providers](#verification-providers) | packages/verification/src/providers | Bounded semantic-provider adapters, gateway routes, and provider registry. | implemented |
| [docling](#docling) | services/docling | Pinned Docling Serve conversion deployment boundary. | implemented |
| [verification-parser](#verification-parser) | services/verification-parser | Isolated native PDF geometry and HTML DOM parser; separate from Docling and OCR. | implemented |
| [script-proofs](#script-proofs) | scripts | Targeted durability, transport, recovery, and integration proof executables. | implemented |
| [script-evaluation](#script-evaluation) | scripts | Corpus/bundle evaluation and review sampling helpers. | implemented |
| [script-reconciliation](#script-reconciliation) | scripts | Provider accounting and reconciliation operations. | implemented |
| [script-experiments](#script-experiments) | scripts/experiments | Curated model-card verification experiments; run results are not canonical architecture. | partial |
| [skill-schema-explore](#skill-schema-explore) | skills/schema-explore | Progressive-disclosure procedure for navigating the pinned schema workspace without querying the database. | implemented |
| [skill-knowledge-db](#skill-knowledge-db) | skills/knowledge-db | Procedure for catalog reads and reproducible knowledge-read snapshots that an ingestion intent can cite. | implemented |
| [skill-knowledge-ingest](#skill-knowledge-ingest) | skills/knowledge-ingest | Procedure for composing, planning, applying, and verifying knowledge-ingestion intents through the executor. | implemented |

## api

**apps/api** · app · implemented

Fastify HTTP transport, authentication, resource reads, and verification routes.

**Enter:** [`apps/api/src/index.ts`](../../apps/api/src/index.ts), [`apps/api/src/server.ts`](../../apps/api/src/server.ts)
**Interface:** Versioned HTTP endpoints backed by application services.
**Package:** @aiengineer/knowledge-api ([`apps/api/package.json`](../../apps/api/package.json))
**Export subpaths:** none declared. Declared metadata; build outputs are not read.
**Declared internal package dependencies:** [application](#application), [config](#config), [contracts](#contracts), [domain](#domain), [embeddings](#embeddings), [persistence](#persistence), [runtime](#runtime), [testkit](#testkit)
**Other runtime dependencies:** fastify, zod
**Reviewed runtime/data relationships:** none declared
**Checks:** [`apps/api/src/server.test.ts`](../../apps/api/src/server.test.ts), [`apps/api/src/verification-routes.test.ts`](../../apps/api/src/verification-routes.test.ts) Package script names: build, dev, start, test, typecheck.

**Architecture and detailed docs:**

- [reference] [`README.md`](../../README.md) — Service boundaries and startup
- [accepted] [`docs/architecture/0001-runtime-and-deployment.md`](../../docs/architecture/0001-runtime-and-deployment.md) — Runtime, transport, and deployment changes
- [reference] [`docs/verification/INTEGRATION-GUIDE.md`](../../docs/verification/INTEGRATION-GUIDE.md) — Cross-service verification integration
- [reference] [`docs/verification/DEPLOYMENT.md`](../../docs/verification/DEPLOYMENT.md) — Verification deployment and rollback

## cli

**apps/cli** · app · implemented

Machine-readable knowledge operator/developer commands and selected local demos.

**Enter:** [`apps/cli/src/index.ts`](../../apps/cli/src/index.ts), [`apps/cli/src/commands.ts`](../../apps/cli/src/commands.ts)
**Interface:** knowledge command surface; check command-specific mutation and provider preconditions.
**Package:** @aiengineer/knowledge-cli ([`apps/cli/package.json`](../../apps/cli/package.json))
**Export subpaths:** none declared. Declared metadata; build outputs are not read.
**Declared internal package dependencies:** [application](#application), [client-typescript](#client-typescript), [contracts](#contracts), [verification](#verification)
**Other runtime dependencies:** none declared
**Reviewed runtime/data relationships:** none declared
**Checks:** [`apps/cli/src/commands.test.ts`](../../apps/cli/src/commands.test.ts) Package script names: build, dev, test, typecheck.

**Architecture and detailed docs:**

- [reference] [`README.md`](../../README.md) — Service boundaries and startup
- [reference] [`docs/verification/INTEGRATION-GUIDE.md`](../../docs/verification/INTEGRATION-GUIDE.md) — Cross-service verification integration

## mcp

**apps/mcp** · app · implemented

Stateless Streamable HTTP MCP tools over knowledge application behavior.

**Enter:** [`apps/mcp/src/index.ts`](../../apps/mcp/src/index.ts), [`apps/mcp/src/catalog.ts`](../../apps/mcp/src/catalog.ts)
**Interface:** MCP catalog and tool handlers; not a second business-rule authority.
**Package:** @aiengineer/knowledge-mcp ([`apps/mcp/package.json`](../../apps/mcp/package.json))
**Export subpaths:** none declared. Declared metadata; build outputs are not read.
**Declared internal package dependencies:** [application](#application), [client-typescript](#client-typescript), [config](#config), [contracts](#contracts), [persistence](#persistence)
**Other runtime dependencies:** @modelcontextprotocol/sdk, fastify, zod
**Reviewed runtime/data relationships:** none declared
**Checks:** [`apps/mcp/src/adjudication-reads.test.ts`](../../apps/mcp/src/adjudication-reads.test.ts), [`apps/mcp/src/adjudication.test.ts`](../../apps/mcp/src/adjudication.test.ts) Package script names: build, dev, start, test, typecheck.

**Architecture and detailed docs:**

- [reference] [`README.md`](../../README.md) — Service boundaries and startup
- [accepted] [`docs/architecture/0001-runtime-and-deployment.md`](../../docs/architecture/0001-runtime-and-deployment.md) — Runtime, transport, and deployment changes
- [reference] [`docs/verification/INTEGRATION-GUIDE.md`](../../docs/verification/INTEGRATION-GUIDE.md) — Cross-service verification integration

## verification-executor

**apps/verification-executor** · app · implemented

Sandbox verification executor that also hosts schema, bounded-read, and ingestion operations on CLI, MCP, and HTTP.

**Enter:** [`apps/verification-executor/src/index.ts`](../../apps/verification-executor/src/index.ts), [`apps/verification-executor/src/executor.ts`](../../apps/verification-executor/src/executor.ts), [`apps/verification-executor/src/knowledge/operations.ts`](../../apps/verification-executor/src/knowledge/operations.ts), [`apps/verification-executor/src/knowledge/cli.ts`](../../apps/verification-executor/src/knowledge/cli.ts), [`apps/verification-executor/src/knowledge/context.ts`](../../apps/verification-executor/src/knowledge/context.ts), [`apps/verification-executor/src/operations/define.ts`](../../apps/verification-executor/src/operations/define.ts)
**Interface:** knowledge-verify plus knowledge schema_*/db_*/ingest_*/artifact_get; one OperationDefinition feeds CLI, POST /knowledge/<name>, and MCP.
**Package:** @aiengineer/knowledge-verification-executor ([`apps/verification-executor/package.json`](../../apps/verification-executor/package.json))
**Export subpaths:** none declared. Declared metadata; build outputs are not read.
**Declared internal package dependencies:** [application](#application), [contracts](#contracts), [db-read](#db-read), [ingestion](#ingestion), [persistence](#persistence), [policy](#policy), [runtime](#runtime), [schema-workspace](#schema-workspace), [verification](#verification)
**Other runtime dependencies:** @aiengineer/database-contract, @modelcontextprotocol/sdk, pg, zod
**Reviewed runtime/data relationships:** [schema-workspace](#schema-workspace), [db-read](#db-read), [ingestion](#ingestion)
**Checks:** [`apps/verification-executor/src/knowledge/cli.test.ts`](../../apps/verification-executor/src/knowledge/cli.test.ts) Package script names: build, dev, dev:knowledge, pack:sandbox, test, typecheck.
- Distinct from apps/api's durable service transport; preserve the explicit sandbox capability model. Knowledge services are absent when no database URL is configured.

**Architecture and detailed docs:**

- [reference] [`README.md`](../../README.md) — Service boundaries and startup

## worker

**apps/worker** · app · implemented

Durable knowledge-operation execution, activity dispatch, and verification runtime wiring.

**Enter:** [`apps/worker/src/index.ts`](../../apps/worker/src/index.ts), [`apps/worker/src/worker.ts`](../../apps/worker/src/worker.ts), [`apps/worker/src/activity-registry.ts`](../../apps/worker/src/activity-registry.ts)
**Interface:** Worker loop and activity registry; preserve lease ownership and idempotent terminal receipts.
**Package:** @aiengineer/knowledge-worker ([`apps/worker/package.json`](../../apps/worker/package.json))
**Export subpaths:** none declared. Declared metadata; build outputs are not read.
**Declared internal package dependencies:** [acquisition](#acquisition), [application](#application), [chunking](#chunking), [contracts](#contracts), [conversion](#conversion), [documents](#documents), [domain](#domain), [embeddings](#embeddings), [evaluation](#evaluation), [persistence](#persistence), [policy](#policy), [runtime](#runtime), [verification](#verification)
**Other runtime dependencies:** zod
**Reviewed runtime/data relationships:** none declared
**Checks:** [`apps/worker/src/worker.test.ts`](../../apps/worker/src/worker.test.ts), [`apps/worker/src/activity-registry.test.ts`](../../apps/worker/src/activity-registry.test.ts) Package script names: build, dev, start, test, typecheck.

**Architecture and detailed docs:**

- [reference] [`README.md`](../../README.md) — Service boundaries and startup
- [accepted] [`docs/architecture/0001-runtime-and-deployment.md`](../../docs/architecture/0001-runtime-and-deployment.md) — Runtime, transport, and deployment changes
- [reference] [`docs/verification/OPERATOR-RUNBOOK.md`](../../docs/verification/OPERATOR-RUNBOOK.md) — Verification recovery and operator actions
- [reference] [`docs/verification/DEPLOYMENT.md`](../../docs/verification/DEPLOYMENT.md) — Verification deployment and rollback
- [reference] [`docs/operations/runbooks.md`](../../docs/operations/runbooks.md) — Worker restart, leases, callbacks, incidents

## acquisition

**packages/acquisition** · package · implemented

Admitted source acquisition through HTTP, Firecrawl, manual upload, repository, and paper adapters.

**Enter:** [`packages/acquisition/src/index.ts`](../../packages/acquisition/src/index.ts)
**Interface:** Acquisition request/result types and source adapters.
**Package:** @aiengineer/knowledge-acquisition ([`packages/acquisition/package.json`](../../packages/acquisition/package.json))
**Export subpaths:** .. Declared metadata; build outputs are not read.
**Declared internal package dependencies:** [domain](#domain), [runtime](#runtime)
**Other runtime dependencies:** none declared
**Reviewed runtime/data relationships:** none declared
**Checks:** [`packages/acquisition/src/acquisition.test.ts`](../../packages/acquisition/src/acquisition.test.ts), [`packages/acquisition/src/deadline.test.ts`](../../packages/acquisition/src/deadline.test.ts) Package script names: build, test, typecheck.

**Architecture and detailed docs:**

- [accepted] [`docs/architecture/0002-deterministic-preparation.md`](../../docs/architecture/0002-deterministic-preparation.md) — Preparation pipeline

## application

**packages/application** · package · implemented

Composes knowledge use cases, capability admission, preparation, and verification surfaces.

**Enter:** [`packages/application/src/index.ts`](../../packages/application/src/index.ts)
**Interface:** Application service facades and use-case functions; transports call these rather than implementing algorithms.
**Package:** @aiengineer/knowledge-application ([`packages/application/package.json`](../../packages/application/package.json))
**Export subpaths:** .. Declared metadata; build outputs are not read.
**Declared internal package dependencies:** [acquisition](#acquisition), [chunking](#chunking), [contracts](#contracts), [conversion](#conversion), [documents](#documents), [domain](#domain), [embeddings](#embeddings), [evaluation](#evaluation), [policy](#policy), [projections](#projections), [retrieval](#retrieval), [runtime](#runtime), [vector-backends](#vector-backends), [verification](#verification)
**Other runtime dependencies:** zod
**Reviewed runtime/data relationships:** none declared
**Checks:** [`packages/application/src/a2a-adapter.test.ts`](../../packages/application/src/a2a-adapter.test.ts), [`packages/application/src/capability-admission.test.ts`](../../packages/application/src/capability-admission.test.ts) Package script names: build, test, typecheck.

**Architecture and detailed docs:**

- [reference] [`README.md`](../../README.md) — Service boundaries and startup
- [accepted] [`docs/architecture/0002-deterministic-preparation.md`](../../docs/architecture/0002-deterministic-preparation.md) — Preparation pipeline
- [reference] [`docs/verification/README.md`](../../docs/verification/README.md) — Verification behavior and invariants

## chunking

**packages/chunking** · package · implemented

Builds bounded chunks with strategy profiles, overlap controls, and source spans.

**Enter:** [`packages/chunking/src/index.ts`](../../packages/chunking/src/index.ts)
**Interface:** Chunk profiles and deterministic chunk preparation.
**Package:** @aiengineer/knowledge-chunking ([`packages/chunking/package.json`](../../packages/chunking/package.json))
**Export subpaths:** .. Declared metadata; build outputs are not read.
**Declared internal package dependencies:** [contracts](#contracts), [documents](#documents), [domain](#domain)
**Other runtime dependencies:** none declared
**Reviewed runtime/data relationships:** none declared
**Checks:** [`packages/chunking/src/index.test.ts`](../../packages/chunking/src/index.test.ts) Package script names: build, test, typecheck.

**Architecture and detailed docs:**

- [accepted] [`docs/architecture/0002-deterministic-preparation.md`](../../docs/architecture/0002-deterministic-preparation.md) — Preparation pipeline

## client-typescript

**packages/client-typescript** · package · implemented

Typed HTTP client for cross-repository consumers of the Knowledge Services contract.

**Enter:** [`packages/client-typescript/src/index.ts`](../../packages/client-typescript/src/index.ts)
**Interface:** Client methods plus public contract types.
**Package:** @aiengineer/knowledge-client ([`packages/client-typescript/package.json`](../../packages/client-typescript/package.json))
**Export subpaths:** .. Declared metadata; build outputs are not read.
**Declared internal package dependencies:** [contracts](#contracts)
**Other runtime dependencies:** zod
**Reviewed runtime/data relationships:** none declared
**Checks:** [`packages/client-typescript/src/adjudication-decision-read.test.ts`](../../packages/client-typescript/src/adjudication-decision-read.test.ts), [`packages/client-typescript/src/adjudication.test.ts`](../../packages/client-typescript/src/adjudication.test.ts) Package script names: build, test, typecheck.

**Architecture and detailed docs:**

- [reference] [`docs/verification/INTEGRATION-GUIDE.md`](../../docs/verification/INTEGRATION-GUIDE.md) — Cross-service verification integration

## config

**packages/config** · package · implemented

Validates server, authentication, and semantic-provider configuration.

**Enter:** [`packages/config/src/index.ts`](../../packages/config/src/index.ts)
**Interface:** Configuration loaders; do not read or emit environment secrets in docs.
**Package:** @aiengineer/knowledge-config ([`packages/config/package.json`](../../packages/config/package.json))
**Export subpaths:** .. Declared metadata; build outputs are not read.
**Declared internal package dependencies:** [contracts](#contracts)
**Other runtime dependencies:** zod
**Reviewed runtime/data relationships:** none declared
**Checks:** No specific test anchor registered. Package script names: build, test, typecheck.

**Architecture and detailed docs:**

- [accepted] [`docs/architecture/0001-runtime-and-deployment.md`](../../docs/architecture/0001-runtime-and-deployment.md) — Runtime, transport, and deployment changes
- [reference] [`docs/security.md`](../../docs/security.md) — Authentication, capability admission, parser isolation

## contracts

**packages/contracts** · package · implemented

Versioned Zod schemas and types shared by transports, application composition, and clients.

**Enter:** [`packages/contracts/src/index.ts`](../../packages/contracts/src/index.ts)
**Interface:** Public request/result and verification contract schemas.
**Package:** @aiengineer/knowledge-contracts ([`packages/contracts/package.json`](../../packages/contracts/package.json))
**Export subpaths:** .. Declared metadata; build outputs are not read.
**Declared internal package dependencies:** none declared
**Other runtime dependencies:** zod
**Reviewed runtime/data relationships:** none declared
**Checks:** [`packages/contracts/src/contracts.test.ts`](../../packages/contracts/src/contracts.test.ts), [`packages/contracts/src/deployment.test.ts`](../../packages/contracts/src/deployment.test.ts) Package script names: build, generate, test, typecheck.

**Architecture and detailed docs:**

- [reference] [`docs/verification/INTEGRATION-GUIDE.md`](../../docs/verification/INTEGRATION-GUIDE.md) — Cross-service verification integration

## conversion

**packages/conversion** · package · implemented

Converts captured inputs and wraps external Docling and isolated native parser routes.

**Enter:** [`packages/conversion/src/index.ts`](../../packages/conversion/src/index.ts)
**Interface:** Conversion providers, HTTP clients, and SandboxedVerificationParser.
**Package:** @aiengineer/knowledge-conversion ([`packages/conversion/package.json`](../../packages/conversion/package.json))
**Export subpaths:** .. Declared metadata; build outputs are not read.
**Declared internal package dependencies:** [domain](#domain), [runtime](#runtime)
**Other runtime dependencies:** none declared
**Reviewed runtime/data relationships:** none declared
**Checks:** [`packages/conversion/src/conversion.test.ts`](../../packages/conversion/src/conversion.test.ts), [`packages/conversion/src/verification-parser.test.ts`](../../packages/conversion/src/verification-parser.test.ts) Package script names: build, test, typecheck.

**Architecture and detailed docs:**

- [accepted] [`docs/architecture/0002-deterministic-preparation.md`](../../docs/architecture/0002-deterministic-preparation.md) — Preparation pipeline

## db-read

**packages/db-read** · package · partial

Executes knowledge-read-intent.v1 into a digested snapshot under bounded read-only roles, with a SQL guard and artifact ledger.

**Enter:** [`packages/db-read/src/index.ts`](../../packages/db-read/src/index.ts), [`packages/db-read/src/read-executor.ts`](../../packages/db-read/src/read-executor.ts), [`packages/db-read/src/sql-guard.ts`](../../packages/db-read/src/sql-guard.ts)
**Interface:** ReadExecutor.validateIntent/runIntent/sqlReadonly/explain/head; ArtifactLedger persist of intent+snapshot; assertSingleReadStatement admits one SELECT/WITH.
**Package:** @aiengineer/knowledge-db-read ([`packages/db-read/package.json`](../../packages/db-read/package.json))
**Export subpaths:** .. Declared metadata; build outputs are not read.
**Declared internal package dependencies:** [persistence](#persistence), [runtime](#runtime), [schema-workspace](#schema-workspace)
**Other runtime dependencies:** zod
**Reviewed runtime/data relationships:** [schema-workspace](#schema-workspace)
**Checks:** [`packages/db-read/src/db-read.test.ts`](../../packages/db-read/src/db-read.test.ts), [`packages/db-read/src/read-executor.integration.test.ts`](../../packages/db-read/src/read-executor.integration.test.ts) Package script names: build, test, typecheck.
- Retrieval operations are skipped (RETRIEVAL_UNAVAILABLE). Named queries and artifact ops run.

**Architecture and detailed docs:**

- [reference] [`README.md`](../../README.md) — Service boundaries and startup

## documents

**packages/documents** · package · implemented

Constructs immutable document nodes and source locators from structural blocks.

**Enter:** [`packages/documents/src/index.ts`](../../packages/documents/src/index.ts)
**Interface:** Structural document builder and deterministic document identity.
**Package:** @aiengineer/knowledge-documents ([`packages/documents/package.json`](../../packages/documents/package.json))
**Export subpaths:** .. Declared metadata; build outputs are not read.
**Declared internal package dependencies:** [contracts](#contracts), [domain](#domain)
**Other runtime dependencies:** none declared
**Reviewed runtime/data relationships:** none declared
**Checks:** [`packages/documents/src/index.test.ts`](../../packages/documents/src/index.test.ts) Package script names: build, test, typecheck.

**Architecture and detailed docs:**

- [accepted] [`docs/architecture/0002-deterministic-preparation.md`](../../docs/architecture/0002-deterministic-preparation.md) — Preparation pipeline

## domain

**packages/domain** · package · implemented

Shared digest, identity, idempotency, error, authority, and state-machine primitives.

**Enter:** [`packages/domain/src/index.ts`](../../packages/domain/src/index.ts)
**Interface:** Small pure invariants and value helpers.
**Package:** @aiengineer/knowledge-domain ([`packages/domain/package.json`](../../packages/domain/package.json))
**Export subpaths:** .. Declared metadata; build outputs are not read.
**Declared internal package dependencies:** [contracts](#contracts)
**Other runtime dependencies:** none declared
**Reviewed runtime/data relationships:** none declared
**Checks:** [`packages/domain/src/domain.test.ts`](../../packages/domain/src/domain.test.ts) Package script names: build, test, typecheck.

**Architecture and detailed docs:**

No module-specific architecture document registered. Do not infer a design decision from the folder name.

## embeddings

**packages/embeddings** · package · implemented

Embedding adapter requests, cache/route identity, bounded batches, and receipts.

**Enter:** [`packages/embeddings/src/index.ts`](../../packages/embeddings/src/index.ts)
**Interface:** EmbeddingAdapter with discoverModel, embedOne, and embedMany.
**Package:** @aiengineer/knowledge-embeddings ([`packages/embeddings/package.json`](../../packages/embeddings/package.json))
**Export subpaths:** .. Declared metadata; build outputs are not read.
**Declared internal package dependencies:** [domain](#domain)
**Other runtime dependencies:** none declared
**Reviewed runtime/data relationships:** none declared
**Checks:** [`packages/embeddings/src/index.test.ts`](../../packages/embeddings/src/index.test.ts) Package script names: build, test, typecheck.

**Architecture and detailed docs:**

- [accepted] [`docs/architecture/0003-embedding-retrieval-evaluation.md`](../../docs/architecture/0003-embedding-retrieval-evaluation.md) — Embedding, retrieval, evaluation

## ingestion

**packages/ingestion** · package · partial

Deterministic planner and apply of knowledge-ingestion-intent.v1 through temporal.* helpers, with receipts and duplicate handling.

**Enter:** [`packages/ingestion/src/index.ts`](../../packages/ingestion/src/index.ts), [`packages/ingestion/src/plan.ts`](../../packages/ingestion/src/plan.ts), [`packages/ingestion/src/apply.ts`](../../packages/ingestion/src/apply.ts), [`packages/ingestion/src/executor.ts`](../../packages/ingestion/src/executor.ts), [`packages/ingestion/src/duplicate.ts`](../../packages/ingestion/src/duplicate.ts)
**Interface:** IngestionExecutor.plan/apply/receipt; buildPlan; applyPlan inside temporal.begin_batch/assert_*/commit_batch; same idempotency key returns duplicateOf.
**Package:** @aiengineer/knowledge-ingestion ([`packages/ingestion/package.json`](../../packages/ingestion/package.json))
**Export subpaths:** .. Declared metadata; build outputs are not read.
**Declared internal package dependencies:** [db-read](#db-read), [persistence](#persistence), [schema-workspace](#schema-workspace)
**Other runtime dependencies:** zod
**Reviewed runtime/data relationships:** [db-read](#db-read), [schema-workspace](#schema-workspace)
**Checks:** [`packages/ingestion/src/plan.test.ts`](../../packages/ingestion/src/plan.test.ts), [`packages/ingestion/src/duplicate.test.ts`](../../packages/ingestion/src/duplicate.test.ts), [`packages/ingestion/src/executor.integration.test.ts`](../../packages/ingestion/src/executor.integration.test.ts) Package script names: build, test, typecheck.
- Writes orchestration.operation_intent/receipt; does not write a knowledge_service.operation row.

**Architecture and detailed docs:**

- [reference] [`README.md`](../../README.md) — Service boundaries and startup

## evaluation

**packages/evaluation** · package · implemented

Retrieval evaluations, benchmark statistics/comparisons, and human review structures.

**Enter:** [`packages/evaluation/src/index.ts`](../../packages/evaluation/src/index.ts)
**Interface:** Evaluation cases and benchmark/review functions.
**Package:** @aiengineer/knowledge-evaluation ([`packages/evaluation/package.json`](../../packages/evaluation/package.json))
**Export subpaths:** .. Declared metadata; build outputs are not read.
**Declared internal package dependencies:** [contracts](#contracts), [domain](#domain), [verification](#verification)
**Other runtime dependencies:** none declared
**Reviewed runtime/data relationships:** none declared
**Checks:** [`packages/evaluation/src/index.test.ts`](../../packages/evaluation/src/index.test.ts), [`packages/evaluation/src/verification-benchmark-run-comparison.test.ts`](../../packages/evaluation/src/verification-benchmark-run-comparison.test.ts) Package script names: build, test, typecheck.

**Architecture and detailed docs:**

- [accepted] [`docs/architecture/0003-embedding-retrieval-evaluation.md`](../../docs/architecture/0003-embedding-retrieval-evaluation.md) — Embedding, retrieval, evaluation

## observability

**packages/observability** · package · implemented

In-memory operation telemetry, SLO summaries, and manifest reconciliation.

**Enter:** [`packages/observability/src/index.ts`](../../packages/observability/src/index.ts)
**Interface:** InMemoryTelemetry and reconcileManifests; not a full external telemetry deployment.
**Package:** @aiengineer/knowledge-observability ([`packages/observability/package.json`](../../packages/observability/package.json))
**Export subpaths:** .. Declared metadata; build outputs are not read.
**Declared internal package dependencies:** [domain](#domain)
**Other runtime dependencies:** none declared
**Reviewed runtime/data relationships:** none declared
**Checks:** [`packages/observability/src/index.test.ts`](../../packages/observability/src/index.test.ts) Package script names: build, test, typecheck.

**Architecture and detailed docs:**

- [accepted] [`docs/architecture/0003-embedding-retrieval-evaluation.md`](../../docs/architecture/0003-embedding-retrieval-evaluation.md) — Embedding, retrieval, evaluation
- [reference] [`docs/operations/runbooks.md`](../../docs/operations/runbooks.md) — Worker restart, leases, callbacks, incidents

## persistence

**packages/persistence** · package · implemented

Postgres, storage, operation ledger, verification records, and runtime wiring adapters.

**Enter:** [`packages/persistence/src/index.ts`](../../packages/persistence/src/index.ts)
**Interface:** Persistence implementations; schema migrations remain in the database-contract repository.
**Package:** @aiengineer/knowledge-persistence ([`packages/persistence/package.json`](../../packages/persistence/package.json))
**Export subpaths:** .. Declared metadata; build outputs are not read.
**Declared internal package dependencies:** [application](#application), [contracts](#contracts), [domain](#domain), [runtime](#runtime), [verification](#verification)
**Other runtime dependencies:** @aiengineer/database-contract, pg, zod
**Reviewed runtime/data relationships:** none declared
**Checks:** [`packages/persistence/src/eve-verification-binding.test.ts`](../../packages/persistence/src/eve-verification-binding.test.ts), [`packages/persistence/src/operation-service.test.ts`](../../packages/persistence/src/operation-service.test.ts) Package script names: build, test, typecheck.

**Architecture and detailed docs:**

- [reference] [`docs/verification/OPERATOR-RUNBOOK.md`](../../docs/verification/OPERATOR-RUNBOOK.md) — Verification recovery and operator actions
- [reference] [`docs/operations/runbooks.md`](../../docs/operations/runbooks.md) — Worker restart, leases, callbacks, incidents

## policy

**packages/policy** · package · implemented

Authorization, capability, retrieval, promotion, and verification admission decisions.

**Enter:** [`packages/policy/src/index.ts`](../../packages/policy/src/index.ts)
**Interface:** Policy functions; successful execution alone does not authorize publication.
**Package:** @aiengineer/knowledge-policy ([`packages/policy/package.json`](../../packages/policy/package.json))
**Export subpaths:** .. Declared metadata; build outputs are not read.
**Declared internal package dependencies:** [contracts](#contracts), [domain](#domain), [verification](#verification)
**Other runtime dependencies:** none declared
**Reviewed runtime/data relationships:** none declared
**Checks:** [`packages/policy/src/policy.test.ts`](../../packages/policy/src/policy.test.ts), [`packages/policy/src/verification-policy.test.ts`](../../packages/policy/src/verification-policy.test.ts) Package script names: build, test, typecheck.

**Architecture and detailed docs:**

- [accepted] [`docs/architecture/0003-embedding-retrieval-evaluation.md`](../../docs/architecture/0003-embedding-retrieval-evaluation.md) — Embedding, retrieval, evaluation
- [reference] [`docs/verification/README.md`](../../docs/verification/README.md) — Verification behavior and invariants
- [reference] [`docs/security.md`](../../docs/security.md) — Authentication, capability admission, parser isolation

## projections

**packages/projections** · package · implemented

Produces domain projections whose assertions remain bound to source evidence.

**Enter:** [`packages/projections/src/index.ts`](../../packages/projections/src/index.ts)
**Interface:** EvidenceSupport and supported projection construction.
**Package:** @aiengineer/knowledge-projections ([`packages/projections/package.json`](../../packages/projections/package.json))
**Export subpaths:** .. Declared metadata; build outputs are not read.
**Declared internal package dependencies:** [contracts](#contracts), [documents](#documents), [domain](#domain)
**Other runtime dependencies:** none declared
**Reviewed runtime/data relationships:** none declared
**Checks:** [`packages/projections/src/index.test.ts`](../../packages/projections/src/index.test.ts) Package script names: build, test, typecheck.

**Architecture and detailed docs:**

- [accepted] [`docs/architecture/0002-deterministic-preparation.md`](../../docs/architecture/0002-deterministic-preparation.md) — Preparation pipeline

## retrieval

**packages/retrieval** · package · implemented

Plans and executes policy-scoped lexical, semantic, graph, rerank, and diversity retrieval.

**Enter:** [`packages/retrieval/src/index.ts`](../../packages/retrieval/src/index.ts)
**Interface:** buildRetrievalPlan and retrieval results with stage receipts.
**Package:** @aiengineer/knowledge-retrieval ([`packages/retrieval/package.json`](../../packages/retrieval/package.json))
**Export subpaths:** .. Declared metadata; build outputs are not read.
**Declared internal package dependencies:** [contracts](#contracts), [domain](#domain), [vector-backends](#vector-backends)
**Other runtime dependencies:** none declared
**Reviewed runtime/data relationships:** none declared
**Checks:** [`packages/retrieval/src/index.test.ts`](../../packages/retrieval/src/index.test.ts) Package script names: build, test, typecheck.

**Architecture and detailed docs:**

- [accepted] [`docs/architecture/0003-embedding-retrieval-evaluation.md`](../../docs/architecture/0003-embedding-retrieval-evaluation.md) — Embedding, retrieval, evaluation

## runtime

**packages/runtime** · package · implemented

Content-addressed artifacts and operation/step/lease/event/receipt primitives.

**Enter:** [`packages/runtime/src/index.ts`](../../packages/runtime/src/index.ts)
**Interface:** Artifact stores and ledger interfaces; in-memory implementations are not deployment authority.
**Package:** @aiengineer/knowledge-runtime ([`packages/runtime/package.json`](../../packages/runtime/package.json))
**Export subpaths:** .. Declared metadata; build outputs are not read.
**Declared internal package dependencies:** [contracts](#contracts), [domain](#domain)
**Other runtime dependencies:** none declared
**Reviewed runtime/data relationships:** none declared
**Checks:** [`packages/runtime/src/eve-runtime-attestation.test.ts`](../../packages/runtime/src/eve-runtime-attestation.test.ts), [`packages/runtime/src/runtime.test.ts`](../../packages/runtime/src/runtime.test.ts) Package script names: build, test, typecheck.

**Architecture and detailed docs:**

- [accepted] [`docs/architecture/0002-deterministic-preparation.md`](../../docs/architecture/0002-deterministic-preparation.md) — Preparation pipeline
- [reference] [`docs/operations/runbooks.md`](../../docs/operations/runbooks.md) — Worker restart, leases, callbacks, incidents

## schema-workspace

**packages/schema-workspace** · package · implemented

Loads and searches the pinned db-contract schema workspace, compares migration heads, and materializes scoped bundles.

**Enter:** [`packages/schema-workspace/src/index.ts`](../../packages/schema-workspace/src/index.ts)
**Interface:** loadWorkspace, searchWorkspace, getPage, compareHeads/assertHeadMatches, materializeScope; locate via SCHEMA_WORKSPACE_DIR or the pinned contract workspace/.
**Package:** @aiengineer/knowledge-schema-workspace ([`packages/schema-workspace/package.json`](../../packages/schema-workspace/package.json))
**Export subpaths:** .. Declared metadata; build outputs are not read.
**Declared internal package dependencies:** none declared
**Other runtime dependencies:** @aiengineer/database-contract, zod
**Reviewed runtime/data relationships:** none declared
**Checks:** [`packages/schema-workspace/src/schema-workspace.test.ts`](../../packages/schema-workspace/src/schema-workspace.test.ts) Package script names: build, test, typecheck.
- Consumes the committed workspace tree; it does not regenerate IR from the live database at request time.

**Architecture and detailed docs:**

- [reference] [`README.md`](../../README.md) — Service boundaries and startup

## testkit

**packages/testkit** · package · implemented

Curated evaluation corpora, embedding bundles, retrieval fixtures, and operational test assets.

**Enter:** [`packages/testkit/src/index.ts`](../../packages/testkit/src/index.ts)
**Interface:** Fixture loaders and test helpers; some bundle sources are sibling-repository inputs.
**Package:** @aiengineer/knowledge-testkit ([`packages/testkit/package.json`](../../packages/testkit/package.json))
**Export subpaths:** .. Declared metadata; build outputs are not read.
**Declared internal package dependencies:** [domain](#domain), [evaluation](#evaluation), [retrieval](#retrieval)
**Other runtime dependencies:** none declared
**Reviewed runtime/data relationships:** none declared
**Checks:** [`packages/testkit/src/broad-evaluation-corpus.test.ts`](../../packages/testkit/src/broad-evaluation-corpus.test.ts), [`packages/testkit/src/embedding-bundles.test.ts`](../../packages/testkit/src/embedding-bundles.test.ts) Package script names: build, test, typecheck.

**Architecture and detailed docs:**

- [accepted] [`docs/architecture/0003-embedding-retrieval-evaluation.md`](../../docs/architecture/0003-embedding-retrieval-evaluation.md) — Embedding, retrieval, evaluation

## vector-backends

**packages/vector-backends** · package · implemented

Vector-store adapters and publication handling for exact and Postgres search.

**Enter:** [`packages/vector-backends/src/index.ts`](../../packages/vector-backends/src/index.ts)
**Interface:** Backend types, in-memory exact adapter, and Postgres adapter.
**Package:** @aiengineer/knowledge-vector-backends ([`packages/vector-backends/package.json`](../../packages/vector-backends/package.json))
**Export subpaths:** .. Declared metadata; build outputs are not read.
**Declared internal package dependencies:** [domain](#domain)
**Other runtime dependencies:** none declared
**Reviewed runtime/data relationships:** none declared
**Checks:** [`packages/vector-backends/src/in-memory-exact.test.ts`](../../packages/vector-backends/src/in-memory-exact.test.ts), [`packages/vector-backends/src/postgres.test.ts`](../../packages/vector-backends/src/postgres.test.ts) Package script names: build, test, typecheck.

**Architecture and detailed docs:**

- [accepted] [`docs/architecture/0003-embedding-retrieval-evaluation.md`](../../docs/architecture/0003-embedding-retrieval-evaluation.md) — Embedding, retrieval, evaluation

## verification

**packages/verification** · package · implemented

Evidence verification algorithms behind deterministic, selector, claim, semantic, and provenance facades.

**Enter:** [`packages/verification/src/index.ts`](../../packages/verification/src/index.ts)
**Interface:** Algorithm exports consumed inside Knowledge Services; external callers use public service surfaces.
**Package:** @aiengineer/knowledge-verification ([`packages/verification/package.json`](../../packages/verification/package.json))
**Export subpaths:** .. Declared metadata; build outputs are not read.
**Declared internal package dependencies:** [contracts](#contracts)
**Other runtime dependencies:** none declared
**Reviewed runtime/data relationships:** none declared
**Checks:** [`packages/verification/src/prototype-compat.test.ts`](../../packages/verification/src/prototype-compat.test.ts) Package script names: build, test, typecheck.

**Architecture and detailed docs:**

- [reference] [`docs/verification/README.md`](../../docs/verification/README.md) — Verification behavior and invariants

## verification-deterministic

**packages/verification/src/deterministic** · algorithm module · implemented

Canonical numeric, selector, and mechanical verification checks.

**Enter:** [`packages/verification/src/deterministic/index.ts`](../../packages/verification/src/deterministic/index.ts)
**Interface:** Deterministic engine and exact decimal/canonicalization helpers.
**Package:** not a standalone package
**Export subpaths:** none declared. Declared metadata; build outputs are not read.
**Declared internal package dependencies:** none declared
**Other runtime dependencies:** none declared
**Reviewed runtime/data relationships:** none declared
**Checks:** [`packages/verification/src/deterministic/deterministic.test.ts`](../../packages/verification/src/deterministic/deterministic.test.ts)
- Internal verification seam; do not expose it as a cross-repository import contract.

**Architecture and detailed docs:**

- [reference] [`docs/verification/README.md`](../../docs/verification/README.md) — Verification behavior and invariants

## verification-selectors

**packages/verification/src/selectors** · algorithm module · implemented

Canonical projection models and deterministic source locator resolution.

**Enter:** [`packages/verification/src/selectors/index.ts`](../../packages/verification/src/selectors/index.ts)
**Interface:** Projection parsing and resolvers.
**Package:** not a standalone package
**Export subpaths:** none declared. Declared metadata; build outputs are not read.
**Declared internal package dependencies:** none declared
**Other runtime dependencies:** none declared
**Reviewed runtime/data relationships:** none declared
**Checks:** [`packages/verification/src/selectors/resolvers.test.ts`](../../packages/verification/src/selectors/resolvers.test.ts)
- Internal verification seam; do not expose it as a cross-repository import contract.

**Architecture and detailed docs:**

- [reference] [`docs/verification/README.md`](../../docs/verification/README.md) — Verification behavior and invariants

## verification-extraction

**packages/verification/src/extraction** · algorithm module · implemented

Schema-bound extraction field verification and evidence comparisons.

**Enter:** [`packages/verification/src/extraction/index.ts`](../../packages/verification/src/extraction/index.ts)
**Interface:** verifyExtractionFields and extraction evidence/schema types.
**Package:** not a standalone package
**Export subpaths:** none declared. Declared metadata; build outputs are not read.
**Declared internal package dependencies:** none declared
**Other runtime dependencies:** none declared
**Reviewed runtime/data relationships:** none declared
**Checks:** [`packages/verification/src/extraction/extraction.test.ts`](../../packages/verification/src/extraction/extraction.test.ts)
- Internal verification seam; do not expose it as a cross-repository import contract.

**Architecture and detailed docs:**

- [reference] [`docs/verification/README.md`](../../docs/verification/README.md) — Verification behavior and invariants

## verification-provenance

**packages/verification/src/provenance** · algorithm module · implemented

Verification seals, replay, policy inputs, attestations, and publication bindings.

**Enter:** [`packages/verification/src/provenance/index.ts`](../../packages/verification/src/provenance/index.ts)
**Interface:** Seal/replay/attestation functions over immutable lineage.
**Package:** not a standalone package
**Export subpaths:** none declared. Declared metadata; build outputs are not read.
**Declared internal package dependencies:** none declared
**Other runtime dependencies:** none declared
**Reviewed runtime/data relationships:** none declared
**Checks:** [`packages/verification/src/provenance/attestation.test.ts`](../../packages/verification/src/provenance/attestation.test.ts)
- Internal verification seam; do not expose it as a cross-repository import contract.

**Architecture and detailed docs:**

- [reference] [`docs/verification/README.md`](../../docs/verification/README.md) — Verification behavior and invariants

## verification-claims

**packages/verification/src/claims** · algorithm module · implemented

Claim decomposition and report-level evidence structure.

**Enter:** [`packages/verification/src/claims/index.ts`](../../packages/verification/src/claims/index.ts)
**Interface:** Decomposition and report functions.
**Package:** not a standalone package
**Export subpaths:** none declared. Declared metadata; build outputs are not read.
**Declared internal package dependencies:** none declared
**Other runtime dependencies:** none declared
**Reviewed runtime/data relationships:** none declared
**Checks:** No specific test anchor registered.
- Internal verification seam; do not expose it as a cross-repository import contract.

**Architecture and detailed docs:**

- [reference] [`docs/verification/README.md`](../../docs/verification/README.md) — Verification behavior and invariants

## verification-authority

**packages/verification/src/authority** · algorithm module · implemented

Source authority and corroboration assessments.

**Enter:** [`packages/verification/src/authority/index.ts`](../../packages/verification/src/authority/index.ts)
**Interface:** Authority assessment functions.
**Package:** not a standalone package
**Export subpaths:** none declared. Declared metadata; build outputs are not read.
**Declared internal package dependencies:** none declared
**Other runtime dependencies:** none declared
**Reviewed runtime/data relationships:** none declared
**Checks:** No specific test anchor registered.
- Internal verification seam; do not expose it as a cross-repository import contract.

**Architecture and detailed docs:**

- [reference] [`docs/verification/README.md`](../../docs/verification/README.md) — Verification behavior and invariants

## verification-semantic

**packages/verification/src/semantic** · algorithm module · implemented

Evidence-closed semantic verification, rescue, and attribution checks.

**Enter:** [`packages/verification/src/semantic/index.ts`](../../packages/verification/src/semantic/index.ts)
**Interface:** Semantic verification functions; no reversal of deterministic failure.
**Package:** not a standalone package
**Export subpaths:** none declared. Declared metadata; build outputs are not read.
**Declared internal package dependencies:** none declared
**Other runtime dependencies:** none declared
**Reviewed runtime/data relationships:** none declared
**Checks:** [`packages/verification/src/semantic/diagnostics.test.ts`](../../packages/verification/src/semantic/diagnostics.test.ts)
- Internal verification seam; do not expose it as a cross-repository import contract.

**Architecture and detailed docs:**

- [reference] [`docs/verification/README.md`](../../docs/verification/README.md) — Verification behavior and invariants

## verification-providers

**packages/verification/src/providers** · algorithm module · implemented

Bounded semantic-provider adapters, gateway routes, and provider registry.

**Enter:** [`packages/verification/src/providers/index.ts`](../../packages/verification/src/providers/index.ts)
**Interface:** Semantic judge/provider adapters with explicit limits.
**Package:** not a standalone package
**Export subpaths:** none declared. Declared metadata; build outputs are not read.
**Declared internal package dependencies:** none declared
**Other runtime dependencies:** none declared
**Reviewed runtime/data relationships:** none declared
**Checks:** [`packages/verification/src/providers/gateway-semantic-observation.test.ts`](../../packages/verification/src/providers/gateway-semantic-observation.test.ts)
- Internal verification seam; do not expose it as a cross-repository import contract.

**Architecture and detailed docs:**

- [reference] [`docs/verification/README.md`](../../docs/verification/README.md) — Verification behavior and invariants
- [reference] [`docs/security.md`](../../docs/security.md) — Authentication, capability admission, parser isolation

## docling

**services/docling** · service · implemented

Pinned Docling Serve conversion deployment boundary.

**Enter:** [`services/docling/compose.yaml`](../../services/docling/compose.yaml), [`services/docling/README.md`](../../services/docling/README.md)
**Interface:** Conversion HTTP service behind the TypeScript adapter.
**Package:** not a standalone package
**Export subpaths:** none declared. Declared metadata; build outputs are not read.
**Declared internal package dependencies:** none declared
**Other runtime dependencies:** none declared
**Reviewed runtime/data relationships:** [conversion](#conversion)
**Checks:** No specific test anchor registered.
- Docling is not orchestration or publication authority.

**Architecture and detailed docs:**

- [accepted] [`docs/architecture/0001-runtime-and-deployment.md`](../../docs/architecture/0001-runtime-and-deployment.md) — Runtime, transport, and deployment changes
- [reference] [`docs/verification/DEPLOYMENT.md`](../../docs/verification/DEPLOYMENT.md) — Verification deployment and rollback

## verification-parser

**services/verification-parser** · service · implemented

Isolated native PDF geometry and HTML DOM parser; separate from Docling and OCR.

**Enter:** [`services/verification-parser/parser.py`](../../services/verification-parser/parser.py), [`services/verification-parser/Dockerfile`](../../services/verification-parser/Dockerfile)
**Interface:** Bounded stdin/stdout parser job invoked by SandboxedVerificationParser.
**Package:** not a standalone package
**Export subpaths:** none declared. Declared metadata; build outputs are not read.
**Declared internal package dependencies:** none declared
**Other runtime dependencies:** none declared
**Reviewed runtime/data relationships:** [conversion](#conversion)
**Checks:** No specific test anchor registered.
- Selectors never start processes. Deployment configuration, not request input, selects the admitted image.

**Architecture and detailed docs:**

- [reference] [`docs/verification/DEPLOYMENT.md`](../../docs/verification/DEPLOYMENT.md) — Verification deployment and rollback
- [reference] [`docs/security.md`](../../docs/security.md) — Authentication, capability admission, parser isolation

## script-proofs

**scripts** · scripts · implemented

Targeted durability, transport, recovery, and integration proof executables.

**Enter:** [`scripts/prove-durable-preparation.ts`](../../scripts/prove-durable-preparation.ts), [`scripts/prove-verification-service-worker.ts`](../../scripts/prove-verification-service-worker.ts)
**Interface:** Explicit one-off proof scripts; inspect each script's prerequisites and effects before running.
**Package:** not a standalone package
**Export subpaths:** none declared. Declared metadata; build outputs are not read.
**Declared internal package dependencies:** none declared
**Other runtime dependencies:** none declared
**Reviewed runtime/data relationships:** [worker](#worker), [application](#application), [persistence](#persistence)
**Checks:** No specific test anchor registered.
- Names such as prove do not imply read-only or offline behavior. This map never executes them.

**Architecture and detailed docs:**

- [reference] [`docs/verification/OPERATOR-RUNBOOK.md`](../../docs/verification/OPERATOR-RUNBOOK.md) — Verification recovery and operator actions

## script-evaluation

**scripts** · scripts · implemented

Corpus/bundle evaluation and review sampling helpers.

**Enter:** [`scripts/evaluate-real-bundles.ts`](../../scripts/evaluate-real-bundles.ts), [`scripts/evaluate-broad-corpus.ts`](../../scripts/evaluate-broad-corpus.ts)
**Interface:** Evaluation scripts; distinguish deterministic fixtures from live provider evaluations.
**Package:** not a standalone package
**Export subpaths:** none declared. Declared metadata; build outputs are not read.
**Declared internal package dependencies:** none declared
**Other runtime dependencies:** none declared
**Reviewed runtime/data relationships:** [evaluation](#evaluation), [testkit](#testkit)
**Checks:** No specific test anchor registered.

**Architecture and detailed docs:**

No module-specific architecture document registered. Do not infer a design decision from the folder name.

## script-reconciliation

**scripts** · scripts · implemented

Provider accounting and reconciliation operations.

**Enter:** [`scripts/reconcile-verification-gateway-costs.ts`](../../scripts/reconcile-verification-gateway-costs.ts), [`scripts/reconcile-verification-provider-live.ts`](../../scripts/reconcile-verification-provider-live.ts)
**Interface:** Operator scripts with explicit provider/database preconditions.
**Package:** not a standalone package
**Export subpaths:** none declared. Declared metadata; build outputs are not read.
**Declared internal package dependencies:** none declared
**Other runtime dependencies:** none declared
**Reviewed runtime/data relationships:** [persistence](#persistence), [verification](#verification)
**Checks:** No specific test anchor registered.
- Do not treat these scripts as routine documentation-generation commands.

**Architecture and detailed docs:**

- [reference] [`docs/verification/OPERATOR-RUNBOOK.md`](../../docs/verification/OPERATOR-RUNBOOK.md) — Verification recovery and operator actions

## script-experiments

**scripts/experiments** · experiment · partial

Curated model-card verification experiments; run results are not canonical architecture.

**Enter:** [`scripts/experiments/model-card-verification/README.md`](../../scripts/experiments/model-card-verification/README.md)
**Interface:** Experiment-specific instructions and selected entry points; outputs stay excluded.
**Package:** not a standalone package
**Export subpaths:** none declared. Declared metadata; build outputs are not read.
**Declared internal package dependencies:** none declared
**Other runtime dependencies:** none declared
**Reviewed runtime/data relationships:** [verification](#verification)
**Checks:** No specific test anchor registered.

**Architecture and detailed docs:**

No module-specific architecture document registered. Do not infer a design decision from the folder name.

## skill-schema-explore

**skills/schema-explore** · skill · implemented

Progressive-disclosure procedure for navigating the pinned schema workspace without querying the database.

**Enter:** [`skills/schema-explore/SKILL.md`](../../skills/schema-explore/SKILL.md)
**Interface:** schema-explore skill: knowledge schema search/get/manifest/materialize; MCP schema_* equivalents.
**Package:** not a standalone package
**Export subpaths:** none declared. Declared metadata; build outputs are not read.
**Declared internal package dependencies:** none declared
**Other runtime dependencies:** none declared
**Reviewed runtime/data relationships:** [schema-workspace](#schema-workspace), [verification-executor](#verification-executor)
**Checks:** No specific test anchor registered.
- Does not query the database; use knowledge-db.

**Architecture and detailed docs:**

No module-specific architecture document registered. Do not infer a design decision from the folder name.

## skill-knowledge-db

**skills/knowledge-db** · skill · implemented

Procedure for catalog reads and reproducible knowledge-read snapshots that an ingestion intent can cite.

**Enter:** [`skills/knowledge-db/SKILL.md`](../../skills/knowledge-db/SKILL.md)
**Interface:** knowledge-db skill: knowledge db head/read-intent/sql/explain and artifact get; MCP db_* / artifact_get.
**Package:** not a standalone package
**Export subpaths:** none declared. Declared metadata; build outputs are not read.
**Declared internal package dependencies:** none declared
**Other runtime dependencies:** none declared
**Reviewed runtime/data relationships:** [db-read](#db-read), [verification-executor](#verification-executor)
**Checks:** No specific test anchor registered.
- Never writes; catalog queries are evidence, ad-hoc SQL is not.

**Architecture and detailed docs:**

No module-specific architecture document registered. Do not infer a design decision from the folder name.

## skill-knowledge-ingest

**skills/knowledge-ingest** · skill · implemented

Procedure for composing, planning, applying, and verifying knowledge-ingestion intents through the executor.

**Enter:** [`skills/knowledge-ingest/SKILL.md`](../../skills/knowledge-ingest/SKILL.md)
**Interface:** knowledge-ingest skill: knowledge ingest plan/apply/receipt; MCP ingest_* / artifact_get.
**Package:** not a standalone package
**Export subpaths:** none declared. Declared metadata; build outputs are not read.
**Declared internal package dependencies:** none declared
**Other runtime dependencies:** none declared
**Reviewed runtime/data relationships:** [ingestion](#ingestion), [verification-executor](#verification-executor)
**Checks:** No specific test anchor registered.
- The agent never writes SQL; the executor writes as executor_service.

**Architecture and detailed docs:**

No module-specific architecture document registered. Do not infer a design decision from the folder name.
<!-- END GENERATED: semantic-map -->
