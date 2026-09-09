import type {
  VerificationAdjudicationPendingSubjectCommitPort,
  VerificationAdjudicationRequestApplicationService,
} from "@aiengineer/knowledge-application";
import {
  RequestAdjudicationRequestSchema,
  VerificationAdjudicationOperationResultSchema,
  VerificationArtifactHandleSchema,
  type JsonValue,
} from "@aiengineer/knowledge-contracts";
import type { OperationsRepository } from "@aiengineer/knowledge-persistence";
import { canonicalizeJson, digestCanonicalJson, sha256Digest } from "@aiengineer/knowledge-verification";
import { z } from "zod";
import { CanonicalActivityError, type CanonicalActivityHandler } from "./activity-registry.js";

const inputSchema = z.strictObject({
  schemaVersion: z.literal("verification-service-request.v1"),
  useCase: z.literal("requestAdjudication"),
  request: RequestAdjudicationRequestSchema,
});

export interface VerificationAdjudicationActivityDependencies {
  readonly service: Pick<VerificationAdjudicationRequestApplicationService, "prepare">;
  readonly subjects: VerificationAdjudicationPendingSubjectCommitPort;
  readonly operations: Pick<OperationsRepository, "getOperationRecord">;
  readonly storageBucket: string;
  readonly now: () => string;
  readonly cancellationPollMs?: number;
}

