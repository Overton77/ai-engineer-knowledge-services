# AI Engineer Knowledge Services Capability and Module Reference

This reference explains what the service does, how its parts fit together, which interfaces are public, and which guarantees each module enforces. Use the operator runbook for commands. Use this document when deciding where a change belongs or which boundary another system should call.

## Service purpose

The knowledge service owns the lifecycle that turns an untrusted source into typed, retrievable, evidence-bearing knowledge:

```text
untrusted source
  -> admitted acquisition plan
  -> immutable digest-addressed capture
  -> conversion and fidelity inspection
  -> structural nodes and source locators
  -> reconstructable content-specific chunks
  -> evidence-bound domain projections
  -> append-only review proposal
  -> approved embedding run
  -> immutable vector-space version
  -> evaluation and promotion gates
  -> atomic publication pointer
  -> scoped hybrid retrieval
  -> immutable evidence packet
  -> regression monitoring or guarded rollback
```

Processing success never grants authority. Models and agents may inspect content, propose mappings, create supported derived material, and recommend actions. Deterministic services validate inputs and execute admitted work. Eligible reviewers and policy decisions bind exact guarded digests. Publication requires separate authority and passing evidence.

## Major service capabilities

### Source discovery and acquisition

The acquisition layer supports exact HTTP, Firecrawl, pre-registered manual uploads, immutable repository archives, and scholarly identifiers. Every adapter follows a plan, execute, verify contract. It records immutable bytes and safe observations rather than accepting provider output as canonical knowledge.

Network and parser safety include protocol, port, hostname, address, redirect, timeout, byte, decompression, archive expansion, file count, file size, traversal, symlink, media type, and identity checks. Direct HTTP connects to the policy-validated address while preserving the original Host header and TLS server name.

### Conversion and structural preservation

The conversion layer supports deterministic text, Markdown, HTML, JSON/XML, and transcript parsing. It also defines managed Unstructured Transform and local Docling boundaries. Provider-native, Markdown, and plain-text results are stored separately as immutable derivative artifacts.

Fidelity reports measure coverage, reading order, locator resolution, headings, tables, figures, formulas, code, citations, repeated blocks, empty nodes, and encoding anomalies. Fallback conversion creates a new representation and receipt rather than overwriting a failed or lower-quality result.

### Document identity and locators

Documents, document versions, source captures, representations, and structural nodes have separate identities. Nodes form validated acyclic trees with stable ordinals and deterministic digests. Source locators bind representation, node, offsets, optional page/time/section data, and quote digests.

### Content-aware chunking

The service provides seven versioned chunk strategies:

| Profile | Primary content |
| --- | --- |
| `transcript-topics-v1` | Timestamped transcript segments and topical continuity |
| `heading-sections-v1` | Heading-bounded prose sections |
| `atomic-claims-v1` | Small evidence-bearing claim units |
| `entity-facets-v1` | Entity attributes and aliases |
| `tool-capabilities-v1` | Capabilities, constraints, and use cases |
| `code-symbols-v1` | Repository symbols and implementation context |
| `table-row-groups-v1` | Header-aware table row groups |

Chunks preserve ordered spans back to source nodes. Source text and embedding text have different digests. QA verifies reconstruction, bounds, overlap, duplicate removal, boilerplate handling, token counts, and locator integrity.

### Typed projection spaces

The retrieval model has seven public knowledge domains plus a faithful internal space:

| Space | Represents |
| --- | --- |
| `engineering_claims` | Atomic engineering statements with attribution and limitations |
| `tool_capabilities` | Tool functions, constraints, and usage boundaries |
| `implementation_examples` | Language, framework, commit, path, and symbol-bound examples |
| `paper_case_study_knowledge` | Findings and qualifications from papers and case studies |
| `entity_profiles` | Canonical entity names, types, aliases, and facets |
| `model_capabilities` | Versioned model observations, abilities, limits, and observation time |
| `benchmark_intelligence` | Versioned protocols, metrics, and comparability warnings |
| `source_native_sections` | Faithful source sections without derived assertions |

Every projection requires evidence. Derived assertions reference known support locators. A source-native projection must equal the ordered quoted source evidence and cannot carry derived assertions.

### Embeddings and vector publication

The embedding package provides a deterministic fake and a Vercel AI Gateway adapter. The admitted live profile uses `openai/text-embedding-3-small` at 1,536 dimensions. It validates input digests, unique projection IDs, provider response order, output count, dimensions, finiteness, model, route, and vector digests. Receipts record usage, cost, latency, cache identity, retries, and manifests without secrets.

Vector backends include deterministic exact cosine search and a PostgreSQL half-vector adapter. Publication verifies source, representation, chunk, projection, embedding, vector, index, retrieval-policy, evaluation, and decision manifests. Activation and rollback change the active pointer atomically while preserving immutable versions.

### Hybrid retrieval and evidence packets

Retrieval is staged and independently switchable:

1. Tenant, space, visibility, lifecycle, promotion, and hard-filter eligibility.
2. Exact identifier and exact text matching.
3. Trigram-like lexical matching.
4. Full-text scoring.
5. Semantic vector search.
6. Weighted reciprocal-rank fusion.
7. Verified bounded graph expansion.
8. Optional reranking with deterministic fallback.
9. Per-source diversity.
10. Parent and neighbor context expansion.
11. Coverage, freshness, contradiction, and abstention checks.
12. Immutable evidence-packet assembly.

