import { describe,expect,it } from "vitest";
import { VerificationAuditInspectionOperationResultSchema,VerificationAuditInspectionResourceSchema } from "./audit-inspection.js";

describe("audit inspection contracts",()=>{
  it("keeps the public read projection strict and free of Storage coordinates",()=>{const schema=VerificationAuditInspectionResourceSchema;expect(schema.safeParse({verificationContractVersion:"verification.v1",tenantId:"00000000-0000-4000-8000-000000000001",operationId:"00000000-0000-4000-8000-000000000002",requestDigest:`sha256:${"a".repeat(64)}`,resultArtifact:{artifactId:"00000000-0000-4000-8000-000000000003",digest:`sha256:${"b".repeat(64)}`},output:{}}).success).toBe(false);expect(()=>schema.parse({...schema.partial().parse({}),objectKey:"private"})).toThrow();});
  it("requires a full internal result handle on the durable receipt",()=>{expect(VerificationAuditInspectionOperationResultSchema.safeParse({schemaVersion:"verification-operation-result.v1",operationId:"00000000-0000-4000-8000-000000000002",useCase:"inspectAuditBundle",requestDigest:`sha256:${"a".repeat(64)}`,output:{},resultArtifact:{artifactId:"00000000-0000-4000-8000-000000000003",digest:`sha256:${"b".repeat(64)}`}}).success).toBe(false);});
});
