import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ReportStructureSchema, renderReport } from "@aiengineer/knowledge-ingestion";
import { deriveRootReportRequirements, createRootReportAuthority, ROOT_REPORT_FORMAT } from "./root-host-report.js";

function fixture() {
  const tenantId=randomUUID(),text="Aurora supports OCR only when enabled.";
  const originalQuestions=[{key:"qualified_capability.q1",question:"Does Aurora support scanned invoice parsing?"}];
  const report=ReportStructureSchema.parse({schemaVersion:"research-report.v1",reportId:randomUUID(),revisionId:randomUUID(),version:1,title:ROOT_REPORT_FORMAT.title,
    slug:"t14-report",reportType:"research_synthesis",purpose:"Bounded development question",authoringMode:"post_research",asOf:"2026-03-01T00:00:00Z",scope:{},producer:{identity:"producer",version:"1"},
    questions:[{...originalQuestions[0],required:true,coverage:"answered",explanation:"",sectionKeys:["findings"]}],
    sections:[{key:"findings",heading:"Findings",kind:"finding",blocks:[{key:"finding",markdown:text,assertions:[{key:"a1",start:0,end:text.length,kind:"reported",qualifiers:["only when enabled"],claims:[{runId:"authorized-run",claimId:"claim1",digest:`sha256:${"a".repeat(64)}`,evidenceManifest:{artifactId:randomUUID(),digest:`sha256:${"b".repeat(64)}`},role:"supports"}]}]}]}]});
  return {tenantId,report,originalQuestions};
}
describe("host-owned report requirements",()=>{
  it("binds every final assertion and qualifier to the immutable original question without declaring admission",()=>{
    const input=fixture(),result=deriveRootReportRequirements(input);
    expect(result.requirements.originalQuestions).toEqual([{...input.originalQuestions[0],requiredAssertionKeys:["a1"]}]);
    expect(result.requirements.requiredAssertions[0]).toMatchObject({key:"a1",proposition:"Aurora supports OCR only when enabled.",qualifiers:["only when enabled"]});
    expect(result.requirements).not.toHaveProperty("admission");
    const markdown=renderReport(result.report).markdown;
    for(const span of result.requirements.structuralSpans)expect(markdown.slice(span.start,span.end)).toBe(span.text);
  });
  it.each(["changed","dropped","optional","extra"])("rejects %s original question coverage",mutation=>{
    const input=fixture();
    if(mutation==="changed")input.report.questions[0]!.question="A narrower question";
    if(mutation==="dropped")input.report.questions=[];
    if(mutation==="optional")input.report.questions[0]!.required=false;
    if(mutation==="extra")input.report.questions.push({...input.report.questions[0]!,key:"q2"});
    expect(()=>deriveRootReportRequirements(input)).toThrow();
  });
  it("does not approve arbitrary factual headings as structural text",()=>{
    const input=fixture();input.report.sections[0]!.heading="Aurora is free and unlimited";
    expect(()=>deriveRootReportRequirements(input)).toThrow("STRUCTURAL_LABEL_NOT_AUTHORIZED");
  });
  it("rejects factual text and table content outside the assertion census",()=>{
    const input=fixture();input.report.sections[0]!.blocks[0]!.markdown+="\n|Price|Free|";
    expect(()=>deriveRootReportRequirements(input)).toThrow("UNBOUND_REPORT_TEXT");
  });
  it("does not let illustrative labeling bypass factual verification",()=>{
    const input=fixture(),assertion=input.report.sections[0]!.blocks[0]!.assertions[0]!;assertion.kind="illustrative";assertion.claims=[];
    expect(()=>deriveRootReportRequirements(input)).toThrow("FACTUAL_ASSERTION_CENSUS_REQUIRED");
  });
  it("requires an actual assertion binding even when the report labels the question unanswered",()=>{
    const input=fixture();Object.assign(input.report.questions[0]!,{coverage:"unanswered",explanation:"No evidence",sectionKeys:[]});
    expect(()=>deriveRootReportRequirements(input)).toThrow("QUESTION_WITHOUT_BOUND_ASSERTIONS");
  });
  it("does not use producer-provided run references as host authority",async()=>{
    const input=fixture(),structureId=randomUUID();let persisted=0,readRun=0;
    const authority=createRootReportAuthority({ ...input,
      reports:{get:async()=>({seal:{},artifacts:[{role:"structure",artifact_id:structureId,sha256:"c".repeat(64)}]})},
      artifacts:{get:async()=>({record:{storageState:"available",digest:`sha256:${"c".repeat(64)}`},json:input.report}),put:async()=>{persisted++;throw new Error("must not write");}},
      verification:{store:{tenantId:input.tenantId},runStatus:async()=>{readRun++;throw new Error("must not read unapproved run");}},
      allowedRunIds:()=>[],policyVersion:"test",policyDigest:`sha256:${"d".repeat(64)}`,
    } as unknown as Parameters<typeof createRootReportAuthority>[0]);
    await expect(authority.forReport({tenantId:input.tenantId,revisionId:input.report.revisionId})).rejects.toThrow("RUN_NOT_HOST_AUTHORIZED");
    expect(persisted).toBe(0);expect(readRun).toBe(0);
    await expect(authority.forReport({tenantId:randomUUID(),revisionId:input.report.revisionId})).rejects.toThrow("TENANT_MISMATCH");
  });
});
