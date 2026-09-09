# Agentic Knowledge Preparation and Retrieval Service Specification

Status: authoritative implementation specification  
Target repository/service family: `ai-engineer-knowledge-services`  
Primary service consumers: `ai-engineer-mission-control` and the Eve-based research-ingestion service  
Database contract owner: `ai-engineer-db-contract`  
Primary research workspace: `ai-engineer-industry-cloud-automated-research`  
Initial vector backend: Supabase Postgres with `pgvector`  
Initial embedding route: Vercel AI Gateway  
Phase: standalone prototype followed by research-ingestion and Mission Control integrations

## 1. Purpose and authority

This document defines the complete service that acquires, converts, inspects, structures, vets, chunks, embeds, stores, retrieves, evaluates, promotes, supersedes, and reconciles technical knowledge for the AI Engineer system.

The service is deliberately agentic and deterministic at different boundaries:

- models inspect content, propose classifications, select strategies, author supported derived content, construct representative evaluation queries, and recommend promotion;
- deterministic application services validate those proposals, execute conversions and embeddings, enforce authorization and policy, write canonical state, run retrieval experiments, calculate metrics, and produce immutable receipts;
- human reviewers decide cases that policy does not authorize for automatic promotion;
- neither a model recommendation nor a vector similarity score is authority by itself.

This specification is implementable before Mission Control exists. The standalone service must expose stable contracts and preserve the identities required for later attachment to Mission Control work items, attempts, artifacts, approvals, policies, and receipts. Integration must not require rewriting the knowledge model or re-ingesting accepted content.

Where this document conflicts with an earlier retrieval prototype, this document governs the new service. Where it references canonical entity, evidence, orchestration, retrieval, or evaluation records, the database contract repository remains the schema authority.

## 2. Service, repository and orchestration boundaries

### 2.1 Independent knowledge-services monorepo

The knowledge-preparation, vector-store, vector-publication and retrieval bounded context lives in its own `ai-engineer-knowledge-services` monorepo with multiple independently deployable processes. It is not an internal package of Mission Control and is not embedded inside the Eve-based research-ingestion repository. The separate repository boundary is required because multiple runtimes and future users consume the same canonical document, vector-space, retrieval, evidence and evaluation capabilities and must not implement competing publication paths.

The repository owns the official AI Engineer knowledge/vector API namespace, durable workers, MCP facade, operator CLI, A2A contracts, versioned agent skills, TypeScript client, provider adapters, retrieval engine, evaluators, runbooks and service-specific tests. It is one bounded context of the AI Engineer product, not a second competing platform. `ai-engineer-db-contract` remains the authority for shared database schemas, migrations, grants/RLS tests and generated database types. Consumer repositories may depend on published contracts and clients but must not copy the knowledge-service implementation or write its canonical tables and vector publications directly.

### 2.2 Relationship to Mission Control

The Mission Control implementation specification defines durable missions, immutable artifacts, agent-authored ingestion intent, deterministic execution, approvals, receipts, and global reconciliation. This service implements the knowledge-preparation and retrieval bounded context used by those missions.

Before Mission Control exists, the service owns a minimal standalone job and review lifecycle. After integration:

- Mission Control owns mission, execution, work-item, attempt, approval, human-input, intervention, artifact-transfer, and cross-module reconciliation lifecycles;
- this service owns content acquisition records, document identity and versions, representations, transformations, document structure, chunk sets, retrieval projections, embedding runs, vector publication, retrieval plans and runs, evidence packets, and retrieval evaluation;
- Mission Control calls this service through versioned application contracts and receives compact results plus artifact or evidence-packet handles;
- this service accepts Mission Control correlation identifiers but does not infer or mutate mission status;
- standalone job identifiers remain valid lineage after attachment to a mission attempt.

The service must therefore support nullable integration references initially:

- `mission_id`;
- `mission_execution_id`;
- `work_item_id`;
- `attempt_id`;
- `approval_requirement_id`;
- `operation_intent_id`;
- `operation_receipt_id`.

They become required for mission-dispatched canonical work after integration.

Mission Control is the cross-runtime control plane for the initial Cursor Cloud Agent and Temporal execution lane. It may dispatch a complete knowledge operation, wait for its compact result, associate returned artifacts/receipts/evidence packets with a work-item attempt, authorize a guarded publication decision, cancel externally owned work, and reconcile cross-service state. It does not absorb the knowledge workers, duplicate vector operations, proxy every retrieval query, or reinterpret provider-native progress as canonical knowledge state.

### 2.3 Relationship to the Eve research-ingestion service

The Eve-based research-ingestion system is a peer service and first-class consumer of this knowledge service. Its repository owns Eve agents, prompts, tools, subagents, internal Vercel Workflows, research-specific contracts, deterministic research processors and agent evaluations. It does not own document conversion infrastructure, canonical chunk/vector identities, vector-space publication, general retrieval execution or evidence-packet storage.

The research-ingestion service may use the knowledge service in three supported ways:

1. its deterministic Vercel Workflow steps call the versioned HTTP API through the published TypeScript client;
2. Eve agents receive bounded knowledge tools through the remote MCP server when model-directed tool selection is appropriate;
3. Eve agent deployments install versioned knowledge skills that explain the correct workflow, authority boundaries, evidence handling and abstention behavior while ultimately invoking the same API or MCP application contracts.

An Eve/Vercel run may call the knowledge service directly. It does not need Mission Control to act as a data-plane proxy. When the Eve run is part of a Mission Control mission, it propagates the supplied tenant, work-item, attempt, correlation, causation and operation-intent identifiers. When it is standalone, mission references remain null and the knowledge service creates its own durable operation identity. In both cases, idempotency, authorization and publication rules are identical.

### 2.4 Ownership and supported call paths

| System | Owns | Does not own |
|---|---|---|
| Mission Control repository/service | canonical mission lifecycle, Temporal orchestration, Cursor Cloud execution adapters, cross-runtime policy/approval, intervention and global reconciliation | knowledge conversion/retrieval internals, Eve agent implementations, canonical vector publication code |
| Research-ingestion repository/service | Eve agents and tools, Vercel Workflow execution, research discovery/synthesis/verification logic, research-specific proposals and evals | Mission Control state, shared document/vector identities, direct canonical vector writes |
| Knowledge-service repository/service | acquisition/conversion adapters, normalized documents, chunks/projections, embeddings, vector spaces, retrieval/evidence packets, knowledge evaluation and publication receipts | mission status, Cursor run state, Eve session/turn state, research-pipeline orchestration |
| Database-contract repository | shared additive migrations, schema contracts, grants/RLS tests and generated database types | runtime orchestration or service business logic |
| `agents_dashboard` | operator UI for mission commands, approvals, interventions and output inspection | canonical mission transitions, knowledge/vector writes or workflow execution |
| `aiengineerapp` | first learner/user-facing web client of the product and knowledge contracts | knowledge/vector backend authority or a web-only alternate contract |
| `research_starter_pre_research_agent` | retained specialized preliminary-research workflow using its existing model-credit path | production Mission Control, advanced Eve ingestion or canonical vector publication |

Supported high-level flows are:

```text
Cursor Cloud Agent <-skills/MCP/API-> Mission Control <-HTTP/activity-> Knowledge Service

Mission Control <-external-run contract-> Eve/Vercel Research Ingestion
                                           |
                                           +--TypeScript client/API--> Knowledge Service
                                           +--skills + remote MCP----> Knowledge Service

Standalone Eve/Vercel Research Ingestion --TypeScript client/API or MCP--> Knowledge Service
```

The HTTP API is authoritative for deterministic service-to-service operations. MCP is an authenticated agent-tool facade, skills are versioned operating instructions plus contract-aware usage patterns, CLI is the operator/developer peer, and A2A contracts support admitted agent-to-agent operations. Web and future mobile surfaces are clients of these contracts. None creates an alternative business-logic or authorization path.

## 3. Settled architectural decisions

1. Postgres is the authoritative relational catalog and control ledger. Supabase Storage buckets store immutable raw and derivative artifacts. Supabase Postgres with `pgvector` is the initial canonical vector backend.
2. Supabase Vector Buckets are represented behind an adapter and may receive shadow writes for evaluation, but their public-alpha status prevents them from being the initial canonical backend.
3. Vercel AI Gateway is the embedding gateway. `openai/text-embedding-3-small` at 1,536 dimensions is the initial candidate, not an unchangeable permanent choice. A vector-space version freezes the exact admitted embedding identity.
4. A model may propose content for embedding and recommend its domain, schema, representation, chunk strategy, embedding strategy, evaluation set, and promotion. A model cannot directly publish a canonical vector-space version or bypass validation, evaluation, policy, or approval.
5. External authored content and agent-derived content follow different admission rules. Faithful representations are evaluated for authenticity and conversion fidelity; derived content is additionally evaluated for evidence support and semantic faithfulness.
6. Raw captures, document versions, representations, chunks, retrieval projections, embeddings, and canonical knowledge records are separate identities.
7. Embeddings do not live as configuration columns scattered across entity tables. Purpose-specific retrieval projections and embeddings are versioned in the retrieval bounded context and point to canonical typed records.
8. Retrieval returns typed results and immutable evidence packets, not unexplained `topK` chunks.
9. Advanced retrieval is hybrid and staged: intent classification, hard-filter extraction, lexical retrieval, semantic retrieval, rank fusion, graph expansion, optional reranking, parent/neighbor expansion, freshness and contradiction checks, evidence gating, and packet assembly.
10. Retrieval quality is a release property. Every promoted vector-space version must be bound to a versioned evaluation dataset and passing promotion-gate result.
11. Models may author representative queries and relevance proposals, but deterministic checks and independent review prevent self-authored evaluations from automatically approving the system that generated them.
12. Unstructured Transform is the initial preferred managed structural document converter. A pinned self-hosted Docling Serve deployment is the fallback, reproducibility reference, and provider-outage route. Both are accessed behind a TypeScript-owned, versioned conversion-provider contract; neither provider owns canonical orchestration, chunk identity, embeddings, evaluation, promotion, or publication. Format-specific deterministic parsers and human-reviewed fallbacks remain first-class.
13. Firecrawl, Tavily, direct HTTP, browser capture, Git, paper-index, and transcript adapters are acquisition providers. Their outputs are observations and artifacts, not promotion decisions.
14. Chunking is content- and purpose-aware. Fixed character windows are a bounded fallback, never the universal policy.
15. Code retrieval uses repository- and AST-aware implementation examples. Arbitrary scraped code blocks are not automatically canonical code examples.
16. General entity search uses exact identifiers, aliases, full-text search, trigram similarity, filters, and semantic profiles together. Semantic search complements rather than replaces relational and lexical search.
17. Supabase automatic-embedding guidance may inform batching and retry behavior, but database triggers, `pgmq`, `pg_cron`, or Edge Functions must not become a second canonical orchestrator beside this service or Temporal.
18. All canonical writes are idempotent, append-oriented, tenant-scoped, auditable, and accompanied by verification.
19. `ai-engineer-knowledge-services` is a separate monorepo and independently deployed peer service family. Mission Control, the Eve research-ingestion system, web applications and future user-facing agents consume its published TypeScript client, HTTP API, remote MCP server, A2A contracts and versioned skills; no consumer owns or duplicates the canonical vector-publication path.
20. The monorepo starts as shared TypeScript application/domain packages with only three required deployment boundaries: API/MCP entry points, a durable knowledge worker, and pinned Docling Serve. Retrieval, evaluation and reconciliation become separate deployments only when measured scaling, isolation, runtime or release needs justify the split.
21. Vector-store identity supports `official_canonical`, `internal_exploratory` and `user_managed` store classes from the schema boundary. The first production slice implements official and exploratory behavior; the advanced user-managed lifecycle and product UI are deferred without requiring a later identity/schema rewrite.

## 4. Goals

The service must enable users and agents to:

- retrieve major engineering claims and insights and follow them to the engineer, talk, paper, evidence, related solution pattern, and implementation;
- find libraries and tools for a feature, technical problem, or use case with compatibility, maintenance, license, maturity, and evidence context;
- retrieve verified coding snippets and implementation examples by intent, API, language, runtime, framework, dependency, and solution pattern;
- retrieve faithful sections and supported summaries of papers and case studies, including methods, results, limitations, tables, figures, and related implementations;
- find and disambiguate people, organizations, repositories, libraries, products, models, benchmarks, papers, talks, concepts, and protocols through general and semantic entity search;
- find model versions for a use case using structured constraints and evidence-backed capability profiles;
- find benchmarks that measure a task, understand their methods and limitations, and connect model-version results to exact benchmark and dataset versions;
- perform cross-domain GraphRAG-style expansion from a technical problem through claims, solutions, tools, examples, models, benchmarks, papers, engineers, and organizations;
- explain why every canonical item was embedded and why every retrieval result was returned;
- measure retrieval quality, faithfulness, recall, accuracy, citation correctness, constraint satisfaction, latency, and cost before promotion and after change;
- later allow users and authorized agents to create, configure, populate, evaluate, query, retain and delete tenant-scoped vector stores without weakening the separate governance of official proprietary knowledge.

## 5. Non-goals for the first production slice

