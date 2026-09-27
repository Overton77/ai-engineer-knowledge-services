import { createApiHost, type ApiHost, type ApiHostOptions } from "./server/api.js";
import { createMcpHost, type McpHost, type McpHostOptions } from "./server/mcp.js";
import { createWorkerHost, type WorkerHost, type WorkerHostOptions } from "./server/worker.js";

/**
 * Reserved until file-backed local services are extracted (Unit 5). Existing CLI
 * offline commands keep their current route; there is no network or database fallback.
 */
export interface LocalHostOptions {
  readonly profile: "local";
  readonly role?: string;
}

export type HostOptions<TRetrieval = unknown, TDrift = unknown, TVerification = unknown> =
  | ApiHostOptions<TRetrieval, TDrift, TVerification>
  | McpHostOptions
  | WorkerHostOptions
  | LocalHostOptions;

export class HostProfileUnavailableError extends Error {
  readonly code = "HOST_PROFILE_UNAVAILABLE";
  constructor(readonly profile: string) {
    super(`HOST_PROFILE_UNAVAILABLE:${profile}`);
  }
}

/** Composes the services a role actually constructs; the return type follows the role. */
export function createHost<TRetrieval, TDrift, TVerification>(
  options: ApiHostOptions<TRetrieval, TDrift, TVerification>,
): Promise<ApiHost<TRetrieval, TDrift, TVerification>>;
export function createHost(options: McpHostOptions): Promise<McpHost>;
export function createHost(options: WorkerHostOptions): Promise<WorkerHost>;
export function createHost(options: LocalHostOptions): Promise<never>;
export async function createHost(options: HostOptions): Promise<ApiHost<unknown, unknown, unknown> | McpHost | WorkerHost> {
  if (options.profile !== "server") throw new HostProfileUnavailableError(options.profile);
  switch (options.role) {
    case "api":
      return createApiHost(options);
    case "mcp":
      return createMcpHost(options);
    case "worker":
      return createWorkerHost(options);
  }
}