Raw lexical and vector scores are not summed. Reciprocal-rank fusion produces deterministic channel contributions and tie order. Context-only items cannot serve as proof. Missing required coverage yields explicit abstention.

An evidence packet records the normalized query, plan, authorization decision, members, locators, score components, graph paths, constraints, omissions, coverage, freshness, contradictions, supersession, artifacts, events, receipts, abstention, and a content digest.

The production API path is intentionally narrower than the complete package-level algorithm until every optional stage has canonical backing. `POST /v1/retrieval-runs` resolves an active tenant policy and active published vector-space pointers, generates provider embeddings server-side, runs database exact/FTS/trigram/ANN RRF, applies cross-space fusion and per-source diversity, and freezes only accepted-representation-locator-backed evidence. Missing requested publications force abstention. Unsupported graph, anchor, soft-boost, upper-temporal, or context semantics fail closed instead of silently weakening the plan. Optional reranker output must be a unique, finite, bounded subset of admitted fused candidates; malformed output degrades to deterministic fused ordering and is recorded.

### Evaluation and regression control

Evaluation supports frozen datasets, relevance judgments, expected filters, deterministic metrics, experiment matrices, ablations, hard gates, quality gates, regression comparison, false-acceptance checks, judge calibration, human sampling, and rollback proof.

The accepted broad corpus contains 96 cases:

- 32 development, 32 calibration, and 32 held-out cases.
- 12 cases for each public domain and source-native sections.
- 11 query classes.
- 30 real-bundle-grounded, 54 labeled synthetic-gap, nine reviewed-negative, and three adversarial cases.

The system under evaluation receives only the public query and explicitly requested spaces. Hidden labels, qrels, expected filters, and expected result types cannot influence execution. A poisoning regression mutates those evaluation-only fields and requires identical actual packet digests and results.

The Gate 5 human-review mechanism uses a fixed 24-case sample, opaque case/result/graph identities, bounded evidence excerpts, full-text digest bindings, hidden references, complete packet rebuilding, and out-of-band reviewer identity verification. It cannot grant publication authority.

### Durable operations and reconciliation

Canonical persistence supports tenant-scoped operations, steps, events, receipts, reviews, leases, outbox messages, vector publications, hybrid search, artifacts, and normalized evidence packets.

Leases use opaque tokens and monotonically increasing fencing tokens. Stale holders cannot heartbeat, complete, or fail a reclaimed step. Outbox claim extension, acknowledgement, and negative acknowledgement require the current owner and token. Capability tokens are not serialized into events or outbox payloads.

### External integration

The service exposes HTTP, MCP, CLI, TypeScript client, A2A contracts, signed callbacks, and versioned skills. Mission Control and Eve remain callers. Their correlation and execution identities are stored as lineage; they do not own knowledge-service state or bypass its policy.

## Runtime applications

### HTTP API

Location: `apps/api`

Purpose:

- Expose the v1 Fastify HTTP contract.
- Authenticate local bearer identities.
- Authorize actions by tenant role and scope.
- Enforce actor, tenant, and correlation binding.
- Admit and inspect generic operations.
- Validate retrieval plans.
- Execute the bounded three-bundle demonstration.
- Read durable evidence packets when PostgreSQL is configured.
- Read artifacts, receipts, retrieval runs and explanations, evaluation reports and failures, and vector-store-scoped operation status from their canonical PostgreSQL identities.
- Admit authenticated A2A tasks through the same operation port and receive tenant/lineage/task-bound signed callbacks exactly once.

Primary files:

- `src/index.ts` loads server configuration, creates the PostgreSQL operation service, canonical resource reader, and packet resolver when configured, and starts Fastify.
- `src/server.ts` defines routes, validation, problem responses, and operation dispatch.
- `src/retrieval-executor.ts` owns canonical API-deployment retrieval: policy/publication resolution, service-generated query embeddings, hybrid/cross-space fusion, reranker validation/fallback, diversity, evidence binding, abstention, immutable persistence, and deterministic operation receipts.
- `src/a2a-http.ts` registers A2A task/callback routes and resolves tenant-scoped signing-key references without exposing secrets to contracts or persistence.
- `src/auth.ts` defines actions, roles, token resolution, authorization, and actor matching.

Public exports include `buildServer`, `ServerOptions`, `API_ACTIONS`, `API_ROLES`, `createLocalIdentityResolver`, `isAuthorized`, and `actorsMatch`.

Security behavior:

- Missing identity configuration denies protected routes.
- Tokens are hashed for lookup and must contain at least 16 characters.
- A token maps to exactly one contract actor and one or more tenant grants.
- Headers cannot claim actor, role, or scope.
- Mutations fail if authenticated actor, tenant, or correlation differs from the envelope.
- Validation failures use typed `application/problem+json` responses.
- Canonical resource reads use the authenticated tenant in every SQL transaction, validate UUID path identities, conceal cross-tenant existence, and enforce a serialized response bound.
- Artifact reads expose immutable metadata but never Storage bucket paths or bytes. Receipt reads verify that a successful receipt's guarded output digest agrees with its immutable success event.
- Callback receipt requires bearer scope plus constant-time HMAC verification, payload integrity, freshness, immutable task/key binding, and operation lineage before atomically consuming durable replay state.
- Retrieval input is strict `{ plan }`; arbitrary client embeddings and candidate/evidence payloads are rejected. A missing Gateway credential leaves unrelated durable API capabilities available while retrieval fails with 503 before operation admission.
- Worker leasing is restricted to activity-registry operation kinds, so a production worker cannot race the API for an API-owned `retrieval_run`; explicit API claims remain possible.

