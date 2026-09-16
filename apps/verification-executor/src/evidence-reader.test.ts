import { createHash, randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VerificationArtifactHandle } from "@aiengineer/knowledge-contracts";
import type { VerificationEvidenceReader } from "./knowledge/evidence-oracle.js";
import { createCanonicalEvidenceReader } from "./evidence-reader.js";

const ports = vi.hoisted(() => ({
  query: vi.fn(), resolve: vi.fn(), inspect: vi.fn(), hydrate: vi.fn(),
  databaseClose: vi.fn(), custodyClose: vi.fn(),
}));
vi.mock("@aiengineer/knowledge-persistence", () => ({
  PostgresCanonicalRepository: class {
    transaction(_tenantId: string, callback: (client: { query: typeof ports.query }) => unknown) {
      return callback({ query: ports.query });
    }
    close = ports.databaseClose;
  },
}));
vi.mock("./store-custody-postgres.js", () => ({
  createExecutorCustody: () => ({ resolve: ports.resolve, close: ports.custodyClose }),
}));
vi.mock("@aiengineer/knowledge-verification", async importOriginal => ({
  ...await importOriginal<object>(), inspectAuditBundle: ports.inspect,
}));
vi.mock("./knowledge/evidence-oracle.js", () => ({ loadSealedContentClaim: ports.hydrate }));

const tenantId = "00000000-0000-4000-8000-000000000001";
const runId = "00000000-0000-4000-8000-000000000002";
const digest = `sha256:${"a".repeat(64)}`;
const request = { tenantId, runId, claimId: randomUUID(), claimKey: "qualified-capability", manifestDigest: digest, policyDigest: digest };
const config = { tenantId, policyVersion: "test.v1", policyDigest: digest, databaseUrl: "unused", projectUrl: "unused", secretKey: "unused" };
type Artifact = { handle: VerificationArtifactHandle; bytes: Uint8Array };

function artifact(value: unknown, mediaType = "application/json"): Artifact {
  const bytes = value instanceof Uint8Array ? value : new TextEncoder().encode(JSON.stringify(value));
  const hex = createHash("sha256").update(bytes).digest("hex");
  return { bytes, handle: {
    artifactId: randomUUID(), tenantId, digest: `sha256:${hex}`, mediaType,
    byteLength: bytes.length, objectKey: `artifacts/${hex}`, createdAt: "2026-09-14T00:00:00.000Z",
    producerActivityId: "test", producerVersion: "v1", encryptionClass: "test",
    retentionClass: "test", dataClassification: "internal", parentArtifactIds: [],
  } };
}

function fixture() {
  const intent = artifact({ schemaVersion: "verification-claims-intent.v1" }, "application/vnd.ks.claims+json; charset=utf-8");
  const decision = artifact({ schemaVersion: "verification-policy-decision.v1" });
  const bundle = artifact({ schemaVersion: "verification-bundle.v1" });
  const result = artifact({ schemaVersion: "verification-result.v1" });
  const inputs = [intent.handle];
  const outputs = [decision.handle, bundle.handle, result.handle];
  const stored = new Map([intent, decision, bundle, result].map(value => [value.handle.artifactId, value]));
  function registerAudit() {
    const audit = artifact({ tenantId, manifest: { runId, inputArtifacts: inputs, outputArtifacts: outputs } });
    stored.set(audit.handle.artifactId, audit);
    const row = { audit_id: audit.handle.artifactId, audit_digest: audit.handle.digest.slice(7), bundle_id: bundle.handle.artifactId, result_id: result.handle.artifactId };
    ports.query.mockResolvedValue({ rows: [row] });
    return { audit, row };
  }
  ports.resolve.mockImplementation(async (id: string) => stored.get(id));
  const registered = registerAudit();
  return { intent, decision, bundle, result, inputs, outputs, stored, registerAudit, ...registered };
}

beforeEach(() => {
  vi.resetAllMocks();
  ports.inspect.mockResolvedValue({ valid: true, signatureStatus: "valid" });
  ports.hydrate.mockImplementation((reader: VerificationEvidenceReader) => reader.runStatus({ runId }));
});

