# Knowledge Services current architecture

Status: reference. Source-backed snapshot at cleanup slice 5P, integrated in `3528642`; subsequent changes require reinspection. This is neither a deployment attestation nor a replacement for accepted ADRs.

## What exists

Knowledge Services owns preparation, evidence retrieval, evaluation, verification and policy admission. Shared schema/migration authority stays in `ai-engineer-db-contract`; cross-repository callers use HTTP/client, CLI or MCP rather than internal algorithm imports.

| Concern | Current implementation | Entry |
| --- | --- | --- |
| Composition | Server API/MCP/worker roles and a local verification profile with owned lifecycle. | [createHost](../../packages/host/src/create-host.ts) |
| Shared behavior and availability | Application use cases, admission, reads and an operation catalog that distinguishes executable, gated, declared and executor-only capabilities. | [Catalog](../../packages/application/src/operations/catalog.ts) |
| Platform transports | API route modules; typed MCP tool registration; `ks` command bindings. API and MCP invoke application in process. | [API](../../apps/api/src/index.ts), [MCP](../../apps/mcp/src/index.ts), [CLI](../../apps/cli/src/ks-commands.ts) |
| Local verification | File-backed intent pipeline through host, using an executor-owned transitional seam. Remote CLI never falls back to this profile. | [Capability matrix](../../packages/host/src/local/capabilities.ts) |
| Database/schema and custody tools | Schema exploration, bounded reads, deterministic ingestion, source/content and recovery groups remain on executor surfaces pending folds. | [Executor registry](../../apps/verification-executor/src/knowledge/operations.ts) |
| Jev | Dedicated service/CLI, SQLite queue and child workers. | [Jev architecture](modules/jev.md) |
| Conversion | Preparation owns routing; Docling and isolated PDF/HTML parser have distinct process boundaries. | [Capture/conversion concept](../../knowledge/capture-conversion-and-custody.md) |

The merged package folders are `core`, `sources`, `preparation`, `retrieval`, `knowledge-db`, `application`, `host`, `contracts`, `client`, `persistence`, `policy`, `evaluation`, `verification`, `testkit` and `jev`. Historical package names such as `conversion`, `chunking`, `embeddings`, `schema-workspace` and `db-read` now identify submodules, not independent workspace packages. `packages/sources` retains npm name `@aiengineer/knowledge-acquisition`; folder and package name are not interchangeable.

## What 5P changed

The application owns the [operation catalog](../../packages/application/src/operations/catalog.ts). Platform MCP names follow `knowledge_*` and `verify_*`; old dotted and `knowledge_verify_*` names have no compatibility aliases. Transport handlers were structured without claiming the later executor fold had happened. Representative checks are [catalog parity](../../apps/mcp/src/tests/operation-catalog.test.ts), [API/MCP parity](../../apps/mcp/src/tests/api-mcp-parity.test.ts), [API golden errors](../../apps/api/src/tests/golden-errors.test.ts), and [MCP golden errors](../../apps/mcp/src/tests/golden-errors.test.ts).

Q0's Biome formatting, lint ratchet and dependency-cruiser boundary baseline are already configured in [quality tooling](../../tools/quality/README.md). A baseline records tolerated existing debt; it does not certify a clean architecture.

## Accepted target and unfinished work

The [accepted layout](../operations/package-cleanup/FINAL-LAYOUT.md) remains the target. [Unit 5 slices](../operations/package-cleanup/UNIT-5-SLICES.md) separately define executor database/knowledge/verification folds (5D1–5D3), Jev consolidation (5F), and executor retirement (5H). The current `jev` binary and executor package must be preserved until their replacement gates pass.

Eleven root skills plus the executor skill are shipped. Eight canonical skills and DeepAgents parser conformance are [Unit 6 direction](../operations/package-cleanup/UNIT-6-SKILLS-DIRECTION.md), not delivered behavior. The consumer runner belongs to the research-agent repository; [DR1–DR5](../operations/package-cleanup/DEEPAGENTS-READINESS.md) and the [seven-stage fixture](../operations/package-cleanup/REAL-FIXTURE-STAGE-GRAPH.md) separate readiness from provisional experiments and full quality acceptance. Historical Eve integration wording does not override that boundary.

## Evidence limits

This snapshot inspected implementation and test anchors; it did not run live providers, change the database or deploy services. The cleanup [continuation](../operations/package-cleanup/NEXT-PACKAGE-CLEANUP.md) records a missing historical judge-failure receipt and its exact baseline exception. Do not translate successful scoped checks into an unqualified full-suite or production-readiness claim. For an actual incident, use the owning [verification runbook](../verification/OPERATOR-RUNBOOK.md).
