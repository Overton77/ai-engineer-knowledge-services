import { SemanticProviderResponseObservationSchema, type SemanticBlindedInput, type SemanticJudgeIdentity, type VerificationArtifactHandle } from "@aiengineer/knowledge-contracts";
import { SemanticObservationArtifactComposer, hydrateSemanticGatewayCapture } from "@aiengineer/knowledge-application";
import { canonicalizeJson, interpretCapturedGatewaySemanticResponse } from "@aiengineer/knowledge-verification";
import type { PostgresCanonicalRepository } from "./postgres.js";
import type { PostgresVerificationRepository } from "./verification.js";
import type { LeasedStep } from "./types.js";
import { PostgresVerificationProviderResponseCaptureStore } from "./verification-provider-response-capture.js";
import { PostgresVerificationSemanticObservationStore } from "./verification-semantic-observation-store.js";
import { PostgresVerificationProviderAccounting } from "./verification-provider-accounting.js";

/** Recovers a durably observed call. A capture without an observation remains pending; never redispatches. */
export async function recoverObservedSemanticGatewayCall(input: {
  readonly database: PostgresCanonicalRepository;
  readonly artifacts: PostgresVerificationRepository;
  readonly lease: LeasedStep;
  readonly host: "claims" | "report";
  readonly providerAttemptId: string;
  readonly profileArtifact: VerificationArtifactHandle;
  readonly blindedInputArtifact: VerificationArtifactHandle;
  readonly blindedInput: SemanticBlindedInput;
  readonly identity: SemanticJudgeIdentity;
  readonly signal?: AbortSignal;
}) {
  const { database, artifacts, signal } = input;
  const expected = structuredClone({ lease: input.lease, host: input.host, providerAttemptId: input.providerAttemptId, profile: input.profileArtifact, blindedArtifact: input.blindedInputArtifact, blinded: input.blindedInput, identity: input.identity });
  const { lease, host, providerAttemptId, profile, identity } = expected;
  const active = () => { if (signal?.aborted) throw new Error("SEMANTIC_RECOVERY_CANCELLED"); };
  active();
  const capture = await new PostgresVerificationProviderResponseCaptureStore(database, host).readForRecovery({ lease, providerAttemptId });
  if (!capture) throw new Error("SEMANTIC_RECOVERY_CAPTURE_REQUIRED");
  const row = await database.transaction(lease.tenantId, async client => (await client.query<{ observation_artifact_id: string }>("select observation_artifact_id from orchestration.verification_semantic_response_observation where tenant_id=$1 and provider_attempt_id=$2 and operation_id=$3 and operation_step_id=$4", [lease.tenantId, providerAttemptId, lease.operationId, lease.id])).rows[0]);
  if (!row) throw new Error("SEMANTIC_RECOVERY_OBSERVATION_REQUIRED");
  const resolver = artifacts.createTrustedArtifactResolver();
  await resolver.authorizeArtifact({ tenantId: lease.tenantId, artifactId: row.observation_artifact_id, purpose: "verification_admission" });
  active();
  const retained = await resolver.hydrateRegisteredArtifact({ tenantId: lease.tenantId, artifactId: row.observation_artifact_id });
  if (retained.bytes.byteLength > 96_000) throw new Error("SEMANTIC_RECOVERY_OBSERVATION_TOO_LARGE");
  const observation = SemanticProviderResponseObservationSchema.parse({ ...JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(retained.bytes)), observationArtifact: retained.registration });
  if (canonicalizeJson(observation.judgeIdentity) !== canonicalizeJson(identity) || observation.context.providerAttemptId !== providerAttemptId || canonicalizeJson(observation.blindedInputArtifact) !== canonicalizeJson(expected.blindedArtifact) || canonicalizeJson(observation.profileArtifact) !== canonicalizeJson(profile)) throw new Error("SEMANTIC_RECOVERY_OBSERVATION_BINDING");
  const custody = await hydrateSemanticGatewayCapture({ capture, profileArtifact: profile, blindedInputArtifact: expected.blindedArtifact, blindedInput: expected.blinded, model: identity.model, createResolver: () => artifacts.createTrustedArtifactResolver(), ...(signal ? { signal } : {}) });
  if (canonicalizeJson(custody.requestArtifact) !== canonicalizeJson(observation.requestArtifact) || canonicalizeJson(custody.rawResponseArtifact) !== canonicalizeJson(observation.rawResponseArtifact) || canonicalizeJson(custody.responseEnvelopeArtifact) !== canonicalizeJson(observation.responseEnvelopeArtifact)) throw new Error("SEMANTIC_RECOVERY_OBSERVATION_BINDING");
  await new PostgresVerificationSemanticObservationStore(database).store(observation, lease);
  const accounting = new PostgresVerificationProviderAccounting(database, { lease, host, profileArtifactId: profile.artifactId, profileDigest: profile.digest as `sha256:${string}` });
  const output = await interpretCapturedGatewaySemanticResponse({ rawResponseBytes: custody.rawResponseBytes, rawResponseDigest: custody.rawResponseArtifact.digest as `sha256:${string}`, httpStatus: capture.httpStatus, requestDigest: observation.requestDigest as `sha256:${string}`, inputArtifactDigest: expected.blindedArtifact.digest as `sha256:${string}`, identity, assertActive: active, async recordObservation(event) {
    for (const key of ["requestedModel", "observedModel", "modelStatus", "revalidationRequired", "usage"] as const) if (canonicalizeJson(event[key] ?? null) !== canonicalizeJson(observation[key] ?? null)) throw new Error("SEMANTIC_RECOVERY_OBSERVATION_DRIFT");
    if (event.usage.costMicros !== undefined) await accounting.settle({ tenantId: lease.tenantId, attemptId: providerAttemptId, responseArtifactId: capture.responseEnvelopeArtifactId, actualCostMicros: event.usage.costMicros });
    else {
      const attempt = await accounting.readOriginalAttempt(lease.tenantId, { requestDigest: observation.requestDigest as `sha256:${string}`, attemptOrdinal: 0 });
      if (!attempt || attempt.attemptId !== providerAttemptId) throw new Error("SEMANTIC_RECOVERY_ACCOUNTING_BINDING");
      if (attempt.state !== "settled") await accounting.markUncertain({ tenantId: lease.tenantId, attemptId: providerAttemptId, responseArtifactId: capture.responseEnvelopeArtifactId });
    }
  } });
  return { output, observation, externalRequests: 0 as const };
}