Current boundary: with `POSTGRES_URL`, generic API and MCP operation admission, status, events, cancellation, retry, reconciliation, and canonical detail reads are PostgreSQL-backed and visible across processes. Without it, API operation state is intentionally process-local for development while canonical detail routes return `503`; MCP requires PostgreSQL rather than silently using a second ledger.

Tests: `auth.test.ts`, `server.test.ts`, `retrieval-executor.test.ts`, `resource-reads.test.ts`, `durable-server.test.ts`, `a2a-http.test.ts`, and `a2a-durable.test.ts` cover deny-by-default behavior, tenant and actor isolation, strict retrieval input, reranker boundary validation, problem responses, idempotency, status/events, plan validation, packet reads, resource identity semantics, response bounds, cross-connection reads, nested A2A lineage, callback tamper/replay rejection across a restart, and the exact three-bundle allow-list. `scripts/prove-canonical-retrieval-api.ts` is the real local PostgreSQL/API proof for active publication search, immutable locator-backed packet materialization, replay, tamper rejection, cross-tenant concealment, missing-space abstention, and unsupported-stage failure.

### MCP server

Location: `apps/mcp`

Purpose:

- Expose 37 bounded workflow tools over Streamable HTTP.
- Reuse the operation context and mutation contract.
- Keep database, secret, Storage, approval, and publication capabilities unavailable.

Primary files:

- `src/catalog.ts` maps tool names to operation kinds and lists forbidden capabilities.
- `src/index.ts` creates the MCP server and bearer-protected Fastify endpoint.

Every tool input contains `context`, JSON `input`, and `expectedVersions`. Mutation tools return an accepted durable operation. Status, explanation, failure inspection, plan validation, and chunk-procedure tools return their typed read/validation result and never create an operation. The server is stateless at the MCP transport level and creates no session ID.

MCP is a first-party transport over the shared PostgreSQL-backed operation application port and owns no operation ledger or domain logic. Admitted worker mutations use that durable port; canonical reads, plan validation, and API-owned retrieval use the typed API client so their behavior is identical to HTTP. Its bearer is resolved using the same configured identity map as HTTP; the context tenant and actor must match that identity's grant. Accepted-operation links point to the configured API origin, where status and control routes read the same canonical records. Deferred tools fail with `CAPABILITY_NOT_ADMITTED` before admission.

Test: `catalog.test.ts` verifies the complete admitted catalog and forbidden capabilities.

### Command-line interface

Location: `apps/cli`

Purpose:

- Provide machine-readable developer and operator access to the HTTP client.
- Map a compact command tree to operation kinds.
- Read status/events and request retry/reconciliation.

Primary files:

- `src/commands.ts` contains the command map.
- `src/index.ts` parses flags, validates context/input JSON, invokes `KnowledgeClient`, and prints JSON.

The CLI emits compact JSON by default and formatted JSON with `--human`. It requires `KNOWLEDGE_API_TOKEN` and either `KNOWLEDGE_API_URL` or `--base-url`.

The CLI dispatcher is semantic rather than name-only. `store show`, store/embedding/promotion/operation status, operation events, retrieval explanations, and evaluation failures are typed reads using caller-supplied resource IDs. `retrieve plan` performs validation without admission, while `retrieve search` uses the API-owned canonical executor. Admitted mutations come from `productionWorkerOperationKinds`; vector-store creation and document attachment use their typed HTTP client methods. Deferred commands such as generic vector-store search and space rebuild fail before admission.

Test: `commands.test.ts` verifies the versioned 12-group command tree.

### Durable worker

Location: `apps/worker`

Purpose:

- Poll and reconcile canonical operations.
- Claim fenced leases and heartbeat running work.
- Record deterministic success receipts or typed retryable failures.
- Drain active work during shutdown.

Primary exports:

- `startWorker`
- `CanonicalDurableKnowledgeWorker`
- `DurableKnowledgeWorker`
- `CanonicalActivityRegistry`
- `createProductionActivityRegistry`
- `createCanonicalActivityExecutor`

PostgreSQL is the default. Memory mode is allowed only when `NODE_ENV` is `development` or `test`. Startup reconciles tenant operations before polling. The heartbeat interval is approximately one third of the configured lease duration, with a 250 ms minimum.

The bootstrap uses a fail-closed operation-kind and step-name registry. Queue polling supplies the registry's admitted operation kinds to PostgreSQL, so the worker cannot lease API-owned `retrieval_run` work; explicit operation claims remain available to the owning API. Every activity validates the immutable operation request, persisted step input, tenant/operation/idempotency identities, expected contract versions, request and input digests, and JSON-serializable output before a success receipt can be recorded. The startup event lists the exact registered activities.

The registry implements durable paths for exact HTTP acquisition and capture sealing, routed structural conversion and fidelity inspection, candidate chunk materialization and verification, source vetting (including immutable human-review subjects), dataset freezing, retrieval evaluation/reporting, exact-versus-ANN vector-store evaluation, publication verification, and evidence-packet persistence. Preparation writes flow through `PostgresPreparationRepository`, which atomically verifies immutable artifact, source/capture, document/version, representation, node, lineage, procedure, chunk, and span identities on first execution and replay. Operations that still require an unimplemented canonical adapter or an authorization-bearing publication/review command fail once with `UNSUPPORTED_OPERATION_ACTIVITY`; they are not retried and never receive a false success receipt.

