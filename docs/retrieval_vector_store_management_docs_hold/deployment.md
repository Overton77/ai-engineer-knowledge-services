# Deployment guide

Gate 6 retains three independently versioned runtime boundaries that share contracts and application services.

| Runtime | Initial placement | Responsibility |
| --- | --- | --- |
| API and MCP | Vercel Fluid Compute or Node container | authenticated bounded commands, retrieval, status and tool facade |
| Knowledge worker | always-on container | leases, heartbeats, long activities, evaluation, publication and reconciliation |
| Docling Serve | isolated CPU/GPU container | pinned conversion only; no canonical state or authority |

Configuration is supplied by secret references at the final adapter. Never pass resolved secrets through operation input, events, receipts, or model context. API/MCP-to-worker and worker-to-Docling traffic uses workload identity or private networking. Health indicates process liveness; readiness validates contract version and required dependencies.

Deploy in this order: contracts/client, API/MCP, worker, then optional Docling capacity. Apply additive database-contract migrations before a release that requires them. Run client/MCP contract tests, restart/reconciliation tests, callback replay tests, tenant authorization tests, bounded three-bundle exploratory demo, and retrieval regression gates before shifting traffic.

Rollback preserves immutable artifacts and receipts: stop new admissions, restore the prior API/MCP and worker versions, deactivate the failed space version through guarded rollback, reconcile outstanding operations, and verify the previous version with a scoped retrieval. Mission Control and Eve remain callers; neither deployment is required for local adapter tests.

Scale retrieval separately only after measured latency or isolation need. Any extraction must retain the same contracts, idempotency, authorization, event, artifact, and receipt semantics.

## Vercel API and MCP projects

Create two Vercel projects with Root Directory `apps/api` and `apps/mcp`, respectively. Each directory has a validated `vercel.json` and a `src/index.ts` entrypoint that exports a default Node request handler. Importing either entrypoint is side-effect free: the handler lazily creates a single Fastify/PostgreSQL runtime per warm function isolate, while direct local execution enters the guarded listener path. Fluid Compute, `iad1`, 1,024 MiB, a 300-second maximum request duration, private/no-store responses, and baseline response-hardening headers are explicit in each manifest.

Required API production variables:

- `NODE_ENV=production`
- `POSTGRES_URL` as a secret
- `KNOWLEDGE_API_URL` as the public HTTPS origin with no path, query, fragment, or credentials
- `KNOWLEDGE_API_IDENTITIES` as a secret tenant/actor grant map
- `KNOWLEDGE_CALLBACK_SIGNING_KEYS` when A2A callbacks are admitted
- `AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN` when canonical retrieval is admitted

The API intentionally boots without a Gateway credential so status, operation, callback, and immutable-resource endpoints remain available during provider outage. `POST /v1/retrieval-runs` returns a typed `503` before operation admission until one of the two embedding credentials is configured.

Required MCP production variables:

- `NODE_ENV=production`
- `POSTGRES_URL` as a secret
- `KNOWLEDGE_API_URL` as the API project's public HTTPS origin
- `KNOWLEDGE_API_IDENTITIES` as the same secret tenant/actor grant map used by the API

Build both boundaries independently before deployment:

```powershell
corepack pnpm --filter @aiengineer/knowledge-api... build
corepack pnpm --filter @aiengineer/knowledge-mcp... build
```

Deploy from the monorepo only after configuring the two project roots and their environment variables. Never copy a resolved secret into `vercel.json`:

```powershell
vercel deploy --cwd apps/api
vercel deploy --cwd apps/mcp
```

The repository validates imports, production fail-closed configuration, handler exports, builds, and local HTTP behavior. A successful local build is not evidence of Vercel network reachability or production identity configuration; verify `/health`, `/readiness`, an authenticated `/v1/system` request, MCP initialization, and one durable operation after deployment.

## AWS worker and private Docling stack

`infra/aws/knowledge-runtime.template.json` is the deployable CloudFormation package. It consumes an existing VPC, two or more private subnets, private Route 53 zone, and matching ACM certificate. It creates independently scalable ECS/Fargate worker and Docling services. Docling has no public listener: the worker reaches it through a private DNS name and internal TLS load balancer, and task security groups admit port 5001 only from that load balancer. Both task families use digest-pinned images, read-only roots, separate task roles, CloudWatch logs, circuit-breaker rollback, and bounded scaling. Docling additionally drops all capabilities, uses a bounded temporary filesystem, exposes a container/load-balancer health check, and has an unhealthy-target alarm. Inbound Docling paths are source-restricted; outbound rules are only port/protocol constrained (`443` and worker PostgreSQL `5432`) and still target `0.0.0.0/0`. Deploy through controlled NAT/egress filtering or private endpoints and restrict destinations as part of managed-environment acceptance.

Validate before creating a change set:

```powershell
aws cloudformation validate-template `
  --template-body file://infra/aws/knowledge-runtime.template.json
```

Copy `infra/aws/parameters.example.json` outside the repository, replace identifiers, and keep the referenced secret values in Secrets Manager. Then inspect the change set before deployment. Required secret JSON keys and the exact deployment command are documented in `infra/aws/README.md`.

The checked-in worker Dockerfile constructs a production-only pnpm deployment closure and runs as the unprivileged `node` user. Build from the monorepo root:

```powershell
docker build -f apps/worker/Dockerfile -t "$env:WORKER_IMAGE" .
```

One worker service is tenant-scoped through `WORKER_TENANT_ID`. Deploy a separately configured service for each admitted tenant or shard; do not give one worker an unbounded cross-tenant claim scope.

## Public contract parity

`packages/contracts/generated/openapi.json` is generated from runtime Zod schemas and documents every API registration, including health/readiness, operations and controls, collection commands, resource actions, retrieval, immutable reads, A2A, and demo evaluation. It currently contains 73 unique operations, including durable tenant-scoped vector-store detail. Each OpenAPI operation records its concrete Fastify registration in `x-fastify-route`; `apps/api/src/openapi-parity.test.ts` observes the server's actual registrations and compares both sets. Therefore an undocumented server route, a documented-but-unregistered route, or a duplicate operation ID fails CI. Contract tests also resolve every embedded local JSON Schema reference so invalid `$defs` scoping cannot recur.
