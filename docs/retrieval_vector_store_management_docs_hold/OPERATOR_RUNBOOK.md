# AI Engineer Knowledge Services Operator Runbook

This runbook explains how to install, configure, start, call, test, stop, and recover the AI Engineer knowledge services. It is written for a developer or operator working in the current Windows workspace. Commands use PowerShell unless a section says otherwise.

The repository provides four runtime applications, a published TypeScript client, deterministic preparation and retrieval packages, durable PostgreSQL and private Storage adapters, provider integrations, and acceptance scripts. Read the operational boundary below before starting the processes.

## Current operational boundary

There are two operation-admission modes in the current implementation.

1. With `POSTGRES_URL` configured, the HTTP API and CLI admit generic operations into `knowledge_service.operation` and `operation_step`. A separately started canonical worker using the same database and `WORKER_TENANT_ID` claims only operation kinds registered in its activity registry. Canonical `retrieval_run` operations are deliberately excluded from worker leasing and execute in the API deployment. API status, event, cancellation, retry, and reconciliation calls read or mutate the same durable records. Without `POSTGRES_URL`, the API intentionally uses the process-local `KnowledgeIntegrationService` for development and tests.
2. MCP uses the same PostgreSQL-backed operation application port as the HTTP API. It authenticates its bearer through the same `KNOWLEDGE_API_IDENTITIES` map, verifies the asserted tenant and actor, and writes canonical operation/step records that the worker can claim. MCP accepted-operation links are rooted at the configured public API origin, not the MCP origin. The canonical PostgreSQL/private-Storage proof path is also exercised by `prove:canonical-durability`, which stores three immutable source objects, publishes vectors, reconstructs an evidence packet in a second process, and tests rollback and recovery.

Starting the PostgreSQL-configured API or MCP and canonical worker side by side connects them through the database; their tenant IDs must match. An accepted operation is durable admission, not evidence that the default worker executed a domain-specific activity.

The production bootstrap now uses a fail-closed activity registry. It executes only the explicitly registered, fully validated activities listed in the worker section. Acquisition, conversion, chunking, embedding, and advanced retrieval implementations exist as packages and proof flows, but those packages are not yet wired as general durable worker activities; unsupported submissions fail without a success receipt.

## Repository locations

Set these once in each PowerShell terminal:

```powershell
$Workspace = 'C:\Users\Pinda\Proyectos\aiengineer'
$KnowledgeRepo = Join-Path $Workspace 'ai-engineer-knowledge-services'
$DatabaseRepo = Join-Path $Workspace 'ai-engineer-db-contract'
$EveConsumer = Join-Path $Workspace 'research_ingestion_systems_agent\agents\knowledge-consumer'
$ApplicationRepo = Join-Path $Workspace 'aiengineerapp'
```

The main repository layout is:

| Path | Purpose |
| --- | --- |
| `apps/api` | Authenticated Fastify HTTP API |
| `apps/mcp` | Bearer-protected Streamable HTTP MCP server |
| `apps/cli` | JSON command-line client for the HTTP API |
| `apps/worker` | Lease-driven in-memory or PostgreSQL worker |
| `packages/*` | Contracts, domain logic, processing, storage, retrieval, and evaluation libraries |
| `services/docling` | Pinned, isolated Docling Serve deployment boundary |
| `scripts` | Evaluation, live-provider, durability, HNSW, and human-review workflows |
| `catalog` | Machine-readable profiles and proof receipts |
| `skills` | Versioned agent procedures |
| `docs` | Architecture, security, deployment, acceptance, and operations documentation |

## Prerequisites

Install or make available:

- Node.js 24 or newer for the knowledge-services repository.
- Corepack and pnpm 10.34.5.
- Docker Desktop for local Supabase, PostgreSQL, Storage, and Docling.
- Supabase CLI 2.115.0, normally provided by the adjacent database-contract repository.
- PowerShell 7 for the commands below.
- Optional provider credentials for Firecrawl, Unstructured, and Vercel AI Gateway.

Verify the local tools:

```powershell
node --version
corepack pnpm --version
docker version
docker compose version
```

Expected Node and pnpm versions are declared in the root `package.json`. The local Supabase project uses PostgreSQL 17 on port 54322 and its API/Storage endpoint on port 54321.

## One-time installation

Install the knowledge monorepo:

```powershell
Set-Location $KnowledgeRepo
corepack pnpm install --frozen-lockfile
```

Install the adjacent database contract if needed:

```powershell
Set-Location $DatabaseRepo
corepack pnpm install --frozen-lockfile
```

Build and verify the knowledge repository before operating it:

```powershell
Set-Location $KnowledgeRepo
corepack pnpm verify
```

`verify` runs all package typechecks, tests, and builds. The current accepted baseline is 39 typecheck tasks, 39 test tasks, 23 builds, 124 passing tests, and seven local-integration tests skipped unless explicitly enabled.

## Environment configuration

Copy the example for local editing. Do not commit the populated file.

```powershell
Set-Location $KnowledgeRepo
Copy-Item .env.example .env -ErrorAction Stop
```

The applications do not automatically load `.env` when invoked through their pnpm `start` or `dev` scripts. Either set variables in the current terminal or start built JavaScript with Node's `--env-file=.env` flag.

### Core server variables

| Variable | Required by | Meaning |
| --- | --- | --- |
| `NODE_ENV` | API, MCP, worker | `development`, `test`, or `production` |
| `HOST` | API, MCP | Bind address; local default is `127.0.0.1` |
| `PORT` | API, MCP | API default 4100; start MCP with 4101 |
| `LOG_LEVEL` | Server configuration | Configured log level |
| `KNOWLEDGE_API_IDENTITIES` | API and MCP protected routes | JSON array mapping bearer tokens to actors and tenant grants |
| `KNOWLEDGE_API_TOKEN` | CLI and MCP clients | Bearer token sent to API or MCP; it must occur in `KNOWLEDGE_API_IDENTITIES` |
| `KNOWLEDGE_API_URL` | API, MCP, CLI, and consumers | Public API origin, normally `http://127.0.0.1:4100`; MCP roots accepted-operation links here |
| `KNOWLEDGE_CALLBACK_SIGNING_KEYS` | API A2A callback receiver | JSON array of tenant UUID, opaque signing-key reference, and at least 32-byte HMAC secret. Secrets never appear in callback bodies or the replay ledger. |

### Canonical persistence and worker variables

| Variable | Required by | Meaning |
| --- | --- | --- |
| `POSTGRES_URL` | Canonical worker, durable reads/proofs | PostgreSQL connection string |
| `SUPABASE_URL` | Canonical worker/proofs | Supabase API and Storage origin |
| `SUPABASE_SECRET_KEY` | Canonical worker/proofs | Service-role credential used only by the final Storage adapter |
| `SUPABASE_STORAGE_BUCKET` | Canonical persistence | `source-captures` or `content-derivatives`; default is `source-captures` |
| `MAXIMUM_ARTIFACT_BYTES` | Canonical persistence | Optional positive integer; default is 1 GiB |
| `CANONICAL_LOCAL_ONLY` | Local safety | Set to `1` to reject any PostgreSQL host except localhost port 54322 |
| `KNOWLEDGE_PERSISTENCE_MODE` | Worker | `postgres` by default; `memory` only in development or test |
| `WORKER_TENANT_ID` | PostgreSQL worker | Tenant UUID whose operations the worker claims |
| `WORKER_ID` | Worker | Stable holder identity; default is `worker-<pid>` |
| `WORKER_POLL_MS` | Worker | Positive integer; default 1000 |
| `WORKER_LEASE_MS` | Worker | Positive integer; default 30000 |

### Provider variables

| Variable | Provider | Meaning |
| --- | --- | --- |
| `FIRECRAWL_API_URL` | Firecrawl | Complete scrape endpoint, normally `https://api.firecrawl.dev/v1/scrape` |
| `FIRECRAWL_API_KEY` | Firecrawl | Secret resolved only at the adapter |
| `UNSTRUCTURED_API_URL` | Unstructured | Managed conversion API origin |
| `UNSTRUCTURED_API_KEY` | Unstructured | Managed conversion secret |
| `UNSTRUCTURED_TEMPLATE_ID` | Unstructured | Pinned workflow/template identity |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway | Optional at API startup; required to execute canonical retrieval and live embedding/judge calls. Without it, retrieval submission fails closed with 503 before admission. |
| `VERCEL_OIDC_TOKEN` | Vercel AI Gateway | Accepted embedding credential fallback |
| `DOCLING_BASE_URL` | Docling | Local default `http://127.0.0.1:5001` |
| `DOCLING_API_KEY` | Docling | Optional `X-Api-Key` credential for an authenticated Docling Serve deployment |
| `DOCLING_MAXIMUM_RESULT_BYTES` | Docling | Maximum accepted response body; example default is 64 MiB |
| `DOCLING_REQUEST_TIMEOUT_MS` | Docling | Bounded synchronous conversion request timeout; example default is five minutes |

Resolved secrets must not appear in operation input, event payloads, receipts, model context, or committed files.

