import type { VerificationOperationRepositoryPort } from "@aiengineer/knowledge-application";
import type { CanonicalOperationRecord, LeasedStep } from "@aiengineer/knowledge-persistence";
import { sha256Digest } from "@aiengineer/knowledge-verification";
import { describe, expect, it, vi } from "vitest";
import { verificationAuditInspectionActivityHandler } from "./verification-audit-inspection-activity.js";

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`,tenantId=id(1),operationId=id(2),attemptId=id(3),createdAt="2026-09-07T12:00:00.000Z";
const audit={artifactId:id(4),digest:sha256Digest("audit")};
const output={schemaVersion:"verification-audit-inspection.v1",verificationContractVersion:"verification.v1",auditArtifact:{...audit,mediaType:"application/vnd.aiengineer.verification-run-manifest+json",sizeBytes:100},run:{runId:id(5),manifestId:id(6),manifestDigest:sha256Digest("manifest"),deterministicResultDigest:sha256Digest("result"),policyDecisionDigest:sha256Digest("policy"),policyOutcome:"review",startedAt:createdAt,completedAt:createdAt},proof:{payloadDigest:sha256Digest("payload"),signatureStatus:"verified",deterministicReplay:"exact",policyReplay:"exact",replayedArtifactCount:4,inputArtifactCount:2,outputArtifactCount:3}} as const;
const resultHandle={artifactId:id(7),tenantId,digest:sha256Digest("result-artifact"),mediaType:"application/vnd.aiengineer.verification-audit-inspection-result+json",byteLength:10,objectKey:"internal/result",createdAt,producerActivityId:"verification-service:inspectAuditBundle",producerVersion:"verification-service.v1",encryptionClass:"supabase-managed",retentionClass:"verification-audit",dataClassification:"restricted" as const,parentArtifactIds:[audit.artifactId],transformationSignature:sha256Digest("transformation")};
const context={contractVersion:"v1" as const,tenantId,operationId,attemptId,missionId:id(8),workItemId:id(9),correlationId:"audit-activity",actor:{kind:"service" as const,id:id(10),serviceIdentity:"knowledge_worker" as const},capabilityVersion:"verification.v1",idempotencyKey:"audit-activity-key",reason:"test"};
const operation:CanonicalOperationRecord={id:operationId,tenantId,operationKind:"verification_audit_bundle",idempotencyKey:context.idempotencyKey,requestSha256:"0".repeat(64),status:"running",rowVersion:1,createdAt,updatedAt:createdAt,ownershipMode:"mission_control",correlationId:context.correlationId,actorIdentity:id(10),request:{}};
const claim:LeasedStep={id:id(11),tenantId,operationId,stepKey:"inspect_audit_bundle_and_register",stepKind:"inspect_audit_bundle_and_register",inputSha256:"1".repeat(64),status:"running",attemptCount:1,maxAttempts:3,rowVersion:1,holderIdentity:"worker",leaseToken:"lease",fencingToken:7,expiresAt:"2026-09-07T13:00:00.000Z"};
const activity={schemaVersion:"knowledge-operation-request/v1" as const,kind:"verification_audit_bundle" as const,operationInput:{schemaVersion:"verification-service-request.v1" as const,useCase:"inspectAuditBundle" as const,request:{verificationContractVersion:"verification.v1" as const,auditBundle:audit}},expectedVersions:{verification:"verification.v1"},context,step:{name:"inspect_audit_bundle_and_register",ordinal:0}};

describe("verification audit inspection activity",()=>{
  it("validates the compact output before a lease-fenced result write",async()=>{
    const registerFencedContentAddressedArtifact=vi.fn().mockResolvedValue(resultHandle);
    const handler=verificationAuditInspectionActivityHandler({service:{inspect:vi.fn().mockResolvedValue(output)},repository:{registerFencedContentAddressedArtifact} as unknown as VerificationOperationRepositoryPort&{registerFencedContentAddressedArtifact:typeof registerFencedContentAddressedArtifact},operations:{getOperationRecord:async()=>operation},storageBucket:"ledger",now:()=>createdAt});
    const result=await handler.execute({operation,claim,activity});
    expect(result).toMatchObject({operationId,useCase:"inspectAuditBundle",output:{proof:{signatureStatus:"verified"}},resultArtifact:resultHandle});
    expect(registerFencedContentAddressedArtifact).toHaveBeenCalledWith(expect.objectContaining({lease:{stepId:claim.id,leaseToken:claim.leaseToken,fencingToken:claim.fencingToken,holderIdentity:claim.holderIdentity},artifact:expect.objectContaining({artifactType:"verification_audit_inspection_result",parentArtifactIds:[audit.artifactId]})}));
  });
  it("never writes malformed output or after cancellation",async()=>{
    const registerFencedContentAddressedArtifact=vi.fn();
    const repository={registerFencedContentAddressedArtifact} as unknown as VerificationOperationRepositoryPort&{registerFencedContentAddressedArtifact:typeof registerFencedContentAddressedArtifact};
    const malformed=verificationAuditInspectionActivityHandler({service:{inspect:vi.fn().mockResolvedValue({...output,proof:{...output.proof,signatureStatus:"unknown"}})},repository,operations:{getOperationRecord:async()=>operation},storageBucket:"ledger",now:()=>createdAt});
    await expect(malformed.execute({operation,claim,activity})).rejects.toMatchObject({code:"INVALID_VERIFICATION_AUDIT_INSPECTION_INPUT",retryable:false});
    const cancelled=verificationAuditInspectionActivityHandler({service:{inspect:vi.fn()},repository,operations:{getOperationRecord:async()=>({...operation,status:"cancelled"})},storageBucket:"ledger",now:()=>createdAt});
    await expect(cancelled.execute({operation,claim,activity})).rejects.toMatchObject({code:"VERIFICATION_AUDIT_INSPECTION_CANCELLED",retryable:false});
    expect(registerFencedContentAddressedArtifact).not.toHaveBeenCalled();
  });
  it("propagates a stale lease without retrying an unowned write",async()=>{
    const handler=verificationAuditInspectionActivityHandler({service:{inspect:vi.fn().mockResolvedValue(output)},repository:{registerFencedContentAddressedArtifact:vi.fn().mockRejectedValue(new Error("STALE_LEASE"))} as never,operations:{getOperationRecord:async()=>operation},storageBucket:"ledger",now:()=>createdAt});
    await expect(handler.execute({operation,claim,activity})).rejects.toMatchObject({code:"STALE_LEASE",retryable:false});
  });
});
