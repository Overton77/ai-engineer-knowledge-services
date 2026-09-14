import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadExecutorConfig, VerificationExecutor } from "./executor.js";
import { createKnowledgeFromEnv } from "./serve.js";

describe("local knowledge host composition", () => {
  it("keeps verification-only hosts available without a database", async () => {
    expect(await createKnowledgeFromEnv({})).toBeUndefined();
  });

  it("constructs the authoritative oracle with the same default tenant", async () => {
    const root = await mkdtemp(join(tmpdir(), "ks-host-composition-"));
    const env = {
      KNOWLEDGE_DB_URL: "postgresql://localhost:1/unused",
      SCHEMA_WORKSPACE_DIR: fileURLToPath(new URL("../../../../ai-engineer-db-contract/workspace", import.meta.url)),
      KNOWLEDGE_ARTIFACT_DIR: join(root, "artifacts"),
      VERIFY_STORE_DIR: join(root, "verification"),
    };
    const services = await createKnowledgeFromEnv(env);
    try {
      expect(services?.config.defaultTenantId).toBe(loadExecutorConfig(env).tenantId);
      expect(services?.config.evidenceOracle).toBe("verification-store");
    } finally { await services?.close(); }
    const executor = await VerificationExecutor.create(loadExecutorConfig(env));
    const reused = await createKnowledgeFromEnv(env, executor);
    await reused?.close();
    await expect(createKnowledgeFromEnv({ ...env, KNOWLEDGE_TENANT_ID: "00000000-0000-4000-8000-000000000099" }, executor)).rejects.toThrow("EVIDENCE_NOT_AUTHORIZED");
    await expect(createKnowledgeFromEnv({ ...env, KNOWLEDGE_EVIDENCE_ORACLE: "declared" }, executor)).rejects.toThrow("EVIDENCE_ORACLE_REQUIRED");
  });
});
