import type { VerificationArtifactHandle } from "@aiengineer/knowledge-contracts";
import type { VerificationAuditBundle } from "@aiengineer/knowledge-verification";
import { describe, expect, it, vi } from "vitest";
import type { TenantSqlClient } from "./postgres.js";
import { PostgresVerificationCaseWriter, type VerificationCaseAuditPort, type VerificationCaseWriterDatabase } from "./verification-case-writer.js";

const ids = {
  tenant: "11111111-1111-4111-8111-111111111111", otherTenant: "22222222-2222-4222-8222-222222222222",
  run: "33333333-3333-4333-8333-333333333333", case: "44444444-4444-4444-8444-444444444444",
  input: "55555555-5555-4555-8555-555555555555", result: "66666666-6666-4666-8666-666666666666",
  evidenceOne: "77777777-7777-4777-8777-777777777777", evidenceTwo: "88888888-8888-4888-8888-888888888888",
};
const createdAt = "2026-09-05T12:00:00.000Z";
const digest = (character: string) => `sha256:${character.repeat(64)}` as `sha256:${string}`;

function handle(artifactId: string, character: string, bytes = 10): VerificationArtifactHandle {
  return {
    artifactId, tenantId: ids.tenant, digest: digest(character), mediaType: "application/json", byteLength: bytes,
    objectKey: `private/${character}`, createdAt, producerActivityId: "fixture", producerVersion: "v1",
    encryptionClass: "managed", retentionClass: "audit", dataClassification: "restricted", parentArtifactIds: [],
  };
}

const inputHandle = handle(ids.input, "a");
const resultHandle = handle(ids.result, "b");
const evidenceOneHandle = handle(ids.evidenceOne, "c");
const evidenceTwoHandle = handle(ids.evidenceTwo, "d");
const audit = (): VerificationAuditBundle => ({
  verificationContractVersion: "verification.v1",
  tenantId: ids.tenant,
  manifest: { runId: ids.run, inputArtifacts: [inputHandle, evidenceOneHandle, evidenceTwoHandle], outputArtifacts: [resultHandle] },
} as unknown as VerificationAuditBundle);

const input = (overrides: Record<string, unknown> = {}) => ({
  tenantId: ids.tenant, runId: ids.run, caseRunId: ids.case, caseKey: "authored-case-1",
  inputArtifact: { artifactId: inputHandle.artifactId, digest: inputHandle.digest, mediaType: inputHandle.mediaType, sizeBytes: inputHandle.byteLength },
  resultArtifact: { artifactId: resultHandle.artifactId, digest: resultHandle.digest, mediaType: resultHandle.mediaType, sizeBytes: resultHandle.byteLength },
  evidence: [{ evidenceId: ids.evidenceOne, evidenceKey: "source-0", ordinal: 0, artifact: { artifactId: evidenceOneHandle.artifactId, digest: evidenceOneHandle.digest, mediaType: evidenceOneHandle.mediaType, sizeBytes: evidenceOneHandle.byteLength } }],
  createdAt,
  ...overrides,
});

type CaseRow = Record<string, unknown>;
type EvidenceRow = Record<string, unknown>;

