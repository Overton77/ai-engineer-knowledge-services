import { randomUUID } from "node:crypto";
import { mkdtemp,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join,resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe,expect,it,vi } from "vitest";
import { ArtifactLedger,ReadExecutor } from "@aiengineer/knowledge-db-read";
import { ReportService,ReportStructureSchema,IngestionExecutor,IngestionIntentSchema,renderReport,type ReportStructure } from "@aiengineer/knowledge-ingestion";
import { TenantPostgres } from "@aiengineer/knowledge-persistence";
import { SupabaseArtifactStore } from "@aiengineer/knowledge-runtime";
import { loadWorkspace } from "@aiengineer/knowledge-schema-workspace";
import { digestCanonicalJson,sha256Digest } from "@aiengineer/knowledge-verification";

import { VerificationExecutor,loadExecutorConfig } from "../executor.js";
import { PolicyDefinitionInputSchema } from "../intents.js";
import { createExecutorCustody } from "../store-custody-postgres.js";
import { disposableDatabaseUrl,disposableStorageConfig } from "../../../../packages/persistence/test/disposable.mjs";
import { withSnapshot } from "../../../../packages/ingestion/test/snapshot-fixture.mjs";
import { loadSealedReportEvidence,verificationStoreOracle } from "./evidence-oracle.js";
import { ReportAssessmentService,rejectedAssertionText,type ReportAssessmentAuthorityPin } from "./report-assessment.js";
import { prepareReportDependency } from "./report-dependency-fixture.js";
import { createRootExecutorHost, ROOT_REPORT_FORMAT } from "../root-host.js";
import { readRootRecoveryEvidence } from "../root-host-recovery-evidence.js";

const databaseUrl=disposableDatabaseUrl(),storage=disposableStorageConfig();
const policyDigest=digestCanonicalJson({schemaVersion:"verification-policy.v1",definitionId:"policy-executor-default.v1",...PolicyDefinitionInputSchema.parse({})});
const digest=`sha256:${"a".repeat(64)}` as const;
async function sealedRun(executor:VerificationExecutor,text:string,rejected=false) {
  const runId=randomUUID();
  const capture=await executor.captureFile({bytes:new TextEncoder().encode(text),filename:"report-source.txt",sourceUri:`https://synthetic.invalid/${runId}`,runId});
  await executor.verifyClaims({runId,intent:{schemaVersion:"verification-claims-intent.v1",intentId:`claims-${runId}`,claims:[{claimId:"shared-key",proposition:text,qualifiers:["in preview"],claimType:"capability",downstreamUse:["source_attributed_report","knowledge_ingestion:claim.materialize"],evidence:[{captureId:capture.captureId,quote:text}]}]}});
  const semantic = await executor.judgeSemantics({ runId });
  expect(semantic.assessed[0]!.verdict).toBe(rejected ? "contradicted" : "directly_supported");
  await executor.evaluatePolicy({runId});
  const seal=await executor.sealRun({runId});
  const evidence=await loadSealedReportEvidence(executor,{tenantId:executor.store.tenantId,runId,manifestDigest:seal.manifestDigest,policyVersion:"executor-default.v1",policyDigest});
  return {runId,manifestDigest:seal.manifestDigest,auditArtifact:evidence.auditArtifact,claim:evidence.reportClaims.get("shared-key")!,capture};
}

