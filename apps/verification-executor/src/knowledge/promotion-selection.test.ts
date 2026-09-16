import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { ArtifactLedger } from "@aiengineer/knowledge-db-read";
import type { TenantSqlClient } from "@aiengineer/knowledge-persistence";
import { sha256Digest } from "@aiengineer/knowledge-domain";
import { createPromotionSelectionPorts } from "./promotion-selection.js";

const tenantId = randomUUID(), artifactId = randomUUID(), policyDigest = sha256Digest("pinned policy");
const text = '{ "qualification": "Cafe\u0301 preview only" }';
const artifact = { id: artifactId, digest: sha256Digest(text) };

function fixture() {
  const row = { sha256: artifact.digest.slice(7), storage_bucket: "candidate", size_bytes: Buffer.byteLength(text), storage_state: "available" };
  const query = vi.fn(async () => ({ rows: [row], rowCount: 1 }));
  const client = { query } as unknown as TenantSqlClient;
  const get = vi.fn(async () => new TextEncoder().encode(text));
  const ports = createPromotionSelectionPorts({ tenantId, policyDigest,
    artifacts: {} as ArtifactLedger, evidence: { loadClaim: vi.fn(), close: vi.fn() },
    artifactStores: { candidate: { get, put: vi.fn() } }, measure: vi.fn() });
  return { row, query, client, get, ports, read: () => ports.readArtifact(client, { tenantId, artifact }) };
}

describe("selected promotion host artifact custody", () => {
  it("reads exact retained Unicode JSON bytes from the canonical bucket", async () => {
    const f = fixture();
    expect(new TextDecoder().decode(await f.read())).toBe(text);
    expect(f.get).toHaveBeenCalledWith(tenantId, artifact.digest);
    expect(f.query.mock.calls).toHaveLength(1);
  });

  it("rejects a foreign tenant before reading metadata or bytes", async () => {
    const f = fixture();
    await expect(f.ports.readArtifact(f.client, { tenantId: randomUUID(), artifact })).rejects.toThrow("PROMOTION_SELECTION_HOST_TENANT_MISMATCH");
    expect(f.query).not.toHaveBeenCalled();
    expect(f.get).not.toHaveBeenCalled();
  });

  it.each([
    { storage_state: "pending" }, { sha256: "b".repeat(64) }, { size_bytes: -1 }, { size_bytes: 8 * 1024 * 1024 + 1 },
  ])("rejects unavailable or changed canonical artifact metadata: %j", async change => {
    const f = fixture();
    Object.assign(f.row, change);
    await expect(f.read()).rejects.toThrow("PROMOTION_SELECTION_ARTIFACT_UNAVAILABLE");
    expect(f.get).not.toHaveBeenCalled();
  });

  it("does not fall back to another configured store for an unknown bucket", async () => {
    const f = fixture();
    f.row.storage_bucket = "unconfigured";
    await expect(f.read()).rejects.toThrow("PROMOTION_SELECTION_ARTIFACT_BUCKET_DENIED");
    expect(f.get).not.toHaveBeenCalled();
  });

  it("rejects digest or byte-count changes after remote fetch", async () => {
    const f = fixture();
    f.get.mockResolvedValue(new TextEncoder().encode(text.normalize("NFC")));
    await expect(f.read()).rejects.toThrow("PROMOTION_SELECTION_ARTIFACT_BYTES_MISMATCH");
    f.get.mockResolvedValue(new TextEncoder().encode(text.replace("preview", "release")));
    await expect(f.read()).rejects.toThrow("PROMOTION_SELECTION_ARTIFACT_BYTES_MISMATCH");
  });
});