## Create a local API identity

The API denies protected routes when `KNOWLEDGE_API_IDENTITIES` is absent. The following example creates one local `knowledge_admin` identity. Replace the token and UUIDs for real use.

```powershell
$ApiToken = 'replace-with-at-least-16-random-characters'
$ActorId = '00000000-0000-4000-8000-000000000010'
$TenantId = '00000000-0000-7000-8000-000000000001'

$IdentityConfiguration = @(
  @{
    token = $ApiToken
    actor = @{
      kind = 'service'
      id = $ActorId
      serviceIdentity = 'mission_control_client'
    }
    grants = @(
      @{
        tenantId = $TenantId
        roles = @('knowledge_admin')
        scopes = @()
      }
    )
  }
) | ConvertTo-Json -Depth 10 -Compress

$env:KNOWLEDGE_API_IDENTITIES = $IdentityConfiguration
$env:KNOWLEDGE_API_TOKEN = $ApiToken
$env:KNOWLEDGE_API_URL = 'http://127.0.0.1:4100'
```

Supported roles are:

| Role | Actions |
| --- | --- |
| `knowledge_reader` | `system.read`, `knowledge.read`, `retrieval.plan.validate` |
| `knowledge_operator` | Reader actions plus `operation.submit` and `operation.control` |
| `knowledge_evaluator` | Reader actions plus `demo.evaluate` |
| `knowledge_admin` | Every currently admitted API action |

Individual grants may also list exact scopes instead of, or in addition to, roles. Identity is fail-closed. The bearer token selects an immutable actor and tenant grant; request headers cannot assert roles or scopes.

## Start and call the HTTP API

### Development startup

Open a terminal, set the identity variables above, and run:

```powershell
Set-Location $KnowledgeRepo
$env:HOST = '127.0.0.1'
$env:PORT = '4100'
corepack pnpm dev:api
```

This uses `tsx watch`. Restart the process after changing environment variables.

### Build-equivalent startup

```powershell
Set-Location $KnowledgeRepo
corepack pnpm build
$env:HOST = '127.0.0.1'
$env:PORT = '4100'
corepack pnpm --filter @aiengineer/knowledge-api start
```

To load a populated `.env` directly:

```powershell
Set-Location $KnowledgeRepo
corepack pnpm build
node --env-file=.env apps/api/dist/index.js
```

If `POSTGRES_URL` is present, the API uses PostgreSQL for generic operation admission, status, events, cancellation, retry, reconciliation, and durable evidence-packet reads. Start the canonical worker with the same database and tenant to execute admitted work. With no `POSTGRES_URL`, the API uses its in-memory development implementation.

### Health and readiness

The liveness and unauthenticated readiness routes are:

```powershell
Invoke-RestMethod http://127.0.0.1:4100/health
Invoke-RestMethod http://127.0.0.1:4100/readiness
```

Expected responses:

```json
{"status":"ok"}
```

```json
{"service":"knowledge-services","status":"ready","contractVersion":"v1","runtime":"node"}
```

The authenticated system route verifies token and tenant policy:

```powershell
$CorrelationId = 'runbook-system-check-001'
$Headers = @{
  Authorization = "Bearer $ApiToken"
  'x-tenant-id' = $TenantId
  'x-correlation-id' = $CorrelationId
}
Invoke-RestMethod "$env:KNOWLEDGE_API_URL/v1/system" -Headers $Headers
```

The API echoes `x-correlation-id` on responses. If the request omits it, the server creates one, but mutations must supply the same value inside their operation context. Set it explicitly for every mutation.

## Build an operation context

Every mutation carries a strict `OperationContext`. Create new operation and attempt UUIDs for a new logical request. Reuse the same operation ID, idempotency key, kind, and input only for a true replay.

```powershell
$OperationId = [guid]::NewGuid().ToString()
$AttemptId = [guid]::NewGuid().ToString()
$CorrelationId = "knowledge-$OperationId"

$Context = @{
  tenantId = $TenantId
  operationId = $OperationId
  attemptId = $AttemptId
  correlationId = $CorrelationId
  actor = @{
    kind = 'service'
    id = $ActorId
    serviceIdentity = 'mission_control_client'
  }
  capabilityVersion = 'operator-runbook/1.0.0'
  idempotencyKey = "source-discovery-$OperationId"
  reason = 'Discover sources for an approved research task'
  contractVersion = 'v1'
}

$Headers = @{
  Authorization = "Bearer $ApiToken"
  'x-tenant-id' = $TenantId
  'x-correlation-id' = $CorrelationId
}
```

Optional context fields are `projectId`, `workItemId`, `missionId`, `causationId`, and `externalExecution`. External execution can record an Eve, Vercel Workflow, Mission Control, or other run with `runId`, `rootRunId`, `sessionId`, `turnId`, and `toolCallId`.

The authenticated actor must match `context.actor`, the `x-tenant-id` header must match `context.tenantId`, and the correlation header must match `context.correlationId`.

## Submit and inspect an HTTP operation

Submit a generic operation:

```powershell
$Body = @{
  kind = 'source_discovery'
  envelope = @{
    context = $Context
    input = @{
      query = 'AI engineering evaluation systems'
      maximumResults = 5
    }
    expectedVersions = @{
      api = 'v1'
    }
  }
} | ConvertTo-Json -Depth 12

$Accepted = Invoke-RestMethod `
  "$env:KNOWLEDGE_API_URL/v1/operations" `
  -Method Post `
  -Headers $Headers `
  -ContentType 'application/json' `
  -Body $Body

$Accepted | ConvertTo-Json -Depth 10
```

The accepted response contains `operationId`, `statusUrl`, `eventStreamUrl`, `cancellationUrl`, `retryUrl`, and `reconcileUrl`. In the API reference path, the generic operation will normally remain queued.

Read status and events:

```powershell
$Status = Invoke-RestMethod $Accepted.statusUrl -Headers $Headers
$Events = Invoke-RestMethod $Accepted.eventStreamUrl -Headers $Headers
$Status | ConvertTo-Json -Depth 12
$Events | ConvertTo-Json -Depth 12
```

Read events after a known sequence:

```powershell
Invoke-RestMethod "$($Accepted.eventStreamUrl)?after=1" -Headers $Headers
```

Control endpoints accept a mutation envelope whose context follows the same actor, tenant, and correlation rules:

```powershell
$ControlBody = @{
  context = $Context
  input = @{
    operationId = $Accepted.operationId
    action = 'cancel'
  }
  expectedVersions = @{ api = 'v1' }
} | ConvertTo-Json -Depth 12

Invoke-RestMethod `
  $Accepted.cancellationUrl `
  -Method Post `
  -Headers $Headers `
  -ContentType 'application/json' `
  -Body $ControlBody
```

Replace `cancel` with `retry` or `reconcile` and use the corresponding URL. An invalid transition returns HTTP 409 with `application/problem+json`.

## Validate a retrieval plan

Plan validation is synchronous and does not create an operation:

```powershell
$PolicyVersion = '00000000-0000-4000-8000-000000000101'
$Plan = @{
  policyVersion = $PolicyVersion
  query = 'What engineering guidance supports durable agent state?'
  intents = @('knowledge_evidence')
  subqueries = @(
    @{
      id = 'guidance'
      text = 'durable agent state engineering guidance'
      coverageRole = 'required'
    }
  )
  spaces = @('engineering_claims')
  anchors = @{
    entities = @()
    concepts = @()
    useCases = @('agent reliability')
  }
  hardFilters = @(
    @{ field = 'language'; op = 'eq'; value = 'en' },
    @{ field = 'visibility'; op = 'eq'; value = 'tenant' }
  )
  softBoosts = @()
  temporalScope = @{}
  candidateK = 20
  finalK = 5
  graph = @{
    maxDepth = 1
    allowedEdges = @('supports')
  }
  abstention = @{
    minimumCoverage = 1
  }
}

$PlanBody = @{ plan = $Plan } | ConvertTo-Json -Depth 15
Invoke-RestMethod `
  "$env:KNOWLEDGE_API_URL/v1/retrieval-plans:validate" `
  -Method Post `
  -Headers $Headers `
  -ContentType 'application/json' `
  -Body $PlanBody
