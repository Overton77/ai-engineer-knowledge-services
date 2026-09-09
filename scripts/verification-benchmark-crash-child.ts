import { readFile } from "node:fs/promises";
import { UuidSchema } from "@aiengineer/knowledge-contracts";
import { parseVerificationBenchmarkRuntimeConfig } from "@aiengineer/knowledge-application";
import { PostgresCanonicalRepository, PostgresVerificationBenchmarkPublisher, PostgresVerificationBenchmarkRunStore, type LeasedStep } from "@aiengineer/knowledge-persistence";
import { CanonicalActivityRegistry, createCanonicalActivityExecutor } from "../apps/worker/src/activity-registry.js";
import { CanonicalDurableKnowledgeWorker } from "../apps/worker/src/canonical-worker.js";
import { createConfiguredVerificationBenchmarkHandler } from "../apps/worker/src/verification-benchmark-runtime.js";

function local(value:string|undefined,port:string){if(!value)throw new Error("BENCHMARK_CHILD_LOCAL_CONFIGURATION_REQUIRED");const url=new URL(value);if(!["localhost","127.0.0.1"].includes(url.hostname)||url.port!==port)throw new Error("BENCHMARK_CHILD_REMOTE_REFUSED");return value;}
const connectionString=local(process.env.POSTGRES_URL,"54322"),projectUrl=local(process.env.SUPABASE_URL,"54321");
if(!process.send||!process.env.SUPABASE_SECRET_KEY)throw new Error("BENCHMARK_CHILD_IPC_AND_STORAGE_REQUIRED");
const operationId=UuidSchema.parse(process.env.BENCHMARK_PROOF_OPERATION_ID),path=process.env.BENCHMARK_PROOF_CONFIG_FILE;
if(!path)throw new Error("BENCHMARK_CHILD_CONFIG_FILE_REQUIRED");
const raw=await readFile(path,"utf8"),config=parseVerificationBenchmarkRuntimeConfig(raw);
const crashPoint=process.env.BENCHMARK_PROOF_CRASH_POINT;
if(!["checkpoint5","sealed","none"].includes(crashPoint??""))throw new Error("BENCHMARK_CHILD_CRASH_POINT_INVALID");
const database=new PostgresCanonicalRepository({connectionString,localOnly:true});
let claim:LeasedStep|undefined;
const send=(value:unknown)=>new Promise<void>((resolve,reject)=>{if(!process.send||!process.connected){reject(new Error("BENCHMARK_CHILD_IPC_CLOSED"));return;}process.send(value,error=>error?reject(error):resolve());});
const parked=()=>new Promise<never>(()=>undefined);
// Test-only interception occurs after the actual committed DB call. The parent
// terminates this OS process; checkpoints/manifests are never fabricated here.
let saved=0;
const originalSave=PostgresVerificationBenchmarkRunStore.prototype.save;
PostgresVerificationBenchmarkRunStore.prototype.save=async function(...args:Parameters<typeof originalSave>){
  await originalSave.apply(this,args);
  if(crashPoint==="checkpoint5"&&++saved===5){await send({kind:"checkpoint5",claim,runId:args[0].runId,checkpointDigest:args[3].checkpointDigest});await parked();}
};
const originalPublish=PostgresVerificationBenchmarkPublisher.prototype.publishCompleted;
PostgresVerificationBenchmarkPublisher.prototype.publishCompleted=async function(...args:Parameters<typeof originalPublish>){
  const published=await originalPublish.apply(this,args);
  if(crashPoint==="sealed"){await send({kind:"sealed",claim,published,publicationManifest:args[0].publicationManifest});await parked();}
  return published;
};
try{
  const handler=createConfiguredVerificationBenchmarkHandler({database,tenantId:config.tenantId,projectUrl,serviceRoleKey:process.env.SUPABASE_SECRET_KEY,maximumArtifactBytes:8*1024*1024,environment:{...process.env,VERIFICATION_BENCHMARK_CONFIG_JSON:raw}});
  if(!handler)throw new Error("BENCHMARK_CHILD_HANDLER_REQUIRED");
  const registry=new CanonicalActivityRegistry([handler]),execute=createCanonicalActivityExecutor(database,registry);
  const worker=new CanonicalDurableKnowledgeWorker(`benchmark-child-${process.pid}`,config.tenantId,database,async value=>{claim=value;return execute(value);},30_000,registry.operationKinds());
  const result=await worker.runOperationOnce(operationId);
  await send({kind:"completed",claim,result});
}catch(error){
  const message=error instanceof Error?error.message:"";
  await send({kind:"error",code:/^[A-Z][A-Z0-9_]{2,127}$/.test(message)?message:"BENCHMARK_CHILD_FAILURE"}).catch(()=>undefined);
  process.exitCode=1;
}finally{await database.close();if(process.connected)process.disconnect?.();}