function subject(options: { audit?: VerificationAuditBundle; parentVisible?: boolean } = {}) {
  let caseRow: CaseRow | undefined;
  let evidenceRows: EvidenceRow[] = [];
  const query = vi.fn(async (text: string, values: readonly unknown[] = []) => {
    const sql = text.replace(/\s+/g, " ").trim().toLowerCase();
    if (sql.startsWith("select id from evidence.verification_run")) return { rows: options.parentVisible === false ? [] : [{ id: ids.run }] };
    if (sql.includes("from evidence.verification_case_run") && sql.includes("for update")) return { rows: caseRow ? [caseRow] : [] };
    if (sql.startsWith("insert into evidence.verification_case_run")) {
      const [id, tenantId, runId, caseKey, inputArtifactId, inputSha, resultArtifactId, resultSha, rowCreatedAt] = values;
      caseRow = { id, tenant_id: tenantId, verification_run_id: runId, case_key: caseKey, input_artifact_id: inputArtifactId, input_sha256: inputSha, result_artifact_id: resultArtifactId, result_sha256: resultSha, created_at: new Date(String(rowCreatedAt)) };
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("from evidence.verification_case_evidence") && sql.includes("for update")) return { rows: evidenceRows };
    if (sql.startsWith("insert into evidence.verification_case_evidence")) {
      const [id, tenantId, caseRunId, evidenceKey, ordinal, artifactId, artifactSha, rowCreatedAt] = values;
      evidenceRows = [...evidenceRows, { id, tenant_id: tenantId, case_run_id: caseRunId, evidence_key: evidenceKey, ordinal, artifact_id: artifactId, artifact_sha256: artifactSha, created_at: new Date(String(rowCreatedAt)) }];
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`UNEXPECTED_SQL:${text}`);
  });
  const database: VerificationCaseWriterDatabase = { transaction: async (_tenantId, work) => work({ query } as unknown as TenantSqlClient) };
  const audits: VerificationCaseAuditPort = { loadAuditBundle: vi.fn(async () => options.audit ?? audit()) };
  return { writer: new PostgresVerificationCaseWriter(database, audits), query, audits, get caseRow() { return caseRow; }, get evidenceRows() { return evidenceRows; } };
}

