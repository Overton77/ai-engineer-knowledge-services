<!-- BEGIN GENERATED: semantic-map -->
## Code navigation: apps

Executable transports and durable workers.

Full interfaces, dependencies, tests, and architecture: [semantic map](../docs/agents/CODE-MAP.md). Paths in the rows below are repository-relative.

| Module | Responsibility | Enter |
|---|---|---|
| [api](../docs/agents/CODE-MAP.md#api) | Fastify HTTP transport, authentication, resource reads, and verification routes. | apps/api/src/index.ts |
| [cli](../docs/agents/CODE-MAP.md#cli) | Machine-readable knowledge operator/developer commands and selected local demos. | apps/cli/src/index.ts |
| [mcp](../docs/agents/CODE-MAP.md#mcp) | Stateless Streamable HTTP MCP tools over knowledge application behavior. | apps/mcp/src/index.ts |
| [verification-executor](../docs/agents/CODE-MAP.md#verification-executor) | Sandbox verification executor that also hosts schema, bounded-read, and ingestion operations on CLI, MCP, and HTTP. | apps/verification-executor/src/index.ts |
| [worker](../docs/agents/CODE-MAP.md#worker) | Durable knowledge-operation execution, activity dispatch, and verification runtime wiring. | apps/worker/src/index.ts |

Descriptions are maintained in `.agent-docs/modules.json` at the repository root. Do not edit this generated block.
<!-- END GENERATED: semantic-map -->