Tests: `worker.test.ts` and `activity-registry.test.ts` cover mode admission, leases, heartbeats, execution, identity/digest binding, JSON output enforcement, deterministic retry, review-subject creation, fail-closed dispatch, the capture-to-chunk preparation path, reconciliation, shutdown behavior, and cross-process expired-lease recovery. Opt-in PostgreSQL tests cover live durable operations plus immutable preparation replay and tamper rejection.

## Shared packages

### Contracts

Package: `@aiengineer/knowledge-contracts`

Location: `packages/contracts`

Responsibility: strict runtime and TypeScript contracts for every public and persistence boundary.

Modules:

- `primitives.ts`: UUIDs, ISO dates, SHA-256 digests, JSON values, immutable resources, artifact references, record references, locators, and problem details.
- `identity.ts`: actors, service identities, external execution lineage, operation context, and authorization decisions.
- `integration.ts`: operation kinds, mutation envelopes, accepted/status responses, callback envelopes, and exact exploratory bundle descriptors.
- `content.ts`: sources, captures, documents, versions, representations, nodes, vetting, and representation evaluation.
- `transformation.ts`: transformation runs, execution states, and capability admission.
- `chunking.ts`: chunk sets, chunks, spans, and chunk edges.
- `spaces.ts`: store classes, vector stores, domains, and typed projections.
- `publication.ts`: search projections, embedding items/runs, and vector publications.
- `retrieval.ts`: plans, results, score components, and evidence packets.
- `evaluation.ts`: datasets, cases, runs, metrics, gate results, and judge outputs.
- `governance.ts`: model proposals, decisions, publication intents, receipts, and events.
- `a2a.ts`: preparation, ingestion, retrieval, and packet task/status/result schemas.
- `service.ts`: readiness status.

Strict Zod objects reject unknown fields. Every mutation includes tenant, operation, attempt, actor, capability version, idempotency key, reason, contract version, and correlation. Generated outputs are `generated/openapi.json`, nine JSON Schemas, and `generated/manifest.json`.

### Domain

Package: `@aiengineer/knowledge-domain`

Location: `packages/domain`

Responsibility: pure deterministic rules shared across every adapter.

Important exports:

- `canonicalJson`, `sha256Digest`, and `deepFreeze`.
- Idempotency-key construction and replay checks.
- Authority compatibility and canonical publication checks.
- Source-native integrity and append-only checks.
- Operation, promotion, and publication state machines.
- `DomainInvariantError`.

Models cannot decide or publish. Official-canonical publication requires eligible authority. State transitions require an exact row version and guarded digest. Terminal states cannot silently reopen.

### Runtime

Package: `@aiengineer/knowledge-runtime`

Location: `packages/runtime`

Responsibility: immutable artifact stores, deterministic IDs, and an in-memory operation ledger.

Artifact stores:

- `InMemoryArtifactStore` for unit tests and bounded local flows.
- `LocalArtifactStore` for digest-addressed filesystem artifacts.
- `SupabaseArtifactStore` for private tenant/digest object paths.

Artifact reads recompute SHA-256. Local storage rejects path escape. Supabase writes use no-upsert semantics and bounded reads. A replay after local metadata reset can restore only byte-identical content and re-verifies it.

`InMemoryOperationLedger` manages operations, ordered steps, leases, events, receipts, cancellation, retry, reconciliation, and snapshots. Replay with changed input or output fails. Completion requires a current lease token.

### Acquisition

Package: `@aiengineer/knowledge-acquisition`

Location: `packages/acquisition`

Responsibility: plan, execute, and verify acquisition without granting promotion authority.

Adapters:

- `ExactHttpAcquisitionAdapter`: SSRF-safe DNS resolution, socket pinning, Host/SNI preservation, redirect revalidation, response bounds, and immutable exact bytes.
- `FirecrawlAcquisitionAdapter`: secret-reference resolution, target and API-host policy, redirect denial, bounded response handling, provider-field redaction, and multiple sealed representations.
- `BoundedManualUploadAdapter`: registered upload identity, relative-path normalization, digest/media/size checks, and operator attestation.
- `ImmutableRepositoryAcquisitionAdapter`: exact commit SHA, provider-resolved identity, archive and expansion bounds, traversal/symlink denial, source-path inventory, license/lockfile/LFS/submodule observations, and secret-like finding classes without secret values.
- `IdentityBoundPaperAcquisitionAdapter`: DOI, arXiv, and OpenReview normalization, provider identity matching, revisions, corrections, and representation metadata.
- `FixtureAcquisitionAdapter`: deterministic tests.

The common types are `AcquisitionRequest`, `AcquisitionPlan`, `AdmittedAcquisitionPlan`, `AcquisitionResult`, `AcquisitionVerification`, and `AcquisitionAdapter`.

### Conversion

Package: `@aiengineer/knowledge-conversion`

Location: `packages/conversion`

Responsibility: deterministic and provider-backed structural conversion with immutable output lineage.

Important exports:

- `DeterministicTextConversionProvider`
- `convertTextToNodes`
- `inspectConversion`
- `UnstructuredTransformProvider`
- `DoclingServeProvider`
- `ConversionRouter`
- `HttpUnstructuredTransformClient`

The Unstructured client performs bounded job creation, polling, and download. Managed processing must be explicitly allowed. The router records candidate order, attempts, failure classes, selected provider, and fallback use. `CONVERSION_EXHAUSTED` means no admitted route succeeded.

`HttpDoclingServeClient` implements the stable synchronous multipart v1 endpoint with loopback-or-HTTPS URL policy, optional `X-Api-Key` authentication, deterministic filenames, Markdown/JSON/text output requests, request timeout, bounded response streaming, and response validation. `DoclingServeProvider` seals those outputs. The default worker startup still must register a conversion activity and construct the provider before operations invoke it.

### Documents

Package: `@aiengineer/knowledge-documents`

Location: `packages/documents`

Responsibility: normalized structural documents and replayable locators.

Important exports:

- `convertStructuralDocument`
- `normalizeDocumentText`
- `createSourceLocator`
- `reconstructNodeSpan`
- `verifyNodeLocators`

The module validates unique local keys, known non-self parents, acyclic trees, unique sibling ordinals, offset bounds, locator identity, and quote digests. Code and table whitespace receive conservative normalization.

### Chunking

Package: `@aiengineer/knowledge-chunking`

Location: `packages/chunking`

Responsibility: versioned content-specific chunk construction and QA.

Important exports:

- `ChunkProfileRegistry`
- `defaultChunkProfileRegistry`
- `chunkDocument`
- `reconstructChunk`
- `validateChunks`
- `tokenize`

Profiles define strategy, target spaces, token bounds, overlap, context behavior, duplication thresholds, and procedure version. Chunks contain source spans, locators, source/embedding text, separate digests, token counts, roles, and lifecycle.

### Projections

Package: `@aiengineer/knowledge-projections`

Location: `packages/projections`

Responsibility: create and classify evidence-bound retrieval projections.

Important exports:

- `validateEvidenceSupport`
- `createProjection`
- `classifyProjectionSpaces`
- `publicProjectionSpaces`

Projection identity derives from source record, procedure, space, text, and support digest. Public canonical classification requires evidence, deduplication keys, and resolved entity identities. `not_ingestible` cannot coexist with an ingestible disposition.

### Application

Package: `@aiengineer/knowledge-application`

Location: `packages/application`

Responsibility: compose use cases while keeping transports thin.

Submodules:

- `index.ts`: `createKnowledgeApplication` and readiness status.
- `preparation.ts`: `KnowledgePreparationService`, `vetOnly`, `preparePreview`, and `AppendOnlyCurationProposalStore`.
- `knowledge.ts`: `AgenticKnowledgeService`, exploratory index construction, retrieval, evaluation, and the default retrieval policy.
- `surface.ts`: process-local `KnowledgeIntegrationService`, operation step plans, status/events/control, execution, and snapshots.
- `a2a-adapter.ts`: asynchronous A2A-to-operation mapping, tenant/lineage-bound HMAC signing, payload/freshness validation, process-local replay guard, and an allow-listed authenticated HTTP result sender that rejects redirects and target substitution.

`vetOnly` checks bundle schema, store class, source URL, content, entity anchors, and target spaces. `preparePreview` seals source bytes, converts, builds structural nodes, chunks, validates source-native projections, creates supported engineering-claim projections, and emits append-only proposals. It explicitly stops before embedding or publication.

`AgenticKnowledgeService` takes the approved next step for the bounded exploratory bundle flow: it embeds claim projections, creates an exact index, retrieves evidence, and evaluates results. It accepts only `internal_exploratory` bundles.

### Embeddings

Package: `@aiengineer/knowledge-embeddings`

Location: `packages/embeddings`

Responsibility: provider-neutral embedding and verifiable receipts.

Important exports:

- `VercelAiGatewayEmbeddingAdapter`
- `DeterministicFakeEmbeddingAdapter`
- `createGatewayEmbeddingAdapterFromEnvironment`
- `MemoryEmbeddingCache`
- Vector validation and digest helpers.

The adapter supports model discovery, single and ordered batch embedding, idempotency headers, transient retry policy, digest-keyed caching, and safe receipts. A response is rejected for count, order, dimension, finiteness, model, route, or input-digest mismatch.

### Vector backends

Package: `@aiengineer/knowledge-vector-backends`

Location: `packages/vector-backends`

Responsibility: exact search, PostgreSQL search, and publication lifecycle.

Submodules:

- `types.ts` fixes canonical vectors at 1,536 finite dimensions and bounds search limits.
- `in-memory-exact.ts` supplies deterministic exact cosine search.
- `postgres.ts` calls the canonical PostgreSQL search RPC and serializes half-vectors.
- `publication.ts` supplies `ExploratoryPublicationCoordinator`, an in-memory reference repository, guarded activation, rollback, and reconciliation.

The publication coordinator only admits `internal_exploratory`. It verifies every manifest and sample search before atomic activation. Rollback re-inspects the immutable target before switching the pointer.

### Retrieval

Package: `@aiengineer/knowledge-retrieval`

Location: `packages/retrieval`

Responsibility: deterministic multi-stage retrieval and evidence-packet assembly.

Important exports:

- `buildRetrievalPlan`
- `retrieve`
- `RetrievalPolicy`
- `RetrievalRecord`
- `GraphEdge`
- `Reranker`
- `RetrievedCandidate`
- `ImmutableEvidencePacket`

Candidate eligibility applies before ranking. Filter fields and graph edges must be policy-allowed. Graph edges require verification and provenance binding. Reranker failures fall back to fused results and mark degraded mode. Source diversity and context expansion cannot promote an ineligible record.

### Evaluation

Package: `@aiengineer/knowledge-evaluation`

Location: `packages/evaluation`

Responsibility: reviewed datasets, metrics, experiments, gates, rollback, and human audit.

Important exports:

- Candidate/review digest construction and dataset freezing.
- Partition leakage audit.
- `evaluateRetrieval`.
- Experiment matrix construction and execution.
- Promotion gate evaluation.
- Rollback proof.
- Gate 5 human packet, template, reference binding, and validation.

Metrics include Recall@K, Precision@K, MRR, nDCG@K, filter satisfaction, abstention accuracy, citation correctness, false acceptance, latency, and cost.

The human validator requires a complete externally verified reviewer submission. Any uncertainty or disagreement produces follow-up. The receipt cannot authorize publication.

### Persistence

Package: `@aiengineer/knowledge-persistence`

Location: `packages/persistence`

Responsibility: canonical PostgreSQL operations and private Supabase Storage wiring.

Important exports:

- `PostgresCanonicalRepository`
- `PostgresCallbackReplayStore`
- `PostgresKnowledgeOperationService`
- `stageExploratoryVersion`
- `canonicalPersistenceConfigFromEnvironment`
- `createCanonicalPersistence`
- `createCanonicalPersistenceFromEnvironment`

`PostgresCanonicalRepository` additionally resolves active retrieval policies/publications, executes the security-definer hybrid RPC, loads canonical projection evidence with accepted representation locators, and atomically persists a retrieval execution. Replay compares the complete immutable plan/run/candidate/source/packet content and exact row cardinalities; a reused identity with changed content fails with `IDEMPOTENCY_CONFLICT`.

Repository operations include:

- Create/get/reconcile operations and list steps.
- Claim/heartbeat/complete/fail fenced leases.
- Claim/extend/ack/nack fenced outbox messages.
- Create review subjects and guarded decisions.
- List immutable receipts.
- Publish and roll back vector spaces through database functions.
- Hybrid, ANN, and exact search.
- Record immutable artifact metadata.
- Store and reconstruct normalized evidence packets.
- Read an artifact or durable activity receipt by its own UUID, with explicit tenant filtering and receipt-event digest consistency checks.
- Reconstruct retrieval run metadata from its normalized plan and bounded packet references.
- Reconstruct bounded retrieval explanations from ranked candidates and per-channel candidate-source rows.
- Read evaluation reports from metric/gate rows and failed cases from score/output rows.
- Verify that an operation's immutable request is bound to a requested vector-store UUID.
- Atomically record digest-only callback delivery receipts in the append-only, RLS-protected replay ledger.

Every transaction sets tenant-local database context. Local-only mode accepts only localhost PostgreSQL port 54322. Evidence-packet storage checks the packet digest, retrieval run-to-plan binding, query, members, locators, and referenced canonical or source-native records.

### Policy

Package: `@aiengineer/knowledge-policy`

Location: `packages/policy`

Responsibility: service authorization, capability admission, retrieval policy, and promotion policy.

Important functions:

- Actor/action authorization.
- `requireAdmittedCapability`.
- Retrieval-plan policy validation.
- Promotion-decision validation.

Curator and inspection models can propose but cannot decide or publish. Capabilities must match exact kind, version, and admitted lifecycle. Promotion requires a matching guarded digest and all referenced gates to exist and pass.

### Observability

Package: `@aiengineer/knowledge-observability`

Location: `packages/observability`

Responsibility: in-memory telemetry and deterministic reconciliation diagnostics.

`InMemoryTelemetry` calculates availability, p50/p95/p99 latency, error and degraded rates, tokens, cost, and sample count. `reconcileManifests` finds count drift, digest drift, active-pointer errors, missing vectors, and orphan vectors and produces a deterministic report digest.

### TypeScript client

Package: `@aiengineer/knowledge-client`

Location: `packages/client-typescript`

Responsibility: public cross-repository HTTP access and contract exports.

Important classes:

- `KnowledgeClient`
- `ScopedKnowledgeClient`
- `KnowledgeClientError`

Client methods cover plan validation, source discovery/resolution/vetting, transformations, chunks, promotion, embeddings, vector publication and rollback, vector-store search/evaluation, retrieval, evaluation, operations, evidence packets, reports, A2A task admission, and signed callback submission. The scoped client binds one operation context.

The client URL-encodes resource IDs, sends bearer/tenant/correlation headers, propagates external Eve lineage headers, validates success responses, and parses typed problem details.

### Testkit

Package: `@aiengineer/knowledge-testkit`

Location: `packages/testkit`

Responsibility: real-bundle loading, frozen broad corpus, deterministic retrieval fixtures, and operational artifacts.

The three exact bundle IDs are `kTnfJszFxCg`, `bk0TmxoZlUY`, and `rmvDxxNubIg`. The loader discovers the sibling research-starter seed or imported standalone fixtures, validates bundle schema and contents, and requires `internal_exploratory`.

