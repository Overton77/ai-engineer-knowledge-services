import { VerificationClaimsArtifactSchema, VerificationReportLedgerSchema, type Assertion, type VerificationArtifactHandle, type VerificationBenchmarkDataset, type VerificationBundle, type VerificationSource, type VerificationSourceCapture } from "@aiengineer/knowledge-contracts";
import { canonicalizeJson, projectionSelectorResolver, sha256Digest } from "@aiengineer/knowledge-verification";
import type { DiagnosticsReportCoverage } from "./verification-diagnostics-report-coverage.js";
import { VerificationClaimsProjectionGrantCatalog, type VerificationClaimsServiceDependencies } from "./verification-claims.js";

const id = (value: string) => { const h = sha256Digest(value).slice(7); return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`; };
/** Creates local, content-addressed engineering artifacts; never registers canonical DB state. */
export function buildDiagnosticsOfflineLedgers(input: { dataset: VerificationBenchmarkDataset; reports: readonly DiagnosticsReportCoverage[]; captures: readonly { source: VerificationSource; capture: VerificationSourceCapture }[]; artifacts: readonly { registration: VerificationArtifactHandle; bytes: Uint8Array }[] }) {
  input = structuredClone(input);
  const tenantId = input.captures[0]?.capture.contentArtifact.tenantId;
  if (!tenantId) throw new Error("DIAGNOSTICS_OFFLINE_LEDGER_TENANT_REQUIRED");
  if (new Set(input.captures.map(c=>c.capture.captureId)).size !== input.captures.length || new Set(input.artifacts.map(a=>a.registration.artifactId)).size !== input.artifacts.length) throw new Error("DIAGNOSTICS_OFFLINE_LEDGER_DUPLICATE_INPUT");
  for (const a of input.artifacts) if(a.registration.tenantId!==tenantId || a.registration.digest!==sha256Digest(a.bytes)||a.registration.byteLength!==a.bytes.length) throw new Error("DIAGNOSTICS_OFFLINE_LEDGER_INPUT_INTEGRITY");
  for (const c of input.captures) {
    if(c.capture.contentArtifact.tenantId!==tenantId || c.capture.sourceId!==c.source.sourceId || input.captures.some(other=>other.source.sourceId===c.source.sourceId&&canonicalizeJson(other.source)!==canonicalizeJson(c.source))) throw new Error("DIAGNOSTICS_OFFLINE_LEDGER_CAPTURE_BINDING");
    const registered=input.artifacts.find(a=>a.registration.artifactId===c.capture.contentArtifact.artifactId);
    if(!registered||canonicalizeJson(registered.registration)!==canonicalizeJson(c.capture.contentArtifact)) throw new Error("DIAGNOSTICS_OFFLINE_LEDGER_CAPTURE_ARTIFACT");
  }
  const producer = { deploymentId: "diagnostics-offline-author.v1", attemptId: id(`${input.dataset.manifestDigest}:author`), capabilityVersion: "verification.v1" };
  const verifier = { deploymentId: "diagnostics-offline-verifier.v1", attemptId: id(`${input.dataset.manifestDigest}:verifier`), capabilityVersion: "verification.v1" };
  const artifacts = [...input.artifacts];
  const register = (value: unknown, mediaType: string, parents: readonly string[]) => {
    const bytes = new TextEncoder().encode(typeof value === "string" ? value : canonicalizeJson(value));
    const digest = sha256Digest(bytes), artifactId = id(`${mediaType}:${digest}`);
    const registration: VerificationArtifactHandle = { artifactId, tenantId, digest, byteLength: bytes.length, mediaType, objectKey: `offline/${digest.slice(7)}`, createdAt: "2026-09-08T00:00:00.000Z", producerActivityId: "diagnostics-offline-ledgers", producerVersion: "1", encryptionClass: "offline", retentionClass: "verification-audit", dataClassification: "internal", parentArtifactIds: [...new Set(parents)].sort() };
    artifacts.push({ registration, bytes }); return registration;
  };
  const cases = new Map(input.dataset.cases.map(c => [c.caseId,c]));
  const assertion = (caseId: string, proposition: string, output?: { artifactId: string; start: number; end: number }): Assertion => {
    const c = cases.get(caseId); if (!c) throw new Error("DIAGNOSTICS_OFFLINE_LEDGER_CASE_REQUIRED");
    return { assertionId: caseId, kind: output ? "report_assertion" : "claim", claimType: "attribute", proposition, producer, ...(output ? {outputArtifactId:output.artifactId,outputRange:{start:output.start,end:output.end}} : {}), qualifiers: [], entityBindings: [], derivation: "direct", evidence: c.evidence.map((e,i) => ({ evidenceId: `${caseId}:e${i}`, fragment:{fragmentId:e.fragmentId,captureId:e.captureId,representationArtifactId:e.projectionArtifactId,selector:e.selector}, role:"supports",origin:"declared",expectedSelectedContentDigest:e.selectedContentDigest,authority:{authority:e.sourceClass === "first_party_marketing" || e.sourceClass === "interested_party_comparison" ? "promotional" : "primary",independence:e.sourceClass === "publication" ? "unknown" : "interested_party",directness:"direct",freshness:"unknown",applicability:"unknown"},parserLineageArtifactIds:[e.transformationArtifactId] })), intent:{intentId:`${caseId}:intent`,operation:output?"verify_report_coverage":"verify_claim_support",subject:caseId,expectedResult:"Resolve capture-bound evidence; semantic support remains unassessed.",method:"Native offline verification of exact registered artifacts.",acceptanceCriteria:["capture and selector integrity"],abstainWhen:["evidence unavailable"]},riskClass:"medium",downstreamUse:["engineering_review"],atomic:true };
  };
  const bundle = (name: string, assertions: Assertion[]): VerificationBundle => {
    const captureIds = new Set(assertions.flatMap(a => a.evidence.map(e=>e.fragment.captureId)));
    const captures = input.captures.filter(c => captureIds.has(c.capture.captureId)).map(c => {
      if(new Set(assertions.flatMap(a=>a.evidence).filter(e=>e.fragment.captureId===c.capture.captureId).map(e=>e.fragment.representationArtifactId)).size!==1)throw new Error("DIAGNOSTICS_OFFLINE_LEDGER_MULTIPLE_PROJECTIONS");
      const evidence = assertions.flatMap(a=>a.evidence).find(e=>e.fragment.captureId===c.capture.captureId)!;
      const projection = artifacts.find(a=>a.registration.artifactId===evidence.fragment.representationArtifactId)?.registration;
      if (!projection) throw new Error("DIAGNOSTICS_OFFLINE_LEDGER_PROJECTION_REQUIRED");
      return {...c.capture,canonicalProjectionArtifact:projection};
    });
    return {verificationContractVersion:"verification.v1",bundleId:id(`${input.dataset.manifestDigest}:${name}`),policyVersion:"diagnostics-offline-engineering.v1",producer,verifier,sources:input.captures.filter(c=>captureIds.has(c.capture.captureId)).map(c=>c.source).filter((s,i,a)=>a.findIndex(x=>x.sourceId===s.sourceId)===i),captures,assertions,metricObservations:[],lineage:[]};
  };
  const projectionGrants: {tenantId:string;assertions:{artifactId:string;digest:string};admissions:{captureId:string;projectionArtifactId:string;transformationArtifactId:string}[]}[]=[];
  const grant = (handle: VerificationArtifactHandle, b: VerificationBundle) => {
    const admissions = b.assertions.flatMap(a=>a.evidence.map(e=>({captureId:e.fragment.captureId,projectionArtifactId:e.fragment.representationArtifactId,transformationArtifactId:e.parserLineageArtifactIds[0]!}))).filter((e,i,a)=>a.findIndex(x=>x.captureId===e.captureId&&x.projectionArtifactId===e.projectionArtifactId)===i);
    projectionGrants.push({tenantId,assertions:{artifactId:handle.artifactId,digest:handle.digest},admissions});
  };
  const claims = input.dataset.cases.filter(c=>c.evidence.length>0).map(c=>{
    const b=bundle(c.caseId,[assertion(c.caseId,c.assertion)]), h=register(VerificationClaimsArtifactSchema.parse({schemaVersion:"verification-claims-artifact.v1",bundle:b}),"application/vnd.aiengineer.verification-claims+json",[...b.captures.map(c=>c.contentArtifact.artifactId),...b.assertions.flatMap(a=>a.evidence.flatMap(e=>[e.fragment.representationArtifactId,...e.parserLineageArtifactIds]))]); grant(h,b);
    return {caseId:c.caseId,request:{verificationContractVersion:"verification.v1" as const,captureIds:b.captures.map(c=>c.captureId),assertions:{artifactId:h.artifactId,digest:h.digest}}};
  });
  const reports = input.reports.map(r=>{
    const report=register(r.renderedMarkdown,"text/markdown",r.blocks.flatMap(b=>b.evidence?[b.evidence.projectionArtifactId]:[]));
    const entries=r.blocks.filter(b=>b.kind==="assertion").map(block=>{
      if (!block.caseId || !block.assertionText) throw new Error("DIAGNOSTICS_OFFLINE_LEDGER_REPORT_BLOCK_INVALID");
      const within=r.renderedMarkdown.slice(block.startUtf16,block.endUtf16).indexOf(block.assertionText);
      if(within<0)throw new Error("DIAGNOSTICS_OFFLINE_LEDGER_REPORT_SPAN_INVALID");
      const start=block.startUtf16+within,end=start+block.assertionText.length,a=assertion(block.caseId,block.assertionText,{artifactId:report.artifactId,start,end});
      // These bounded values describe source wording, not a reconciled product fact.
      const turnaround = /^tru-turnaround-(about|product)-source$/u.test(block.caseId) ? /(\d+)\s*[–-]\s*(\d+)\s+weeks/iu.exec(block.assertionText) : null;
      const systemCount = ["gl-historical-wording-source","gl-same-page-footer-source"].includes(block.caseId) ? /\b(\d+)\s+(?:critical systems|organs and systems)/iu.exec(block.assertionText) : null;
      const consistency = turnaround ? {consistencyKey:"trudiagnostic-turnaround-source-wording",consistencyFacet:"number" as const,contextKey:"lab-receives-sample",normalizedValue:`${turnaround[1]}-${turnaround[2]} weeks`} : systemCount ? {consistencyKey:"generation-lab-system-count-source-wording",consistencyFacet:"number" as const,contextKey:"system-count",normalizedValue:systemCount[1]!} : {};
      return {assertion:a,exactText:block.assertionText,start,end,citationRequired:true,claimWeight:1,severity:"medium" as const,citations:a.evidence.map(e=>({citationId:`${a.assertionId}:citation:${e.evidenceId}`,evidenceId:e.evidenceId})),requiredQualifiers:[],...consistency};
    });
    const b=bundle(r.reportId,entries.map(e=>e.assertion));
    const ledger=register(VerificationReportLedgerSchema.parse({schemaVersion:"verification-report-ledger.v1",reportArtifact:report,bundle:b,assertions:entries}),"application/vnd.aiengineer.verification-report-ledger+json",[report.artifactId,...[...b.captures.map(c=>c.contentArtifact.artifactId),...b.assertions.flatMap(a=>a.evidence.flatMap(e=>[e.fragment.representationArtifactId,...e.parserLineageArtifactIds]))]]); grant(ledger,b);
    return {reportId:r.reportId,request:{verificationContractVersion:"verification.v1" as const,captureIds:b.captures.map(c=>c.captureId),report:{artifactId:report.artifactId,digest:report.digest},claimLedger:{artifactId:ledger.artifactId,digest:ledger.digest}}};
  });
  const runtime={producerAttemptId:producer.attemptId,runtimePrincipals:{basis:"runtime_principal_binding" as const,producerDeploymentId:producer.deploymentId,verifierDeploymentId:verifier.deploymentId,producerPrincipalDigest:sha256Digest(producer.deploymentId),verifierPrincipalDigest:sha256Digest(verifier.deploymentId)}};
  const retained = new Map(artifacts.map(a=>[a.registration.artifactId,structuredClone(a)]));
  if (retained.size !== artifacts.length) throw new Error("DIAGNOSTICS_OFFLINE_LEDGER_DUPLICATE_ARTIFACT");
  const createDependencies = (nativeProjectionAdmission: VerificationClaimsServiceDependencies["nativeProjectionAdmission"]): VerificationClaimsServiceDependencies => {
    const tickets = new Set<string>();
    return { artifactResolver:{async authorizeArtifact(q){if(q.purpose!=="verification_admission"||q.tenantId!==tenantId||!retained.has(q.artifactId))throw new Error("DIAGNOSTICS_OFFLINE_LEDGER_ARTIFACT_DENIED"); tickets.add(q.artifactId);},async hydrateRegisteredArtifact(q){const a=retained.get(q.artifactId);if(q.tenantId!==tenantId||!a||!tickets.delete(q.artifactId)||a.registration.tenantId!==tenantId||a.registration.byteLength!==a.bytes.length||a.registration.digest!==sha256Digest(a.bytes))throw new Error("DIAGNOSTICS_OFFLINE_LEDGER_ARTIFACT_INVALID");return structuredClone(a);}},captures:{async getRegisteredCapture(q){const c=input.captures.find(c=>c.capture.captureId===q.captureId);if(q.tenantId!==tenantId||!c||c.capture.contentArtifact.tenantId!==tenantId)throw new Error("DIAGNOSTICS_OFFLINE_LEDGER_CAPTURE_DENIED");return structuredClone(c);}},runtimePrincipals:{async bind(q){if(q.context.tenantId!==tenantId||q.context.attemptId!==verifier.attemptId||!projectionGrants.some(g=>g.assertions.artifactId===q.assertionsArtifact.artifactId&&g.assertions.digest===q.assertionsArtifact.digest))throw new Error("DIAGNOSTICS_OFFLINE_LEDGER_RUNTIME_DENIED");return structuredClone(runtime);}},selectorResolvers:[projectionSelectorResolver],projectionGrants:new VerificationClaimsProjectionGrantCatalog(projectionGrants),...(nativeProjectionAdmission?{nativeProjectionAdmission}:{})};
  };
  return {context:{contractVersion:"v1" as const,tenantId,operationId:id(`${input.dataset.manifestDigest}:operation`),attemptId:verifier.attemptId,correlationId:"diagnostics-offline",actor:{kind:"service" as const,id:id("diagnostics-offline-actor"),serviceIdentity:"knowledge_worker" as const},capabilityVersion:"verification.v1",idempotencyKey:`diagnostics-offline:${input.dataset.manifestDigest}`,reason:"Offline engineering verification"},artifacts:structuredClone(artifacts),captures:structuredClone(input.captures),runtime:structuredClone(runtime),projectionGrants:structuredClone(projectionGrants),claims,reports,createDependencies,unavailableCaseIds:input.dataset.cases.filter(c=>c.evidence.length===0).map(c=>c.caseId)};
}
