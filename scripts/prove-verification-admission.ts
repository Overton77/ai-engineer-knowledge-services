import { randomUUID } from "node:crypto";
import { readFile,writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { VerificationAdmissionService, OfflineBenchmarkInputCatalog, RegisteredBenchmarkInputAdmission, prepareRegisteredBenchmarkProjections, diagnosticsBenchmarkArms } from "@aiengineer/knowledge-application";
import { freezeVerificationBenchmarkDataset } from "../packages/evaluation/dist/index.js";
import { SandboxedVerificationParser,VERIFICATION_PARSER_LIMITS } from "@aiengineer/knowledge-conversion";
import { PostgresCanonicalRepository,PostgresVerificationRepository } from "@aiengineer/knowledge-persistence";
import { deterministicUuid,SupabaseArtifactStore } from "@aiengineer/knowledge-runtime";
import { admitExtractionSchema,sha256Digest,canonicalizeJson } from "@aiengineer/knowledge-verification";

const postgresUrl=process.env.POSTGRES_URL?.trim(),supabaseUrl=process.env.SUPABASE_URL?.trim(),secret=process.env.SUPABASE_SECRET_KEY?.trim();
if(!postgresUrl||!supabaseUrl||!secret) throw new Error("LOCAL_ADMISSION_CONFIGURATION_REQUIRED");
const pg=new URL(postgresUrl),storage=new URL(supabaseUrl);
if(!["127.0.0.1","localhost"].includes(pg.hostname)||pg.port!=="54322"||!["127.0.0.1","localhost"].includes(storage.hostname)||storage.port!=="54321") throw new Error("LOCAL_ONLY_PROOF_REFUSED_REMOTE_TARGET");

const namespace=`verification-admission-${randomUUID()}`,tenantId=randomUUID(),otherTenantId=randomUUID();
const id=(label:string)=>deterministicUuid("verification-admission-proof",`${namespace}:${label}`);
const createdAt=new Date().toISOString(),bucket="ai-engineer-cloud-bucket";
const imageDigest="sha256:9dff779c9d5df3b80876b1017da24befdd241bdc28950e084c504e158e08c906" as const;
const database=new PostgresCanonicalRepository({connectionString:postgresUrl,localOnly:true,connectionTimeoutMs:3_000});
const store=new SupabaseArtifactStore({projectUrl:supabaseUrl,serviceRoleKey:secret,bucket,maximumBytes:8_000_000});
let hydrationAuthorizations=0;
const repository=new PostgresVerificationRepository(database,store,{async authorize(input){hydrationAuthorizations+=1;if(input.tenantId!==tenantId||input.purpose!=="verification_admission")throw new Error("ARTIFACT_ACCESS_DENIED");}});
const service=new VerificationAdmissionService(repository,new SandboxedVerificationParser(imageDigest),{parserVersion:"verification-native-parser.v1",imageDigest,limits:VERIFICATION_PARSER_LIMITS},{storageBucket:bucket,producerVersion:"verification-admission.v1",encryptionClass:"supabase-managed",retentionClass:"verification-audit",now:()=>new Date().toISOString()});
const checks:Record<string,boolean>={};
const expectFailure=async(name:string,action:()=>Promise<unknown>,pattern:RegExp)=>{try{await action();}catch(error){const message=error instanceof Error?error.message:String(error);if(!pattern.test(message))throw new Error(`${name}_WRONG_FAILURE:${message}`);checks[name]=true;return;}throw new Error(`${name}_DID_NOT_FAIL`);};
const missionId=id("mission"),workItemId=id("work-item"),attemptId=id("attempt");
const sourceRoot=resolve("..","internal","verification-source-captures","20260905");

try{
  await database.transaction(tenantId,async(client)=>{
    await client.query("insert into orchestration.mission(id,tenant_id,slug,goal) values($1,$2,$3,$4)",[missionId,tenantId,namespace,"Prove registered parser admission"]);
    await client.query("insert into orchestration.work_item(id,tenant_id,mission_id,kind,spec) values($1,$2,$3,'verify_extraction',$4::jsonb)",[workItemId,tenantId,missionId,JSON.stringify({namespace})]);
    await client.query("insert into orchestration.attempt(id,tenant_id,work_item_id,attempt_no,agent_deployment_id,started_at) values($1,$2,$3,1,'verification-admission-proof',$4)",[attemptId,tenantId,workItemId,createdAt]);
  });
  const pdfBytes=await readFile(resolve(sourceRoot,"tru-sample-report.pdf"));
  const htmlCapture=JSON.parse(await readFile(resolve(sourceRoot,"tru-about.json"),"utf8")) as {rawHtml:string;metadata?:{sourceURL?:string}};
  const htmlBytes=new TextEncoder().encode(htmlCapture.rawHtml);
  const registerCapture=async(kind:"pdf"|"web_page",bytes:Uint8Array,label:string,uri:string)=>{
    const artifact=await repository.registerContentAddressedArtifact({tenantId,bytes,mediaType:kind==="pdf"?"application/pdf":"text/html",createdAt,producerActivityId:"restricted-source-capture",producerVersion:"20260905",encryptionClass:"supabase-managed",retentionClass:"restricted-source",dataClassification:"restricted",artifactType:"source_capture",bucketClass:"source_captures",storageBucket:bucket,producerAttemptId:attemptId,missionId});
    const sourceId=id(`${label}-source`),captureId=id(`${label}-capture`);
    await repository.recordCapture({tenantId,source:{sourceId,kind,canonicalUri:uri,logicalIdentity:`${label}:${artifact.digest}`},capture:{captureId,sourceId,capturedAt:createdAt,captureMethod:"restricted-fixture",captureMethodVersion:"20260905",contentArtifact:artifact},producerAttemptId:attemptId});
    return {artifact,captureId};
  };
  const pdf=await registerCapture("pdf",pdfBytes,"tru-pdf","https://www.trudiagnostic.com/sample-report");
  const html=await registerCapture("web_page",htmlBytes,"tru-html",htmlCapture.metadata?.sourceURL??"https://www.trudiagnostic.com/about-truage");
  const expected=(artifact:typeof pdf.artifact)=>({artifactId:artifact.artifactId,digest:artifact.digest as `sha256:${string}`});
  const beforeTenantProbe=hydrationAuthorizations;
  await expectFailure("tenant_mismatch_before_hydration",()=>service.parseAndAdmit({tenantId:otherTenantId,captureId:pdf.captureId,expectedSourceArtifact:expected(pdf.artifact),kind:"pdf"}),/CAPTURE_NOT_REGISTERED/);
  checks.tenant_mismatch_did_not_authorize=hydrationAuthorizations===beforeTenantProbe;
  await expectFailure("forged_parent_digest",()=>service.parseAndAdmit({tenantId,captureId:pdf.captureId,expectedSourceArtifact:{artifactId:pdf.artifact.artifactId,digest:`sha256:${"0".repeat(64)}`},kind:"pdf"}),/CAPTURE_EXPECTED_IDENTITY_MISMATCH/);
  const pdfReceipts=await service.parseAndAdmit({tenantId,captureId:pdf.captureId,expectedSourceArtifact:expected(pdf.artifact),kind:"pdf"});
  const htmlReceipts=await service.parseAndAdmit({tenantId,captureId:html.captureId,expectedSourceArtifact:expected(html.artifact),kind:"html"});
  checks.native_routes_registered=pdfReceipts.length===2&&htmlReceipts.length===1&&pdfReceipts.every((item)=>item.transformationArtifact.parentArtifactIds.length===3);
  const pdfTextReceipt=pdfReceipts.find((item)=>item.projectionKind==="pdf_text")!;
  const hydratedPdf=await service.hydrateAdmittedProjection({tenantId,captureId:pdf.captureId,expectedSourceArtifact:expected(pdf.artifact),transformationArtifactId:pdfTextReceipt.transformationArtifact.artifactId,projectionArtifactId:pdfTextReceipt.projectionArtifact.artifactId});
  if(hydratedPdf.projection.kind!=="pdf_text")throw new Error("PDF_PROJECTION_KIND");
  const page2=hydratedPdf.projection.pages.find((page)=>page.physicalPageNumber===2)!;
  const exact="29.4",start=page2.text.indexOf(exact);
  if(start<0)throw new Error("KNOWN_PDF_FIELD_MISSING");
  const schema=admitExtractionSchema({schemaId:"real-pdf-summary",schemaVersion:"1",schema:{type:"object",description:"Restricted sample report summary field.",properties:{chronologicalAge:{type:"string",description:"Chronological age printed in the sample report.",maxLength:16}},required:["chronologicalAge"],additionalProperties:false}}).schema!;
  const evidence={path:"/chronologicalAge",captureId:pdf.captureId,projectionArtifactId:pdfTextReceipt.projectionArtifact.artifactId,transformationArtifactId:pdfTextReceipt.transformationArtifact.artifactId,selector:{kind:"pdf_text" as const,page:2,start,end:start+exact.length,offsetBasis:"utf16_code_units" as const,textLayerDigest:page2.textLayerDigest},expectedSelectedContentDigest:sha256Digest(exact)};
  const base={tenantId,expectedSourceArtifact:expected(pdf.artifact),schema,fields:[{path:"/chronologicalAge",comparison:"decimal" as const}],evidence:[evidence]};
  checks.real_pdf_exact_field=(await service.verifyExtraction({...base,candidate:{chronologicalAge:exact}})).valid;
  checks.real_pdf_mutated_value_rejected=!(await service.verifyExtraction({...base,candidate:{chronologicalAge:"29.5"}})).valid;
  checks.real_pdf_mutated_locator_rejected=!(await service.verifyExtraction({...base,candidate:{chronologicalAge:exact},evidence:[{...evidence,selector:{...evidence.selector,start:start+1,end:start+exact.length+1}}]})).valid;
  checks.visual_residual_retained=hydratedPdf.projection.residuals?.some((item)=>item.physicalPageNumber===2)===true;
  const visualSchema=admitExtractionSchema({schemaId:"visual-residual",schemaVersion:"1",schema:{type:"object",description:"Value intentionally unavailable from the text layer.",properties:{graphOnlyValue:{type:"string",description:"A value requiring a separately admitted visual route.",maxLength:32}},required:["graphOnlyValue"],additionalProperties:false}}).schema!;
  checks.graph_only_value_abstained=!(await service.verifyExtraction({tenantId,expectedSourceArtifact:expected(pdf.artifact),schema:visualSchema,candidate:{graphOnlyValue:"unavailable"},fields:[{path:"/graphOnlyValue",comparison:"exact"}],evidence:[{path:"/graphOnlyValue",captureId:pdf.captureId,projectionArtifactId:pdfTextReceipt.projectionArtifact.artifactId,transformationArtifactId:pdfTextReceipt.transformationArtifact.artifactId,selector:{kind:"pdf_text",page:2,start:99_999,end:100_000,offsetBasis:"utf16_code_units",textLayerDigest:page2.textLayerDigest}}]})).valid;
  const htmlReceipt=htmlReceipts[0]!;
  const htmlSchema=admitExtractionSchema({schemaId:"real-html-hours",schemaVersion:"1",schema:{type:"object",description:"Restricted captured contact field.",properties:{hours:{type:"string",description:"Displayed support hours.",maxLength:100}},required:["hours"],additionalProperties:false}}).schema!;
  const hours="Mon-Fri 9am-7pm | Sat 9am-3pmEastern Time (UTC-4:00)";
  checks.real_html_exact_field=(await service.verifyExtraction({tenantId,expectedSourceArtifact:expected(html.artifact),schema:htmlSchema,candidate:{hours},fields:[{path:"/hours",comparison:"exact"}],evidence:[{path:"/hours",captureId:html.captureId,projectionArtifactId:htmlReceipt.projectionArtifact.artifactId,transformationArtifactId:htmlReceipt.transformationArtifact.artifactId,selector:{kind:"html",css:"#standartTime"}}]})).valid;
  checks.real_html_ambiguous_selector_no_fallback=!(await service.verifyExtraction({tenantId,expectedSourceArtifact:expected(html.artifact),schema:htmlSchema,candidate:{hours},fields:[{path:"/hours",comparison:"exact"}],evidence:[{path:"/hours",captureId:html.captureId,projectionArtifactId:htmlReceipt.projectionArtifact.artifactId,transformationArtifactId:htmlReceipt.transformationArtifact.artifactId,selector:{kind:"html",css:"#providers",canonicalTextFallback:{kind:"text_quote",quote:hours,normalization:"none"}}}]})).valid;
  const collisionOne=await registerCapture("web_page",new TextEncoder().encode("<p>same projection</p><!-- parent-one -->"),"collision-one","https://fixture.invalid/one");
  const collisionTwo=await registerCapture("web_page",new TextEncoder().encode("<p>same projection</p><!-- parent-two -->"),"collision-two","https://fixture.invalid/two");
  const collisionFirst=(await service.parseAndAdmit({tenantId,captureId:collisionOne.captureId,expectedSourceArtifact:expected(collisionOne.artifact),kind:"html"}))[0]!;
  const collisionSecond=(await service.parseAndAdmit({tenantId,captureId:collisionTwo.captureId,expectedSourceArtifact:expected(collisionTwo.artifact),kind:"html"}))[0]!;
  checks.cas_projection_reused_without_metadata_rewrite=collisionFirst.projectionArtifact.artifactId===collisionSecond.projectionArtifact.artifactId&&collisionFirst.projectionArtifact.createdAt===collisionSecond.projectionArtifact.createdAt&&collisionFirst.projectionArtifact.producerActivityId===collisionSecond.projectionArtifact.producerActivityId;
  checks.cas_parent_specific_envelopes=collisionFirst.transformationArtifact.artifactId!==collisionSecond.transformationArtifact.artifactId&&collisionFirst.transformationArtifact.parentArtifactIds.includes(collisionOne.artifact.artifactId)&&collisionSecond.transformationArtifact.parentArtifactIds.includes(collisionTwo.artifact.artifactId);
  await expectFailure("cross_parent_envelope_rejected",()=>service.hydrateAdmittedProjection({tenantId,captureId:collisionTwo.captureId,expectedSourceArtifact:expected(collisionTwo.artifact),transformationArtifactId:collisionFirst.transformationArtifact.artifactId,projectionArtifactId:collisionFirst.projectionArtifact.artifactId}),/PROJECTION_ENVELOPE_BINDING_MISMATCH/);
  checks.cross_parent_envelope_accepted=(await service.hydrateAdmittedProjection({tenantId,captureId:collisionTwo.captureId,expectedSourceArtifact:expected(collisionTwo.artifact),transformationArtifactId:collisionSecond.transformationArtifact.artifactId,projectionArtifactId:collisionSecond.projectionArtifact.artifactId})).projection.kind==="html_dom";
  const hydrateForProbe=async(artifactId:string)=>{const resolver=repository.createTrustedArtifactResolver();await resolver.authorizeArtifact({tenantId,artifactId,purpose:"verification_admission"});return resolver.hydrateRegisteredArtifact({tenantId,artifactId});};
  const collisionProjection=await hydrateForProbe(collisionFirst.projectionArtifact.artifactId);
  await expectFailure("cas_governance_downgrade_rejected",()=>repository.registerContentAddressedArtifact({tenantId,bytes:collisionProjection.bytes,mediaType:collisionFirst.projectionArtifact.mediaType,createdAt,producerActivityId:"forged-reuse",producerVersion:"1",encryptionClass:"supabase-managed",retentionClass:"verification-audit",dataClassification:"public",artifactType:"verification_canonical_projection",bucketClass:"candidate",storageBucket:bucket}),/ARTIFACT_REGISTRATION_COLLISION/);
  const collisionEnvelope=await hydrateForProbe(collisionFirst.transformationArtifact.artifactId);
  await expectFailure("cas_lineage_rebinding_rejected",()=>repository.registerContentAddressedArtifact({tenantId,bytes:collisionEnvelope.bytes,mediaType:collisionFirst.transformationArtifact.mediaType,createdAt,producerActivityId:"forged-reuse",producerVersion:"1",encryptionClass:"supabase-managed",retentionClass:"verification-audit",dataClassification:"restricted",parentArtifactIds:[collisionTwo.artifact.artifactId,collisionFirst.nativeOutputArtifact.artifactId,collisionFirst.projectionArtifact.artifactId],transformationSignature:collisionFirst.transformationArtifact.transformationSignature as `sha256:${string}`,artifactType:"verification_transformation_envelope",bucketClass:"ledger",storageBucket:bucket}),/ARTIFACT_REGISTRATION_COLLISION/);
  const lineageRows=await database.transaction(tenantId,async(client)=>(await client.query<{from_artifact_id:string;to_artifact_id:string;relation_kind:string}>("select from_artifact_id,to_artifact_id,relation_kind from orchestration.artifact_lineage where tenant_id=$1 order by from_artifact_id,to_artifact_id",[tenantId])).rows);
  const expectedEnvelopes=[...pdfReceipts,...htmlReceipts,collisionFirst,collisionSecond];
  checks.persisted_transformation_lineage=lineageRows.length===expectedEnvelopes.length*3&&expectedEnvelopes.every((receipt)=>receipt.transformationArtifact.parentArtifactIds.every((parentArtifactId)=>lineageRows.some((row)=>row.from_artifact_id===receipt.transformationArtifact.artifactId&&row.to_artifact_id===parentArtifactId&&row.relation_kind==="generated")));
  const benchmarkDataset=freezeVerificationBenchmarkDataset({
    schemaVersion:"verification-benchmark.v1",verificationContractVersion:"verification.v1",datasetId:`${namespace}-projection-probe`,version:1,stage:"pilot",frozen:true,supersedesManifestDigest:null,sourcePreparationDigest:sha256Digest(canonicalizeJson({pdf:pdf.artifact.digest,html:html.artifact.digest})),labelProvenance:"engineering_expectations",annotationGuidelinesDigest:sha256Digest("Native projection mechanics only; repeated sources are not independent observations."),adjudicationArtifactDigest:null,createdAt,sealedAt:createdAt,
    cases:Array.from({length:30},(_,index)=>({schemaVersion:"verification-benchmark.v1",caseId:`projection-${index}`,partition:"development",inputManifestArtifactId:pdf.artifact.artifactId,goldArtifactId:null,modality:"pdf",sourceFamily:"tru-diagnostic-retained-captures",entityFamily:"tru-diagnostic",reportCluster:"tru-sample-report",pairCluster:"same-retained-source-pair",tags:["native-projection-mechanics"],adversarialTransforms:[],assertion:"Captured field matches its exact selected bytes.",
      evidence:[
        {fragmentId:"pdf",captureId:pdf.captureId,sourceKey:"tru-pdf",sourceClass:"first_party",projectionArtifactId:pdfTextReceipt.projectionArtifact.artifactId,projectionDigest:pdfTextReceipt.projectionArtifact.digest,transformationArtifactId:pdfTextReceipt.transformationArtifact.artifactId,selector:evidence.selector,selectedContentDigest:sha256Digest(exact),excerpt:exact,rights:"restricted proof fixture",providerUploadAuthorized:false},
        {fragmentId:"html",captureId:html.captureId,sourceKey:"tru-html",sourceClass:"first_party",projectionArtifactId:htmlReceipt.projectionArtifact.artifactId,projectionDigest:htmlReceipt.projectionArtifact.digest,transformationArtifactId:htmlReceipt.transformationArtifact.artifactId,selector:{kind:"html",css:"#standartTime"},selectedContentDigest:sha256Digest(hours),excerpt:hours,rights:"restricted proof fixture",providerUploadAuthorized:false},
        {fragmentId:"mutated-digest",captureId:pdf.captureId,sourceKey:"tru-pdf",sourceClass:"first_party",projectionArtifactId:pdfTextReceipt.projectionArtifact.artifactId,projectionDigest:pdfTextReceipt.projectionArtifact.digest,transformationArtifactId:pdfTextReceipt.transformationArtifact.artifactId,selector:evidence.selector,selectedContentDigest:sha256Digest("29.5"),excerpt:"29.5",rights:"restricted proof fixture",providerUploadAuthorized:false}
      ],expectation:{label:"supported_by_source",labelStatus:"engineering_expectation",expectedPolicy:"pass_with_warnings",expectedLocatorValid:false,support:"full",authority:"interested_party_only",worldCorrectness:"not_established",rationale:"Only exact selector mechanics are tested; one edge intentionally has a mismatched digest."},independentObservation:false,humanGoldScoringEligible:false,adjudicationId:null}))
  });
  const registerBenchmarkJson=async(value:unknown,artifactType:string,parentArtifactIds:string[]=[])=>repository.registerContentAddressedArtifact({tenantId,bytes:new TextEncoder().encode(canonicalizeJson(value)),mediaType:"application/json",createdAt,producerActivityId:"benchmark-native-projection-proof",producerVersion:"1",encryptionClass:"supabase-managed",retentionClass:"verification-audit",dataClassification:"restricted",artifactType,bucketClass:"ledger",storageBucket:bucket,parentArtifactIds,...(parentArtifactIds.length?{transformationSignature:sha256Digest(canonicalizeJson({activity:"benchmark-native-projection-proof",parentArtifactIds}))}:{})});
  const benchmarkDatasetArtifact=await registerBenchmarkJson(benchmarkDataset,"evaluation_dataset_manifest");
  const benchmarkExperimentArtifact=await registerBenchmarkJson({schemaVersion:"verification-benchmark-experiment.v1",verificationContractVersion:"verification.v1",experimentId:`${namespace}-experiment`,datasetManifestDigest:benchmarkDataset.manifestDigest,runnerVersion:"verification-benchmark-runner.v1",randomSeed:17,repetitions:1,arms:diagnosticsBenchmarkArms(),networkPolicy:"offline",recordedObservationArtifacts:[]},"verification_benchmark_experiment",[benchmarkDatasetArtifact.artifactId]);
  const benchmarkGrant={tenantId,dataset:expected(benchmarkDatasetArtifact),experiment:expected(benchmarkExperimentArtifact),runnerVersion:"verification-benchmark-runner.v1"};
  const benchmarkAdmitted=await new RegisteredBenchmarkInputAdmission(new OfflineBenchmarkInputCatalog([benchmarkGrant]),repository.createTrustedArtifactResolver()).load({verificationContractVersion:"verification.v1",dataset:benchmarkGrant.dataset,experimentDefinition:benchmarkGrant.experiment,executionMode:"offline_recorded"},{tenantId});
  const benchmarkPrepared=await prepareRegisteredBenchmarkProjections(benchmarkAdmitted,{tenantId},{captures:repository,admission:service});
  const preparedCases=Object.values(benchmarkPrepared.byCaseId);
  checks.benchmark_registered_inputs_native_projection_preparation=preparedCases.length===30&&preparedCases.every((item)=>Object.keys(item.byFragmentId).length===3&&item.byFragmentId.pdf?.locatorValid===true&&item.byFragmentId.pdf.selectedText===exact&&item.byFragmentId.html?.locatorValid===true&&item.byFragmentId.html.selectedText===hours);
  checks.benchmark_native_projection_digest_mutation_rejected=preparedCases.every((item)=>item.byFragmentId["mutated-digest"]?.locatorValid===false&&item.byFragmentId["mutated-digest"]?.selectedText===undefined);
  checks.benchmark_repeated_sources_not_independent_or_gold=benchmarkAdmitted.dataset.cases.every((item)=>!item.independentObservation&&!item.humanGoldScoringEligible);
  const rows=await database.transaction(tenantId,async(client)=>(await client.query<{artifact_type:string;count:string}>("select artifact_type,count(*)::text as count from orchestration.artifact where tenant_id=$1 group by artifact_type order by artifact_type",[tenantId])).rows);
  const result={status:Object.values(checks).every(Boolean)?"passed":"failed",namespace,tenantId,imageDigest,sourceDigests:{pdf:pdf.artifact.digest,html:html.artifact.digest},benchmarkEvidence:{dataset:expected(benchmarkDatasetArtifact),experiment:expected(benchmarkExperimentArtifact),caseCount:preparedCases.length,evidenceEdgeCount:preparedCases.reduce((sum,item)=>sum+Object.keys(item.byFragmentId).length,0),independentObservations:0,humanGoldCases:0,providerCalls:0},checks,registeredArtifactCounts:rows,persistedTransformationLineageCount:lineageRows.length,receipts:{pdf:pdfReceipts.map((item)=>({projectionKind:item.projectionKind,projectionArtifactId:item.projectionArtifact.artifactId,transformationArtifactId:item.transformationArtifact.artifactId,residualsDigest:item.residualsDigest})),html:htmlReceipts.map((item)=>({projectionKind:item.projectionKind,projectionArtifactId:item.projectionArtifact.artifactId,transformationArtifactId:item.transformationArtifact.artifactId,residualsDigest:item.residualsDigest}))}};
  if(result.status!=="passed")throw new Error(`ADMISSION_PROOF_FAILED:${JSON.stringify(checks)}`);
  const output=resolve("..","internal",`verification-admission-proof-20260905-${namespace.slice(-36)}.json`);
  await writeFile(output,JSON.stringify(result,null,2));
  console.log(JSON.stringify({...result,evidenceFile:output}));
}finally{await database.close();}
