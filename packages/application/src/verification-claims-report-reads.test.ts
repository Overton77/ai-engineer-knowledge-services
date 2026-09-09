import { describe, expect, it, vi } from "vitest";
import { VerificationClaimsReportReadError, VerificationClaimsReportReadService, type VerifiedClaimsReportReadPort } from "./verification-claims-report-reads.js";

const id = "00000000-0000-4000-8000-000000000001";
const otherId = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12,"0")}`;
const digest = (value: string) => `sha256:${value.repeat(64)}` as const;
const artifact = (suffix: number) => ({ artifactId: otherId(suffix), tenantId: id, digest: digest(String(suffix % 10)), mediaType: "application/json", byteLength: 2, objectKey: `private/${suffix}`, createdAt: "2026-09-07T00:00:00.000Z", producerActivityId: "fixture", producerVersion: "fixture.v1", encryptionClass: "managed", retentionClass: "verification-audit", dataClassification: "restricted" as const, parentArtifactIds: [] });
const deterministic = { verificationContractVersion: "verification.v1" as const, status: "failed" as const, semanticEligibility: false, deploymentSeparation: { status: "established" as const, basis: "runtime_principal_binding" as const, producerDeploymentId: "producer", verifierDeploymentId: "verifier" }, captureChecks: [], assertions: [], metrics: [], summary: { capturesTotal: 1, capturesPassed: 1, assertionsTotal: 1, assertionsPassed: 1, metricsTotal: 0, metricsPassed: 0, failedCheckCodes: ["REPORT_REQUIRED_QUALIFIERS_PRESERVED"], reviewReasons: ["REPORT_CITATION_SEMANTICS_UNASSESSED"] } };
describe("VerificationClaimsReportReadService", () => {
  it("rejects malformed identity before the repository", async () => {
    const port: VerifiedClaimsReportReadPort = { loadVerifiedClaimsReport: vi.fn() };
    await expect(new VerificationClaimsReportReadService(port).getTerminal({ tenantId: "bad", operationId: id })).rejects.toMatchObject({ code: "INVALID" });
    expect(port.loadVerifiedClaimsReport).not.toHaveBeenCalled();
  });
  it("maps nonterminal states without exposing a raw terminal body", async () => {
    const port: VerifiedClaimsReportReadPort = { loadVerifiedClaimsReport: vi.fn(async () => ({ state: "pending" as const, result: { raw: "must-not-be-returned" } })) };
    await expect(new VerificationClaimsReportReadService(port).getTerminal({ tenantId: id, operationId: id })).rejects.toEqual(expect.objectContaining<Partial<VerificationClaimsReportReadError>>({ code: "PENDING" }));
  });
  it("projects report mechanics as counts without exposing producer identifiers or locators", async () => {
    const ledger=artifact(2),report=artifact(3),manifest=artifact(4),resultArtifact=artifact(5),gate=artifact(6);
    const result={schemaVersion:"verification-operation-result.v1" as const,operationId:id,useCase:"verifyReport" as const,requestDigest:digest("a"),resultArtifact,output:{verified:{mode:"deterministic_only" as const,deterministicResult:deterministic,assertionsArtifact:ledger,producerAttemptId:otherId(7),sourceArtifacts:[artifact(8)],reportArtifact:report,claimLedgerArtifact:ledger,coverageScope:"producer_declared_assertions_only" as const,reportWide:{claimWeightedCitationCompleteness:0.5,citationCorrectness:null,validPointerConditionalCitationCorrectness:null,pointerFailures:["private-pointer"],misplacedCitationIds:["private-citation"],duplicateAssertionGroups:[["private-a","private-b"]],conflictAssertionGroups:[["private-c","private-d"]],missingQualifierAssertionIds:["private-e"],consistencyMismatchGroups:[["private-f","private-g"]],crossSectionMismatches:[{facet:"date" as const,assertionIds:["private-h","private-i"]}],independentSourceFamilyCount:1,distinctSourceFamilyCount:2,unsupportedHighSeverityAssertionIds:["private-j"]}},sealedRun:{runId:otherId(9),manifestDigest:digest("b"),policyOutcome:"fail" as const,manifestArtifact:manifest}}};
    const port:VerifiedClaimsReportReadPort={loadVerifiedClaimsReport:vi.fn(async()=>({state:"succeeded" as const,result,reportGateArtifact:gate,policyDecision:{outcome:"fail" as const,reasonCodes:["SEMANTIC_HARD_FAILURE","SEMANTIC_DISPOSITION_FAIL"]}}))};
    const resource=await new VerificationClaimsReportReadService(port).getTerminal({tenantId:id,operationId:id});
    expect(resource).toMatchObject({useCase:"verifyReport",sealedRun:{policy:{availability:"verified",outcome:"fail",reasonCodes:["SEMANTIC_HARD_FAILURE","SEMANTIC_DISPOSITION_FAIL"]}},output:{reportWide:{pointerFailureCount:1,misplacedCitationCount:1,duplicateAssertionGroupCount:1,unsupportedHighSeverityCount:1}}});
    const publicJson=JSON.stringify(resource);
    for(const forbidden of ["private-pointer","private-citation","private-a","private-j","objectKey","private/"])expect(publicJson).not.toContain(forbidden);
  });
  it("rejects a report gate returned for another tenant", async () => {
    const ledger=artifact(2),report=artifact(3),manifest=artifact(4),resultArtifact=artifact(5);
    const result={schemaVersion:"verification-operation-result.v1" as const,operationId:id,useCase:"verifyReport" as const,requestDigest:digest("a"),resultArtifact,output:{verified:{mode:"deterministic_only" as const,deterministicResult:deterministic,assertionsArtifact:ledger,producerAttemptId:otherId(7),sourceArtifacts:[artifact(8)],reportArtifact:report,claimLedgerArtifact:ledger,coverageScope:"producer_declared_assertions_only" as const,reportWide:{claimWeightedCitationCompleteness:1,citationCorrectness:null,validPointerConditionalCitationCorrectness:null,pointerFailures:[],misplacedCitationIds:[],duplicateAssertionGroups:[],conflictAssertionGroups:[],missingQualifierAssertionIds:[],consistencyMismatchGroups:[],crossSectionMismatches:[],independentSourceFamilyCount:0,distinctSourceFamilyCount:0,unsupportedHighSeverityAssertionIds:[]}},sealedRun:{runId:otherId(9),manifestDigest:digest("b"),policyOutcome:"fail" as const,manifestArtifact:manifest}}};
    const foreign={...artifact(6),tenantId:otherId(10)};
    const port:VerifiedClaimsReportReadPort={loadVerifiedClaimsReport:vi.fn(async()=>({state:"succeeded" as const,result,reportGateArtifact:foreign}))};
    await expect(new VerificationClaimsReportReadService(port).getTerminal({tenantId:id,operationId:id})).rejects.toMatchObject({code:"INTEGRITY"});
  });
  it("keeps an old terminal's unavailable policy evidence distinct from a verified quality failure", async () => {
    const assertions=artifact(2),manifest=artifact(4),resultArtifact=artifact(5);
    const result={schemaVersion:"verification-operation-result.v1" as const,operationId:id,useCase:"verifyClaims" as const,requestDigest:digest("a"),resultArtifact,output:{verified:{mode:"deterministic_only" as const,deterministicResult:deterministic,assertionsArtifact:assertions,producerAttemptId:otherId(7),sourceArtifacts:[artifact(8)]},sealedRun:{runId:otherId(9),manifestDigest:digest("b"),policyOutcome:"fail" as const,manifestArtifact:manifest}}};
    const resource=await new VerificationClaimsReportReadService({loadVerifiedClaimsReport:async()=>({state:"succeeded" as const,result})}).getTerminal({tenantId:id,operationId:id});
    expect(resource.sealedRun.policy).toEqual({availability:"unavailable"});
    await expect(new VerificationClaimsReportReadService({loadVerifiedClaimsReport:async()=>({state:"succeeded" as const,result,policyDecision:{outcome:"review" as const,reasonCodes:["SEMANTIC_HARD_FAILURE"]}})}).getTerminal({tenantId:id,operationId:id})).rejects.toMatchObject({code:"INTEGRITY"});
  });
});
