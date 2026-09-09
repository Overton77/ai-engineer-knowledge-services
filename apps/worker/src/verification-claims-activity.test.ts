import type { VerificationClaimsApplicationService, VerificationOperationRepositoryPort } from "@aiengineer/knowledge-application";
import type { CanonicalOperationRecord, LeasedStep } from "@aiengineer/knowledge-persistence";
import { sha256Digest } from "@aiengineer/knowledge-verification";
import { describe, expect, it, vi } from "vitest";
import { verificationClaimsActivityHandler } from "./verification-claims-activity.js";

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`,tenantId=id(1),operationId=id(2),attemptId=id(3),createdAt="2026-09-06T00:00:00.000Z";
const handle=(artifactId:string)=>({artifactId,tenantId,digest:sha256Digest(artifactId),mediaType:"application/json",byteLength:2,objectKey:`test/${artifactId}`,createdAt,producerActivityId:"fixture",producerVersion:"fixture.v1",encryptionClass:"managed",retentionClass:"test",dataClassification:"restricted" as const,parentArtifactIds:[]});
const assertions=handle(id(4)),source=handle(id(5)),manifest=handle(id(6)),result=handle(id(7));
const verified={mode:"deterministic_only" as const,deterministicResult:{verificationContractVersion:"verification.v1" as const,status:"failed" as const,semanticEligibility:false,deploymentSeparation:{status:"established" as const,basis:"runtime_principal_binding" as const,producerDeploymentId:"producer",verifierDeploymentId:"verifier"},captureChecks:[],assertions:[],metrics:[],summary:{capturesTotal:1,capturesPassed:1,assertionsTotal:0,assertionsPassed:0,metricsTotal:0,metricsPassed:0,failedCheckCodes:["MECHANICAL_FAILURE"],reviewReasons:[]}},assertionsArtifact:assertions,producerAttemptId:id(8),sourceArtifacts:[source]};
Object.defineProperty(verified,"runtimePrincipals",{value:Object.freeze({basis:"runtime_principal_binding" as const,producerDeploymentId:"producer",verifierDeploymentId:"verifier",producerPrincipalDigest:sha256Digest("producer-principal"),verifierPrincipalDigest:sha256Digest("verifier-principal")}),enumerable:false,configurable:false,writable:false});
const context={contractVersion:"v1" as const,tenantId,operationId,attemptId,missionId:id(9),workItemId:id(10),correlationId:"claims-activity",actor:{kind:"service" as const,id:id(11),serviceIdentity:"knowledge_worker" as const},capabilityVersion:"verification.v1",idempotencyKey:"claims-activity-key",reason:"test"};
const operation:CanonicalOperationRecord={id:operationId,tenantId,operationKind:"verification_claims",idempotencyKey:"claims-activity-key",requestSha256:"0".repeat(64),status:"running",rowVersion:1,createdAt,updatedAt:createdAt,ownershipMode:"mission_control",correlationId:"claims-activity",actorIdentity:id(11),request:{}};
const claim:LeasedStep={id:id(12),tenantId,operationId,stepKey:"verify_claims_and_register",stepKind:"verification_claims",inputSha256:"1".repeat(64),status:"running",attemptCount:1,maxAttempts:1,rowVersion:1,holderIdentity:"worker",leaseToken:"lease",fencingToken:7,expiresAt:"2026-09-06T01:00:00.000Z"};

describe("verification claims activity",()=>{
  it.each(["verification_claims", "verification_report"] as const)("rejects %s without retry or sealing when runtime separation is not established", async (operationKind) => {
    const rejected = { ...verified, deterministicResult: { ...verified.deterministicResult,
      deploymentSeparation: { ...verified.deterministicResult.deploymentSeparation, status: "not_established", verifierDeploymentId: "producer" },
      summary: { ...verified.deterministicResult.summary, failedCheckCodes: ["PRODUCER_VERIFIER_INDEPENDENT"] } } };
    const seal = vi.fn();
    const registerFencedContentAddressedArtifact = vi.fn();
    const service = { verifyClaims: vi.fn().mockResolvedValue(rejected), verifyReport: vi.fn().mockResolvedValue(rejected) } as unknown as VerificationClaimsApplicationService;
    const repository = { registerFencedContentAddressedArtifact } as unknown as VerificationOperationRepositoryPort & { registerFencedContentAddressedArtifact: typeof registerFencedContentAddressedArtifact };
    const handler = verificationClaimsActivityHandler({ service, repository, operations: { getOperationRecord: async () => operation }, storageBucket: "test", now: () => createdAt, sealer: { seal } }, operationKind);
    const report = operationKind === "verification_report";
    const request = { verificationContractVersion: "verification.v1", captureIds: ["capture-1"],
      ...(report ? { report: { artifactId: source.artifactId, digest: source.digest }, claimLedger: { artifactId: assertions.artifactId, digest: assertions.digest } }
        : { assertions: { artifactId: assertions.artifactId, digest: assertions.digest } }) };
    await expect(handler.execute({ operation, claim, activity: { schemaVersion: "knowledge-operation-request/v1", kind: operationKind,
      operationInput: { schemaVersion: "verification-service-request.v1", useCase: report ? "verifyReport" : "verifyClaims", request },
      expectedVersions: { verification: "verification.v1" }, context, step: { name: report ? "verify_report_and_register" : "verify_claims_and_register", ordinal: 0 } } }))
      .rejects.toMatchObject({ code: "PRODUCER_VERIFIER_INDEPENDENT", retryable: false });
    expect(seal).not.toHaveBeenCalled();
    expect(registerFencedContentAddressedArtifact).not.toHaveBeenCalled();
  });
  it("fences the terminal artifact and makes the exact sealed manifest an ancestor",async()=>{
    const registerFencedContentAddressedArtifact=vi.fn().mockResolvedValue(result);
    const repository={registerFencedContentAddressedArtifact} as unknown as VerificationOperationRepositoryPort&{registerFencedContentAddressedArtifact:typeof registerFencedContentAddressedArtifact};
    const service={verifyClaims:vi.fn().mockResolvedValue(verified)} as unknown as VerificationClaimsApplicationService;
    const handler=verificationClaimsActivityHandler({service,repository,operations:{getOperationRecord:async()=>operation},storageBucket:"test",now:()=>createdAt,sealer:{seal:async()=>({runId:id(13),manifestDigest:sha256Digest("manifest"),policyOutcome:"fail" as const,manifestArtifact:manifest})}},"verification_claims");
    const value=await handler.execute({operation,claim,activity:{schemaVersion:"knowledge-operation-request/v1",kind:"verification_claims",operationInput:{schemaVersion:"verification-service-request.v1",useCase:"verifyClaims",request:{verificationContractVersion:"verification.v1",captureIds:["capture-1"],assertions:{artifactId:assertions.artifactId,digest:assertions.digest}}},expectedVersions:{verification:"verification.v1"},context,step:{name:"verify_claims_and_register",ordinal:0}}});
    expect(value).toMatchObject({useCase:"verifyClaims",output:{sealedRun:{manifestArtifact:manifest}}});
    expect(JSON.stringify(value)).not.toContain("producerPrincipalDigest");
    expect(registerFencedContentAddressedArtifact).toHaveBeenCalledWith(expect.objectContaining({lease:{stepId:claim.id,leaseToken:claim.leaseToken,fencingToken:claim.fencingToken,holderIdentity:claim.holderIdentity},artifact:expect.objectContaining({parentArtifactIds:expect.arrayContaining([assertions.artifactId,manifest.artifactId])})}));
  });
});
