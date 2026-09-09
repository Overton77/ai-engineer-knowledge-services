import {
  IsoDateTimeSchema,
  UuidSchema,
  VerificationArtifactReferenceSchema,
  type VerificationArtifactHandle,
  type VerificationArtifactReference,
} from "@aiengineer/knowledge-contracts";
import { type VerificationAuditBundle } from "@aiengineer/knowledge-verification";
import type { TenantSqlClient } from "./postgres.js";

type EvidenceInput = {
  readonly evidenceId: string;
  readonly evidenceKey: string;
  readonly ordinal: number;
  readonly artifact: VerificationArtifactReference;
};

type VerificationCaseInput = {
  readonly tenantId: string;
  readonly runId: string;
  readonly caseRunId: string;
  readonly caseKey: string;
  readonly inputArtifact: VerificationArtifactReference;
  readonly resultArtifact: VerificationArtifactReference;
  readonly evidence: readonly EvidenceInput[];
  readonly createdAt: string;
};

const inputError = (field: string): never => { throw new Error(`VERIFICATION_CASE_INPUT_INVALID:${field}`); };
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function strictRecord(value: unknown, fields: readonly string[], label: string): Record<string, unknown> {
  if (!isRecord(value) || Object.keys(value).length !== fields.length || Object.keys(value).some((key) => !fields.includes(key))) inputError(label);
  return value as Record<string, unknown>;
}

function uuid(value: unknown, field: string): string {
  const parsed = UuidSchema.safeParse(value);
  if (!parsed.success) inputError(field);
  return parsed.data as string;
}

function stableKey(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 255 || value.trim().length === 0) inputError(field);
  return value as string;
}

function artifact(value: unknown, field: string): VerificationArtifactReference {
  const parsed = VerificationArtifactReferenceSchema.safeParse(value);
  if (!parsed.success) inputError(field);
  return parsed.data as VerificationArtifactReference;
}

function canonicalCreatedAt(value: unknown): string {
  const parsed = IsoDateTimeSchema.safeParse(value);
  if (!parsed.success || new Date(parsed.data).toISOString() !== parsed.data) inputError("createdAt");
  return parsed.data as string;
}

function parseEvidence(value: unknown, index: number): EvidenceInput {
  const item = strictRecord(value, ["evidenceId", "evidenceKey", "ordinal", "artifact"], `evidence.${index}`);
  const ordinal = item.ordinal;
  if (typeof ordinal !== "number" || !Number.isInteger(ordinal) || ordinal < 0 || ordinal > 255) inputError(`evidence.${index}.ordinal`);
  return {
    evidenceId: uuid(item.evidenceId, `evidence.${index}.evidenceId`),
    evidenceKey: stableKey(item.evidenceKey, `evidence.${index}.evidenceKey`),
    ordinal: ordinal as number,
    artifact: artifact(item.artifact, `evidence.${index}.artifact`),
  };
}

function parseCaseInput(value: unknown): VerificationCaseInput {
  const item = strictRecord(value, ["tenantId", "runId", "caseRunId", "caseKey", "inputArtifact", "resultArtifact", "evidence", "createdAt"], "input");
  if (!Array.isArray(item.evidence) || item.evidence.length > 256) inputError("evidence");
  const evidence = (item.evidence as unknown[]).map(parseEvidence);
  const ids = new Set(evidence.map((entry) => entry.evidenceId));
  const keys = new Set(evidence.map((entry) => entry.evidenceKey));
  const ordinals = new Set(evidence.map((entry) => entry.ordinal));
  if (ids.size !== evidence.length || keys.size !== evidence.length || ordinals.size !== evidence.length) inputError("evidence.unique");
  return {
    tenantId: uuid(item.tenantId, "tenantId"),
    runId: uuid(item.runId, "runId"),
    caseRunId: uuid(item.caseRunId, "caseRunId"),
    caseKey: stableKey(item.caseKey, "caseKey"),
    inputArtifact: artifact(item.inputArtifact, "inputArtifact"),
    resultArtifact: artifact(item.resultArtifact, "resultArtifact"),
    evidence,
    createdAt: canonicalCreatedAt(item.createdAt),
  };
}

