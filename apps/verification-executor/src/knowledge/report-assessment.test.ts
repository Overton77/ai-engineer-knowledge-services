import { randomUUID } from "node:crypto";
import { describe,expect,it } from "vitest";
import { ReportStructureSchema,renderReport } from "@aiengineer/knowledge-ingestion";
import { digestCanonicalJson } from "@aiengineer/knowledge-verification";
import { assessReportFidelity,rejectedAssertionText,type ReportAssessmentRequirements } from "./report-assessment.js";
import type { ReportEvidenceClaim,SealedReportEvidence } from "./evidence-oracle.js";

function fixture() {
  const tenantId=randomUUID(),reportVersionId=randomUUID();
  const texts=["🧪 Cafe\u0301 operates in preview.","A second organization operates in preview."];
  const runs=new Map<string,SealedReportEvidence>();
  const references=texts.map((proposition,index)=>{
    const runId=`run-${index}`,auditArtifact={artifactId:randomUUID(),digest:`sha256:${"a".repeat(64)}`};
    const assertion={assertionId:"shared-key",proposition,qualifiers:["in preview"],downstreamUse:["source_attributed_report"],claimType:"capability",evidence:[],entityBindings:[]};
    const claim={runId,claimId:"shared-key",digest:digestCanonicalJson(assertion),assertion,eligible:true,verdict:"directly_supported",policyOutcome:"pass"} as unknown as ReportEvidenceClaim;
    runs.set(runId,{reportClaims:new Map([[claim.claimId,claim]]),sourceArtifacts:[],auditArtifact,manifestDigest:auditArtifact.digest,resultArtifactId:randomUUID()});
    return {runId,claimId:claim.claimId,digest:claim.digest,evidenceManifest:auditArtifact,role:"supports"};
  });
  const table=`| Organization | Capability |\n|---|---|\n| One | ${texts[0]} |`;
  const caption=`Figure 1: ${texts[1]}`;
  const report=ReportStructureSchema.parse({schemaVersion:"research-report.v1",reportId:randomUUID(),revisionId:reportVersionId,version:1,title:"Comparison",slug:"comparison",reportType:"research_synthesis",purpose:"Explain two organizations",authoringMode:"incremental",asOf:"2026-09-14T00:00:00Z",scope:{},producer:{identity:"synthetic",version:"1"},
    questions:[{key:"q1",question:"What can both organizations do?",required:true,coverage:"answered",explanation:"",sectionKeys:["findings"]}],
    sections:[{key:"findings",heading:"Findings",kind:"comparison",blocks:[table,caption].map((markdown,index)=>({key:`b${index}`,markdown,assertions:[{key:`a${index}`,start:markdown.indexOf(texts[index]!),end:markdown.indexOf(texts[index]!)+texts[index]!.length,kind:"reported",qualifiers:["in preview"],claims:[references[index]]}]}))}]});
  const rendition=renderReport(report).markdown;
  const structuralSpans=([{text:"# Comparison",role:"report_title"},{text:"## Findings",role:"section_heading"},{text:"| Organization | Capability |",role:"table_header"},{text:" One ",role:"table_label"},{text:"Figure 1: ",role:"caption_prefix"}] as const).map(({text,role})=>({text,role,start:rendition.indexOf(text),end:rendition.indexOf(text)+text.length}));
  const requirements:ReportAssessmentRequirements={schemaVersion:"research-report-requirements.v1",tenantId,reportVersionId,structuralSpans,originalQuestions:[{key:"q1",question:report.questions[0]!.question,requiredAssertionKeys:["a0","a1"]}],requiredAssertions:texts.map((proposition,index)=>({key:`a${index}`,proposition,kind:"reported",qualifiers:["in preview"]}))};
  return {report,requirements,runs};
}