```

The contract limits queries to 4,000 characters, subqueries to 16, filters to 32 per class, `candidateK` to 1,000, `finalK` to 100, and graph depth to 3. `finalK` cannot exceed `candidateK`; spaces and subquery IDs must be unique.

## Execute canonical retrieval in the API deployment

`POST /v1/retrieval-runs` accepts only a mutation envelope whose `input` is exactly `{ "plan": RetrievalPlan }`. Client-provided vectors, embeddings, candidate lists, authority claims, and evidence are rejected as unknown fields. Set `expectedVersions.retrieval` to `v1`.

The API resolves the referenced active tenant retrieval-policy version, selects only vector-space versions behind an active published pointer and unexpired accepted promotion decision, generates one query embedding per selected model/version through the configured adapter, and calls the tenant-scoped PostgreSQL hybrid RPC. The RPC applies exact, full-text, trigram, and ANN ranking plus reciprocal-rank fusion after hard filters. The API then performs cross-space RRF, optional validated reranking with deterministic fallback, per-source diversity, required-coverage and policy-bypass checks, and abstention.

Only candidates bound to an accepted immutable representation node and artifact enter the packet. Locatorless candidates are recorded as omissions; they are never converted into invented evidence. The API atomically persists the validated plan, run, candidates, per-channel source explanations, normalized packet members, packet digest, and operation binding, then completes deterministic `retrieve` and `packet` receipts. Exact request replay returns the same operation/run/packet; changed content under the same idempotency identity returns 409.

The currently backed execution subset accepts equality hard filters supported by the database (`language`, `visibility`, `classification`, `source_kind`, `authority_level`, and lower freshness bound). A requested space with no active publication forces a reasoned abstention. Graph expansion, anchors, soft boosts, upper temporal filters, and context expansion currently fail closed when requested/configured; their package-level reference implementations do not authorize production evidence until canonical graph/context persistence is wired.

```powershell
$RetrievalOperationId = [guid]::NewGuid().ToString()
$RetrievalAttemptId = [guid]::NewGuid().ToString()
$RetrievalCorrelationId = "retrieve-$RetrievalOperationId"
$RetrievalContext = $Context.Clone()
$RetrievalContext.operationId = $RetrievalOperationId
$RetrievalContext.attemptId = $RetrievalAttemptId
$RetrievalContext.correlationId = $RetrievalCorrelationId
$RetrievalContext.idempotencyKey = "retrieval-$RetrievalOperationId"
$RetrievalContext.reason = 'Retrieve locator-bound engineering evidence'
$RetrievalHeaders = $Headers.Clone()
$RetrievalHeaders['x-correlation-id'] = $RetrievalCorrelationId

# For canonical execution, keep unsupported optional stages unrequested.
$Plan.anchors = @{ entities = @(); concepts = @(); useCases = @() }
$Plan.softBoosts = @()
$Plan.graph = @{ maxDepth = 0; allowedEdges = @() }

$RetrievalBody = @{
  context = $RetrievalContext
  input = @{ plan = $Plan }
  expectedVersions = @{ api = 'v1'; retrieval = 'v1' }
} | ConvertTo-Json -Depth 20

$AcceptedRetrieval = Invoke-RestMethod -Method Post -Uri "$ApiBase/v1/retrieval-runs" -Headers $RetrievalHeaders -ContentType 'application/json' -Body $RetrievalBody
$Status = Invoke-RestMethod -Method Get -Uri $AcceptedRetrieval.statusUrl -Headers $RetrievalHeaders
$Run = Invoke-RestMethod -Method Get -Uri "$ApiBase/v1/retrieval-runs/$RetrievalOperationId" -Headers $RetrievalHeaders
$Packet = Invoke-RestMethod -Method Get -Uri "$ApiBase/v1/evidence-packets/$($Run.evidencePacketIds[0])" -Headers $RetrievalHeaders
```

## Run the three-bundle API demonstration

This bounded demonstration also executes in the API process, but it is separate from the canonical `POST /v1/retrieval-runs` path. The identity needs `demo.evaluate`, supplied by `knowledge_evaluator` or `knowledge_admin`.

Create a new context, then submit exactly the three allow-listed bundle descriptors:

```powershell
$DemoOperationId = [guid]::NewGuid().ToString()
$DemoAttemptId = [guid]::NewGuid().ToString()
$DemoCorrelationId = "demo-$DemoOperationId"
$DemoContext = $Context.Clone()
$DemoContext.operationId = $DemoOperationId
$DemoContext.attemptId = $DemoAttemptId
$DemoContext.correlationId = $DemoCorrelationId
$DemoContext.idempotencyKey = "three-bundle-demo-$DemoOperationId"
$DemoContext.reason = 'Run the bounded internal exploratory three-bundle evaluation'

$DemoHeaders = $Headers.Clone()
$DemoHeaders['x-correlation-id'] = $DemoCorrelationId

$DemoBody = @{
  context = $DemoContext
  input = @{
    mode = 'three_bundle_internal_exploratory'
    bundles = @(
      @{
        schema_version = 'ai-engineer-embedding-bundle/0.1.0'
        store_class = 'internal_exploratory'
        video_id = 'kTnfJszFxCg'
        evaluation_scope = 'operator-runbook'
      },
      @{
        schema_version = 'ai-engineer-embedding-bundle/0.1.0'
        store_class = 'internal_exploratory'
        video_id = 'bk0TmxoZlUY'
        evaluation_scope = 'operator-runbook'
      },
      @{
        schema_version = 'ai-engineer-embedding-bundle/0.1.0'
        store_class = 'internal_exploratory'
        video_id = 'rmvDxxNubIg'
        evaluation_scope = 'operator-runbook'
      }
    )
  }
  expectedVersions = @{ api = 'v1' }
} | ConvertTo-Json -Depth 15

$DemoAccepted = Invoke-RestMethod `
  "$env:KNOWLEDGE_API_URL/v1/demo/evaluations" `
  -Method Post `
  -Headers $DemoHeaders `
  -ContentType 'application/json' `
  -Body $DemoBody

Invoke-RestMethod $DemoAccepted.statusUrl -Headers $DemoHeaders | ConvertTo-Json -Depth 15
Invoke-RestMethod "$env:KNOWLEDGE_API_URL/v1/eval-runs/$($DemoAccepted.operationId)/report" -Headers $DemoHeaders | ConvertTo-Json -Depth 20
```

The result remains `internal_exploratory` and sets `canonicalPublication` to false.

## Read a persisted evidence packet

Start the API with `POSTGRES_URL` set. Use the tenant and packet ID recorded by the latest durability proof:

```powershell
Set-Location $KnowledgeRepo
$Proof = Get-Content -Raw catalog/canonical-durability-proof.json | ConvertFrom-Json
$PacketTenant = $Proof.tenantId
$PacketId = $Proof.packetId

$PacketHeaders = @{
  Authorization = "Bearer $ApiToken"
  'x-tenant-id' = $PacketTenant
  'x-correlation-id' = 'read-durable-packet-001'
}

Invoke-RestMethod `
  "$env:KNOWLEDGE_API_URL/v1/evidence-packets/$PacketId" `
  -Headers $PacketHeaders | ConvertTo-Json -Depth 30
```

The configured bearer identity needs a tenant grant for `$PacketTenant`. Evidence packets are reconstructed from normalized PostgreSQL rows and validated against the strict contract before the API returns them.

## HTTP endpoint reference

All `/v1` routes except none of the health/readiness routes require a bearer token and tenant header.

### Core endpoints

| Method | Path | Action scope | Behavior |
| --- | --- | --- | --- |
| GET | `/health` | None | Process liveness |
| GET | `/readiness` | None | Service and contract status |
| GET | `/v1/system` | `system.read` | Authenticated status |
| GET | `/v1/operations` | `knowledge.read` | Tenant-local operation list |
| POST | `/v1/operations` | `operation.submit` | Generic operation admission |
| GET | `/v1/operations/:id` | `knowledge.read` | Operation status |
| GET | `/v1/operations/:id/events?after=N` | `knowledge.read` | Up to 100 later events |
| POST | `/v1/operations/:id:cancel` | `operation.control` | Cancel operation |
| POST | `/v1/operations/:id:retry` | `operation.control` | Retry operation |
| POST | `/v1/operations/:id:reconcile` | `operation.control` | Recompute operation state |
| POST | `/v1/retrieval-plans:validate` | `retrieval.plan.validate` | Strict synchronous plan validation |
| POST | `/v1/demo/evaluations` | `demo.evaluate` | Execute bounded three-bundle evaluation |
| POST | `/v1/a2a/tasks` | `operation.submit` | Validate and admit an A2A task through the shared operation port |
| POST | `/v1/a2a/callbacks` | `callback.receive` | Verify and record one signed callback; exact replay returns 409 |
| GET | `/v1/evidence-packets/:id` | `knowledge.read` | Read validated persisted packet when resolver configured |
| GET | `/v1/chunking-procedures` | `knowledge.read` | List currently exposed admitted procedures |

### Collection admission endpoints

Each collection supports `POST` to admit or execute its documented operation and `GET` to list operations of that kind from the configured operation store. `retrieval-runs` is specialized: its POST executes canonical retrieval in the API deployment and persists the completed run before returning the accepted-operation links.

- `/v1/vector-stores`
- `/v1/captures`
- `/v1/documents`
- `/v1/document-versions`
- `/v1/representations`
- `/v1/promotion-proposals`
- `/v1/promotion-decisions`
- `/v1/embedding-runs`
- `/v1/space-publications`
- `/v1/retrieval-runs`
- `/v1/eval-datasets`
- `/v1/experiments`
- `/v1/eval-runs`
- `/v1/reviews`
- `/v1/review-decisions`

Collection-specific mutation endpoints are:

