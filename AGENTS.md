<!-- BEGIN GENERATED: agent-docs -->
## Repository guide

Knowledge preparation, retrieval, evidence, evaluation, publication, and verification; API, MCP, CLI, durable workers, and parser boundaries.

Lifecycle: Active service repository; see deployment docs for rollout state.

Read the relevant documents below before changing behavior. Inspect more-specific AGENTS.md files in the destination directory. Accepted docs record settled decisions; proposed, reference, and deprecated docs are labelled context. The map is navigation, not proof of implementation or deployment.

- Transport handlers share packages/application. Cross-repository consumers use published HTTP/client, CLI, or MCP contracts; do not import internal algorithm packages.
- API, MCP, and workers call packages/application in process; MCP has no API client. Out-of-process callers use KnowledgeClient HTTP. Local CLI demo/attestation stays application-direct.
- Verification execution and policy admission are separate. Semantic judgment cannot override a deterministic failure. Preserve immutable captures, selectors, provenance, and tenant isolation.
- Mission Control dispatches verification and classifies retry/cancellation; Knowledge Services owns algorithms, policy admission, and durable knowledge execution.
- Shared Supabase migrations and generated database types are owned by ai-engineer-db-contract; consume its pinned contract. Do not create another migration/type authority.
- Search explicit source paths first. Do not recursively enumerate artifacts, outputs, runs, receipts, caches, dependencies, or private notes. Read an individual artifact only when the task calls for it.
- Knowledge schema/read/ingest live in packages/knowledge-db and the verification-executor knowledge surfaces. Retrieval read ops are skipped; ingestion does not write knowledge_service.operation.

### Business logic and workflows (OKF)

Start with `knowledge/index.md`; read one matching concept, then its implementation/tests. Do not load the whole bundle.

- Ownership, profiles and caller contracts: `knowledge/service-boundaries.md` → `knowledge/execution-profiles-and-transports.md`
- Capture, convert and prepare faithful content: `knowledge/capture-conversion-and-custody.md` → `knowledge/preparation-and-publication.md`
- Schema, bounded reads and canonical ingestion: `knowledge/schema-read-and-ingestion.md`
- Retrieve evidence, evaluate and publish: `knowledge/retrieval-and-evidence.md` → `knowledge/evaluation-and-publication-gates.md`
- Verify claims and policy admission: `knowledge/verification-and-admission.md`
- Leases, retries, cancellation and recovery: `knowledge/durable-execution-and-recovery.md`
- Jev decisions and workers: `knowledge/jev-decisions-and-workers.md`
- Agent skills and consumer readiness: `knowledge/agent-skills-and-consumer-readiness.md`

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
- `tools/AGENTS.md`: Repository quality and Git-driven maintenance tooling.
- Change an HTTP/MCP/CLI verification surface: contracts → application → api → mcp → cli
- Change locator or evidence verification: verification → verification-evidence-selection → verification-deterministic → verification-semantic
- Debug worker retry or persistence: worker → core → persistence
- Change parsing and conversion: preparation → parser → docling
- Change retrieval or embedding: retrieval → policy
- Find proof and evaluation commands: script-proofs → script-evaluation → script-reconciliation
- Change schema workspace, knowledge read, or ingestion: knowledge-db → verification-executor

### Task routes

- [reference] Current handoff and experiment milestone: `docs/operations/package-cleanup/NEXT-PACKAGE-CLEANUP.md`
- [proposed] Remaining cleanup: 5D folds, Jev and executor retirement: `docs/operations/package-cleanup/UNIT-5-SLICES.md`
- [accepted] Accepted cleanup layout and sequence: `docs/operations/package-cleanup/FINAL-LAYOUT.md`
- [reference] Cleanup index and archive: `docs/operations/package-cleanup/README.md`
- [proposed] Module review and delivery workflow: `docs/operations/code-quality-and-delivery-process.md`
- Service boundaries, startup, and transferable use of HTTP/MCP/CLI/skills: `README.md`
- [accepted] Runtime, transport, and deployment changes: `docs/architecture/0001-runtime-and-deployment.md`
- [accepted] Preparation pipeline: `docs/architecture/0002-deterministic-preparation.md`
- [accepted] Embedding, retrieval, evaluation: `docs/architecture/0003-embedding-retrieval-evaluation.md`
- [accepted] In-process servers call application; out-of-process callers use KnowledgeClient HTTP: `docs/architecture/0004-transport-call-graph.md`
- Verification behavior and invariants: `docs/verification/README.md`
- Cross-service verification integration: `docs/verification/INTEGRATION-GUIDE.md`
- Verification recovery and operator actions: `docs/verification/OPERATOR-RUNBOOK.md`
- Verification deployment and rollback: `docs/verification/DEPLOYMENT.md`
- Worker restart, leases, callbacks, incidents: `docs/operations/runbooks.md`
- Authentication, capability admission, parser isolation: `docs/security.md`
- [reference] Verification library capability matrix: selectors, deterministic diversity, semantic scope, linked to examples: `packages/verification/CAPABILITIES.md`
- [reference] Executor acquisition, capture catalog, intent-expressible selectors and public-surface limits: `apps/verification-executor/examples/CAPABILITIES-ACQUISITION.md`
- [reference] Jev processes, API, MCP, CLI and research: `docs/architecture/modules/jev.md`
- [reference] Current implementation, ownership and remaining cleanup: `docs/architecture/current-state.md`
- [reference] Pinned technology stack and runtime definitions: `docs/architecture/technology-stack.md`
- [reference] Git-driven maintenance, provider setup and test evidence: `docs/operations/agent-maintenance.md`

### Validation

Run from this repository root; choose checks relevant to the change. Commands are documented here, never executed by the documentation updater.

- `corepack pnpm verify`
- `Gates: tools/quality/README.md`
- `corepack pnpm test:maintenance && corepack pnpm test:context`

Documentation: `node .agent-docs/cli.mjs check --repo .`; refresh with `node .agent-docs/cli.mjs build --repo .`. Edit `.agent-docs/config.json` to change this guide.

[Docs index]|root:.
|.:{README.md}
|apps/verification-executor/examples:{CAPABILITIES-ACQUISITION.md}
|docs/architecture:{0001-runtime-and-deployment.md,0002-deterministic-preparation.md,0003-embedding-retrieval-evaluation.md,0004-transport-call-graph.md,current-state.md,technology-stack.md}
|docs/architecture/modules:{jev.md}
|docs/operations:{agent-maintenance.md,code-quality-and-delivery-process.md,runbooks.md}
|docs/operations/package-cleanup:{FINAL-LAYOUT.md,NEXT-PACKAGE-CLEANUP.md,README.md,UNIT-5-SLICES.md}
|docs:{security.md}
|docs/verification:{DEPLOYMENT.md,INTEGRATION-GUIDE.md,OPERATOR-RUNBOOK.md,README.md}
|packages/verification:{CAPABILITIES.md}
<!-- END GENERATED: agent-docs -->
