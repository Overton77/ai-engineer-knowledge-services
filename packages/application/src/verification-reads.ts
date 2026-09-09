import {
  UuidSchema,
  VerificationArtifactHandleSchema,
  VerificationRunManifestResourceSchema,
  VerificationRunManifestSchema,
  VerificationRunSummaryResourceSchema,
  VerificationCaseResourceSchema,
  VerificationEvidenceResourceSchema,
  VerificationRunCasesResourceSchema,
  type VerificationArtifactHandle,
  type VerificationRunManifest,
  type VerificationRunManifestResource,
  type VerificationRunSummaryResource,
  type VerificationCaseResource,
  type VerificationEvidenceResource,
  type VerificationRunCasesResource,
} from "@aiengineer/knowledge-contracts";
import type { VerificationAuditBundle } from "@aiengineer/knowledge-verification";
import { z } from "zod";

const ReadRequestSchema = z.strictObject({
  tenantId: UuidSchema,
  runId: UuidSchema,
});

export interface VerificationRunAuditBundlePort {
  /** Returns only a repository-authorized, seal-validated audit bundle. */
  loadAuditBundle(tenantId: string, runId: string): Promise<VerificationAuditBundle>;
}

export interface VerificationCaseReadPort extends VerificationRunAuditBundlePort {
  listVerificationRunCases(input: { tenantId: string; runId: string; pageSize: number; cursor?: string }): Promise<unknown>;
  getVerificationCase(input: { tenantId: string; caseRunId: string }): Promise<unknown | undefined>;
  getVerificationEvidence(input: { tenantId: string; evidenceId: string }): Promise<unknown | undefined>;
}

const CaseListInputSchema = ReadRequestSchema.extend({
  pageSize: z.int().min(1).max(100).default(25),
  cursor: UuidSchema.optional(),
});
const CaseInputSchema = z.strictObject({ tenantId: UuidSchema, caseRunId: UuidSchema });
const EvidenceInputSchema = z.strictObject({ tenantId: UuidSchema, evidenceId: UuidSchema });

/** Compact case reads inherit the sealed parent's authorization and custody. */
export class VerificationCaseReadService {
  constructor(private readonly repository: VerificationCaseReadPort) {}

  async listRunCases(input: unknown): Promise<VerificationRunCasesResource> {
    const parsed = CaseListInputSchema.safeParse(input);
    if (!parsed.success) throw new VerificationRunReadError("INVALID");
    return this.#safe(async () => {
      const manifest = await this.#manifest(parsed.data);
      const { tenantId, runId, pageSize, cursor } = parsed.data;
      const result = VerificationRunCasesResourceSchema.parse(await this.repository.listVerificationRunCases({ tenantId, runId, pageSize, ...(cursor === undefined ? {} : { cursor }) }));
      if (result.tenantId !== parsed.data.tenantId || result.runId !== parsed.data.runId || result.cases.length > parsed.data.pageSize) {
        throw new VerificationRunReadError("INTEGRITY");
      }
      for (const item of result.cases) this.#artifacts(manifest, [item.inputArtifact, item.resultArtifact]);
      return result;
    });
  }

  async getCase(input: unknown): Promise<VerificationCaseResource> {
    const parsed = CaseInputSchema.safeParse(input);
    if (!parsed.success) throw new VerificationRunReadError("INVALID");
    return this.#safe(async () => {
      const row = await this.repository.getVerificationCase(parsed.data);
      if (row === undefined) throw new VerificationRunReadError("NOT_FOUND");
      const result = VerificationCaseResourceSchema.parse(row);
      if (result.tenantId !== parsed.data.tenantId || result.caseRunId !== parsed.data.caseRunId) throw new VerificationRunReadError("INTEGRITY");
      const manifest = await this.#manifest({ tenantId: parsed.data.tenantId, runId: result.runId });
      this.#artifacts(manifest, [result.inputArtifact, result.resultArtifact, ...result.evidence.map((item) => item.artifact)]);
      return result;
    });
  }

  async getEvidence(input: unknown): Promise<VerificationEvidenceResource> {
    const parsed = EvidenceInputSchema.safeParse(input);
    if (!parsed.success) throw new VerificationRunReadError("INVALID");
    return this.#safe(async () => {
      const row = await this.repository.getVerificationEvidence(parsed.data);
      if (row === undefined) throw new VerificationRunReadError("NOT_FOUND");
      const result = VerificationEvidenceResourceSchema.parse(row);
      if (result.tenantId !== parsed.data.tenantId || result.evidenceId !== parsed.data.evidenceId) throw new VerificationRunReadError("INTEGRITY");
      const manifest = await this.#manifest({ tenantId: parsed.data.tenantId, runId: result.runId });
      this.#artifacts(manifest, [result.artifact]);
      return result;
    });
  }

  async #manifest(request: ReadRequest): Promise<VerificationRunManifest> {
    try {
      return parseManifest(await this.repository.loadAuditBundle(request.tenantId, request.runId), request);
    } catch (error) {
      if (error instanceof Error && error.message === "VERIFICATION_RUN_NOT_FOUND") throw new VerificationRunReadError("NOT_FOUND");
      throw error;
    }
  }

  #artifacts(manifest: VerificationRunManifest, references: Array<{ artifactId: string; digest: string; mediaType: string; sizeBytes: number }>): void {
    const retained = [...manifest.inputArtifacts, ...manifest.outputArtifacts];
    for (const reference of references) {
      const matches = retained.filter((item) => item.artifactId === reference.artifactId);
      if (matches.length === 0 || matches.some((item) => item.digest !== reference.digest || item.mediaType !== reference.mediaType || item.byteLength !== reference.sizeBytes)) {
        throw new VerificationRunReadError("INTEGRITY");
      }
    }
  }

  async #safe<T>(read: () => Promise<T>): Promise<T> {
    try { return await read(); }
    catch (error) {
      if (error instanceof VerificationRunReadError) throw error;
      throw new VerificationRunReadError("INTEGRITY");
    }
  }
}