| Path | Operation kind |
| --- | --- |
| `POST /v1/sources:discover` | `source_discovery` |
| `POST /v1/sources:resolve` | `source_resolution` |
| `POST /v1/vector-stores/:id/documents` | `vector_store_documents` |
| `POST /v1/vector-stores/:id/ingestion-jobs` | `vector_store_ingestion` |
| `POST /v1/vector-stores/:id:search` | `vector_store_search` |
| `POST /v1/vector-stores/:id:evaluate` | `vector_store_evaluation` |
| `POST /v1/captures/:id:inspect` | `capture_inspection` |
| `POST /v1/captures/:id:compare` | `capture_comparison` |
| `POST /v1/captures/:id:vet` | `source_vetting` |
| `POST /v1/transformations` | `transformation` |
| `POST /v1/representations/:id:inspect` | `representation_inspection` |
| `POST /v1/representations/:id:compare` | `representation_comparison` |
| `POST /v1/representations/:id:decide` | `representation_decision` |
| `POST /v1/chunk-previews` | `chunk_preview` |
| `POST /v1/chunk-comparisons` | `chunk_comparison` |
| `POST /v1/chunk-sets` | `chunk_set` |
| `POST /v1/chunk-sets/:id:inspect` | `chunk_set_inspection` |

Vector-store mutations are typed at admission. Creation requires `knowledge.vector-store/v1`; attachment requires `knowledge.vector-store-documents/v1`; ingestion requires `knowledge.vector-store-ingestion/v1` with one to 1,000 complete lineage chains. For document attachment and ingestion, the `vectorStoreId` inside the input must exactly match the path ID. Ingestion verifies existing attachment, transformation, chunk-set, accepted promotion, embedding, and active publication rows across its ordered `prepare`, `embed`, and `index` checkpoints; it does not synthesize missing upstream work.
| `POST /v1/space-publications/:id:verify` | `publication_verification` |
| `POST /v1/space-publications/:id:rollback` | `publication_rollback` |

### Read canonical resources by resource identity

When `POSTGRES_URL` is configured, the following routes read tenant-scoped canonical rows. Their path ID is the resource's own UUID; it is never interpreted as an operation ID.

| Route | Authoritative rows | Bound |
| --- | --- | --- |
| `GET /v1/artifacts/:artifactId` | `orchestration.artifact` | metadata only; object paths and credentials are not exposed |
| `GET /v1/receipts/:receiptId` | `knowledge_service.receipt` plus its guarded operation event | one immutable receipt |
| `GET /v1/retrieval-runs/:runId` | `retrieval.retrieval_run`, its plan, and packet IDs | at most 100 packet IDs |
| `GET /v1/retrieval-runs/:runId/explanation` | run, candidates, and normalized candidate sources | at most 100 candidates and 1,000 source contributions |
| `GET /v1/eval-runs/:runId/report` | evaluation run, metric observations, and promotion-gate results | at most 1,000 metrics and 100 gates |
| `GET /v1/eval-runs/:runId/failures` | failed evaluation scores and case outputs | at most 100 failures; `truncated` reports overflow |
| `GET /v1/vector-stores/:vectorStoreId/operations/:operationId` | durable operation whose immutable request names that vector store | one operation status |

All reads require `knowledge.read` for the `x-tenant-id`. A UUID that exists only in another tenant produces the same `404 NOT_FOUND` as an absent UUID. Invalid UUID syntax produces `400 INVALID_CONTRACT`. A stored digest/reference inconsistency produces `409 CONFLICT`. The complete serialized response is capped at 1 MiB by default; oversized resources produce `413 LIMIT_EXCEEDED` rather than a partial response. API deployments can set a smaller programmatic `maximumResourceResponseBytes` when embedding `buildServer`.

Example PowerShell reads, assuming the variables from the authentication section are still set:

```powershell
$artifact = Invoke-RestMethod -Method Get -Uri "$ApiBase/v1/artifacts/$ArtifactId" -Headers $Headers
$receipt = Invoke-RestMethod -Method Get -Uri "$ApiBase/v1/receipts/$ReceiptId" -Headers $Headers
$run = Invoke-RestMethod -Method Get -Uri "$ApiBase/v1/retrieval-runs/$RetrievalRunId" -Headers $Headers
$explanation = Invoke-RestMethod -Method Get -Uri "$ApiBase/v1/retrieval-runs/$RetrievalRunId/explanation" -Headers $Headers

$artifact | ConvertTo-Json -Depth 10
$receipt | ConvertTo-Json -Depth 20
$run | ConvertTo-Json -Depth 20
$explanation | ConvertTo-Json -Depth 30
```

The artifact response is deliberately metadata-only. Large bytes still move through an admitted signed-download workflow; the API never returns Storage object paths, service-role credentials, or raw artifact bytes from this route. If PostgreSQL is intentionally omitted for process-local development, these canonical detail endpoints fail closed with `503` rather than fabricating a resource from the local operation ledger.

## Run A2A tasks and callbacks

`POST /v1/a2a/tasks` is a transport adapter, not a second orchestrator. The bearer must have `operation.submit`; `x-tenant-id`, `x-correlation-id`, the task context, and the bearer-bound actor must agree. The API maps the four public task kinds to canonical operations:

| A2A task kind | Canonical operation kind |
| --- | --- |
| `document_preparation` | `transformation` |
| `vector_store_ingestion` | `vector_store_ingestion` |
| `retrieval` | `retrieval_run` |
| `evidence_packet_construction` | `evidence_packet` |

The immutable operation input retains the task ID, purpose, input artifact IDs, expected output contract, callback URL, authentication reference, and signing-key reference. A repeated idempotency key with identical content returns the same operation; conflicting content returns `409 IDEMPOTENCY_CONFLICT`.

Configure callback verification before starting the API. Keep the actual secret in the runtime secret store and put only its opaque reference in a task:

```powershell
$env:KNOWLEDGE_CALLBACK_SIGNING_KEYS = @(
  @{
    tenantId = $TenantId
    signingKeyReference = 'secret://eve/knowledge-callback-v1'
    secret = $CallbackSigningSecret # At least 32 random bytes.
  }
) | ConvertTo-Json -Compress
```

The sender creates an `A2AResult`, signs the canonical callback envelope with `A2ACallbackHttpSender`, and resolves the exact URL, bearer token, and HMAC secret through an admitted target resolver. The resolver's URL and authentication/signing references must exactly match the task. HTTP redirects, URL credentials, fragments, non-HTTPS public endpoints, mismatched task/operation IDs, and responses larger than 64 KiB fail closed. Loopback HTTP is allowed for local tests only.

The receiver requires these headers:

```text
Authorization: Bearer <identity token with callback.receive>
x-tenant-id: <task tenant UUID>
x-correlation-id: <exact admitted task correlation ID>
x-knowledge-callback-signing-key-reference: <exact admitted opaque reference>
Content-Type: application/json
```

Before returning `202`, it verifies the callback schema, tenant-bound payload digest, HMAC in constant time, five-minute freshness window, 30-second future-clock allowance, operation tenant/correlation/causation lineage, and the callback task ID plus signing-key reference against the immutable A2A operation input. It then atomically inserts a digest-only row into `knowledge_service.callback_delivery`. The table stores no payload or secret, is append-only and RLS-bound, and survives API restarts. A repeated callback ID returns `409 CONFLICT`; signature, payload, tenant, task, key-reference, or lineage tampering is rejected before replay state is consumed.

For local-only tests without PostgreSQL, `buildServer` uses `CallbackReplayGuard`, whose replay memory lasts only for that process. Production API startup wires `PostgresCallbackReplayStore` whenever `POSTGRES_URL` is configured.

## Use the TypeScript client

Cross-repository callers should import only `@aiengineer/knowledge-client`.

```typescript
import {
  KnowledgeClient,
  type OperationContext,
  type RetrievalPlan,
} from "@aiengineer/knowledge-client";

const context: OperationContext = {
  tenantId: "00000000-0000-7000-8000-000000000001",
  operationId: crypto.randomUUID(),
  attemptId: crypto.randomUUID(),
  correlationId: crypto.randomUUID(),
  actor: {
    kind: "service",
    id: "00000000-0000-4000-8000-000000000010",
    serviceIdentity: "mission_control_client",
  },
  capabilityVersion: "consumer/1.0.0",
  idempotencyKey: crypto.randomUUID(),
  reason: "Retrieve evidence for an approved request",
  contractVersion: "v1",
};

const client = new KnowledgeClient({
  baseUrl: "http://127.0.0.1:4100",
  getAccessToken: async () => process.env.KNOWLEDGE_API_TOKEN ?? "",
});

const scoped = client.scoped(context);
const validated = await scoped.validateRetrievalPlan(plan satisfies RetrievalPlan);
const accepted = await scoped.retrieve(validated);
const status = await scoped.operation(accepted.operationId);
```

The same client exposes `submitA2ATask(task)` and `submitA2ACallback(envelope, signingKeyReference, context)`. Signing is deliberately separate from the generic client: use `A2ACallbackHttpSender` at the trusted callback edge so raw signing secrets never enter ordinary API client state.