Broad-corpus helpers construct the candidate, bind independent review, freeze the dataset, create public requests, plan without evaluator labels, execute hybrid-control packets, run ablations, evaluate gates, and prove rollback.

### Configuration

Package: `@aiengineer/knowledge-config`

Location: `packages/config`

Responsibility: validate `NODE_ENV`, `HOST`, `PORT`, and `LOG_LEVEL` with Zod.

## Database contract

The canonical schema lives in the adjacent `ai-engineer-db-contract` repository. The knowledge-service migrations are additive.

| Migration | Main capability |
| --- | --- |
| `20260903010000_knowledge_content_contract.sql` | Sources, captures, documents, versions, transformations, representations, nodes, conversion evaluation, decisions, and lineage |
| `20260903010100_knowledge_retrieval_contract.sql` | Stores, spaces, chunking, projections, embeddings, halfvec vectors, HNSW, promotions, publications, retrieval policies, and evaluation |
| `20260903010200_knowledge_runtime_security.sql` | Operations, steps, events, receipts, outbox, leases, reviews, RLS, immutability, and ANN API |
| `20260903010300_knowledge_retrieval_completeness.sql` | Entity/claim/concept/citation links, candidate-stage sources, qrels, expected filters, and judge outputs |
| `20260903010400_atomic_publication_and_hybrid_retrieval.sql` | Atomic publish/rollback functions, lexical indexes, bounded hybrid RRF |
| `20260903010500_outbox_claiming_and_packet_materialization.sql` | Fenced outbox functions and normalized evidence-packet members |
| `20260903010600_source_native_packet_members.sql` | Faithful source-native packet members and evidence gate |
| `20260903010700_packet_member_tenant_targets.sql` | Tenant-composite packet references and explicit tenant filtering |

Database guarantees include tenant-composite foreign keys, row-level security, no client vector-table access, immutable captures/events/receipts/publications, atomic active-pointer changes, deterministic search tie order, accepted source-native or eligible projection evidence, and owner/token-fenced outbox delivery.

Tests live under `ai-engineer-db-contract/supabase/tests` and currently contain 74 pgTAP assertions.

## Agent skills

The versioned skill manifest is `skills/manifest.json`. Every skill is version 1.0.0 and uses `knowledge-service/v1`.

| Skill | Responsibility and stopping rule |
| --- | --- |
| `knowledge-acquisition-and-vetting` | Resolve source identity, acquire minimally, inspect immutable capture, assess risk/freshness/rights, propose vetting, then stop before acceptance |
| `knowledge-preparation-and-promotion` | Convert, compare representations, select domain/chunk/projection procedures, produce an immutable proposal, then stop before approval/publication |
| `knowledge-retrieval-and-evidence` | Build a scoped plan, inspect independent channels, preserve locators, separate context from proof, and abstain when support is insufficient |
| `knowledge-evaluation` | Freeze datasets, separate deterministic/model/human graders, run ablations and regression gates, and report failures without self-approval |
| `vector-store-management` | Preserve store classes, idempotency, lineage, and guarded lifecycle operations; never grant an agent direct vector write or approval authority |

## Provider and infrastructure boundaries

### Vercel AI Gateway

Used by the embedding adapter and live judge script. Credentials are resolved at the final adapter. Provider model/route, dimensions, usage, cost, latency, input/output manifests, and retry history are recorded in safe receipts.

### Firecrawl

Used as an acquisition provider for an approved target. Its output is an observation and derivative artifact, not a promotion decision. Provider redirects are denied, response bodies are bounded, secret-shaped fields are removed, and every emitted representation is sealed.

### Unstructured Transform

Preferred managed structural converter when configured and policy allows managed processing. It has a concrete asynchronous HTTP client with bounded polling and downloads. Absence is reported as `not_configured` rather than replaced by a false live claim.

### Docling Serve

Pinned local fallback under `services/docling`. The Compose service binds to loopback, drops capabilities, uses a read-only root, denies privilege escalation, and has resource limits and a health check. The deployment platform must add outbound network denial. Docling owns conversion only. The TypeScript HTTP client calls `POST /v1/convert/file`; runtime composition remains responsible for registering it behind the conversion activity.

### AWS

`infra/aws/knowledge-runtime.template.json` is a deployable CloudFormation package for the durable worker and pinned Docling containers. It provisions independently scalable ECS/Fargate services, private TLS-only Docling routing, source-restricted Docling ingress, Secrets Manager injection, retained CloudWatch logs, task and target health controls, deployment rollback, alarms, and separate least-privilege task identities. Outbound rules are port/protocol constrained but target `0.0.0.0/0`, so destination restriction requires controlled NAT/egress filtering or private endpoints in the target environment. Parameters require digest-pinned images and existing private-network/certificate resources. AWS accepted the template through `cloudformation validate-template`; no managed stack was created by repository verification.

### Vercel API and MCP

`apps/api/vercel.json` and `apps/mcp/vercel.json` define separate Fluid Compute projects. Each service exports a side-effect-free default Node handler backed by a warm singleton runtime and retains a guarded direct-execution listener for local/container operation. API production startup fails closed without PostgreSQL or an HTTPS public origin; MCP additionally uses that API origin for every returned operation link. Gateway credentials are capability-conditional so provider outage does not take unrelated API endpoints offline.

### OpenAPI parity