export type VerificationRunReadErrorCode = "INVALID" | "NOT_FOUND" | "INTEGRITY";

/** Deliberately contains no persistence or artifact-resolution detail. */
export class VerificationRunReadError extends Error {
  constructor(readonly code: VerificationRunReadErrorCode) {
    super(`VERIFICATION_RUN_READ_${code}`);
    this.name = "VerificationRunReadError";
  }
}

type ReadRequest = z.infer<typeof ReadRequestSchema>;

function readRequest(input: unknown): ReadRequest {
  const parsed = ReadRequestSchema.safeParse(input);
  if (!parsed.success) throw new VerificationRunReadError("INVALID");
  return parsed.data;
}

function compactArtifact(handle: VerificationArtifactHandle) {
  return {
    artifactId: handle.artifactId,
    digest: handle.digest,
    mediaType: handle.mediaType,
    sizeBytes: handle.byteLength,
  };
}

function parseManifest(bundle: VerificationAuditBundle, request: ReadRequest): VerificationRunManifest {
  try {
    if (bundle.verificationContractVersion !== "verification.v1" || bundle.tenantId !== request.tenantId) {
      throw new Error("REQUEST_BINDING");
    }
    const manifest = VerificationRunManifestSchema.parse(bundle.manifest);
    if (manifest.runId !== request.runId || manifest.verificationContractVersion !== bundle.verificationContractVersion
      || manifest.canonicalization.manifestDigest === undefined) {
      throw new Error("REQUEST_BINDING");
    }
    const artifacts = [...manifest.inputArtifacts, ...manifest.outputArtifacts].map((value) => VerificationArtifactHandleSchema.parse(value));
    if (artifacts.some((artifact) => artifact.tenantId !== request.tenantId)) throw new Error("ARTIFACT_TENANT");
    const policyArtifact = VerificationArtifactHandleSchema.parse(bundle.policyBinding.policyArtifact);
    const policyInputsArtifact = VerificationArtifactHandleSchema.parse(bundle.policyBinding.recordedPolicyInputsArtifact);
    if (policyArtifact.tenantId !== request.tenantId || policyInputsArtifact.tenantId !== request.tenantId
      || bundle.policyBinding.policyVersion !== manifest.versions.policy
      || bundle.deterministicResultDigest !== manifest.resultDigest) {
      throw new Error("SEALED_BINDING");
    }
    return manifest;
  } catch {
    throw new VerificationRunReadError("INTEGRITY");
  }
}

function aggregateCalls(manifest: VerificationRunManifest) {
  let reservedCostMicros = 0;
  let estimatedCostMicros = 0;
  let actualCostMicros = 0;
  let actualCount = 0;
  let estimatedCount = 0;
  let reservedCount = 0;
  let unknownDispatchedCount = 0;
  for (const call of manifest.calls) {
    reservedCostMicros += call.reservationCostMicros;
    estimatedCostMicros += call.estimatedCostMicros ?? 0;
    actualCostMicros += call.actualCostMicros ?? 0;
    if (call.costState === "actual") actualCount += 1;
    if (call.costState === "estimated") estimatedCount += 1;
    if (call.costState === "reserved") reservedCount += 1;
    if (call.costState === "unknown_dispatched") unknownDispatchedCount += 1;
  }
  if (![reservedCostMicros, estimatedCostMicros, actualCostMicros].every(Number.isSafeInteger)) {
    throw new VerificationRunReadError("INTEGRITY");
  }
  return { count: manifest.calls.length, reservedCostMicros, estimatedCostMicros, actualCostMicros, actualCount, estimatedCount, reservedCount, unknownDispatchedCount };
}