Successful responses and problem responses are validated with Zod. Non-2xx responses throw `KnowledgeClientError` with a typed `problem` property. The client supplies tenant and correlation headers and propagates Eve/Mission Control external execution headers when present in context.

## Use the CLI

The CLI requires `KNOWLEDGE_API_TOKEN`, a base URL, valid context JSON, and input JSON. JSON is printed as one line by default; `--human` pretty-prints it.

PowerShell and pnpm can strip quotes from inline JSON. The following direct `tsx` invocation was smoke-tested in this workspace and preserves the JSON arguments:

```powershell
Set-Location $KnowledgeRepo
$env:KNOWLEDGE_API_TOKEN = $ApiToken

$CliContext = $Context | ConvertTo-Json -Depth 10 -Compress
$CliInput = @{
  query = 'AI engineering evaluation systems'
  maximumResults = 5
} | ConvertTo-Json -Depth 10 -Compress

node node_modules/tsx/dist/cli.mjs `
  apps/cli/src/index.ts `
  source discover `
  --base-url http://127.0.0.1:4100 `
  --context "$CliContext" `
  --input "$CliInput" `
  --human
```

The supported command tree is:

| Group | Actions |
| --- | --- |
| `source` | `discover`, `fetch`, `inspect`, `vet` |
| `store` | `create`, `show`, `add-documents`, `search`, `evaluate`, `status` |
| `document` | `convert`, `inspect`, `compare` |
| `chunk` | `preview`, `build`, `inspect` |
| `promotion` | `propose`, `review`, `status` |
| `embed` | `run`, `status`, `verify` |
| `retrieve` | `plan`, `search`, `explain` |
| `eval` | `generate`, `run`, `compare`, `failures` |
| `space` | `publish`, `rollback`, `rebuild` |
| `operation` | `status`, `events`, `retry`, `reconcile` |
| `db` | `verify`, `types`, `rls-test` |
| `fixture` | `load`, `reset` |

Most names map to generic operation kinds; they do not run local shell utilities. In particular, `db verify`, `db types`, and `db rls-test` submit review-shaped operations. Use the database commands later in this runbook for actual database verification.

Status and event commands read an `operationId` from their `--input` JSON:

```powershell
$StatusInput = @{ operationId = $OperationId } | ConvertTo-Json -Compress
node node_modules/tsx/dist/cli.mjs `
  apps/cli/src/index.ts `
  operation status `
  --base-url http://127.0.0.1:4100 `
  --context "$CliContext" `
  --input "$StatusInput" `
  --human
```

## Start and call MCP

Build first, then start MCP on a different port from the API:

```powershell
Set-Location $KnowledgeRepo
corepack pnpm build
$env:HOST = '127.0.0.1'
$env:PORT = '4101'
$env:POSTGRES_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
$env:KNOWLEDGE_API_URL = 'http://127.0.0.1:4100'
# Reuse a token configured in KNOWLEDGE_API_IDENTITIES for the same actor and tenant as $Context.
$env:KNOWLEDGE_API_TOKEN = 'replace-with-the-configured-bearer-token'
corepack pnpm --filter @aiengineer/knowledge-mcp start
```

Health check:

```powershell
Invoke-RestMethod http://127.0.0.1:4101/health
```

MCP uses stateless Streamable HTTP. Clients call `POST /mcp` with a bearer configured in `KNOWLEDGE_API_IDENTITIES` and `Accept: application/json, text/event-stream`. The token determines the actor and tenant grants; MCP never trusts actor, role, or scope claims from request headers or tool arguments.

Initialize:

```powershell
$McpHeaders = @{
  Authorization = "Bearer $env:KNOWLEDGE_API_TOKEN"
  Accept = 'application/json, text/event-stream'
}

$InitializeRequest = @{
  jsonrpc = '2.0'
  id = 1
  method = 'initialize'
  params = @{
    protocolVersion = '2025-06-18'
    capabilities = @{}
    clientInfo = @{ name = 'knowledge-runbook'; version = '1.0.0' }
  }
} | ConvertTo-Json -Depth 10

Invoke-RestMethod `
  http://127.0.0.1:4101/mcp `
  -Method Post `
  -Headers $McpHeaders `
  -ContentType 'application/json' `
  -Body $InitializeRequest
```

List the 37 tools:

```powershell
$ListToolsRequest = @{
  jsonrpc = '2.0'
  id = 2
  method = 'tools/list'
  params = @{}
} | ConvertTo-Json -Depth 5

$ToolList = Invoke-RestMethod `
  http://127.0.0.1:4101/mcp `
  -Method Post `
  -Headers $McpHeaders `
  -ContentType 'application/json' `
  -Body $ListToolsRequest

$ToolList.result.tools.name
```

Call `source.discover`:

```powershell
$McpArguments = @{
  context = $Context
  input = @{
    query = 'AI engineering evaluation systems'
    maximumResults = 5
  }
  expectedVersions = @{ api = 'v1' }
}

$ToolCallRequest = @{
  jsonrpc = '2.0'
  id = 3
  method = 'tools/call'
  params = @{
    name = 'source.discover'
    arguments = $McpArguments
  }
} | ConvertTo-Json -Depth 15

Invoke-RestMethod `
  http://127.0.0.1:4101/mcp `
  -Method Post `
  -Headers $McpHeaders `
  -ContentType 'application/json' `
  -Body $ToolCallRequest | ConvertTo-Json -Depth 15
```

Every MCP tool accepts `context`, arbitrary JSON `input`, and a nonempty `expectedVersions` map. Tools return accepted operation records. MCP never exposes raw SQL, secret reads, Storage listing, approval, publication, or capability admission.

MCP submits through the same durable application port used by the PostgreSQL-configured API. Returned status, event, cancellation, retry, and reconciliation URLs point to `KNOWLEDGE_API_URL`, where the API serves the canonical operation record. Start MCP with `POSTGRES_URL` and the worker with the same tenant to execute admitted steps.

## MCP tool families

- Source: `source.discover`, `source.resolve_identity`, `source.fetch`, `source.inspect_capture`, `source.compare_captures`, `source.propose_vetting`.
- Vector store: `vector_store.create`, `vector_store.add_documents`, `vector_store.ingestion_status`, `vector_store.search`, `vector_store.evaluate`.
- Document: `document.convert`, `document.inspect_representation`, `document.compare_representations`, `document.request_manual_review`.
- Knowledge proposals: `knowledge.propose_domain_mapping`, `knowledge.propose_claims`, `knowledge.propose_entity_links`.
- Chunking: `chunk.strategy_list`, `chunk.preview`, `chunk.compare`, `chunk.inspect`, `chunk.create_intent`.
- Embeddings: `embedding.model_list`, `embedding.estimate`, `embedding.create_intent`, `embedding.run_status`.
- Retrieval: `retrieval.plan_validate`, `retrieval.search`, `retrieval.explain_run`, `retrieval.build_evidence_packet`.
- Evaluation: `evaluation.generate_query_candidates`, `evaluation.run_experiment`, `evaluation.compare_experiments`, `evaluation.inspect_failures`.
- Promotion: `promotion.submit`, `promotion.status`.

## Start the local database and Storage

The schema authority is the adjacent `ai-engineer-db-contract` repository.

```powershell
Set-Location $DatabaseRepo
corepack pnpm install --frozen-lockfile
corepack pnpm db:start
```

Inspect status:

```powershell
$StatusText = corepack pnpm exec supabase status -o json 2>$null
$LocalStatus = $StatusText | ConvertFrom-Json
$LocalStatus | ConvertTo-Json -Depth 5
```

Reset applies every migration and seed. It deletes local database contents, so use it only against this local development project:

```powershell
Set-Location $DatabaseRepo
corepack pnpm db:reset
```

Export the canonical runtime values without copying credentials into source files:

```powershell
$env:POSTGRES_URL = $LocalStatus.DB_URL
$env:SUPABASE_URL = $LocalStatus.API_URL
$env:SUPABASE_SECRET_KEY = $LocalStatus.SERVICE_ROLE_KEY
$env:SUPABASE_STORAGE_BUCKET = 'source-captures'
$env:CANONICAL_LOCAL_ONLY = '1'
```

Verify the database contract:

```powershell
Set-Location $DatabaseRepo
corepack pnpm exec supabase test db
corepack pnpm types:check
corepack pnpm typecheck
```

The current suite contains 74 pgTAP assertions in five files. `types:check` confirms that generated TypeScript types match the local schema.

## Start the canonical worker

The worker defaults to PostgreSQL mode and fails closed if required persistence values are absent.

```powershell
Set-Location $KnowledgeRepo
$env:NODE_ENV = 'development'
$env:KNOWLEDGE_PERSISTENCE_MODE = 'postgres'
$env:WORKER_TENANT_ID = '00000000-0000-7000-8000-000000000001'
$env:WORKER_ID = 'knowledge-worker-local-1'
$env:WORKER_POLL_MS = '1000'
$env:WORKER_LEASE_MS = '30000'
$env:SUPABASE_STORAGE_BUCKET = 'source-captures'
$env:CANONICAL_LOCAL_ONLY = '1'
corepack pnpm --filter @aiengineer/knowledge-worker start
```

