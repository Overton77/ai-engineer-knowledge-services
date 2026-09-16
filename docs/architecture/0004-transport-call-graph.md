# ADR 0004: Transport call graph

Status: accepted

This specializes [ADR 0001](./0001-runtime-and-deployment.md): API, MCP, CLI, and workers share application packages; MCP does not call a sibling HTTP endpoint; cross-repository calls use the versioned HTTP contract.

Numbering is 0004 because [0003](./0003-embedding-retrieval-evaluation.md) already records embedding, retrieval, and evaluation.

## Decision

**In-process Knowledge Services servers call `packages/application`. Out-of-process callers call the HTTP API through `KnowledgeClient`.**

The API always calls application. CLI and MCP expose similar verbs; they do not share one runtime.

```text
Out of process                          In-process KS servers
----------------                        ---------------------
Laptop CLI remote  --KnowledgeClient--> apps/api ----+
Eve / Mission Control / other repos ---KnowledgeClient-->    |
                                                    apps/mcp ----+--> packages/application
                                                    workers  ----+

Laptop offline (no API)
-----------------------
CLI demo / attestation / benchmark diff --> application / verification (frozen files)
```

| Surface | Where it runs | What it calls | What it must not call |
| --- | --- | --- | --- |
| API | KS server with Postgres | application use cases, then persistence | `KnowledgeClient` (no self-HTTP) |
| MCP | KS server with Postgres | the same application functions the API uses | `KnowledgeClient` / the sibling API, except as a temporary verification shim |
| Workers | KS server | application | HTTP API for their own use cases |
| CLI remote | Operator laptop, no DB | `KnowledgeClient` → HTTP API | application persistence, `POSTGRES_URL` |
| CLI local (`demo`, `attestation-*`, `benchmark diff`) | Laptop, offline | application / verification on frozen files | HTTP, tokens, the remote catalog |
| Eve / Mission Control / other repos | Another process | `KnowledgeClient` → HTTP API | KS internal packages |

`@aiengineer/knowledge-client` is the out-of-process SDK only. It is not MCP’s long-term seam, not the API, and not workers.

`packages/application` is the in-process use-case module. API route handlers and MCP tool handlers are thin adapters over the same functions.

Do not publish a verification-only client package. Split `client.ts` later as file hygiene, not as a second runtime.

## Freeze

- New MCP tools must not add `apiClient` / `KnowledgeClient` methods.
- New remote CLI commands may use `KnowledgeClient`.
- New API and MCP behavior goes through application first; HTTP and MCP both call it.
- The MCP verification HTTP loop (`createApiClient` in `apps/mcp`) is a temporary shim because ownership and some admission still live in API HTTP handlers. Unwind it; do not grow it.

A dated inventory of later refactors is [transport-call-graph-refactor-snapshot-20260916.md](./transport-call-graph-refactor-snapshot-20260916.md). That file is a snapshot and will go stale.
