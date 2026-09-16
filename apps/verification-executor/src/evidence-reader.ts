import { z } from "zod";
import { PostgresCanonicalRepository } from "@aiengineer/knowledge-persistence";
import { inspectAuditBundle, type VerificationAuditBundle } from "@aiengineer/knowledge-verification";
import type { VerificationArtifactHandle } from "@aiengineer/knowledge-contracts";
import { createExecutorCustody, type ExecutorCustodyConfig } from "./store-custody-postgres.js";
import { assertSameArtifact, validateStoredArtifact } from "./store-custody.js";
import { loadSealedContentClaim, type VerificationEvidenceReader } from "./knowledge/evidence-oracle.js";

const MAX_ARTIFACTS = 512;
const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const Digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const Config = z.object({ tenantId: z.uuid(), policyVersion: z.string().min(1), policyDigest: Digest });
const ClaimRequest = z.strictObject({
  tenantId: z.uuid(), claimId: z.uuid(), runId: z.uuid(), claimKey: z.string().min(1),
  manifestDigest: Digest, policyDigest: Digest,
});

export interface CanonicalEvidenceReaderConfig extends ExecutorCustodyConfig {
  readonly policyVersion: string;
  readonly policyDigest: string;
}
export type CanonicalEvidenceClaimRequest = z.infer<typeof ClaimRequest>;
export type CanonicalEvidenceClaim = Awaited<ReturnType<typeof loadSealedContentClaim>>;
export interface CanonicalEvidenceReader {
  loadClaim(input: CanonicalEvidenceClaimRequest): Promise<CanonicalEvidenceClaim>;
  close(): Promise<void>;
}

type Artifact = { handle: VerificationArtifactHandle; bytes: Uint8Array };
type Run = { audit_id: string; audit_digest: string; bundle_id: string; result_id: string };
function deny(code: string): never { throw new Error(code); }

/** Read-only host entry: canonical registration and sealed artifacts replace producer scratch state. */
export function createCanonicalEvidenceReader(config: CanonicalEvidenceReaderConfig): CanonicalEvidenceReader {
  const authority = Config.parse(config);
  const database = new PostgresCanonicalRepository({ connectionString: config.databaseUrl });
  const custody = createExecutorCustody(config);
  return {
    async loadClaim(value) {
      const input = ClaimRequest.parse(value);
      if (input.tenantId !== authority.tenantId || input.policyDigest !== authority.policyDigest) deny("EVIDENCE_READER_AUTHORITY_MISMATCH");
      const run = await database.transaction(authority.tenantId, async client => {
        const result = await client.query<Run>(`select r.run_manifest_artifact_id audit_id,
            r.manifest_sha256 audit_digest,r.bundle_artifact_id bundle_id,r.deterministic_result_artifact_id result_id
          from evidence.claim c join evidence.verification_run r on r.tenant_id=c.tenant_id
          where c.tenant_id=$1 and c.id=$2 and r.id=$3 and r.status='succeeded'
            and c.structured->'verification'->>'runId'=$3::text
            and c.structured->'verification'->>'claimId'=$4
            and c.structured->'verification'->>'manifestDigest'=$5
            and r.policy_artifact_sha256=$6 and r.policy_version=$7`,
        [authority.tenantId, input.claimId, input.runId, input.claimKey, input.manifestDigest, authority.policyDigest.slice(7), authority.policyVersion]);
        if (result.rows.length !== 1) deny("EVIDENCE_READER_CANONICAL_RUN_MISSING");
        return result.rows[0]!;
      });
      const reader = remoteRunReader({ tenantId: authority.tenantId, runId: input.runId, run, resolve: id => custody.resolve(id) });
      return loadSealedContentClaim(reader, { ...input, policyVersion: authority.policyVersion });
    },
    async close() { await Promise.all([database.close(), custody.close()]); },
  };
}

