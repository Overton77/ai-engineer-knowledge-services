import { readFile } from "node:fs/promises";
import { UuidSchema } from "@aiengineer/knowledge-contracts";
import { parseVerificationBenchmarkComparisonRuntimeConfig } from "@aiengineer/knowledge-application";
import {
  PostgresCanonicalRepository,
  PostgresVerificationBenchmarkComparisonStore,
  type LeasedStep,
} from "@aiengineer/knowledge-persistence";
import { CanonicalActivityRegistry, createCanonicalActivityExecutor } from "../apps/worker/src/activity-registry.js";
import { CanonicalDurableKnowledgeWorker } from "../apps/worker/src/canonical-worker.js";
import { createConfiguredVerificationBenchmarkComparisonHandler } from "../apps/worker/src/verification-benchmark-comparison-runtime.js";

function local(value: string | undefined, port: string, code: string): string {
  if (!value) throw new Error(code);
  const url = new URL(value);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.port !== port) throw new Error(code);
  return value;
}

const connectionString = local(process.env.POSTGRES_URL, "54322", "COMPARISON_CRASH_CHILD_LOCAL_DB_REQUIRED");
const projectUrl = local(process.env.SUPABASE_URL, "54321", "COMPARISON_CRASH_CHILD_LOCAL_STORAGE_REQUIRED");
if (!process.send || !process.env.SUPABASE_SECRET_KEY) throw new Error("COMPARISON_CRASH_CHILD_IPC_AND_STORAGE_REQUIRED");
const operationId = UuidSchema.parse(process.env.COMPARISON_CRASH_OPERATION_ID);
const configPath = process.env.COMPARISON_CRASH_CONFIG_FILE;
if (!configPath) throw new Error("COMPARISON_CRASH_CHILD_CONFIG_REQUIRED");
const rawConfig = await readFile(configPath, "utf8");
const config = parseVerificationBenchmarkComparisonRuntimeConfig(rawConfig);
const crashPoint = process.env.COMPARISON_CRASH_POINT;
if (!["result_completed", "sealed", "none"].includes(crashPoint ?? "")) throw new Error("COMPARISON_CRASH_CHILD_POINT_INVALID");

const database = new PostgresCanonicalRepository({ connectionString, localOnly: true });
let claim: LeasedStep | undefined;
const send = (value: unknown) => new Promise<void>((resolveSend, reject) => {
  if (!process.send || !process.connected) {
    reject(new Error("COMPARISON_CRASH_CHILD_IPC_CLOSED"));
    return;
  }
  process.send(value, error => error ? reject(error) : resolveSend());
});
const parked = () => new Promise<never>(() => undefined);

// Proof-only interception runs after the production store transaction commits.
// The child then remains alive until the parent terminates the actual OS process.
const originalComplete = PostgresVerificationBenchmarkComparisonStore.prototype.complete;
PostgresVerificationBenchmarkComparisonStore.prototype.complete = async function (...args: Parameters<typeof originalComplete>) {
  const durable = await originalComplete.apply(this, args);
  if (crashPoint === "result_completed") {
    await send({ kind: "result_completed", claim, durable });
    await parked();
  }
  return durable;
};

const originalSeal = PostgresVerificationBenchmarkComparisonStore.prototype.seal;
PostgresVerificationBenchmarkComparisonStore.prototype.seal = async function (...args: Parameters<typeof originalSeal>) {
  const durable = await originalSeal.apply(this, args);
  if (crashPoint === "sealed") {
    await send({ kind: "sealed", claim, durable });
    await parked();
  }
  return durable;
};

try {
  const handler = createConfiguredVerificationBenchmarkComparisonHandler({
    database,
    tenantId: config.tenantId,
    projectUrl,
    serviceRoleKey: process.env.SUPABASE_SECRET_KEY,
    maximumArtifactBytes: 8_000_000,
    environment: {
      ...process.env,
      VERIFICATION_BENCHMARK_COMPARISON_CONFIG_JSON: rawConfig,
    },
  });
  if (!handler) throw new Error("COMPARISON_CRASH_CHILD_HANDLER_REQUIRED");
  const registry = new CanonicalActivityRegistry([handler]);
  const execute = createCanonicalActivityExecutor(database, registry);
  const worker = new CanonicalDurableKnowledgeWorker(
    `comparison-crash-child-${process.pid}`,
    config.tenantId,
    database,
    async leased => {
      claim = leased;
      return execute(leased);
    },
    30_000,
    registry.operationKinds(),
  );
  const result = await worker.runOperationOnce(operationId);
  await send({ kind: "completed", claim, result });
} catch (error) {
  const message = error instanceof Error ? error.message : "";
  await send({
    kind: "error",
    code: /^[A-Z][A-Z0-9_]{2,127}$/u.test(message) ? message : "COMPARISON_CRASH_CHILD_FAILURE",
  }).catch(() => undefined);
  process.exitCode = 1;
} finally {
  await database.close();
  if (process.connected) process.disconnect?.();
}