Expected startup output is one JSON event named `knowledge.worker.started` with the mode, owner, reconciliation count, `registeredActivities`, service name, status, contract version, and runtime. In PostgreSQL mode, the activity list should contain:

- `capture:acquire`
- `capture:seal`
- `transformation:convert`
- `transformation:inspect`
- `chunk_set:chunk`
- `chunk_set:verify`
- `source_vetting:vet`
- `evaluation_dataset:freeze`
- `evaluation_run:evaluate`
- `evaluation_run:report`
- `vector_store_evaluation:evaluate`
- `publication_verification:verify`
- `evidence_packet:packet`

On startup, the worker reconciles incomplete operations for `WORKER_TENANT_ID`. It then polls serially, claims a fenced lease only for operation kinds represented in its installed activity registry, heartbeats approximately every third of the lease interval with a 250 ms minimum, invokes its activity executor, records an immutable receipt, and reconciles the operation. API-owned `retrieval_run` operations are therefore not stolen by the production worker; the retrieval API leases its submitted operation explicitly. Unsupported steps inside an admitted worker-owned operation kind still fail closed. SIGINT and SIGTERM stop new polling, wait for the active activity, close PostgreSQL, and emit `knowledge.worker.stopped`.

The canonical executor validates the operation request and step envelope against their stored SHA-256 digests and against each other before dispatch. Unsupported operation/step pairs fail non-retryably with `UNSUPPORTED_OPERATION_ACTIVITY`; this is deliberate protection against false success receipts. Embedding, publication, rollback, and reviewer-decision activities remain fail-closed unless their complete authority-bearing handlers are installed.

### Durable preparation path

The worker implements three strict, versioned preparation operations. They intentionally stop at candidate chunks and never publish or embed them.

1. Submit `capture` with `schemaVersion: knowledge.capture/v1`, an exact HTTPS target, matching canonical source identity/classification, a bounded byte limit, and `egressProfile: public-web-v1`. `acquire` performs DNS/IP/redirect policy checks, fetches through the pinned-address transport, seals bytes in private Storage, and atomically writes artifact, source, and source-capture rows. `seal` downloads the object and verifies its SHA-256 and byte length.
2. Submit `transformation` with `schemaVersion: knowledge.transformation/v1`, the completed capture operation ID, document identity/version metadata, a frozen conversion profile, and an ordered `providerRoute`. Configured routes are `unstructured-transform` when all Unstructured credentials are present, `docling-serve`, and `deterministic-structural-text`. The worker records attempts, seals provider-native/Markdown/plain outputs, writes document/version/source-native and structural representations, transformation inputs/outputs, artifact lineage, structural nodes, a fidelity evaluation, and an immutable conversion review subject. The representation remains `pending`; the result says `requiresReview: true` and `publishable: false`.
3. Submit `chunk_set` with `schemaVersion: knowledge.chunk-set/v1`, the structural representation ID, and an admitted profile such as `heading-sections-v1@1.0.0`. `chunk` reloads canonical nodes, validates them, reconstructs deterministic chunks, applies chunk QA, and atomically writes the procedure, candidate chunk set, chunks, and spans. `verify` confirms cardinality and reconstructability while returning `promotionState: candidate` and `publishable: false`.

Production acquisition controls are worker-owned and cannot be supplied by operation input:

```powershell
$env:ACQUISITION_ALLOWED_HOSTS = 'example.com,docs.example.com' # omit for any policy-safe public host
$env:ACQUISITION_TIMEOUT_MS = '30000'
$env:ACQUISITION_MAXIMUM_REDIRECTS = '5'
$env:ACQUISITION_MAXIMUM_DECOMPRESSION_RATIO = '20'
$env:ALLOW_INSECURE_HTTP_ACQUISITION = '0'
```

Inputs cannot supply headers, credentials, parser commands, or arbitrary egress policy. Private, loopback, link-local, metadata, documentation, multicast, and other denied address ranges fail closed. Every redirect is re-resolved and revalidated.

Run deterministic and local database replay/tamper tests:

```powershell
corepack pnpm --filter @aiengineer/knowledge-worker test
$env:RUN_LOCAL_PERSISTENCE_TESTS = '1'
corepack pnpm --filter @aiengineer/knowledge-persistence exec vitest run src/preparation.test.ts
```

The database test retries identical capture/representation/chunk manifests and rejects reuse of an artifact ID, node ID, or span ordinal with changed guarded content. Standalone captures point to their tenant-scoped `knowledge_service.operation`; Mission Control captures retain the existing `orchestration.attempt` path. A database check requires exactly one producer identity.

Exercise the connected local path against a unique public `https://httpbin.org/anything/...` resource, PostgreSQL, and separate private source/derivative Storage buckets. Keep Docling stopped to prove the observed Docling-to-deterministic fallback:

```powershell
$env:CANONICAL_LOCAL_ONLY = '1'
$env:WORKER_TENANT_ID = '00000000-0000-7000-8000-000000000001'
corepack pnpm prove:durable-preparation
```

The command admits and executes six fenced worker activities across three operations, re-submits every envelope to prove idempotency, verifies exact receipt cardinality, and writes a secret-free evidence record to `catalog/durable-preparation-proof.json`. It fails rather than writing evidence unless the capture object is digest-addressed, the seal receipt exists, conversion remains review-pending, chunks exist, replay creates no receipts, and the provider-attempt record proves Docling failure followed by deterministic success.

Source vetting is the highest-value connected preparation path: it validates and vets an `internal_exploratory` bundle, emits a deterministic proposal, creates an immutable `source_vetting` review subject bound to the proposal digest, and records the result in the step receipt. It does not approve, embed, or publish the content.

### In-memory worker mode

In-memory mode is only admitted for development or tests:

```powershell
Set-Location $KnowledgeRepo
$env:NODE_ENV = 'development'
$env:KNOWLEDGE_PERSISTENCE_MODE = 'memory'
$env:WORKER_POLL_MS = '1000'
corepack pnpm --filter @aiengineer/knowledge-worker start
```

This worker has its own in-process integration service. It does not share API or MCP state across operating-system processes. Production mode rejects memory persistence.

## Run the canonical durability proof

This is the authoritative local connected-path exercise. It is restricted to localhost PostgreSQL/Storage and the dedicated tenant `00000000-0000-7000-8000-000000000001`. It never publishes `official_canonical` data.

```powershell
Set-Location $KnowledgeRepo
$env:POSTGRES_URL = $LocalStatus.DB_URL
$env:SUPABASE_URL = $LocalStatus.API_URL
$env:SUPABASE_SECRET_KEY = $LocalStatus.SERVICE_ROLE_KEY
corepack pnpm prove:canonical-durability
```

The proof performs:

1. Process A stores the three bundles as immutable private objects and runs a real worker process that publishes 41 vectors.
2. Process B starts fresh, reads only PostgreSQL plus private Storage, verifies object digests, runs hybrid and exact/ANN retrieval, and reconstructs a typed evidence packet.
3. A replacement publication is created, rolled back, and rebuilt from stored objects and receipts.
4. Lease fencing, outbox nack/reclaim/ack, provider fallback, reranker fallback, database pause/recovery, and callback-safe operation behavior are exercised.
5. A real API process and separate TypeScript client retrieve the persisted packet over HTTP.

Inspect the receipt:

```powershell
$Proof = Get-Content -Raw catalog/canonical-durability-proof.json | ConvertFrom-Json
$Proof | Select-Object schemaVersion,storeClass,tenantId,packetId,receiptDigest
$Proof.processBoundaries | Format-Table name,reportedPid,exitCode,startedAt,endedAt
$Proof.drills | ConvertTo-Json -Depth 10
```

Every run uses a new proof namespace while preserving prior immutable records.

## Run the local HNSW proof

```powershell
Set-Location $KnowledgeRepo
$env:POSTGRES_URL = $LocalStatus.DB_URL
corepack pnpm prove:hnsw-local
```

The script inserts 6,000 deterministic 1,536-dimensional half-vectors into a temporary table, builds HNSW, records three `EXPLAIN (ANALYZE, BUFFERS)` plans, compares ANN Recall@20 against forced exact sequential scans, and rolls the transaction back. It fails unless HNSW is used and average recall is at least 0.8.

Review `catalog/local-hnsw-proof.json`. Repeat this proof for each deployed PostgreSQL environment because planner behavior depends on data, statistics, and hardware.

## Start Docling Serve

Docling is an isolated conversion fallback. It has no orchestration, review, or publication authority. `HttpDoclingServeClient` implements the stable synchronous multipart `POST /v1/convert/file` contract, requests Markdown/JSON/text output, bounds time and response bytes, validates the response shape/status, and keeps an optional API key confined to the HTTP adapter.

