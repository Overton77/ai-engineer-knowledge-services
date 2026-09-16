import { VerificationReportLedgerSchema, type OperationContext, type VerificationArtifactHandle, type VerificationBundle } from "@aiengineer/knowledge-contracts";
import { canonicalizeJson, sha256Digest, type RuntimePrincipalBinding } from "@aiengineer/knowledge-verification";
import { describe, expect, it } from "vitest";
import { VerificationClaimsApplicationService, VerificationClaimsProjectionGrantCatalog } from "./verification-claims.js";

const tenantId = "11111111-1111-4111-8111-111111111111";
const assertionId = "22222222-2222-4222-8222-222222222222";
const sourceId = "33333333-3333-4333-8333-333333333333";
type PrototypeFixture = { prototypeClaimInput(): { bundle: VerificationBundle; artifacts: readonly { artifactId: string; content: string | Uint8Array }[] }; runtimePrincipals: RuntimePrincipalBinding };
const fixtureUrl = new URL("../../../../verification/src/deterministic/testing/prototype-parity.fixture.js", import.meta.url).href;
const context = (): OperationContext => ({ contractVersion: "v1", tenantId, operationId: "44444444-4444-4444-8444-444444444444", attemptId: "55555555-5555-4555-8555-555555555555", correlationId: "claims-test", actor: { kind: "service", id: "66666666-6666-4666-8666-666666666666", serviceIdentity: "knowledge_worker" }, capabilityVersion: "verification.v1", idempotencyKey: "claims-test-key", reason: "claims fixture" });
function handle(id: string, bytes: Uint8Array): VerificationArtifactHandle { return { artifactId: id, tenantId, digest: sha256Digest(bytes), mediaType: "application/json", byteLength: bytes.byteLength, objectKey: `test/${id}`, createdAt: "2026-09-06T00:00:00.000Z", producerActivityId: "test", producerVersion: "1", encryptionClass: "managed", retentionClass: "test", dataClassification: "internal", parentArtifactIds: [] }; }

