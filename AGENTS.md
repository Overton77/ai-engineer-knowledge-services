<!-- BEGIN GENERATED: agent-docs -->
## Repository guide

Knowledge preparation, retrieval, evidence, evaluation, publication, and verification; API, MCP, CLI, durable workers, and parser boundaries.

Lifecycle: Active service repository; see deployment docs for rollout state.

Read the relevant documents below before changing behavior. Inspect more-specific AGENTS.md files in the destination directory. Accepted docs record settled decisions; proposed, reference, and deprecated docs are labelled context. The map is navigation, not proof of implementation or deployment.

- Transport handlers share packages/application. Cross-repository consumers use published HTTP/client, CLI, or MCP contracts; do not import internal algorithm packages.
- Verification execution and policy admission are separate. Semantic judgment cannot override a deterministic failure. Preserve immutable captures, selectors, provenance, and tenant isolation.
- Mission Control dispatches verification and classifies retry/cancellation; Knowledge Services owns algorithms, policy admission, and durable knowledge execution.
- Shared Supabase migrations and generated database types are owned by ai-engineer-db-contract; consume its pinned contract. Do not create another migration/type authority.
- Search explicit source paths first. Do not recursively enumerate artifacts, outputs, runs, receipts, caches, dependencies, or private notes. Read an individual artifact only when the task calls for it.
- Knowledge schema/read/ingest live in packages/schema-workspace, packages/db-read, packages/ingestion and the verification-executor knowledge surfaces. Retrieval read ops are skipped; ingestion does not write knowledge_service.operation.

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
- Change parsing and conversion: conversion → verification-parser → docling
- Change retrieval or embedding: retrieval → embeddings → vector-backends → policy
- Find proof and evaluation commands: script-proofs → script-evaluation → script-reconciliation
- Change schema workspace, knowledge read, or ingestion: schema-workspace → db-read → ingestion → verification-executor

### Task routes

- Service boundaries and startup: `README.md`
- [accepted] Runtime, transport, and deployment changes: `docs/architecture/0001-runtime-and-deployment.md`
- [accepted] Preparation pipeline: `docs/architecture/0002-deterministic-preparation.md`
- [accepted] Embedding, retrieval, evaluation: `docs/architecture/0003-embedding-retrieval-evaluation.md`
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
|docs/architecture:{0001-runtime-and-deployment.md,0002-deterministic-preparation.md,0003-embedding-retrieval-evaluation.md}
|docs/operations:{runbooks.md}
|docs:{security.md}
|docs/verification:{DEPLOYMENT.md,INTEGRATION-GUIDE.md,OPERATOR-RUNBOOK.md,README.md}
<!-- END GENERATED: agent-docs -->
