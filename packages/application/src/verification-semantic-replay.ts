import { SemanticAssessmentRecordSchema, SemanticProviderResponseObservationSchema, VerificationArtifactHandleSchema, type SemanticAssessmentRecord, type SemanticJudgeIdentity, type VerificationArtifactHandle } from "@aiengineer/knowledge-contracts";
import { canonicalizeJson, interpretCapturedGatewaySemanticResponse, providerDigest, sha256Digest, verifySemanticCase, type AuthorizedSemanticCase, type SemanticJudgeAdapter, type TrustedArtifactResolver } from "@aiengineer/knowledge-verification";
import { hydrateSemanticGatewayCapture } from "./verification-semantic-recovery.js";
import { semanticObservationTransformationSignature } from "./verification-semantic-observation.js";

/** Caller supplies mechanically authorized case and server-admitted judge profiles, never provider-selected identities. */
export async function replayCapturedSemanticAssessment(input: {
  readonly semanticCase: AuthorizedSemanticCase;
  readonly producerDeploymentId: string;
  readonly expectedAssessment: SemanticAssessmentRecord;
  readonly judges: readonly {
    readonly identity: SemanticJudgeIdentity;
    readonly profileArtifact: VerificationArtifactHandle;
    readonly observationArtifact: VerificationArtifactHandle;
    readonly capture: Parameters<typeof hydrateSemanticGatewayCapture>[0]["capture"];
  }[];
  readonly createResolver: () => TrustedArtifactResolver;
  readonly signal?: AbortSignal;
}) {
  const semanticCase = input.semanticCase, expected = SemanticAssessmentRecordSchema.parse(input.expectedAssessment);
  const judges = structuredClone(input.judges), producer = input.producerDeploymentId, signal = input.signal;
  const createResolver = input.createResolver;
  if (judges.length < 1 || judges.length > 2 || judges.some(judge => judge.identity.deploymentId === producer) || new Set(judges.map(judge => judge.identity.deploymentId)).size !== judges.length) throw new Error("SEMANTIC_REPLAY_JUDGE_BINDING");
  const active = () => { if (signal?.aborted) throw new Error("SEMANTIC_REPLAY_CANCELLED"); };
  const blinded = { rubricVersion: "evidence-only.v1" as const, assertionId: semanticCase.assertionId, proposition: semanticCase.proposition, qualifiers: [...semanticCase.qualifiers], entityBindings: semanticCase.entityBindings.map(value => ({ ...value })), fragments: semanticCase.fragments.map(({ fragmentId, exactText }) => ({ fragmentId, exactText })) };
  const replayedArtifactIds = new Set<string>(), adapters: SemanticJudgeAdapter[] = [];
  for (const judge of judges) {
    active();
    const handle = VerificationArtifactHandleSchema.parse(judge.observationArtifact), resolver = createResolver();
    if (handle.byteLength > 96_000) throw new Error("SEMANTIC_REPLAY_OBSERVATION_TOO_LARGE");
    await resolver.authorizeArtifact({ tenantId: judge.capture.tenantId, artifactId: handle.artifactId, purpose: "verification_admission" });
    const retained = await resolver.hydrateRegisteredArtifact({ tenantId: judge.capture.tenantId, artifactId: handle.artifactId });
    active();
    if (canonicalizeJson(retained.registration) !== canonicalizeJson(handle) || retained.bytes.byteLength !== handle.byteLength || sha256Digest(retained.bytes) !== handle.digest) throw new Error("SEMANTIC_REPLAY_OBSERVATION_INTEGRITY");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(retained.bytes), body = JSON.parse(text);
    const observation = SemanticProviderResponseObservationSchema.parse({ ...body, observationArtifact: handle });
    if (canonicalizeJson(body) !== text || handle.transformationSignature !== semanticObservationTransformationSignature(body) || canonicalizeJson(handle.parentArtifactIds) !== canonicalizeJson([observation.blindedInputArtifact.artifactId, observation.responseEnvelopeArtifact.artifactId, observation.profileArtifact.artifactId])
      || canonicalizeJson(observation.judgeIdentity) !== canonicalizeJson(judge.identity) || canonicalizeJson(observation.profileArtifact) !== canonicalizeJson(judge.profileArtifact)
      || observation.context.providerAttemptId !== judge.capture.providerAttemptId || observation.context.operationId !== judge.capture.operationId || observation.context.operationStepId !== judge.capture.operationStepId || observation.context.fencingToken !== judge.capture.dispatchFencingToken) throw new Error("SEMANTIC_REPLAY_OBSERVATION_BINDING");
    const custody = await hydrateSemanticGatewayCapture({ capture: judge.capture, profileArtifact: judge.profileArtifact, blindedInputArtifact: observation.blindedInputArtifact, blindedInput: blinded, model: judge.identity.model, createResolver, ...(signal ? { signal } : {}) });
    if (canonicalizeJson(custody.requestArtifact) !== canonicalizeJson(observation.requestArtifact) || canonicalizeJson(custody.rawResponseArtifact) !== canonicalizeJson(observation.rawResponseArtifact) || canonicalizeJson(custody.responseEnvelopeArtifact) !== canonicalizeJson(observation.responseEnvelopeArtifact)) throw new Error("SEMANTIC_REPLAY_OBSERVATION_BINDING");
    for (const artifact of [handle, judge.profileArtifact, observation.blindedInputArtifact, custody.transportArtifact, custody.requestArtifact, custody.rawResponseArtifact, custody.responseEnvelopeArtifact]) replayedArtifactIds.add(artifact.artifactId);
    adapters.push({ identity: judge.identity, maximumInputCharacters: 64_000, toolCatalog: [], async judge(value) {
      const { inputArtifactDigest, ...actual } = value;
      if (inputArtifactDigest !== observation.blindedInputArtifact.digest || canonicalizeJson(actual) !== canonicalizeJson(blinded) || providerDigest(actual) !== inputArtifactDigest) throw new Error("SEMANTIC_REPLAY_INPUT_DRIFT");
      return interpretCapturedGatewaySemanticResponse({ rawResponseBytes: custody.rawResponseBytes, rawResponseDigest: observation.rawResponseDigest as `sha256:${string}`, httpStatus: judge.capture.httpStatus, requestDigest: observation.requestDigest as `sha256:${string}`, inputArtifactDigest, identity: judge.identity, assertActive: active, async recordObservation(event) {
        for (const key of ["requestedModel", "observedModel", "modelStatus", "revalidationRequired", "usage"] as const) if (canonicalizeJson(event[key] ?? null) !== canonicalizeJson(observation[key] ?? null)) throw new Error("SEMANTIC_REPLAY_OBSERVATION_DRIFT");
      } });
    } });
  }
  const assessment = await verifySemanticCase(semanticCase, { primary: adapters[0]!, ...(adapters[1] ? { crossFamily: adapters[1] } : {}) }, signal ? { signal } : {});
  if (canonicalizeJson(assessment) !== canonicalizeJson(expected)) throw new Error("SEMANTIC_REPLAY_ASSESSMENT_DRIFT");
  return { assessment, replayedArtifactIds: [...replayedArtifactIds].sort(), externalRequests: 0 as const };
}
