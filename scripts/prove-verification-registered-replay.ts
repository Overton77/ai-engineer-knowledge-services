import { randomUUID, generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DiagnosticsBenchmarkLiveCallCheckpointSchema, type VerificationArtifactHandle } from "@aiengineer/knowledge-contracts";
import { PostgresCanonicalRepository, PostgresVerificationRepository } from "@aiengineer/knowledge-persistence";
import { SupabaseArtifactStore } from "@aiengineer/knowledge-runtime";
import { canonicalizeJson, digestCanonicalJson, sha256Digest } from "@aiengineer/knowledge-verification";
import { OfflineBenchmarkInputCatalog, RegisteredBenchmarkInputAdmission } from "../packages/application/src/verification-benchmark-inputs.js";
import { RegisteredBenchmarkProfileCatalog, RegisteredBenchmarkProfileAdmission } from "../packages/application/src/verification-benchmark-registered-profile.js";
import { RegisteredBenchmarkReplayCatalog, RegisteredBenchmarkReplayAdmission } from "../packages/application/src/verification-benchmark-registered-replay.js";
import { diagnosticsBenchmarkArms, composeDiagnosticsRecordedArm } from "../packages/application/src/verification-benchmark.js";
import { RegisteredDiagnosticsOfflineBenchmark } from "../packages/application/src/verification-benchmark-offline-executor.js";
import { runVerificationBenchmark, MemoryVerificationBenchmarkCheckpointStore, createVerificationBenchmarkCheckpointPlan } from "../packages/evaluation/src/verification-benchmark.js";
import { PostgresVerificationBenchmarkRunStore } from "../packages/persistence/src/verification-benchmark-run.js";
import { PostgresVerificationBenchmarkPublisher } from "../packages/persistence/src/verification-benchmark-publication.js";
import { RegisteredBenchmarkPublicationBuilder } from "../packages/application/src/verification-benchmark-publication.js";
import { VerificationSealPolicyCatalog } from "../packages/application/src/verification-seal-policy.js";
import { createEd25519Signer, createEd25519Verifier, verifyVerificationBenchmarkPublication } from "@aiengineer/knowledge-verification";