function remoteRunReader(input: {
  tenantId: string; runId: string; run: Run;
  resolve(artifactId: string): Promise<Artifact | undefined>;
}): VerificationEvidenceReader {
  const artifacts = new Map<string, Promise<Artifact>>();
  let totalBytes = 0;
  async function artifact(id: string): Promise<Artifact> {
    let pending = artifacts.get(id);
    if (!pending) {
      if (artifacts.size >= MAX_ARTIFACTS) deny("EVIDENCE_READER_ARTIFACT_LIMIT");
      pending = input.resolve(id).then(value => {
        if (!value) deny("EVIDENCE_READER_ARTIFACT_MISSING");
        const handle = validateStoredArtifact(input.tenantId, value.handle, value.bytes);
        if (handle.artifactId !== id) deny("EVIDENCE_READER_ARTIFACT_ID_MISMATCH");
        if (handle.byteLength > MAX_ARTIFACT_BYTES || totalBytes + handle.byteLength > MAX_TOTAL_BYTES) deny("EVIDENCE_READER_BYTE_LIMIT");
        totalBytes += handle.byteLength;
        return { handle, bytes: value.bytes };
      });
      artifacts.set(id, pending);
    }
    return pending;
  }
  return {
    store: {
      tenantId: input.tenantId,
      async resolveHandle({ artifactId }) { return (await artifact(artifactId)).handle; },
      async bytes(handle) {
        const stored = await artifact(handle.artifactId);
        assertSameArtifact(handle, stored.handle);
        return stored.bytes;
      },
    },
    async runStatus({ runId }) {
      if (runId !== input.runId) deny("EVIDENCE_READER_RUN_MISMATCH");
      const storedAudit = await artifact(input.run.audit_id);
      if (storedAudit.handle.digest !== `sha256:${input.run.audit_digest}`) deny("EVIDENCE_READER_AUDIT_DIGEST_MISMATCH");
      const audit = json(storedAudit.bytes) as VerificationAuditBundle;
      const inspection = await inspectAuditBundle(audit);
      if (!inspection.valid || inspection.signatureStatus === "invalid" || inspection.signatureStatus === "unverified"
        || audit.tenantId !== input.tenantId || audit.manifest.runId !== runId) deny("EVIDENCE_READER_AUDIT_INVALID");
      const inputs = await readManifest(audit.manifest.inputArtifacts, artifact);
      const outputs = await readManifest(audit.manifest.outputArtifacts, artifact);
      if (!outputs.some(value => value.handle.artifactId === input.run.bundle_id)
        || !outputs.some(value => value.handle.artifactId === input.run.result_id)) deny("EVIDENCE_READER_RUN_ARTIFACT_MISMATCH");
      const semanticArtifactId = findSchema(inputs, "verification-semantic-assessments.v1");
      return { state: {
        auditArtifactId: input.run.audit_id, bundleArtifactId: input.run.bundle_id, resultArtifactId: input.run.result_id,
        intentArtifactId: findSchema(inputs, "verification-claims-intent.v1") ?? deny("EVIDENCE_READER_INTENT_MISSING"),
        decisionArtifactId: findSchema(outputs, "verification-policy-decision.v1") ?? deny("EVIDENCE_READER_DECISION_MISSING"),
        ...(semanticArtifactId === undefined ? {} : { semanticArtifactId }),
      } };
    },
  };
}

async function readManifest(handles: readonly VerificationArtifactHandle[], read: (id: string) => Promise<Artifact>): Promise<Artifact[]> {
  if (handles.length > MAX_ARTIFACTS || new Set(handles.map(handle => handle.artifactId)).size !== handles.length) deny("EVIDENCE_READER_MANIFEST_INVALID");
  const result: Artifact[] = [];
  for (const handle of handles) {
    const stored = await read(handle.artifactId);
    assertSameArtifact(handle, stored.handle);
    result.push(stored);
  }
  return result;
}

function json(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}

function findSchema(artifacts: readonly Artifact[], schemaVersion: string): string | undefined {
  const found = artifacts.filter(artifact => {
    const mediaType = artifact.handle.mediaType.split(";")[0]?.trim().toLowerCase();
    if (mediaType !== "application/json" && !/^application\/[a-z0-9.+-]+\+json$/.test(mediaType ?? "")) return false;
    const value = json(artifact.bytes);
    return value !== null && typeof value === "object" && "schemaVersion" in value && value.schemaVersion === schemaVersion;
  });
  if (found.length > 1) deny("EVIDENCE_READER_CHAIN_AMBIGUOUS");
  return found[0]?.handle.artifactId;
}
