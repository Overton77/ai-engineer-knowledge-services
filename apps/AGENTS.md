<!-- BEGIN GENERATED: semantic-map -->
## Code navigation: apps

Executable transports and durable workers.

Full interfaces, dependencies, tests, and architecture: [semantic map](../docs/agents/CODE-MAP.md). Paths in the rows below are repository-relative.

| Module | Responsibility | Enter |
|---|---|---|
| [api](../docs/agents/CODE-MAP.md#api) | Fastify HTTP transport. createApiRuntime composes createVerificationHostRuntime before read runtimes. | apps/api/src/index.ts |
| [cli](../docs/agents/CODE-MAP.md#cli) | Laptop transport: remote commands call KnowledgeClient over HTTP; local demo, attestation, and benchmark diff use application or verification on frozen files. | apps/cli/src/index.ts |
| [mcp](../docs/agents/CODE-MAP.md#mcp) | In-process Streamable HTTP MCP tools. createMcpRuntime composes createVerificationHostRuntime and VerificationOperationApplicationService. | apps/mcp/src/index.ts |
| [verification-executor](../docs/agents/CODE-MAP.md#verification-executor) | Sandbox verification executor that also hosts schema, bounded-read, and ingestion operations on CLI, MCP, and HTTP. | apps/verification-executor/src/index.ts |
| [worker](../docs/agents/CODE-MAP.md#worker) | Durable knowledge-operation execution, activity dispatch, and verification runtime wiring. | apps/worker/src/index.ts |

Descriptions are maintained in `.agent-docs/modules.json` at the repository root. Do not edit this generated block.
<!-- END GENERATED: semantic-map -->