const postgresUrl=process.env.POSTGRES_URL!,supabaseUrl=process.env.SUPABASE_URL!,secret=process.env.SUPABASE_SECRET_KEY!;
const pg=new URL(postgresUrl),storage=new URL(supabaseUrl);
if(!["127.0.0.1","localhost"].includes(pg.hostname)||pg.port!=="54322"||!["127.0.0.1","localhost"].includes(storage.hostname)||storage.port!=="54321")throw new Error("LOCAL_ONLY_PROOF_REFUSED_REMOTE_TARGET");
const tenantId="6d057f43-6aaf-48d9-b3ba-374169abb989",namespace=randomUUID(),createdAt=new Date().toISOString(),bucket="ai-engineer-cloud-bucket";
const root=resolve("..","internal"),profileDirectory=resolve("catalog/verification-benchmarks/diagnostics-companies-pilot-v4");
const checkpointDirectory=resolve(root,"verification-benchmark-extraction-live-feeb824c-e4d0-597f-abd7-7667fa080869");
const database=new PostgresCanonicalRepository({connectionString:postgresUrl,localOnly:true,connectionTimeoutMs:3000});
const repository=new PostgresVerificationRepository(database,new SupabaseArtifactStore({projectUrl:supabaseUrl,serviceRoleKey:secret,bucket,maximumBytes:8*1024*1024}),{async authorize(input){if(input.tenantId!==tenantId||input.purpose!=="verification_admission")throw new Error("ARTIFACT_ACCESS_DENIED");}});
const ref=(handle:VerificationArtifactHandle)=>({artifactId:handle.artifactId,digest:handle.digest});
const encode=(value:unknown)=>new TextEncoder().encode(canonicalizeJson(value));
const checks:Record<string,boolean>={};
async function retain(bytes:Uint8Array,artifactType:string,parents:string[]=[],mediaType="application/json"){
  const digest=sha256Digest(bytes);
  const existing=await database.transaction(tenantId,async client=>(await client.query<{id:string}>("select id from orchestration.artifact where tenant_id=$1 and sha256=$2 and storage_state='available'",[tenantId,digest.slice(7)])).rows);
  if(existing.length>1)throw new Error("AMBIGUOUS_EXISTING_ARTIFACT");
  if(existing[0]){
    const resolver=repository.createTrustedArtifactResolver();
    await resolver.authorizeArtifact({tenantId,artifactId:existing[0].id,purpose:"verification_admission"});
    const hydrated=await resolver.hydrateRegisteredArtifact({tenantId,artifactId:existing[0].id});
    if(hydrated.registration.digest!==digest||!Buffer.from(hydrated.bytes).equals(Buffer.from(bytes)))throw new Error("RETAINED_BYTES_MISMATCH");
    return hydrated.registration;
  }
  return repository.registerContentAddressedArtifact({tenantId,bytes,mediaType,createdAt,producerActivityId:"registered-historical-replay-proof",producerVersion:"1",encryptionClass:"supabase-managed",retentionClass:"verification-audit",dataClassification:"restricted",artifactType,bucketClass:"ledger",storageBucket:bucket,parentArtifactIds:parents,...(parents.length?{transformationSignature:digestCanonicalJson({kind:"retain_historical_replay_record.v1",parents,digest})}:{})});
}
async function expectFailure(name:string,action:()=>Promise<unknown>,pattern:RegExp){try{await action();}catch(error){if(!pattern.test(error instanceof Error?error.message:String(error)))throw error;checks[name]=true;return;}throw new Error(`${name}_DID_NOT_FAIL`);}
try{
  const checkpointRefs:Array<{artifactId:string;digest:string;runIdentityDigest:string}>=[];
  const observationRefs:Array<{artifactId:string;digest:string}>=[];
  for(const role of ["luna_extractor","interfaze_extractor","haiku_judge"]){
    const bytes=new Uint8Array(await readFile(resolve(checkpointDirectory,`06-tru-sites-source-${role}.json`)));
    const checkpoint=DiagnosticsBenchmarkLiveCallCheckpointSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
    if(checkpoint.artifacts.some(item=>item.handle.tenantId!==tenantId))throw new Error("HISTORICAL_TENANT_MISMATCH");
    const wrapper=await retain(bytes,"verification_benchmark_recorded_call",checkpoint.artifacts.map(item=>item.handle.artifactId));
    checkpointRefs.push({...ref(wrapper),runIdentityDigest:checkpoint.runIdentityDigest});
    observationRefs.push(ref(checkpoint.artifacts.find(item=>item.role==="observation")!.handle));
  }
  const manifest=JSON.parse(await readFile(resolve(profileDirectory,"manifest.json"),"utf8")) as {files:Array<{name:string}>};
  const names=new Set(["manifest.json","dataset.json","derived-input-grant.json","case-artifact-registry.json","experiments/extraction-v1/manifest.json","experiments/extraction-v1/output-schema.json",...manifest.files.map(item=>item.name)]);
  const profileFiles:Array<{name:string;artifactId:string;digest:string}>=[];
  for(const name of names){const artifact=await retain(new Uint8Array(await readFile(resolve(profileDirectory,name))),name==="dataset.json"?"evaluation_dataset_manifest":"verification_benchmark_profile_file");profileFiles.push({name,...ref(artifact)});}
  const datasetRef=profileFiles.find(item=>item.name==="dataset.json")!;
  const dataset=JSON.parse(await readFile(resolve(profileDirectory,"dataset.json"),"utf8")) as {manifestDigest:string};
  const experiment=await retain(encode({schemaVersion:"verification-benchmark-experiment.v1",verificationContractVersion:"verification.v1",experimentId:`historical-replay-${namespace}`,datasetManifestDigest:dataset.manifestDigest,runnerVersion:"verification-benchmark-runner.v1",randomSeed:17,repetitions:1,arms:diagnosticsBenchmarkArms(),networkPolicy:"offline",recordedObservationArtifacts:observationRefs}),"verification_benchmark_experiment",[datasetRef.artifactId]);
  const pair={tenantId,dataset:{artifactId:datasetRef.artifactId,digest:datasetRef.digest},experiment:ref(experiment)};
  const inputAdmission=new RegisteredBenchmarkInputAdmission(new OfflineBenchmarkInputCatalog([{...pair,runnerVersion:"verification-benchmark-runner.v1"}]),repository.createTrustedArtifactResolver());
  const admitted=await inputAdmission.load({verificationContractVersion:"verification.v1",dataset:pair.dataset,experimentDefinition:pair.experiment,executionMode:"offline_recorded"},{tenantId});
  const profileAdmission=new RegisteredBenchmarkProfileAdmission(new RegisteredBenchmarkProfileCatalog([{...pair,profileFiles}]),repository.createTrustedArtifactResolver());
  const profile=await profileAdmission.load(admitted,tenantId);
  const replay=new RegisteredBenchmarkReplayAdmission(new RegisteredBenchmarkReplayCatalog([{...pair,checkpoints:checkpointRefs}]),repository.createTrustedArtifactResolver());
  const results=await replay.load(admitted,profile,tenantId);
  checks.all_three_historical_roles_replayed=results.length===3&&["luna_extractor","interfaze_extractor","haiku_judge"].every(role=>results.some(item=>item.role===role));
  checks.extractor_field_mechanics_recomputed=results.filter(item=>item.role!=="haiku_judge").every(item=>item.fieldMechanics?.schemaValid===true&&item.fieldMechanics.fieldMechanics===true);
  checks.no_external_provider_requests=results.every(item=>item.replay.externalRequests===0&&item.replay.memoryFetches===1);
  checks.current_projection_preparation_still_required=results.every(item=>item.requiresCurrentProjectionPreparation===true);
  await expectFailure("missing_trusted_checkpoint_grant_denied",()=>new RegisteredBenchmarkReplayAdmission(new RegisteredBenchmarkReplayCatalog([]),repository.createTrustedArtifactResolver()).load(admitted,profile,tenantId),/TRUSTED_GRANT_REQUIRED/);
  const wrongIdentityRefs=checkpointRefs.map(item=>({...item,runIdentityDigest:`sha256:${"0".repeat(64)}`}));
  await expectFailure("wrong_historical_run_identity_denied",()=>new RegisteredBenchmarkReplayAdmission(new RegisteredBenchmarkReplayCatalog([{...pair,checkpoints:wrongIdentityRefs}]),repository.createTrustedArtifactResolver()).load(admitted,profile,tenantId),/CHECKPOINT_BINDING_INVALID/);
  const controller=new AbortController();controller.abort("private reason");
  await expectFailure("cancelled_replay_denied",()=>replay.load(admitted,profile,tenantId,controller.signal),/BENCHMARK_CANCELLED/);
  let sourceImportEvidence:Record<string,unknown>|undefined;
  if(process.env.VERIFICATION_PROVE_SOURCE_IMPORT==="1"){
    const {RegisteredBenchmarkSourceImportCatalog,RegisteredBenchmarkSourceImportAdmission}=await import("../packages/application/src/verification-benchmark-source-import.js");
    const sourceDirectory=resolve(root,"verification-offline-source-preparation-9093b465-16c2-4cc1-b7f4-728d3958b0ed");
    const sourceManifestBytes=new Uint8Array(await readFile(resolve(sourceDirectory,"manifest.json")));
    if(sha256Digest(sourceManifestBytes)!==admitted.dataset.sourcePreparationDigest)throw new Error("SOURCE_IMPORT_MANIFEST_DRIFT");
    const sourceManifest=JSON.parse(new TextDecoder().decode(sourceManifestBytes)) as {artifacts:Array<{file:string;handle:VerificationArtifactHandle}>};
    const copies:Array<{originalArtifactId:string;artifactId:string;digest:string}>=[];
    for(const original of sourceManifest.artifacts){
      const bytes=new Uint8Array(await readFile(resolve(sourceDirectory,original.file)));
      if(sha256Digest(bytes)!==original.handle.digest||bytes.byteLength!==original.handle.byteLength)throw new Error("SOURCE_IMPORT_PAYLOAD_DRIFT");
      const copy=await retain(bytes,"verification_benchmark_source_import_payload",[],original.handle.mediaType);
      copies.push({originalArtifactId:original.handle.artifactId,...ref(copy)});
    }
    const importManifest=await retain(sourceManifestBytes,"verification_benchmark_source_import_manifest",copies.map(item=>item.artifactId));
    const sourceGrant={...pair,manifest:ref(importManifest),copies};
    const tenantCalls:string[]=[];
    const liveResolver=repository.createTrustedArtifactResolver();
    const checkedResolver={async authorizeArtifact(input:Parameters<typeof liveResolver.authorizeArtifact>[0]){tenantCalls.push(input.tenantId);return liveResolver.authorizeArtifact(input);},async hydrateRegisteredArtifact(input:Parameters<typeof liveResolver.hydrateRegisteredArtifact>[0]){tenantCalls.push(input.tenantId);return liveResolver.hydrateRegisteredArtifact(input);}};
    const sourceAdmission=new RegisteredBenchmarkSourceImportAdmission(new RegisteredBenchmarkSourceImportCatalog([sourceGrant]),checkedResolver);
    const source=await sourceAdmission.prepare(admitted,tenantId);
    const testCase=admitted.dataset.cases.find(item=>item.caseId==="tru-sites-source")!;
    const resolutions=Object.values(source.prepared.byCaseId[testCase.caseId]!.byFragmentId);
    const locatorValid=resolutions.length===testCase.evidence.length&&resolutions.every(item=>item.locatorValid);
    checks.imported_native_case_locator_valid=locatorValid;
    checks.imported_projection_complete_case_matrix=Object.keys(source.prepared.byCaseId).length===admitted.dataset.cases.length;
    checks.imported_corrupted_locator_rejected=Object.values(source.prepared.byCaseId["tru-corrupted-locator"]!.byFragmentId).some(item=>!item.locatorValid);
    checks.source_import_real_resolver_never_uses_original_tenant=tenantCalls.length>0&&tenantCalls.every(item=>item===tenantId)&&source.importManifest.originalTenantId!==tenantId;
    const fieldMechanicsByRole={luna_extractor:results.find(item=>item.role==="luna_extractor")!.fieldMechanics!.fieldMechanics,interfaze_extractor:results.find(item=>item.role==="interfaze_extractor")!.fieldMechanics!.fieldMechanics};
    const arms=diagnosticsBenchmarkArms().map(arm=>({armId:arm.armId,decision:composeDiagnosticsRecordedArm({arm,testCase,mechanics:{locatorValid,fieldMechanics:true,fieldMechanicsByRole},observations:results.map(item=>item.observation)})}));
    checks.imported_projection_and_replayed_responses_compose=arms.every(item=>item.decision.execution.schemaValid&&item.decision.execution.locatorValid&&item.decision.execution.fieldMechanics&&item.decision.execution.failureClass==="none");
    checks.source_authority_remains_unassessed=arms.every(item=>item.decision.execution.authority==="insufficient"&&item.decision.execution.policy!=="pass"&&item.decision.execution.policy!=="pass_with_warnings");
    await expectFailure("source_import_missing_grant_denied",()=>new RegisteredBenchmarkSourceImportAdmission(new RegisteredBenchmarkSourceImportCatalog([]),checkedResolver).prepare(admitted,tenantId),/TRUSTED_GRANT_REQUIRED/);
    const executor=new RegisteredDiagnosticsOfflineBenchmark({inputs:inputAdmission,profiles:profileAdmission,replays:replay,sources:sourceAdmission});
    const execution=await executor.prepare(admitted.request,{tenantId,runId:namespace});
    const checkpoints=new MemoryVerificationBenchmarkCheckpointStore();
    const lifecycle={startedAt:createdAt,complete:async()=>createdAt};
    const run=await runVerificationBenchmark({runId:namespace,dataset:execution.admitted.dataset,experimentDefinitionDigest:pair.experiment.digest as `sha256:${string}`,arms:admitted.experiment.arms,repetitions:admitted.experiment.repetitions,randomSeed:admitted.experiment.randomSeed,networkPolicy:"offline",checkpoints,execute:execution.execute,now:()=>createdAt,lifecycle});
    checks.offline_executor_complete_matrix=run.results.length===43*4;
    checks.offline_executor_native_case_recomputed=run.results.filter(item=>item.caseId==="tru-sites-source").every(item=>item.schemaValid&&item.locatorValid&&item.fieldMechanics&&item.policy==="review"&&item.authority==="insufficient");
    checks.offline_executor_missing_observations_abstain=run.results.some(item=>item.failureClass==="provider"&&item.policy==="abstain");
    checks.offline_executor_no_fresh_provider_charges=run.results.flatMap(item=>item.callAttributions).every(item=>item.cacheDisposition==="exact_cache_shared"&&item.reservationCostMicros===0&&(item.actualCostMicros===0||item.actualCostMicros===null)&&item.latencyMs===null);
    await expectFailure("offline_executor_wrong_run_denied",()=>execution.execute({runId:randomUUID(),datasetManifestDigest:admitted.dataset.manifestDigest as `sha256:${string}`,arm:admitted.experiment.arms[0]!,testCase,repetition:0,networkPolicy:"offline"}),/EXECUTION_BINDING_INVALID/);
    await expectFailure("offline_executor_cancelled_preparation_denied",()=>executor.prepare(admitted.request,{tenantId,runId:namespace,signal:controller.signal}),/BENCHMARK_CANCELLED/);
    const runFile=resolve(root,`verification-offline-executor-run-${namespace}.json`);
    await writeFile(runFile,JSON.stringify({run,provenance:execution.provenance},null,2));
    let durableExecution:Record<string,unknown>|undefined;
    if(process.env.VERIFICATION_PROVE_DURABLE_BENCHMARK==="1"){
      const operationId=randomUUID(),stepId=randomUUID(),actorIdentity="verification-benchmark-local-proof";
      let publicationContext:{missionId:string;workItemId:string;attemptId:string}|undefined;
      if(process.env.VERIFICATION_PROVE_BENCHMARK_PUBLICATION==="1"){
        publicationContext={missionId:randomUUID(),workItemId:randomUUID(),attemptId:randomUUID()};
        await database.transaction(tenantId,async client=>{
          await client.query("insert into orchestration.mission(id,tenant_id,slug,goal) values($1,$2,$3,'Review real registered benchmark publication')",[publicationContext!.missionId,tenantId,`benchmark-publication-${namespace}`]);
          await client.query("insert into orchestration.work_item(id,tenant_id,mission_id,kind) values($1,$2,$3,'review_task')",[publicationContext!.workItemId,tenantId,publicationContext!.missionId]);
          await client.query("insert into orchestration.attempt(id,tenant_id,work_item_id,attempt_no,agent_deployment_id) values($1,$2,$3,1,'benchmark-publication-proof')",[publicationContext!.attemptId,tenantId,publicationContext!.workItemId]);
        });
      }
      await database.createOperation({id:operationId,tenantId,...publicationContext,operationKind:"verification_benchmark",idempotencyKey:`benchmark-${namespace}`,correlationId:namespace,actorIdentity,request:{schemaVersion:"knowledge-operation-request/v1",kind:"verification_benchmark",input:{schemaVersion:"verification-service-request.v1",useCase:"runBenchmark",request:admitted.request},expectedVersions:{verification:"verification.v1"}},steps:[{id:stepId,key:"replay_recorded_and_register",kind:"replay_recorded_and_register",input:{runId:namespace},maxAttempts:3}]});
      try{
        const lease=await database.claimOperation(tenantId,operationId,actorIdentity,300_000);
        if(!lease)throw new Error("BENCHMARK_PROOF_LEASE_NOT_CLAIMED");
        const options={runId:namespace,dataset:admitted.dataset,experimentDefinitionDigest:pair.experiment.digest as `sha256:${string}`,arms:admitted.experiment.arms,repetitions:admitted.experiment.repetitions,randomSeed:admitted.experiment.randomSeed,networkPolicy:"offline" as const};
        const plan=createVerificationBenchmarkCheckpointPlan(options),store=new PostgresVerificationBenchmarkRunStore(database);
        const identity={tenantId,operationId,lease,runId:namespace,datasetArtifact:admitted.datasetArtifact,experimentArtifact:admitted.experimentArtifact,runnerVersion:admitted.experiment.runnerVersion,networkPolicy:"offline" as const,randomSeed:admitted.experiment.randomSeed,repetitions:admitted.experiment.repetitions,checkpointPlan:plan,startedAt:new Date().toISOString()};
        const opened=await store.initialize(identity),interrupt=new AbortController();let saved=0,executed=0;
        const execute=async(input:Parameters<typeof execution.execute>[0])=>{executed++;return execution.execute(input);};
        await expectFailure("durable_runner_interruption_propagates",()=>runVerificationBenchmark({...options,execute,now:()=>new Date().toISOString(),lifecycle:opened.lifecycle,signal:interrupt.signal,checkpoints:{load:key=>opened.checkpoints.load(key),save:async(key,result)=>{await opened.checkpoints.save(key,result);if(++saved===5)interrupt.abort();}}}),/BENCHMARK_CANCELLED/);
        const resumed=await store.initialize({...identity,startedAt:new Date().toISOString()});
        checks.durable_runner_original_start_retained=resumed.run.startedAt===opened.run.startedAt;
        const completed=await runVerificationBenchmark({...options,execute,now:()=>new Date().toISOString(),checkpoints:resumed.checkpoints,lifecycle:resumed.lifecycle});
        const replayed=await runVerificationBenchmark({...options,execute:async()=>{throw new Error("DURABLE_REPLAY_EXECUTED_CASE");},now:()=>{throw new Error("DURABLE_REPLAY_CHANGED_CLOCK");},checkpoints:resumed.checkpoints,lifecycle:resumed.lifecycle});
        checks.durable_runner_cases_execute_once=executed===172&&saved===5;
        checks.durable_runner_manifest_identical_on_retry=replayed.manifestDigest===completed.manifestDigest&&canonicalizeJson(replayed)===canonicalizeJson(completed);
        const rows=await database.transaction(tenantId,async client=>(await client.query<{status:string;checkpoints:string;operation_id:string}>("select r.status,r.operation_id,(select count(*)::text from evaluation.verification_benchmark_checkpoint c where c.tenant_id=r.tenant_id and c.benchmark_run_id=r.id) checkpoints from evaluation.verification_benchmark_run r where r.tenant_id=$1 and r.id=$2",[tenantId,namespace])).rows);
        checks.durable_runner_one_complete_matrix=rows.length===1&&rows[0]!.status==="completed"&&rows[0]!.operation_id===operationId&&rows[0]!.checkpoints==="172";
        const durableRunFile=resolve(root,`verification-durable-benchmark-run-${namespace}.json`);
        await writeFile(durableRunFile,JSON.stringify({run:completed,provenance:execution.provenance,operationId,checkpointPlan:plan},null,2));
        let publicationEvidence:Record<string,unknown>|undefined;
        if(publicationContext){
          const policy=await repository.registerContentAddressedArtifact({tenantId,producerAttemptId:publicationContext.attemptId,missionId:publicationContext.missionId,bytes:encode({schemaVersion:"verification-policy.v1",policyVersion:"diagnostics-policy.v1",definitionId:`benchmark-publication-${namespace}`,criticalDownstreamUses:["publication"],requireCrossFamilyForRisk:["critical"],requireIndependentAuthorityForScopes:["clinical_utility"],mixedEvidenceOutcome:"review",unknownCriticalOutcome:"abstain",authorityWithheldOutcome:"review",reviewAvailable:true}),mediaType:"application/json",createdAt:completed.completedAt,producerActivityId:"benchmark-publication-proof-policy",producerVersion:"1",encryptionClass:"supabase-managed",retentionClass:"verification-audit",dataClassification:"restricted",artifactType:"verification_policy",bucketClass:"ledger",storageBucket:bucket,parentArtifactIds:[]});
          const keyPair=generateKeyPairSync("ed25519"),keyId=`benchmark-proof-${namespace}`;
          const signer=createEd25519Signer(keyPair.privateKey.export({type:"pkcs8",format:"pem"}).toString(),keyId);
          const publicKey=keyPair.publicKey.export({type:"spki",format:"pem"}).toString(),verifier=createEd25519Verifier({[keyId]:publicKey});
          const builder=new RegisteredBenchmarkPublicationBuilder({policies:new VerificationSealPolicyCatalog([{tenantId,policyVersion:"diagnostics-policy.v1",policyArtifact:ref(policy)}]),resolver:repository.createTrustedArtifactResolver(),signer,artifacts:{register:input=>repository.registerContentAddressedArtifact({...input,parentArtifactIds:[...input.parentArtifactIds],producerAttemptId:publicationContext!.attemptId,missionId:publicationContext!.missionId,mediaType:"application/json",producerActivityId:"benchmark-publication-proof",producerVersion:"1",encryptionClass:"supabase-managed",retentionClass:"verification-audit",dataClassification:"restricted",bucketClass:"ledger",storageBucket:bucket})}});
          const git=spawnSync("git",["rev-parse","HEAD"],{encoding:"utf8",windowsHide:true});
          const gitSha=git.status===0?git.stdout.trim():"uncommitted";
          const sourcePaths=["packages/contracts/src/verification/benchmark-publication.ts","packages/evaluation/src/verification-benchmark.ts","packages/application/src/verification-benchmark-offline-executor.ts","packages/application/src/verification-benchmark-publication.ts","packages/verification/src/provenance/benchmark-publication.ts","packages/persistence/src/verification-benchmark-run.ts","packages/persistence/src/verification-benchmark-publication.ts","scripts/prove-verification-registered-replay.ts","package.json","pnpm-lock.yaml"];
          const sourceFiles=[];
          for(const path of sourcePaths){const bytes=await readFile(resolve(path));sourceFiles.push({path,digest:sha256Digest(bytes),bytesBase64:bytes.toString("base64")});}
          const codeSnapshot=await repository.registerContentAddressedArtifact({tenantId,producerAttemptId:publicationContext.attemptId,missionId:publicationContext.missionId,bytes:encode({schemaVersion:"verification-benchmark-runtime-source-snapshot.v1",gitSha,scope:"Scoped publication proof sources and lockfile; not a complete dependency or deployment image",files:sourceFiles}),mediaType:"application/json",createdAt:completed.completedAt,producerActivityId:"benchmark-publication-proof-code",producerVersion:"1",encryptionClass:"supabase-managed",retentionClass:"verification-audit",dataClassification:"restricted",artifactType:"verification_benchmark_provenance",bucketClass:"ledger",storageBucket:bucket,parentArtifactIds:[]});
          const runtime={deploymentId:"benchmark-publication-proof",attemptId:publicationContext.attemptId,capabilityVersion:"verification.v1",targetCodeRef:`verification-benchmark-runner.v1:${codeSnapshot.digest}`,gitSha,dirty:true,dirtyStateArtifact:codeSnapshot};
          const draft=await builder.prepare({tenantId,operationId,prepared:execution,run:completed,runtime});
          checks.publication_real_signature_verified=(await verifyVerificationBenchmarkPublication(draft.manifest,{verifier,requireSignature:true})).signatureStatus==="verified";
          const publisher=new PostgresVerificationBenchmarkPublisher(database);
          const published=await publisher.publishCompleted({...draft.input,lease});
          const secondDraft=await builder.prepare({tenantId,operationId,prepared:execution,run:completed,runtime});
          const republished=await publisher.publishCompleted({...secondDraft.input,lease});
          checks.publication_retry_reuses_exact_manifest=draft.input.publicationManifest.artifactId===secondDraft.input.publicationManifest.artifactId&&draft.manifest.seal.payloadDigest===secondDraft.manifest.seal.payloadDigest&&canonicalizeJson(published)===canonicalizeJson(republished);
          checks.publication_has_four_distinct_real_eval_runs=published.evalRunIds.length===4&&new Set(published.evalRunIds).size===4;
          checks.publication_honest_engineering_provenance=draft.manifest.dataset.labelProvenance==="engineering_expectations"&&draft.manifest.arms.every(arm=>arm.terminalStatus==="review")&&!draft.manifest.qualityClaims.humanGoldValidated;
          await expectFailure("publication_missing_arm_rejected",()=>publisher.publishCompleted({...draft.input,lease,arms:draft.input.arms.slice(1)}),/ARM_(SET_INVALID|PLAN_MISMATCH)/);
          await expectFailure("publication_changed_disposition_rejected",()=>publisher.publishCompleted({...draft.input,lease,arms:draft.input.arms.map((arm,index)=>index===0?{...arm,terminalStatus:"failed"}:arm)}),/(DRIFT|binding mismatch)/i);
          const otherOperationId=randomUUID();
          await database.createOperation({id:otherOperationId,tenantId,...publicationContext,operationKind:"verification_benchmark",idempotencyKey:`benchmark-cross-operation-${namespace}`,correlationId:namespace,actorIdentity,request:{schemaVersion:"knowledge-operation-request/v1",kind:"verification_benchmark",input:{schemaVersion:"verification-service-request.v1",useCase:"runBenchmark",request:admitted.request}},steps:[{id:randomUUID(),key:"replay_recorded_and_register",kind:"replay_recorded_and_register",input:{runId:randomUUID()},maxAttempts:3}]});
          try{
            const otherLease=await database.claimOperation(tenantId,otherOperationId,actorIdentity,300_000);
            if(!otherLease)throw new Error("CROSS_OPERATION_PROOF_LEASE_MISSING");
            await expectFailure("publication_cross_active_operation_rejected",()=>publisher.publishCompleted({...draft.input,operationId:otherOperationId,lease:otherLease}),/RUN_BINDING_INVALID/);
          }finally{await database.cancelOperation(tenantId,otherOperationId,{actorIdentity,correlationId:namespace});}
          await database.heartbeat(tenantId,lease,50);
          await new Promise(resolve=>setTimeout(resolve,100));
          const replacementLease=await database.claimOperation(tenantId,operationId,`${actorIdentity}-replacement`,300_000);
          if(!replacementLease||replacementLease.fencingToken<=lease.fencingToken)throw new Error("PUBLICATION_REPLACEMENT_FENCE_NOT_INCREASED");
          await expectFailure("publication_expired_fence_rejected",()=>publisher.publishCompleted({...draft.input,lease}),/STALE_LEASE/);
          const replacementPublication=await publisher.publishCompleted({...draft.input,lease:replacementLease});
          checks.publication_replacement_fence_reuses_sealed_result=canonicalizeJson(published)===canonicalizeJson(replacementPublication);
          const databaseBindings=await database.transaction(tenantId,async client=>(await client.query<{benchmark_arm_id:string;eval_run_id:string;exact_times:boolean;exact_dataset:boolean;exact_operation:boolean}>("select p.benchmark_arm_id,p.eval_run_id,r.started_at=b.started_at and r.ended_at=b.completed_at and r.executed_at=b.completed_at exact_times,v.manifest_artifact_id=b.dataset_artifact_id and v.manifest_sha256=b.dataset_sha256 exact_dataset,r.attempt_id=o.attempt_id and r.mission_id=o.mission_id and r.work_item_id=o.work_item_id exact_operation from evaluation.verification_benchmark_arm_publication p join evaluation.verification_benchmark_run b on b.tenant_id=p.tenant_id and b.id=p.benchmark_run_id join evaluation.eval_run r on r.tenant_id=p.tenant_id and r.id=p.eval_run_id join evaluation.eval_dataset_version v on v.tenant_id=r.tenant_id and v.id=r.dataset_version_id join knowledge_service.operation o on o.tenant_id=p.tenant_id and o.id=p.operation_id where p.tenant_id=$1 and p.benchmark_run_id=$2 order by p.benchmark_arm_id",[tenantId,namespace])).rows);
          checks.publication_database_bindings_exact=databaseBindings.length===4&&databaseBindings.every(row=>row.exact_times&&row.exact_dataset&&row.exact_operation&&published.evalRunIds.includes(row.eval_run_id));
          const publicationFile=resolve(root,`verification-benchmark-publication-${namespace}.json`);
          await writeFile(publicationFile,JSON.stringify({manifest:draft.manifest,publicationArtifact:draft.input.publicationManifest,publicKey,keyId,published,publicationInput:draft.input,databaseBindings,fencing:{original:lease.fencingToken,replacement:replacementLease.fencingToken},otherOperationId},null,2));
          publicationEvidence={publicationFile,publicationArtifact:draft.input.publicationManifest,manifestDigest:draft.manifest.seal.payloadDigest,published};
        }
        await database.cancelOperation(tenantId,operationId,{actorIdentity,correlationId:namespace});
        await expectFailure("durable_runner_cancelled_lease_cannot_complete",()=>resumed.lifecycle.complete(),/OPERATION_NOT_ACTIVE/);
        durableExecution={operationId,runId:namespace,durableRunFile,manifestDigest:completed.manifestDigest,planDigest:plan.planDigest,checkpoints:172,executed,interruptedAfter:5,operationDisposition:publicationEvidence?"cancelled_after_internal_sealing_proof; not publicly visible":"cancelled_after_internal_proof; not published or sealed",publicationEvidence};
      }finally{await database.cancelOperation(tenantId,operationId,{actorIdentity,correlationId:namespace});}
    }
    sourceImportEvidence={importManifest:source.importManifest,mappings:source.mappings,caseCount:Object.keys(source.prepared.byCaseId).length,realResolverTenantIds:[...new Set(tenantCalls)],arms,offlineExecution:{runFile,manifestDigest:run.manifestDigest,caseResults:run.results.length,provenance:execution.provenance},durableExecution};
  }
  if(!Object.values(checks).every(Boolean))throw new Error("REGISTERED_REPLAY_PROOF_FAILED");
  const output=resolve(root,`verification-registered-replay-${namespace}.json`);
  const result={status:"passed",tenantId,namespace,checks,profileFileCount:profileFiles.length,dataset:pair.dataset,experiment:pair.experiment,checkpointRefs,results,sourceImportEvidence};
  await writeFile(output,JSON.stringify(result,null,2));
  console.log(JSON.stringify({output,status:result.status,tenantId,namespace,checks,profileFileCount:profileFiles.length,dataset:pair.dataset,experiment:pair.experiment,durableExecution:sourceImportEvidence?.durableExecution}));
}finally{await database.close();}
