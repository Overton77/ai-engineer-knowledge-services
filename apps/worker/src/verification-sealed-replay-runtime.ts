import { replayVerificationMetricAudit, type VerificationAdmissionService, type VerificationMetricProfileCatalog, type VerificationMetricRuntimePrincipalPort } from "@aiengineer/knowledge-application";
import type { OperationContext } from "@aiengineer/knowledge-contracts";
import type { PostgresVerificationRepository } from "@aiengineer/knowledge-persistence";

/** Bind replay to canonical historical ownership and current server profile grants. */
export function createVerificationSealedMetricReplay(dependencies:{
  repository:PostgresVerificationRepository;
  runtimePrincipals:VerificationMetricRuntimePrincipalPort;
  profiles:VerificationMetricProfileCatalog;
  admission:Pick<VerificationAdmissionService,"hydrateAdmittedProjection">;
}){
  return async(input:{tenantId:string;runId:string;context:OperationContext})=>{
    if(input.tenantId!==input.context.tenantId)throw new Error("VERIFICATION_REPLAY_TENANT_MISMATCH");
    const binding=await dependencies.repository.loadVerificationRunReplayBinding(input.tenantId,input.runId);
    if(!binding)throw new Error("SEALED_REPLAY_RUN_NOT_FOUND");
    if(input.context.missionId!==binding.missionId)throw new Error("VERIFICATION_REPLAY_MISSION_MISMATCH");
    const audit=await dependencies.repository.loadAuditBundle(input.tenantId,input.runId);
    const grant=dependencies.profiles.profileFor(binding.bundleArtifact);
    const retainedProfile=audit.manifest.inputArtifacts.find(item=>item.artifactId===grant.profileArtifact.artifactId);
    if(retainedProfile?.digest!==grant.profileArtifact.digest)throw new Error("VERIFICATION_REPLAY_PROFILE_GRANT_DRIFT");
    const identity=await dependencies.runtimePrincipals.bind({context:{...input.context,operationId:binding.operationId,
      missionId:binding.missionId,workItemId:binding.workItemId,attemptId:binding.verifierAttemptId},
      observationsArtifact:binding.bundleArtifact,captureIds:audit.verificationBundle.captures.map(item=>item.captureId)});
    const result=await replayVerificationMetricAudit(audit,{artifactResolver:dependencies.repository.createTrustedArtifactResolver(),
      runtimePrincipals:identity.runtimePrincipals,profileArtifactId:grant.profileArtifact.artifactId,admission:dependencies.admission});
    return {runId:input.runId,manifestDigest:audit.manifest.canonicalization.manifestDigest,
      deterministicResultDigest:result.deterministicResultDigest,policyOutcome:result.policyOutcome,replayedArtifactIds:result.replayedArtifactIds};
  };
}
