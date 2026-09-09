# ADR 0001: Runtime and deployment baseline

Status: accepted

- Use Node.js 24, TypeScript, pnpm workspaces and Turborepo.
- Use Fastify for HTTP transports and Zod for runtime contracts.
- Use the official MCP TypeScript SDK v1 with stateless Streamable HTTP.
- API, MCP, CLI and workers share application/domain packages; MCP does not call a sibling HTTP endpoint.
- Cross-repository calls use the versioned HTTP contract.
- Deploy API and MCP independently on Vercel initially; deploy durable workers and Docling as AWS containers.
- Keep large payloads in private object storage and return immutable handles.

