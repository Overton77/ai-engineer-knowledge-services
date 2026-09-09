# Governed preparation and indexing runbook

This runbook covers the durable path from an admitted source capture through conversion, structural materialization, chunking, projection, embedding, publication, immediate retrieval, and rollback. Every mutating action is an admitted versioned operation. The worker never treats an unsupported activity as success, and a content-curation actor cannot approve or publish its own proposal.

## 1. Services and responsibility boundaries

| Service/module | Responsibility | Must not do |
| --- | --- | --- |
| `apps/api` | Bearer authentication, tenant binding, versioned HTTP admission, operation status and canonical retrieval | Execute worker activities or infer reviewer authority from request fields |
| `apps/mcp` | MCP tools over the same application/admission services | Bypass API policy or manufacture a completed receipt |
| `apps/cli` | Operator-facing commands over the typed client | Write canonical tables directly |
| `apps/worker` | Lease registered activities, heartbeat, execute, persist receipts, retry or fail closed | Claim API-owned `retrieval_run`; self-approve or self-publish |
| `packages/persistence` | Tenant-scoped PostgreSQL/Storage repositories, immutable replay verification, atomic publication RPCs | Accept changed data under an existing deterministic identity |
| `packages/acquisition` | Fetch and seal admitted bytes with locator and digest evidence | Treat an inaccessible source as captured |
| `packages/conversion` | Route Docling where configured and use the deterministic supported fallback | Report conversion success without a sealed representation |
| `packages/embeddings` | Vercel AI Gateway embedding adapter plus deterministic local proof adapter | Silently change model, dimensions, or provider route |
| PostgreSQL/Supabase Storage | Canonical state, RLS, leases, append-only receipts, artifacts, vector index and active pointer | Permit cross-tenant provenance or unguarded publication |

The sensitive actor boundaries are closed enums and are checked from the immutable operation context:

- `content_curator_agent` may propose projections.
- A non-model human actor or the separately configured `human_reviewer` service identity may record a decision.
- `embedding_executor` may run embeddings.
- `control_plane` may publish or roll back.
- Proposal author, decider, and publisher must be distinct where the gate requires separation of duties.

`human_reviewer` in automated tests is a service fixture. It is not evidence that a person reviewed the material and does not satisfy the separate Gate 5 human-review requirement.

## 2. Local prerequisites and environment

Use PowerShell from the repository root. Required software is Node 24+, Corepack/pnpm, Docker Desktop, and the Supabase CLI.

```powershell
Set-Location C:\Users\Pinda\Proyectos\aiengineer\ai-engineer-knowledge-services
corepack enable
corepack pnpm install --frozen-lockfile

Set-Location ..\ai-engineer-db-contract
supabase start
supabase status
Set-Location ..\ai-engineer-knowledge-services
```

Create `.env` from `.env.example`. For the canonical local stack, resolve the service key rather than committing it:

```powershell
$env:POSTGRES_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
$env:SUPABASE_URL = 'http://127.0.0.1:54321'
$env:CANONICAL_LOCAL_ONLY = '1'
Push-Location ..\ai-engineer-db-contract
$LocalStatus = supabase status -o json | ConvertFrom-Json
Pop-Location
$env:SUPABASE_SECRET_KEY = $LocalStatus.SERVICE_ROLE_KEY
```

For production embeddings also configure the AI Gateway credential documented in `.env.example`. Absence of that secret does not prevent the worker from starting, but an admitted embedding activity fails closed when it reaches the Gateway adapter. The deterministic adapter is for tests and local proof only.

## 3. Database initialization and verification

A reset destroys the local database. Use it only when local data may be discarded and no other task is using the shared stack.

```powershell
Set-Location ..\ai-engineer-db-contract
supabase db reset --local
corepack pnpm exec supabase test db
corepack pnpm types:generate
corepack pnpm typecheck
Set-Location ..\ai-engineer-knowledge-services
```

The database suite covers tenant-composite foreign keys, forced RLS on governance tables, provenance requirements, immutable historical compatibility, atomic publication/rollback, hybrid retrieval, and vector-store operation provenance.

## 4. Build and start the processes

Build once:

```powershell
corepack pnpm build
```

Start each long-running process in a separate terminal with the same environment:

```powershell
corepack pnpm dev:api
```

```powershell
corepack pnpm dev:worker
```

```powershell
corepack pnpm dev:mcp
```

The worker registry admits only its registered operation kinds. Canonical retrieval is API-owned, so a production worker lease query excludes `retrieval_run`; an API executor can still claim that exact operation explicitly.

## 5. Preparation operation sequence

All inputs include a schema version, an immutable `OperationContext`, an idempotency key, and expected service versions. Submit through HTTP, MCP, or the typed CLI/client; do not insert canonical rows manually.