- A general web search engine is not being built.
- Vector similarity is not a substitute for canonical entity resolution, claim verification, relational filters, or policy.
- The service does not automatically accept every fetched page, document, code block, or model-generated summary.
- The service does not provide a generic arbitrary-SQL tool to ordinary agents.
- Fully autonomous canonical publication without policy evidence is deferred.
- A separate graph database is not required for the first slice. Typed Postgres relationships and bounded recursive expansion are sufficient until measured scale justifies another backend.
- Supabase Vector Buckets are not required for correctness.
- Multimodal image and audio embeddings are deferred, although their artifacts and representations must be modelable.
- The first version does not promise one ranking function across incompatible result types.
- The first version does not fine-tune an embedding or reranking model.
- The first slice does not require the complete user-managed vector-store UI, billing or self-service quota product, but its store/owner/tenant/project identities and lifecycle classes must already support that later stage.

## 6. Canonical terminology

| Term | Meaning |
|---|---|
| source | Stable external acquisition identity such as a URL pattern, API, repository, PDF endpoint, transcript source, or registry |
| source capture | Immutable observation of bytes or provider output obtained at a time |
| document | Stable authored or published intellectual object such as a paper, article, specification, documentation page, report, tutorial, transcript, or README |
| document version | A specific edition, revision, commit-bound state, or content version of a document |
| representation | An immutable rendering, normalization, structural extraction, semantic derivation, or retrieval projection of a document version |
| transformation | Versioned execution mapping one or more artifacts or representations to one or more output representations |
| document node | Ordered structural element such as heading, paragraph, list, table, figure, formula, code block, citation, or transcript segment |
| chunk set | Immutable output of one chunking procedure over one representation for one retrieval purpose |
| retrieval chunk | A reconstructable retrieval unit covering one or more document-node spans |
| retrieval projection | Exact text or other input presented to lexical indexing or an embedding model |
| vector space | Named retrieval purpose such as engineering claims or model capabilities |
| vector-space version | Immutable combination of projection procedure, embedding identity, dimensions, distance metric, backend, filters, and promotion evidence |
| vector item | Authoritative catalog record for one embedded projection of one typed source record or chunk |
| vector store | Tenant- and optionally project-scoped managed collection of one or more compatible vector spaces, documents, policies and lifecycle state |
| store class | Authority class controlling lifecycle and policy: `official_canonical`, `internal_exploratory`, or `user_managed` |
| promotion candidate | Content, chunk set, projection, or vector-space version proposed for a more authoritative lifecycle state |
| promotion decision | Durable policy or human decision, reason, guarded digest, evidence, and target state |
| retrieval plan | Validated declarative request describing intent, spaces, decomposition, filters, algorithms, limits, and authorization |
| retrieval candidate | One item observed during a retrieval stage with stage-specific scores and reasons |
| evidence packet | Immutable, policy-filtered retrieval product containing canonical records, locators, provenance, scores, freshness, contradictions, and coverage roles |
| canonical | Approved for product-facing authoritative retrieval within its declared meaning; not a claim that every source statement is objectively true |
| exploratory | Searchable only in explicitly authorized research or evaluation contexts |
| faithful representation | Transformation intended to preserve authored meaning and structure without adding substantive claims |
| derived content | Model- or rule-produced summary, claim, contextualization, classification, or other semantic transformation |

## 7. Service and repository topology

The dedicated `ai-engineer-knowledge-services` repository is a TypeScript monorepo organized as a modular monolith that can split by deployment process without splitting contracts or duplicating business rules:

```text
apps/
  api/                      official knowledge/vector HTTP API
  mcp/                      remote bounded MCP server
  worker/                   durable knowledge-operation worker
  cli/                      operator/developer CLI
  review/                   optional review/operator surface
services/
  docling/                  pinned Docling Serve deployment
packages/
  contracts/                OpenAPI, JSON Schema, events and A2A DTOs
  client-typescript/        published client for services and applications
  application/              use cases and transaction boundaries
  domain/                   documents, stores, chunks, spaces and publications
  policy/                   authorization, admission and promotion gates
  acquisition/              HTTP, upload, Firecrawl, paper and repository adapters
  conversion/               Unstructured and Docling provider adapters
  documents/                representations, nodes, locators and inspection
  chunking/                 strategy registry and QA
  projections/              domain projectors and support validation
  embeddings/               AI Gateway adapter and caches
  vector-backends/          pgvector canonical and future backend adapters
  retrieval/                lexical/vector fusion, graph, rerank and packets
  evaluation/               datasets, metrics, judges and experiments
  runtime/                  operations, leases, outbox and reconciliation
  observability/            telemetry and cost
  testkit/                  fixtures, fakes and golden comparisons
skills/
  knowledge-acquisition-and-vetting/
  knowledge-preparation-and-promotion/
  knowledge-retrieval-and-evidence/
  knowledge-evaluation/
  vector-store-management/
catalog/
  acquisition-profiles/
  conversion-profiles/
  chunking-profiles/
  embedding-profiles/
  retrieval-policies/
  evaluation-gates/
  domain-projection-procedures/
```

Published integration artifacts must include:

- `@ai-engineer/knowledge-contracts`;
- `@ai-engineer/knowledge-client`;
- `@ai-engineer/knowledge-agent-skill`;
- an OpenAPI document;
- MCP tool schemas;
- A2A task/artifact schemas for admitted agent-to-agent operations;
- JSON Schemas for all model-authored proposals and deterministic receipts.

Repository separation does not create a second product platform. The API, MCP, CLI, A2A and skills are the official AI Engineer knowledge/vector domain surfaces and share the same application services and authorization rules. `aiengineerapp`, Mission Control, Eve services and future clients consume these artifacts rather than implementing web-only or runtime-specific alternatives.

## 8. System boundaries and identities

### 8.1 Service owns

- source acquisition requests, provider observations, captures, and acquisition receipts;
- document identity proposals and accepted document/version links;
- transformations, representations, structural nodes, conversion evaluations, and repair lineage;
- chunk profiles, chunk sets, chunks, spans, edges, metadata, and validation;
- vector-store identity, tenant/project ownership, store class, configuration, quotas, retention/deletion lifecycle and authorization policy;
- retrieval projections, embedding jobs and runs, vector items, backend writes, and verification;
- content and vector-space promotion evaluation and decisions;
- retrieval planning, execution, candidates, graph expansion, reranking, evidence packets, and retrieval audit;
- retrieval evaluation datasets, generated query proposals, human labels, judge runs, metrics, gates, and regressions;
- API, CLI, MCP, A2A, agent skill, review UI, metrics, and standalone jobs.

### 8.2 Service does not own

- canonical mission state after Mission Control integration;
- arbitrary mutation of corpus, evidence, or knowledge records outside admitted deterministic adapters;
- external provider truth;
- model-provider conversation state;
- user authentication source of truth;
- raw secret values in configuration or artifacts.

### 8.3 Required service identities

| Identity | Minimum authority |
|---|---|
| `knowledge_api` | Application-service operations; no unrestricted table access exposed to callers |
| `knowledge_worker` | Lease jobs and record deterministic transformations and retrieval runs |
| `acquisition_executor` | Network access under an admitted acquisition profile; write capture artifacts only |
| `conversion_executor` | Read admitted captures; write derivative representations and receipts |
| `inspection_agent` | Read signed artifacts and metadata; author proposals and findings only |
| `content_curator_agent` | Author classification, schema, chunking, projection, eval-query, and promotion proposals |
| `embedding_executor` | Resolve AI Gateway secret, create admitted embeddings, write only through vector adapter |
| `retrieval_executor` | Execute validated retrieval plans and assemble evidence packets |
| `evaluation_executor` | Execute frozen datasets and graders; no promotion-decision authority |
| `human_reviewer` | Decide assigned review and promotion tasks |
| `mission_control_client` | Dispatch scoped jobs and read handles/results under mission-bound token |
| `retention_worker` | Apply policy-driven expiry or archive actions without semantic mutation |

Ordinary agent identities receive no Supabase service-role key, direct vector write credential, bucket list permission, or approval authority.

## 9. Retrieval product model

The platform recognizes three vector-store classes behind the same processing and retrieval engine:

| Store class | Purpose | Authority and first-slice status |
|---|---|---|
| `official_canonical` | proprietary AI Engineer knowledge produced by the research/ingestion flywheel and used by official learning and agent surfaces | strict evidence, review/evaluation and guarded publication; implemented first |
| `internal_exploratory` | provisional research recall, experiments and evaluation that must remain structurally excluded from authoritative answers unless explicitly selected | explicit labeling and narrower authorization; implemented first |
| `user_managed` | future tenant/project-owned documents, notes and custom vector stores | identity, isolation and lifecycle modeled now; full self-service product deferred |

Store classes share conversion, chunking, embedding, backend and retrieval components but never silently share authority. Promotion from user-managed or exploratory material into official knowledge requires a new admitted representation/projection and the complete official evidence and publication gates. Deletion of a user-managed store cannot erase independently authorized official provenance, and official content is never copied into a user store without an explicit access and licensing basis.

The product supports four result families:

1. **Entity discovery** returns canonical entity profiles and disambiguation evidence.
2. **Knowledge evidence** returns verified claims, supported findings, document sections, and provenance.
3. **Decision support** returns tools, libraries, model versions, benchmarks, constraints, comparisons, and caveats.
4. **Implementation support** returns solution patterns, operational practices, verified code examples, dependencies, and execution evidence.

One query may produce several typed result groups. Scores are comparable within a result type and ranking policy, not assumed globally comparable across all types.

Every product-facing result must contain:

- result type and canonical record handle;
- matched retrieval projection and projection version;
- human-readable match explanation;
- lexical, semantic, fusion, graph, reranker, and final score components when applicable;
- structured filter and constraint match information;
- evidence locators and artifact handles;
- authority, verification, freshness, temporal applicability, and lifecycle state;
- contradiction, correction, retraction, deprecation, and supersession flags;
- related entities, claims, implementations, papers, benchmarks, or models selected by policy;
- retrieval-run and evidence-packet identifiers.

## 10. Canonical vector spaces

The first service version defines these spaces. Each is separately versioned because its projection, query distribution, filters, relevance labels, and promotion gate differ.

| Space slug | Canonical source units | Primary question |
|---|---|---|
| `engineering_claims` | Verified atomic claims and attributed engineering judgments | What insight, warning, recommendation, or mechanism addresses this problem? |
| `tool_capabilities` | Library, product, protocol, MCP, and agent-skill capability profiles | Which tool supports this feature or use case under these constraints? |
| `implementation_examples` | Verified implementation examples and code projections | How can this be implemented in this language, framework, or environment? |
| `paper_case_study_knowledge` | Faithful sections plus supported findings and summaries | What research, method, result, limitation, or case evidence applies? |
| `entity_profiles` | Purpose-specific profiles for people, organizations, repositories, libraries, products, models, benchmarks, papers, talks, concepts, and protocols | What entity is meant or which entity resembles this description? |
| `model_capabilities` | Model-version capability profiles | Which model version fits this task and operational constraints, and why? |
| `benchmark_intelligence` | Benchmark definitions, versions, methods, limitations, and result observations | How is this capability measured and what comparable evidence exists? |
| `source_native_sections` | Vetted faithful document sections and transcript/code locators | Which source-native passage is relevant as evidence or context? |

`source_native_sections` is exploratory by default. Product-facing packets may include its members as locators or quotations, but external statements do not become verified claims merely by entering this space.

## 11. Shared technical-intelligence graph

All spaces connect through canonical typed relationships rather than embedding-only similarity:

```text
technical_problem
  -> concept
  -> solution_pattern
  -> claim
  -> operational_practice / failure_mode / compatibility_constraint
  -> library / product / protocol / skill / MCP server
  -> implementation_example / repository / code symbol
  -> model_version
  -> benchmark / dataset / metric_observation
  -> paper / case_study / talk / video
  -> person / organization
```

The initial graph backend is Postgres. Graph expansion uses allowlisted typed edge definitions, bounded depth, per-edge cost, temporal predicates, verification floors, and maximum-result limits. Free-form metadata does not create canonical graph edges.

The service must reuse existing canonical `corpus`, `evidence`, `knowledge`, `research`, `ranking`, and `taxonomy` records. It may add missing typed associations through the database contract repository. It must not create shadow copies of canonical people, organizations, libraries, models, papers, benchmarks, or claims inside the retrieval schema.

## 12. Content identity and provenance model

### 12.1 Source, capture, document, and version

These are distinct:

- `evidence.source` identifies where or how content can be acquired;
- `evidence.source_retrieval` records a discovery or fetch observation for an operation;
- `evidence.source_capture` binds immutable captured content to an artifact and capture method;
- `content.document` identifies the stable authored work;
- `content.document_version` identifies one edition, revision, commit, or content version;
- `content.document_version_source_capture` resolves one or more captures to a document version with resolution evidence.

A URL may yield multiple document versions. Multiple URLs or captures may represent the same document version. Identity resolution must preserve both facts.

### 12.2 Representation classes

`content.document_representation.representation_class` is one of:

- `source_native`;
- `rendered_snapshot`;
- `faithful_normalization`;
- `structural_extraction`;
- `semantic_projection`;
- `retrieval_projection`.

Examples for a webpage:

```text
HTTP response bytes                 source_native
decoded response HTML               faithful_normalization
JavaScript-rendered DOM             rendered_snapshot
main-content HTML                   faithful_normalization
Markdown                            faithful_normalization
Docling JSON                        structural_extraction
supported section summary          semantic_projection
contextualized embedding input     retrieval_projection
```

Provider fields named `rawHtml` are not assumed source-native. Only byte-identical captured response content qualifies as source-native.

### 12.3 Generic artifact lineage and explicit domain lineage

Every representation points to an immutable `orchestration.artifact`. Generic artifact lineage records `derived_from`, `supersedes`, and producer/consumer relationships. Explicit content and transformation tables provide stronger constraints and queryability. Both layers must agree; a reconciliation check detects missing or contradictory lineage.

## 13. Transformation contract

A transformation is a versioned many-input, many-output execution. It includes:

- transformation kind and contract version;
- admitted capability and exact version;
- code reference, package lock digest, container or environment digest;
- optional model identity and provider route;
- canonicalized parameters and digest;
- input artifacts and roles;
- output representations and roles;
- producer identity and standalone job or mission attempt;
- start/end time, status, error classification, cost and resource observations;
- deterministic idempotency key;
- immutable receipt and verification result.

Required transformation kinds initially include:

- `decode`;
- `render`;
- `main_content_extract`;
- `document_convert`;
- `ocr`;
- `transcribe`;
- `structure_extract`;
- `code_parse`;
- `claim_extract`;
- `entity_link`;
- `summarize_supported`;
- `contextualize_for_retrieval`;
- `chunk`;
- `embed`.

Retries with the same idempotency input cannot create conflicting output identities. A changed capability version, parameter digest, or input digest produces a new transformation.

## 14. Agentic curation and authority

Agentic curation is a core service feature, not prompt decoration.

### 14.1 What a model may do

A model may:

- request bounded discovery or acquisition through admitted tools;
- inspect captures, conversions, document structure, page images, tables, figures, formulas, code, and metadata;
- compare multiple conversion outputs;
- propose document identity and version resolution;
- classify content into the appropriate canonical domain and schema layer;
- identify whether content is source-native, faithfully normalized, derived, or unsuitable;
- propose claim, entity, concept, technical-problem, solution-pattern, library, implementation, model, benchmark, paper, case-study, or other typed links;
- propose a conversion repair or alternate parser;
- choose an admitted chunking profile or bounded specialization;
- propose a new candidate chunking profile for evaluation;
- choose an admitted embedding/vector-space profile;
- author supported contextualizations, summaries, and retrieval projections;
- propose content and vector-space promotion with structured reasons;
- construct representative query candidates, relevance judgments, adversarial cases, and expected filters;
- analyze retrieval failures and propose repairs.

### 14.2 What a model may not do

A model may not:

- write directly to canonical corpus, evidence, knowledge, retrieval, evaluation, or storage tables;
- call the embedding gateway with an unrestricted secret;
- publish, supersede, or delete canonical vector items directly;
- mark its own unsupported derived content faithful or verified;
- approve the same guarded digest it proposed unless policy explicitly permits a separated independent evaluator and deterministic gate;
- add a capability, parser, model, secret, network destination, schema target, or vector backend outside the admitted profile;
- return raw vector matches as authoritative evidence;
- silently edit captured or converted content;
- change frozen inputs or evaluation labels after a run begins.

### 14.3 Model-authored proposal envelope

Every model-authored proposal uses a JSON Schema and includes:

- proposal type and schema version;
- tenant and correlation identifiers;
- exact input artifact and representation digests;
- proposed action;
- selected domain and target contract;
- rationale;
- supporting locators and canonical-record references;
- uncertainty and unresolved questions;
- alternatives considered;
- requested policy or review class;
- model, prompt/instruction, capability profile, and provider-run identity;
- proposal digest.

Validation checks references, authorization, schemas, evidence presence, cardinality, lifecycle compatibility, and policy. Validation never executes promotion.

## 15. Content vetting and promotion

Promotion is separated into three decisions:

1. **Source acceptance:** the source identity, authenticity, rights, version, relevance, and acquisition integrity are acceptable.
2. **Representation acceptance:** the conversion or derivation is faithful or adequately supported for its declared class.
3. **Vector-space promotion:** the projection, chunk set, embedding configuration, and retrieval behavior pass their evaluation gate.

### 15.1 Source vetting dimensions

- canonical identity and publisher/author attribution;
- official, primary, authoritative-secondary, community, or unknown source role;
- publication, effective, updated, captured, corrected, and retracted dates;
- document/version completeness;
- URL, DOI, arXiv, OpenReview, repository, commit, package, video, or registry identifiers;
- HTTP integrity, checksums, signatures when available, and content-type agreement;
- license, terms, robots policy, quotation and redistribution constraints;
- public, restricted, confidential, or sensitive classification;
- malware, active-content, prompt-injection, and unsafe-file findings;
- duplicate or mirror relationship;
- topical relevance and intended retrieval spaces;
- unresolved identity or conflict findings.

### 15.2 Representation acceptance

Faithful outputs are evaluated for:

- page, section, block, table, figure, formula, code, citation, and transcript coverage;
- reading order and heading hierarchy;
- OCR, parse, layout, and conversion confidence;
- preservation of negation, numbers, units, citations, code tokens, and table headers;
- noise, repeated headers/footers, navigation, cookie text, and unrelated chrome;
- exact locators back to the source-native capture;
- comparison against alternate conversions for low-confidence content.

Derived outputs are additionally evaluated for:

- every substantive assertion having support locators or canonical verified records;
- attribution being preserved;
- speaker assertions being distinguished from independently verified facts;
- uncertainty, limitations, contradiction, and temporal scope being preserved;
- no new unsupported entities, numbers, mechanisms, or causal claims;
- semantic consistency with the source representation.

### 15.3 Promotion states

```text
candidate -> inspected -> validated -> evaluation_pending
evaluation_pending -> review_required | rejected | approved
approved -> published
published -> superseded | withdrawn
```

Publishing is append-only. A changed guarded digest invalidates a previous decision. Withdrawal does not erase history or evidence.

## 16. Acquisition adapter architecture

All acquisition providers implement a common interface:

```typescript
interface AcquisitionAdapter {
  readonly adapterKey: string;
  readonly version: string;
  supports(request: AcquisitionRequest): SupportDecision;
  plan(request: AcquisitionRequest): Promise<AcquisitionPlan>;
  execute(plan: AdmittedAcquisitionPlan): Promise<AcquisitionResult>;
  verify(result: AcquisitionResult): Promise<AcquisitionVerification>;
}
```

An `AcquisitionRequest` includes purpose, target, expected source class, preferred media types, authentication reference, egress profile, maximum bytes/pages/depth, rendering and interaction policy, freshness requirement, classification, and expected outputs. It never contains a secret value.

An `AcquisitionResult` contains provider observations, response metadata, discovered canonical identifiers, one or more sealed artifacts, content digests, capture-method identity, retry advice, cost, and typed errors.

### 16.1 Initial adapter routing

| Need | Primary | Fallback or verification |
|---|---|---|
| broad discovery | Tavily search | Firecrawl search, provider-specific index |
| known static or rendered URL | Firecrawl scrape | direct HTTP, browser capture |
| site URL discovery | Firecrawl or Tavily map | sitemap/direct link extraction |
| bounded documentation section | Firecrawl crawl | site download plus local parser |
| complex multi-page structured extraction | Firecrawl agent | crawl plus deterministic extraction |
| public document URL | direct HTTP capture, then converter | Firecrawl scrape/parse |
| local or non-public document | Unstructured Transform when policy permits managed processing | pinned Docling Serve or local deterministic parser |
| paper discovery | admitted paper index | Crossref, arXiv, OpenReview, publisher |
| repository content | Git/archive at exact SHA | GitHub/GitLab API archive |
| dynamic/login/pagination | browser interaction adapter | operator-assisted capture |
| transcript/media | platform transcript/API | ASR/Docling media pipeline |
| recurring changes | Firecrawl monitor or scheduled recapture | deterministic checksum comparison |

Discovery results are not captures. Search snippets may help select sources but cannot support canonical content without an admitted capture or locator.

### 16.2 Direct HTTP adapter

The general fallback must support:

- DNS and redirect-policy enforcement;
- allowlisted protocols and ports;
- private-network and metadata-service denial;
- request timeout, byte, decompression, and redirect bounds;
- conditional requests using ETag and Last-Modified;
- response-header capture with secret and cookie redaction;
- exact response-body hashing before transformation;
- declared versus observed media-type comparison;
- robots, terms, license, and rate-policy observations;
- idempotent capture reuse on identical content;
- archive and signed-artifact upload.

### 16.3 Repository adapter

Repository acquisition is bound to host, owner, repository, and exact commit SHA. It records archive digest, submodule policy, sparse-path policy, LFS observations, license files, lockfiles, generated/vendor exclusions, language statistics, and source-path manifest. Default-branch names are never sufficient source identity.

### 16.4 Paper adapter

Paper acquisition resolves DOI, arXiv, OpenReview, publisher, title, authors, revision, publication state, correction/retraction state, and available HTML/PDF/JATS representations. It preserves provider-specific citation observations separately from paper identity.

### 16.5 Manual acquisition fallback

Operator-assisted acquisition may upload exact bytes or a browser export through a signed upload URL. The operator must state origin, method, time, relevant access/rights context, and reason automatic acquisition failed. The uploaded artifact remains a candidate until independently inspected. Manual fallback never authorizes content promotion by itself.

## 17. Document conversion architecture

### 17.1 TypeScript-owned conversion-provider boundary

The application API, durable workflow, provider selection, policy, provenance, normalization, database integration, inspection, chunking, embeddings, evaluation and publication remain TypeScript-owned. Document conversion is an admitted capability behind a versioned `DocumentConversionProvider` contract; it is not required to execute in-process in Node.js.

Each provider adapter accepts only sealed source-artifact references plus an admitted conversion profile. It returns provider-native output artifacts, normalized candidate representations, status and error details, resource and cost observations, and a transformation receipt. The service validates provider output against pinned schemas and normalizes it into the service-owned document/node/locator representation without discarding the original provider response.

Provider identity, API or container version, model identity, profile digest, request digest, response digest, timings, cost and retry history are recorded. Provider-produced chunks or embeddings are non-canonical candidate derivatives unless their procedures are separately admitted and evaluated. Unstructured Pipelines, provider queues, provider webhooks and Docling job machinery may execute bounded provider work, but they do not become a second canonical orchestrator or publication authority.

### 17.2 Initial primary: Unstructured Transform

Unstructured Transform is the initial preferred managed converter for supported PDF, Office, image and other document classes. The TypeScript adapter uses the production Transform REST job workflow: create a job from one or more sealed artifacts, record returned job and file identifiers, poll through bounded retry policy, download each exact result, seal the provider output, validate it and normalize it.

The legacy Unstructured Partition Endpoint and its JavaScript/TypeScript SDK may be used only for bounded experiments or compatibility fixtures; they are not the production integration contract. The production adapter uses the current Transform REST/OpenAPI contract through a pinned generated or hand-written TypeScript client with runtime response validation. Account tier, endpoint, enabled models, region, retention/privacy posture and per-page charging rules are declared in configuration and capability admission.

Managed processing is allowed only when tenant policy, content classification, rights/privacy rules and egress policy permit uploading the artifact. When managed processing is disallowed or the provider is unavailable, the router selects Docling Serve or another admitted local strategy.

### 17.3 Fallback and reproducibility reference: Docling Serve

Docling runs as a pinned self-hosted Docling Serve container or equivalent reproducible environment. The TypeScript service calls its HTTP API; the Python package, model artifacts, OCR engine, pipeline options, tokenizer, accelerator settings and external model calls remain isolated inside the admitted conversion capability and are declared in its conversion profile.

`docling-ts` is not treated as the conversion engine. Its pinned official Docling Serve client or output types may be used as adapter conveniences only after runtime schema validation; the service must not depend on its unstable draft packages as the canonical document model. A native Node/Rust Docling port may be evaluated as a candidate capability, but it cannot replace pinned Docling Serve until it passes the same fixture, conformance, security and promotion gates.

Docling MCP is an agent-facing integration option, not the internal service-to-service conversion protocol. The knowledge service's MCP facade calls the same TypeScript application APIs used by other clients, and those APIs invoke the admitted Docling Serve adapter when selected.

### 17.4 Required conversion outputs

Required outputs for supported document classes are:

- lossless provider-native structural JSON, including Docling JSON when Docling is selected, or the closest available structural serialization;
- normalized Markdown;
- plain text where useful for comparison;
- page and element metadata;
- extracted tables, figures, captions, formulas, code, and citations where available;
- conversion errors and timings;
- document- and page-level confidence report;
- optional page images for inspection;
- transformation receipt.

Every converter operates on sealed source artifacts, not an unrecorded URL fetch. If a provider can fetch a URL, that convenience path may be used only through the acquisition adapter so the captured bytes and request evidence remain explicit.

### 17.5 Format-specific strategies

