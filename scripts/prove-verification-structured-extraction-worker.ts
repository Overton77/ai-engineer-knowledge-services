import assert from "node:assert/strict";
import {randomUUID,generateKeyPairSync,createHash} from "node:crypto";
import {readFile,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {PostgresCanonicalRepository,PostgresKnowledgeOperationService,PostgresVerificationRepository,type LeasedStep} from "@aiengineer/knowledge-persistence";
import {SupabaseArtifactStore} from "@aiengineer/knowledge-runtime";
import {canonicalizeJson} from "@aiengineer/knowledge-verification";
import {StructuredExtractionRuntimeGrantSchema,VerificationStructuredExtractionProducerProfileSchema,VerificationExtractionProfileSchema} from "@aiengineer/knowledge-application";
import {createConfiguredVerificationStructuredExtractionHandler} from "../apps/worker/src/verification-structured-extraction-runtime.js";
import {CanonicalActivityRegistry,createCanonicalActivityExecutor} from "../apps/worker/src/activity-registry.js";
import {CanonicalDurableKnowledgeWorker} from "../apps/worker/src/canonical-worker.js";
for(const[value,port]of [[process.env.POSTGRES_URL!,"54322"],[process.env.SUPABASE_URL!,"54321"]]){const url=new URL(value!);if(!["localhost","127.0.0.1"].includes(url.hostname)||url.port!==port)throw new Error("LOCAL_ONLY_PROOF_REQUIRED");}
const fixtureName="verification-structured-extraction-preparation-c6085a8a-8c56-4923-a9ed-dd09666d223d.json",fixture=JSON.parse(await readFile(resolve("../internal",fixtureName),"utf8"));
const tenantId:string=fixture.tenantId,namespace=randomUUID(),operations:string[]=[],results:unknown[]=[],checks:Record<string,boolean>={};let syntheticFetches=0;
const database=new PostgresCanonicalRepository({connectionString:process.env.POSTGRES_URL!,localOnly:true});
const repository=new PostgresVerificationRepository(database,new SupabaseArtifactStore({projectUrl:process.env.SUPABASE_URL!,serviceRoleKey:process.env.SUPABASE_SECRET_KEY!,bucket:"ai-engineer-cloud-bucket",maximumBytes:16_000_000}),{async authorize(value){assert.equal(value.tenantId,tenantId);assert.ok(["verification_admission","verification_replay"].includes(value.purpose));}});
const key=generateKeyPairSync("ed25519"),publicKeyPem=key.publicKey.export({type:"spki",format:"pem"}).toString(),privateKeyPem=key.privateKey.export({type:"pkcs8",format:"pem"}).toString(),keyId="configured-extraction-proof";
const paths=["apps/worker/src/verification-structured-extraction-runtime.ts","apps/worker/src/canonical-worker.ts","apps/worker/src/activity-registry.ts","apps/worker/src/index.ts","packages/persistence/src/verification-provider-accounting.ts","packages/persistence/src/verification-structured-extraction-recovery.ts","scripts/prove-verification-structured-extraction-worker.ts"];
const sourceFiles=await Promise.all(paths.map(async path=>{const bytes=await readFile(path);return {path:`KS/${path}`,sha256:`sha256:${createHash("sha256").update(bytes).digest("hex")}`,byteLength:bytes.byteLength,bytesBase64:bytes.toString("base64")};}));
const register=async(value:unknown,artifactType:string)=>repository.registerContentAddressedArtifact({tenantId,producerAttemptId:fixture.attemptId,artifactType,bytes:new TextEncoder().encode(canonicalizeJson(value)),createdAt:new Date().toISOString(),parentArtifactIds:[],producerActivityId:"configured-extraction-proof",producerVersion:"v1",mediaType:"application/json",encryptionClass:"supabase-managed",retentionClass:"verification-audit",dataClassification:"restricted",bucketClass:"ledger",storageBucket:"ai-engineer-cloud-bucket"});
const dirtyStateArtifact=await register({schemaVersion:"verification-structured-extraction-source-custody.v1",tenantId,scope:"listed_files",totalByteLength:sourceFiles.reduce((sum,f)=>sum+f.byteLength,0),files:sourceFiles},"verification_structured_extraction_source_custody");
const runtime={deploymentId:"configured-extraction-proof",capabilityVersion:"verification-service.v1",platform:"node24-windows",code:{gitSha:"uncommitted",dirty:true,dirtyStateArtifact}};
async function hydrate(handle:{artifactId:string}){const resolver=repository.createTrustedArtifactResolver();await resolver.authorizeArtifact({tenantId,artifactId:handle.artifactId,purpose:"verification_admission"});return JSON.parse(new TextDecoder().decode((await resolver.hydrateRegisteredArtifact({tenantId,artifactId:handle.artifactId})).bytes));}
try{
 for(const selected of fixture.profiles){
  const originalGrant=StructuredExtractionRuntimeGrantSchema.parse(selected.grant);
  const schema=VerificationExtractionProfileSchema.parse(await hydrate(originalGrant.extractionSchema));
  const uniqueSchema={...schema,extractionSchema:{...schema.extractionSchema,schema:{...schema.extractionSchema.schema as Record<string,unknown>,description:`Configured worker ${namespace} ${selected.providerId}`}}};
  const extractionSchema=await register(uniqueSchema,"verification_bundle");
  const profile=VerificationStructuredExtractionProducerProfileSchema.parse(await hydrate(originalGrant.producerProfile));
  const producerProfile=await register({...profile,extractionSchema,profileVersion:`worker-${namespace}`},"verification_structured_extraction_profile");
  const grant={...originalGrant,extractionSchema,producerProfile},request={...selected.request,extractionSchema:{artifactId:extractionSchema.artifactId,digest:extractionSchema.digest}};
  for(const scenario of ["accepted","http","schema"] as const){
   const operationId=randomUUID();operations.push(operationId);
   const config={schemaVersion:"verification-structured-extraction-runtime.v1",tenantId,providerId:selected.providerId,grants:[grant],runtime,parserImageDigest:fixture.imageDigest,executionMode:"synthetic_transport",trustedPublicKeys:{[keyId]:publicKeyPem}};
   const environment={VERIFICATION_STRUCTURED_EXTRACTION_CONFIG_JSON:JSON.stringify(config),VERIFICATION_STRUCTURED_EXTRACTION_SIGNING_KEY_ID:keyId,VERIFICATION_STRUCTURED_EXTRACTION_SIGNING_PRIVATE_KEY_PEM:privateKeyPem};
   const handler=createConfiguredVerificationStructuredExtractionHandler({database,tenantId,projectUrl:process.env.SUPABASE_URL!,serviceRoleKey:process.env.SUPABASE_SECRET_KEY!,maximumArtifactBytes:16_000_000,environment,syntheticFetch:async(_url,options)=>{syntheticFetches++;const wire=JSON.parse(new TextDecoder().decode(options?.body as Uint8Array));const raw={id:`${namespace}-${scenario}-${operationId}`,model:wire.model,...(scenario==="http"?{error:{message:"Synthetic unavailable"}}:{choices:[{message:{content:JSON.stringify({value:scenario==="accepted"?"Exact value 42":42})}}],precontext:[],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15,cost:0.00001}})};return new Response(JSON.stringify(raw),{status:scenario==="http"?503:200});}});assert.ok(handler);
   const registry=new CanonicalActivityRegistry([handler]);assert.deepEqual(registry.activities(),["verification_structured_extraction:extract_and_register"]);
   const service=new PostgresKnowledgeOperationService(database,{admittedOperationKinds:registry.operationKinds()});
   const context={tenantId,operationId,attemptId:fixture.attemptId,missionId:fixture.missionId,workItemId:fixture.workItemId,correlationId:namespace,actor:{kind:"service",id:namespace,serviceIdentity:"knowledge_worker"},capabilityVersion:"verification-service.v1",idempotencyKey:`${namespace}-${operationId}`,reason:"Configured synthetic extraction worker proof",contractVersion:"v1"};
   await service.submit("verification_structured_extraction",{context,input:{schemaVersion:"verification-service-request.v1",useCase:"extractStructuredData",request},expectedVersions:{verification:"verification.v1",service:"verification-service-request.v1"}},"http://localhost");
   let stoppedLease:LeasedStep|undefined;
   const interruptedRepository=new Proxy(database,{get(target,property){if(property==="completeStep"||property==="failStructuredExtractionStep")return async(_tenant:string,lease:LeasedStep)=>{stoppedLease=lease;throw new Error("SIMULATED_POST_PUBLICATION_STOP");};if(property==="failStep")return async()=>{throw new Error("SIMULATED_STOP_PREVENTS_CATCH_CLEANUP");};const value=Reflect.get(target,property,target);return typeof value==="function"?value.bind(target):value;}});
   const interruptedWorker=new CanonicalDurableKnowledgeWorker(namespace,tenantId,interruptedRepository,createCanonicalActivityExecutor(database,registry),30_000,registry.operationKinds());
   const before=syntheticFetches;await assert.rejects(interruptedWorker.runOperationOnce(operationId),/SIMULATED_POST_PUBLICATION_STOP/);assert.ok(stoppedLease);assert.equal(syntheticFetches,before+1);assert.equal((await database.getOperation(tenantId,operationId))?.status,"running");assert.equal((await database.listReceipts(tenantId,operationId)).length,0);
   await database.heartbeat(tenantId,stoppedLease,400);await new Promise(resolve=>setTimeout(resolve,600));
   const worker=new CanonicalDurableKnowledgeWorker(`${namespace}-replacement`,tenantId,database,createCanonicalActivityExecutor(database,registry),30_000,registry.operationKinds());
   const result=await worker.runOperationOnce(operationId);assert.ok(result);assert.equal(syntheticFetches,before+1);assert.equal(result.operation?.status,scenario==="accepted"?"succeeded":"failed");assert.equal(result.receipt.receiptKind,scenario==="accepted"?"extract_and_register.succeeded":"extract_and_register.failed");
   assert.ok(Number((result.receipt.body as Record<string,unknown>).fencingToken)>stoppedLease.fencingToken);
   checks[`${selected.providerId}_${scenario}_published_recovery_without_redispatch`]=true;
   assert.equal(await worker.runOperationOnce(operationId),undefined);assert.equal(syntheticFetches,before+1);
   const body=result.receipt.body as Record<string,unknown>,output=body.output as Record<string,unknown>;assert.equal(output.status,scenario==="accepted"?"unverified_candidate":"failed");if(scenario!=="accepted"){assert.equal(output.candidateArtifact,null);assert.equal(output.automaticRetry,false);assert.equal(output.code,scenario==="http"?"PROVIDER_HTTP_FAILURE":"PROVIDER_RESPONSE_SCHEMA_INVALID");}
   const finalArtifact=body.resultArtifact as {artifactId:string};const manifest=await hydrate(finalArtifact);
   const provider=(await database.transaction(tenantId,c=>c.query("select * from orchestration.verification_provider_attempt where tenant_id=$1 and operation_id=$2",[tenantId,operationId]))).rows;assert.equal(provider.length,1);assert.equal(Number(provider[0]!.attempt_ordinal),0);assert.equal(provider[0]!.state,scenario==="accepted"?"settled":"uncertain");assert.equal(provider[0]!.actual_cost_micros,scenario==="accepted"?"10":null);
   checks[`${selected.providerId}_${scenario}_configured_worker_terminal_and_no_reclaim`]=true;
   results.push({originalFencingToken:stoppedLease.fencingToken,providerId:selected.providerId,scenario,operationId,result,manifest,grant,request,providerAttemptId:provider[0]!.id});
  }
 }
 assert.equal(syntheticFetches,6);
 const report={schemaVersion:"verification-structured-extraction-worker-proof.v1",namespace,tenantId,fixtureName,createdAt:new Date().toISOString(),syntheticFetches,supplierRequests:0,checks,publicKeyPem,dirtyStateArtifact,sourceFiles:sourceFiles.map(({bytesBase64,...file})=>file),results,limitations:["Injected synthetic transport only; no supplier billing verification","Configured worker recovery uses injected post-publication stop and natural lease expiry; no OS process-kill test","Default public admission remains closed; public transports/reads unfinished","Source custody covers listed files only"]};
 const output=resolve("../internal",`verification-structured-extraction-worker-${namespace}.json`);await writeFile(output,JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify({output,checks:Object.keys(checks).length,syntheticFetches}));
}finally{for(const operationId of operations){const op=await database.getOperation(tenantId,operationId);if(op&&!["failed","succeeded","cancelled"].includes(op.status))await database.cancelOperation(tenantId,operationId,{actorIdentity:namespace,correlationId:namespace});}await database.close();}