function projectSummary(bundle: VerificationAuditBundle, manifest: VerificationRunManifest): VerificationRunSummaryResource {
  const policyArtifact = VerificationArtifactHandleSchema.parse(bundle.policyBinding.policyArtifact);
  const recordedPolicyInputsArtifact = VerificationArtifactHandleSchema.parse(bundle.policyBinding.recordedPolicyInputsArtifact);
  return VerificationRunSummaryResourceSchema.parse({
    verificationContractVersion: bundle.verificationContractVersion,
    tenantId: bundle.tenantId,
    runId: manifest.runId,
    manifestId: manifest.manifestId,
    manifestDigest: manifest.canonicalization.manifestDigest,
    resultDigest: bundle.deterministicResultDigest,
    lifecycle: {
      policyOutcome: manifest.policyOutcome,
      networkPolicy: manifest.networkPolicy,
      startedAt: manifest.startedAt,
      completedAt: manifest.completedAt,
    },
    policyBinding: {
      policyVersion: bundle.policyBinding.policyVersion,
      policyArtifact: compactArtifact(policyArtifact),
      recordedPolicyInputsArtifact: compactArtifact(recordedPolicyInputsArtifact),
    },
    artifacts: { inputCount: manifest.inputArtifacts.length, outputCount: manifest.outputArtifacts.length },
    calls: aggregateCalls(manifest),
  });
}

function findPricingArtifact(manifest: VerificationRunManifest, artifactId: string): VerificationArtifactHandle {
  const matches = [...manifest.inputArtifacts, ...manifest.outputArtifacts]
    .filter((artifact) => artifact.artifactId === artifactId)
    .map((artifact) => VerificationArtifactHandleSchema.parse(artifact));
  if (matches.length !== 1) throw new VerificationRunReadError("INTEGRITY");
  return matches[0]!;
}

function projectManifest(bundle: VerificationAuditBundle, manifest: VerificationRunManifest): VerificationRunManifestResource {
  const summary = projectSummary(bundle, manifest);
  const provider = manifest.provider === undefined ? undefined : {
    endpointIdentity: manifest.provider.endpointIdentity,
    model: manifest.provider.model,
    pricingSnapshotArtifact: compactArtifact(findPricingArtifact(manifest, manifest.provider.pricingSnapshotArtifactId)),
  };
  return VerificationRunManifestResourceSchema.parse({
    ...summary,
    datasetId: manifest.datasetId,
    datasetVersionDigest: manifest.datasetVersionDigest,
    experimentDefinitionDigest: manifest.experimentDefinitionDigest,
    variantId: manifest.variantId,
    versions: manifest.versions,
    code: { gitSha: manifest.code.gitSha, dirty: manifest.code.dirty },
    runtime: { container: manifest.runtime.container, platform: manifest.runtime.platform, deploymentId: manifest.runtime.deploymentId },
    provider,
    inputArtifacts: manifest.inputArtifacts.map((artifact) => compactArtifact(VerificationArtifactHandleSchema.parse(artifact))),
    outputArtifacts: manifest.outputArtifacts.map((artifact) => compactArtifact(VerificationArtifactHandleSchema.parse(artifact))),
    stages: manifest.stages,
    randomSeed: manifest.randomSeed,
    toolPolicy: manifest.toolPolicy,
    gateDigest: manifest.gateDigest,
    replayOfRunId: manifest.replayOfRunId,
    canonicalization: manifest.canonicalization,
  });
}

/** Application boundary for compact reads of repository-authorized sealed runs. */
export class VerificationRunReadService {
  constructor(private readonly auditBundles: VerificationRunAuditBundlePort) {}

  async getRun(input: unknown): Promise<VerificationRunSummaryResource> {
    const request = readRequest(input);
    const bundle = await this.#load(request);
    const manifest = parseManifest(bundle, request);
    try {
      return projectSummary(bundle, manifest);
    } catch (error) {
      if (error instanceof VerificationRunReadError) throw error;
      throw new VerificationRunReadError("INTEGRITY");
    }
  }

  async getRunManifest(input: unknown): Promise<VerificationRunManifestResource> {
    const request = readRequest(input);
    const bundle = await this.#load(request);
    const manifest = parseManifest(bundle, request);
    try {
      return projectManifest(bundle, manifest);
    } catch (error) {
      if (error instanceof VerificationRunReadError) throw error;
      throw new VerificationRunReadError("INTEGRITY");
    }
  }

  async #load(request: ReadRequest): Promise<VerificationAuditBundle> {
    try {
      return await this.auditBundles.loadAuditBundle(request.tenantId, request.runId);
    } catch (error) {
      if (error instanceof Error && error.message === "VERIFICATION_RUN_NOT_FOUND") throw new VerificationRunReadError("NOT_FOUND");
      throw new VerificationRunReadError("INTEGRITY");
    }
  }
}
