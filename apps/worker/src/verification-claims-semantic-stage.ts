import { parseSemanticJudgeProfileCatalog, type SemanticJudgeProfileCatalog, type SemanticJudgeProfileGrant, type VerificationClaimsApplicationService } from "@aiengineer/knowledge-application";
import { SemanticBlindedInputSchema, type VerificationArtifactHandle } from "@aiengineer/knowledge-contracts";
import { createNativeSemanticGatewayCall, type PostgresCanonicalRepository, type PostgresVerificationRepository } from "@aiengineer/knowledge-persistence";
import { deterministicUuid } from "@aiengineer/knowledge-runtime";
import { digestCanonicalJson, prepareGatewaySemanticRequest, sha256Digest, type SemanticJudgeAdapter } from "@aiengineer/knowledge-verification";
import { z } from "zod";
import type { ClaimsSealerOptions } from "./verification-claims-sealer.js";

const modelSchema = z.enum(["openai/gpt-5.6-luna", "openai/gpt-5.6-terra", "anthropic/claude-haiku-4.5"]);
export const ClaimsSemanticRuntimeSettingsSchema = z.strictObject({
  classification: z.enum(["synthetic", "public"]),
  ceilingCostMicros: z.number().int().positive().max(20_000_000),
  reservationCostMicros: z.number().int().positive().max(20_000_000),
  deadlineMs: z.number().int().min(1_000).max(300_000),
}).refine(value => value.reservationCostMicros <= value.ceilingCostMicros);

export function parseClaimsSemanticRuntimeConfiguration(environment: Readonly<Record<string,string | undefined>>) {
  const value = environment.VERIFICATION_SEMANTIC_RUNTIME_JSON;
  if (value === undefined) return undefined;
  if (value.length > 4_096) throw new Error("SEMANTIC_RUNTIME_CONFIGURATION_TOO_LARGE");
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error("SEMANTIC_RUNTIME_CONFIGURATION_INVALID"); }
  const settings = ClaimsSemanticRuntimeSettingsSchema.parse(parsed);
  const grants = environment.VERIFICATION_SEMANTIC_PROFILE_GRANTS_JSON;
  const apiKey = environment.AI_GATEWAY_API_KEY?.trim();
  if (!grants || !apiKey) throw new Error("SEMANTIC_RUNTIME_PROFILE_AND_KEY_REQUIRED");
  return {settings,profiles:parseSemanticJudgeProfileCatalog(grants),apiKey};
}

