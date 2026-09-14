import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PostgresCanonicalRepository, PostgresVerificationRepository } from "@aiengineer/knowledge-persistence";
import { digestBytes, SupabaseArtifactStore, type ArtifactStore } from "@aiengineer/knowledge-runtime";
import { disposableDatabaseUrl, disposableStorageConfig } from "../../../packages/persistence/test/disposable.mjs";
import { FilesystemStore } from "./store.js";
import { createExecutorCustody } from "./store-custody-postgres.js";
import { createDurableRecoveryCustody } from "./knowledge/recovery-durable-custody.js";

const databaseUrl = disposableDatabaseUrl();
const storage = disposableStorageConfig();
const projectUrl = storage?.projectUrl;
const secretKey = storage?.secretKey;
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
const input = (text: string) => ({ bytes: new TextEncoder().encode(text), mediaType: "text/plain", producerActivityId: "p2-proof", producerVersion: "v1" });
async function local(tenantId: string) {
  const dir = await mkdtemp(join(tmpdir(), "ks-custody-real-")); directories.push(dir);
  const store = new FilesystemStore(dir, tenantId); await store.init(); return store;
}
const backingStore = () => new SupabaseArtifactStore({ projectUrl: projectUrl!, serviceRoleKey: secretKey!, bucket: "ai-engineer-cloud-bucket", maximumBytes: 1_000_000 });

