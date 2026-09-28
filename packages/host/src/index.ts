// Configuration and identity (absorbed from @aiengineer/knowledge-config).
export * from "./config/index.js";

// Composition root.
export * from "./create-host.js";
export * from "./server/api.js";
export * from "./server/mcp.js";
export * from "./server/worker.js";
export * from "./server/knowledge.js";
export type { HostEnvironment } from "./server/shared.js";
export { HostResources, constructWithResources } from "./lifecycle/resources.js";
export { startPollingLoop, type PollingLoop } from "./lifecycle/polling.js";

// Shared verification host: admission gates and ownership used by API and MCP.
export * from "./verification/host-runtime.js";
export * from "./verification/api/verification-reads-runtime.js";
export * from "./verification/api/verification-benchmark-reads-runtime.js";
export * from "./verification/api/verification-benchmark-comparison-reads-runtime.js";
export * from "./verification/worker/verification-audit-signing-runtime.js";
