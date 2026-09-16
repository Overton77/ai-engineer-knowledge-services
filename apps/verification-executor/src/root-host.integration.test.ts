import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { disposableDatabaseUrl, disposableStorageConfig } from "../../../packages/persistence/test/disposable.mjs";
import { createRootExecutorHost } from "./root-host.js";

const databaseUrl = disposableDatabaseUrl(), storage = disposableStorageConfig();

describe.skipIf(!databaseUrl || !storage)("trusted root host canonical custody", () => {
  it("requires independent attempts, captures on HTTP and restores bytes after the local store is destroyed", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ks-root-host-"));
    const tenantId = randomUUID(), missionId = randomUUID(), workItemId = randomUUID();
    const producer = randomUUID(), verifier = randomUUID(), runId = randomUUID();
    const pool = new Pool({ connectionString: databaseUrl });
    const token = randomUUID();
    const env = { KNOWLEDGE_DB_URL: databaseUrl!, VERIFY_TENANT_ID: tenantId,
      KNOWLEDGE_MISSION_ID: missionId, VERIFY_PRODUCER_ATTEMPT_ID: producer, VERIFY_VERIFIER_ATTEMPT_ID: verifier,
      KNOWLEDGE_PRODUCER_ATTEMPT_ID: producer, VERIFY_PRODUCER_DEPLOYMENT_ID: "root-producer", VERIFY_VERIFIER_DEPLOYMENT_ID: "root-verifier",
      VERIFY_STORE_DIR: join(directory, "eve-agent"), KNOWLEDGE_ARTIFACT_DIR: join(directory, "ledger"),
      KNOWLEDGE_CONTENT_LINKS_ENABLED: "1",
      SCHEMA_WORKSPACE_DIR: resolve(import.meta.dirname, "../../../../ai-engineer-db-contract/workspace"),
      KNOWLEDGE_ARTIFACT_STORAGE: "supabase", SUPABASE_URL: storage!.projectUrl, SUPABASE_SECRET_KEY: storage!.secretKey,
      VERIFY_GIT_SHA: "offline-root-host-proof" };
    let host: Awaited<ReturnType<typeof createRootExecutorHost>> | undefined;
    try {
      const options = { host: "127.0.0.1", port: 0, token, env,
        semanticJudgeAdapterFactory: () => { throw new Error("UNEXPECTED_PAID_DISPATCH"); } };
      await expect(createRootExecutorHost(options)).rejects.toThrow("ROOT_HOST_INDEPENDENT_ATTEMPTS_REQUIRED");
      await pool.query("insert into orchestration.mission(id,tenant_id,goal) values($1,$2,'root-host custody proof')", [missionId, tenantId]);
      await pool.query("insert into orchestration.work_item(id,tenant_id,mission_id,kind) values($1,$2,$3,'build_vectors')", [workItemId, tenantId, missionId]);
      await pool.query(`insert into orchestration.attempt(id,tenant_id,work_item_id,attempt_no,agent_deployment_id)
        values($1,$2,$3,1,'root-producer'),($4,$2,$3,2,'root-verifier')`, [producer, tenantId, workItemId, verifier]);
      host = await createRootExecutorHost(options);
      const source = "Root host custody proof retains exact source bytes.";
      const captured = await fetch(`${host.url}/captures`, { method: "POST", headers: { authorization: `Bearer ${token}`,
        "content-type": "text/plain", "x-filename": "proof.txt", "x-run-id": runId }, body: source });
      expect(captured.status).toBe(201);
      const output = await captured.json() as { captureId: string; contentArtifact: { artifactId: string; digest: string; byteLength: number } };
      expect((await host.readRun(runId)).steps[0]?.status).toBe("succeeded");
      const prepare = () => fetch(`${host!.url}/knowledge/source_prepare_captured`, { method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ captureId: output.captureId, title: "Root host custody proof", version: "1" }) }).then(async response =>
        ({ status: response.status, body: await response.json() as Record<string, any> }));
      const prepared = await prepare();
      expect(prepared.status, JSON.stringify(prepared.body)).toBe(200);
      expect(prepared.body.transformation?.status, JSON.stringify(prepared.body)).toBe("succeeded");
      expect(prepared.body.chunks?.status, JSON.stringify(prepared.body)).toBe("succeeded");
      expect(prepared.body).toMatchObject({ requiresIndependentReview: true, publishable: false });
      expect((await prepare()).body).toEqual(prepared.body);
      const { destroyProducerWorkspace, restoreBoundArtifacts } = await import(pathToFileURL(resolve(import.meta.dirname,
        "../../../../research_ingestion_systems_agent/tools/team/t14-restore.mjs")).href);
      await destroyProducerWorkspace(directory);
      const restored = await host.restoreArtifact(output.contentArtifact.artifactId);
      expect(restored).toMatchObject({ ...output.contentArtifact, verifiedDigest: output.contentArtifact.digest });
      const registered = await restoreBoundArtifacts([output.contentArtifact],
        (binding: { artifactId: string; digest: string }) => host!.restoreKnowledgeArtifact(binding));
      expect(registered[0]).toMatchObject({ artifactId: output.contentArtifact.artifactId,
        verifiedDigest: output.contentArtifact.digest, byteLength: output.contentArtifact.byteLength });
      await expect(host.restoreKnowledgeArtifact({ ...output.contentArtifact, digest: `sha256:${"0".repeat(64)}` }))
        .rejects.toThrow("ROOT_HOST_REMOTE_ARTIFACT_DRIFT");
      await expect(host.restoreArtifact(randomUUID())).rejects.toThrow("ROOT_HOST_REMOTE_ARTIFACT_MISSING");
    } finally { await host?.close(); await pool.end(); }
  }, 120000);
});