export interface VerificationCaseWriterDatabase {
  transaction<T>(tenantId: string, work: (client: TenantSqlClient) => Promise<T>): Promise<T>;
}

export interface VerificationCaseAuditPort {
  loadAuditBundle(tenantId: string, runId: string): Promise<VerificationAuditBundle>;
}

export interface VerificationCaseWriteResult {
  readonly caseRunId: string;
  readonly evidenceIds: readonly string[];
}

type StoredCase = {
  readonly id: string;
  readonly tenant_id: string;
  readonly verification_run_id: string;
  readonly case_key: string;
  readonly input_artifact_id: string;
  readonly input_sha256: string;
  readonly result_artifact_id: string;
  readonly result_sha256: string;
  readonly created_at: Date | string;
};

type StoredEvidence = {
  readonly id: string;
  readonly tenant_id: string;
  readonly case_run_id: string;
  readonly evidence_key: string;
  readonly ordinal: number | string;
  readonly artifact_id: string;
  readonly artifact_sha256: string;
  readonly created_at: Date | string;
};

const hexDigest = (digest: string) => digest.slice("sha256:".length);
const canonicalIso = (value: Date | string) => new Date(value).toISOString();
const compactMatchesHandle = (reference: VerificationArtifactReference, handle: VerificationArtifactHandle) =>
  reference.artifactId === handle.artifactId
  && reference.digest === handle.digest
  && reference.mediaType === handle.mediaType
  && reference.sizeBytes === handle.byteLength;

function validateRetainedArtifacts(tenantId: string, candidates: readonly VerificationArtifactHandle[]): void {
  const byId = new Map<string, string>();
  for (const handle of candidates) {
    if (handle.tenantId !== tenantId) throw new Error("VERIFICATION_CASE_AUDIT_ARTIFACT_BINDING_MISMATCH");
    const binding = JSON.stringify([handle.digest, handle.mediaType, handle.byteLength]);
    const existing = byId.get(handle.artifactId);
    if (existing !== undefined && existing !== binding) throw new Error("VERIFICATION_CASE_AUDIT_ARTIFACT_BINDING_MISMATCH");
    byId.set(handle.artifactId, binding);
  }
}

function requireManifestArtifact(reference: VerificationArtifactReference, candidates: readonly VerificationArtifactHandle[], code: string): void {
  if (!candidates.some((handle) => compactMatchesHandle(reference, handle))) throw new Error(code);
}

function sameCase(stored: StoredCase, input: VerificationCaseInput): boolean {
  return stored.id === input.caseRunId
    && stored.tenant_id === input.tenantId
    && stored.verification_run_id === input.runId
    && stored.case_key === input.caseKey
    && stored.input_artifact_id === input.inputArtifact.artifactId
    && stored.input_sha256 === hexDigest(input.inputArtifact.digest)
    && stored.result_artifact_id === input.resultArtifact.artifactId
    && stored.result_sha256 === hexDigest(input.resultArtifact.digest)
    && canonicalIso(stored.created_at) === input.createdAt;
}

function sameEvidence(stored: StoredEvidence, input: EvidenceInput, tenantId: string, caseRunId: string, createdAt: string): boolean {
  return stored.id === input.evidenceId
    && stored.tenant_id === tenantId
    && stored.case_run_id === caseRunId
    && stored.evidence_key === input.evidenceKey
    && Number(stored.ordinal) === input.ordinal
    && stored.artifact_id === input.artifact.artifactId
    && stored.artifact_sha256 === hexDigest(input.artifact.digest)
    && canonicalIso(stored.created_at) === createdAt;
}

/** Writes only an explicitly authored artifact case graph; it never maps evaluation, locator, finding, or judgment IDs. */
export class PostgresVerificationCaseWriter {
  constructor(
    private readonly database: VerificationCaseWriterDatabase,
    private readonly audits: VerificationCaseAuditPort,
  ) {}

