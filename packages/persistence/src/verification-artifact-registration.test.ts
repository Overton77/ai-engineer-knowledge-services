import { describe, expect, it } from "vitest";
import { InMemoryArtifactStore, type ArtifactStore } from "@aiengineer/knowledge-runtime";
import { createVerificationArtifactHandle, PostgresVerificationRepository } from "./verification.js";

const tenantId = "11111111-1111-4111-8111-111111111111";
const encoder = new TextEncoder();

type Row = Record<string, unknown>;

function fixture(store: ArtifactStore = new InMemoryArtifactStore()) {
  const artifacts = new Map<string, Row>();
  const metadata = new Map<string, Row>();
  const query = async (sql: string, values: readonly unknown[] = []) => {
    if (sql.includes("insert into orchestration.artifact\n")) {
      const [id, tenant_id, artifact_type, sha256, bucket_class, storage_bucket, object_path, media_type, size_bytes, producer_attempt_id, mission_id, created_at] = values;
      if (!artifacts.has(String(id))) artifacts.set(String(id), { id, tenant_id, artifact_type, schema_version: 1, sha256, bucket_class, storage_bucket, object_path, media_type, size_bytes, producer_attempt_id, mission_id, created_at, storage_state: "pending", available_at: null, verification_contract_version: "verification.v1" });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("select verification_contract_version from orchestration.artifact")) {
      const row = artifacts.get(String(values[1]));
      return { rows: row ? [{ verification_contract_version: row.verification_contract_version }] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.includes("insert into orchestration.verification_artifact_metadata")) {
      const [storedTenantId, artifact_id, producer_activity_id, producer_version, content_encoding, encryption_class, retention_class, data_classification, parent_artifact_ids, transformation_signature, attestation_artifact_id, created_at] = values;
      if (!metadata.has(String(artifact_id))) metadata.set(String(artifact_id), { tenant_id: storedTenantId, artifact_id, producer_activity_id, producer_version, content_encoding, encryption_class, retention_class, data_classification, parent_artifact_ids, transformation_signature, attestation_artifact_id, created_at });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("from orchestration.artifact a join orchestration.verification_artifact_metadata")) {
      const artifact = artifacts.get(String(values[1])), meta = metadata.get(String(values[1]));
      return { rows: artifact && meta ? [{ ...artifact, ...meta }] : [], rowCount: artifact && meta ? 1 : 0 };
    }
    if (sql.includes("select storage_state from orchestration.artifact") && sql.includes("for update")) {
      const row = artifacts.get(String(values[1]));
      return { rows: row ? [{ storage_state: row.storage_state }] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.includes("set storage_state='available'")) {
      const row = artifacts.get(String(values[1]));
      if (row) { row.storage_state = "available"; row.available_at = "2026-09-08T00:00:01.000Z"; }
      return { rows: [], rowCount: row ? 1 : 0 };
    }
    if (sql.includes("set storage_state='failed'")) {
      const row = artifacts.get(String(values[1]));
      if (row && row.storage_state === "pending") { row.storage_state = "failed"; row.available_at = null; row.registration_error_class = "object_write_failed"; }
      return { rows: [], rowCount: row ? 1 : 0 };
    }
    if (sql.includes("insert into orchestration.artifact_lineage")) return { rows: [], rowCount: 1 };
    throw new Error(`UNEXPECTED_SQL:${sql.slice(0, 80)}`);
  };
  const database = { transaction: async (_tenant: string, work: (client: { query: typeof query }) => Promise<unknown>) => work({ query }) };
  const repository = new PostgresVerificationRepository(database as never, store, { async authorize() {} });
  return { artifacts, metadata, repository };
}

function input(name: string) {
  const bytes = encoder.encode(`artifact:${name}`);
  const handle = createVerificationArtifactHandle({ tenantId, bytes, mediaType: "text/plain", createdAt: "2026-09-08T00:00:00.000Z", producerActivityId: "artifact-registration-test", producerVersion: "v1", encryptionClass: "managed", retentionClass: "verification-audit", dataClassification: "restricted" });
  return { handle, bytes, artifactType: "verification_policy" as const, bucketClass: "ledger" as const, storageBucket: "proof" };
}

describe("PostgresVerificationRepository artifact registration", () => {
  it("round-trips a registered object through CAS and records matching available relational metadata", async () => {
    const value = fixture();
    const registered = await value.repository.registerArtifact(input("roundtrip"));
    const row = value.artifacts.get(registered.artifactId)!;
    expect(row.storage_state).toBe("available");
    expect(row.sha256).toBe(registered.digest.slice(7));
    expect(row.object_path).toBe(registered.objectKey);
    expect(value.metadata.get(registered.artifactId)).toMatchObject({ tenant_id: tenantId, data_classification: "restricted", parent_artifact_ids: [] });
  });

  it("rejects a collision before a second object-store write", async () => {
    let puts = 0;
    const backing = new InMemoryArtifactStore();
    const store: ArtifactStore = { async put(value) { puts++; return backing.put(value); }, get: (id, digest) => backing.get(id, digest) };
    const value = fixture(store), first = input("collision");
    await value.repository.registerArtifact(first);
    await expect(value.repository.registerArtifact({ ...first, artifactType: "verification_policy_inputs" })).rejects.toThrow("ARTIFACT_REGISTRATION_COLLISION");
    expect(puts).toBe(1);
    expect(value.artifacts.get(first.handle.artifactId)?.storage_state).toBe("available");
  });

  it("marks a relational registration failed when the object-store write fails, leaving no available orphan", async () => {
    const store: ArtifactStore = { async put() { throw new Error("SYNTHETIC_OBJECT_STORE_FAILURE"); }, async get() { return undefined; } };
    const value = fixture(store), artifact = input("write-failure");
    await expect(value.repository.registerArtifact(artifact)).rejects.toThrow("SYNTHETIC_OBJECT_STORE_FAILURE");
    expect(value.artifacts.get(artifact.handle.artifactId)).toMatchObject({ storage_state: "failed", registration_error_class: "object_write_failed", available_at: null });
  });
});