1. `source_capture:capture` acquires an admitted locator, seals bytes in Storage, persists the source artifact and capture binding, and records a receipt.
2. `transformation:convert` reads the sealed capture, converts through the configured route, seals the source-native and structural artifacts, and materializes document version, representation, nodes, edges, transformation input/output, and lineage.
3. `chunk_set:chunk` reads the accepted structural representation contract, writes deterministic chunks and structural spans, and records exact input/output manifests.
4. `representation_decision:decide` binds an authorized reviewer decision to the exact representation digest and durable decision operation.

Poll the returned operation URL until `succeeded` or `failed`. A retryable error returns the step to the queue subject to its attempt policy; a non-retryable authority, schema, digest, or provenance error terminates it. Receipts are the evidence of completion; an HTTP acceptance response alone is not.

## 6. Projection, decision, embedding, and publication

The governed sequence is intentionally split across actors:

1. A `content_curator_agent` submits `promotion_proposal:propose`. The activity validates the accepted representation, materializes purpose-specific `projection_target` and `search_projection` rows, and writes one or more `search_projection_chunk_support` rows containing the selected-text digest and faithful chunk locator.
2. An independent reviewer submits `promotion_decision:decide` with the proposal's exact guarded digest and review-subject ID. The durable knowledge review decision and content-promotion decision both reference the admitted decision operation.
3. `embedding_executor` submits `embedding_run:embed|verify`. The repository checks the approved projection set, model, 1536 dimensions, halfvec precision, procedure, input manifest, provider route, output manifest, cache keys, and physical stored vector digest. Replay reads all immutable bindings back before returning success.
4. `control_plane` submits `space_publication:publish|verify`. Staging checks the vector-store owner/class, vector-space authority class, passed evaluation result, approved non-expired promotion decision, supported projected items, fixed dimensions, and exact manifests. The verify step requires the durable stage receipt and atomically switches the active space pointer.
5. Retrieval is available immediately after the atomic pointer switch. Exact, full-text, trigram, and ANN candidates are filtered to the active published version before fusion.

Publication creates both `publication_switch_receipt` and `authorized_publication_execution`. The latter binds the switch to the successful durable operation, its guarded digest, action, and distinct publisher identity.

## 7. Rollback and rebuild

Submit `publication_rollback:rollback|verify` with the currently published ID, a prior immutable target publication ID, its exact guarded digest, and an operator reason. The first step validates the target and separation of duties. The second requires the recorded plan receipt and calls the operation-bound rollback RPC.

Rollback does not resurrect or mutate the old publication row. It creates a new immutable publication pointing at the previously approved vector-space version, supersedes the current publication, atomically changes the active pointer, and records a new switch receipt plus authorization ledger row. Retrieval therefore observes either the old active version or the rebuilt one, never a half-switched state.

## 8. End-to-end local proofs

Run the real durable preparation proof first because governed indexing consumes its sealed representation and candidate chunk:

```powershell
corepack pnpm prove:durable-preparation
corepack pnpm prove:governed-indexing
```

The first command writes `catalog/durable-preparation-proof.json`. The second writes `catalog/governed-indexing-proof.json` and proves:

- candidate chunk to faithful projection support;
- independent service-fixture review decisions;
- deterministic 1536-dimensional embedding persistence;
- atomic publication and immediate ANN/exact retrieval;
- publication upgrade and rollback rebuild;
- authorization/switch receipt lineage and idempotent receipt cardinality;
- rejection of a model decision, forged role field, self-approval, digest mismatch, wrong dimensions, wrong store ownership, and replay substitution.

The proof catalog contains IDs and digests, never credentials.

## 9. Operator diagnostics

Start with the operation status and receipts. A queued operation without an available worker may simply have no eligible registered handler. A failed operation should retain an error-class event and failure receipt; do not rewrite it to succeeded.

Useful database checks, always under the intended tenant context:

```sql
select id, operation_kind, status, attempt_count, created_at
from knowledge_service.operation
order by created_at desc limit 25;

select operation_id, receipt_kind, outcome, output_sha256, created_at
from knowledge_service.receipt
order by created_at desc limit 50;

select id, vector_store_space_id, vector_space_version_id, status, operation_id
from retrieval.space_publication
order by created_at desc;

select vector_store_space_id, active_space_version_id
from retrieval.vector_store_space;

select action, guarded_sha256, publisher_identity, operation_id, switch_receipt_id
from retrieval.authorized_publication_execution
order by created_at desc;
```

Common fail-closed causes are a stale guarded digest, actor identity not allowed for the admitted operation, proposal/decision/publisher identity collision, projection set differing from the approved manifest, model or dimension mismatch, vector store/space class mismatch, missing evaluation pass, or a changed payload under an existing idempotency key.

## 10. Release verification checklist

```powershell
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm verify
```

Also run the database suite and both live proofs from Sections 3 and 8. Before release, inspect generated proof receipts, confirm no deterministic test adapter is configured for a production worker, verify the API/worker/MCP use the same version catalog, and confirm Gate 5 separately if the release policy requires actual human review.
