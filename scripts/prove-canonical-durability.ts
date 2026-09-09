import { randomBytes } from "node:crypto";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { canonicalJson, sha256Digest } from "@aiengineer/knowledge-domain";

const startedAt=new Date().toISOString();
const proofRunNamespace=`gate6-canonical-durability-v7:${startedAt}:${randomBytes(8).toString("hex")}`;
process.env.KNOWLEDGE_CANONICAL_PROOF_NAMESPACE=proofRunNamespace;
const { FIXTURE_TENANT_ID, packetId }=await import("./canonical-fixture.js");
const command=process.execPath;
const tsxCli=resolve("node_modules/tsx/dist/cli.mjs");
const boundaries:{name:string;pid?:number;reportedPid?:number;exitCode:number|null;startedAt:string;endedAt:string}[]=[];
function child(name:string,args:string[],extraEnv:NodeJS.ProcessEnv={}){const start=new Date().toISOString();const result=spawnSync(command,[tsxCli,...args],{cwd:process.cwd(),env:{...process.env,...extraEnv},encoding:"utf8",timeout:120_000});const end=new Date().toISOString();let payload:Record<string,unknown>={};const lines=(result.stdout??"").trim().split(/\r?\n/).filter(Boolean);try{payload=JSON.parse(lines.at(-1)??"{}");}catch{payload={rawOutputClass:"NON_JSON_CHILD_OUTPUT"};}boundaries.push({reportedPid:typeof payload.pid==="number"?payload.pid:undefined,exitCode:result.status,startedAt:start,endedAt:end,name});if(result.status!==0)throw new Error(`${name} failed (${result.error?.message??"no spawn error"}): ${`${result.stderr??""}\n${result.stdout??""}`.slice(-4000)}`);return payload;}
function docker(action:"pause"|"unpause"){const result=spawnSync("docker",[action,"supabase_db_aiengineer"],{encoding:"utf8",timeout:15_000});if(result.status!==0)throw new Error(`docker ${action} failed`);}
async function waitForReady(api:ChildProcessWithoutNullStreams){return new Promise<Record<string,unknown>>((resolveReady,reject)=>{let buffer="";const timer=setTimeout(()=>reject(new Error("API_READY_TIMEOUT")),15_000);api.stdout.on("data",(chunk)=>{buffer+=String(chunk);const lines=buffer.split(/\r?\n/);buffer=lines.pop()??"";for(const line of lines){try{const value=JSON.parse(line) as Record<string,unknown>;if(value.phase==="api_ready"){clearTimeout(timer);resolveReady(value);}}catch{}}});api.once("exit",(code)=>{clearTimeout(timer);reject(new Error(`API_EXITED_BEFORE_READY:${code}`));});api.once("error",reject);});}

const processA=child("process_a_apps_worker",["apps/worker/src/canonical-fixture-worker.ts"]);
const processB=child("process_b_fresh_retrieval",["scripts/canonical-fixture.ts","retrieve"]);
const recovery=child("rollback_rebuild",["scripts/canonical-fixture.ts","rebuild"]);
const drills=child("lease_outbox_provider_reranker",["scripts/canonical-fixture.ts","drill"]);
let outage:Record<string,unknown>;let restored:Record<string,unknown>;
docker("pause");
try{outage=child("database_outage_expected_failure",["scripts/canonical-fixture.ts","health"],{POSTGRES_CONNECTION_TIMEOUT_MS:"800"});}finally{docker("unpause");}
restored=child("database_recovery",["scripts/canonical-fixture.ts","health"]);
if(outage.ok!==false||outage.failureClass!=="DATABASE_UNAVAILABLE"||restored.ok!==true)throw new Error("DATABASE_FAILURE_RECOVERY_DRILL_FAILED");

const token=randomBytes(32).toString("hex");const apiStarted=new Date().toISOString();const api=spawn(command,[tsxCli,"scripts/canonical-fixture.ts","api"],{cwd:process.cwd(),env:{...process.env,KNOWLEDGE_API_TOKEN:token,PORT:"4187"},stdio:["ignore","pipe","pipe"]});const ready=await waitForReady(api);const httpClient=child("fresh_http_knowledge_client",["scripts/canonical-fixture.ts","api-client"],{KNOWLEDGE_API_TOKEN:token,KNOWLEDGE_API_URL:"http://127.0.0.1:4187"});api.kill();await new Promise((resolveExit)=>api.once("exit",resolveExit));boundaries.push({name:"actual_knowledge_api",pid:api.pid,reportedPid:typeof ready.pid==="number"?ready.pid:undefined,exitCode:api.exitCode,startedAt:apiStarted,endedAt:new Date().toISOString()});

const core={schemaVersion:"canonical-durability-proof/1.0.0",storeClass:"internal_exploratory",canonicalAuthority:false,localOnly:true,proofRunNamespace,tenantId:FIXTURE_TENANT_ID,packetId,startedAt,completedAt:new Date().toISOString(),processBoundaries:boundaries,processA,processB,recovery,drills,database:{outage,restored},http:{api:{pid:ready.pid,address:ready.address,packetId:ready.packetId},client:httpClient,tokenPersisted:false}};const receipt={...core,receiptDigest:sha256Digest(JSON.parse(JSON.stringify(core)))};const output=resolve("catalog/canonical-durability-proof.json");await mkdir(resolve("catalog"),{recursive:true});await writeFile(output,`${canonicalJson(JSON.parse(JSON.stringify(receipt)))}\n`,"utf8");process.stdout.write(`${JSON.stringify({ok:true,output,receiptDigest:receipt.receiptDigest,packetId,proofRunNamespace,boundaries:boundaries.map((item)=>({name:item.name,pid:item.pid,reportedPid:item.reportedPid,exitCode:item.exitCode}))})}\n`);