| Content | Primary conversion | Important preservation |
|---|---|---|
| HTML/web | response/rendered DOM to structural document | headings, links, code, tables, canonical URL, DOM locators |
| PDF | Unstructured Transform; Docling Serve fallback/reference | pages, reading order, tables, figures, formulas, citations |
| DOCX/ODT | Unstructured Transform; Docling Serve fallback/reference | heading/list/table hierarchy and revision metadata where available |
| PPTX | Unstructured Transform; Docling Serve fallback/reference | slide number, title, text, notes, figures |
| XLSX/CSV | deterministic table parser; Unstructured or Docling where useful | sheets, headers, types, formulas, merged cells |
| Markdown/AsciiDoc | native parser; provider representation where useful | heading tree, code fences, links, directives |
| JATS/XML | schema-aware XML parser | sections, citations, figures, tables, identifiers |
| transcript/VTT | deterministic time/speaker parser | speaker, timestamps, segment order |
| audio/video | platform transcript then admitted ASR | time ranges, speaker attribution confidence |
| repository/code | Tree-sitter or compiler parser | commit, path, symbol, AST, imports, comments, tests |

### 17.6 Additional conversion fallbacks

Admitted fallback capabilities may include:

- direct DOM/Readability extraction;
- Pandoc;
- PyMuPDF;
- `pdftotext`;
- Tesseract or other pinned OCR;
- LibreOffice headless conversion;
- browser print/export;
- Firecrawl document parse;
- human-reviewed correction represented as a new derivative artifact.

A fallback never overwrites the prior output. It creates a new representation and comparison lineage. Models can recommend a fallback based on inspection findings; deterministic policy authorizes execution.

## 18. Inspection and conversion quality

Inspection is available to models and humans through bounded, auditable tools.

### 18.1 Inspection views

- source metadata and capture headers;
- original artifact or page image through a signed URL;
- normalized Markdown/text;
- structural tree with stable node IDs;
- page-by-page confidence and error overlays;
- extracted table, figure, formula, citation, and code inventories;
- original/converted text diff and coverage statistics;
- alternate-conversion comparison;
- low-density, repeated, malformed, or suspicious regions;
- detected prompt-injection or active-content findings;
- proposed chunks with token counts and locators;
- derived claims, summaries, entity links, and their supporting spans.

### 18.2 Deterministic conversion metrics

- input/output page count agreement where meaningful;
- character and token coverage;
- heading/list/table/figure/code/citation counts;
- page and block with no extracted content;
- OCR proportion and confidence distribution;
- reading-order anomaly count;
- repeated-header/footer ratio;
- broken-hyphen and encoding anomaly counts;
- table-header and row preservation checks;
- locator resolvability rate;
- content hash and artifact-integrity verification.

### 18.3 Inspection findings

Findings are typed as `accept`, `repair`, `alternate_conversion`, `quarantine`, `review`, or `reject`. Each cites nodes/pages/spans, explains impact, and proposes an allowed action. A model finding does not mutate the representation.

## 19. Document structure and locators

`content.document_node` forms an immutable ordered tree for a representation. Node kinds initially include:

- document, title, heading, paragraph, list, list item;
- table, table row, table cell;
- figure, image, caption;
- formula;
- code block;
- quotation;
- footnote, citation, bibliography entry;
- transcript segment and speaker turn;
- slide and speaker note;
- repository file, symbol, class, function, method, declaration, test, configuration block.

Each node includes stable local identity, parent, ordinal, label/kind, normalized content digest, optional small inline text, artifact or representation reference, and a selector. Selectors are media-aware:

- page and bounding box;
- DOM/CSS/XPath plus context fingerprint;
- character and token range;
- transcript start/end time and speaker;
- slide number and element position;
- repository commit/path/symbol/line range;
- table/row/cell coordinates.

Existing `evidence.locator` remains the canonical evidence locator. Document-node selectors either create or resolve an `evidence.locator` when used to support a claim or evidence packet.

## 20. Chunking strategy framework

### 20.1 Chunking profile

A versioned chunking profile declares:

- supported document and representation kinds;
- retrieval space and intended query types;
- base chunker and exact version;
- tokenizer identity and maximum embedding tokens;
- target and minimum tokens;
- overlap policy and maximum duplicated-token ratio;
- structural boundary priorities;
- table, figure, formula, code, list, citation, and transcript policies;
- heading/context prefix policy;
- parent-child and neighbor policy;
- minimum information-density and quality rules;
- metadata projection;
- prohibited splits;
- evaluation dataset and gate.

An agent may select an admitted profile or propose a bounded specialization that tightens limits. A new behavior requires candidate-profile evaluation and admission.

### 20.2 Default strategies

| Domain | Default strategy |
|---|---|
| papers | hierarchical section-aware chunks; preserve abstract, methods, results, limitations; tables/figures linked separately |
| case studies | context, problem, intervention, implementation, outcome, evidence, and caveat units |
| documentation | heading/API-symbol hierarchy; keep examples, warnings, and version scope with their subject |
| transcripts | speaker- and timestamp-aware topical segments with bounded overlap at topic transitions |
| code | AST/symbol units with imports, signature, docstring, and required context; file windows only as fallback |
| tables | row groups with repeated headers and table identity; do not split individual rows unless unavoidable |
| claims | one atomic claim plus compact applicability and evidence context; no unrelated claim bundling |
| entity profiles | one small purpose-specific projection per profile kind; normally no token-window splitting |
| model/benchmark profiles | capability or evaluation facets rather than monolithic entity descriptions |

Docling `HybridChunker` is an initial general-document benchmark and candidate because it refines structural chunks using the selected tokenizer. A production procedure may reproduce or adapt that behavior in TypeScript over normalized nodes or invoke it as a separately pinned capability. Unstructured-produced chunks are likewise candidate derivatives, not canonical chunks by default. In all cases the service owns chunk identity, spans, validation, profiles and evaluation.

### 20.3 Chunk identity and reconstruction

A chunk is not merely copied text. `retrieval.chunk_span` maps each chunk to one or more document nodes and offsets. A chunk can therefore be reconstructed and its locator verified.

Chunk identity derives from:

- tenant;
- chunk-set digest;
- ordered spans;
- source-text digest;
- retrieval-projection digest.

Changing contextual prefixes, tokenization, spans, or source content produces a new chunk identity.

### 20.4 Chunk relationships

Previous, next, and ordinary siblings are derivable from ordinal within a chunk set. Stored typed edges are used when additional meaning exists:

- `parent_of`;
- `overlaps`;
- `continues`;
- `elaborates`;
- `summarizes`;
- `same_table`;
- `same_code_symbol`;
- `cross_references`;
- `supersedes`.

Chunk adjacency is not the knowledge graph. Canonical entity, claim, concept, solution, model, benchmark, paper, and implementation links are stored as typed associations.

### 20.5 Chunk metadata

Critical metadata is relational or in typed columns. JSONB is reserved for provider-specific and experimental residue.

Required metadata groups:

- **identity:** tenant, document, version, capture, representation, chunk set, projection, vector-space version;
- **position:** ordinal, parent, heading path, page/time/DOM/symbol selector, offsets, node spans;
- **source:** publisher, author, canonical URL, source role, license, publication/effective/capture dates, identifiers;
- **authority:** vetting state, assurance, faithful/derived class, promotion decision, lifecycle;
- **graph anchors:** entity, claim, concept, technical problem, solution pattern, implementation, model, benchmark, paper and case-study links with roles;
- **retrieval:** language, content kind, retrieval role, token count, searchable-text digest, visibility, freshness;
- **quality:** conversion grade, OCR state, chunk-quality result, duplicate cluster, injection risk, contradiction/retraction/deprecation flags.

Frequently filtered attributes may be denormalized into the physical search row, but their authoritative source remains the normalized record.

## 21. Domain classification and schema selection

A curation model receives the structural representation, source-vetting context, existing schema discovery, and candidate canonical matches. It proposes one or more domain dispositions:

- faithful source section only;
- verified or attributed claim;
- concept;
- technical problem;
- solution pattern;
- failure mode;
- compatibility constraint;
- operational or security practice;
- library/tool/product/protocol/skill/MCP capability;
- implementation example;
- model or model version;
- benchmark, dataset, metric, or result observation;
- paper, case study, report, talk, video, person, organization, repository, or relationship;
- not ingestible.

The proposal must identify the existing target contract version, candidate deduplication keys, required evidence, unresolved identity questions, and why a simpler or more authoritative layer is insufficient. Validation rejects free-form domain names, unresolved required entity identities, or derived records without support.

## 22. Domain projection procedures

### 22.1 Engineering claims

The projection contains atomic statement, problem addressed, mechanism/rationale, applicability, limitations, aliases, attribution, temporal scope, and compact evidence context. Claim roles distinguish independently verified fact, attributed speaker assertion, opinion/recommendation, observed result, and synthesis.

Results expand to engineer/person, organization, talk/video/paper, exact locators, related solution patterns, implementations, conflicting claims, and supersession.

### 22.2 Tool capabilities

The unit is a version-aware capability profile, not a README summary. It contains feature/use-case statements, supported languages and frameworks, deployment mode, compatibility, license, maintenance, maturity, security considerations, evidence, and implementation links.

Ranking combines semantic use-case relevance, exact feature match, hard-constraint fit, evidence quality, maintenance freshness, and implementation availability, with deprecation/security/conflict penalties.

### 22.3 Implementation examples and code

Canonical examples include objective, technical problem, solution pattern, language/runtime, framework/library versions, repository and commit, path and symbol, dependencies, configuration, inputs/outputs, security, license, verification status, source locator, explanation, and full code artifact.

Each example may have two projections:

- natural-language intent and mechanism;
- implementation identifiers, APIs, types, imports, comments, and code.

Code promotion requires syntax parsing and, where feasible, dependency resolution, lint/type check, focused execution/test, secrets scan, and license inspection. Generated code remains exploratory until equivalent verification passes.

### 22.4 Papers and case studies

Faithful sections and derived knowledge are separate. Section roles include abstract, problem, related work, method, experiment, result, limitation, conclusion, table, figure, and appendix. Case-study roles include context, problem, intervention, implementation, outcome, evidence, and caveat.

Derived summaries link each substantive assertion to source locators or verified canonical records. Retrieval may expand a narrow match to its parent, neighbors, tables, figures, citations, findings, models, libraries, benchmarks, datasets, and implementations.

### 22.5 Entity profiles

Entity profiles are purpose-specific: identity/disambiguation, capability/use-case, technical significance, and ecosystem relationships. Exact identifiers, aliases, slugs, versions, repository coordinates, DOIs, and acronyms are handled lexically first. Semantic profiles support unnamed discovery, conceptual queries, and similarity.

### 22.6 Model capabilities

Profiles bind a specific model version to modalities, tasks, context/output limits, structured output, tool use, deployment/provider availability, openness, cost/latency observations, capability evidence, limitations, benchmarks, case studies, and dates. Natural-language retrieval proposes candidates; structured constraints remove invalid choices. Results explain fit, non-fit, evidence, benchmark relevance, and alternatives.

### 22.7 Benchmark intelligence

Benchmark definition/version and result observation are distinct. Profiles include measured task, dataset, metric, protocol, domain, version, saturation, contamination, known limitations, and reproducibility. Result observations bind exact model version, benchmark version, score, configuration, date, source, and comparability context.

Graph expansion follows model version to metric observation to benchmark version to dataset, task, paper, and limitation claims.

## 23. Search projections and embedding architecture

Canonical records and faithful chunks do not carry provider-specific embedding columns. A `search_projection` is the immutable, purpose-specific bridge between a canonical source and a vector space. One record may have multiple projections—for example, an entity identity projection, a capability/use-case projection, and an ecosystem projection—without duplicating embedding policy across domain tables.

Every projection freezes:

- tenant and canonical target type/ID;
- projection-procedure version and declared purpose;
- faithful source references and, for semantic projections, atomic support spans;
- source text, generated contextual prefix, final embedding text, and independent SHA-256 digests;
- language, content kind, visibility, classification, effective interval, and promotion state;
- generator identity and prompt/schema version when generated content is present;
- source-vetting, representation-acceptance, and content-promotion decision IDs.

The initial embedding adapter uses Vercel AI Gateway and the slug `openai/text-embedding-3-small`. The initial candidate space is 1,536 dimensions, cosine distance, and `halfvec(1536)`. Before production freeze, the evaluation suite must compare `halfvec(1536)` against `vector(1536)` exact-search and indexed baselines for recall, rank correlation, latency, storage, and cost.

The adapter contract is:

```ts
interface EmbeddingAdapter {
  discoverModel(modelSlug: string): Promise<ModelDescriptor>;
  embedOne(request: EmbedOneRequest): Promise<EmbedReceipt>;
  embedMany(request: EmbedManyRequest): Promise<EmbedBatchReceipt>;
}
```

An embedding run freezes gateway model slug, allowed provider route/order, expected dimensions, normalization and distance rules, tokenizer, projection procedure, batch implementation, timeouts, retry policy, tenant, operation, and ordered input hashes. Startup and pre-publication checks verify model availability and dimensions. A provider route change that may change numeric output creates a new vector-space version; it never silently alters an existing one.

Embeddings are cached by `(vector_space_version_id, embedding_text_sha256)`. The executor validates output count, ordering, finite values, dimension, and response digest. Partial batches remain unpublished. Retries preserve the same idempotency key. Receipts record request ID, observed provider route, model identity, token/usage counts, latency, retry history, cost estimate, input manifest digest, and output manifest digest. The AI Gateway secret is available only to the trusted executor; no agent-facing tool returns or accepts it.