describe("verification claims application", () => {
  it("hydrates full registered evidence and rejects self-verification from server-owned identity", async () => {
    const { prototypeClaimInput, runtimePrincipals } = await import(fixtureUrl) as PrototypeFixture;
    const input = prototypeClaimInput(); const bundle = structuredClone(input.bundle);
    bundle.assertions[0]!.kind = "claim"; bundle.assertions[0]!.claimType = "other";
    const sourceBytes = new TextEncoder().encode(String(input.artifacts[0]!.content));
    bundle.captures[0]!.contentArtifact = handle(sourceId, sourceBytes);
    const claimsBytes = new TextEncoder().encode(JSON.stringify({ schemaVersion: "verification-claims-artifact.v1", bundle }));
    const claims = handle(assertionId, claimsBytes);
    const records = new Map([[sourceId, { registration: bundle.captures[0]!.contentArtifact, bytes: sourceBytes }], [assertionId, { registration: claims, bytes: claimsBytes }]]);
    const service = new VerificationClaimsApplicationService({ artifactResolver: { authorizeArtifact: async () => undefined, hydrateRegisteredArtifact: async ({ artifactId }) => records.get(artifactId)! }, captures: { async getRegisteredCapture() { return { source: bundle.sources[0]!, capture: bundle.captures[0]! }; } }, runtimePrincipals: { async bind() { return { producerAttemptId: bundle.producer.attemptId, runtimePrincipals: { ...runtimePrincipals, verifierDeploymentId: runtimePrincipals.producerDeploymentId, verifierPrincipalDigest: runtimePrincipals.producerPrincipalDigest } }; } } });
    const result = await service.verifyClaims({ verificationContractVersion: "verification.v1", captureIds: [bundle.captures[0]!.captureId], assertions: { artifactId: assertionId, digest: claims.digest } }, context());
    expect(result.mode).toBe("deterministic_only");
    expect(result.runtimePrincipals).toEqual(expect.objectContaining({ basis: "runtime_principal_binding", producerDeploymentId: runtimePrincipals.producerDeploymentId, verifierDeploymentId: runtimePrincipals.producerDeploymentId }));
    expect(Object.keys(result)).not.toContain("runtimePrincipals");
    expect(JSON.stringify(result)).not.toContain("producerPrincipalDigest");
    expect(result.deterministicResult.summary.failedCheckCodes).toContain("PRODUCER_VERIFIER_INDEPENDENT");
    expect(service.prepareSemanticCases(result,context())).toEqual([]);
    const batch=await service.gradePreparedSemantics(result,context(),async()=>{throw new Error("MECHANICAL_FAILURE_MUST_NOT_CREATE_JUDGE");});expect(batch.assessments).toEqual([]);
  });

  it("does not hydrate a caller-selected artifact when its registered digest differs", async () => {
    const bytes = new TextEncoder().encode("not a claims artifact"); const registration = handle(assertionId, bytes);
    const service = new VerificationClaimsApplicationService({ artifactResolver: { authorizeArtifact: async () => undefined, hydrateRegisteredArtifact: async () => ({ registration, bytes }) }, captures: { async getRegisteredCapture() { throw new Error("must not read"); } }, runtimePrincipals: { async bind() { throw new Error("must not bind"); } } });
    await expect(service.verifyClaims({ verificationContractVersion: "verification.v1", captureIds: ["capture-1"], assertions: { artifactId: assertionId, digest: `sha256:${"a".repeat(64)}` } }, context())).rejects.toThrow("VERIFICATION_CLAIMS_ARTIFACT_REGISTRATION_MISMATCH");
  });

  it("reconciles a native projection against the registered base capture and still requires its exact admission envelope", async () => {
    const { prototypeClaimInput, runtimePrincipals } = await import(fixtureUrl) as PrototypeFixture;
    const input = prototypeClaimInput(); const bundle = structuredClone(input.bundle);
    bundle.assertions[0]!.kind = "claim"; bundle.assertions[0]!.claimType = "other";
    const sourceBytes = new TextEncoder().encode(String(input.artifacts[0]!.content));
    const source = handle(sourceId, sourceBytes);
    const projectionBytes = new TextEncoder().encode(canonicalizeJson({ kind: "html_dom", document: { tag: "p", text: "registered projection" } }));
    const projection = { ...handle("77777777-7777-4777-8777-777777777777", projectionBytes), mediaType: "application/vnd.aiengineer.verification-projection.html_dom+json" };
    bundle.captures[0] = { ...bundle.captures[0]!, contentArtifact: source, canonicalProjectionArtifact: projection };
    const claimsBytes = new TextEncoder().encode(canonicalizeJson({ schemaVersion: "verification-claims-artifact.v1", bundle }));
    const claims = handle(assertionId, claimsBytes);
    const records = new Map([[source.artifactId, { registration: source, bytes: sourceBytes }], [projection.artifactId, { registration: projection, bytes: projectionBytes }], [claims.artifactId, { registration: claims, bytes: claimsBytes }]]);
    const { canonicalProjectionArtifact: _projection, ...baseCapture } = bundle.captures[0];
    const transformationArtifactId = "88888888-8888-4888-8888-888888888888";
    let admittedProjection = projection;
    let admittedCaptureId = bundle.captures[0]!.captureId;
    const service = new VerificationClaimsApplicationService({
      artifactResolver: { authorizeArtifact: async () => undefined, hydrateRegisteredArtifact: async ({ artifactId }) => records.get(artifactId)! },
      captures: { async getRegisteredCapture() { return { source: bundle.sources[0]!, capture: baseCapture }; } },
      runtimePrincipals: { async bind() { return { producerAttemptId: bundle.producer.attemptId, runtimePrincipals }; } },
      projectionGrants: new VerificationClaimsProjectionGrantCatalog([{ tenantId, assertions: { artifactId: claims.artifactId, digest: claims.digest }, admissions: [{ captureId: bundle.captures[0]!.captureId, projectionArtifactId: projection.artifactId, transformationArtifactId }] }]),
      nativeProjectionAdmission: { async hydrateAdmittedProjection() { return { receipt: { captureId: admittedCaptureId, sourceArtifact: source, projectionArtifact: admittedProjection } }; } },
    });
    const request = { verificationContractVersion: "verification.v1", captureIds: [bundle.captures[0]!.captureId], assertions: { artifactId: claims.artifactId, digest: claims.digest } };
    const result = await service.verifyClaims(request, context());
    expect(result.deterministicResult.captureChecks).toEqual(expect.arrayContaining([expect.objectContaining({ code: "PROJECTION_LINEAGE_BOUND", status: "passed" })]));
    admittedCaptureId = "hostile-capture";
    await expect(service.verifyClaims(request, context())).rejects.toThrow("VERIFICATION_CLAIMS_PROJECTION_ADMISSION_MISMATCH");
    admittedCaptureId = bundle.captures[0]!.captureId;
    admittedProjection = { ...projection, digest: sha256Digest("drift") };
    await expect(service.verifyClaims(request, context())).rejects.toThrow("VERIFICATION_CLAIMS_PROJECTION_ADMISSION_MISMATCH");
  });

  it("hydrates the report and ledger through a single-use trusted resolver without overlapping authorization tickets", async () => {
    const { prototypeClaimInput, runtimePrincipals } = await import(fixtureUrl) as PrototypeFixture;
    const input = prototypeClaimInput(); const bundle = structuredClone(input.bundle);
    const reportText = bundle.assertions[0]!.proposition ?? "Prototype verification assertion";
    const reportBytes = new TextEncoder().encode(reportText);
    const report = { ...handle("99999999-9999-4999-8999-999999999999", reportBytes), mediaType: "text/markdown" };
    bundle.assertions[0] = { ...bundle.assertions[0]!, kind: "report_assertion", outputArtifactId: report.artifactId, outputRange: { start: 0, end: reportText.length } };
    const ledgerValue = VerificationReportLedgerSchema.parse({
      schemaVersion: "verification-report-ledger.v1",
      reportArtifact: report,
      bundle,
      assertions: [{ assertion: bundle.assertions[0], exactText: reportText, start: 0, end: reportText.length, citationRequired: false, claimWeight: 1, severity: "medium", citations: [], requiredQualifiers: [] }],
    });
    const ledgerBytes = new TextEncoder().encode(canonicalizeJson(ledgerValue));
    const ledger = handle("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", ledgerBytes);
    const sourceBytes = new TextEncoder().encode(String(input.artifacts[0]!.content));
    const source = bundle.captures[0]!.contentArtifact;
    const records = new Map([[source.artifactId, { registration: source, bytes: sourceBytes }], [report.artifactId, { registration: report, bytes: reportBytes }], [ledger.artifactId, { registration: ledger, bytes: ledgerBytes }]]);
    let ticket: string | undefined;
    const service = new VerificationClaimsApplicationService({
      artifactResolver: {
        async authorizeArtifact({ artifactId }) { if (ticket) throw new Error("ARTIFACT_AUTHORIZATION_ALREADY_PENDING"); ticket = artifactId; },
        async hydrateRegisteredArtifact({ artifactId }) { if (ticket !== artifactId) throw new Error("ARTIFACT_HYDRATION_NOT_AUTHORIZED"); ticket = undefined; return records.get(artifactId)!; },
      },
      captures: { async getRegisteredCapture() { return { source: bundle.sources[0]!, capture: bundle.captures[0]! }; } },
      runtimePrincipals: { async bind() { return { producerAttemptId: bundle.producer.attemptId, runtimePrincipals }; } },
    });
    const result = await service.verifyReport({ verificationContractVersion: "verification.v1", captureIds: [bundle.captures[0]!.captureId], report: { artifactId: report.artifactId, digest: report.digest }, claimLedger: { artifactId: ledger.artifactId, digest: ledger.digest } }, context());
    expect(result.reportArtifact).toEqual(report);
    expect(ticket).toBeUndefined();
  });
});