/** Optional server-owned stage. Each invoked judge shares the operation's durable budget. */
export function createVerificationClaimsSemanticStage(dependencies: {
  readonly service: VerificationClaimsApplicationService;
  readonly database: PostgresCanonicalRepository;
  readonly repository: PostgresVerificationRepository;
  readonly profiles: SemanticJudgeProfileCatalog;
  readonly settings: z.infer<typeof ClaimsSemanticRuntimeSettingsSchema>;
  readonly apiKey: string;
  readonly storageBucket: string;
  readonly now: () => string;
  readonly fetch?: typeof fetch;
}): NonNullable<ClaimsSealerOptions["semanticStage"]> {
  const settings = ClaimsSemanticRuntimeSettingsSchema.parse(dependencies.settings);
  if (!dependencies.apiKey.trim()) throw new Error("SEMANTIC_GATEWAY_API_KEY_REQUIRED");
  return { async grade(input) {
    const lease = input.runtimeLease && structuredClone(input.runtimeLease), context = input.context;
    const host = "reportArtifact" in input.verified ? "report" : "claims";
    const stepKey = host === "claims" ? "verify_claims_and_register" : "verify_report_and_register";
    if (!lease || lease.tenantId !== context.tenantId || lease.operationId !== context.operationId || lease.stepKey !== stepKey || lease.stepKind !== stepKey
      || lease.id !== input.claim.stepId || lease.leaseToken !== input.claim.leaseToken || lease.fencingToken !== input.claim.fencingToken || lease.holderIdentity !== input.claim.holderIdentity) throw new Error("SEMANTIC_RUNTIME_LEASE_REQUIRED");
    const grants = dependencies.profiles.resolve(context.tenantId,context.operationId,host);
    const artifacts = new Map<string, VerificationArtifactHandle>();
    const deadlineEpochMs = Date.now() + settings.deadlineMs;
    const budget = { budgetId: deterministicUuid("verification-semantic-budget",`${context.tenantId}:${context.operationId}`), budgetKey: `verification-semantic-${context.operationId}`, ceilingCostMicros: settings.ceilingCostMicros, reservationCostMicros: settings.reservationCostMicros };
    function adapter(grant: SemanticJudgeProfileGrant): SemanticJudgeAdapter {
      return { identity: grant.identity, maximumInputCharacters: 64_000, toolCatalog: [], async judge(value, execution) {
        const profile = await dependencies.profiles.hydrate(grant,dependencies.repository.createTrustedArtifactResolver());
        const { inputArtifactDigest: _digest, ...body } = value;
        const blindedInput = SemanticBlindedInputSchema.parse(body), model = modelSchema.parse(grant.identity.model);
        const call = await createNativeSemanticGatewayCall({ database: dependencies.database, artifacts: dependencies.repository, lease: lease!, host,
          producerAttemptId: context.attemptId, providerAttemptId: deterministicUuid("verification-semantic-provider",`${context.tenantId}:${context.operationId}:${profile.artifact.artifactId}:${profile.artifact.digest}:${digestCanonicalJson(blindedInput)}`),
          profileArtifact: profile.artifact, blindedInput, identity: grant.identity, model, apiKey: dependencies.apiKey, budget,
          classification: settings.classification, storageBucket: dependencies.storageBucket, now: dependencies.now, ...(dependencies.fetch ? {fetch:dependencies.fetch} : {}) });
        const result = await call.adapter.judge(value,execution);
        // Resolve the original durable attempt, including after worker takeover; never assume
        // this invocation's proposed attempt ID owns a recovered observation.
        const request = prepareGatewaySemanticRequest(value,model);
        const rows = await dependencies.database.transaction(context.tenantId,async client => (await client.query<Record<string,unknown>>(`select o.observation_artifact_id,o.observation_sha256,c.transport_artifact_id,c.transport_sha256
          from orchestration.verification_semantic_response_observation o join orchestration.verification_provider_response_capture c
          on c.tenant_id=o.tenant_id and c.provider_attempt_id=o.provider_attempt_id and c.operation_id=o.operation_id and c.operation_step_id=o.operation_step_id
          where o.tenant_id=$1 and o.operation_id=$2 and o.operation_step_id=$3 and o.profile_artifact_id=$4 and o.profile_sha256=$5 and o.request_sha256=$6 limit 2`,
          [context.tenantId,context.operationId,lease!.id,profile.artifact.artifactId,profile.artifact.digest.slice(7),request.requestDigest.slice(7)])).rows);
        if (rows.length !== 1) throw new Error("SEMANTIC_STAGE_OBSERVATION_REQUIRED");
        const row = rows[0]!;
        for (const [id,digest] of [[row.observation_artifact_id,row.observation_sha256],[row.transport_artifact_id,row.transport_sha256]]) {
          const resolver = dependencies.repository.createTrustedArtifactResolver();
          await resolver.authorizeArtifact({tenantId:context.tenantId,artifactId:String(id),purpose:"verification_admission"});
          const loaded = await resolver.hydrateRegisteredArtifact({tenantId:context.tenantId,artifactId:String(id)});
          if (loaded.registration.tenantId !== context.tenantId || loaded.registration.artifactId !== String(id) || loaded.registration.digest !== `sha256:${String(digest)}` || loaded.bytes.byteLength !== loaded.registration.byteLength || sha256Digest(loaded.bytes) !== loaded.registration.digest) throw new Error("SEMANTIC_STAGE_EVIDENCE_DRIFT");
          artifacts.set(loaded.registration.artifactId,loaded.registration);
        }
        return result;
      } };
    }
    const batch = await dependencies.service.gradePreparedSemantics(input.verified,context,async () => ({ primary: adapter(grants[0]!), ...(grants[1] ? {crossFamily:adapter(grants[1])} : {}) }),{deadlineEpochMs});
    dependencies.service.assertSemanticAssessmentBatch(input.verified,context,batch);
    return { assessments: batch.assessments, evidenceArtifacts: [...artifacts.values()] };
  } };
}