Re-embedding creates a new immutable run and embedding items. Publication switches the visible space version atomically. It never overwrites a vector or mixes model, dimension, precision, normalization, or projection versions.

## 24. Vector, lexical, and object storage

### 24.1 Canonical search backend

Supabase Postgres with pgvector is canonical because authorization, provenance, structured filters, graph edges, publication, and retrieval evidence must remain transactionally connected. The physical embedding table uses a fixed-dimension type. The existing unconstrained `extensions.vector` column is not an acceptable production index target.

The preferred initial design is one fixed-dimension embedding table partitioned by canonical vector-space key, with an HNSW index on each active partition:

```sql
create table retrieval.vector_item_embedding_1536 (
  tenant_id uuid not null,
  vector_space_key text not null,
  vector_space_version_id uuid not null,
  vector_item_id uuid not null,
  embedding extensions.halfvec(1536) not null,
  embedding_sha256 text not null,
  created_at timestamptz not null default now(),
  primary key (vector_space_key, vector_item_id),
  foreign key (tenant_id, vector_item_id)
    references retrieval.vector_item(tenant_id, id),
  foreign key (tenant_id, vector_space_version_id)
    references retrieval.vector_space_version(tenant_id, id)
) partition by list (vector_space_key);
```

Each canonical space receives a partition and an index equivalent to:

```sql
create index engineering_claims_embedding_hnsw
on retrieval.vector_item_embedding_engineering_claims
using hnsw (embedding extensions.halfvec_cosine_ops);
```

The implementation may instead use one fixed-dimension table per precision/dimension if measured planning behavior is better. Either design must prove partition pruning or selective filtering, correct operator classes, and no cross-version comparisons. For filtered ANN queries, evaluate pgvector iterative HNSW scans and explicitly detect insufficient-candidate conditions. Exact search remains available for evaluation and small filtered sets.

`retrieval.vector_item` carries typed hot filters and generated lexical data: tenant, space/version, target class, language, visibility, classification, canonical/promotion lifecycle, authority, freshness dates, applicability/version fields, source/representation quality, `search_text`, and a stored `search_tsv`. Use GIN for FTS and `pg_trgm` indexes for entity names, aliases, package/repository coordinates, model IDs, DOIs, API symbols, and other exact-ish identifiers.

### 24.2 Vector Bucket adapter

Supabase Vector Buckets remain a backend adapter and optional shadow experiment while the product is public alpha. No correctness path depends on them. A future promotion requires backend-conformance tests for metadata-filter correctness, authorization, Recall@k, supersession/deletion, latency, durability, export/rebuild, observability, and cost. Postgres records remain authoritative even if vectors are shadow-written elsewhere.

### 24.3 Supabase Storage

Create two private buckets:

- `source-captures`: exact acquired bytes and capture envelopes;
- `content-derivatives`: Docling JSON, normalized text/Markdown, page images, reports, manifests, chunk exports, embedding inputs, and evaluation artifacts.

Optional later buckets are `evaluation-fixtures` and `retrieval-exports`. Object keys are write-once and content-addressed, for example `tenant/<tenant-id>/sha256/<first-two>/<digest>/<artifact-name>`. Postgres artifact rows and digests—not paths—are provenance authority. Raw and derivative content have independent access, classification, legal, retention, and deletion policies.

Uploads validate media signature, digest, declared type, size, decompressed size, archive entries, malware state, and policy. Agents cannot list buckets. Access uses narrow, short-lived signed URLs or a streaming service endpoint. Storage policies separately govern insert/select/update/delete; update and delete are denied except to explicit retention/legal workflows that write tombstone receipts.

## 25. Postgres schema contract

The service extends the existing `orchestration`, `evidence`, `corpus`, `knowledge`, `retrieval`, and `evaluation` contracts. It does not replace canonical entity/claim records. Every tenant-owned table includes `tenant_id not null`, and tenant consistency is enforced by composite foreign keys or equivalent checked functions—not merely by RLS.

### 25.1 Content and transformation tables

| Table | Purpose and required columns |
|---|---|
| `content.document` | Stable work identity: `id`, `tenant_id`, `document_kind`, canonical title, canonical source identity, lifecycle, created provenance, `supersedes_id`. |
| `content.document_identifier` | Typed identifiers such as URL, DOI, arXiv, OpenReview, ISBN, repository, media ID; normalized value, authority, validity interval, unique scoped identity. |
| `content.document_version` | Edition/state: version label, published/effective times, resolved revision/commit, manifest digest, retraction/correction state, predecessor/successor. |
| `content.document_version_source_capture` | Many-to-many resolution of immutable `evidence.source_capture` rows to a version, with role and identity confidence. |
| `content.document_representation` | Version, artifact, kind, media type, fidelity class, language, converter lineage, content digest, acceptance state, supersession, source-native byte-identity flag. |
| `content.transformation_run` | Procedure/version/container/code/model/config/environment identities, status, operation/attempt, start/end, idempotency key, input/output manifest digests, receipt, failure class. |
| `content.transformation_input` | Ordered typed inputs linking representations/artifacts/captures to a run. |
| `content.transformation_output` | Ordered typed outputs linking representations/artifacts/reports/manifests to a run. |
| `content.document_node` | Representation tree node: parent, ordinal, node kind, role, faithful text/artifact, page/time/DOM/symbol locator, offsets, bbox, language, digest. |
| `content.document_node_edge` | Non-tree structural edges such as citation, footnote, caption, cross-reference, continuation, same-table, and same-symbol. |
| `content.conversion_evaluation` | Evaluator/procedure, conversion grade, coverage and locator metrics, report artifact, findings digest, disposition. |
| `content.conversion_finding` | Typed severity, node/page locator, observed defect, expected behavior, evidence artifact, recommended action, resolution. |
| `content.representation_decision` | Immutable acceptance/rejection/quarantine/defer decision binding the exact representation and evaluation digests, rationale, reviewer/policy and expiry. |

`document`, `document_version`, capture, and representation are deliberately distinct. A raw HTML body is a source-native representation only if it is the exact captured HTTP bytes. Firecrawl `rawHtml`, rendered DOM, reader-mode Markdown, OCR text, and Docling JSON are separate representations unless byte identity is proven.

### 25.2 Preparation, chunks, projections, and publication

| Table | Purpose and required columns |
|---|---|
| `retrieval.vector_store` | Stable tenant/project-scoped store identity: owner, store class, name/slug, purpose, visibility, lifecycle, quota profile, retention/deletion policy, created provenance and supersession. |
| `retrieval.vector_store_document` | Membership and lifecycle of a document/version/representation within a store, including admission state, requested profile, removal/tombstone state and lineage. |
| `retrieval.vector_store_space` | Association of a store with compatible vector spaces and active publication/version pointers; prevents silent mixing of incompatible embeddings or authority classes. |
| `retrieval.chunking_procedure_version` | Admitted implementation, supported content classes, tokenizer, schema, container/code digest, defaults, limits, status. |
| `retrieval.chunk_set` | Representation, procedure, frozen config, tokenizer, input/output manifest digest, status, QA evaluation, promotion linkage, supersession. |
| `retrieval.retrieval_chunk` | Chunk set, ordinal, parent chunk, source text, contextual prefix, embedding text, separate hashes/token counts, role, language, promotion/lifecycle. |
| `retrieval.chunk_span` | Ordered mapping from a chunk to one or more document nodes and exact offsets/locators; required for promoted faithful chunks. |
| `retrieval.chunk_edge` | Meaningful typed relations: parent, continuation, overlap, elaboration, summary, same-table/symbol, cross-reference, supersedes. Ordinary adjacency is derived from ordinal. |
| `retrieval.chunk_entity_mention` | Entity target, mention role, method, confidence, verification, exact chunk/node span. |
| `retrieval.chunk_claim_link` | Claim target and semantic role: states, supports, challenges, qualifies, summarizes, cites. |
| `retrieval.chunk_concept_link` | Concept/problem/pattern/failure-mode target, role, method, confidence, verification. |
| `retrieval.chunk_citation_link` | Citation target/source/document and exact citation marker/resolution state. |
| `retrieval.chunk_relationship_evidence` | Typed canonical relationship supported by the span, role, support strength, verification decision. |
| `retrieval.search_projection` | Purpose-specific immutable projection from one admitted target; procedure, texts/hashes, support set, metadata, promotion state. |
| `retrieval.embedding_run` | Frozen vector-space version, adapter/model/route, ordered manifest, execution identity, usage/cost, state, receipt and failure. |
| `retrieval.embedding_item` | Run, search projection, input hash, output digest, dimension, cache identity, status, provider item metadata. |
| `retrieval.content_promotion_proposal` | Agent proposal binding source/version/representation/chunk/projection manifests, target domains, expected queries/value, risks, exclusions, procedures and reason. |
| `retrieval.content_promotion_decision` | Append-only accept/reject/defer/request-changes decision, guarded digest, gates, reviewer/policy, rationale, expiry, separation-of-duty evidence. |
| `retrieval.space_publication` | Atomic binding of a published vector-space version to exact vector-item/embedding/index manifests, eval result, publication decision and predecessor. |
| `retrieval.retrieval_policy` / `_version` | Admitted spaces, filters, fusion, graph, rerank, expansion, abstention and output schema with immutable version. |

The target of `search_projection` uses an admitted target registry or normalized typed association table, not a permanently expanding nullable foreign-key arc. The registry entry identifies target kind, schema version, canonical table identity, stable record ID, tenant, and eligibility validator. Critical referential checks still run in deterministic admission functions.

### 25.3 Existing retrieval-table amendments

Amend the current contract as follows:

- `projection_procedure` freezes prompt/template schema, tokenizer, normalized projection policy, implementation/container digest and immutability semantics;
- `vector_space_version` adds precision, dimensions, distance operator, normalization, index configuration, provider-routing policy, publication lifecycle and decision;
- `vector_item` references a `search_projection` and immutable embedding item; add typed hot filters and generated `search_tsv`; retire the generic embedding as canonical storage after backfill;
- replace `lexical_ref text` in retrieval candidates with typed candidate-source rows containing channel, projection/item ID, rank, score and explanation;
- validate plan decomposition, selected spaces and filters against a retrieval-policy version and JSON Schema;
- evidence packets admit faithful document sections and typed discovery/profile records, while retaining exact locator and canonical eligibility gates;
- canonical eligibility validators cover every target kind, not only claims.

### 25.4 Evaluation-table additions

Extend the existing evaluation foundation with:

- `evaluation.eval_dataset_version` and immutable manifests;
- `evaluation.eval_case_provenance`, `eval_case_relevance`, and `eval_case_expected_filter`;
- `evaluation.experiment` and `experiment_arm` for ablations;
- `evaluation.eval_run_case_output` for plans, candidates, packets and answers;
- `evaluation.metric_definition` and `metric_observation`;
- `evaluation.judge_output` with prompt/model/schema/calibration identities;
- `evaluation.promotion_gate_version`, `promotion_gate_result`, and `regression_baseline`;
- review subjects for source vetting, conversion, representation, domain mapping, chunking, projection, content promotion, publication, regression waiver, injection/security and retrieval anomaly.

### 25.5 Generic lineage, events, and standalone jobs

Add `orchestration.artifact_lineage(from_artifact_id, to_artifact_id, relation_kind, transformation_run_id, receipt_id, tenant_id)` for broad traversal while keeping typed links authoritative. The standalone service also needs durable `knowledge_service.operation`, `operation_step`, `operation_event`, `outbox`, `lease`, and `receipt` records. They accept optional future Mission Control work-item/attempt IDs and correlation/causation IDs.

Queue messages are transport hints containing operation/attempt identity, not authority. Durable rows are authoritative. Acknowledgement follows result and receipt commit. Visibility timeouts are renewed for long work; poison items are classified and archived. Heavy conversion, OCR, repository analysis, and AST work run in pinned workers, not Supabase Edge Functions.

### 25.6 Immutability and deletion rules

Captures, representations, transformations, accepted chunk sets/chunks/spans, projections, embeddings, decisions, publications, evaluation results, and evidence packets are append-only. Corrections create a new row and explicit supersession/amendment link.

The existing guard functions must be replaced with column-complete comparisons or a general append-only trigger; checking only selected columns while permitting `superseded_by` is insufficient. Packet members receive their own mutation guard. Foreign keys from immutable evidence use `restrict` rather than cascading deletion. Legal deletion creates tombstones and makes content ineligible while preserving minimum non-content audit records permitted by policy.

### 25.7 RLS, grants, and tenant integrity

- Enable RLS on every exposed table, including child and join tables.
- Never use `using (true)` on a tenant-bearing child merely because it lacks `tenant_id`; instead add `tenant_id` and enforce composite FKs.
- `anon` has no management or content privileges.
- `authenticated` can use only approved tenant-aware search/read RPCs and specifically granted views.
- Cloud agents never hold Supabase secret/service-role credentials.
- Privileged mutations occur through narrow backend commands.
- Security-definer functions use `set search_path = ''`, fully qualified names, revoked `public` execution, explicit grants, authorization checks and bounded inputs.
- Views are `security_invoker` where supported or remain outside exposed schemas.
- RLS tests cover allow, deny, cross-tenant counts, error behavior, signed URLs and metadata side channels.

### 25.8 Migration sequence

Apply additive migrations in this order:

1. extensions and prerequisites: pgvector version check, `pg_trgm`, schemas, enum/domain types;
2. tenant-safe generic artifact lineage and append-only primitives;
3. content documents, identifiers, versions and capture resolution;
4. representations, transformations, structural nodes and conversion evaluation;
5. chunking registry, chunk sets, chunks, spans and graph links;
6. search projections, promotion proposals/decisions and target admission registry;
7. vector-space amendments, embedding runs/items, fixed-dimension physical tables and indexes;
8. retrieval policy, typed stage candidates, evidence-packet amendments and publications;
9. evaluation dataset/experiment/metric/gate additions;
10. standalone operations, events, leases, receipts and outbox;
11. RLS, grants, Storage bucket policies, RPCs and append-only triggers;
12. compatibility views/backfill from legacy `public.chunk` and generic `vector_item`, followed by read cutover;
13. generated types, comments, schema lint, advisor checks, fresh reset, rollback rehearsal and contract tests.

Every migration includes forward behavior, safe rollback or compensating plan, backfill checkpoint, lock/time estimate, verification queries, and compatibility interval. Destructive retirement occurs only after published-space rebuild and rollback rehearsal.

## 26. Lifecycle and state machines

The service separates three gates:

1. **source acceptance** — is this source identity/capture admissible and sufficiently trustworthy?
2. **representation acceptance** — is this exact converted representation faithful and usable?
3. **retrieval publication** — do these exact chunks/projections/embeddings improve the target space and pass policy/evaluation?

One decision never implies another. A source may be accepted while its conversion is rejected; a representation may be accepted for citation but not promoted; exploratory publication may be allowed while canonical publication is blocked.

Common states are `proposed → queued → running → succeeded | failed | cancelled`, with `needs_review`, `quarantined`, and `superseded` where relevant. Publication is `draft → evaluated → approved → publishing → published → superseded | withdrawn`. State transitions are conditional, append an event, bind the expected row version/digest, and produce a receipt in one transaction.

Every activity is restart-safe. External side effects use deterministic idempotency keys. Reconcilers detect missing objects, orphan objects, expired leases, queued-but-not-running work, completed-but-unacknowledged messages, partial batches, absent indexes, published-count mismatches, and stale review decisions.

## 27. Advanced retrieval pipeline

Retrieval returns an immutable evidence packet, not a nearest-neighbor list. The execution stages are independently versioned and switchable for evaluation:

1. authorize request and resolve tenant/visibility/classification scope;
2. classify intent and decompose multi-part questions;
3. resolve exact identifiers, entities, concepts, use cases and technical problems;
4. validate selected spaces, hard filters, soft boosts, temporal scope and limits;
5. generate exact/trigram, lexical FTS, vector ANN and optional graph-seed candidates independently;
6. verify hard filters and canonical/promotion eligibility;
7. deduplicate by canonical record and source span;
8. fuse ranked channels with versioned weighted reciprocal-rank fusion;
9. expand only through admitted verified graph edges with bounded depth/fan-out;
10. rerank a bounded candidate set;
11. diversify and balance sources while preserving required coverage;
12. check freshness, applicability, supersession, retraction and contradiction;
13. attach parent/neighbor/table/code/transcript context after ranking;
14. determine coverage and abstention;
15. seal results and explanations into an evidence packet.

Vector and lexical raw scores are never added directly. The default prototype pool is up to 50 lexical and 50 vector candidates per selected space, subject to policy. Weighted RRF parameters are versioned by query class. Every candidate records channel rank/score, vector distance, RRF contribution, filter and boost decisions, graph path, reranker score, penalties and final rank.

Graph expansion defaults to depth one; depth two requires a plan reason. Only allow-listed typed edges participate, with per-edge fan-out caps and cycle prevention. Expansion never turns an unverified relationship into evidence.

Reranking uses a pinned cross-encoder or LLM rubric covering semantic relevance, exact constraints, authority, freshness/applicability, implementation usefulness, evidence completeness, contradiction and supersession. Inputs, prompt/config, scores, latency and cost are receipted. Failure returns fused results with `degraded_mode=true`; it never silently changes semantics.

Parent/neighbor expansion supplies intelligibility—parent heading, adjacent chunks, table header/caption, code imports/signature, speaker/timestamp, figure or footnote—but labels additions `context_only`; they do not inherit the matched chunk's relevance score.

## 28. Retrieval plan and evidence-packet contracts

A model may propose a plan. A deterministic validator constrains it to authorized spaces and admitted filters:

```json
{
  "policyVersion": "uuid",
  "query": "string",
  "intents": ["tool_selection", "implementation_lookup"],
  "subqueries": [{"id": "q1", "text": "...", "coverageRole": "required"}],
  "spaces": ["tool_capabilities", "implementation_examples"],
  "anchors": {"entities": [], "concepts": [], "useCases": []},
  "hardFilters": [{"field": "language", "op": "eq", "value": "typescript"}],
  "softBoosts": [],
  "temporalScope": {},
  "candidateK": 50,
  "finalK": 10,
  "graph": {"maxDepth": 1, "allowedEdges": []},
  "rerankerVersion": "uuid",
  "abstention": {"minimumCoverage": 1.0}
}
```

Invalid fields, unauthorized values, excessive limits, or incompatible spaces fail before execution. Post-filter verification always runs, even when filtering occurred inside candidate generation.

An evidence packet contains normalized query and plan; tenant and authorization decision; spaces/procedures/versions; all filters; selected canonical records and faithful sections; matched projections; exact source locators; channel/fusion/rerank explanations; graph paths; attached context; authority, assurance and freshness; contradictions/supersession; coverage by subquery; omitted-result reasons; abstention recommendation; run, event, artifact and receipt IDs. Members are immutable and cannot be cascade-deleted.

## 29. Retrieval API behavior by domain

- **Claims:** return atomic claim, attribution, claim class, verification, applicability/limitations, exact evidence, engineer/entity, related implementations and challenges.
- **Tools:** return capability and constraint fit, versions, compatibility, license, maintenance/security state, evidence, examples, limitations and explicit non-fit reasons.
- **Code:** support natural-language mechanism, exact API/symbol and mixed queries; return commit/path/symbol, dependencies, versions, verification, license, explanation and artifact access.
- **Papers/case studies:** return faithful matched section plus separate derived summary/finding, exact page/section/table locator, parent/neighbor context and related canonical records.
- **Entities:** route exact names/aliases/IDs lexically first; use semantic profiles for unnamed/conceptual discovery and hybrid queries; expose why the profile matched.
- **Models:** return version-specific fit/non-fit, constraints, dates, evidence, benchmarks, case evidence, deployment/cost observations and alternatives.
- **Benchmarks:** return benchmark version, task/dataset/metric/protocol, limitations/contamination, result observations, exact model/configuration and comparability warnings.

## 30. Evaluation architecture

Evaluation covers the complete knowledge path, not merely ANN relevance. Datasets are immutable and versioned. Each case records query, domain/query class, expected canonical IDs, acceptable alternatives, 0–3 graded relevance, expected locators/facts/citations, required/forbidden filters, abstention expectation, difficulty/adversarial tags, provenance, author and reviewer.

Sources of cases are curated golden queries, reviewed model-generated candidates, and anonymized production-derived queries with reviewed outcomes. Synthetic cases remain labeled. The curation model deliberately creates exact, conceptual, mixed, constraint-heavy, temporal, multi-hop, code, contradiction, negative and adversarial cases. A separate reviewer accepts/edits/rejects and supplies qrels. Development and held-out regression sets remain separate.

### 30.1 Preparation metrics

Measure capture identity/digest correctness, page/block coverage, locator round-trip, reading order, heading/table/equation/code/timestamp preservation, unsupported additions/omissions, conversion-grade distribution, chunk token distribution, oversize/undersize/orphan/broken-boundary rates, duplicate/boilerplate rate, support precision for semantic projections, domain mapping accuracy and entity/claim-link precision.

Every promoted faithful chunk must round-trip to source nodes. Every atomic generated assertion must resolve to supporting spans. Table-heavy documents require explicit inspection because aggregate converter confidence is insufficient.

### 30.2 Retrieval metrics

Report overall and by domain, query class, difficulty and policy slice:

- Recall@1/3/5/10, Precision@k, Hit@k, MRR, nDCG@k and MAP where applicable;
- exact hard-filter and result-type accuracy;
- graph-path precision and required-subproblem coverage;
- diversity, duplicate and source-concentration rates;
- authority/freshness/eligibility violation and false-acceptance rates;
- abstention precision/recall/accuracy;
- citation precision, locator correctness and citation coverage;
- p50/p95 latency, provider usage and cost.

Run ablations for lexical-only, vector-only, hybrid, filtered, reranked, graph-expanded and context-expanded configurations. Added complexity is enabled by default only if it improves held-out quality without violating hard gates.

### 30.3 LLM and human evaluation

A fixed, versioned judge may score retrieved-context relevance, atomic-claim faithfulness, answer correctness/completeness, citation entailment, attribution, contradiction disclosure, contextual sufficiency, practical usefulness and abstention quality. Freeze model, provider policy, prompt, temperature, schema, evidence limit, retry/parsing behavior and calibration set. Blind experiment IDs and randomize pairwise order. Store rationale, uncertainty and cited spans.

LLM judgment never replaces deterministic authorization, digest, locator, filter, citation-existence or provenance checks and is never the sole publication gate. Calibrate against human labels and periodically revalidate drift. Humans review critical false acceptances, security/policy cases, hard conversion defects and sampled judge disagreements.

### 30.4 Initial gates

Hard gates:

- 100% tenant, visibility and hard-filter correctness;
- 100% promoted faithful chunks have valid source lineage and round-trippable locators;
- zero secret, prohibited-source, cross-tenant, unapproved-content or model/dimension/version-mixing false acceptances;
- zero unsupported citations in the manually audited critical set;
- all critical conversion defects resolved or explicitly approved.

Initial quality targets:

- overall Recall@10 at least 0.90 and each canonical domain at least 0.80;
- overall nDCG@10 at least 0.80;
- MRR@10 at least 0.75 for navigational/fact queries;
- citation precision at least 0.98 and external-claim citation coverage at least 0.90;
- atomic-claim faithfulness at least 0.95;
- expected-abstention accuracy at least 0.90;
- retrieval p95 at most 1.5 seconds at the agreed prototype load, excluding answer generation.

Regression gates permit no hard-gate regression, no overall decline over two percentage points, and no domain/query-class decline over five points without an approved documented tradeoff. Any converter, chunker, projection, embedding model/precision, index, fusion, filter, graph, reranker or eligibility change creates a new experiment and promotion decision.

## 31. Publication and rollback

Publication binds exact source, representation, chunk-set, projection, embedding, index, retrieval-policy and evaluation manifests. The transaction makes the new vector-space version visible only after count, dimension, digest, index, sample-search, authorization and evaluation checks pass. Failed partial work remains inspectable but invisible.

Rollback switches the active publication pointer to a prior intact version and writes a reason-bearing publication event. It does not delete the failed version. Rebuilding a space requires only canonical records, immutable artifacts, procedures, configs and receipts; provider caches are accelerators, not required state.

## 32. Service interfaces

### 32.1 HTTP API

The API is versioned under `/v1`. Long work creates asynchronous resources and returns `202` with operation, status, event-stream and cancellation URLs. Mutation requests require an idempotency key, actor identity, tenant, reason and expected contract versions. Large bytes move through signed upload/download URLs, never through agent tool responses.

Required resource groups:

```text
POST/GET /operations, /operations/{id}, /operations/{id}/events
POST     /operations/{id}:cancel | :retry | :reconcile
POST/GET /vector-stores, /vector-stores/{id}
POST     /vector-stores/{id}/documents, /vector-stores/{id}/ingestion-jobs
POST     /vector-stores/{id}:search | :evaluate
GET      /vector-stores/{id}/operations/{operationId}
POST/GET /sources:discover, /sources:resolve, /captures
POST     /captures/{id}:inspect | :compare | :vet
POST/GET /documents, /document-versions, /representations
POST     /transformations, /representations/{id}:inspect | :compare
POST     /representations/{id}:decide
GET      /chunking-procedures
POST     /chunk-previews, /chunk-comparisons, /chunk-sets
POST     /chunk-sets/{id}:inspect
POST/GET /promotion-proposals, /promotion-decisions
POST     /embedding-runs, /space-publications
POST     /space-publications/{id}:verify | :rollback
POST     /retrieval-plans:validate
POST     /retrieval-runs
GET      /retrieval-runs/{id}, /retrieval-runs/{id}/explanation
GET      /evidence-packets/{id}
POST/GET /eval-datasets, /experiments, /eval-runs
GET      /eval-runs/{id}/report, /eval-runs/{id}/failures
POST     /reviews, /review-decisions
GET      /artifacts/{id}, /receipts/{id}, /health, /readiness
```

All responses use typed problem details, stable error codes, correlation IDs and bounded output. Search endpoints cap query length, candidate depth, graph fan-out and returned context. Retrieval never exposes unauthorized counts, snippets or existence through timing/error differences beyond the accepted threat model.

### 32.2 MCP server

The MCP server offers bounded workflow tools rather than raw SQL, arbitrary fetch or Storage listing:

