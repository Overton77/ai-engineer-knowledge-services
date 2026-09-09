import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {randomUUID} from "node:crypto";
import {resolve} from "node:path";
import {VerificationOperationApplicationService,type VerificationMetricApplicationService,type VerificationMetricProfileGrant,type VerificationSealPolicyGrant} from "@aiengineer/knowledge-application";
import type {OperationContext,VerifyMetricObservationRequest} from "@aiengineer/knowledge-contracts";
import {PostgresKnowledgeOperationService,type PostgresCanonicalRepository,type PostgresVerificationRepository,type LeasedStep} from "@aiengineer/knowledge-persistence";
import {CanonicalActivityRegistry} from "../apps/worker/src/activity-registry.js";
import {CanonicalDurableKnowledgeWorker} from "../apps/worker/src/canonical-worker.js";
import {verificationMetricActivityHandler} from "../apps/worker/src/verification-metric-activity.js";
import type {VerificationMetricAuditSealer} from "../apps/worker/src/verification-metric-sealer.js";

export async function proveMetricSealCrash(input:{
  database:PostgresCanonicalRepository;repository:PostgresVerificationRepository;service:VerificationMetricApplicationService;sealer:VerificationMetricAuditSealer;
  context:OperationContext;request:VerifyMetricObservationRequest;profileGrant:VerificationMetricProfileGrant;policyGrant:VerificationSealPolicyGrant;
  imageDigest:string;verifierDeploymentId:string;
}){
  const {tenantId}=input.context;
  const service=new VerificationOperationApplicationService(new PostgresKnowledgeOperationService(input.database,{admittedOperationKinds:["verification_metric"]}),"http://localhost");
  const accepted=await service.submitVerifyMetricObservation(input.request,input.context);
  const child=spawn(process.execPath,["--import","tsx",resolve("scripts/verification-seal-crash-child.ts")],{
    windowsHide:true,stdio:["ignore","ignore","ignore","ipc"],env:{SYSTEMROOT:process.env.SYSTEMROOT,WINDIR:process.env.WINDIR,
      POSTGRES_URL:process.env.POSTGRES_URL,SUPABASE_URL:process.env.SUPABASE_URL,SUPABASE_SECRET_KEY:process.env.SUPABASE_SECRET_KEY},
  });
  const exited=new Promise<{code:number|null;signal:NodeJS.Signals|null}>(resolveExit=>child.once("exit",(code,signal)=>resolveExit({code,signal})));
  let sealed:{kind:"sealed";seal:{runId:string;manifestDigest:string;policyOutcome:string};claim:LeasedStep};
  let termination:{code:number|null;signal:NodeJS.Signals|null};
  let killAccepted=false;
  try{
    const received=new Promise<typeof sealed>((resolveMessage,reject)=>{
      const timer=setTimeout(()=>reject(new Error("SEAL_CRASH_CHILD_TIMEOUT")),45_000);
      child.once("error",()=>{clearTimeout(timer);reject(new Error("SEAL_CRASH_CHILD_SPAWN_FAILED"));});
      child.once("exit",()=>{clearTimeout(timer);reject(new Error("SEAL_CRASH_CHILD_EXITED_EARLY"));});
      child.once("message",message=>{
        clearTimeout(timer);
        const value=message as typeof sealed&{code?:string};
        if(value.kind!=="sealed")return reject(new Error(`SEAL_CRASH_CHILD_FAILED:${value.code??"UNKNOWN"}`));
        resolveMessage(value);
      });
    });
    child.send({kind:"fixture",fixture:{tenantId,operationId:accepted.operationId,profileGrant:input.profileGrant,policyGrant:input.policyGrant,
      imageDigest:input.imageDigest,verifierDeploymentId:input.verifierDeploymentId}});
    sealed=await received;
    assert.equal(sealed.claim.operationId,accepted.operationId);
    assert.equal((await input.database.getOperation(tenantId,accepted.operationId))?.status,"running");
    assert.equal((await input.database.listReceipts(tenantId,accepted.operationId)).length,0);
    const durable=await input.repository.loadAuditBundleForOperationRecovery({tenantId,runId:sealed.seal.runId,operationId:accepted.operationId,verifierAttemptId:input.context.attemptId});
    assert.equal(durable?.manifest.canonicalization.manifestDigest,sealed.seal.manifestDigest);
    await assert.rejects(input.repository.loadAuditBundle(tenantId,sealed.seal.runId),/OPERATION_NOT_COMPLETED/);
  }finally{
    if(child.exitCode===null&&child.signalCode===null)killAccepted=child.kill("SIGKILL");
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{termination=await Promise.race([exited,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error("SEAL_CRASH_CHILD_TERMINATION_TIMEOUT")),10_000);})]);}
    finally{if(timer)clearTimeout(timer);}
  }
  assert.ok(killAccepted,"SEAL_CRASH_CHILD_WAS_NOT_KILLED");
  assert.equal(termination!.signal,"SIGKILL");
  const handler=verificationMetricActivityHandler({service:input.service,repository:input.repository,operations:input.database,
    storageBucket:"ai-engineer-cloud-bucket",now:()=>new Date().toISOString(),sealer:input.sealer});
  const registry=new CanonicalActivityRegistry([handler]);
  let replacementClaim:LeasedStep|undefined;
  const replacement=new CanonicalDurableKnowledgeWorker(`seal-replacement-${randomUUID()}`,tenantId,input.database,async claim=>{
    replacementClaim=claim;
    const operation=await input.database.getOperationRecord(tenantId,claim.operationId);assert.ok(operation);
    return registry.execute(operation,claim);
  },1500,registry.operationKinds());
  const deadline=Date.now()+15_000;
  let completed:Awaited<ReturnType<typeof replacement.runOperationOnce>>;
  do{
    completed=await replacement.runOperationOnce(accepted.operationId);
    if(!completed)await new Promise(resolveWait=>setTimeout(resolveWait,100));
  }while(!completed&&Date.now()<deadline);
  assert.ok(completed);assert.ok(replacementClaim);
  assert.equal(completed.operation?.status,"succeeded");
  assert.ok(replacementClaim.fencingToken>sealed!.claim.fencingToken);
  const audit=await input.repository.loadAuditBundle(tenantId,sealed!.seal.runId);
  assert.equal(audit.manifest.canonicalization.manifestDigest,sealed!.seal.manifestDigest);
  await assert.rejects(input.database.completeStep(tenantId,sealed!.claim,{id:randomUUID(),idempotencyKey:`stale-${randomUUID()}`,
    receiptKind:"stale-proof",executorIdentity:"dead-worker",output:{stale:true}}),/STALE_LEASE/);
  const receipts=await input.database.listReceipts(tenantId,accepted.operationId);
  assert.equal(receipts.filter(item=>item.outcome==="succeeded").length,1);
  const rows=await input.database.transaction(tenantId,async client=>(await client.query<{count:string}>("select count(*) from evidence.verification_run where tenant_id=$1 and operation_id=$2",[tenantId,accepted.operationId])).rows[0]);
  assert.equal(rows?.count,"1");
  return {operationId:accepted.operationId,runId:sealed!.seal.runId,manifestDigest:sealed!.seal.manifestDigest,
    oldFence:sealed!.claim.fencingToken,newFence:replacementClaim.fencingToken,childPid:child.pid,termination:termination!,
    checks:{workerKilledAfterDurableSealBeforeReceipt:true,replacementReusedOriginalSeal:true,deadSealingWorkerFenced:true,singleSealAndTerminalReceiptAfterCrash:true}};
}
