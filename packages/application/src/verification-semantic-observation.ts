import {
  SemanticProviderResponseObservationBodySchema,
  SemanticProviderResponseObservationSchema,
  type SemanticProviderResponseObservation,
  type VerificationArtifactHandle,
} from "@aiengineer/knowledge-contracts";
import { canonicalizeJson, providerDigest } from "@aiengineer/knowledge-verification";

export interface SemanticObservationArtifactRegistrationPort {
  registerSemanticObservationArtifact(input: {
    readonly tenantId: string;
    readonly bytes: Uint8Array;
    readonly mediaType: "application/vnd.aiengineer.verification-semantic-response-observation+json";
    readonly createdAt: string;
    readonly producerActivityId: string;
    readonly producerVersion: string;
    readonly encryptionClass: string;
    readonly retentionClass: string;
    readonly dataClassification: "restricted";
    readonly parentArtifactIds: readonly [string, string, string];
    readonly transformationSignature: `sha256:${string}`;
    readonly artifactType: "verification_semantic_response_observation";
    readonly bucketClass: "ledger";
    readonly storageBucket: string;
    readonly producerAttemptId: string;
    readonly missionId?: string;
  }): Promise<VerificationArtifactHandle>;
}

export function semanticObservationTransformationSignature(bodyValue: unknown): `sha256:${string}` {
  const body = SemanticProviderResponseObservationBodySchema.parse(bodyValue);
  return providerDigest({ kind: "verification_semantic_response_observation.v1", body });
}

/**
 * Trusted application composition for the retained semantic observation body.
 * It accepts no public request and deliberately serializes before an artifact
 * handle exists, preventing a self-referential digest.
 */
export class SemanticObservationArtifactComposer {
  constructor(private readonly repository: SemanticObservationArtifactRegistrationPort, private readonly config: {
    readonly storageBucket: string;
    readonly producerActivityId: string;
    readonly producerVersion: string;
    readonly encryptionClass: string;
    readonly retentionClass: string;
    readonly now: () => string;
    readonly missionId?: string;
  }) {}

  async compose(bodyValue: unknown): Promise<SemanticProviderResponseObservation> {
    const body = SemanticProviderResponseObservationBodySchema.parse(bodyValue);
    const bytes = new TextEncoder().encode(canonicalizeJson(body));
    const digest = providerDigest(body);
    const createdAt = this.config.now();
    if (!Number.isFinite(Date.parse(createdAt))) throw new Error("SEMANTIC_OBSERVATION_CLOCK_INVALID");
    const transformationSignature = semanticObservationTransformationSignature(body);
    const parents = [body.blindedInputArtifact.artifactId, body.responseEnvelopeArtifact.artifactId, body.profileArtifact.artifactId] as const;
    const artifact = await this.repository.registerSemanticObservationArtifact({
      tenantId: body.context.tenantId, bytes,
      mediaType: "application/vnd.aiengineer.verification-semantic-response-observation+json",
      createdAt, producerActivityId: this.config.producerActivityId, producerVersion: this.config.producerVersion,
      encryptionClass: this.config.encryptionClass, retentionClass: this.config.retentionClass, dataClassification: "restricted",
      parentArtifactIds: parents, transformationSignature, artifactType: "verification_semantic_response_observation",
      bucketClass: "ledger", storageBucket: this.config.storageBucket, producerAttemptId: body.context.producerAttemptId,
      ...(this.config.missionId === undefined ? {} : { missionId: this.config.missionId }),
    });
    if (artifact.tenantId !== body.context.tenantId || artifact.digest !== digest
      || artifact.mediaType !== "application/vnd.aiengineer.verification-semantic-response-observation+json"
      || artifact.byteLength !== bytes.byteLength || !Number.isFinite(Date.parse(artifact.createdAt))
      || Date.parse(artifact.createdAt) > Date.parse(createdAt)
      || artifact.producerActivityId !== this.config.producerActivityId || artifact.producerVersion !== this.config.producerVersion
      || artifact.encryptionClass !== this.config.encryptionClass || artifact.retentionClass !== this.config.retentionClass
      || artifact.dataClassification !== "restricted" || artifact.transformationSignature !== transformationSignature
      || artifact.parentArtifactIds.length !== parents.length
      || artifact.parentArtifactIds.some((parent, index) => parent !== parents[index])) {
      throw new Error("SEMANTIC_OBSERVATION_ARTIFACT_BINDING_MISMATCH");
    }
    return SemanticProviderResponseObservationSchema.parse({ ...body, observationArtifact: artifact });
  }
}