```text
source.discover
source.resolve_identity
source.fetch
source.inspect_capture
source.compare_captures
source.propose_vetting
vector_store.create
vector_store.add_documents
vector_store.ingestion_status
vector_store.search
vector_store.evaluate
document.convert
document.inspect_representation
document.compare_representations
document.request_manual_review
knowledge.propose_domain_mapping
knowledge.propose_claims
knowledge.propose_entity_links
chunk.strategy_list
chunk.preview
chunk.compare
chunk.inspect
chunk.create_intent
embedding.model_list
embedding.estimate
embedding.create_intent
embedding.run_status
retrieval.plan_validate
retrieval.search
retrieval.explain_run
retrieval.build_evidence_packet
evaluation.generate_query_candidates
evaluation.run_experiment
evaluation.compare_experiments
evaluation.inspect_failures
promotion.submit
promotion.status
```

Every call includes or inherits tenant, actor, parent operation/attempt, idempotency key, exact input IDs, expected versions and reason. Responses return immutable IDs, state, digests, warnings and receipt IDs. Ordinary agent tools cannot publish canonical space versions, approve proposals, admit arbitrary code/capabilities, read secrets, run SQL, or list private buckets.

The MCP server is a facade over the TypeScript application contracts, not a provider transport or independent workflow engine. Provider-specific MCP servers, including Docling MCP, are not used for canonical service-to-service conversion. This keeps retries, leases, artifact sealing, authorization, receipts and reconciliation on the same HTTP/activity contracts used by the API, worker and future Mission Control adapter.

The remote MCP deployment is a supported product surface for Cursor Cloud agents, Eve agents and other admitted agent runtimes. Authentication scopes, tool catalogs, output limits and authority are resolved per consumer identity and capability version. MCP tools return compact typed results and immutable handles; they do not expose direct pgvector, Storage or unrestricted database operations.

### 32.3 CLI

The CLI is a machine-readable operator/developer peer to the API:

```text
knowledge source discover|fetch|inspect|vet
knowledge store create|show|add-documents|search|evaluate|status
knowledge document convert|inspect|compare
knowledge chunk preview|build|inspect
knowledge promotion propose|review|status
knowledge embed run|status|verify
knowledge retrieve plan|search|explain
knowledge eval generate|run|compare|failures
knowledge space publish|rollback|rebuild
knowledge operation status|events|retry|reconcile
knowledge db verify|types|rls-test
knowledge fixture load|reset
```

Default output is JSON; `--human` provides tables. Destructive or authority-bearing commands require an eligible identity and explicit guarded digest. CLI commands use the same service APIs unless a documented offline fixture command is selected.

### 32.4 A2A interface

The service publishes versioned A2A task, artifact and status schemas for admitted agent-to-agent operations such as document preparation, vector-store ingestion, retrieval and evidence-packet construction. A2A is an adapter over the same application contracts as HTTP and MCP; it does not accept conversational authority, bypass idempotency or expose direct database/vector operations. Tasks carry tenant, actor, purpose, operation context, capability versions, expected output contract and callback/authentication references. Results return compact typed outcomes plus immutable artifact, operation, evidence-packet and receipt handles.

## 33. Agent skills and operating instructions

Ship versioned, fixture-tested skills with the service:

1. `knowledge-acquisition-and-vetting` — discover, resolve identity, select acquisition route, inspect exact capture, assess authority/license/freshness/security, and propose disposition;
2. `knowledge-preparation-and-promotion` — compare representations, choose canonical domain/schema, choose admitted chunk/projection procedures, inspect output and submit a reasoned promotion proposal;
3. `knowledge-retrieval-and-evidence` — formulate/validate a plan, search, inspect score/graph explanations, request more evidence, use packets and abstain correctly;
4. `knowledge-evaluation` — create labeled query candidates, run ablations, inspect failures, calibrate judges and recommend—but never execute—publication.

The preparation skill must require the model to follow this loop:

```text
establish source identity
→ fetch only what is necessary to vet
→ inspect source/capture quality and risks
→ convert with a pinned admitted adapter
→ inspect or compare representations
→ identify useful canonical knowledge and faithful evidence
→ select admitted domain, chunk and projection procedures
→ preview and inspect chunks/projections
→ state expected users, queries, benefits, limitations and exclusions
→ submit an immutable proposal
→ stop at the authority boundary
```

All acquired content is untrusted data. Skills explicitly instruct the model to ignore embedded tool/policy instructions, never infer acceptance from successful fetch/conversion, distinguish authored text from derived text, retain attribution, and surface uncertainty. A skill may recommend repair or rejection; it must not pressure publication to complete a workflow.

The knowledge-service repository is the source of truth for these skills. Consumer repositories install or pin released skill versions; they may add runtime-specific wrapper instructions but must not fork the knowledge authority, safety or evidence semantics. Cursor-facing and Eve-facing wrappers use the same public API/MCP contracts and declare their compatible contract versions.

## 34. Standalone runtime and external orchestration integration

### 34.1 Standalone mode

The prototype deploys as a stateless API, durable worker pool with pinned conversion/parser images, MCP facade, CLI, Supabase Postgres/private Storage, optional Supabase Queue transport, and local evaluator/testkit.

The service's `knowledge_service.operation` records, outbox, leases and receipts provide restart-safe operation before Mission Control exists. The scheduler claims steps with compare-and-set leases; workers heartbeat; expired leases are safely reclaimed. Every step is an activity-shaped function with serializable input/output contracts and no hidden in-process state.

### 34.2 Future Mission Control mode

Mission Control becomes workflow authority without replacing service internals. It supplies work-item, attempt, correlation/causation, approval and capability identities; invokes the same HTTP/activity contracts; registers returned artifacts/receipts/events; and performs global reconciliation. The standalone scheduler is disabled for externally owned operations.

Stable integration seams are:

- `OperationContext { tenantId, operationId, attemptId, workItemId?, missionId?, correlationId, causationId, actor, capabilityVersion }`;
- immutable artifact and receipt references;
- state-transition events through transactional outbox;
- review-task/decision references with guarded digests;
- idempotent activities for acquire, convert, inspect, chunk, project, embed, index, retrieve, evaluate and reconcile;
- callbacks/webhooks signed and replay-protected.

Supabase triggers or queues do not become a second canonical orchestrator. Automatic embedding patterns may inform retry mechanics, but no canonical vector write exists without an operation intent, eligible executor, gate decision and receipt.

### 34.3 Eve/Vercel research-ingestion mode

The research-ingestion service calls the knowledge service as a peer through the published TypeScript client/HTTP API or remote MCP facade. Vercel Workflow owns durable execution inside the Eve lane; the knowledge service owns the durable internals of each accepted knowledge operation. The integration records both the external Eve/Vercel run identity and the knowledge operation identity without projecting every internal step from one runtime into the other.

Retry ownership is explicit: Vercel Workflow retries safe failure to call or observe the knowledge API; the knowledge service retries its admitted provider and processing steps; the caller never retries an ambiguous side effect without the same idempotency key. Webhooks or callbacks are signed and replay-protected. Eve session and turn state remain observational context and never substitute for a knowledge operation, publication decision or receipt.

For Mission Control-dispatched Eve work, Mission Control treats the Vercel Workflow run as an external durable operation and receives its aggregate outcome. Eve may make nested calls to the knowledge service using propagated correlation and authority context. Mission Control may also dispatch knowledge operations directly. These paths must converge on the same idempotency and guarded-publication rules rather than creating duplicate work.

## 35. Acquisition and processing capability admission

Fetchers, converters, chunkers, projectors, embedding adapters, rerankers and judges are capabilities with immutable versions. Admission requires owner, code/container digest, input/output schema, supported types, resource/egress envelope, secret references, deterministic/idempotency behavior, test fixtures, known failure modes, security review, lifecycle state and rollback version.

An agent chooses only from admitted versions. It cannot provide arbitrary converter code or a container image. Capability selection and fallbacks are recorded as proposals; the executor validates compatibility and policy.

Default acquisition routing:

| Source | Preferred | Fallbacks |
|---|---|---|
| Discovery/search | Tavily | Firecrawl search/map, approved search provider |
| Known web page | direct HTTP exact capture + Firecrawl extraction | rendered browser, manual upload |
| Public PDF/Office | direct capture + Unstructured Transform | pinned Docling Serve, Firecrawl parse, PyMuPDF/`pdftotext`, LibreOffice/Pandoc, OCR |
| JS application | direct response + rendered browser | Firecrawl Interact/browser, manual capture |
| Repository/code | forge API/git archive at exact commit | verified upload bundle |
| Paper | DOI/arXiv/OpenReview/publisher resolver + official bytes | recognized preprint/mirror with explicit assurance |
| Transcript/media | authored transcript/captions | timestamped ASR and human correction |

Tavily snippets are discovery artifacts, not canonical evidence. Provider-produced “raw” output is a provider representation unless byte equality to direct capture is demonstrated. Manual correction is a new representation linked by `corrects`/`derived_from`.

## 36. Security and content-safety requirements

### 36.1 Network and parser safety

- allow HTTP/HTTPS only; block loopback, link-local, private ranges, metadata endpoints and DNS rebinding;
- re-resolve and revalidate every redirect; cap redirects, bytes, time, decompression ratio and archive entries;
- prohibit arbitrary agent headers/credentials and enforce tenant egress allow/deny policy;
- sandbox parsers with read-only inputs, isolated temporary storage, CPU/memory/time limits, no ambient credentials and denied network unless specifically required;
- protect against path traversal, symlinks, malicious archives, parser exploits and document active content;
- scan captures and outputs for malware, secrets and sensitive/regulated data.

### 36.2 Prompt injection and model safety

Acquired text never changes system policy, tool authority or approval rules. Inspection identifies injection-like instructions and records exact locators/severity. Injected text may remain faithfully stored as content but is excluded from agent instructions and may require quarantine. Model tool calls are authorized from operation state and server policy, never from content strings.

### 36.3 Identity, secrets, and approval

Use least-privilege identities such as `pipeline_agent`, `verifier_agent`, `executor_service`, `control_plane`, and `app_reader`. Agent identities can read bounded inspection views and submit intents/proposals; deterministic executors materialize approved writes; control-plane/reviewer identities decide and publish.

Secrets are configuration references resolved only at final adapters. Logs, events, artifacts and model contexts are redacted. Approvals bind an exact guarded digest, eligible roles, quorum, expiry and rationale. Self-approval and approval after digest change fail.

### 36.4 Rights, privacy, and lifecycle

Record license, robots/terms observations, usage basis, sensitivity, PII state, retention, legal hold and deletion obligations without pretending automated observations establish legal permission. Retraction, correction, takedown or deletion propagates to eligibility and active publications. Provenance audit data is retained only to the extent permitted.

## 37. Observability, SLOs, cost, and reconciliation

Every stage emits correlated structured logs, traces, metrics, events and receipts. Minimum dimensions are tenant, operation/attempt, capability/version, adapter/provider, source/content class, document/representation/chunk set, vector-space version, retrieval policy, evaluation run, state and failure class.

Track acquisition/conversion/chunking/embedding throughput, latency, queue age and retries; conversion findings and locator coverage; chunk QA and rejection reasons; embedding tokens/cost/cache/provider route; indexed/published counts and ANN recall; retrieval stage latency/candidates/filter effects/coverage/abstentions; review backlog; gate failures; and reconciliation/rollback frequency.

Initial targets, refined after load testing:

- API availability 99.9% excluding documented provider degradation;
- no acknowledged operation lost;
- p95 synchronous retrieval under 1.5 seconds at prototype load excluding answer generation;
- 100% published rows reconcilable to projections, representations, source captures, decisions and receipts;
- cost budgets and circuit breakers per tenant/provider/job class.

Reconcilers compare Postgres, Storage, queues, provider attempts, pgvector rows/indexes and publication manifests. Findings are repairable, retryable, review-required or security-critical. Repairs are idempotent and produce receipts.

## 38. Testing and fixture corpus

### 38.1 Test tiers

1. **local isolated:** fake providers, deterministic fixture objects, SQL/RLS/unit/property tests;
2. **local cloud:** real configured providers against bounded fixtures, no canonical publication;
3. **canonical supervised:** approved sources, review and promotion gates, rollback-ready publication.

Promotion requires prior tiers in order. CI never depends on live arbitrary web content.

### 38.2 Required fixtures

Maintain versioned expected outputs for a complex born-digital PDF with tables/figures/formulas/footnotes/multi-column layout; scanned PDF; JS-rendered page and raw response; injected/boilerplate HTML; Office document; timestamped transcript; commit-pinned repository with tests/license/secret-like fixture; duplicate/revised/retracted sources; stale model/tool facts; selective tenant/domain/version filters; and a cross-domain technical-intelligence corpus.

### 38.3 Database and authorization tests

Fresh reset, generated-type compilation, schema lint, advisor checks and rollback rehearsal are mandatory. Tests prove cross-tenant FKs fail; roles cannot exceed grants; security-definer RPCs tenant-filter guessed UUIDs; invalid tenant context fails closed; immutable rows/members reject update/delete; supersession is one-way, same-tenant, non-self and acyclic; parent deletion cannot erase audit evidence.

### 38.4 Processing, embedding, and retrieval tests

Cover representation/artifact digest equality, one producing transformation, terminal-state immutability, fallback selection, low-confidence gating, node-tree integrity, span reconstruction, token limits, duplicates, contextual/source hash separation, idempotency and procedure changes.