it("hands only original mechanically verified selections to semantic grading", async () => {
 const { prototypeClaimInput, runtimePrincipals } = await import(fixtureUrl) as PrototypeFixture;
 const fixture=prototypeClaimInput(), bundle=structuredClone(fixture.bundle);
 const source=bundle.captures[0]!.contentArtifact, sourceBytes=new TextEncoder().encode(String(fixture.artifacts[0]!.content));
 const bytes=new TextEncoder().encode(canonicalizeJson({schemaVersion:"verification-claims-artifact.v1",bundle}));
 const claims=handle("99999999-9999-4999-8999-999999999999",bytes);
 const records=new Map([[source.artifactId,{registration:source,bytes:sourceBytes}],[claims.artifactId,{registration:claims,bytes}]]);
 const service=new VerificationClaimsApplicationService({artifactResolver:{async authorizeArtifact(){},async hydrateRegisteredArtifact({artifactId}){return records.get(artifactId)!;}},captures:{async getRegisteredCapture(){return {source:bundle.sources[0]!,capture:bundle.captures[0]!};}},runtimePrincipals:{async bind(){return {runtimePrincipals,producerAttemptId:bundle.producer.attemptId};}}});
 const result=await service.verifyClaims({verificationContractVersion:"verification.v1",captureIds:["capture-1"],assertions:{artifactId:claims.artifactId,digest:claims.digest}},context());
 expect(result.deterministicResult.status).toBe("passed");
 sourceBytes.fill(0);
 const cases=service.prepareSemanticCases(result,context());expect(cases).toHaveLength(1);expect(cases[0]!.fragments[0]!.exactText).toBe("RAG was basically just a hack");
 expect(()=>service.prepareSemanticCases(structuredClone(result),context())).toThrow("VERIFICATION_SEMANTIC_PREPARATION_REQUIRED");
 expect(()=>service.prepareSemanticCases(result,{...context(),operationId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"})).toThrow("VERIFICATION_SEMANTIC_PREPARATION_REQUIRED");
 const identity={deploymentId:"independent-judge",provider:"fixture",family:"fixture",model:"fixture",capability:"llm_evidence_rubric" as const,graderVersion:"evidence-only.v1",promptDigest:sha256Digest("prompt"),outputSchemaDigest:sha256Digest("output"),configurationDigest:sha256Digest("config")};
 let calls=0;
 const adapter={identity,maximumInputCharacters:64000,toolCatalog:[] as const,async judge(){calls++;return {schemaVersion:"verification-semantic-judge.v1",assertionId:"claim-1",verdict:"directly_supported",nliLabel:"entailed",supportingFragmentIds:[cases[0]!.fragments[0]!.fragmentId],contradictingFragmentIds:[],unsupportedFacets:[],qualifiersPreserved:true,publicRationale:"Exact retained quote."};}};
 await expect(service.gradePreparedSemantics(result,context(),async()=>({primary:{...adapter,identity:{...identity,deploymentId:bundle.producer.deploymentId}}}))).rejects.toThrow("SEMANTIC_PRODUCER_VERIFIER_COLLISION");expect(calls).toBe(0);
 const batch=await service.gradePreparedSemantics(result,context(),async()=>({primary:adapter}));expect(calls).toBe(1);expect(batch.assessments[0]!.verdict).toBe("directly_supported");
 service.assertSemanticAssessmentBatch(result,context(),batch);
 expect(()=>service.assertSemanticAssessmentBatch(result,context(),structuredClone(batch))).toThrow("VERIFICATION_SEMANTIC_BATCH_REQUIRED");
 batch.assessments[0]!.reasonCodes.push("TAMPERED");
 expect(()=>service.assertSemanticAssessmentBatch(result,context(),batch)).toThrow("VERIFICATION_SEMANTIC_BATCH_REQUIRED");
 result.deterministicResult.summary.failedCheckCodes.push("TAMPERED");
 expect(()=>service.prepareSemanticCases(result,context())).toThrow("VERIFICATION_SEMANTIC_PREPARATION_REQUIRED");
});

async function inconsistentReportFixture(invalidPointer = false) {
 const { prototypeClaimInput, runtimePrincipals } = await import(fixtureUrl) as PrototypeFixture;
 const fixture=prototypeClaimInput(), bundle=structuredClone(fixture.bundle), first=bundle.assertions[0]!, exact=first.proposition;
 if(!exact)throw new Error("REPORT_DIAGNOSTIC_TEST_PROPOSITION_REQUIRED");
 const source=bundle.captures[0]!.contentArtifact, sourceBytes=new TextEncoder().encode(String(fixture.artifacts[0]!.content));
 const reportText=`${exact}\n${exact}`, reportBytes=new TextEncoder().encode(reportText), report=handle("abababab-abab-4bab-8bab-abababababab",reportBytes);
 report.mediaType="text/markdown";
 bundle.assertions=[
  {...first,kind:"report_assertion",outputArtifactId:report.artifactId,outputRange:{start:0,end:exact.length}},
  {...first,assertionId:"claim-2",evidence:first.evidence.map(edge=>({...edge,evidenceId:"claim-2:e0"})),kind:"report_assertion",outputArtifactId:report.artifactId,outputRange:{start:exact.length+1+(invalidPointer?1:0),end:reportText.length+(invalidPointer?1:0)}},
 ];
 const assertions=bundle.assertions.map((assertion,index)=>({assertion,exactText:exact,start:index===0?0:exact.length+1+(invalidPointer?1:0),end:index===0?exact.length:reportText.length+(invalidPointer?1:0),citationRequired:false,claimWeight:1,severity:"medium" as const,citations:[],requiredQualifiers:[],consistencyKey:"prototype-conflict",consistencyFacet:"number" as const,contextKey:"same-context",normalizedValue:index===0?"one":"two"}));
 const ledgerBytes=new TextEncoder().encode(canonicalizeJson(VerificationReportLedgerSchema.parse({schemaVersion:"verification-report-ledger.v1",reportArtifact:report,bundle,assertions}))),ledger=handle("cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd",ledgerBytes);
 const records=new Map([[source.artifactId,{registration:source,bytes:sourceBytes}],[report.artifactId,{registration:report,bytes:reportBytes}],[ledger.artifactId,{registration:ledger,bytes:ledgerBytes}]]);
 const service=new VerificationClaimsApplicationService({artifactResolver:{async authorizeArtifact(){},async hydrateRegisteredArtifact({artifactId}){return records.get(artifactId)!;}},captures:{async getRegisteredCapture(){return {source:bundle.sources[0]!,capture:bundle.captures[0]!};}},runtimePrincipals:{async bind(){return {runtimePrincipals,producerAttemptId:bundle.producer.attemptId};}}});
 const result=await service.verifyReport({verificationContractVersion:"verification.v1",captureIds:[bundle.captures[0]!.captureId],report:{artifactId:report.artifactId,digest:report.digest},claimLedger:{artifactId:ledger.artifactId,digest:ledger.digest}},context());
 return {service,result};
}

it("authorizes diagnostic-only cases for a custody-valid inconsistent report and rejects pointer or result forgery", async () => {
 const valid=await inconsistentReportFixture();
 expect(valid.result.deterministicResult.status).toBe("failed");
 expect(valid.result.deterministicResult.summary.failedCheckCodes).toEqual(["REPORT_CROSS_SECTION_CONSISTENCY","REPORT_INTERNAL_CONTRADICTION_FREE"]);
 expect(valid.service.prepareSemanticCases(valid.result,context())).toEqual([]);
 const diagnostic=valid.service.prepareReportDiagnosticSemanticCases(valid.result,context());
 expect(diagnostic).toHaveLength(2); expect(diagnostic.every(item=>item.diagnosticOnly&&item.baseDeterministicDigest!==item.finalDeterministicDigest)).toBe(true);
 const ordinaryBatch=await valid.service.gradePreparedSemantics(valid.result,context(),async()=>{throw new Error("REPORT_FAILURE_MUST_NOT_ADMIT_DIAGNOSTIC_CASES");});
 expect(ordinaryBatch.assessments).toEqual([]);
 expect(()=>valid.service.assertSemanticAssessmentBatch(valid.result,context(),{...ordinaryBatch,assessments:diagnostic} as never)).toThrow("VERIFICATION_SEMANTIC_BATCH_REQUIRED");
 expect(()=>valid.service.prepareReportDiagnosticSemanticCases(valid.result,{...context(),operationId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"})).toThrow("VERIFICATION_REPORT_DIAGNOSTIC_PREPARATION_REQUIRED");
 expect(()=>valid.service.prepareReportDiagnosticSemanticCases(structuredClone(valid.result),context())).toThrow("VERIFICATION_REPORT_DIAGNOSTIC_PREPARATION_REQUIRED");
 valid.result.deterministicResult.summary.failedCheckCodes.push("TAMPERED");
 expect(()=>valid.service.prepareReportDiagnosticSemanticCases(valid.result,context())).toThrow("VERIFICATION_REPORT_DIAGNOSTIC_PREPARATION_REQUIRED");
 await expect(inconsistentReportFixture(true)).rejects.toThrow("REPORT_ASSERTION_RANGE_INVALID");
});