describe("registered report final-span fidelity",()=>{
  it.each(["incremental","post_research"] as const)("preserves collision-qualified table/caption evidence and Unicode in %s authoring",authoringMode=>{
    const f=fixture();f.report.authoringMode=authoringMode;
    const result=assessReportFidelity(f.report,f.requirements,f.runs);
    expect(result.admission).toBe("pass");expect(result.assertions.every(assertion=>assertion.factEligible)).toBe(true);
    const markdown=renderReport(f.report).markdown;
    for(const item of result.assertions) expect(markdown.slice(item.startUtf16,item.endUtf16)).toBe(item.proposition);
    expect(result.assertions[0]!.proposition).toContain("🧪 Cafe\u0301");
  });
  it.each(["missing-reference","wrong-run","missing-question","missing-assertion","changed-qualifiers","illustrative-bypass"])("rejects %s",mutation=>{
    const f=fixture();const first=f.report.sections[0]!.blocks[0]!.assertions[0]!;
    if(mutation==="missing-reference")first.claims[0]!.claimId="absent";
    if(mutation==="wrong-run")first.claims[0]!.runId="run-1";
    if(mutation==="missing-question")f.report.questions=[];
    if(mutation==="missing-assertion")f.report.sections[0]!.blocks[0]!.assertions=[];
    if(mutation==="changed-qualifiers")first.qualifiers=[];
    if(mutation==="illustrative-bypass"){first.kind="illustrative";first.claims=[];}
    expect(assessReportFidelity(f.report,f.requirements,f.runs).admission).toBe("fail");
  });
  it("requires original premises for derived statements",()=>{
    const f=fixture(),assertion=f.report.sections[0]!.blocks[0]!.assertions[0]!;
    assertion.kind="derived";assertion.claims.push({...assertion.claims[0]!,role:"premise"});
    f.requirements.requiredAssertions[0]!.kind="derived";
    assertion.derivation={premises:assertion.claims.filter(ref=>ref.role==="premise").map(ref=>({runId:ref.runId,claimId:ref.claimId,digest:ref.digest}))};
    expect(assessReportFidelity(f.report,f.requirements,f.runs).admission).toBe("pass");
    assertion.derivation={premises:[]};expect(assessReportFidelity(f.report,f.requirements,f.runs).admission).toBe("fail");
  });
  it.each([" The API is free.","\n| New provider | Free unlimited access |","\nFigure 2: Unlimited production access","\nOrganization Capability One Findings Comparison"])("rejects unbound final prose/table/caption text: %s",extra=>{
    const f=fixture();f.report.sections[0]!.blocks[0]!.markdown+=extra;
    expect(assessReportFidelity(f.report,f.requirements,f.runs).problems).toContain("UNBOUND_REPORT_TEXT");
  });
  it("does not treat an answered label or section presence as assertion coverage",()=>{
    const f=fixture();f.requirements.originalQuestions[0]!.requiredAssertionKeys=["missing-required-answer"];
    expect(assessReportFidelity(f.report,f.requirements,f.runs).problems).toContain("QUESTION_ASSERTION_COVERAGE_INVALID:q1");
  });
  it("reports an authenticated rejection without admitting its asserted fact",()=>{
    const f=fixture(),claim=f.runs.get("run-0")!.reportClaims.get("shared-key")!;
    const rejected={...claim,eligible:false,verdict:"contradicted",policyOutcome:"fail"};
    f.runs.set("run-0",{...f.runs.get("run-0")!,reportClaims:new Map([["shared-key",rejected]])});
    const block=f.report.sections[0]!.blocks[0]!,assertion=block.assertions[0]!;
    block.markdown=rejectedAssertionText(rejected);assertion.start=0;assertion.end=block.markdown.length;
    assertion.derivation={kind:"verification_outcome",runId:rejected.runId,claimId:rejected.claimId,verdict:rejected.verdict,policyOutcome:rejected.policyOutcome};
    f.requirements.requiredAssertions[0]!.proposition=block.markdown;
    const markdown=renderReport(f.report).markdown;
    f.requirements.structuralSpans=f.requirements.structuralSpans.filter(span=>!["table_header","table_label"].includes(span.role)).map(span=>({...span,start:markdown.indexOf(span.text),end:markdown.indexOf(span.text)+span.text.length}));
    const result=assessReportFidelity(f.report,f.requirements,f.runs);
    expect(result.admission).toBe("pass");expect(result.assertions[0]).toMatchObject({disposition:"faithful_rejection",factEligible:false});
  });
  it("rejects UTF-16 boundaries that split an astral character",()=>{
    const f=fixture(),assertion=f.report.sections[0]!.blocks[0]!.assertions[0]!;assertion.start++;
    expect(ReportStructureSchema.safeParse(f.report).success).toBe(false);
  });
});