Reject 1,535/1,537 dimensions from a 1,536 adapter. Verify input digest, route/model identity, retry deduplication, new immutable output on re-embedding, HNSW use with `EXPLAIN`, ANN recall against exact search and correct selective filtering.

Retrieval tests cover exact, conceptual, mixed, constraint, multi-hop, code, contradiction, freshness and negative queries; reproducible RRF; typed provenance; verified graph paths; reranker degradation; diversity; context-only labeling; filter post-verification; authorization; and abstention.

## 39. Operational runbooks

Document and rehearse acquisition provider outage/rate limit, changed capture/identity conflict, parser crash/malicious file, low-confidence conversion, broken tables/locators, partial embedding/provider mismatch, cost spike, HNSW failure/recall regression, stuck/poison job, expired lease/outbox backlog, approval digest invalidation, stale/retracted knowledge, false acceptance/cross-tenant incident, prompt injection, rollback, space rebuild, Storage loss and key compromise.

Each runbook specifies detection, containment, safe retry/repair, authority required, receipts, user impact, verification and post-incident evaluation-case additions.

## 40. Initial deployment topology and extraction rules

The `ai-engineer-knowledge-services` monorepo begins with only three required runtime boundaries:

1. **API/MCP entry points** — TypeScript deployments sharing the same application/domain packages, authentication and policy. They may be separate deployables while remaining one business-logic surface.
2. **Knowledge worker** — TypeScript durable worker handling long-running acquisition, conversion dispatch, inspection, chunking, embedding, evaluation, publication and reconciliation job types.
3. **Docling Serve** — pinned Python/container deployment isolated behind the TypeScript conversion-provider adapter. Unstructured Transform remains an external managed primary provider.

Retrieval initially executes in the API deployment. Evaluation, publication and reconciliation initially execute as worker job types. Extract a dedicated retrieval query service, evaluation worker, reconciliation worker or additional conversion pool only when load tests or operations demonstrate a material need for independent scaling, latency isolation, security boundary, runtime dependency, deployment cadence or failure containment. Extraction must preserve the same contracts, idempotency keys, authorization, artifacts and receipts; it must not fork business rules.

`ai-engineer-db-contract`—not this repository—contains and publishes the shared migrations, RLS/grant tests and generated database types. This repository may contain service integration tests and schema proposals/fixtures, but CI applies a pinned database-contract version to a fresh database and fails on drift.

Packages depend inward on contracts, application services, domain and policy. Provider adapters do not own domain rules. Mission Control and Eve/Vercel integrations are adapters over the same runtime contracts. Consumer repositories pin released contracts, TypeScript clients and skills rather than importing service internals through workspace-relative paths.

## 41. Implementation sequence and gates

### Gate 0 — contracts and migrations

Create the `ai-engineer-knowledge-services` monorepo structure and initial API/MCP, worker and Docling deployment manifests. Complete OpenAPI/JSON Schemas/A2A/events/state machines, including vector-store class and ownership identities. Submit additive migrations to `ai-engineer-db-contract`; apply its pinned package to a fresh database; generate types; pass tenant, RLS, grant, immutability and Storage-policy tests; document backfill/rollback.

### Gate 1 — immutable acquisition and conversion

Implement direct HTTP, configured Firecrawl, upload, repository and paper routes; the TypeScript conversion-provider contract; Unstructured Transform as the managed primary; pinned Docling Serve as fallback/reference; at least two relevant format-specific fallbacks; private content-addressed storage; inspection and fidelity reports; complete vet-only workflow without embeddings. Prove that provider-native and normalized outputs, job identifiers, versions, costs, digests and receipts are preserved and that managed-provider denial or outage routes deterministically to an allowed local capability.

### Gate 2 — agentic preparation

An agent can inspect alternatives, choose an admitted canonical domain, chunk/projection procedure, preview output, submit a complete reasoned proposal and revise it append-only. It cannot approve or publish. Independent policy/review binds the exact digest.

### Gate 3 — chunking and embedding

Implement the main content-class strategies, reconstruction/QA, Vercel AI Gateway embedding with secret isolation and idempotency, fixed-dimension pgvector storage, HNSW/exact comparison, atomic publication and immediate retrieval verification.

### Gate 4 — seven-domain retrieval

All seven public domains and internal faithful sections return typed explainable results. Exact/trigram, FTS, ANN, filtering, RRF, reranking, graph expansion, diversity, context, freshness, contradictions and abstention are independently switchable and recorded. Evidence packets pass immutability and support gates.

### Gate 5 — evaluation and regression

The reviewed query suite covers every domain/query class; deterministic, judge and sampled-human graders run; ablations are recorded; false-acceptance and regression gates block publication; previous version rollback is proven.

### Gate 6 — integration and operations

API/MCP/CLI/A2A/skills and the published TypeScript client are contract-tested; standalone restarts/reconciliation succeed; Mission Control correlation/event/receipt adapter tests pass without a Mission Control deployment; Eve/Vercel client, MCP, idempotency, callback and nested-correlation tests pass without absorbing Eve workflows into this repository; `aiengineerapp` can exercise a scoped retrieval contract without importing backend internals; security drills and end-to-end demonstration pass.

## 42. Definition of done

The maintained end-to-end proof asks:

> Show engineering guidance about durable agent state; identify the engineers and exact evidence; find maintained TypeScript libraries that implement the relevant patterns; return verified implementation examples; connect supporting or conflicting papers and case studies; identify model versions suited to the workflow; and identify benchmarks that could evaluate it.

The system must return query decomposition and hard constraints, multiple retrieval spaces, explicit graph paths, exact source locators, assurance and freshness, fit/non-fit explanations, contradictions/limitations, every score stage, and a reasoned abstention for unsupported subquestions. It must produce an immutable evidence packet plus acquisition, transformation, embedding, retrieval, evaluation and publication receipts.

The service is implementation-ready only when:

1. the same request can be retried without duplicate canonical objects, vectors or decisions;
2. every result reconstructs to an accepted source representation or typed canonical record;
3. an agent can inspect and exercise judgment but cannot bypass gates;
4. all seven domains and faithful sections are queryable alone and together;
5. advanced stages are measurable and removable through ablation;
6. held-out hard, quality and regression gates pass;
7. raw/derived objects remain private, immutable and digest-addressed;
8. provider/parser/database/queue/reranker failures leave reconciliable state;
9. a vector-space version can be rebuilt from canonical artifacts and receipts;
10. Mission Control can adopt execution authority without service/schema rewrite;
11. the Eve research-ingestion service can invoke the same operations directly through the TypeScript client/API or remote MCP, both standalone and under propagated Mission Control context, without direct canonical vector writes or duplicated publication logic;
12. official, exploratory and future user-managed store classes have distinct ownership, visibility and lifecycle identities and cannot silently cross authority boundaries;
13. API/MCP, worker and Docling deployments can be versioned and scaled independently while sharing one contract/application/domain implementation.

## 43. Deferred decisions

- final `halfvec` versus full-precision `vector` choice;
- default embedding model after the initial Gateway-backed prototype;
- default reranker and whether domains need specialized rerankers;
- knowledge-graph engine beyond Postgres typed edges;
- production use of Supabase Vector Buckets;
- multilingual FTS/tokenization and separate language spaces;
- automated rights classification and retention periods;
- very-large-corpus partitioning/sharding;
- user-feedback weighting and learning-to-rank;
- complete user-managed vector-store self-service UI, billing, quota marketplace and public rollout after the official flywheel-to-KB and agent-native core phases are proven.

Deferred items do not weaken provenance, tenant isolation, authorization, immutability, support or evaluation gates.

## 44. Official current references

Platform assumptions must be revalidated at implementation time. Primary references used for this specification:

- [Supabase automatic embeddings](https://supabase.com/docs/guides/ai/automatic-embeddings)
- [Supabase hybrid search](https://supabase.com/docs/guides/ai/hybrid-search)
- [Supabase HNSW indexes and iterative scans](https://supabase.com/docs/guides/ai/vector-indexes/hnsw-indexes)
- [Supabase RAG with permissions](https://supabase.com/docs/guides/ai/rag-with-permissions)
- [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys)
- [Supabase Storage bucket fundamentals](https://supabase.com/docs/guides/storage/buckets/fundamentals)
- [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
- [Supabase Queues](https://supabase.com/docs/guides/queues)
- [Supabase Edge Function limits](https://supabase.com/docs/guides/functions/limits)
- [Supabase Vector Buckets](https://supabase.com/features/vector-buckets)
- [Supabase vector storage](https://supabase.com/docs/guides/storage/vector/storing-vectors)
- [Vercel AI Gateway models and embeddings](https://vercel.com/docs/ai-gateway/models-and-providers)
- [Vercel AI Gateway](https://vercel.com/docs/ai-gateway)
- [Unstructured API developer guide](https://docs.unstructured.io/overview-developer-guide)
- [Unstructured Transform operations](https://docs.unstructured.io/api-reference/transform/overview)
- [Unstructured REST client setup](https://docs.unstructured.io/overview-rest-api)
- [Unstructured JavaScript/TypeScript SDK for the legacy Partition Endpoint](https://docs.unstructured.io/api-reference/legacy-api/partition/sdk-jsts)
- [Unstructured pricing](https://unstructured.io/pricing)
- [Docling supported formats](https://docling-project.github.io/docling/usage/supported_formats/)
- [Docling confidence](https://docling-project.github.io/docling/concepts/confidence_scores/)
- [Docling conversion API](https://docling-project.github.io/docling/reference/document_converter/)
- [Docling API server](https://docling-project.github.io/docling/usage/api_server/)
- [Docling MCP](https://docling-project.github.io/docling/usage/mcp/)
- [Docling TypeScript client and output libraries](https://github.com/docling-project/docling-ts)
- [Docling chunking](https://docling-project.github.io/docling/concepts/chunking/)
- [Firecrawl scrape](https://docs.firecrawl.dev/api-reference/endpoint/scrape)
- [Firecrawl parse](https://docs.firecrawl.dev/features/parse)
- [Firecrawl document parsing](https://docs.firecrawl.dev/features/document-parsing)
- [GitHub reproducible source archives](https://docs.github.com/en/repositories/working-with-files/using-files/downloading-source-code-archives)

## Appendix A — Promotion proposal minimum schema

```json
{
  "tenantId": "uuid",
  "operationId": "uuid",
  "proposalRevision": 1,
  "sourceVettingDecisionId": "uuid",
  "representationDecisionId": "uuid",
  "guardedManifestDigest": "sha256:...",
  "objectives": ["Answer version-constrained tool-selection questions"],
  "expectedUsers": ["AI engineer", "research agent"],
  "expectedQueries": [{"text": "...", "resultType": "tool_capability"}],
  "domainAssignments": [{"domain": "tool_capabilities", "target": "...", "reason": "..."}],
  "chunking": {"procedureVersionId": "uuid", "configDigest": "sha256:...", "reason": "..."},
  "projections": [{"procedureVersionId": "uuid", "space": "tool_capabilities", "reason": "..."}],
  "support": [{"locatorId": "uuid", "role": "supports"}],
  "risks": ["Upstream compatibility table may age quickly"],
  "limitations": ["Linux deployment only"],
  "excludedContent": [{"locatorId": "uuid", "reason": "Marketing boilerplate"}],
  "requestedPublicationClass": "exploratory",
  "proposer": {"actorId": "...", "model": "...", "promptVersion": "..."}
}
```

## Appendix B — Retrieval experiment matrix

| Arm | Lexical | Vector | Filters | Fusion | Rerank | Graph | Context |
|---|---:|---:|---:|---:|---:|---:|---:|
| exact baseline | yes | no | yes | no | no | no | no |
| vector baseline | no | yes | yes | no | no | no | no |
| hybrid | yes | yes | yes | RRF | no | no | no |
| hybrid + rerank | yes | yes | yes | RRF | yes | no | no |
| graph-aware | yes | yes | yes | RRF | yes | yes | no |
| full evidence | yes | yes | yes | RRF | yes | yes | yes |

Promotion compares the candidate to the currently published baseline on the same held-out dataset and exact eligibility snapshot.

## Appendix C — Requirements traceability

| Concern | Authoritative sections |
|---|---|
| Model-led fetching, conversion, inspection and choice | 14–18, 21–22, 32–35 |
| Non-trivial source vetting and promotion reasons | 12, 14–15, 26, Appendix A |
| Document/transformation/provenance model | 12–13, 19, 25 |
| Domain-aware chunks and GraphRAG-like relations | 20–22, 25.2, 27–29 |
| Vercel AI Gateway embeddings | 23 |
| Supabase pgvector/vector/storage choices | 24–25 |
| Seven retrieval needs | 9–11, 22, 29 |
| Advanced filtering/fusion/reranking/graph retrieval | 27–29 |
| Representative-query and model evaluation | 30, Appendix B |
| Separate repository and multi-consumer service boundary | 2, 32–34, 40–42 |
| Standalone now, Eve and Mission Control integration later | 2, 7–8, 34 |
| MCP, skills, API, CLI and A2A | 32–33 |
| Schema, migrations, RLS and immutability | 25 |
| Security, operations and tests | 36–39 |
| Implementation readiness | 40–42 |
