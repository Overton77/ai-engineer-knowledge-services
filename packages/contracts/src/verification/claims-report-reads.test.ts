import { describe,expect,it } from "vitest";
import { VerificationReportTerminalResourceSchema } from "./claims-report-reads.js";

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const digest=(value:string)=>`sha256:${value.repeat(64)}`;

describe("claims/report terminal resources",()=>{
  it("keeps report-wide output count-only and rejects producer identifiers or locators",()=>{
    const value={verificationContractVersion:"verification.v1",tenantId:id(1),operationId:id(2),useCase:"verifyReport",requestDigest:digest("a"),resultArtifact:{artifactId:id(3),digest:digest("b")},sealedRun:{runId:id(4),manifestDigest:digest("c"),manifestArtifact:{artifactId:id(5),digest:digest("d")},policyOutcome:"fail",policy:{availability:"verified",outcome:"fail",reasonCodes:["SEMANTIC_DISPOSITION_FAIL"]}},output:{mode:"deterministic_only",deterministic:{status:"failed",semanticEligibility:false,capturesTotal:1,capturesPassed:1,assertionsTotal:1,assertionsPassed:1,metricsTotal:0,metricsPassed:0,failedCheckCodes:["REPORT_REQUIRED_QUALIFIERS_PRESERVED"],reviewReasons:[]},assertionsArtifact:{artifactId:id(6),digest:digest("e")},reportArtifact:{artifactId:id(7),digest:digest("f")},claimLedgerArtifact:{artifactId:id(6),digest:digest("e")},reportWide:{claimWeightedCitationCompleteness:1,citationCorrectness:0,validPointerConditionalCitationCorrectness:0,pointerFailureCount:0,misplacedCitationCount:0,duplicateAssertionGroupCount:0,conflictAssertionGroupCount:0,missingQualifierCount:1,consistencyMismatchGroupCount:0,crossSectionMismatchCount:0,independentSourceFamilyCount:0,distinctSourceFamilyCount:1,unsupportedHighSeverityCount:0},coverageScope:"producer_declared_assertions_only",reportGateArtifact:{artifactId:id(8),digest:digest("1")}}};
    expect(VerificationReportTerminalResourceSchema.parse(value)).toEqual(value);
    expect(VerificationReportTerminalResourceSchema.safeParse({...value,output:{...value.output,reportWide:{...value.output.reportWide,missingQualifierAssertionIds:["private-claim"]}}}).success).toBe(false);
    expect(VerificationReportTerminalResourceSchema.safeParse({...value,output:{...value.output,reportArtifact:{...value.output.reportArtifact,objectKey:"private/report"}}}).success).toBe(false);
    expect(VerificationReportTerminalResourceSchema.safeParse({...value,sealedRun:{...value.sealedRun,policy:{availability:"verified",outcome:"fail",reasonCodes:["PRIVATE_REASON"]}}}).success).toBe(false);
    expect(VerificationReportTerminalResourceSchema.safeParse({...value,sealedRun:{...value.sealedRun,policy:{availability:"verified",outcome:"review",reasonCodes:["SEMANTIC_REVIEW_REQUIRED"]}}}).success).toBe(false);
  });
});
