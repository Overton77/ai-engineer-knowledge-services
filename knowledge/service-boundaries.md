---
type: Service Boundary
title: Knowledge service boundaries
description: Ownership and safe entry points for schema navigation, bounded reads, ingestion, and retrieval.
tags: [knowledge, boundaries, schema, ingestion, retrieval]
owner: ai-engineer-knowledge-services
sources:
  - resource: ../packages/schema-workspace/src/workspace.ts
    title: Workspace loader
  - resource: ../packages/db-read/src/read-executor.ts
    title: Read executor
  - resource: ../packages/ingestion/src/executor.ts
    title: Ingestion executor
---

# Purpose

Use this page when deciding which Knowledge Services surface owns a change or
an operation. It keeps callers from treating a transport, a read snapshot, or
a retrieval result as a second authority for canonical knowledge.

The service owns knowledge preparation, retrieval, evidence, verification, and
policy admission. The shared database schema, migrations, Supabase configuration,
and generated database types remain in the pinned
[`ai-engineer-db-contract`](../packages/schema-workspace/package.json) dependency;
this repository consumes that contract and does not create a rival schema
authority. The accepted lifecycle design is
[`0002-deterministic-preparation.md`](../docs/architecture/0002-deterministic-preparation.md).

# Choose the owner

| Need | Read first | Owner and result |
| --- | --- | --- |
| Change a service use case shared by transports | [`application`](../packages/application/src/index.ts) | Shared use-case composition; keep algorithms out of transport handlers. |
| Change the main service HTTP, CLI, or MCP surface | [HTTP server](../apps/api/src/server.ts), [CLI commands](../apps/cli/src/commands.ts), [MCP catalog](../apps/mcp/src/catalog.ts) | Transport adaptation to published contracts and shared application behavior. |
| Find schema meaning, a relation, vocabulary, rule, or named query | [`schema-workspace`](../packages/schema-workspace/src/index.ts) | Loads and searches the pinned workspace; it does not query tenant data. |
| Read tenant knowledge reproducibly | [`ReadExecutor`](../packages/db-read/src/read-executor.ts) | Executes catalog queries in a read-only transaction and returns a digestible snapshot. |
| Inspect a permitted query plan or bounded ad hoc read | [`sql-guard.ts`](../packages/db-read/src/sql-guard.ts) | Guards one read statement and uses the bounded `pipeline_agent` role. |
| Plan or commit verified knowledge proposals | [`IngestionExecutor`](../packages/ingestion/src/executor.ts) | Produces a deterministic plan or applies through `temporal.*` as `executor_service`. |
| Expose schema/read/ingest functions to an operator or agent | [`knowledge/operations.ts`](../apps/verification-executor/src/knowledge/operations.ts) | Defines one operation catalog for CLI, HTTP, and MCP. |
| Retrieve already prepared, authorized records | [`retrieve`](../packages/retrieval/src/index.ts) | Builds an evidence packet under retrieval policy; it does not write canonical knowledge. |

Cross-repository consumers use the published HTTP/client, CLI, or MCP contract;
they must not import these internal algorithm packages.

# Boundary rules

1. A workspace is a **contract view**, not the database. Its loader reads a
   manifest, search index, optional catalog, terminology, and rules lazily;
   `assertHeadMatches` fails closed when the database migration head differs,
   unless an explicit experiment-only `allowStale` setting is used. See
   [`workspace.ts`](../packages/schema-workspace/src/workspace.ts) and
   [`head.ts`](../packages/schema-workspace/src/head.ts).
2. A named query is the normal read boundary. The catalog fixes query text,
   parameter schema, role ceiling, cost class, and row/timeout limits. Callers
   may ask for a lower role, never a higher one. See
   [`read-intent.ts`](../packages/db-read/src/read-intent.ts).
3. A read snapshot observes one repeatable-read view and records its contract,
   selected knowledge sequence, operation digests, and head. It is evidence for
   a later plan, not proof that a write committed.
4. An ingestion intent is a proposal, never direct SQL. The executor plans it
   against the workspace, supplied snapshot, evidence oracle, vocabulary, and
   current head before it can call canonical temporal helpers.
5. A receipt is the authority for an uncertain ingestion outcome. Repeating
   the exact intent is idempotent; changing its contents under the same
   identity is a conflict. The integration test covers committed-response loss
   and concurrent duplicate submission in
   [`executor.integration.test.ts`](../packages/ingestion/src/executor.integration.test.ts).

# Transport route

```text
schema-workspace ──> db-read ──> ingestion ──> verification-executor
      contract          snapshot       receipt       CLI / HTTP / MCP
```

The executor is a sandbox host distinct from `apps/api`. It creates its
knowledge services only when configuration supplies a database URL; see
[`context.ts`](../apps/verification-executor/src/knowledge/context.ts).
The catalog names operations once, so CLI, POST `/knowledge/<name>`, and MCP
share input schemas and gates. The CLI behaviour is covered by
[`cli.test.ts`](../apps/verification-executor/src/knowledge/cli.test.ts).

# Retrieval is a separate read path

Retrieval filters records by tenant, visibility, space, lifecycle, promotion,
and hard policy filters before ranking lexical, semantic, graph, rerank, and
diversity channels. It records omissions, degraded reranking, coverage, and an
abstention recommendation in an immutable packet. See
[`index.ts`](../packages/retrieval/src/index.ts) and
[`index.test.ts`](../packages/retrieval/src/index.test.ts).

Do not request retrieval through `knowledge-read-intent.v1` today: its
`retrieval` operation is deliberately skipped with `RETRIEVAL_UNAVAILABLE` in
[`ReadExecutor.runQueryOperation`](../packages/db-read/src/read-executor.ts).
That is a present implementation limitation, even though retrieval is an
implemented package and a catalog entry may describe a retrieval-shaped query.

# Examples and counterexamples

| Situation | Correct route | Counterexample |
| --- | --- | --- |
| An agent needs allowed units before proposing a price fact. | Search the workspace, then read the scoped rule/vocabulary page. | Guessing a code from a fact stream. |
| A research task needs the current identity and its fact history. | Create a named-query read intent and retain its snapshot. | Running unrestricted SQL or citing an unpinned live read. |
| A response is lost after `ingest_apply`. | Submit the identical intent again and inspect its receipt. | Minting a new intent ID and risking another batch. |
| A caller wants a semantic answer from prepared records. | Use the published retrieval surface and preserve the evidence packet. | Treating a skipped db-read retrieval operation as empty search results. |

# Known gaps and decisions

- The bounded read executor skips retrieval operations rather than executing
  them. A future bridge must make
  its authorization, evidence-packet, and snapshot semantics explicit.
- The implemented deterministic ingestion intent/plan/apply path does not prove
  every broader ingestion ambition is complete or deployed.
- Ingestion persists canonical effects through temporal helpers and stores
  receipt/ledger records in its executor path. Those records are distinct from
  the service operation lifecycle; do not treat the absence of a
  `knowledge_service.operation` row as absence of an ingestion receipt.

For authentication, capability admission, and parser isolation, read the
owning [security guide](../docs/security.md) before changing a transport's trust
boundary. For normal worker leases and evidence-bound repair, use
[durable execution and recovery](durable-execution-and-recovery.md).