describe.skipIf(!databaseUrl||!storage)("report final-byte admission on guarded PostgreSQL and Storage",()=>{
  it("authenticates multi-run collision bindings, both authoring modes, honest rejection and immutable post-seal receipts",async()=>{
    const tenantId=randomUUID(),missionId=randomUUID(),workItemId=randomUUID(),attemptId=randomUUID(),verifierAttemptId=randomUUID();
    const directory=await mkdtemp(join(tmpdir(),"ks-report-admission-")),db=new TenantPostgres({connectionString:databaseUrl!});
    const custody=createExecutorCustody({databaseUrl:databaseUrl!,tenantId,...storage!,producerAttemptId:attemptId,missionId});
    try {
      await db.transaction({tenantId},async client=>{
        await client.query("insert into orchestration.mission(id,tenant_id,goal) values($1,$2,'P3 report synthetic proof')",[missionId,tenantId]);
        await client.query("insert into orchestration.work_item(id,tenant_id,mission_id,kind) values($1,$2,$3,'build_vectors')",[workItemId,tenantId,missionId]);
        await client.query("insert into orchestration.attempt(id,tenant_id,work_item_id,attempt_no,agent_deployment_id) values($1,$2,$3,1,'p3-report-producer'),($4,$2,$3,2,'p3-report-verifier')",[attemptId,tenantId,workItemId,verifierAttemptId]);
      });
      const verification=await VerificationExecutor.create({ ...loadExecutorConfig({VERIFY_STORE_DIR:directory,VERIFY_TENANT_ID:tenantId,VERIFY_GIT_SHA:"p3-report-proof",VERIFY_PRODUCER_ATTEMPT_ID:attemptId,VERIFY_VERIFIER_ATTEMPT_ID:verifierAttemptId,VERIFY_PRODUCER_DEPLOYMENT_ID:"p3-report-producer",VERIFY_VERIFIER_DEPLOYMENT_ID:"p3-report-verifier",AI_GATEWAY_API_KEY:"synthetic-no-provider"}),
        semanticJudgeAdapterFactory: config => ({ identity: { ...config.identity, provider: "synthetic", family: "synthetic", model: "report-proof" },
          maximumInputCharacters: 64000, judge: async input => {
            const rejected = input.proposition === "A rejected capability operates in preview." || input.assertionId === "duplicate-original";
            const fragments = input.fragments.map(fragment => fragment.fragmentId);
            return { schemaVersion: "verification-semantic-judge.v1", assertionId: input.assertionId,
              verdict: rejected ? "contradicted" : "directly_supported", nliLabel: rejected ? "contradicted" : "entailed",
              supportingFragmentIds: rejected ? [] : fragments, contradictingFragmentIds: rejected ? fragments : [],
              unsupportedFacets: [], qualifiersPreserved: true, publicRationale: "Explicit synthetic disposable report proof; no provider judgment." };
          } }) });
      verification.store.attachCustody(custody);
      const first=await sealedRun(verification,"🧪 Cafe\u0301 operates in preview."),second=await sealedRun(verification,"Another organization operates in preview."),rejected=await sealedRun(verification,"A rejected capability operates in preview.",true);
      const remoteStore=new SupabaseArtifactStore({...storage!,serviceRoleKey:storage!.secretKey,bucket:"research-reports",maximumBytes:64000000});
      const artifacts=new ArtifactLedger({db,store:remoteStore,bucket:"research-reports",uploaded:true,executorVersion:"p3-report-proof"});
      const reports=new ReportService({db,artifacts}),pins=new Map<string,ReportAssessmentAuthorityPin>();
      const assessment=new ReportAssessmentService({db,reports,artifacts,verification,tenantId,policyVersion:"executor-default.v1",policyDigest,authority:{forReport:async input=>input.tenantId===tenantId?pins.get(input.revisionId):undefined}});
      const references=[first,second,rejected].map(run=>({runId:run.runId,claimId:"shared-key",digest:run.claim.digest,evidenceManifest:run.auditArtifact,role:"supports" as const}));
      const texts=[first.claim.assertion.proposition,second.claim.assertion.proposition,rejectedAssertionText(rejected.claim)];
      const markdowns=[`| Organization | Capability |\n|---|---|\n| One | ${texts[0]} |`,`Figure 1: ${texts[1]}`,texts[2]!];
      const makeReport=(authoringMode:"incremental"|"post_research")=>ReportStructureSchema.parse({schemaVersion:"research-report.v1",reportId:randomUUID(),revisionId:randomUUID(),version:1,title:"Synthetic capability research",slug:`report-${randomUUID()}`,reportType:"research_synthesis",purpose:"Compare capabilities and rejected claims",authoringMode,asOf:"2026-09-14T00:00:00Z",scope:{synthetic:true},producer:{identity:"p3-report-producer",version:"1",attemptId},
        questions:[{key:"q1",question:"What capabilities are supported?",required:true,coverage:"answered",explanation:"",sectionKeys:["findings"]},{key:"q2",question:"What is rejected or unresolved?",required:true,coverage:"answered",explanation:"Rejection is disclosed.",sectionKeys:["findings"]}],
        sections:[{key:"findings",heading:"Findings",kind:"comparison",blocks:markdowns.map((markdown,index)=>({key:`b${index}`,markdown,assertions:[{key:`a${index}`,start:markdown.indexOf(texts[index]!),end:markdown.indexOf(texts[index]!)+texts[index]!.length,kind:"reported",qualifiers:["in preview"],claims:[references[index]],derivation:index===2?{kind:"verification_outcome",runId:rejected.runId,claimId:"shared-key",verdict:rejected.claim.verdict,policyOutcome:rejected.claim.policyOutcome}:{}}]}))}]});
      const pinReport=async(report:ReportStructure,original=report)=>{
        const originalMarkdown=renderReport(original).markdown;
        const structuralSpans=([{text:"# Synthetic capability research",role:"report_title"},{text:"## Findings",role:"section_heading"},{text:"| Organization | Capability |",role:"table_header"},{text:" One ",role:"table_label"},{text:"Figure 1: ",role:"caption_prefix"}] as const).map(({text,role})=>({text,role,start:originalMarkdown.indexOf(text),end:originalMarkdown.indexOf(text)+text.length}));
        const requirements=await artifacts.put({tenantId,artifactType:"research_report_verification",mediaType:"application/json",text:JSON.stringify({schemaVersion:"research-report-requirements.v1",tenantId,reportVersionId:report.revisionId,
          structuralSpans,
          originalQuestions:original.questions.map(({key,question})=>({key,question,requiredAssertionKeys:key==="q1"?["a0","a1"]:["a2"]})),requiredAssertions:renderReport(original).assertions.map(item=>({key:item.assertion.key,proposition:item.proposition,kind:item.assertion.kind,qualifiers:item.assertion.qualifiers}))})});
        pins.set(report.revisionId,{requirements:{artifactId:requirements.artifactId,digest:requirements.digest},runs:[first,second,rejected].map(({runId,manifestDigest,auditArtifact})=>({runId,manifestDigest,auditArtifact}))});
      };
      const report=makeReport("incremental");
      await expect(assessment.assess({reportVersionId:report.revisionId})).rejects.toMatchObject({code:"REPORT_ASSESSMENT_AUTHORITY_REQUIRED"});
      await pinReport(report);expect(await reports.register({tenantId,report})).toMatchObject({registration:"sealed",admission:"not_evaluated"});
      const approved=await assessment.assess({reportVersionId:report.revisionId});
      expect(approved.admission,JSON.stringify(approved.problems)).toBe("pass");expect(approved.assertions[2]).toMatchObject({disposition:"faithful_rejection",factEligible:false});
      expect((await artifacts.get(tenantId,approved.resultArtifact.artifactId)).json).toMatchObject({assertions:approved.assertions});
      expect((await assessment.assess({reportVersionId:report.revisionId})).assessmentId).toBe(approved.assessmentId);
      const post=makeReport("post_research");await pinReport(post);await reports.register({tenantId,report:post});expect((await assessment.assess({reportVersionId:post.revisionId})).admission).toBe("pass");
      for(const mutation of ["missing-reference","wrong-run","missing-question","missing-assertion","unbound-prose","unbound-table","unbound-caption","answered-without-assertions"]){
        const changed=makeReport("post_research"),original=structuredClone(changed);
        if(mutation==="missing-reference")changed.sections[0]!.blocks[0]!.assertions[0]!.claims[0]!.claimId="missing";
        if(mutation==="wrong-run")changed.sections[0]!.blocks[0]!.assertions[0]!.claims[0]!.runId=second.runId;
        if(mutation==="missing-question")changed.questions.pop();
        if(mutation==="missing-assertion")changed.sections[0]!.blocks[0]!.assertions=[];
        if(mutation==="unbound-prose")changed.sections[0]!.blocks[0]!.markdown+=" The API is free.";
        if(mutation==="unbound-table")changed.sections[0]!.blocks[0]!.markdown+="\n| Extra provider | Unlimited free access |";
        if(mutation==="unbound-caption")changed.sections[0]!.blocks[0]!.markdown+="\nFigure 2: Unlimited production access";
        if(mutation==="answered-without-assertions"){changed.sections.push({key:"empty",heading:"Empty",kind:"methods",context:{},dependencies:[],blocks:[{key:"space",markdown:" ",assertions:[]}]});changed.questions[0]!.sectionKeys=["empty"];}
        await pinReport(changed,original);await reports.register({tenantId,report:changed});expect((await assessment.assess({reportVersionId:changed.revisionId})).admission).toBe("fail");
      }
      const realGet=artifacts.get.bind(artifacts),readSpy=vi.spyOn(artifacts,"get").mockImplementation(async(tenant,id)=>{const value=await realGet(tenant,id);return id===approved.finalMarkdown.artifactId?{...value,text:value.text+"changed"}:value;});
      await expect(assessment.assess({reportVersionId:report.revisionId})).rejects.toMatchObject({code:"REPORT_FINAL_BYTES_MISMATCH"});readSpy.mockRestore();
      const ledgerStore=new SupabaseArtifactStore({...storage!,serviceRoleKey:storage!.secretKey,bucket:"research-ingestion-intents",maximumBytes:64000000});
      const ledger=new ArtifactLedger({db,store:ledgerStore,bucket:"research-ingestion-intents",uploaded:true,executorVersion:"p3-report-proof"});
      const workspace=loadWorkspace(resolve(import.meta.dirname,"../../../../../ai-engineer-db-contract/workspace"));
      const reads=new ReadExecutor({db,artifacts:ledger,workspace,executorVersion:"p3-report-proof"});
      const ingestion=new IngestionExecutor({db,artifacts:ledger,workspace,executorVersion:"p3-report-proof",evidence:verificationStoreOracle(verification,{tenantId,policyVersion:"executor-default.v1",policyDigest})});
      const intent=IngestionIntentSchema.parse({schemaVersion:"knowledge-ingestion-intent.v1",intentId:"p3-report-apply",context:{tenantId,missionId,attemptId},evidence:{verificationRuns:[{runId:first.runId,manifestDigest:first.manifestDigest}]},proposals:[{kind:"claim.materialize",proposalId:"materialize",runId:first.runId,claimIds:["shared-key"],reportBinding:{reportVersionId:report.revisionId,assertionKey:"a0"}},{kind:"candidate.stage",proposalId:"review",entityKind:"organization",displayName:"Unresolved identity",reason:"needs_human",reportBinding:{reportVersionId:report.revisionId,assertionKey:"a2"}}]});
      const applied=await ingestion.apply(await withSnapshot(reads,intent));expect(applied.outcome).toBe("partial");
      const { collectReportEvidence, collectIngestionEvidence } = await import(pathToFileURL(resolve(import.meta.dirname,
        "../../../../../research_ingestion_systems_agent/tools/team/t14-collection.mjs")).href);
      const collectionArtifacts = new ArtifactLedger({ db, store: ledgerStore, bucket: "research-ingestion-intents",
        uploaded: true, executorVersion: "p3-report-proof", readStores: { "research-reports": remoteStore,
          "ai-engineer-cloud-bucket": new SupabaseArtifactStore({ projectUrl: storage!.projectUrl, serviceRoleKey: storage!.secretKey,
            bucket: "ai-engineer-cloud-bucket", maximumBytes: 64_000_000 }) } });
      const request = async (name: string, input: Record<string, string>) => {
        if (name === "report_assess") return assessment.assess({ reportVersionId: input.reportVersionId! });
        if (name === "artifact_get") return collectionArtifacts.get(tenantId, input.artifactId!);
        if (name === "ingest_receipt") return ingestion.receipt(input.receiptId!, tenantId);
        throw new Error("UNEXPECTED_COLLECTION_OPERATION");
      };
      const reportScope = { reportVersionId: report.revisionId, tenantId, originalQuestions: report.questions,
        allowedRunIds: [first.runId, second.runId, rejected.runId], policyVersion: "executor-default.v1", policyDigest, request };
      expect((await collectReportEvidence(reportScope)).receipts).toHaveLength(5);
      await expect(collectReportEvidence({ ...reportScope, allowedRunIds: [first.runId] })).rejects.toThrow("REPORT_RUN_SCOPE");
      await expect(collectReportEvidence({ ...reportScope, originalQuestions: [] })).rejects.toThrow("REPORT_QUESTION_SCOPE");
      const ingestionScope = { receiptIds: [applied.receiptId], tenantId, missionId, attemptId, request };
      expect((await collectIngestionEvidence(ingestionScope))[0].receipt.receiptId).toBe(applied.receiptId);
      await expect(collectIngestionEvidence({ ...ingestionScope, attemptId: randomUUID() })).rejects.toThrow("INGESTION_AUTHORITY");
      const duplicate=IngestionIntentSchema.parse({...intent,intentId:"p3-report-noop",proposals:[intent.proposals[0]]});
      const noop=await ingestion.apply(await withSnapshot(reads,duplicate));expect(noop.proposals[0]!.outcome).toBe("no_op_duplicate");
      const packageRead=await reports.get({tenantId,reportVersionId:report.revisionId});
      expect(packageRead.ingestionLinks.map(row=>row.outcome).sort()).toEqual(["applied","held","no_op"]);
      expect(packageRead.assessments).toHaveLength(1);expect(packageRead.seal).not.toBeNull();
      expect((await realGet(tenantId,approved.finalMarkdown.artifactId)).record.digest).toBe(approved.finalMarkdown.digest);
      await expect(db.transaction({tenantId,role:"executor_service"},client=>client.query("update research.report_assessment set report_digest=repeat('f',64) where id=$1",[approved.assessmentId]))).rejects.toThrow();
      await expect(db.transaction({tenantId,role:"executor_service"},client=>client.query("delete from research.report_ingestion_link where report_version_id=$1",[report.revisionId]))).rejects.toThrow();
      let coverageJudgeCalls = 0;
      const rootReport = makeReport("post_research");
      rootReport.title = ROOT_REPORT_FORMAT.title;
      rootReport.sections[0]!.blocks.forEach((block, index) => {
        block.markdown = texts[index]!;
        block.assertions[0]!.start = 0;
        block.assertions[0]!.end = block.markdown.length;
      });
      await reports.register({ tenantId, report: rootReport });
      let accountingObservation: unknown = null;
      const { DispatchBudget } = await import(pathToFileURL(resolve(import.meta.dirname,
        "../../../../../research_ingestion_systems_agent/tools/team/t14-budget.mjs")).href);
      const { AttemptLedger } = await import(pathToFileURL(resolve(import.meta.dirname,
        "../../../../../research_ingestion_systems_agent/tools/team/t14-ledger.mjs")).href);
      const accountingJournal = new AttemptLedger(join(directory, "zero-dispatch-journal.jsonl"), {
        sliceDigest: "a".repeat(64), approvalDigest: "b".repeat(64), maximumMicros: 1000, maximumAttemptMicros: 600 });
      const accountingBudget = new DispatchBudget({ ledger: accountingJournal, attemptId,
        maximumMicros: 600, maximumCalls: 6, callBounds: { judge: 100 } });
      let useZeroDispatchJournal = false;
      const pendingRecoveryRun = randomUUID();
      const mechanicalRecoveryRun = randomUUID();
      const coverageOptions: Parameters<typeof createRootExecutorHost>[0] = { host: "127.0.0.1", port: 0, token: randomUUID(),
        readVerificationUsage: scope => useZeroDispatchJournal ? accountingBudget.settledRun(scope) : accountingObservation,
        verificationAccountingLifecycle: { begin: scope => accountingBudget.beginVerification(scope),
          close: execution => accountingBudget.closeVerification(execution) },
        env: { KNOWLEDGE_DB_URL: databaseUrl!, VERIFY_TENANT_ID: tenantId, KNOWLEDGE_MISSION_ID: missionId,
          VERIFY_PRODUCER_ATTEMPT_ID: attemptId, VERIFY_VERIFIER_ATTEMPT_ID: verifierAttemptId,
          KNOWLEDGE_PRODUCER_ATTEMPT_ID: attemptId, VERIFY_PRODUCER_DEPLOYMENT_ID: "p3-report-producer",
          VERIFY_VERIFIER_DEPLOYMENT_ID: "p3-report-verifier", VERIFY_STORE_DIR: directory,
          KNOWLEDGE_ARTIFACT_DIR: join(directory, "coverage-ledger"), KNOWLEDGE_ARTIFACT_STORAGE: "supabase",
          KNOWLEDGE_CONTENT_LINKS_ENABLED: "1",
          SUPABASE_URL: storage!.projectUrl, SUPABASE_SECRET_KEY: storage!.secretKey,
          SCHEMA_WORKSPACE_DIR: resolve(import.meta.dirname, "../../../../../ai-engineer-db-contract/workspace"),
          VERIFY_GIT_SHA: "synthetic-canonical-coverage-proof", AI_GATEWAY_API_KEY: "synthetic-no-provider" },
        reportScope: { originalQuestions: rootReport.questions.map(({ key, question }) => ({ key, question })),
          runIds: [first.runId, second.runId, rejected.runId, pendingRecoveryRun, mechanicalRecoveryRun] },
        coverageScope: { questionId: "q1", facets: [{ id: "first", proposition: texts[0]!, qualifiers: ["in preview"] },
          { id: "second", proposition: texts[1]!, qualifiers: ["in preview"] }] },
        semanticJudgeAdapterFactory: config => ({ identity: { ...config.identity, provider: "synthetic", family: "synthetic", model: "literal-coverage-test" },
          maximumInputCharacters: 64000, judge: async input => {
            coverageJudgeCalls++;
            const covered = input.fragments.some(fragment => fragment.exactText.includes(input.proposition));
            return { schemaVersion: "verification-semantic-judge.v1", assertionId: input.assertionId,
              verdict: covered ? "directly_supported" : "not_supported", nliLabel: covered ? "entailed" : "neutral",
              supportingFragmentIds: covered ? input.fragments.map(fragment => fragment.fragmentId) : [],
              contradictingFragmentIds: [], unsupportedFacets: covered ? [] : ["missing_required_facet"], qualifiersPreserved: true,
              publicRationale: "Explicit deterministic synthetic fixture adapter; no live provider quality evidence." };
          } }) };
      const coverageHost = await createRootExecutorHost(coverageOptions).catch(error => { accountingJournal.close(); throw error; });
      try {
        const recoveryCapture = await verification.captureFile({ bytes: new TextEncoder().encode("Recovery original"),
          filename: "recovery-original.txt", runId: pendingRecoveryRun });
        const originalRecovery = await coverageHost.retainClaimSubmission({ runId: pendingRecoveryRun, intent: {
          schemaVersion: "verification-claims-intent.v1", intentId: "original-recovery", claims: ["original", "duplicate-original"].map(claimId => ({ claimId,
            proposition: "Recovery original", evidence: [{ captureId: recoveryCapture.captureId, quote: "Recovery original" }] })) } });
        const recoveryAuthorizationInput = { runId: pendingRecoveryRun, operationId: originalRecovery.operationId,
          limits: { maxRoundsPerOriginal: 2, maxProbeRounds: 1, remainingCalls: 8, remainingCostMicros: 1000,
            deadline: new Date(Date.now() + 120000).toISOString() } };
        const authorization = await coverageHost.authorizeRecoverySubmission(recoveryAuthorizationInput);
        expect(authorization.value.batch.items[0]).toMatchObject({ originalId: "original", usedRounds: 0,
          observation: { execution: "pending", operationId: originalRecovery.operationId } });
        expect(authorization.value.batch.questionIds).toEqual(rootReport.questions.map(question => question.key));
        expect(await coverageHost.authorizeRecoverySubmission(recoveryAuthorizationInput)).toEqual(authorization);
        await expect(coverageHost.authorizeRecoverySubmission({ ...recoveryAuthorizationInput,
          limits: { ...recoveryAuthorizationInput.limits, remainingCostMicros: 999 } })).rejects.toThrow("ROOT_RECOVERY_AUTHORIZATION_IMMUTABLE");
        expect((await coverageHost.restoreKnowledgeArtifact({ artifactId: authorization.artifact.artifactId,
          digest: authorization.artifact.digest })).verifiedDigest).toBe(authorization.artifact.digest);
        const originalResultRequest = { runId: pendingRecoveryRun, operationId: originalRecovery.operationId,
          inputDigest: authorization.value.batch.items[0]!.inputDigest, originalId: "original" };
        expect(await coverageHost.readRecoveryResult(originalResultRequest)).toBeNull();
        const pendingRecoveryBatch = await coverageHost.readRecoveryBatch(pendingRecoveryRun);
        expect(pendingRecoveryBatch!.batch.items.map(item => item.observation.execution)).toEqual(["pending", "pending"]);
        await verification.verifyClaims({ runId: pendingRecoveryRun, intent: originalRecovery.value.intent });
        await verification.judgeSemantics({ runId: pendingRecoveryRun });
        await verification.evaluatePolicy({ runId: pendingRecoveryRun });
        const originalSeal = await verification.sealRun({ runId: pendingRecoveryRun });
        expect((await coverageHost.recordVerificationCompletion({ runId: pendingRecoveryRun, ...originalRecovery })).recovery).toBeNull();
        expect(await coverageHost.readRecoveryResult(originalResultRequest)).toBeNull();
        useZeroDispatchJournal = true;
        const zeroDispatchCompletion = await coverageHost.recordVerificationCompletion({ runId: pendingRecoveryRun, ...originalRecovery });
        expect(zeroDispatchCompletion.accounting!.value.usage).toMatchObject({ calls: 0, costMicros: 0 });
        expect(zeroDispatchCompletion.accounting!.value.usage.executions[0]!.lifecycle).toBeDefined();
        expect(zeroDispatchCompletion.recovery).toMatchObject({ state: "ready", submitted: 2 });
        accountingObservation = structuredClone(zeroDispatchCompletion.accounting!.value.usage);
        delete (accountingObservation as { executions: { lifecycle?: unknown }[] }).executions[0]!.lifecycle;
        useZeroDispatchJournal = false;
        await expect(coverageHost.recordVerificationCompletion({ runId: pendingRecoveryRun, ...originalRecovery }))
          .rejects.toThrow("ROOT_ACCOUNTING_ZERO_DISPATCH_PROOF_REQUIRED");
        const originalResultHandle = await verification.store.resolveHandle({ artifactId:
          (await verification.store.readRun(pendingRecoveryRun)).resultArtifactId! });
        accountingObservation = { tenantId, runId: pendingRecoveryRun, calls: 2, costMicros: 14, executions: [{
          execution: { tenantId, runId: pendingRecoveryRun, resultArtifactId: originalResultHandle.artifactId, resultDigest: originalResultHandle.digest },
          calls: 2, costMicros: 14, evidence: ["original", "duplicate-original"].map(callId => ({ callId, requestDigest: digest,
            reservationDigest: "c".repeat(64), settlementDigest: "d".repeat(64) })) }] };
        const recoveredCompletion = await coverageHost.recordVerificationCompletion({ runId: pendingRecoveryRun, ...originalRecovery });
        expect(recoveredCompletion.recovery).toMatchObject({ caseId: authorization.value.batch.caseId,
          state: "ready", submitted: 2, questionDenominator: 2 });
        expect(recoveredCompletion.recovery!.items.map(item => item.originalId)).toEqual(["original", "duplicate-original"]);
        expect(recoveredCompletion.recovery!.artifacts.length).toBeGreaterThan(0);
        expect(await coverageHost.observeRecovery(pendingRecoveryRun)).toEqual(recoveredCompletion.recovery);
        const originalRecoveryResult = await coverageHost.readRecoveryResult(originalResultRequest);
        expect(originalRecoveryResult).toMatchObject({ usage: { calls: 2, costMicros: 14 }, coveredRequirementIds: [],
          observation: { operationId: originalRecovery.operationId, execution: "completed", mechanical: "passed", semantic: "directly_supported" } });
        expect(authorization.value.batch.items).toHaveLength(2);
        expect(authorization.value.batch.items[1]!.inputDigest).toBe(originalResultRequest.inputDigest);
        expect(await coverageHost.readRecoveryResult({ ...originalResultRequest, originalId: "duplicate-original" })).toMatchObject({
          usage: { calls: 2, costMicros: 14 }, observation: { execution: "completed", semantic: "contradicted" } });
        await expect(coverageHost.readRecoveryResult({ ...originalResultRequest, originalId: undefined })).rejects.toThrow("ROOT_RECOVERY_ORIGINAL_BINDING");
        expect(originalSeal.manifestDigest).toBeDefined();
        const completedRecoveryBatch = await coverageHost.readRecoveryBatch(pendingRecoveryRun);
        expect(completedRecoveryBatch!.batch.items.map(item => item.originalId)).toEqual(["original", "duplicate-original"]);
        expect(completedRecoveryBatch!.batch.items.map(item => item.observation.semantic)).toEqual(["directly_supported", "contradicted"]);
        expect(completedRecoveryBatch!.batch.closedAt).toBeDefined();
        await expect(coverageHost.readRecoveryResult({ ...originalResultRequest, inputDigest: digest })).rejects.toThrow("ROOT_RECOVERY_ORIGINAL_BINDING");
        accountingObservation = null;
        const mechanicalSubmission = await coverageHost.retainClaimSubmission({ runId: mechanicalRecoveryRun, intent: {
          schemaVersion: "verification-claims-intent.v1", intentId: "mechanical-recovery", claims: [{ claimId: "missing-quote",
            proposition: "A claim with missing evidence", evidence: [{ captureId: recoveryCapture.captureId, quote: "This quote is absent" }] }] } });
        const mechanicalAuthorization = await coverageHost.authorizeRecoverySubmission({ runId: mechanicalRecoveryRun,
          operationId: mechanicalSubmission.operationId, limits: { ...recoveryAuthorizationInput.limits,
            deadline: new Date(Date.now() + 120000).toISOString() } });
        await verification.verifyClaims({ runId: mechanicalRecoveryRun, intent: mechanicalSubmission.value.intent });
        await expect(verification.judgeSemantics({ runId: mechanicalRecoveryRun })).rejects.toThrow("RUN_NOT_SEMANTICALLY_ELIGIBLE");
        await verification.evaluatePolicy({ runId: mechanicalRecoveryRun });
        await verification.sealRun({ runId: mechanicalRecoveryRun });
        useZeroDispatchJournal = true;
        const mechanicalCompletion = await coverageHost.recordVerificationCompletion({ runId: mechanicalRecoveryRun, ...mechanicalSubmission });
        expect(mechanicalCompletion.accounting!.value.usage).toMatchObject({ calls: 0, costMicros: 0 });
        expect(mechanicalCompletion.recovery).toMatchObject({ state: "ready", submitted: 1, questionDenominator: 2 });
        const mechanicalResultRequest = { runId: mechanicalRecoveryRun, operationId: mechanicalSubmission.operationId,
          inputDigest: mechanicalAuthorization.value.batch.items[0]!.inputDigest, originalId: "missing-quote" };
        const mechanicalResult = await coverageHost.readRecoveryResult(mechanicalResultRequest);
        expect(mechanicalResult).toMatchObject({ usage: { calls: 0, costMicros: 0 }, coveredRequirementIds: [],
          observation: { execution: "completed", mechanical: "failed", family: "selector" } });
        expect(mechanicalResult!.verifiedStages).not.toContain("semantic");
        useZeroDispatchJournal = false;
        const { collectOriginalSubmissions, collectCaptureEvidence, collectVerificationEvidence } = await import(pathToFileURL(resolve(import.meta.dirname,
          "../../../../../research_ingestion_systems_agent/tools/team/t14-collection.mjs")).href);
        const sealed = await coverageHost.inspectRun(first.runId);
        const firstState = (await verification.runStatus({ runId: first.runId })).state;
        const submission = await coverageHost.retainClaimSubmission({ runId: first.runId, intentArtifactId: firstState.intentArtifactId! });
        const submissionScope = { submissions: [{ artifactId: submission.artifactId, digest: submission.digest }], sealed,
          tenantId, missionId, attemptId, originalQuestions: rootReport.questions.map(({ key, question }) => ({ key, question })), request };
        expect((await collectOriginalSubmissions(submissionScope)).originalClaimIds).toEqual(["shared-key"]);
        expect((await coverageHost.restoreKnowledgeArtifact(submission)).verifiedDigest).toBe(submission.digest);
        const completionBinding = { runId: first.runId, artifactId: submission.artifactId, digest: submission.digest };
        const completion = await coverageHost.recordVerificationCompletion(completionBinding);
        await expect(coverageHost.authorizeRecoverySubmission({ ...recoveryAuthorizationInput,
          runId: first.runId, operationId: submission.operationId })).rejects.toThrow("ROOT_RECOVERY_AUTHORIZATION_TOO_LATE");
        expect(completion.operationId).toBe(submission.operationId);
        expect(completion.summary.usage).toBeNull();
        const repeatedSeal = await verification.sealRun({ runId: first.runId });
        expect(repeatedSeal.auditArtifactId).toBe(completion.summary.auditArtifact.artifactId);
        expect(repeatedSeal.manifestDigest).toBe(completion.summary.manifestDigest);
        expect(await coverageHost.recordVerificationCompletion(completionBinding)).toEqual(completion);
        const canonicalReceipt = await db.transaction({ tenantId }, client => client.query(
          "select changes_summary from orchestration.operation_receipt where id=$1 and intent_id=$2", [completion.receiptId, submission.operationId]));
        expect(canonicalReceipt.rows[0]?.changes_summary).toEqual(completion.summary);
        expect(completion.accounting).toBeNull();
        const resultHandle = await verification.store.resolveHandle({ artifactId: sealed.resultArtifactId });
        const syntheticUsage = { tenantId, runId: first.runId, calls: 1, costMicros: 17, executions: [{
          execution: { tenantId, runId: first.runId, resultArtifactId: resultHandle.artifactId, resultDigest: resultHandle.digest },
          calls: 1, costMicros: 17, evidence: [{ callId: "synthetic-accounting-test-only", requestDigest: digest,
            reservationDigest: "a".repeat(64), settlementDigest: "b".repeat(64) }] }] };
        accountingObservation = syntheticUsage;
        const accounted = await coverageHost.recordVerificationCompletion(completionBinding);
        expect(accounted.summary).toEqual(completion.summary);
        expect(accounted.accounting!.value.usage.costMicros).toBe(17);
        expect((await coverageHost.restoreKnowledgeArtifact(accounted.accounting!)).verifiedDigest).toBe(accounted.accounting!.digest);
        expect(await coverageHost.recordVerificationCompletion(completionBinding)).toEqual(accounted);
        accountingObservation = { ...syntheticUsage, costMicros: 0 };
        await expect(coverageHost.recordVerificationCompletion(completionBinding)).rejects.toThrow("ROOT_ACCOUNTING_SCOPE_OR_TOTAL");
        const corruptedUsage = structuredClone(syntheticUsage);
        corruptedUsage.executions[0]!.execution.resultDigest = `sha256:${"0".repeat(64)}`;
        accountingObservation = corruptedUsage;
        await expect(coverageHost.recordVerificationCompletion(completionBinding)).rejects.toThrow("ROOT_ACCOUNTING_RESULT_CUSTODY");
        accountingObservation = null;
        await expect(collectOriginalSubmissions({ ...submissionScope, sealed: { ...sealed, claims: [] } }))
          .rejects.toThrow("COLLECTION_ORIGINAL_CLAIM_DROPPED_OR_CHANGED");
        await expect(collectOriginalSubmissions({ ...submissionScope, originalQuestions: [] }))
          .rejects.toThrow("COLLECTION_ORIGINAL_SUBMISSION_BINDING");
        const rewritten = structuredClone(submission.value.intent);
        rewritten.claims[0]!.proposition = "A replacement proposition.";
        const changedSubmission = await coverageHost.retainClaimSubmission({ runId: first.runId, intent: rewritten });
        const history = await coverageHost.readVerificationHistory(first.runId);
        expect(history).toHaveLength(2);
        expect(history.find(item => item.operationId === completion.operationId)?.accounting).toEqual([accounted.accounting]);
        expect(history.find(item => item.operationId === completion.operationId)?.settledAccounting).toEqual(accounted.accounting);
        expect(history.find(item => item.operationId === changedSubmission.operationId)?.accounting).toEqual([]);
        expect(history.find(item => item.operationId === changedSubmission.operationId)?.settledAccounting).toBeNull();
        expect(history.find(item => item.operationId === completion.operationId)?.completion?.receiptId).toBe(completion.receiptId);
        expect(history.find(item => item.operationId === changedSubmission.operationId)?.completion).toBeNull();
        expect(await coverageHost.readVerificationHistory(second.runId)).toEqual([]);
        const recoveryReference = { runId: first.runId, operationId: completion.operationId };
        const recoveryEvidence = await coverageHost.readRecoveryEvidence(recoveryReference);
        expect(recoveryEvidence!.artifacts.result).toBe(sealed.resultArtifactId);
        expect(await coverageHost.readRecoveryEvidence({ ...recoveryReference, operationId: changedSubmission.operationId })).toBeNull();
        const forgedRecord = structuredClone(history.find(item => item.operationId === completion.operationId)!);
        forgedRecord.completion!.summary.resultArtifactId = randomUUID();
        await expect(readRootRecoveryEvidence({ store: verification.store, record: forgedRecord })).rejects.toThrow("ROOT_RECOVERY_RESULT_BINDING");
        await expect(coverageHost.readVerificationHistory(randomUUID())).rejects.toThrow("ROOT_SUBMISSION_RUN_NOT_AUTHORIZED");
        const reopened = await createRootExecutorHost({ ...coverageOptions, env: { ...coverageOptions.env,
          VERIFY_STORE_DIR: join(directory, "empty-restarted-store"), KNOWLEDGE_ARTIFACT_DIR: join(directory, "empty-restarted-ledger") } });
        try {
          expect(await reopened.readVerificationHistory(first.runId)).toEqual(history);
          expect(await reopened.readRecoveryEvidence(recoveryReference)).toEqual(recoveryEvidence);
          expect(await reopened.authorizeRecoverySubmission(recoveryAuthorizationInput)).toEqual(authorization);
          expect(await reopened.readRecoveryResult(originalResultRequest)).toEqual(originalRecoveryResult);
          expect(await reopened.readRecoveryBatch(pendingRecoveryRun)).toEqual(completedRecoveryBatch);
          expect(await reopened.observeRecovery(pendingRecoveryRun)).toEqual(recoveredCompletion.recovery);
          expect(await reopened.readRecoveryResult(mechanicalResultRequest)).toEqual(mechanicalResult);
          expect(await reopened.observeRecovery(mechanicalRecoveryRun)).toEqual(mechanicalCompletion.recovery);
        }
        finally { await reopened.close(); }
        await expect(coverageHost.recordVerificationCompletion({ runId: first.runId, artifactId: changedSubmission.artifactId,
          digest: changedSubmission.digest })).rejects.toThrow("ROOT_VERIFICATION_SUBMISSION_CUSTODY");
        await expect(collectOriginalSubmissions({ ...submissionScope, submissions: [...submissionScope.submissions,
          { artifactId: changedSubmission.artifactId, digest: changedSubmission.digest }] }))
          .rejects.toThrow("COLLECTION_ORIGINAL_CLAIM_REWRITTEN");
        expect(collectVerificationEvidence({ sealed, tenantId, runId: first.runId }).assertionCount).toBe(1);
        const rejectedSealed = await coverageHost.inspectRun(rejected.runId);
        const rejectedScope = { sealed: rejectedSealed, tenantId, runId: rejected.runId,
          requiredRejectedProposition: rejected.claim.assertion.proposition! };
        expect(collectVerificationEvidence(rejectedScope).dispositions[0]).toMatchObject({ eligible: false, verdict: "contradicted" });
        expect(() => collectVerificationEvidence({ ...rejectedScope, requiredRejectedProposition: "Dropped original assertion" }))
          .toThrow("COLLECTION_ORIGINAL_REJECTION_MISSING");
        expect(() => collectVerificationEvidence({ sealed, tenantId, runId: first.runId, requiredRejectedProposition: texts[0]! }))
          .toThrow("COLLECTION_ORIGINAL_NOT_REJECTED");
        expect(() => collectVerificationEvidence({ ...rejectedScope, sealed: { ...rejectedSealed, claims: [] } }))
          .toThrow("COLLECTION_VERIFICATION_DENOMINATOR");
        const captureScope = { sealed, tenantId, runId: first.runId,
          source: { uri: `https://synthetic.invalid/${first.runId}`, text: texts[0]!, sha256: sha256Digest(texts[0]!).slice(7) },
          restore: (binding: { artifactId: string; digest: string }) => coverageHost.restoreKnowledgeArtifact(binding) };
        expect((await collectCaptureEvidence(captureScope)).receipts).toHaveLength(1);
        await expect(collectCaptureEvidence({ ...captureScope, source: { ...captureScope.source, uri: "https://wrong.invalid" } }))
          .rejects.toThrow("COLLECTION_CAPTURE_SOURCE_BINDING");
        await expect(collectCaptureEvidence({ ...captureScope, source: { ...captureScope.source, sha256: "0".repeat(64) } }))
          .rejects.toThrow("COLLECTION_CAPTURE_SOURCE_PIN");
        await expect(collectCaptureEvidence({ ...captureScope, restore: async () => ({ artifactId: first.capture.contentArtifact.artifactId,
          verifiedDigest: `sha256:${"0".repeat(64)}`, byteLength: Buffer.byteLength(texts[0]!) }) }))
          .rejects.toThrow("COLLECTION_CAPTURE_REMOTE_DRIFT");
        expect(await coverageHost.evaluateReportCoverage(rootReport.revisionId)).toMatchObject({ passed: true });
        const callsBeforeReplay = coverageJudgeCalls;
        expect(await coverageHost.evaluateReportCoverage(rootReport.revisionId)).toMatchObject({ passed: true });
        expect(coverageJudgeCalls).toBe(callsBeforeReplay);
        const incomplete = structuredClone(rootReport);
        incomplete.reportId = randomUUID(); incomplete.revisionId = randomUUID(); incomplete.slug = `coverage-${randomUUID()}`;
        incomplete.sections[0]!.blocks.splice(1, 1);
        await reports.register({ tenantId, report: incomplete });
        expect(await coverageHost.evaluateReportCoverage(incomplete.revisionId)).toMatchObject({ passed: false,
          facets: [{ id: "first", covered: true }, { id: "second", covered: false }] });
      } finally { await coverageHost.close(); accountingJournal.close(); }
      const dependency=await prepareReportDependency({databaseUrl:databaseUrl!,tenantId,storage:storage!,capture:first.capture,text:first.claim.assertion.proposition!});
      try {
        await dependency.review("native","accept");
        await dependency.review("derived","reject");
        // Rejecting a derivative does not revoke the report's distinct exact signed native input.
        expect((await assessment.assess({reportVersionId:report.revisionId})).admission).toBe("pass");
        await dependency.review("native","reject");
        for(const reportVersionId of [report.revisionId,post.revisionId]) await expect(assessment.assess({reportVersionId}))
          .rejects.toThrow("REPORT_SOURCE_DEPENDENCY_INELIGIBLE");
        const fresh=await sealedRun(verification,first.claim.assertion.proposition!);
        const replacement=makeReport("post_research");
        replacement.sections[0]!.blocks[0]!.assertions[0]!.claims[0]={runId:fresh.runId,claimId:"shared-key",digest:fresh.claim.digest,evidenceManifest:fresh.auditArtifact,role:"supports"};
        await pinReport(replacement);
        pins.get(replacement.revisionId)!.runs[0]={runId:fresh.runId,manifestDigest:fresh.manifestDigest,auditArtifact:fresh.auditArtifact};
        await reports.register({tenantId,report:replacement});
        const replacementAssessment=await assessment.assess({reportVersionId:replacement.revisionId});
        expect(replacementAssessment.admission).toBe("pass");
        expect(replacementAssessment.assessmentId).not.toBe(approved.assessmentId);
        await expect(assessment.assess({reportVersionId:report.revisionId})).rejects.toThrow("REPORT_SOURCE_DEPENDENCY_INELIGIBLE");
      } finally {await dependency.close();}
    } finally {await custody.close();await db.close();await rm(directory,{recursive:true,force:true});}
  },240000);
});