  async recordCase(inputValue: unknown): Promise<VerificationCaseWriteResult> {
    const input = parseCaseInput(inputValue);
    const audit = await this.audits.loadAuditBundle(input.tenantId, input.runId);
    if (audit.verificationContractVersion !== "verification.v1" || audit.tenantId !== input.tenantId || audit.manifest.runId !== input.runId) throw new Error("VERIFICATION_CASE_AUDIT_BINDING_MISMATCH");

    const retainedArtifacts = [...audit.manifest.inputArtifacts, ...audit.manifest.outputArtifacts];
    validateRetainedArtifacts(input.tenantId, retainedArtifacts);
    requireManifestArtifact(input.inputArtifact, audit.manifest.inputArtifacts, "VERIFICATION_CASE_INPUT_ARTIFACT_NOT_RETAINED");
    requireManifestArtifact(input.resultArtifact, audit.manifest.outputArtifacts, "VERIFICATION_CASE_RESULT_ARTIFACT_NOT_RETAINED");
    for (const evidence of input.evidence) requireManifestArtifact(evidence.artifact, retainedArtifacts, "VERIFICATION_CASE_EVIDENCE_ARTIFACT_NOT_RETAINED");

    return this.database.transaction(input.tenantId, async (client) => {
      const parent = (await client.query<{ id: string }>(
        "select id from evidence.verification_run where tenant_id=$1 and id=$2 and contract_version='verification.v1' for update",
        [input.tenantId, input.runId],
      )).rows[0];
      if (!parent) throw new Error("VERIFICATION_CASE_PARENT_NOT_VISIBLE");

      const existing = (await client.query<StoredCase>(`select id,tenant_id,verification_run_id,case_key,input_artifact_id,input_sha256,
        result_artifact_id,result_sha256,created_at from evidence.verification_case_run
        where tenant_id=$1 and (id=$2 or (verification_run_id=$3 and case_key=$4)) for update`,
        [input.tenantId, input.caseRunId, input.runId, input.caseKey])).rows;
      if (existing.length > 1 || (existing[0] && !sameCase(existing[0], input))) throw new Error("VERIFICATION_CASE_IDENTITY_DRIFT");

      const insertingCase = !existing[0];
      if (insertingCase) {
        await client.query(`insert into evidence.verification_case_run
          (id,tenant_id,verification_run_id,case_key,input_artifact_id,input_sha256,result_artifact_id,result_sha256,created_at)
          values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [input.caseRunId,input.tenantId,input.runId,input.caseKey,input.inputArtifact.artifactId,hexDigest(input.inputArtifact.digest),
            input.resultArtifact.artifactId,hexDigest(input.resultArtifact.digest),input.createdAt]);
      }

      const storedEvidence = (await client.query<StoredEvidence>(`select id,tenant_id,case_run_id,evidence_key,ordinal,artifact_id,artifact_sha256,created_at
        from evidence.verification_case_evidence where tenant_id=$1 and case_run_id=$2 order by ordinal for update`,
        [input.tenantId,input.caseRunId])).rows;
      const requestedEvidence = [...input.evidence].sort((left, right) => left.ordinal - right.ordinal);
      if (storedEvidence.length > 0) {
        if (storedEvidence.length !== requestedEvidence.length || storedEvidence.some((stored, index) => !sameEvidence(stored, requestedEvidence[index]!, input.tenantId, input.caseRunId, input.createdAt))) {
          throw new Error("VERIFICATION_CASE_EVIDENCE_DRIFT");
        }
      } else if (!insertingCase && requestedEvidence.length > 0) {
        throw new Error("VERIFICATION_CASE_EVIDENCE_DRIFT");
      } else if (requestedEvidence.length > 0) {
        for (const evidence of requestedEvidence) {
          await client.query(`insert into evidence.verification_case_evidence
            (id,tenant_id,case_run_id,evidence_key,ordinal,artifact_id,artifact_sha256,created_at)
            values($1,$2,$3,$4,$5,$6,$7,$8)`,
            [evidence.evidenceId,input.tenantId,input.caseRunId,evidence.evidenceKey,evidence.ordinal,
              evidence.artifact.artifactId,hexDigest(evidence.artifact.digest),input.createdAt]);
        }
      }

      return { caseRunId: input.caseRunId, evidenceIds: requestedEvidence.map((item) => item.evidenceId) };
    });
  }
}