describe.skipIf(!databaseUrl || !projectUrl || !secretKey)("isolated Postgres and Supabase logical custody", () => {
  it("reuses an original canonical artifact as a recovery parent without rewriting its identity or bytes", async () => {
    const tenantId = randomUUID(), db = new PostgresCanonicalRepository({ connectionString: databaseUrl! });
    const custody = createExecutorCustody({ databaseUrl: databaseUrl!, tenantId, projectUrl: projectUrl!, secretKey: secretKey! });
    try {
      const repository = new PostgresVerificationRepository(db, backingStore(), { async authorize() {} });
      const value = { schemaVersion: "original-authority-fixture.v1", decision: "requires_review" };
      const bytes = new TextEncoder().encode(JSON.stringify(value));
      const original = await repository.registerContentAddressedArtifact({
        tenantId, bytes, mediaType: "application/json", createdAt: new Date().toISOString(),
        producerActivityId: "legacy-authority-proof", producerVersion: "v1", encryptionClass: "filesystem-plain",
        retentionClass: "experiment", dataClassification: "internal", artifactType: "workspace_file",
        bucketClass: "candidate", storageBucket: "ai-engineer-cloud-bucket",
      });
      expect(original.objectKey).toBe(`${tenantId}/${original.digest.slice(7, 9)}/${original.digest.slice(7)}`);
      const consumer = await local(tenantId); consumer.attachCustody(custody);
      expect(await consumer.resolveHandle({ artifactId: original.artifactId })).toEqual(original);
      const recovery = createDurableRecoveryCustody(consumer, custody);
      expect(await recovery.read({ tenantId, artifact: original })).toEqual(value);
      const child = await recovery.register({ tenantId, kind: "notification", value: { original: original.artifactId },
        parentArtifactIds: [original.artifactId], identity: "existing-canonical-parent" });
      await rm(consumer.rootDir, { recursive: true });
      const fresh = await local(tenantId); fresh.attachCustody(custody);
      expect(await createDurableRecoveryCustody(fresh, custody).read({ tenantId, artifact: child })).toEqual({ original: original.artifactId });
      expect((await custody.resolve(original.artifactId))?.handle).toEqual(original);
    } finally { await custody.close(); await db.close(); }
  });

  it("restores parent and producer qualified handles after removing the entire producer store", async () => {
    const tenantId = randomUUID(), db = new PostgresCanonicalRepository({ connectionString: databaseUrl! });
    const custody = createExecutorCustody({ databaseUrl: databaseUrl!, tenantId, projectUrl: projectUrl!, secretKey: secretKey! });
    try {
      const producer = await local(tenantId); producer.attachCustody(custody);
      const parents = [await producer.put(input("parent-a")), await producer.put(input("parent-b"))];
      const a = await producer.put({ ...input("same bytes"), parentArtifactIds: [parents[0]!.artifactId], transformation: { method: "extract" } });
      const b = await producer.put({ ...input("same bytes"), parentArtifactIds: [parents[1]!.artifactId], transformation: { method: "extract" } });
      const c = await producer.put({ ...input("same bytes"), producerActivityId: "different-producer", mediaType: "text/markdown" });
      const typed = new PostgresVerificationRepository(db, backingStore(), { async authorize() {} });
      const d = { ...a, artifactId: randomUUID(), producerActivityId: "notes-producer" };
      await typed.registerLogicalArtifact({ handle: d, bytes: input("same bytes").bytes, artifactType: "research_notes", bucketClass: "candidate", storageBucket: "ai-engineer-cloud-bucket" });
      const rows = await db.transaction(tenantId, (client) => client.query<{ id: string; object_path: string; storage_state: string }>(
        "select id,object_path,storage_state from orchestration.artifact where tenant_id=$1 and sha256=$2", [tenantId, a.digest.slice(7)]));
      expect(rows.rows).toHaveLength(4);
      expect(new Set(rows.rows.map((row) => row.object_path)).size).toBe(1);
      expect(rows.rows.every((row) => row.storage_state === "available")).toBe(true);
      await rm(producer.rootDir, { recursive: true });
      const consumer = await local(tenantId); consumer.attachCustody(custody);
      for (const handle of [...parents, a, b, c, d]) {
        expect(await consumer.resolveHandle({ artifactId: handle.artifactId, digest: handle.digest })).toEqual(handle);
        expect((await consumer.bytes(handle)).byteLength).toBe(handle.byteLength);
      }
      const foreign = createExecutorCustody({ databaseUrl: databaseUrl!, tenantId: randomUUID(), projectUrl: projectUrl!, secretKey: secretKey! });
      try { expect(await foreign.resolve(a.artifactId)).toBeUndefined(); } finally { await foreign.close(); }
      await expect(typed.registerLogicalArtifact({ handle: { ...d, artifactId: randomUUID(), parentArtifactIds: [randomUUID()] },
        bytes: input("same bytes").bytes, artifactType: "research_notes", bucketClass: "candidate", storageBucket: "ai-engineer-cloud-bucket" })).rejects.toThrow("ARTIFACT_PARENT_NOT_AVAILABLE");
    } finally { await custody.close(); await db.close(); }
  });

  it("reuses an existing local capture and preserves its original handle remotely", async () => {
    const tenantId = randomUUID(), store = await local(tenantId);
    const captureInput = { ...input("local capture"), producerActivityId: "verification-executor:capture" };
    const original = await store.put(captureInput);
    const custody = createExecutorCustody({ databaseUrl: databaseUrl!, tenantId, projectUrl: projectUrl!, secretKey: secretKey! });
    try {
      store.attachCustody(custody);
      expect(await store.put(captureInput)).toEqual(original);
      expect((await custody.resolve(original.artifactId))?.handle).toEqual(original);
    } finally { await custody.close(); }
  });

  it("reconciles upload acknowledgement loss against actual Storage bytes", async () => {
    const tenantId = randomUUID(), store = await local(tenantId), db = new PostgresCanonicalRepository({ connectionString: databaseUrl! });
    const remote = backingStore(); let puts = 0;
    const lossy: ArtifactStore = { async put(value) { puts++; await remote.put(value); throw new Error("SYNTHETIC_UPLOAD_ACK_LOSS"); }, get: (tenant, digest) => remote.get(tenant, digest) };
    const repo = new PostgresVerificationRepository(db, lossy, { async authorize() {} });
    try {
      const handle = await store.put(input("ack-loss"));
      const request = { handle, bytes: await store.bytes(handle), artifactType: "workspace_file", bucketClass: "candidate" as const, storageBucket: "ai-engineer-cloud-bucket" };
      expect(await repo.registerLogicalArtifact(request)).toEqual(handle);
      expect((await repo.getLogicalArtifact({ tenantId, artifactId: handle.artifactId }))?.handle).toEqual(handle);
      expect(await repo.registerLogicalArtifact(request)).toEqual(handle);
      expect(puts).toBe(1);
    } finally { await db.close(); }
  });

  it("does not resolve metadata whose upload failed, then recovers under the original identity", async () => {
    const tenantId = randomUUID(), store = await local(tenantId), db = new PostgresCanonicalRepository({ connectionString: databaseUrl! });
    const unavailable: ArtifactStore = { async put() { throw new Error("SYNTHETIC_UPLOAD_FAILURE"); }, async get() { return undefined; } };
    const repo = new PostgresVerificationRepository(db, unavailable, { async authorize() {} });
    try {
      const handle = await store.put(input("missing bytes"));
      const request = { handle, bytes: await store.bytes(handle), artifactType: "workspace_file", bucketClass: "candidate" as const, storageBucket: "ai-engineer-cloud-bucket" };
      await expect(repo.registerLogicalArtifact(request)).rejects.toThrow("SYNTHETIC_UPLOAD_FAILURE");
      await expect(repo.getLogicalArtifact({ tenantId, artifactId: handle.artifactId })).rejects.toThrow();
      const rows = await db.transaction(tenantId, (client) => client.query<{ storage_state: string }>("select storage_state from orchestration.artifact where tenant_id=$1 and id=$2", [tenantId, handle.artifactId]));
      expect(rows.rows[0]?.storage_state).toBe("failed");
      await rm(store.rootDir, { recursive: true });
      const recovered = createExecutorCustody({ databaseUrl: databaseUrl!, tenantId, projectUrl: projectUrl!, secretKey: secretKey! });
      try {
        const fresh = await local(tenantId); fresh.attachCustody(recovered);
        expect(await fresh.put({ ...input("missing bytes"), createdAt: "2026-01-01T00:00:00.000Z" })).toEqual(handle);
        expect((await recovered.resolve(handle.artifactId))?.handle).toEqual(handle);
      } finally { await recovered.close(); }
    } finally { await db.close(); }
  });

  it("reconciles concurrent fresh producers to one original remote timestamp", async () => {
    const tenantId = randomUUID();
    const custody = createExecutorCustody({ databaseUrl: databaseUrl!, tenantId, projectUrl: projectUrl!, secretKey: secretKey! });
    let arrivals = 0; let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const synchronized = { ...custody, async lookup() { arrivals++; if (arrivals === 2) release(); await barrier; return undefined; } };
    try {
      const first = await local(tenantId), second = await local(tenantId);
      first.attachCustody(synchronized); second.attachCustody(synchronized);
      const [a, b] = await Promise.all([
        first.put({ ...input("concurrent"), createdAt: "2026-01-01T00:00:00.000Z" }),
        second.put({ ...input("concurrent"), createdAt: "2026-01-02T00:00:00.000Z" }),
      ]);
      expect(a).toEqual(b);
      expect(await second.put(input("concurrent"))).toEqual(a);
      expect((await custody.resolve(a.artifactId))?.handle).toEqual(a);
    } finally { await custody.close(); }
  });

  it("recovers upload-success/database-failure after discarding the original local store", async () => {
    const tenantId = randomUUID(), store = await local(tenantId), db = new PostgresCanonicalRepository({ connectionString: databaseUrl! });
    let failCommit = true;
    const faultyDb = new Proxy(db, { get(target, property) {
      if (property !== "transaction") return Reflect.get(target, property);
      return async (tenant: string, work: Parameters<PostgresCanonicalRepository["transaction"]>[1]) => target.transaction(tenant, (client) => work({
        async query(sql, values) {
          if (failCommit && sql.includes("set storage_state='available'")) { failCommit = false; throw new Error("SYNTHETIC_DB_FAILURE_AFTER_UPLOAD"); }
          return client.query(sql, values);
        },
      }));
    } });
    const repo = new PostgresVerificationRepository(faultyDb, backingStore(), { async authorize() {} });
    try {
      const handle = await store.put(input("uploaded orphan"));
      await expect(repo.registerLogicalArtifact({ handle, bytes: await store.bytes(handle), artifactType: "workspace_file",
        bucketClass: "candidate", storageBucket: "ai-engineer-cloud-bucket" })).rejects.toThrow("SYNTHETIC_DB_FAILURE_AFTER_UPLOAD");
      expect(await backingStore().get(tenantId, digestBytes(input("uploaded orphan").bytes))).toEqual(input("uploaded orphan").bytes);
      await rm(store.rootDir, { recursive: true });
      const recovered = createExecutorCustody({ databaseUrl: databaseUrl!, tenantId, projectUrl: projectUrl!, secretKey: secretKey! });
      try {
        const fresh = await local(tenantId); fresh.attachCustody(recovered);
        expect(await fresh.put(input("uploaded orphan"))).toEqual(handle);
      } finally { await recovered.close(); }
    } finally { await db.close(); }
  });
});