`packages/contracts/generated/openapi.json` contains all 73 registered HTTP operations and its schemas are generated from the runtime Zod contracts. Each operation has an `x-fastify-route` mapping. API tests observe actual Fastify registrations and compare both sets in both directions, while contract tests resolve every local `$ref`. This makes route drift and invalid embedded JSON Schema references CI failures.

## Cross-repository consumers

### Vercel Eve knowledge consumer

Location: `research_ingestion_systems_agent/agents/knowledge-consumer`

The consumer imports only `@aiengineer/knowledge-client` and exposes one authored Eve tool, `consume_knowledge`. Broad default tools are disabled. It can validate a retrieval plan, create a retrieval run, read an operation, read an evidence packet, and run the exact three-bundle evaluation.

It propagates Eve session, turn, tool-call, root-run, and parent-run identity. It cannot write SQL, write vectors, read raw secrets, or claim that exploratory evidence is canonical or semantically verified.

### AI Engineer application acceptance

Location: `aiengineerapp/acceptance`

The harness proves the application can consume an evidence packet through the published client without importing backend, database, persistence, or vector modules. It checks bearer auth, tenant isolation, correlation, strict parsing, and render mapping. It supports a loopback fixture and a live persisted-packet mode.

## Catalog and proof artifacts

| Artifact | Evidence |
| --- | --- |
| `capability-profiles.v1.json` | Pinned/admitted conversion, embedding, and retrieval profiles |
| `real-bundle-evaluation.json` | Three bundles, 37 documents, 41 projections/vectors, deterministic metrics |
| `broad-corpus-review-v4.json` | Independent review bound to the exact evaluation candidate |
| `broad-corpus-review-history.json` | Preserved rejection and correction history |
| `broad-heldout-evaluation.json` | 96-case experiment, ablations, gates, false acceptances, and rollback |
| `live-embedding-receipt.json` | Live Gateway model, route, dimensions, ordering, usage, cost, and digests |
| `live-judge-calibration-receipt.json` | Bounded live model-judge calibration |
| `live-docling-receipt.json` | Real pinned Docling Serve multipart conversion, sealed outputs, structural nodes, and fidelity metrics |
| `gate1-live-evidence.json` | Exact HTTP, Firecrawl, and conversion fallback evidence |
| `canonical-durability-proof.json` | Separate processes, PostgreSQL/Storage reconstruction, publication, rollback, failure drills, and HTTP client |
| `durable-preparation-proof.json` | Live HTTPS acquisition, separate private source/derivative Storage, PostgreSQL capture/representation/nodes/chunks, provider fallback, and receipt replay |
| `local-hnsw-proof.json` | 6,000-row HNSW plans and ANN-versus-exact recall |
| `gate5-human-review-sample.packet.json` | Locked 24-case reviewer packet |
| `gate5-human-review-response.template.json` | Blank human response awaiting actual review |

Receipts are evidence of the exact run they describe. A local receipt does not prove a remote environment, grant publication authority, or convert exploratory content into official-canonical knowledge.

## Known operational gaps

These are implementation boundaries, not hidden operator steps:

1. The default PostgreSQL worker implements durable acquisition/capture, routed conversion, document/representation/node materialization, candidate chunk/span persistence, authenticated representation and promotion decisions, faithful projection materialization, embedding/verification, guarded publication, and rollback/rebuild. Canonical retrieval remains API-owned and cannot be leased by the generic worker.
2. API and MCP each require `POSTGRES_URL` to use durable admission; API development fallback remains process-local only when PostgreSQL is intentionally absent.
3. Artifact detail reads intentionally return metadata only; an admitted signed-download operation is still required before clients can obtain large bytes.
4. A2A task admission and signed callback receipt are executable HTTP endpoints with durable PostgreSQL replay protection. Automatic terminal-operation callback delivery is not yet attached to the worker outbox; callers can use `A2ACallbackHttpSender` with an admitted exact-target resolver until that dispatcher is deployed.
5. The default worker registers Docling in its ordered conversion route. Operators must start the isolated Docling service for Docling execution; otherwise the recorded route falls back to deterministic structural conversion when admitted by the operation.
6. Vercel and AWS deployment manifests are deployable and locally/structurally validated, but no managed environment was created; production network, workload identity, secret, scaling, and rollback acceptance remain environment work.
7. The broad corpus is structurally comprehensive but partly synthetic and grounded in three real source families.
8. HNSW proof is local and must be repeated in each deployed environment.
9. Literal Gate 5 remains incomplete until an actual human completes the locked sample and their identity is verified out of band.

The authority-bearing projection, embedding, publication, and rollback handlers are registered with strict versioned inputs and immutable replay verification. The detailed operating sequence and live proofs are in `docs/GOVERNED_PREPARATION_AND_INDEXING_RUNBOOK.md`; registering a generic success handler remains explicitly prohibited.

## Where to look next

- Operating commands and recovery: `docs/OPERATOR_RUNBOOK.md`
- API roles and identity format: `docs/API_AUTHORIZATION.md`
- Deployment order and rollback: `docs/deployment.md`
- Security controls: `docs/security.md`
- Incident matrix: `docs/operations/runbooks.md`
- Final acceptance evidence: `docs/FINAL_ACCEPTANCE_AND_TRACEABILITY.md`
- Human review procedure: `docs/GATE5_HUMAN_REVIEW.md`
- Generated HTTP contract: `packages/contracts/generated/openapi.json`
- Machine-readable capability catalog: `catalog/capability-profiles.v1.json`