/** Repairs the post-capture/pre-observation crash window from native retained dispatch context. */
export async function recoverCapturedSemanticGatewayCall(input: Parameters<typeof recoverObservedSemanticGatewayCall>[0] & {
  readonly storageBucket: string;
  readonly now: () => string;
}) {
  const { database, artifacts, signal, now, storageBucket } = input;
  const { lease, host, providerAttemptId, profileArtifact, blindedInputArtifact, blindedInput, identity } = structuredClone({ lease: input.lease, host: input.host, providerAttemptId: input.providerAttemptId, profileArtifact: input.profileArtifact, blindedInputArtifact: input.blindedInputArtifact, blindedInput: input.blindedInput, identity: input.identity });
  const active = () => { if (signal?.aborted) throw new Error("SEMANTIC_RECOVERY_CANCELLED"); };
  active();
  const capture = await new PostgresVerificationProviderResponseCaptureStore(database, host).readForRecovery({ lease, providerAttemptId });
  if (!capture) throw new Error("SEMANTIC_RECOVERY_CAPTURE_REQUIRED");
  const row = await database.transaction(lease.tenantId, async client => (await client.query<{ semantic_dispatch_lease_token: string; semantic_dispatch_holder_identity: string; producer_attempt_id: string; model: string; observation_artifact_id: string | null }>(`select p.semantic_dispatch_lease_token,p.semantic_dispatch_holder_identity,o.attempt_id producer_attempt_id,p.model,s.observation_artifact_id
    from orchestration.verification_provider_attempt p join knowledge_service.operation o on o.tenant_id=p.tenant_id and o.id=p.operation_id
    left join orchestration.verification_semantic_response_observation s on s.tenant_id=p.tenant_id and s.provider_attempt_id=p.id
    where p.tenant_id=$1 and p.id=$2 and p.operation_id=$3 and p.operation_step_id=$4`, [lease.tenantId,providerAttemptId,lease.operationId,lease.id])).rows[0]);
  if (!row || !row.semantic_dispatch_lease_token || !row.semantic_dispatch_holder_identity || !row.producer_attempt_id || row.model !== identity.model) throw new Error("SEMANTIC_RECOVERY_DISPATCH_CONTEXT_REQUIRED");
  if (row.observation_artifact_id) return recoverObservedSemanticGatewayCall({ database, artifacts, lease, host, providerAttemptId, profileArtifact, blindedInputArtifact, blindedInput, identity, ...(signal ? { signal } : {}) });
  const custody = await hydrateSemanticGatewayCapture({ capture, profileArtifact, blindedInputArtifact, blindedInput, model: identity.model, createResolver: () => artifacts.createTrustedArtifactResolver(), ...(signal ? { signal } : {}) });
  const composer = new SemanticObservationArtifactComposer({ registerSemanticObservationArtifact: artifact => artifacts.registerFencedContentAddressedArtifact({ artifact, lease: { stepId: lease.id, leaseToken: lease.leaseToken, fencingToken: lease.fencingToken, holderIdentity: lease.holderIdentity } }) }, { storageBucket, now, producerActivityId: "verification-semantic-gateway", producerVersion: "v1", encryptionClass: "supabase-managed", retentionClass: "verification-audit" });
  let observation: ReturnType<typeof SemanticProviderResponseObservationSchema.parse> | undefined;
  const accounting = new PostgresVerificationProviderAccounting(database, { lease, host, profileArtifactId: profileArtifact.artifactId, profileDigest: profileArtifact.digest as `sha256:${string}` });
  const output = await interpretCapturedGatewaySemanticResponse({ rawResponseBytes: custody.rawResponseBytes, rawResponseDigest: custody.rawResponseArtifact.digest as `sha256:${string}`, httpStatus: capture.httpStatus, requestDigest: custody.requestArtifact.digest as `sha256:${string}`, inputArtifactDigest: blindedInputArtifact.digest as `sha256:${string}`, identity, assertActive: active, async recordObservation(event) {
    observation = await composer.compose({ schemaVersion: "verification-semantic-response-observation.v1", verificationContractVersion: "verification.v1",
      context: { tenantId: lease.tenantId, operationId: lease.operationId, operationStepId: lease.id, leaseToken: row.semantic_dispatch_lease_token, fencingToken: capture.dispatchFencingToken, holderIdentity: row.semantic_dispatch_holder_identity, producerAttemptId: row.producer_attempt_id, providerAttemptId,
        host: host === "claims" ? { operationKind: "verification_claims", stepKey: "verify_claims_and_register", useCase: "verifyClaims" } : { operationKind: "verification_report", stepKey: "verify_report_and_register", useCase: "verifyReport" } },
      profileArtifact, blindedInputArtifact, requestArtifact: custody.requestArtifact, rawResponseArtifact: custody.rawResponseArtifact, responseEnvelopeArtifact: custody.responseEnvelopeArtifact, judgeIdentity: identity,
      inputArtifactDigest: blindedInputArtifact.digest, requestDigest: event.requestDigest, rawResponseDigest: event.rawResponseDigest, requestedModel: event.requestedModel, ...(event.observedModel === undefined ? {} : { observedModel: event.observedModel }), modelStatus: event.modelStatus, revalidationRequired: event.revalidationRequired, usage: event.usage, costStatus: event.usage.costMicros === undefined ? "unknown" : "reported" });
    await new PostgresVerificationSemanticObservationStore(database).store(observation, lease);
    if (event.usage.costMicros !== undefined) await accounting.settle({ tenantId: lease.tenantId, attemptId: providerAttemptId, responseArtifactId: capture.responseEnvelopeArtifactId, actualCostMicros: event.usage.costMicros });
    else await accounting.markUncertain({ tenantId: lease.tenantId, attemptId: providerAttemptId, responseArtifactId: capture.responseEnvelopeArtifactId });
  } });
  if (!observation) throw new Error("SEMANTIC_RECOVERY_OBSERVATION_REQUIRED");
  return { output, observation, externalRequests: 0 as const };
}
