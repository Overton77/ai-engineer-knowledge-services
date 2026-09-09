import { SemanticProviderResponseObservationBodySchema } from "@aiengineer/knowledge-contracts";
import { type SemanticObservationArtifactRegistrationPort, semanticObservationTransformationSignature } from "@aiengineer/knowledge-application";
import { canonicalizeJson } from "@aiengineer/knowledge-verification";
import type { PostgresVerificationRepository } from "./verification.js";
import type { LeasedStep } from "./types.js";

/** Binds the application composer to canonical fenced CAS registration. */
export class PostgresSemanticObservationArtifactRegistration implements SemanticObservationArtifactRegistrationPort {
  private readonly lease: LeasedStep;
  constructor(private readonly artifacts: Pick<PostgresVerificationRepository, "registerFencedContentAddressedArtifact">, lease: LeasedStep) {
    this.lease = structuredClone(lease);
  }

  async registerSemanticObservationArtifact(input: Parameters<SemanticObservationArtifactRegistrationPort["registerSemanticObservationArtifact"]>[0]) {
    const snapshot = structuredClone(input);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(snapshot.bytes);
    const body = SemanticProviderResponseObservationBodySchema.parse(JSON.parse(text));
    const context = body.context, lease = this.lease;
    if (canonicalizeJson(body) !== text || snapshot.tenantId !== context.tenantId
      || context.tenantId !== lease.tenantId || context.operationId !== lease.operationId
      || context.operationStepId !== lease.id || context.leaseToken !== lease.leaseToken
      || context.fencingToken !== lease.fencingToken || context.holderIdentity !== lease.holderIdentity
      || context.host.stepKey !== lease.stepKey || lease.stepKind !== lease.stepKey
      || snapshot.producerAttemptId !== context.producerAttemptId
      || snapshot.artifactType !== "verification_semantic_response_observation" || snapshot.bucketClass !== "ledger"
      || snapshot.mediaType !== "application/vnd.aiengineer.verification-semantic-response-observation+json"
      || snapshot.dataClassification !== "restricted"
      || snapshot.transformationSignature !== semanticObservationTransformationSignature(body)
      || canonicalizeJson(snapshot.parentArtifactIds) !== canonicalizeJson([body.blindedInputArtifact.artifactId,body.responseEnvelopeArtifact.artifactId,body.profileArtifact.artifactId])) {
      throw new Error("SEMANTIC_OBSERVATION_REGISTRATION_BINDING_MISMATCH");
    }
    return this.artifacts.registerFencedContentAddressedArtifact({ artifact: snapshot, lease: {
      stepId: lease.id, leaseToken: lease.leaseToken, fencingToken: lease.fencingToken, holderIdentity: lease.holderIdentity,
    } });
  }
}
