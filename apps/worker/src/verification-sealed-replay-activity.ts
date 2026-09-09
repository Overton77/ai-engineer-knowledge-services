import type { VerificationOperationRepositoryPort } from "@aiengineer/knowledge-application";
import {
  ReplayRunRequestSchema,
  Sha256DigestSchema,
  type JsonValue,
  type OperationContext,
} from "@aiengineer/knowledge-contracts";
import type { OperationsRepository } from "@aiengineer/knowledge-persistence";
import { canonicalizeJson, digestCanonicalJson } from "@aiengineer/knowledge-verification";
import { z } from "zod";
import { CanonicalActivityError, type CanonicalActivityHandler } from "./activity-registry.js";

const inputSchema = z.strictObject({
  schemaVersion: z.literal("verification-service-request.v1"),
  useCase: z.literal("replayRun"),
  request: ReplayRunRequestSchema,
});
const replayResultSchema = z.strictObject({
  runId: z.string().trim().min(1).max(255),
  manifestDigest: Sha256DigestSchema,
  deterministicResultDigest: Sha256DigestSchema,
  policyOutcome: z.enum(["pass", "pass_with_warnings", "review", "abstain", "fail"]),
  replayedArtifactIds: z.array(z.uuid()).max(512),
});

type SealedReplayResult = z.infer<typeof replayResultSchema>;

export type TrustedSealedReplayService = (input: {
  readonly tenantId: string;
  readonly runId: string;
  readonly context: OperationContext;
}) => Promise<SealedReplayResult>;

/**
 * Replay uses only retained deterministic inputs or recorded provider outputs.
 * It never receives a route, credential, or provider execution capability.
 */
export function verificationSealedReplayActivityHandler(dependencies: {
  readonly repository: Pick<VerificationOperationRepositoryPort, "registerContentAddressedArtifact">;
  readonly operations: Pick<OperationsRepository, "getOperationRecord">;
  readonly replay: TrustedSealedReplayService;
  readonly storageBucket: string;
  readonly now: () => string;
  /** Legacy extraction replay is allowed only when no sealed run exists. */
  readonly fallback?: CanonicalActivityHandler;
}): CanonicalActivityHandler {
  return {
    operationKind: "verification_replay",
    stepName: "hydrate_and_recompute",
    async execute(invocation): Promise<JsonValue> {
      const { activity } = invocation;
      const active = async () => {
        const operation = await dependencies.operations.getOperationRecord(activity.context.tenantId, activity.context.operationId);
        if (!operation || operation.status !== "running") {
          throw new CanonicalActivityError("VERIFICATION_OPERATION_NOT_ACTIVE", "VERIFICATION_OPERATION_NOT_ACTIVE", false);
        }
      };
      try {
        const input = inputSchema.parse(activity.operationInput);
        await active();
        let replayed: SealedReplayResult;
        try {
          replayed = replayResultSchema.parse(await dependencies.replay({
            tenantId: activity.context.tenantId,
            runId: input.request.runId,
            context: activity.context,
          }));
        } catch (error) {
          if (isSealedRunNotFound(error) && dependencies.fallback) return await dependencies.fallback.execute(invocation) as JsonValue;
          throw error;
        }
        if (replayed.runId !== input.request.runId) throw new Error("SEALED_REPLAY_RUN_BINDING_MISMATCH");
        await active();
        const replayedArtifactIds = [...new Set(replayed.replayedArtifactIds)].sort();
        const body = {
          schemaVersion: "verification-operation-result.v1",
          operationId: activity.context.operationId,
          useCase: "replayRun",
          requestDigest: digestCanonicalJson(input.request),
          output: {
            result: { valid: true },
            replayMatched: true,
            sourceRunId: replayed.runId,
            manifestDigest: replayed.manifestDigest,
            deterministicResultDigest: replayed.deterministicResultDigest,
            policyOutcome: replayed.policyOutcome,
            replayedArtifactIds,
          },
        };
        const bytes = new TextEncoder().encode(canonicalizeJson(body));
        const resultArtifact = await dependencies.repository.registerContentAddressedArtifact({
          tenantId: activity.context.tenantId,
          producerAttemptId: activity.context.attemptId,
          ...(activity.context.missionId ? { missionId: activity.context.missionId } : {}),
          bytes,
          mediaType: "application/vnd.aiengineer.verification-operation-result+json",
          createdAt: dependencies.now(),
          producerActivityId: "verification-worker:replayRun",
          producerVersion: "verification-sealed-replay.v1",
          encryptionClass: "supabase-managed",
          retentionClass: "verification-audit",
          dataClassification: "restricted",
          parentArtifactIds: replayedArtifactIds,
          transformationSignature: digestCanonicalJson({
            kind: "verification_sealed_replay_result.v1",
            operationId: activity.context.operationId,
            requestDigest: body.requestDigest,
            sourceRunId: replayed.runId,
            manifestDigest: replayed.manifestDigest,
            deterministicResultDigest: replayed.deterministicResultDigest,
            policyOutcome: replayed.policyOutcome,
            replayedArtifactIds,
          }),
          artifactType: "deterministic_verification_result",
          bucketClass: "ledger",
          storageBucket: dependencies.storageBucket,
        });
        await active();
        return { ...body, resultArtifact } as unknown as JsonValue;
      } catch (error) {
        if (error instanceof CanonicalActivityError) throw error;
        if (error instanceof z.ZodError) throw new CanonicalActivityError("INVALID_VERIFICATION_REPLAY_INPUT", "INVALID_VERIFICATION_REPLAY_INPUT", false);
        const message = error instanceof Error ? error.message : "";
        const code = /^[A-Z][A-Z0-9_]{2,127}$/u.test(message) ? message : "VERIFICATION_REPLAY_INFRASTRUCTURE_FAILURE";
        const retryable = code === "VERIFICATION_REPLAY_INFRASTRUCTURE_FAILURE" || code.startsWith("OBJECT_STORE_") || code === "REGISTERED_ARTIFACT_BYTES_UNAVAILABLE";
        throw new CanonicalActivityError(code, code, retryable, { cause: error });
      }
    },
  };
}

function isSealedRunNotFound(error: unknown): boolean {
  return error instanceof Error && error.message === "SEALED_REPLAY_RUN_NOT_FOUND";
}
