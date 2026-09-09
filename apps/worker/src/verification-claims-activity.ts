import type { VerificationClaimsApplicationService, VerificationOperationRepositoryPort } from "@aiengineer/knowledge-application";
import { RequestAdjudicationRequestSchema, VerificationClaimsOperationResultSchema, VerificationReportOperationResultSchema, VerifyClaimsRequestSchema, VerifyReportRequestSchema, type JsonValue } from "@aiengineer/knowledge-contracts";
import type { OperationsRepository, VerificationRunLease } from "@aiengineer/knowledge-persistence";
import { canonicalizeJson, digestCanonicalJson } from "@aiengineer/knowledge-verification";
import { z } from "zod";
import { CanonicalActivityError, type CanonicalActivityHandler } from "./activity-registry.js";

const claimsInput = z.strictObject({ schemaVersion: z.literal("verification-service-request.v1"), useCase: z.literal("verifyClaims"), request: VerifyClaimsRequestSchema });
const reportInput = z.strictObject({ schemaVersion: z.literal("verification-service-request.v1"), useCase: z.literal("verifyReport"), request: VerifyReportRequestSchema });
const adjudicationInput = z.strictObject({ schemaVersion: z.literal("verification-service-request.v1"), useCase: z.literal("requestAdjudication"), request: RequestAdjudicationRequestSchema });

/** Registers deterministic outputs under the existing fenced operation lifecycle. Sealing and
 * human-review persistence are injected only after their native guards are installed. */
export function verificationClaimsActivityHandler(dependencies: {
  readonly service: VerificationClaimsApplicationService;
  readonly repository: VerificationOperationRepositoryPort & { registerFencedContentAddressedArtifact(input: { readonly artifact: Parameters<VerificationOperationRepositoryPort["registerContentAddressedArtifact"]>[0]; readonly lease: VerificationRunLease }): Promise<import("@aiengineer/knowledge-contracts").VerificationArtifactHandle> };
  readonly operations: Pick<OperationsRepository, "getOperationRecord">;
  readonly storageBucket: string;
  readonly now: () => string;
  /** Native guarded sealer; handlers are never registered without it. */
  readonly sealer: { seal(input: { readonly verified: unknown; readonly context: import("@aiengineer/knowledge-contracts").OperationContext; readonly claim: VerificationRunLease; readonly runtimeLease?: import("@aiengineer/knowledge-persistence").LeasedStep; readonly startedAt: string }): Promise<{ readonly runId: string; readonly manifestDigest: `sha256:${string}`; readonly policyOutcome: "pass" | "pass_with_warnings" | "review" | "fail" | "abstain"; readonly manifestArtifact: import("@aiengineer/knowledge-contracts").VerificationArtifactHandle }> };
}, operationKind: "verification_claims" | "verification_report"): CanonicalActivityHandler {
  const inputSchema = operationKind === "verification_claims" ? claimsInput : reportInput;
  const useCase = operationKind === "verification_claims" ? "verifyClaims" : "verifyReport";
  const stepName = operationKind === "verification_claims" ? "verify_claims_and_register" : "verify_report_and_register";
  return { operationKind, stepName, async execute({ activity, claim }) {
    const active = async () => {
      const operation = await dependencies.operations.getOperationRecord(activity.context.tenantId, activity.context.operationId);
      if (!operation || operation.status !== "running") throw new CanonicalActivityError("VERIFICATION_OPERATION_NOT_ACTIVE", "VERIFICATION_OPERATION_NOT_ACTIVE", false);
    };
    try {
      const input = inputSchema.parse(activity.operationInput);
      await active();
      const startedAt = dependencies.now();
      const verified = operationKind === "verification_claims"
        ? await dependencies.service.verifyClaims(input.request, activity.context)
        : await dependencies.service.verifyReport(input.request, activity.context);
      await active();
      // An unqualified verifier cannot record a verification run, even a failed
      // one. Stop before artifact writes and the database independence guard.
      if (verified.deterministicResult.deploymentSeparation.status !== "established") {
        throw new CanonicalActivityError("PRODUCER_VERIFIER_INDEPENDENT", "PRODUCER_VERIFIER_INDEPENDENT", false);
      }
      const sealedRun = await dependencies.sealer.seal({ verified, context: activity.context, claim:{stepId:claim.id,leaseToken:claim.leaseToken,fencingToken:claim.fencingToken,holderIdentity:claim.holderIdentity}, runtimeLease:claim, startedAt });
      await active();
      const parents = [...new Set([...(operationKind === "verification_claims"
        ? [verified.assertionsArtifact.artifactId]
        : [verified.assertionsArtifact.artifactId, (verified as Awaited<ReturnType<VerificationClaimsApplicationService["verifyReport"]>>).reportArtifact.artifactId, (verified as Awaited<ReturnType<VerificationClaimsApplicationService["verifyReport"]>>).claimLedgerArtifact.artifactId]), sealedRun.manifestArtifact.artifactId])];
      const body = { schemaVersion: "verification-operation-result.v1", operationId: activity.context.operationId, useCase, requestDigest: digestCanonicalJson(input.request), output: { verified, sealedRun } };
      const resultArtifact = await dependencies.repository.registerFencedContentAddressedArtifact({ artifact: { tenantId: activity.context.tenantId, producerAttemptId: activity.context.attemptId, ...(activity.context.missionId ? { missionId: activity.context.missionId } : {}), bytes: new TextEncoder().encode(canonicalizeJson(body)), mediaType: "application/vnd.aiengineer.verification-operation-result+json", createdAt: dependencies.now(), producerActivityId: `verification-service:${useCase}`, producerVersion: "verification-service.v1", encryptionClass: "supabase-managed", retentionClass: "verification-audit", dataClassification: "restricted", parentArtifactIds: parents, transformationSignature: digestCanonicalJson({ operationId: activity.context.operationId, requestDigest: body.requestDigest, parents }), artifactType: "deterministic_verification_result", bucketClass: "ledger", storageBucket: dependencies.storageBucket }, lease: { stepId:claim.id, leaseToken:claim.leaseToken, fencingToken:claim.fencingToken, holderIdentity:claim.holderIdentity } });
      await active();
      const result = (operationKind === "verification_claims" ? VerificationClaimsOperationResultSchema : VerificationReportOperationResultSchema).parse({ ...body, resultArtifact });
      return result as unknown as JsonValue;
    } catch (error) {
      if (error instanceof CanonicalActivityError) throw error;
      if (error instanceof z.ZodError) throw new CanonicalActivityError("INVALID_VERIFICATION_CLAIMS_INPUT", "INVALID_VERIFICATION_CLAIMS_INPUT", false);
      const message = error instanceof Error ? error.message : "";
      const code = /^[A-Z][A-Z0-9_]{2,127}$/u.test(message) ? message : "VERIFICATION_CLAIMS_INFRASTRUCTURE_FAILURE";
      const retryable = code === "VERIFICATION_CLAIMS_INFRASTRUCTURE_FAILURE" || code.startsWith("OBJECT_STORE_") || code === "REGISTERED_ARTIFACT_BYTES_UNAVAILABLE";
      throw new CanonicalActivityError(code, code, retryable, { cause: error });
    }
  } };
}

/** Deliberately unavailable until the native append-only review queue exists. */
export function verificationAdjudicationActivityHandler(): never { throw new Error("VERIFICATION_ADJUDICATION_NATIVE_STORE_REQUIRED"); }
