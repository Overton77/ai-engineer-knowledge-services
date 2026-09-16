import assert from "node:assert/strict";
import {randomUUID,createHash,generateKeyPairSync} from "node:crypto";
import {readFile,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {StructuredExtractionProfileAdmission,type StructuredExtractionRuntimeGrant} from "../packages/application/src/verification/operations/verification-structured-extraction-profile.js";
import {StructuredExtractionCapturedReplayService} from "../packages/application/src/verification/operations/verification-structured-extraction-replay.js";
import {StructuredExtractionCandidateBuilder} from "../packages/application/src/verification/operations/verification-structured-extraction-candidate.js";
import {VerificationAdmissionService} from "../packages/application/src/verification/admission/verification-admission.js";
import {AccountedVerificationProviderSink,VerificationProviderArtifactComposer} from "../packages/application/src/verification/operations/verification-provider.js";
import {type TenantSqlClient,PostgresCanonicalRepository,PostgresVerificationRepository,PostgresKnowledgeOperationService} from "../packages/persistence/src/index.js";
import {PostgresVerificationProviderResponseCaptureStore} from "../packages/persistence/src/verification-provider-response-capture.js";
import {PostgresVerificationProviderAccounting} from "../packages/persistence/src/verification-provider-accounting.js";
import {PostgresStructuredExtractionLifecycleStore,type StructuredExtractionLifecycleIdentity} from "../packages/persistence/src/verification-structured-extraction-lifecycle.js";
import {SupabaseArtifactStore} from "@aiengineer/knowledge-runtime";
import {SandboxedVerificationParser,VERIFICATION_PARSER_LIMITS} from "@aiengineer/knowledge-conversion";
import {GatewayStructuredExtractionProvider,InterfazeStructuredExtractionProvider} from "@aiengineer/knowledge-verification";

import {StructuredExtractionExecutionArtifactBuilder,StructuredExtractionPublicationArtifactBuilder} from "../packages/application/src/verification/operations/verification-structured-extraction-publication.js";
import {PostgresStructuredExtractionExecutionStore} from "../packages/persistence/src/verification-structured-extraction-execution.js";
import {PostgresStructuredExtractionPublicationStore} from "../packages/persistence/src/verification-structured-extraction-publication.js";
import {StructuredExtractionPublicationLifecycleSnapshotSchema,type StructuredExtractionProviderCallSnapshot} from "@aiengineer/knowledge-contracts";
import {createEd25519Signer,createEd25519Verifier,canonicalizeJson} from "@aiengineer/knowledge-verification";

const pgUrl=process.env.POSTGRES_URL!,storageUrl=process.env.SUPABASE_URL!;
for(const[value,port]of [[pgUrl,"54322"],[storageUrl,"54321"]]){const url=new URL(value!);if(!["localhost","127.0.0.1"].includes(url.hostname)||url.port!==port)throw new Error("LOCAL_ONLY_PROOF_REQUIRED");}
const fixtureName="verification-structured-extraction-preparation-c6085a8a-8c56-4923-a9ed-dd09666d223d.json";
const fixture=JSON.parse(await readFile(resolve("../internal",fixtureName),"utf8")) as {tenantId:string;attemptId:string;missionId:string;workItemId:string;createdAt:string;imageDigest:`sha256:${string}`;profiles:{providerId:string;grant:StructuredExtractionRuntimeGrant;request:unknown}[]};
const tenantId=fixture.tenantId,namespace=randomUUID(),operations:string[]=[],results:unknown[]=[],checks:Record<string,boolean>={};let syntheticFetches=0;const lateBindings:unknown[]=[];
const database=new PostgresCanonicalRepository({connectionString:pgUrl,localOnly:true}),store=new PostgresStructuredExtractionLifecycleStore(database),captures=new PostgresVerificationProviderResponseCaptureStore(database);
const operationService=new PostgresKnowledgeOperationService(database,{admittedOperationKinds:["verification_structured_extraction"]});
const repository=new PostgresVerificationRepository(database,new SupabaseArtifactStore({projectUrl:storageUrl,serviceRoleKey:process.env.SUPABASE_SECRET_KEY!,bucket:"ai-engineer-cloud-bucket",maximumBytes:8_000_000}),{async authorize(v){assert.equal(v.tenantId,tenantId);assert.equal(v.purpose,"verification_admission");}});
const native=new VerificationAdmissionService(repository,new SandboxedVerificationParser(fixture.imageDigest),{parserVersion:"verification-native-parser.v1",imageDigest:fixture.imageDigest,limits:VERIFICATION_PARSER_LIMITS},{storageBucket:"ai-engineer-cloud-bucket",producerVersion:"structured-extraction-proof.v1",encryptionClass:"supabase-managed",retentionClass:"verification-audit",now:()=>fixture.createdAt});
const keyPair=generateKeyPairSync("ed25519"),publicKeyPem=keyPair.publicKey.export({type:"spki",format:"pem"}).toString();
const signer=createEd25519Signer(keyPair.privateKey.export({type:"pkcs8",format:"pem"}).toString(),"local-structured-custody"),verifier=createEd25519Verifier({"local-structured-custody":publicKeyPem});
const executionStore=new PostgresStructuredExtractionExecutionStore(database),publicationStore=new PostgresStructuredExtractionPublicationStore(database,verifier);
const publicationPort={async register(input:Parameters<ConstructorParameters<typeof StructuredExtractionExecutionArtifactBuilder>[0]["artifacts"]["register"]>[0]){return repository.registerContentAddressedArtifact({...input,producerActivityId:"structured-publication-proof",producerVersion:"v1",mediaType:"application/json",encryptionClass:"supabase-managed",retentionClass:"verification-audit",dataClassification:"restricted",bucketClass:"candidate",storageBucket:"ai-engineer-cloud-bucket"});}};
const executionBuilder=new StructuredExtractionExecutionArtifactBuilder({artifacts:publicationPort,createResolver:()=>repository.createTrustedArtifactResolver()}),publicationBuilder=new StructuredExtractionPublicationArtifactBuilder({artifacts:publicationPort,createResolver:()=>repository.createTrustedArtifactResolver(),signer});
const custodyPaths=["packages/contracts/src/verification/structured-extraction-publication.ts","packages/application/src/verification/operations/verification-structured-extraction-publication.ts","packages/application/src/verification/operations/verification-structured-extraction-profile.ts","packages/application/src/verification/operations/verification-structured-extraction-replay.ts","packages/application/src/verification/operations/verification-structured-extraction-candidate.ts","packages/persistence/src/verification-structured-extraction-execution.ts","packages/persistence/src/verification-structured-extraction-publication.ts","packages/persistence/src/verification-structured-extraction-lifecycle.ts","../ai-engineer-db-contract/supabase/migrations/20260906031800_verification_structured_extraction_execution.sql","../ai-engineer-db-contract/supabase/migrations/20260906031900_verification_structured_extraction_publication.sql","../ai-engineer-db-contract/supabase/migrations/20260906032000_verification_structured_extraction_source_custody.sql","scripts/prove-verification-structured-extraction-publication.ts"];
const sourceFiles=await Promise.all(custodyPaths.map(async path=>{const bytes=await readFile(path);return {path,sha256:createHash("sha256").update(bytes).digest("hex"),byteLength:bytes.byteLength,bytesBase64:bytes.toString("base64")};}));
const dirtyStateArtifact=await repository.registerContentAddressedArtifact({tenantId,producerAttemptId:fixture.attemptId,artifactType:"verification_structured_extraction_source_custody",bytes:new TextEncoder().encode(canonicalizeJson({schemaVersion:"verification-structured-extraction-source-custody.v1",tenantId,scope:"listed_files",totalByteLength:sourceFiles.reduce((sum,f)=>sum+f.byteLength,0),files:sourceFiles.map(f=>({...f,path:f.path.startsWith("../ai-engineer-db-contract/")?"DB/"+f.path.slice("../ai-engineer-db-contract/".length):"KS/"+f.path,sha256:`sha256:${f.sha256}`}))})),createdAt:new Date().toISOString(),parentArtifactIds:[],producerActivityId:"structured-publication-proof",producerVersion:"v1",mediaType:"application/json",encryptionClass:"supabase-managed",retentionClass:"verification-audit",dataClassification:"restricted",bucketClass:"candidate",storageBucket:"ai-engineer-cloud-bucket"});
const firstSource=sourceFiles[0]!;
const wrongTypeSourceArtifact=await repository.registerContentAddressedArtifact({tenantId,producerAttemptId:fixture.attemptId,artifactType:"verification_bundle",bytes:new TextEncoder().encode(canonicalizeJson({schemaVersion:"verification-structured-extraction-source-custody.v1",tenantId,scope:"listed_files",totalByteLength:firstSource.byteLength,files:[{...firstSource,path:"KS/"+firstSource.path,sha256:`sha256:${firstSource.sha256}`}]})),createdAt:new Date().toISOString(),parentArtifactIds:[],producerActivityId:"structured-publication-negative",producerVersion:"v1",mediaType:"application/json",encryptionClass:"supabase-managed",retentionClass:"verification-audit",dataClassification:"restricted",bucketClass:"candidate",storageBucket:"ai-engineer-cloud-bucket"});
try{
 await assert.rejects(new PostgresKnowledgeOperationService(database).submit("verification_structured_extraction",{},"http://localhost"),/CAPABILITY_NOT_ADMITTED/);checks.default_admission_still_closed=true;
 for(const [scenarioIndex,selected] of [...fixture.profiles,fixture.profiles[0]!].entries()){
  const late=scenarioIndex===2;
  const admission=new StructuredExtractionProfileAdmission([selected.grant],()=>repository.createTrustedArtifactResolver(),native),preparation=await admission.prepare({tenantId,request:selected.request});
  const operationId=randomUUID(),providerAttemptId=randomUUID();operations.push(operationId);
  const context={tenantId,operationId,attemptId:fixture.attemptId,missionId:fixture.missionId,workItemId:fixture.workItemId,correlationId:namespace,actor:{kind:"service",id:namespace,serviceIdentity:"knowledge_worker"},capabilityVersion:"verification-service.v1",idempotencyKey:`${namespace}-${operationId}`,reason:"Synthetic local lifecycle proof",contractVersion:"v1"};
  await operationService.submit("verification_structured_extraction",{context,input:{schemaVersion:"verification-service-request.v1",useCase:"extractStructuredData",request:selected.request},expectedVersions:{verification:"verification.v1",service:"verification-service-request.v1"}},"http://localhost");
  const operation=await database.getOperation(tenantId,operationId),lease=await database.claimOperation(tenantId,operationId,namespace,300_000);assert.ok(operation&&lease);
  const identity:StructuredExtractionLifecycleIdentity={tenantId,operationId,operationStepId:lease.id,producerAttemptId:fixture.attemptId,requestDigest:`sha256:${operation.requestSha256}`,stepInputDigest:`sha256:${lease.inputSha256}`,captureId:preparation.captureId,profileArtifact:preparation.artifacts.producerProfile,schemaArtifact:preparation.artifacts.extractionSchema,sourceArtifact:preparation.artifacts.source,representationArtifact:preparation.representation,transformationArtifact:preparation.artifacts.transformation,promptDigest:preparation.promptDigest,schemaDigest:preparation.schema.schemaDigest};
  assert.notEqual(identity.requestDigest,identity.stepInputDigest);
  const executionInput={identity:{tenantId,operationId,operationStepId:lease.id,producerAttemptId:fixture.attemptId,requestDigest:identity.requestDigest as `sha256:${string}`,stepInputDigest:identity.stepInputDigest as `sha256:${string}`},profileArtifact:identity.profileArtifact,runtime:{deploymentId:"local-structured-publication-proof",capabilityVersion:"verification-service.v1",platform:"node24-windows",code:{gitSha:"uncommitted",dirty:true,dirtyStateArtifact}},execution:{mode:"synthetic_transport" as const,networkPolicy:"disabled" as const},versions:{parser:"verification-native-parser.v1",extractor:"structured-extraction.v1",canonicalization:"verification-canonical-json.v1"},createdAt:operation.createdAt};
  if(!late){const wrongTypeExecution=await executionBuilder.prepare({...executionInput,runtime:{...executionInput.runtime,code:{...executionInput.runtime.code,dirtyStateArtifact:wrongTypeSourceArtifact}}});await assert.rejects(executionStore.bind({lease,...wrongTypeExecution}),/typed source custody required/);checks[`${selected.providerId}_sql_rejects_untyped_source_custody`]=true;}
  const execution=await executionBuilder.prepare(executionInput);
  assert.equal(await executionStore.readForRecovery({lease}),undefined);
  let boundExecution:Awaited<ReturnType<typeof executionStore.bind>>|null=null;
  const initialized=await store.initialize({identity,lease});assert.equal(initialized.status,"running");assert.deepEqual(await store.initialize({identity,lease}),initialized);
  await assert.rejects(store.initialize({identity:{...identity,requestDigest:`sha256:${"f".repeat(64)}`},lease}));
  await assert.rejects(store.initialize({identity:{...identity,stepInputDigest:`sha256:${"f".repeat(64)}`},lease}));
  checks[`${selected.providerId}_canonical_identity_and_two_digest_bindings`]=true;
  const gateway=selected.providerId==="gateway-structured-extraction.v1";
  const composer=new VerificationProviderArtifactComposer(repository,{tenantId,storageBucket:"ai-engineer-cloud-bucket",producerActivityId:"structured-replay-provider",producerVersion:"v1",encryptionClass:"managed",retentionClass:"proof",now:()=>fixture.createdAt,externalProcessingGrant:{providerId:gateway?"gateway":"interfaze",dataClassification:"synthetic",modalities:["text"],...(gateway?{}:{zdrPolicy:"required" as const})},transportResponse:{binding:{tenantId,operationId,operationStepId:lease.id,providerAttemptId,profileArtifactId:identity.profileArtifact.artifactId,profileDigest:identity.profileArtifact.digest,dispatchFencingToken:lease.fencingToken},async record(input){await captures.store({lease,...input});}}});
  await composer.registerInput(new TextEncoder().encode(preparation.prompt),"text/plain");
  const locked=deferred<number>(),attempting=deferred<number>(),release=deferred<void>();
  const executionDatabase=gatedDatabase(database,{before:late?(pid)=>attempting.resolve(pid):undefined,after:late?undefined:async(pid)=>{locked.resolve(pid);await release.promise;}});
  const providerDatabase=gatedDatabase(database,{before:late?undefined:(pid)=>attempting.resolve(pid),after:late?async(pid)=>{locked.resolve(pid);await release.promise;}:undefined});
  const racingExecutionStore=new PostgresStructuredExtractionExecutionStore(executionDatabase);
  const accounting=new PostgresVerificationProviderAccounting(providerDatabase,{lease,profileArtifactId:identity.profileArtifact.artifactId,profileDigest:identity.profileArtifact.digest as `sha256:${string}`});
  const sink=new AccountedVerificationProviderSink(composer,accounting,{tenantId,...preparation.producerProfile.budget},{attemptId:providerAttemptId,providerId:selected.providerId,model:preparation.provider.model,reservationCostMicros:100});
  const raw=JSON.stringify({model:preparation.provider.model,choices:[{message:{content:JSON.stringify({value:"Exact value 42"})}}],precontext:gateway?[]:[{name:"scraper",result:{selected:"Exact value 42"}}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15,cost:0.00001}});
  const options={apiKey:"synthetic",artifactSink:sink,fetch:async()=>{syntheticFetches++;return new Response(raw,{status:200});}},adapter=gateway?new GatewayStructuredExtractionProvider(options):new InterfazeStructuredExtractionProvider(options);
  const extract=()=>adapter.extract({prompt:preparation.prompt,schemaName:"structured_extraction",schema:preparation.schema.canonicalSchema,execution:{}});
  if(late){
   const call=extract();await locked.promise;
   const denied=assert.rejects(racingExecutionStore.bind({lease,...execution}),/must precede provider reservation/);
   const blockedPid=await attempting.promise;try{await assertDatabaseLock(blockedPid);}finally{release.resolve();}await Promise.all([call,denied]);
   checks.reservation_wins_actual_concurrent_row_lock=true;
  }else{
   const binding=racingExecutionStore.bind({lease,...execution});await locked.promise;
   const call=extract();const blockedPid=await attempting.promise;try{await assertDatabaseLock(blockedPid);}finally{release.resolve();}
   boundExecution=await binding;await call;
   checks[`${selected.providerId}_execution_wins_actual_concurrent_row_lock`]=true;
  }
  const capture=await captures.readForRecovery({lease,providerAttemptId});assert.ok(capture);
  const unsettled=await database.transaction(tenantId,async c=>(await c.query("select state,response_artifact_id from orchestration.verification_provider_attempt where tenant_id=$1 and id=$2",[tenantId,providerAttemptId])).rows[0]);assert.equal(unsettled?.state,"dispatched");assert.equal(unsettled?.response_artifact_id,null);
  if(late){await assert.rejects(executionStore.bind({lease,...execution}),/must precede provider reservation/);await sink.settleOrRetain({costMicros:10});lateBindings.push({operationId,providerAttemptId,executionArtifact:execution.artifact});checks.late_execution_binding_after_dispatch_denied=true;continue;}
  assert.deepEqual(await executionStore.bind({lease,...execution}),boundExecution);checks[`${selected.providerId}_original_execution_reused_after_reservation`]=true;
  const retaining=await store.beginRetention({lifecycle:initialized,lease,capture});assert.equal(retaining.status,"retaining");assert.ok(retaining.retentionStartedAt);assert.ok(Date.parse(retaining.retentionStartedAt)>=Date.parse(capture.capturedAt));assert.deepEqual(await store.beginRetention({lifecycle:initialized,lease,capture}),retaining);
  checks[`${selected.providerId}_capture_checkpoint_before_accounting_settlement`]=true;
  const replayService=new StructuredExtractionCapturedReplayService(admission,()=>repository.createTrustedArtifactResolver()),replay=await replayService.replay({tenantId,request:selected.request,preparation,capture});assert.equal(replay.kind,"accepted");
  const builder=new StructuredExtractionCandidateBuilder(replayService,{async register(input){return repository.registerContentAddressedArtifact({...input,producerActivityId:"structured-lifecycle-proof",producerVersion:"v1",mediaType:"application/json",encryptionClass:"supabase-managed",retentionClass:"verification-audit",dataClassification:"restricted",bucketClass:"candidate",storageBucket:"ai-engineer-cloud-bucket"});}});
  const candidateInput={tenantId,operationId,providerAttemptId,producerAttemptId:fixture.attemptId,createdAt:retaining.retentionStartedAt,preparation,replay};
  const candidate=await builder.retain(candidateInput);
  await assert.rejects(store.completeRetention({lifecycle:retaining,lease,candidate:{...candidate,provenance:{...candidate.provenance,operationId:randomUUID()}}}));
  await assert.rejects(store.completeRetention({lifecycle:retaining,lease:{...lease,fencingToken:lease.fencingToken+1},candidate}));
  const sqlClaim=JSON.stringify({stepId:lease.id,leaseToken:lease.leaseToken,fencingToken:lease.fencingToken,holderIdentity:lease.holderIdentity});
  await assert.rejects(database.transaction(tenantId,async c=>{await c.query("select set_config('verification.structured_extraction_claim',$1,true)",[sqlClaim]);await c.query("update orchestration.verification_structured_extraction set status='retained',candidate_artifact_id=$3,candidate_sha256=$4,provenance_artifact_id=$5,provenance_sha256=$6 where tenant_id=$1 and operation_id=$2",[tenantId,operationId,identity.sourceArtifact.artifactId,identity.sourceArtifact.digest.slice(7),candidate.provenanceArtifact.artifactId,candidate.provenanceArtifact.digest.slice(7)]);}),/candidate semantic binding mismatch/);
  await assert.rejects(database.transaction(tenantId,async c=>{await c.query("select set_config('verification.structured_extraction_claim',$1,true)",[sqlClaim]);await c.query("update orchestration.verification_structured_extraction set prompt_sha256=$3 where tenant_id=$1 and operation_id=$2",[tenantId,operationId,"f".repeat(64)]);}),/immutable identity/);
  checks[`${selected.providerId}_direct_sql_artifact_and_identity_substitution_denied`]=true;
  const completed=await store.completeRetention({lifecycle:retaining,lease,candidate});assert.equal(completed.status,"retained");assert.ok(completed.completedAt);assert.deepEqual(await store.completeRetention({lifecycle:retaining,lease,candidate}),completed);
  checks[`${selected.providerId}_fenced_candidate_and_original_times`]=true;
  await assert.rejects(database.transaction(tenantId,async c=>{await c.query("update orchestration.verification_structured_extraction set status=status where tenant_id=$1 and operation_id=$2",[tenantId,operationId]);}));
  await assert.rejects(database.transaction(tenantId,async c=>{await c.query("delete from orchestration.verification_structured_extraction where tenant_id=$1 and operation_id=$2",[tenantId,operationId]);}));
  const providerRow=await database.transaction(tenantId,async c=>(await c.query("select * from orchestration.verification_provider_attempt where tenant_id=$1 and id=$2",[tenantId,providerAttemptId])).rows[0]);assert.ok(providerRow);
  const providerCall:StructuredExtractionProviderCallSnapshot={providerAttemptId,budgetId:String(providerRow.budget_id),providerId:preparation.producerProfile.providerId,model:String(providerRow.model),configurationDigest:preparation.provider.configurationDigest,attemptOrdinal:Number(providerRow.attempt_ordinal),reservationCostMicros:Number(providerRow.reservation_cost_micros),state:"dispatched",actualCostMicros:null,pricingBasis:"synthetic_transport",costEvidenceArtifact:completed.rawResponseArtifact!,supplierBillingVerified:false};
  const publicationInput={lifecycle:StructuredExtractionPublicationLifecycleSnapshotSchema.parse(completed),executionArtifact:execution.artifact,providerCall};
  assert.equal(providerRow.state,"dispatched");assert.equal(providerRow.actual_cost_micros,null);
  const stalePublication=await publicationBuilder.publish(publicationInput);
  await sink.settleOrRetain({costMicros:10});
  await assert.rejects(publicationStore.publish({lease,...stalePublication}),/accounting drift/);
  checks[`${selected.providerId}_real_accounting_transition_rejects_stale_publication`]=true;
  publicationInput.providerCall={...providerCall,state:"settled",actualCostMicros:10};
  const publication=await publicationBuilder.publish(publicationInput);assert.equal(publication.manifest.output.status,"unverified_candidate");assert.equal(publication.manifest.seal.purpose,"artifact_custody_only");
  const forged=structuredClone(publication.manifest);forged.seal.signature.signatureBase64=Buffer.alloc(64).toString("base64");
  await assert.rejects(publicationStore.publish({lease,manifest:forged,artifact:publication.artifact}));
  await assert.rejects(new PostgresStructuredExtractionPublicationStore(database,createEd25519Verifier({})).publish({lease,...publication}),/SIGNATURE_INVALID/);
  await assert.rejects(database.transaction(tenantId,async c=>{await c.query("select set_config('verification.structured_extraction_claim',$1,true)",[sqlClaim]);await c.query("insert into orchestration.verification_structured_extraction_publication(tenant_id,operation_id,publication_artifact_id,publication_sha256,seal_payload_sha256,provider_call_sha256) values($1,$2,$3,$4,$5,$6)",[tenantId,operationId,publication.artifact.artifactId,publication.artifact.digest.slice(7),publication.manifest.seal.payloadDigest.slice(7),"f".repeat(64)]);}),/accounting drift/);
  await assert.rejects(database.transaction(tenantId,async c=>{await c.query("select set_config('verification.structured_extraction_claim',$1,true)",[sqlClaim]);await c.query("insert into orchestration.verification_structured_extraction_publication(tenant_id,operation_id,publication_artifact_id,publication_sha256,seal_payload_sha256,provider_call_sha256) values($1,$2,$3,$4,$5,$6)",[tenantId,operationId,candidate.candidateArtifact.artifactId,candidate.candidateArtifact.digest.slice(7),publication.manifest.seal.payloadDigest.slice(7),publication.manifest.providerCallDigest.slice(7)]);}),/semantic binding mismatch/);
  const boundPublication=await publicationStore.publish({lease,...publication});assert.deepEqual(await publicationStore.publish({lease,...publication}),boundPublication);
  await assert.rejects(database.transaction(tenantId,async c=>{await c.query("update orchestration.verification_structured_extraction_execution set execution_mode='live_provider' where tenant_id=$1 and operation_id=$2",[tenantId,operationId]);}),/immutable/);
  await assert.rejects(database.transaction(tenantId,async c=>{await c.query("delete from orchestration.verification_structured_extraction_publication where tenant_id=$1 and operation_id=$2",[tenantId,operationId]);}),/immutable/);
  checks[`${selected.providerId}_signed_publication_accounting_and_sql_binding`]=true;
  await database.heartbeat(tenantId,lease,600);await new Promise(resolve=>setTimeout(resolve,800));
  const replacement=await database.claimOperation(tenantId,operationId,`${namespace}-replacement`,300_000);assert.ok(replacement&&replacement.fencingToken>lease.fencingToken);
  assert.deepEqual(await store.initialize({identity,lease:replacement}),completed);
  assert.deepEqual(await executionStore.readForRecovery({lease:replacement}),boundExecution);
  assert.deepEqual(await executionStore.bind({lease:replacement,...execution}),boundExecution);
  assert.deepEqual(await publicationBuilder.publish(publicationInput),publication);
  assert.deepEqual(await publicationStore.publish({lease:replacement,...publication}),boundPublication);
  await assert.rejects(publicationStore.publish({lease,...publication}),/STALE_LEASE/);
  await assert.rejects(store.completeRetention({lifecycle:retaining,lease,candidate}));
  assert.deepEqual(await builder.retain(candidateInput),candidate);
  assert.deepEqual(await store.completeRetention({lifecycle:retaining,lease:replacement,candidate}),completed);
  const recoveryAccounting=new PostgresVerificationProviderAccounting(database,{lease:replacement,profileArtifactId:identity.profileArtifact.artifactId,profileDigest:identity.profileArtifact.digest as `sha256:${string}`});assert.equal((await recoveryAccounting.claimDispatch({tenantId,attemptId:providerAttemptId,dispatchFence:randomUUID()})).claimed,false);
  checks[`${selected.providerId}_replacement_reuses_retained_without_dispatch`]=true;
  await assert.rejects(database.transaction(tenantId,async c=>{await c.query("update knowledge_service.operation set status='succeeded' where tenant_id=$1 and id=$2",[tenantId,operationId]);}),/terminal lifecycle not configured/);
  await database.cancelOperation(tenantId,operationId,{actorIdentity:namespace,correlationId:namespace});
  await assert.rejects(store.completeRetention({lifecycle:retaining,lease:replacement,candidate}));checks[`${selected.providerId}_cancellation_and_closed_terminal_guard`]=true;
  await assert.rejects(executionStore.readForRecovery({lease:replacement}));await assert.rejects(publicationStore.publish({lease:replacement,...publication}));
  results.push({providerId:selected.providerId,execution,boundExecution,publication,boundPublication,stalePublication,identity,capture,initialized,retaining,completed,candidate,originalFence:lease.fencingToken,replacementFence:replacement.fencingToken});
 }
 assert.equal(syntheticFetches,3);assert.equal(results.length,2);
 const sources=sourceFiles.map(({path,sha256})=>({path,sha256}));
 const output=resolve("../internal",`verification-structured-extraction-publication-${namespace}.json`);await writeFile(output,JSON.stringify({passed:true,scope:"actual local immutable execution binding and signed custody publication; synthetic transport, unverified candidate; terminal success remains closed",tenantId,fixture:fixtureName,publicKeyPem,dirtyStateArtifact,wrongTypeSourceArtifact,lateBindings,syntheticFetches,externalProviderRequests:0,checks,results,sources},null,2),{flag:"wx"});console.log(JSON.stringify({passed:true,output,checks:Object.keys(checks).length}));
}finally{for(const operationId of operations)await database.cancelOperation(tenantId,operationId,{actorIdentity:namespace,correlationId:namespace});await database.close();}

function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
function gatedDatabase(database:PostgresCanonicalRepository,hooks:{before?:((pid:number)=>void)|undefined;after?:((pid:number)=>Promise<void>)|undefined}):PostgresCanonicalRepository{
 let gated=false;
 return new Proxy(database,{get(target,key){if(key!=="transaction"){const v=Reflect.get(target,key);return typeof v==="function"?v.bind(target):v;}
  return (tenantId:string,body:(client:TenantSqlClient)=>Promise<unknown>)=>target.transaction(tenantId,async client=>body(new Proxy(client,{get(sqlClient,sqlKey){if(sqlKey!=="query"){const v=Reflect.get(sqlClient,sqlKey);return typeof v==="function"?v.bind(sqlClient):v;}return async(sql:string,params?:readonly unknown[])=>{
   if(!gated&&sql.includes("from knowledge_service.operation where")&&sql.endsWith("for update")){gated=true;const pid=Number((await sqlClient.query("select pg_backend_pid() pid")).rows[0]!.pid);hooks.before?.(pid);const value=await sqlClient.query(sql,params);await hooks.after?.(pid);return value;}
   return sqlClient.query(sql,params);
  };}})));
 }});
}
async function assertDatabaseLock(pid:number):Promise<void>{
 const until=Date.now()+5_000;
 while(Date.now()<until){const state=await database.transaction(tenantId,async c=>(await c.query("select wait_event_type from pg_stat_activity where pid=$1",[pid])).rows[0]);if(state?.wait_event_type==="Lock")return;await new Promise(done=>setTimeout(done,20));}
 throw new Error("EXPECTED_ACTUAL_DATABASE_LOCK_WAIT");
}
