import { VerificationArtifactHandleSchema, type VerificationArtifactHandle } from "@aiengineer/knowledge-contracts";
import { canonicalizeJson, inspectAuditBundle, sha256Digest, type AuditBundleSignatureVerifier, type TrustedArtifactResolver, type VerificationAuditBundle } from "@aiengineer/knowledge-verification";
import { deepFreeze } from "@aiengineer/knowledge-domain";

export const componentDriftDimensions=["provider","model","parser","grader","policy"] as const;
export type ComponentDriftDimension=typeof componentDriftDimensions[number];
type Components={provider:string;model:string;parser:string;grader:string;policy:string};
export interface SealedAuditBundleArtifact { readonly artifact:VerificationArtifactHandle; }
export interface VerificationComponentDriftObservation { readonly schemaVersion:"verification-component-drift-observation.v1"; readonly tenantId:string; readonly baseline:{readonly runId:string;readonly auditBundleArtifact:{readonly artifactId:string;readonly digest:`sha256:${string}`}}; readonly candidate:{readonly runId:string;readonly auditBundleArtifact:{readonly artifactId:string;readonly digest:`sha256:${string}`}}; readonly baselineComponents:Components;readonly candidateComponents:Components;readonly changedDimensions:readonly ComponentDriftDimension[];readonly payloadDigest:`sha256:${string}`; }

function components(bundle:VerificationAuditBundle):Components { const m=bundle.manifest;if(!m.provider||!m.versions.parser||!m.versions.grader)throw new Error("COMPONENT_DRIFT_MANIFEST_COMPONENTS_REQUIRED");return {provider:m.provider.endpointIdentity,model:m.provider.model,parser:m.versions.parser,grader:m.versions.grader,policy:m.versions.policy}; }
async function verified(input:SealedAuditBundleArtifact,resolver:TrustedArtifactResolver,verifier:AuditBundleSignatureVerifier){const artifact=structuredClone(VerificationArtifactHandleSchema.parse(input.artifact));await resolver.authorizeArtifact({tenantId:artifact.tenantId,artifactId:artifact.artifactId,purpose:"verification_replay"});const loaded=await resolver.hydrateRegisteredArtifact({tenantId:artifact.tenantId,artifactId:artifact.artifactId}),registered=VerificationArtifactHandleSchema.parse(loaded.registration),bytes=loaded.bytes.slice();if(canonicalizeJson(registered)!==canonicalizeJson(artifact)||artifact.digest!==sha256Digest(bytes)||artifact.byteLength!==bytes.byteLength)throw new Error("COMPONENT_DRIFT_AUDIT_ARTIFACT_BINDING_INVALID");const bundle=JSON.parse(new TextDecoder().decode(bytes)) as VerificationAuditBundle;const snapshot=structuredClone(bundle),inspection=await inspectAuditBundle(snapshot,verifier);if(!inspection.valid||inspection.signatureStatus!=="verified")throw new Error("COMPONENT_DRIFT_SIGNED_MANIFEST_REQUIRED");if(snapshot.tenantId!==artifact.tenantId)throw new Error("COMPONENT_DRIFT_AUDIT_ARTIFACT_BINDING_INVALID");return {artifact,bundle:snapshot,components:components(snapshot)};}
/** Produces registration-ready immutable bytes from two already-admitted, verified audit-manifest artifacts. */
export async function compareVerifiedComponentVersions(input: {
  readonly baseline: SealedAuditBundleArtifact;
  readonly candidate: SealedAuditBundleArtifact;
  readonly createResolver: () => TrustedArtifactResolver;
  readonly verifier: AuditBundleSignatureVerifier;
}): Promise<VerificationComponentDriftObservation> {
  // Clone caller data before the first asynchronous boundary; functions are trusted ports, not cloneable data.
  const snapshot = structuredClone({ baseline: input.baseline, candidate: input.candidate });
  const createResolver = input.createResolver, verifier = input.verifier;
  if (snapshot.baseline.artifact.tenantId !== snapshot.candidate.artifact.tenantId) throw new Error("COMPONENT_DRIFT_TENANT_MISMATCH");
  const [baseline, candidate] = await Promise.all([
    verified(snapshot.baseline, createResolver(), verifier),
    verified(snapshot.candidate, createResolver(), verifier),
  ]);
  const changedDimensions = componentDriftDimensions.filter(key => baseline.components[key] !== candidate.components[key]);
  const unsigned = {
    schemaVersion: "verification-component-drift-observation.v1" as const,
    tenantId: baseline.artifact.tenantId,
    baseline: { runId: baseline.bundle.manifest.runId, auditBundleArtifact: { artifactId: baseline.artifact.artifactId, digest: baseline.artifact.digest as `sha256:${string}` } },
    candidate: { runId: candidate.bundle.manifest.runId, auditBundleArtifact: { artifactId: candidate.artifact.artifactId, digest: candidate.artifact.digest as `sha256:${string}` } },
    baselineComponents: baseline.components, candidateComponents: candidate.components, changedDimensions,
  };
  return deepFreeze({ ...unsigned, payloadDigest: sha256Digest(canonicalizeJson(unsigned)) }) as VerificationComponentDriftObservation;
}