```powershell
Set-Location $KnowledgeRepo
docker compose -f services/docling/compose.yaml up -d
docker compose -f services/docling/compose.yaml ps
Invoke-WebRequest http://127.0.0.1:5001/health
```

The image is pinned by digest, binds only to loopback, uses a read-only root filesystem, drops Linux capabilities, denies privilege escalation, uses bounded tmpfs, and declares 8 GiB memory and four CPUs. A deployment platform must separately deny outbound network. The HTTP client is available to runtime composition, but the default worker activity bootstrap must explicitly construct and register the conversion handler before Docling jobs will be dispatched.

Stop Docling:

```powershell
docker compose -f services/docling/compose.yaml down
```

Run the bounded live adapter check while the container is healthy:

```powershell
corepack pnpm test:live:docling
```

This uploads a small local Markdown fixture through the actual multipart v1 endpoint, seals provider-native/Markdown/plain-text outputs, verifies five reconstructed structural nodes, and writes the noncanonical receipt `catalog/live-docling-receipt.json`. It does not fetch external content or publish knowledge.

## Run deterministic evaluations

### Three real bundles

```powershell
Set-Location $KnowledgeRepo
corepack pnpm evaluate:bundles
```

This validates and processes the three allow-listed `internal_exploratory` bundles. Current coverage is 37 selected documents, 41 claim projections, and 41 vectors. The receipt is `catalog/real-bundle-evaluation.json`.

### Broad retrieval corpus

```powershell
Set-Location $KnowledgeRepo
corepack pnpm evaluate:broad
```

This evaluates 96 cases, split evenly among development, calibration, and held-out partitions. It covers the seven public domains plus source-native sections and 11 query classes. It records ablations, hard gates, quality gates, regression gates, false acceptances, and rollback. The receipt is `catalog/broad-heldout-evaluation.json`.

The planner receives only the public query and explicitly requested spaces. A regression test poisons hidden domain, query-class, qrel, expected-filter, and expected-result-type data and proves the actual 96 packet digests and results remain unchanged.

## Run live provider checks

Live commands spend provider quota and require explicit credentials. They write bounded, secret-free, noncanonical receipts.

### Vercel AI Gateway embeddings

```powershell
Set-Location $KnowledgeRepo
$env:AI_GATEWAY_API_KEY = '<secret>'
corepack pnpm test:live:gateway
```

The accepted run embedded 41 ordered projections using `openai/text-embedding-3-small` at 1,536 dimensions. Receipt: `catalog/live-embedding-receipt.json`.

### Vercel AI Gateway judge calibration

```powershell
Set-Location $KnowledgeRepo
$env:AI_GATEWAY_API_KEY = '<secret>'
corepack pnpm test:live:judge
```

This is a bounded 12-case model calibration. It is not human adjudication. Receipt: `catalog/live-judge-calibration-receipt.json`.

### Exact HTTP, Firecrawl, and conversion fallback

```powershell
Set-Location $KnowledgeRepo
$env:FIRECRAWL_API_KEY = '<secret>'
corepack pnpm test:live:gate1
```

The command runs the exact HTTP transport, the Firecrawl adapter when configured, and the deterministic managed-to-local fallback proof. This particular script specifies `--env-file=../.env`, so file-based credentials belong in the workspace-level `C:\Users\Pinda\Proyectos\aiengineer\.env`; an already-set process environment variable such as the example above also works. Unstructured is reported as `not_configured` unless all three Unstructured variables are present. Receipt: `catalog/gate1-live-evidence.json`.

The exact HTTP adapter resolves and validates addresses before connecting, pins the validated address to the socket, preserves the original Host and HTTPS SNI/certificate identity, and repeats validation for every redirect.

## Run local persistence integration tests

The ordinary test suite skips tests that require live local PostgreSQL. Enable them after the local database is running:

```powershell
Set-Location $KnowledgeRepo
$env:RUN_LOCAL_PERSISTENCE_TESTS = '1'
$env:POSTGRES_URL = $LocalStatus.DB_URL
corepack pnpm --filter @aiengineer/knowledge-persistence test
corepack pnpm --filter @aiengineer/knowledge-api test
corepack pnpm --filter @aiengineer/knowledge-worker test
Remove-Item Env:RUN_LOCAL_PERSISTENCE_TESTS
```

These tests cover canonical operation idempotency, ordered steps, leases, receipts, outbox fencing, evidence-packet materialization/reconstruction, API-to-separate-connection admission/completion/cancellation/retry, registered activity dispatch, fail-closed unsupported work, and a distinct-process expired-lease recovery.

## Run the sampled human review

Generate or refresh the locked packet and blank template:

```powershell
Set-Location $KnowledgeRepo
corepack pnpm create:gate5-human-sample
```

Give the reviewer only:

- `catalog/gate5-human-review-sample.packet.json`
- `catalog/gate5-human-review-response.template.json`
- `docs/GATE5_HUMAN_REVIEW.md`

The reviewer fills every assessment and preserves the digest fields and attestation. Establish their identity out of band. Then validate:

```powershell
corepack pnpm validate:gate5-human -- `
  catalog/gate5-human-review-sample.packet.json `
  path\to\completed-human-submission.json `
  catalog\gate5-human-review-receipt.json `
  --verified-reviewer 'reviewer@example.com'
```

The validator rebuilds the frozen corpus and actual hybrid-control outputs, recomputes hidden references, compares the complete packet digest, verifies the canonical seed and sample size, and rejects incomplete, modified, duplicate, unverified, or uncertain submissions. It never grants publication authority.

## Run the Vercel Eve consumer

The actual Eve consumer resides outside this repository and imports only the published client.

```powershell
Set-Location $EveConsumer
corepack pnpm install --frozen-lockfile
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
```

Run `corepack pnpm eval` only when the target service, credentials, and bounded evaluation inputs are configured; it invokes Eve's strict evaluation mode and can make live model/service calls.

Its single authored tool is `consume_knowledge`. Default broad Eve tools are disabled. The consumer can validate a retrieval plan, submit a retrieval run, read an operation, read an evidence packet, and run the exact three-bundle exploratory evaluation. It propagates Eve session, turn, tool-call, root-run, and parent lineage through `OperationContext.externalExecution`.

The live receipt is `research_ingestion_systems_agent/agents/knowledge-consumer/evals/receipts/2026-09-03-three-bundle-live.json`.

## Run the application client acceptance

Fixture mode starts its own loopback contract fixture:

```powershell
Set-Location $ApplicationRepo
corepack pnpm test:acceptance:knowledge
```

Live mode requires a running API with the durable evidence-packet resolver and a persisted packet:

```powershell
$Proof = Get-Content -Raw (Join-Path $KnowledgeRepo 'catalog\canonical-durability-proof.json') | ConvertFrom-Json
$env:KNOWLEDGE_API_BASE_URL = 'http://127.0.0.1:4100'
$env:KNOWLEDGE_API_TOKEN = $ApiToken
$env:KNOWLEDGE_ACCEPTANCE_TENANT_ID = $Proof.tenantId
$env:KNOWLEDGE_ACCEPTANCE_PACKET_ID = $Proof.packetId
$env:KNOWLEDGE_ACCEPTANCE_CORRELATION_ID = 'app-live-acceptance-001'

Set-Location $ApplicationRepo
corepack pnpm test:acceptance:knowledge
```

The acceptance harness verifies bearer authentication, tenant isolation, correlation propagation, strict packet parsing, and the render model. It scans for forbidden imports so the application uses only `@aiengineer/knowledge-client` rather than database, persistence, or vector internals.

## Contract generation

Regenerate OpenAPI and JSON Schemas after changing a contract:

```powershell
Set-Location $KnowledgeRepo
corepack pnpm --filter @aiengineer/knowledge-contracts generate
corepack pnpm --filter @aiengineer/knowledge-contracts test
git diff -- packages/contracts/generated
```

Generated outputs include `openapi.json`, nine JSON Schemas, and `manifest.json`. Review generated diffs and update consumers when any compatibility boundary changes.

## Normal shutdown

- API, MCP, and foreground worker: press Ctrl+C. On Windows pnpm may ask `Terminate batch job (Y/N)?`; answer `Y`.
- Docling: `docker compose -f services/docling/compose.yaml down`.
- Local Supabase: from the database repository run `corepack pnpm exec supabase stop`.

Before stopping PostgreSQL during a worker activity, allow graceful shutdown or wait for the lease to expire. A replacement worker will reconcile and reclaim expired work with a higher fencing token.

## Recovery procedures

### Worker exits after claiming a step

1. Preserve the operation ID, step ID, holder, fencing token, and latest event/receipt IDs.
2. Confirm the old process is gone.
3. Wait for the lease to expire; do not reuse its token.
4. Restart a worker with the same tenant and a distinct `WORKER_ID`.
5. Confirm startup reconciliation, a higher fencing token, one terminal receipt, and no duplicate canonical objects.
6. Run the relevant regression test.

### Database outage

