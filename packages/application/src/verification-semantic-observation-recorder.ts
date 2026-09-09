import { SemanticProviderResponseObservationBodySchema, type SemanticProviderResponseObservation, type SemanticProviderResponseObservationBody } from "@aiengineer/knowledge-contracts";
import type { GatewaySemanticResponseObservation } from "@aiengineer/knowledge-verification";
import type { SemanticObservationArtifactComposer } from "./verification-semantic-observation.js";
import type { VerificationProviderArtifactComposer } from "./verification-provider.js";

export type SemanticCapturedObservationBinding = Pick<SemanticProviderResponseObservationBody,
  "context" | "profileArtifact" | "blindedInputArtifact" | "requestArtifact" | "rawResponseArtifact" | "responseEnvelopeArtifact" | "judgeIdentity">;

/** Handles become available only after the composer's durable transport callback succeeds. */
export class SemanticProviderComposerBinding {
  private readonly binding: Omit<SemanticCapturedObservationBinding,"requestArtifact" | "rawResponseArtifact" | "responseEnvelopeArtifact">;
  constructor(binding: Omit<SemanticCapturedObservationBinding,"requestArtifact" | "rawResponseArtifact" | "responseEnvelopeArtifact">,
    private readonly composer: Pick<VerificationProviderArtifactComposer,"requestArtifact" | "rawResponseArtifact" | "responseEnvelopeArtifact" | "transportResponseArtifact">) {
    this.binding=structuredClone(binding);
  }
  async loadCapturedBinding(requestDigest: string, rawResponseDigest: string): Promise<SemanticCapturedObservationBinding> {
    if (!/^sha256:[a-f0-9]{64}$/u.test(requestDigest) || !/^sha256:[a-f0-9]{64}$/u.test(rawResponseDigest)) throw new Error("SEMANTIC_CAPTURE_DIGEST_INVALID");
    const key=requestDigest as `sha256:${string}`,request=this.composer.requestArtifact(key),raw=this.composer.rawResponseArtifact(key),envelope=this.composer.responseEnvelopeArtifact(key),transport=this.composer.transportResponseArtifact(key);
    if (!request || !raw || !envelope || !transport || request.digest!==requestDigest || raw.digest!==rawResponseDigest
      || transport.tenantId!==this.binding.context.tenantId || transport.parentArtifactIds.length!==2
      || transport.parentArtifactIds[0]!==envelope.artifactId || transport.parentArtifactIds[1]!==this.binding.profileArtifact.artifactId) throw new Error("SEMANTIC_CAPTURE_BINDING_UNAVAILABLE");
    return structuredClone({...this.binding,requestArtifact:request,rawResponseArtifact:raw,responseEnvelopeArtifact:envelope});
  }
}

/** Runtime-only bridge: gateway evidence cannot choose its operation, artifacts or judge identity. */
export class SemanticGatewayObservationRecorder {
  private readonly expected: Readonly<{ tenantId: string; operationId: string; operationStepId: string; deploymentId: string }>;
  constructor(
    expected: { readonly tenantId: string; readonly operationId: string; readonly operationStepId: string; readonly deploymentId: string },
    private readonly custody: { loadCapturedBinding(requestDigest: string, rawResponseDigest: string): Promise<SemanticCapturedObservationBinding> },
    private readonly composer: Pick<SemanticObservationArtifactComposer, "compose">,
    private readonly observations: { store(value: SemanticProviderResponseObservation): Promise<unknown> },
  ) { this.expected = Object.freeze({ ...expected }); }

  async record(eventValue: GatewaySemanticResponseObservation): Promise<void> {
    const event = structuredClone(eventValue);
    if (event.schemaVersion !== "verification-semantic-response-observation.v1" || event.deploymentId !== this.expected.deploymentId || !event.inputArtifactDigest) {
      throw new Error("SEMANTIC_GATEWAY_OBSERVATION_IDENTITY_MISMATCH");
    }
    const binding = structuredClone(await this.custody.loadCapturedBinding(event.requestDigest,event.rawResponseDigest));
    if (binding.context.tenantId !== this.expected.tenantId || binding.context.operationId !== this.expected.operationId
      || binding.context.operationStepId !== this.expected.operationStepId || binding.judgeIdentity.deploymentId !== this.expected.deploymentId) {
      throw new Error("SEMANTIC_GATEWAY_OBSERVATION_CUSTODY_MISMATCH");
    }
    const body = SemanticProviderResponseObservationBodySchema.parse({
      ...binding, schemaVersion: "verification-semantic-response-observation.v1", verificationContractVersion: "verification.v1",
      inputArtifactDigest: event.inputArtifactDigest, requestDigest: event.requestDigest, rawResponseDigest: event.rawResponseDigest,
      requestedModel: event.requestedModel, ...(event.observedModel === undefined ? {} : {observedModel:event.observedModel}),
      modelStatus: event.modelStatus, revalidationRequired: event.revalidationRequired, usage: event.usage,
      costStatus: event.usage.costMicros === undefined ? "unknown" : "reported",
    });
    await this.observations.store(await this.composer.compose(body));
  }
}
