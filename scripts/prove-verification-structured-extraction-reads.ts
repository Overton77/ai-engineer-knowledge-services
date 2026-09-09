import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {readFile,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {PostgresCanonicalRepository,PostgresVerificationRepository,PostgresStructuredExtractionReadRepository} from "@aiengineer/knowledge-persistence";
import {SupabaseArtifactStore} from "@aiengineer/knowledge-runtime";
import {createEd25519Verifier} from "@aiengineer/knowledge-verification";

for(const[value,port]of [[process.env.POSTGRES_URL!,"54322"],[process.env.SUPABASE_URL!,"54321"]]){const url=new URL(value!);if(!["localhost","127.0.0.1"].includes(url.hostname)||url.port!==port)throw new Error("LOCAL_ONLY_PROOF_REQUIRED");}
const fixtureName="verification-structured-extraction-worker-97976363-5591-40f7-b4a8-9d00fa805123.json";
const fixture=JSON.parse(await readFile(resolve("../internal",fixtureName),"utf8"));
const tenantId:string=fixture.tenantId,checks:Record<string,boolean>={},results:unknown[]=[];
const database=new PostgresCanonicalRepository({connectionString:process.env.POSTGRES_URL!,localOnly:true});
let reads=0;
const repository=new PostgresVerificationRepository(database,new SupabaseArtifactStore({projectUrl:process.env.SUPABASE_URL!,serviceRoleKey:process.env.SUPABASE_SECRET_KEY!,bucket:"ai-engineer-cloud-bucket",maximumBytes:256_000}),{async authorize(value){assert.equal(value.tenantId,tenantId);assert.equal(value.purpose,"verification_replay");}});
const resolver=()=>{reads++;return repository.createTrustedArtifactResolver();};
const verifier=createEd25519Verifier({"configured-extraction-proof":fixture.publicKeyPem});
const service=new PostgresStructuredExtractionReadRepository(database,resolver,verifier);
try {
  for(const item of fixture.results){
    const loaded=await service.loadVerifiedExtraction(tenantId,item.operationId);
    assert.equal(loaded.kind,item.scenario==="accepted"?"accepted":"failed");
    assert.deepEqual(loaded.manifest,item.manifest);
    const {eventId,fencingToken,...expected}=item.result.receipt.body;
    assert.deepEqual(loaded.result,expected);assert.ok(Object.isFrozen(loaded.result));
    checks[`${item.providerId}_${item.scenario}_terminal_read`]=true;
    results.push({operationId:item.operationId,kind:loaded.kind,artifactId:loaded.artifact.artifactId,digest:loaded.artifact.digest});
  }
  const operationId=fixture.results[0].operationId,before=reads;
  await assert.rejects(service.loadVerifiedExtraction("invalid",operationId),/READ_INVALID/);
  await assert.rejects(service.loadVerifiedExtraction(randomUUID(),operationId),/READ_NOT_FOUND/);
  await assert.rejects(service.loadVerifiedExtraction(tenantId,randomUUID()),/READ_NOT_FOUND/);
  assert.equal(reads,before);checks.invalid_cross_tenant_missing_before_storage=true;
  await assert.rejects(new PostgresStructuredExtractionReadRepository(database,resolver,createEd25519Verifier({})).loadVerifiedExtraction(tenantId,operationId),/READ_INTEGRITY/);
  checks.untrusted_signature_rejected=true;
  const corrupt=()=>{const base=resolver();return {authorizeArtifact:base.authorizeArtifact.bind(base),async hydrateRegisteredArtifact(input:Parameters<typeof base.hydrateRegisteredArtifact>[0]){const loaded=await base.hydrateRegisteredArtifact(input),bytes=loaded.bytes.slice();bytes[0]=bytes[0]!^1;return {...loaded,bytes};}};};
  await assert.rejects(new PostgresStructuredExtractionReadRepository(database,corrupt,verifier).loadVerifiedExtraction(tenantId,operationId),/READ_INTEGRITY/);
  checks.corrupted_actual_storage_bytes_rejected=true;
  for(const fault of ["receipt_hash","receipt_body","step_status","duplicate","during_hydration","receipt_replaced"] as const){
    let snapshots=0;
    const faultDatabase:Pick<PostgresCanonicalRepository,"transaction">={transaction:async(tenant,work)=>database.transaction(tenant,client=>work(new Proxy(client,{get(target,property){
      if(property==="query")return async(sql:string,values?:unknown[])=>{
        const result=await target.query<Record<string,unknown>>(sql,values);
        if(sql.includes("accepted_body")){
          snapshots++;const row=result.rows[0]!;
          if(fault==="receipt_hash")row.output_sha256="0".repeat(64);
          if(fault==="receipt_body")row.body={...row.body as Record<string,unknown>,unexpected:true};
          if(fault==="step_status")row.step_status="running";
          if(fault==="duplicate")result.rows.push(structuredClone(row));
          if(fault==="during_hydration"&&snapshots===2)row.step_status="running";
          if(fault==="receipt_replaced"&&snapshots===2)row.receipt_id=randomUUID();
        }
        return result;
      };
      const value=Reflect.get(target,property,target);return typeof value==="function"?value.bind(target):value;
    }})))};
    const readCount=reads;
    await assert.rejects(new PostgresStructuredExtractionReadRepository(faultDatabase,resolver,verifier).loadVerifiedExtraction(tenantId,operationId),/READ_INTEGRITY/);
    assert.equal(reads,readCount+(["during_hydration","receipt_replaced"].includes(fault)?1:0));
    checks[`${fault}_rejected`]=true;
  }
  const sourceFiles=await Promise.all(["packages/persistence/src/verification-structured-extraction-reads.ts","scripts/prove-verification-structured-extraction-reads.ts"].map(async path=>({path,sha256:createHash("sha256").update(await readFile(path)).digest("hex")})));
  const report={schemaVersion:"verification-structured-extraction-reads-proof.v1",createdAt:new Date().toISOString(),fixtureName,tenantId,checks,results,sourceFiles,supplierRequests:0,limitations:["Server-internal terminal read only; public projection and transports remain pending","No mutations or new provider executions","Receipt and during-hydration faults injected into actual database query results; no concurrent database mutation"]};
  const path=resolve("../internal/verification-structured-extraction-reads-20260906.json");await writeFile(path,JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify({path,checks}));
}finally{await database.close();}