1. Stop new admissions that depend on canonical persistence.
2. Let current calls fail as `DATABASE_UNAVAILABLE`; do not substitute an in-memory canonical path.
3. Restore PostgreSQL and Storage.
4. Start one worker and inspect its reconciliation count.
5. Verify operations, steps, receipts, outbox rows, publication pointers, vector counts, and evidence packets.
6. Re-run the canonical durability proof if the incident affected publication or packet storage.

### Provider outage or rate limit

1. Stop new provider calls when error/latency thresholds open the circuit.
2. Retry only with the same input and idempotency identity, or select an admitted fallback.
3. Preserve every provider attempt and derivative artifact; never overwrite a prior result.
4. Compare input, output, and receipt digests.
5. Require a new capability version when provider identity, image, schema, or behavior changes.

### HNSW or retrieval regression

1. Route bounded diagnostics to exact search.
2. Run `prove:hnsw-local` or the environment-specific equivalent.
3. Inspect HNSW and exact plans, row counts, filters, and Recall@20.
4. Rebuild the index only through an approved operational procedure.
5. Re-run broad evaluation and compare against the frozen regression baseline before restoring traffic.

### Invalid approval digest

1. Reject the decision; do not reinterpret it against changed content.
2. Create a new review subject bound to the new guarded digest.
3. Confirm no publication receipt or active-pointer change exists for the rejected digest.

### Cross-tenant or false acceptance

1. Disable the affected surface or revoke the affected token.
2. Quarantine the publication and preserve evidence.
3. Inspect tenant context, RLS, filter execution, authorization decisions, and packet members.
4. Add a regression case and run database, retrieval, and security tests.
5. Restore service only after deterministic and human policy review where required.

### Storage integrity failure

1. Stop dependent transformation, embedding, and publication work.
2. Compare object bytes with the recorded SHA-256 digest and artifact metadata.
3. Restore the immutable object from an approved backup or alternate accepted representation.
4. Re-run reconstruction and lineage verification. Never repair by silently replacing bytes under the same digest path.

## Troubleshooting reference

| Symptom | Cause | Resolution |
| --- | --- | --- |
| Protected API route returns 401 | Missing/unknown bearer token or no identity configuration | Set `KNOWLEDGE_API_IDENTITIES`; send its exact token |
| API returns 403 | Tenant, role/scope, or actor mismatch | Match header tenant, envelope tenant, and configured actor; grant the required action |
| Mutation returns correlation mismatch | Header and context differ | Generate one correlation ID and use it in both places |
| Replay returns 409 | Same idempotency/operation identity used with different input or kind | Reuse only exact input; otherwise create a new operation and idempotency key |
| CLI reports invalid JSON | PowerShell/pnpm stripped quotes | Use the direct `node node_modules/tsx/dist/cli.mjs` form above |
| CLI `fetch failed` with `bad port` | WHATWG Fetch blocks certain unsafe ports | Use the documented API port 4100 |
| API operation stays queued | Generic API operation ledger has no in-process executor | Expected for reference routes; use the demo route or canonical durability path |
| Worker cannot see API operation | API ledger and PostgreSQL worker queue are separate | Do not assume they are connected; seed/use canonical operations through the durable path |
| MCP status URL returns no route | `KNOWLEDGE_API_URL` is incorrect or the API is not running | Set the public API origin reachable by MCP clients, start the API, and use the same bearer/tenant grant |
| Worker says `WORKER_TENANT_ID_REQUIRED` | PostgreSQL mode is default | Set `WORKER_TENANT_ID` and canonical persistence variables |
| Worker rejects memory mode | `NODE_ENV` is production or unset for an explicit memory request | Use memory only with `NODE_ENV=development` or `test` |
| Persistence says `CANONICAL_STORAGE_BUCKET_REQUIRED` | Bucket name is not one of two admitted names | Use `source-captures` or `content-derivatives` |
| Persistence says `LOCAL_POSTGRES_REQUIRED` | Local-only proof targeted another host/port | Use the adjacent local Supabase database at localhost:54322 |
| Evidence packet returns 404 | API has no Postgres resolver, tenant differs, or packet is absent | Start API with `POSTGRES_URL`, grant the proof tenant, and use receipt packet ID |
| Live gateway test lacks credentials | `AI_GATEWAY_API_KEY` and `VERCEL_OIDC_TOKEN` absent | Set one explicitly; do not commit it |
| Firecrawl is `not_configured` | No Firecrawl key | Set `FIRECRAWL_API_KEY` for an explicit live run |
| Unstructured is `not_configured` | URL, key, or template missing | Configure all three or accept the recorded fallback-only proof |
| Docling health fails during startup | Large image still loading | Inspect `docker compose ps` and logs; allow the configured 90-second start period |

## Release verification sequence

Use this order for a standalone release candidate:

1. Apply additive database migrations in the database-contract repository.
2. Reset a disposable local database and run all 74 pgTAP assertions.
3. Regenerate and check database TypeScript types.
4. Generate public contracts and review their diffs.
5. Run `corepack pnpm verify`.
6. Run local persistence tests with the explicit flag.
7. Run `evaluate:bundles` and `evaluate:broad`.
8. Run `prove:hnsw-local` and `prove:canonical-durability`.
9. Run API, MCP, CLI, Eve, and application acceptance checks.
10. Run live provider checks only when credentials and budget are approved.
11. Complete the sampled-human review before claiming literal Gate 5.
12. Deploy contracts/client, API/MCP, worker, then optional Docling capacity.
13. Shift traffic only after environment-specific authorization, network, queue, Storage, HNSW, callback, and rollback checks pass.

## Deployment and rollback

The intended placement is API and MCP as two Vercel Fluid Compute projects, with the worker and Docling as independently scalable ECS/Fargate services. Set the Vercel project roots to `apps/api` and `apps/mcp`. Their default Node handlers are import-safe and reuse a warm Fastify/PostgreSQL singleton; production startup requires PostgreSQL and a canonical HTTPS `KNOWLEDGE_API_URL`. The API can remain operational without an embedding credential, but canonical retrieval returns `503` until `AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN` is present.

The deployable AWS template is `infra/aws/knowledge-runtime.template.json`; its operator instructions and secret JSON-key contract are in `infra/aws/README.md`. Validate it before creating a change set:

```powershell
aws cloudformation validate-template `
  --template-body file://infra/aws/knowledge-runtime.template.json
```

The stack uses private subnets, an internal TLS load balancer/private DNS record for Docling, source-restricted Docling ingress, port-constrained outbound rules, digest-pinned images, Secrets Manager references, retained logs, health checks, circuit-breaker rollback, alarms, and independent worker/Docling scaling. Worker TCP 443/5432 and Docling TCP 443 egress still target `0.0.0.0/0`; deploy controlled NAT/egress filtering or private endpoints before treating outbound networking as destination-restricted. The repository's deployment contract tests, real AWS template validation, worker image build, non-root container boot, and graceful stop have passed. These checks do not substitute for a managed-environment network, identity, secret, and smoke-test acceptance run.

The generated OpenAPI at `packages/contracts/generated/openapi.json` covers all 73 current public HTTP operations. CI reverse-compares its `x-fastify-route` registrations to the routes Fastify actually installs and resolves every embedded schema reference, so undocumented or dangling routes fail verification. See `docs/deployment.md` for the full Vercel/AWS sequence.

CLI commands are semantically strict: `store show` reads a persisted vector-store ID; `store status` reads a supplied vector-store/operation pair; promotion and embedding status read operation IDs; `retrieve plan` validates without admission; `retrieve explain` and `eval failures` read persisted run IDs. `retrieve search` alone uses API-owned canonical retrieval. Deferred commands (including generic vector-store search and space rebuild) return `CAPABILITY_NOT_ADMITTED` before creating an operation. `embed verify` is a publication-verification mutation that performs ANN-versus-exact verification; it is not an embedding status alias.

Rollback procedure:

1. Stop new admissions.
2. Restore the previous API/MCP and worker versions.
3. Deactivate the failed vector-space publication through the guarded rollback function.
4. Reconcile outstanding operations and fenced outbox messages.
5. Verify the prior publication with scoped hybrid and exact retrieval.
6. Re-run environment-specific regression gates.

Rollback preserves immutable artifacts, representations, chunks, projections, embeddings, events, decisions, and receipts. Never delete the failed lineage to make a rollback appear clean.

## Operator completion checklist

- API and MCP secrets are present only in secret configuration.
- Bearer identities have the minimum tenant roles/scopes needed.
- Header tenant, actor, and correlation match mutation context.
- Generic reference-surface operations are not confused with PostgreSQL worker execution.
- Canonical operations use PostgreSQL plus one admitted private Storage bucket.
- `CANONICAL_LOCAL_ONLY=1` protects local proof commands.
- Database migrations, pgTAP, generated types, typechecks, tests, and builds pass.
- Bundle, broad-corpus, HNSW, and durability receipts were regenerated and inspected.
- Live receipts contain no credentials or provider bodies.
- Eve and application consumers import only the published client.
- The human-review receipt exists only after an actual human review and out-of-band identity verification.
- No `official_canonical` publication occurs without explicit eligible authority and a matching guarded digest.