export function verificationAdjudicationRequestActivityHandler(
  dependencies: VerificationAdjudicationActivityDependencies,
): CanonicalActivityHandler {
  const pollMs = dependencies.cancellationPollMs ?? 250;
  if (!Number.isSafeInteger(pollMs) || pollMs < 25 || pollMs > 5_000) {
    throw new Error("VERIFICATION_ADJUDICATION_CANCELLATION_POLL_INVALID");
  }
  return {
    operationKind: "verification_adjudication",
    stepName: "request_adjudication_and_register",
    async execute({ activity, claim }) {
      const controller = new AbortController();
      let pollFailure: unknown;
      let polling = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const active = async () => {
        const operation = await dependencies.operations.getOperationRecord(activity.context.tenantId, activity.context.operationId);
        if (!operation || operation.status !== "running") {
          controller.abort();
          throw new CanonicalActivityError("VERIFICATION_ADJUDICATION_CANCELLED", "VERIFICATION_ADJUDICATION_CANCELLED", false);
        }
      };
      const poll = () => {
        if (polling || controller.signal.aborted) return;
        polling = true;
        void active().catch((error: unknown) => {
          pollFailure = error;
          controller.abort();
        }).finally(() => {
          polling = false;
          if (!controller.signal.aborted) timer = setTimeout(poll, pollMs);
        });
      };
      timer = setTimeout(poll, pollMs);
      try {
        const input = inputSchema.parse(activity.operationInput);
        await active();
        const prepared = await dependencies.service.prepare(input.request, activity.context, controller.signal);
        await active();

        const canonicalBytes = new TextEncoder().encode(canonicalizeJson(prepared.packet));
        const canonicalDigest = sha256Digest(canonicalBytes);
        if (prepared.requestDigest !== digestCanonicalJson(input.request)
          || prepared.packet.requestBinding.operationId !== activity.context.operationId
          || prepared.packet.tenantId !== activity.context.tenantId
          || canonicalDigest !== prepared.packetDigest
          || sha256Digest(prepared.packetBytes) !== canonicalDigest
          || !equalBytes(prepared.packetBytes, canonicalBytes)) {
          throw new CanonicalActivityError("VERIFICATION_ADJUDICATION_PACKET_BINDING_MISMATCH", "VERIFICATION_ADJUDICATION_PACKET_BINDING_MISMATCH", false);
        }
        const parentArtifactIds = prepared.parentArtifacts.map((artifact) => artifact.artifactId);
        const transformationSignature = digestCanonicalJson({
          kind: "verification_adjudication_packet.v1",
          operationId: activity.context.operationId,
          subjectId: prepared.subjectId,
          requestDigest: prepared.requestDigest,
          parentArtifactIds,
        });
        const committed = await dependencies.subjects.commitPendingSubject({
          prepared: { ...prepared, packetBytes: Uint8Array.from(canonicalBytes) },
          lease: {
            operationId: claim.operationId,
            stepId: claim.id,
            inputSha256: claim.inputSha256,
            leaseToken: claim.leaseToken,
            fencingToken: claim.fencingToken,
            holderIdentity: claim.holderIdentity,
          },
          registration: {
            createdAt: dependencies.now(),
            producerAttemptId: activity.context.attemptId,
            ...(activity.context.missionId ? { missionId: activity.context.missionId } : {}),
            producerActivityId: "verification-service:requestAdjudication",
            producerVersion: "verification-service.v1",
            encryptionClass: "supabase-managed",
            retentionClass: "verification-audit",
            storageBucket: dependencies.storageBucket,
          },
        });
        await active();
        const packetArtifactResult = VerificationArtifactHandleSchema.safeParse(committed.packetArtifact);
        if (!packetArtifactResult.success) {
          throw new CanonicalActivityError("VERIFICATION_ADJUDICATION_COMMIT_BINDING_MISMATCH", "VERIFICATION_ADJUDICATION_COMMIT_BINDING_MISMATCH", false);
        }
        const packetArtifact = packetArtifactResult.data;
        if (committed.subjectId !== prepared.subjectId
          || packetArtifact.tenantId !== activity.context.tenantId
          || packetArtifact.digest !== canonicalDigest
          || packetArtifact.byteLength !== canonicalBytes.byteLength
          || packetArtifact.mediaType !== "application/vnd.aiengineer.verification-adjudication-packet+json"
          || packetArtifact.producerActivityId !== "verification-service:requestAdjudication"
          || packetArtifact.producerVersion !== "verification-service.v1"
          || packetArtifact.dataClassification !== "restricted"
          || packetArtifact.transformationSignature !== transformationSignature
          || canonicalizeJson(packetArtifact.parentArtifactIds) !== canonicalizeJson(parentArtifactIds)) {
          throw new CanonicalActivityError("VERIFICATION_ADJUDICATION_COMMIT_BINDING_MISMATCH", "VERIFICATION_ADJUDICATION_COMMIT_BINDING_MISMATCH", false);
        }
        const result = VerificationAdjudicationOperationResultSchema.parse({
          schemaVersion: "verification-operation-result.v1",
          operationId: activity.context.operationId,
          useCase: "requestAdjudication",
          requestDigest: prepared.requestDigest,
          output: {
            subjectId: prepared.subjectId,
            status: "pending_human_adjudication",
            packetArtifact: { artifactId: packetArtifact.artifactId, digest: packetArtifact.digest },
            originalPolicyOutcome: prepared.packet.sealedRun.originalPolicyOutcome,
            humanDecisionRecorded: false,
            admissionChanged: false,
          },
          resultArtifact: packetArtifact,
        });
        return result as unknown as JsonValue;
      } catch (error) {
        if (pollFailure !== undefined) error = pollFailure;
        if (error instanceof CanonicalActivityError) throw error;
        if (error instanceof z.ZodError) {
          throw new CanonicalActivityError("INVALID_VERIFICATION_ADJUDICATION_INPUT", "INVALID_VERIFICATION_ADJUDICATION_INPUT", false, { cause: error });
        }
        const explicitCode = error instanceof Error && "code" in error && typeof error.code === "string"
          ? error.code
          : error instanceof Error ? error.message : "";
        const code = /^[A-Z][A-Z0-9_]{2,127}$/u.test(explicitCode)
          ? explicitCode
          : "VERIFICATION_ADJUDICATION_INFRASTRUCTURE_FAILURE";
        const retryable = code === "VERIFICATION_ADJUDICATION_INFRASTRUCTURE_FAILURE" || code.startsWith("OBJECT_STORE_");
        throw new CanonicalActivityError(code, code, retryable, { cause: error });
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        controller.abort();
      }
    },
  };
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}