describe("PostgresVerificationCaseWriter", () => {
  it("writes a complete authored graph once and returns the ordered evidence IDs on an exact retry", async () => {
    const fixture = subject();
    await expect(fixture.writer.recordCase(input())).resolves.toEqual({ caseRunId: ids.case, evidenceIds: [ids.evidenceOne] });
    await expect(fixture.writer.recordCase(input())).resolves.toEqual({ caseRunId: ids.case, evidenceIds: [ids.evidenceOne] });
    expect(fixture.query.mock.calls.filter(([sql]) => String(sql).includes("insert into evidence.verification_case_run"))).toHaveLength(1);
    expect(fixture.query.mock.calls.filter(([sql]) => String(sql).includes("insert into evidence.verification_case_evidence"))).toHaveLength(1);
    expect(fixture.query.mock.calls.some(([sql]) => String(sql).includes("verification_run") && String(sql).includes("for update"))).toBe(true);
  });

  it.each([
    ["case identity", (value: ReturnType<typeof input>) => ({ ...value, caseKey: "changed-case" }), "VERIFICATION_CASE_IDENTITY_DRIFT"],
    ["case input", (value: ReturnType<typeof input>) => ({ ...value, inputArtifact: { ...value.inputArtifact, digest: digest("e") } }), "VERIFICATION_CASE_INPUT_ARTIFACT_NOT_RETAINED"],
    ["case result", (value: ReturnType<typeof input>) => ({ ...value, resultArtifact: { ...value.resultArtifact, mediaType: "text/plain" } }), "VERIFICATION_CASE_RESULT_ARTIFACT_NOT_RETAINED"],
    ["evidence ID", (value: ReturnType<typeof input>) => ({ ...value, evidence: [{ ...value.evidence[0]!, evidenceId: ids.evidenceTwo, artifact: { artifactId: evidenceTwoHandle.artifactId, digest: evidenceTwoHandle.digest, mediaType: evidenceTwoHandle.mediaType, sizeBytes: evidenceTwoHandle.byteLength } }] }), "VERIFICATION_CASE_EVIDENCE_DRIFT"],
    ["removed evidence", (value: ReturnType<typeof input>) => ({ ...value, evidence: [] }), "VERIFICATION_CASE_EVIDENCE_DRIFT"],
    ["added evidence", (value: ReturnType<typeof input>) => ({ ...value, evidence: [...value.evidence, { evidenceId: ids.evidenceTwo, evidenceKey: "source-1", ordinal: 1, artifact: { artifactId: evidenceTwoHandle.artifactId, digest: evidenceTwoHandle.digest, mediaType: evidenceTwoHandle.mediaType, sizeBytes: evidenceTwoHandle.byteLength } }] }), "VERIFICATION_CASE_EVIDENCE_DRIFT"],
  ])("rejects immutable retry drift in %s", async (_label, mutate, code) => {
    const fixture = subject();
    const original = input();
    await fixture.writer.recordCase(original);
    await expect(fixture.writer.recordCase(mutate(original))).rejects.toThrow(code);
  });

  it("rejects invalid extras before calling the authorized audit port", async () => {
    const fixture = subject();
    await expect(fixture.writer.recordCase({ ...input(), rawEvidence: "forbidden" })).rejects.toThrow();
    expect(fixture.audits.loadAuditBundle).not.toHaveBeenCalled();
  });

  it("requires the audit port to return the requested visible tenant/run binding", async () => {
    const fixture = subject({ audit: { ...audit(), tenantId: ids.otherTenant } as VerificationAuditBundle });
    await expect(fixture.writer.recordCase(input())).rejects.toThrow("VERIFICATION_CASE_AUDIT_BINDING_MISMATCH");
    expect(fixture.query).not.toHaveBeenCalled();
  });

  it("rejects foreign or inconsistent retained handles from a malformed audit port", async () => {
    const foreign = { ...inputHandle, tenantId: ids.otherTenant };
    const foreignFixture = subject({ audit: {
      ...audit(), manifest: { ...audit().manifest, inputArtifacts: [foreign] },
    } as VerificationAuditBundle });
    await expect(foreignFixture.writer.recordCase(input())).rejects.toThrow("VERIFICATION_CASE_AUDIT_ARTIFACT_BINDING_MISMATCH");
    expect(foreignFixture.query).not.toHaveBeenCalled();

    const inconsistent = { ...inputHandle, digest: digest("e") };
    const inconsistentFixture = subject({ audit: {
      ...audit(), manifest: { ...audit().manifest, inputArtifacts: [inputHandle, inconsistent, evidenceOneHandle, evidenceTwoHandle] },
    } as VerificationAuditBundle });
    await expect(inconsistentFixture.writer.recordCase(input())).rejects.toThrow("VERIFICATION_CASE_AUDIT_ARTIFACT_BINDING_MISMATCH");
    expect(inconsistentFixture.query).not.toHaveBeenCalled();
  });

  it("requires every compact artifact to be exact manifest membership", async () => {
    const fixture = subject();
    const invalid = input({ evidence: [{ evidenceId: ids.evidenceOne, evidenceKey: "source-0", ordinal: 0, artifact: { artifactId: evidenceOneHandle.artifactId, digest: evidenceOneHandle.digest, mediaType: evidenceOneHandle.mediaType, sizeBytes: 11 } }] });
    await expect(fixture.writer.recordCase(invalid)).rejects.toThrow("VERIFICATION_CASE_EVIDENCE_ARTIFACT_NOT_RETAINED");
    expect(fixture.query).not.toHaveBeenCalled();
  });

  it("does not append evidence when an existing empty case is retried with a new member", async () => {
    const fixture = subject();
    await fixture.writer.recordCase(input({ evidence: [] }));
    await expect(fixture.writer.recordCase(input())).rejects.toThrow("VERIFICATION_CASE_EVIDENCE_DRIFT");
    expect(fixture.query.mock.calls.filter(([sql]) => String(sql).includes("insert into evidence.verification_case_evidence"))).toHaveLength(0);
  });

  it("fails before insertion when the locked visible parent is unavailable", async () => {
    const fixture = subject({ parentVisible: false });
    await expect(fixture.writer.recordCase(input())).rejects.toThrow("VERIFICATION_CASE_PARENT_NOT_VISIBLE");
    expect(fixture.query.mock.calls.some(([sql]) => String(sql).includes("insert into evidence.verification_case"))).toBe(false);
  });
});
