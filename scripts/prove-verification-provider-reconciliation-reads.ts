import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import {readFile,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {PostgresCanonicalRepository,PostgresVerificationRepository,PostgresProviderReconciliationReadRepository,PostgresProviderReconciliationStore} from "@aiengineer/knowledge-persistence";
import {SupabaseArtifactStore} from "@aiengineer/knowledge-runtime";
import {ProviderReconciliationAdmission} from "@aiengineer/knowledge-application";
import {VerificationProviderReconciliationSchema,VerificationArtifactHandleSchema} from "@aiengineer/knowledge-contracts";
import {createEd25519Verifier,type TrustedArtifactResolver} from "@aiengineer/knowledge-verification";
for(const[value,port]of [[process.env.POSTGRES_URL!,"54322"],[process.env.SUPABASE_URL!,"54321"]]){const url=new URL(value!);assert.ok(["localhost","127.0.0.1"].includes(url.hostname)&&url.port===port);}
const fixtureName=process.env.VERIFICATION_EXTRACTION_WORKER_RECEIPT!;
assert.match(fixtureName,/^verification-provider-reconciliation-publications-[a-f0-9-]+\.json$/);
const fixture=JSON.parse(await readFile(resolve("../internal",fixtureName),"utf8")),tenantId:string=fixture.tenantId;
const database=new PostgresCanonicalRepository({connectionString:process.env.POSTGRES_URL!,localOnly:true});
const repository=new PostgresVerificationRepository(database,new SupabaseArtifactStore({projectUrl:process.env.SUPABASE_URL!,serviceRoleKey:process.env.SUPABASE_SECRET_KEY!,bucket:"ai-engineer-cloud-bucket",maximumBytes:1_000_000}),{async authorize(value){assert.equal(value.tenantId,tenantId);assert.equal(value.purpose,"verification_replay");}});
const control:Pick<PostgresCanonicalRepository,"transaction">={transaction:async(tenant,work)=>database.transaction(tenant,async client=>{await client.query("set local role control_plane");return work(client);})};
const checks:Record<string,boolean>={},results:unknown[]=[];
try{
 for(const item of fixture.results){
  const receipt=VerificationProviderReconciliationSchema.parse(item.receipt),artifact=VerificationArtifactHandleSchema.parse(item.artifact);
  const grant={tenantId,providerId:receipt.providerId,keyId:receipt.seal.signature.keyId,operatorId:receipt.operatorId,basis:receipt.decision.basis};
  let hydrations=0;
  const factory=():TrustedArtifactResolver=>{const native=repository.createTrustedArtifactResolver();return{authorizeArtifact:input=>native.authorizeArtifact(input),hydrateRegisteredArtifact:async input=>{hydrations++;return native.hydrateRegisteredArtifact(input);}};};
  const verifier=createEd25519Verifier({[receipt.seal.signature.keyId]:fixture.publicKeyPem});
  const afterExpiry=()=>new Date(Date.parse(receipt.expiresAt)+86_400_000);
  const admission=new ProviderReconciliationAdmission([grant],factory,verifier,afterExpiry);
  const reader=new PostgresProviderReconciliationReadRepository(control,admission,factory);
  const snapshot=async()=>database.transaction(tenantId,async c=>(await c.query("select to_jsonb(r) ledger,to_jsonb(p) provider from orchestration.verification_provider_reconciliation r join orchestration.verification_provider_attempt p on p.tenant_id=r.tenant_id and p.id=r.provider_attempt_id where r.tenant_id=$1 and r.provider_attempt_id=$2",[tenantId,receipt.providerAttemptId])).rows);
  const before=await snapshot(),result=await reader.loadAppliedDecision(tenantId,receipt.operationId,receipt.providerAttemptId);
  assert.deepEqual(result,item.result);
  await assert.rejects(admission.admit({tenantId,artifact}),/ADMISSION_DENIED/);
  const evidence=await admission.verifyEvidenceAt({tenantId,artifact,appliedAt:result.appliedAt});
  assert.throws(()=>admission.assertPermit(evidence),/ISSUER_REQUIRED/);
  await assert.rejects(new PostgresProviderReconciliationStore(control,admission).apply(evidence),/ISSUER_REQUIRED/);
  await assert.rejects(admission.verifyEvidenceAt({tenantId,artifact,appliedAt:receipt.expiresAt}),/ADMISSION_DENIED/);
  await assert.rejects(admission.verifyEvidenceAt({tenantId,artifact,appliedAt:new Date(afterExpiry().getTime()+1).toISOString()}),/INVALID_APPLICATION_TIME/);
  checks[`${receipt.providerId}:${item.scenario}:expired_read_not_mutation`]=true;
  const count=hydrations;
  await assert.rejects(reader.loadAppliedDecision(tenantId,randomUUID(),receipt.providerAttemptId),/NOT_FOUND/);
  await assert.rejects(reader.loadAppliedDecision(randomUUID(),receipt.operationId,receipt.providerAttemptId),/NOT_FOUND/);
  assert.equal(hydrations,count);
  checks[`${receipt.providerId}:${item.scenario}:scope_before_storage`]=true;
  const unknown=new ProviderReconciliationAdmission([grant],factory,createEd25519Verifier({}),afterExpiry);
  await assert.rejects(new PostgresProviderReconciliationReadRepository(control,unknown,factory).loadAppliedDecision(tenantId,receipt.operationId,receipt.providerAttemptId),/INTEGRITY/);
  const corrupt=():TrustedArtifactResolver=>{const native=factory();return{authorizeArtifact:input=>native.authorizeArtifact(input),hydrateRegisteredArtifact:async input=>{const loaded=await native.hydrateRegisteredArtifact(input);return input.artifactId===receipt.billingEvidenceArtifact.artifactId?{...loaded,bytes:new Uint8Array(loaded.bytes.length)}:loaded;}};};
  await assert.rejects(new PostgresProviderReconciliationReadRepository(control,new ProviderReconciliationAdmission([grant],corrupt,verifier,afterExpiry),corrupt).loadAppliedDecision(tenantId,receipt.operationId,receipt.providerAttemptId),/INTEGRITY/);
  assert.deepEqual(await snapshot(),before);
  checks[`${receipt.providerId}:${item.scenario}:integrity_and_no_mutation`]=true;
  for(const fault of ["duplicate","cost","during_hydration"]){
    let snapshots=0;
    const faulty:Pick<PostgresCanonicalRepository,"transaction">={transaction:async(tenant,work)=>control.transaction(tenant,client=>work(new Proxy(client,{get(target,property){
      if(property==="query")return async(sql:string,values?:unknown[])=>{
        const queried=await target.query<Record<string,unknown>>(sql,values);
        if(sql.includes("select r.*")){
          snapshots++;const row=queried.rows[0]!;
          if(fault==="duplicate")queried.rows.push(structuredClone(row));
          if(fault==="cost")row.actual_cost_micros=999;
          if(fault==="during_hydration"&&snapshots===2)row.artifact_sha256="0".repeat(64);
        }
        return queried;
      };
      const value=Reflect.get(target,property,target);return typeof value==="function"?value.bind(target):value;
    }})))};
    await assert.rejects(new PostgresProviderReconciliationReadRepository(faulty,admission,factory).loadAppliedDecision(tenantId,receipt.operationId,receipt.providerAttemptId),/INTEGRITY/);
  }
  checks[`${receipt.providerId}:${item.scenario}:ledger_faults`]=true;
  results.push(result);
 }
 const sourceFiles=await Promise.all(["packages/application/src/verification-provider-reconciliation.ts","packages/persistence/src/verification-provider-reconciliation-reads.ts","scripts/prove-verification-provider-reconciliation-reads.ts"].map(async path=>({path,sha256:createHash("sha256").update(await readFile(path)).digest("hex")})));
 const output=resolve(`../internal/verification-provider-reconciliation-reads-${randomUUID()}.json`);
 await writeFile(output,JSON.stringify({passed:true,fixtureName,checks,results,sourceFiles,supplierRequests:0,limitations:["Historical expiry uses an injected clock; actual ledger, signatures and Storage evidence are verified","Internal control-plane read only; actor-authorized runtime and HTTP remain pending"]},null,2)+"\n");console.log(JSON.stringify({output,checks}));
}finally{await database.close();}
