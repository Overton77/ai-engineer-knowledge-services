import {
  type OperationContext,
  type RequestAdjudicationRequest,
  type VerificationAdjudicationPacket,
  UuidSchema,
  VerificationAdjudicationOperationResultSchema,
  VerificationAdjudicationPacketSchema,
  VerificationAdjudicationTerminalResourceSchema,
  type VerificationAdjudicationTerminalResource,
} from "@aiengineer/knowledge-contracts";
import { deepFreeze } from "@aiengineer/knowledge-domain";
import type { PreparedVerificationAdjudicationRequest } from "./verification-adjudication.js";

export type VerificationAdjudicationReadState = "pending" | "failed" | "cancelled" | "succeeded";
export interface VerifiedVerificationAdjudicationReadPort {
  loadVerifiedAdjudication(tenantId: string, operationId: string): Promise<{
    readonly state: VerificationAdjudicationReadState;
    readonly result?: unknown;
    readonly packet?: unknown;
    readonly terminalFencingToken?: unknown;
  }>;
}
/** Server-owned replay composition; implementations provide trusted keys/resolvers. */
export interface VerificationAdjudicationPacketReplayPort {
  replayPacket(input: {
    readonly request: RequestAdjudicationRequest;
    readonly context: OperationContext;
    readonly reviewRequirements: VerificationAdjudicationPacket["reviewRequirements"];
    readonly signal: AbortSignal;
  }): Promise<PreparedVerificationAdjudicationRequest>;
}
export type VerificationAdjudicationReadErrorCode = "INVALID" | "NOT_FOUND" | "PENDING" | "FAILED" | "CANCELLED" | "INTEGRITY";
export class VerificationAdjudicationReadError extends Error {
  constructor(readonly code: VerificationAdjudicationReadErrorCode, cause?: unknown) {
    super(`VERIFICATION_ADJUDICATION_READ_${code}`, cause === undefined ? undefined : { cause });
  }
}

const ref = (artifact: { artifactId: string; digest: string }) => ({ artifactId: artifact.artifactId, digest: artifact.digest });

/** Projects a verified native pending subject without disclosing packet bytes or Storage metadata. */
export class VerificationAdjudicationReadService {
  constructor(private readonly repository: VerifiedVerificationAdjudicationReadPort) {}

  async getPendingSubject(input: { tenantId: unknown; operationId: unknown }): Promise<VerificationAdjudicationTerminalResource> {
    const tenant = UuidSchema.safeParse(input.tenantId), operation = UuidSchema.safeParse(input.operationId);
    if (!tenant.success || !operation.success) throw new VerificationAdjudicationReadError("INVALID");
    const snapshot = await this.repository.loadVerifiedAdjudication(tenant.data, operation.data);
    if (snapshot.state !== "succeeded") {
      throw new VerificationAdjudicationReadError(snapshot.state === "pending" ? "PENDING" : snapshot.state === "cancelled" ? "CANCELLED" : "FAILED");
    }
    try {
      const result = VerificationAdjudicationOperationResultSchema.parse(snapshot.result);
      const packet = VerificationAdjudicationPacketSchema.parse(snapshot.packet);
      const fencingToken = Number(snapshot.terminalFencingToken);
      if (!Number.isSafeInteger(fencingToken) || fencingToken < 1
        || result.operationId !== operation.data || result.requestDigest !== packet.requestBinding.requestDigest
        || result.resultArtifact.tenantId !== tenant.data || packet.tenantId !== tenant.data
        || packet.requestBinding.operationId !== operation.data
        || result.output.status !== "pending_human_adjudication" || result.output.humanDecisionRecorded || result.output.admissionChanged
        || result.output.originalPolicyOutcome !== packet.sealedRun.originalPolicyOutcome
        || result.resultArtifact.artifactId !== result.output.packetArtifact.artifactId
        || result.resultArtifact.digest !== result.output.packetArtifact.digest) {
        throw new Error("BINDING");
      }
      const target = { ...packet.requestBinding.target, objectDigest: packet.requestBinding.targetObjectDigest };
      return deepFreeze(VerificationAdjudicationTerminalResourceSchema.parse({
        verificationContractVersion: "verification.v1",
        tenantId: tenant.data,
        operationId: operation.data,
        requestDigest: result.requestDigest,
        packetArtifact: ref(result.resultArtifact),
        output: {
          subjectId: result.output.subjectId,
          status: "pending_human_adjudication",
          target,
          reason: packet.requestBinding.reason,
          reviewRequirements: packet.reviewRequirements,
          originalPolicyOutcome: packet.sealedRun.originalPolicyOutcome,
          source: {
            runKind: packet.sealedRun.runKind,
            runId: packet.sealedRun.runId,
            manifestArtifact: ref(packet.sealedRun.manifestArtifact),
            manifestDigest: packet.auditProof.manifestDigest,
            bundleArtifact: ref(packet.sealedRun.bundleArtifact),
            deterministicResultArtifact: ref(packet.sealedRun.deterministicResultArtifact),
            policyDecisionArtifact: ref(packet.sealedRun.policyDecisionArtifact),
            ...(packet.sealedRun.reportGateArtifact ? { reportGateArtifact: ref(packet.sealedRun.reportGateArtifact) } : {}),
          },
          proof: {
            payloadDigest: packet.auditProof.payloadDigest,
            signatureStatus: packet.auditProof.signatureStatus,
            deterministicReplay: packet.auditProof.deterministicReplay,
            policyReplay: packet.auditProof.policyReplay,
            terminalFencingToken: fencingToken,
          },
          humanDecisionRecorded: false,
          admissionChanged: false,
        },
      }));
    } catch (error) {
      if (error instanceof VerificationAdjudicationReadError) throw error;
      throw new VerificationAdjudicationReadError("INTEGRITY", error);
    }
  }
}
