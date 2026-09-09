import type { VerificationAuditInspectionApplicationService, VerificationOperationRepositoryPort } from "@aiengineer/knowledge-application";
import {
  InspectAuditBundleRequestSchema,
  VerificationAuditInspectionOperationResultSchema,
  VerificationAuditInspectionResultSchema,
  type JsonValue,
} from "@aiengineer/knowledge-contracts";
import type { OperationsRepository, VerificationRunLease } from "@aiengineer/knowledge-persistence";
import { canonicalizeJson, digestCanonicalJson } from "@aiengineer/knowledge-verification";
import { z } from "zod";
import { CanonicalActivityError, type CanonicalActivityHandler } from "./activity-registry.js";

const inputSchema = z.strictObject({
  schemaVersion: z.literal("verification-service-request.v1"),
  useCase: z.literal("inspectAuditBundle"),
  request: InspectAuditBundleRequestSchema,
});

export interface VerificationAuditInspectionActivityDependencies {
  readonly service: Pick<VerificationAuditInspectionApplicationService, "inspect">;
  readonly repository: VerificationOperationRepositoryPort & {
    registerFencedContentAddressedArtifact(input: {
      readonly artifact: Parameters<VerificationOperationRepositoryPort["registerContentAddressedArtifact"]>[0];
      readonly lease: VerificationRunLease;
    }): Promise<import("@aiengineer/knowledge-contracts").VerificationArtifactHandle>;
  };
  readonly operations: Pick<OperationsRepository, "getOperationRecord">;
  readonly storageBucket: string;
  readonly now: () => string;
  readonly cancellationPollMs?: number;
}

export function verificationAuditInspectionActivityHandler(dependencies: VerificationAuditInspectionActivityDependencies): CanonicalActivityHandler {
  const pollMs = dependencies.cancellationPollMs ?? 250;
  if (!Number.isSafeInteger(pollMs) || pollMs < 25 || pollMs > 5_000) throw new Error("VERIFICATION_AUDIT_INSPECTION_CANCELLATION_POLL_INVALID");
  return {
    operationKind: "verification_audit_bundle",
    stepName: "inspect_audit_bundle_and_register",
    async execute({ activity, claim }) {
      const controller = new AbortController();
      let pollFailure: unknown;
      let polling = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const lease = { stepId: claim.id, leaseToken: claim.leaseToken, fencingToken: claim.fencingToken, holderIdentity: claim.holderIdentity };
      const active = async () => {
        const operation = await dependencies.operations.getOperationRecord(activity.context.tenantId, activity.context.operationId);
        if (!operation || operation.status !== "running") {
          controller.abort();
          throw new CanonicalActivityError("VERIFICATION_AUDIT_INSPECTION_CANCELLED", "VERIFICATION_AUDIT_INSPECTION_CANCELLED", false);
        }
      };
      const poll = () => {
        if (polling || controller.signal.aborted) return;
        polling = true;
        void active().catch((error: unknown) => { pollFailure = error; controller.abort(); }).finally(() => {
          polling = false;
          if (!controller.signal.aborted) timer = setTimeout(poll, pollMs);
        });
      };
      timer = setTimeout(poll, pollMs);
      try {
        const input = inputSchema.parse(activity.operationInput);
        await active();
        const inspected = VerificationAuditInspectionResultSchema.parse(await dependencies.service.inspect(input.request, activity.context, controller.signal));
        await active();
        const requestDigest = digestCanonicalJson(input.request);
        const body = {
          schemaVersion: "verification-operation-result.v1" as const,
          operationId: activity.context.operationId,
          useCase: "inspectAuditBundle" as const,
          requestDigest,
          output: inspected,
        };
        const bytes = new TextEncoder().encode(canonicalizeJson(body));
        const resultArtifact = await dependencies.repository.registerFencedContentAddressedArtifact({
          artifact: {
            tenantId: activity.context.tenantId,
            producerAttemptId: activity.context.attemptId,
            ...(activity.context.missionId ? { missionId: activity.context.missionId } : {}),
            bytes,
            mediaType: "application/vnd.aiengineer.verification-audit-inspection-result+json",
            createdAt: dependencies.now(),
            producerActivityId: "verification-service:inspectAuditBundle",
            producerVersion: "verification-service.v1",
            encryptionClass: "supabase-managed",
            retentionClass: "verification-audit",
            dataClassification: "restricted",
            parentArtifactIds: [input.request.auditBundle.artifactId],
            transformationSignature: digestCanonicalJson({ kind: "verification_audit_inspection_result.v1", operationId: activity.context.operationId, requestDigest, auditArtifact: input.request.auditBundle }),
            artifactType: "verification_audit_inspection_result",
            bucketClass: "ledger",
            storageBucket: dependencies.storageBucket,
          },
          lease,
        });
        await active();
        return VerificationAuditInspectionOperationResultSchema.parse({ ...body, resultArtifact }) as unknown as JsonValue;
      } catch (error) {
        if (pollFailure !== undefined) error = pollFailure;
        if (error instanceof CanonicalActivityError) throw error;
        if (error instanceof z.ZodError) throw new CanonicalActivityError("INVALID_VERIFICATION_AUDIT_INSPECTION_INPUT", "INVALID_VERIFICATION_AUDIT_INSPECTION_INPUT", false, { cause: error });
        const explicitCode = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : error instanceof Error ? error.message : "";
        const code = /^[A-Z][A-Z0-9_]{2,127}$/u.test(explicitCode) ? explicitCode : "VERIFICATION_AUDIT_INSPECTION_INFRASTRUCTURE_FAILURE";
        const retryable = code === "VERIFICATION_AUDIT_INSPECTION_TIMEOUT" || code === "VERIFICATION_AUDIT_INSPECTION_INFRASTRUCTURE_FAILURE" || code.startsWith("OBJECT_STORE_");
        throw new CanonicalActivityError(code, code, retryable, { cause: error });
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        controller.abort();
      }
    },
  };
}
