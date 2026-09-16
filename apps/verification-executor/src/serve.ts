import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { loadExecutorConfig, VerificationExecutor, type ExecutorConfig } from "./executor.js";
import { createHttpServer } from "./http.js";
import type { ScopedExecutorAccess } from "./access.js";
import { createKnowledgeServices, loadKnowledgeConfig, type KnowledgeServices, type KnowledgeServicesOptions } from "./knowledge/context.js";

export interface ServeOptions {
  readonly port: number;
  readonly host: string;
  readonly token?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly scopedAccess?: ScopedExecutorAccess;
  /** Trusted host injection; never resolved from a request or environment value. */
  readonly semanticJudgeAdapterFactory?: ExecutorConfig["semanticJudgeAdapterFactory"];
  readonly reportAssessmentAuthority?: KnowledgeServicesOptions["reportAssessmentAuthority"];
  readonly prepareCapturedSource?: KnowledgeServicesOptions["prepareCapturedSource"];
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
  const executor = await VerificationExecutor.create({ ...loadExecutorConfig(env),
    ...(options.semanticJudgeAdapterFactory ? { semanticJudgeAdapterFactory: options.semanticJudgeAdapterFactory } : {}),
  });
  const knowledgeConfig = loadKnowledgeConfig(env);
  const knowledge = knowledgeConfig ? createKnowledgeServices(knowledgeConfig, { verification: executor,
    ...(options.reportAssessmentAuthority ? { reportAssessmentAuthority: options.reportAssessmentAuthority } : {}),
    ...(options.prepareCapturedSource ? { prepareCapturedSource: options.prepareCapturedSource } : {}),
  }) : undefined;
  let server: Server;
  try {
    server = createHttpServer(executor, { ...(options.token ? { token: options.token } : {}), ...(knowledge ? { knowledge } : {}), ...(options.scopedAccess ? { scopedAccess: options.scopedAccess } : {}) });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port, options.host, () => { server.off("error", reject); resolve(); });
    });
  } catch (error) {
    await knowledge?.close();
    throw error;
  }
  const address = server.address() as AddressInfo;
  const host = options.host.includes(":") ? `[${options.host}]` : options.host;
  const url = `http://${host}:${address.port}`;
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
