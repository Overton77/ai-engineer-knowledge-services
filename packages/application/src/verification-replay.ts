import { replayVerificationPolicy } from "@aiengineer/knowledge-policy";
import {
  replayAuditBundle,
  type AuditBundleSignatureVerifier,
  type DeterministicSelectorResolver,
  type DeterministicVerificationOptions,
  type RuntimePrincipalBinding,
  type VerificationSemanticReplayPort,
  type TrustedArtifactResolver,
  type VerificationAuditBundle,
  type VerificationPolicyReplayPort,
} from "@aiengineer/knowledge-verification";
import type { VerificationPolicyReplayPort as PolicyReplayPort } from "@aiengineer/knowledge-verification";
import { digestCanonicalJson, inspectAuditBundle, sha256Digest, projectionSelectorResolver } from "@aiengineer/knowledge-verification";
import { VerificationMetricProfileSchema } from "./verification-metrics.js";
import type { VerificationAdmissionService } from "./verification-admission.js";

/** Trusted application composition for deterministic offline policy replay. */
export function createOfflineVerificationPolicyReplayPort(): VerificationPolicyReplayPort {
  return Object.freeze({
    async replay(input: Parameters<PolicyReplayPort["replay"]>[0]) {
      const replay = replayVerificationPolicy({
        policyVersion: input.policyVersion,
        policyBytes: input.policyBytes,
        recordedPolicyInputsBytes: input.recordedPolicyInputsBytes,
      });
      return { outcome: replay.outcome, decision: replay.decision };
    },
  });
}

export async function replayVerificationAudit(
  bundle: VerificationAuditBundle,
  options: {
    readonly artifactResolver: TrustedArtifactResolver;
    readonly runtimePrincipals: RuntimePrincipalBinding;
    readonly semanticReplay?: VerificationSemanticReplayPort;
    readonly selectorResolvers?: readonly DeterministicSelectorResolver[];
    readonly isProjectionLineageAdmitted?: DeterministicVerificationOptions["isProjectionLineageAdmitted"];
    readonly signatureVerifier?: AuditBundleSignatureVerifier;
  },
) {
  return replayAuditBundle(bundle, {
    ...options,
    policyReplay: createOfflineVerificationPolicyReplayPort(),
  });
}

/** Revalidate retained native admission envelopes; never rerun the parser. */
export async function replayVerificationMetricAudit(bundle: VerificationAuditBundle, options: {
  artifactResolver: TrustedArtifactResolver;
  runtimePrincipals: RuntimePrincipalBinding;
  profileArtifactId: string;
  admission: Pick<VerificationAdmissionService,"hydrateAdmittedProjection">;
}) {
  if(!(await inspectAuditBundle(bundle)).valid)throw new Error("VERIFICATION_METRIC_REPLAY_AUDIT_INVALID");
  if(bundle.verificationBundle.assertions.length||!bundle.verificationBundle.metricObservations.length)throw new Error("VERIFICATION_METRIC_REPLAY_METRICS_REQUIRED");
  const profileArtifact=bundle.manifest.inputArtifacts.find(item=>item.artifactId===options.profileArtifactId);
  if(!profileArtifact)throw new Error("VERIFICATION_METRIC_REPLAY_PROFILE_NOT_RETAINED");
  await options.artifactResolver.authorizeArtifact({tenantId:bundle.tenantId,artifactId:profileArtifact.artifactId,purpose:"verification_replay"});
  const profileBytes=await options.artifactResolver.hydrateRegisteredArtifact({tenantId:bundle.tenantId,artifactId:profileArtifact.artifactId});
  if(digestCanonicalJson(profileBytes.registration)!==digestCanonicalJson(profileArtifact)
    ||sha256Digest(profileBytes.bytes)!==profileArtifact.digest||profileBytes.bytes.byteLength!==profileArtifact.byteLength)throw new Error("VERIFICATION_METRIC_REPLAY_PROFILE_MISMATCH");
  const profile=VerificationMetricProfileSchema.parse(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(profileBytes.bytes)));
  if(profile.captureIds.length!==bundle.verificationBundle.captures.length
    ||bundle.verificationBundle.captures.some(item=>!profile.captureIds.includes(item.captureId)))throw new Error("VERIFICATION_METRIC_REPLAY_CAPTURE_SET_MISMATCH");
  if(profile.observations.digest!==digestCanonicalJson(bundle.verificationBundle)
    || !bundle.manifest.inputArtifacts.some(item=>item.artifactId===profile.observations.artifactId&&item.digest===profile.observations.digest))throw new Error("VERIFICATION_METRIC_REPLAY_OBSERVATIONS_MISMATCH");
  const retained=(artifact:unknown)=>bundle.manifest.inputArtifacts.some(item=>digestCanonicalJson(item)===digestCanonicalJson(artifact));
  const admitted=new Set<string>();
  const replayedIds=new Set([profileArtifact.artifactId]);
  for(const capture of bundle.verificationBundle.captures){
    if(!capture.canonicalProjectionArtifact)continue;
    const edge=profile.projectionAdmissions.find(item=>item.captureId===capture.captureId&&item.projectionArtifactId===capture.canonicalProjectionArtifact!.artifactId);
    if(!edge||!bundle.manifest.inputArtifacts.some(item=>item.artifactId===edge.transformationArtifactId))throw new Error("VERIFICATION_METRIC_REPLAY_ENVELOPE_NOT_RETAINED");
    const {receipt}=await options.admission.hydrateAdmittedProjection({tenantId:bundle.tenantId,captureId:capture.captureId,
      expectedSourceArtifact:{artifactId:capture.contentArtifact.artifactId,digest:capture.contentArtifact.digest as `sha256:${string}`},
      transformationArtifactId:edge.transformationArtifactId,projectionArtifactId:edge.projectionArtifactId});
    for(const artifact of [receipt.sourceArtifact,receipt.projectionArtifact,receipt.transformationArtifact,receipt.nativeOutputArtifact]){
      if(!retained(artifact))throw new Error("VERIFICATION_METRIC_REPLAY_ADMISSION_NOT_RETAINED");
      replayedIds.add(artifact.artifactId);
    }
    admitted.add(digestCanonicalJson({captureId:receipt.captureId,sourceArtifact:receipt.sourceArtifact,projectionArtifact:receipt.projectionArtifact}));
  }
  const result=await replayVerificationAudit(bundle,{artifactResolver:options.artifactResolver,runtimePrincipals:options.runtimePrincipals,
    selectorResolvers:[projectionSelectorResolver],isProjectionLineageAdmitted:binding=>admitted.has(digestCanonicalJson(binding))});
  return {...result,replayedArtifactIds:[...new Set([...result.replayedArtifactIds,...replayedIds])].sort()};
}
