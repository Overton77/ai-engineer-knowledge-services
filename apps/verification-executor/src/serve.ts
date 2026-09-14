import type { Server } from "node:http";
import { loadExecutorConfig, VerificationExecutor } from "./executor.js";
import { createHttpServer } from "./http.js";
import { createKnowledgeServices, loadKnowledgeConfig, type KnowledgeServices } from "./knowledge/context.js";

export interface ServeOptions {
  readonly port: number;
  readonly host: string;
  readonly token?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export interface RunningExecutor {
  readonly server: Server;
  readonly executor: VerificationExecutor;
  readonly knowledge: KnowledgeServices | undefined;
  readonly url: string;
  close(): Promise<void>;
}

/** One process, both tool families: verification always; knowledge when a database URL and workspace are configured. */
export async function startExecutorServer(options: ServeOptions): Promise<RunningExecutor> {
  const env = options.env ?? process.env;
  const executor = await VerificationExecutor.create(loadExecutorConfig(env));
  const knowledgeConfig = loadKnowledgeConfig(env);
  const knowledge = knowledgeConfig ? createKnowledgeServices(knowledgeConfig, { verification: executor }) : undefined;
  const server = createHttpServer(executor, { ...(options.token ? { token: options.token } : {}), ...(knowledge ? { knowledge } : {}) });
  await new Promise<void>((resolve) => server.listen(options.port, options.host, resolve));
  const url = `http://${options.host}:${options.port}`;
  return {
    server, executor, knowledge, url,
    close: async () => { await new Promise<void>((resolve) => server.close(() => resolve())); await knowledge?.close(); },
  };
}

export function describeRunning(running: RunningExecutor, auth: "bearer" | "none"): Record<string, unknown> {
  return {
    listening: running.url, mcp: `${running.url}/mcp`, store: running.executor.store.rootDir, tenantId: running.executor.store.tenantId, auth,
    knowledge: running.knowledge ? { workspaceDir: running.knowledge.workspace.dir, workspaceHead: running.knowledge.workspace.migrationHead, defaultTenantId: running.knowledge.config.defaultTenantId, artifactDir: running.knowledge.config.artifactDir, storage: running.knowledge.config.storage ? "supabase" : "local", evidenceOracle: running.knowledge.config.evidenceOracle, allowStale: running.knowledge.config.allowStale } : "disabled (set POSTGRES_URL and SCHEMA_WORKSPACE_DIR)",
  };
}

export async function createKnowledgeFromEnv(env: Readonly<Record<string, string | undefined>> = process.env, verification?: VerificationExecutor): Promise<KnowledgeServices | undefined> {
  const config = loadKnowledgeConfig(env);
  if (!config) return undefined;
  const executor = verification ?? await VerificationExecutor.create(loadExecutorConfig(env));
  return createKnowledgeServices(config, { verification: executor });
}
