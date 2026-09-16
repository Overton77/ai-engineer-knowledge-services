<!-- BEGIN GENERATED: agent-docs -->
## Repository guide

Knowledge preparation, retrieval, evidence, evaluation, publication, and verification; API, MCP, CLI, durable workers, and parser boundaries.

Lifecycle: Active service repository; see deployment docs for rollout state.

Read the relevant documents below before changing behavior. Inspect more-specific AGENTS.md files in the destination directory. Accepted docs record settled decisions; proposed, reference, and deprecated docs are labelled context. The map is navigation, not proof of implementation or deployment.

- Transport handlers share packages/application. Cross-repository consumers use published HTTP/client, CLI, or MCP contracts; do not import internal algorithm packages.
- In-process KS servers (API, MCP, workers) call packages/application. Out-of-process callers (laptop CLI remote, Eve, Mission Control, other repos) use KnowledgeClient against the HTTP API. CLI local demo/attestation stay application-direct. Do not add MCP apiClient methods; new use cases go through application.
- Verification execution and policy admission are separate. Semantic judgment cannot override a deterministic failure. Preserve immutable captures, selectors, provenance, and tenant isolation.
- Mission Control dispatches verification and classifies retry/cancellation; Knowledge Services owns algorithms, policy admission, and durable knowledge execution.
- Shared Supabase migrations and generated database types are owned by ai-engineer-db-contract; consume its pinned contract. Do not create another migration/type authority.
- Search explicit source paths first. Do not recursively enumerate artifacts, outputs, runs, receipts, caches, dependencies, or private notes. Read an individual artifact only when the task calls for it.
- Knowledge schema/read/ingest live in packages/schema-workspace, packages/db-read, packages/ingestion and the verification-executor knowledge surfaces. Retrieval read ops are skipped; ingestion does not write knowledge_service.operation.

### Business logic and workflows (OKF)

Start with `knowledge/index.md`; read one matching concept, then its implementation/tests. Do not load the whole bundle.

- Ownership and caller contracts: `knowledge/service-boundaries.md`
- Schema, bounded reads, canonical writes: `knowledge/schema-read-and-ingestion.md`
- Capture, prepare, publish: `knowledge/preparation-and-publication.md`
- Search, evidence packets, citation replay: `knowledge/retrieval-and-evidence.md`
- Claims, deterministic failures, admission: `knowledge/verification-and-admission.md`
- Leases, retries, cancellation, repair: `knowledge/durable-execution-and-recovery.md`

Search: `node .agent-docs/cli.mjs search --repo . --query "your terms"` (add `--format json`).
Exact text: `rg -n -i "your terms" knowledge -g "*.md"`.
From the workspace root: `node ai-engineer-knowledge-services/.agent-docs/cli.mjs search --repo ai-engineer-knowledge-services --query "your terms"`.
Concepts describe observed behavior; accepted source decisions remain authoritative. Check cited code/tests before changing behavior.

### Code navigation

Read `docs/agents/CODE-MAP.md` for source entrypoints, interfaces, dependencies, tests, and architecture by module.

- `apps/AGENTS.md`: Executable transports and durable workers.
- `packages/AGENTS.md`: Business algorithms, contracts, adapters, and use-case composition.
- `packages/verification/src/AGENTS.md`: Internal verification algorithm seams.
- `services/AGENTS.md`: Separately deployed conversion and native parser boundaries.
- `scripts/AGENTS.md`: Explicit proof, evaluation, reconciliation, and experiment commands.
- `skills/AGENTS.md`: Agent skills for schema navigation, bounded reads, and ingestion.
- Change an HTTP/MCP/CLI verification surface: contracts → application → api → mcp → cli
- Change locator or evidence verification: verification → verification-selectors → verification-deterministic → verification-semantic
- Debug worker retry or persistence: worker → runtime → persistence
- Change parsing and conversion: conversion → chunking → documents → verification-parser → docling
- Change retrieval or embedding: retrieval → embeddings → vector-backends → policy
- Find proof and evaluation commands: script-proofs → script-evaluation → script-reconciliation
- Change schema workspace, knowledge read, or ingestion: schema-workspace → db-read → ingestion → verification-executor

### Task routes

- [proposed] Post-sprint module review, exemplars, and developer-overridable delivery workflow: `docs/operations/code-quality-and-delivery-process.md`
- [proposed] Internal acquisition/inspection/conversion/chunking fallbacks, application folder order, skills last: `docs/operations/internal-fallbacks-and-application-order.md`
- [accepted] Acquisition HTTP, upload, and sealed-byte inspection review record: `docs/operations/reviews/acquisition.md`
- [proposed] Conversion route and admitted chunk profiles; vendor MCP import; no session-local splitters: `docs/operations/conversion-and-chunking.md`
- Service boundaries, startup, and transferable use of HTTP/MCP/CLI/skills: `README.md`
- [accepted] Runtime, transport, and deployment changes: `docs/architecture/0001-runtime-and-deployment.md`
- [accepted] Preparation pipeline: `docs/architecture/0002-deterministic-preparation.md`
- [accepted] Embedding, retrieval, evaluation: `docs/architecture/0003-embedding-retrieval-evaluation.md`
- [accepted] In-process servers call application; out-of-process callers use KnowledgeClient HTTP: `docs/architecture/0004-transport-call-graph.md`
- [reference] Dated snapshot of later transport-call-graph refactors; will go stale: `docs/architecture/transport-call-graph-refactor-snapshot-20260916.md`
- Verification behavior and invariants: `docs/verification/README.md`
- Cross-service verification integration: `docs/verification/INTEGRATION-GUIDE.md`
- Verification recovery and operator actions: `docs/verification/OPERATOR-RUNBOOK.md`
- Verification deployment and rollback: `docs/verification/DEPLOYMENT.md`
- Worker restart, leases, callbacks, incidents: `docs/operations/runbooks.md`
- Authentication, capability admission, parser isolation: `docs/security.md`

### Validation

Run from this repository root; choose checks relevant to the change. Commands are documented here, never executed by the documentation updater.

- `corepack pnpm verify`

Documentation: `node .agent-docs/cli.mjs check --repo .`; refresh with `node .agent-docs/cli.mjs build --repo .`. Edit `.agent-docs/config.json` to change this guide.

[Docs index]|root:.
|.:{README.md}
|docs/architecture:{0001-runtime-and-deployment.md,0002-deterministic-preparation.md,0003-embedding-retrieval-evaluation.md,0004-transport-call-graph.md,transport-call-graph-refactor-snapshot-20260916.md}
|docs/operations:{code-quality-and-delivery-process.md,conversion-and-chunking.md,internal-fallbacks-and-application-order.md,runbooks.md}
|docs/operations/reviews:{acquisition.md}
|docs:{security.md}
|docs/verification:{DEPLOYMENT.md,INTEGRATION-GUIDE.md,OPERATOR-RUNBOOK.md,README.md}
<!-- END GENERATED: agent-docs -->