describe("canonical remote evidence reader boundary (mock admission oracle)", () => {
  it("finds vendor JSON intent and canonical outputs without producer scratch state", async () => {
    const saved = fixture();
    const reader = createCanonicalEvidenceReader(config);
    await expect(reader.loadClaim(request)).resolves.toEqual({ state: {
      auditArtifactId: saved.audit.handle.artifactId, intentArtifactId: saved.intent.handle.artifactId,
      bundleArtifactId: saved.bundle.handle.artifactId, resultArtifactId: saved.result.handle.artifactId,
      decisionArtifactId: saved.decision.handle.artifactId, semanticArtifactId: undefined,
    } });
    await reader.close();
    expect(ports.databaseClose).toHaveBeenCalledOnce();
    expect(ports.custodyClose).toHaveBeenCalledOnce();
  });

  it.each([
    { tenantId: randomUUID() }, { policyDigest: `sha256:${"b".repeat(64)}` },
  ])("rejects caller authority changes before database or custody reads: %j", async changed => {
    fixture();
    await expect(createCanonicalEvidenceReader(config).loadClaim({ ...request, ...changed })).rejects.toThrow("EVIDENCE_READER_AUTHORITY_MISMATCH");
    expect(ports.query).not.toHaveBeenCalled();
    expect(ports.resolve).not.toHaveBeenCalled();
  });

  it("requires one canonical claim/run registration before reading retained artifacts", async () => {
    fixture();
    ports.query.mockResolvedValue({ rows: [] });
    await expect(createCanonicalEvidenceReader(config).loadClaim(request)).rejects.toThrow("EVIDENCE_READER_CANONICAL_RUN_MISSING");
    expect(ports.resolve).not.toHaveBeenCalled();
  });

  it.each(["invalid", "unverified"])("refuses %s audit signatures", async signatureStatus => {
    fixture();
    ports.inspect.mockResolvedValue({ valid: true, signatureStatus });
    await expect(createCanonicalEvidenceReader(config).loadClaim(request)).rejects.toThrow("EVIDENCE_READER_AUDIT_INVALID");
  });

  it("refuses an audit that differs from its canonical registration", async () => {
    const saved = fixture();
    ports.query.mockResolvedValue({ rows: [{ ...saved.row, audit_digest: "b".repeat(64) }] });
    await expect(createCanonicalEvidenceReader(config).loadClaim(request)).rejects.toThrow("EVIDENCE_READER_AUDIT_DIGEST_MISMATCH");
  });

  it("rejects a canonical output absent from the sealed manifest", async () => {
    const saved = fixture();
    saved.outputs.pop();
    saved.registerAudit();
    await expect(createCanonicalEvidenceReader(config).loadClaim(request)).rejects.toThrow("EVIDENCE_READER_RUN_ARTIFACT_MISMATCH");
  });

  it("rejects duplicate manifest identities and ambiguous intent schemas", async () => {
    const saved = fixture();
    saved.inputs.push(saved.intent.handle);
    saved.registerAudit();
    const reader = createCanonicalEvidenceReader(config);
    await expect(reader.loadClaim(request)).rejects.toThrow("EVIDENCE_READER_MANIFEST_INVALID");
    const duplicate = artifact({ schemaVersion: "verification-claims-intent.v1" });
    saved.inputs[1] = duplicate.handle;
    saved.stored.set(duplicate.handle.artifactId, duplicate);
    saved.registerAudit();
    await expect(reader.loadClaim(request)).rejects.toThrow("EVIDENCE_READER_CHAIN_AMBIGUOUS");
  });

  it("rejects missing remote bytes and byte tampering", async () => {
    const saved = fixture();
    saved.stored.delete(saved.intent.handle.artifactId);
    const reader = createCanonicalEvidenceReader(config);
    await expect(reader.loadClaim(request)).rejects.toThrow("EVIDENCE_READER_ARTIFACT_MISSING");
    saved.stored.set(saved.intent.handle.artifactId, { ...saved.intent, bytes: new TextEncoder().encode("tampered") });
    await expect(reader.loadClaim(request)).rejects.toThrow("ARTIFACT_BYTES_MISMATCH");
  });

  it("rejects foreign custody handles and substituted artifact identities", async () => {
    const saved = fixture();
    const reader = createCanonicalEvidenceReader(config);
    saved.stored.set(saved.intent.handle.artifactId, { ...saved.intent, handle: { ...saved.intent.handle, tenantId: randomUUID() } });
    await expect(reader.loadClaim(request)).rejects.toThrow("ARTIFACT_TENANT_MISMATCH");
    saved.stored.set(saved.intent.handle.artifactId, { ...saved.intent, handle: { ...saved.intent.handle, artifactId: randomUUID() } });
    await expect(reader.loadClaim(request)).rejects.toThrow("EVIDENCE_READER_ARTIFACT_ID_MISMATCH");
  });

  it("checks complete manifest handle identity, including provenance", async () => {
    const saved = fixture();
    saved.stored.set(saved.intent.handle.artifactId, { ...saved.intent, handle: { ...saved.intent.handle, producerActivityId: "substituted" } });
    await expect(createCanonicalEvidenceReader(config).loadClaim(request)).rejects.toThrow("ARTIFACT_CUSTODY_IDENTITY_MISMATCH");
  });

  it("shares downloads within one hydration but reauthenticates the next request", async () => {
    const saved = fixture();
    ports.hydrate.mockImplementation(async (reader: VerificationEvidenceReader) => {
      await reader.runStatus({ runId });
      await reader.store.bytes(saved.intent.handle);
      await reader.store.resolveHandle({ artifactId: saved.intent.handle.artifactId });
    });
    const reader = createCanonicalEvidenceReader(config);
    await reader.loadClaim(request);
    expect(ports.resolve.mock.calls.filter(([id]) => id === saved.intent.handle.artifactId)).toHaveLength(1);
    await reader.loadClaim(request);
    expect(ports.resolve.mock.calls.filter(([id]) => id === saved.intent.handle.artifactId)).toHaveLength(2);
  });

  it("does not permit the oracle to switch run or substitute a cached handle", async () => {
    const saved = fixture();
    const reader = createCanonicalEvidenceReader(config);
    ports.hydrate.mockImplementation((remote: VerificationEvidenceReader) => remote.runStatus({ runId: randomUUID() }));
    await expect(reader.loadClaim(request)).rejects.toThrow("EVIDENCE_READER_RUN_MISMATCH");
    ports.hydrate.mockImplementation((remote: VerificationEvidenceReader) => remote.store.bytes({ ...saved.intent.handle, producerVersion: "changed" }));
    await expect(reader.loadClaim(request)).rejects.toThrow("ARTIFACT_CUSTODY_IDENTITY_MISMATCH");
  });

  it("bounds artifact count across the entire hydration", async () => {
    fixture();
    const sample = artifact({ value: "bounded" });
    ports.resolve.mockImplementation(async (id: string) => ({ ...sample, handle: { ...sample.handle, artifactId: id } }));
    ports.hydrate.mockImplementation(async (reader: VerificationEvidenceReader) => {
      for (let index = 0; index <= 512; index++) await reader.store.resolveHandle({ artifactId: randomUUID() });
    });
    await expect(createCanonicalEvidenceReader(config).loadClaim(request)).rejects.toThrow("EVIDENCE_READER_ARTIFACT_LIMIT");
    expect(ports.resolve).toHaveBeenCalledTimes(512);
  });

  it("rejects oversized individual artifacts", async () => {
    fixture();
    const large = artifact(new Uint8Array(8 * 1024 * 1024 + 1), "application/octet-stream");
    ports.resolve.mockResolvedValue(large);
    ports.hydrate.mockImplementation((reader: VerificationEvidenceReader) => reader.store.resolveHandle({ artifactId: large.handle.artifactId }));
    await expect(createCanonicalEvidenceReader(config).loadClaim(request)).rejects.toThrow("EVIDENCE_READER_BYTE_LIMIT");
  });
});
