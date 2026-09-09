import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PostgresCanonicalRepository } from "../packages/persistence/src/postgres.js";
import { PostgresKnowledgeOperationService } from "../packages/persistence/src/operation-service.js";
import { createVerificationOwnershipResolver } from "../apps/api/src/verification-ownership.js";
import { buildServer } from "../apps/api/src/server.js";

const connectionString = process.env.POSTGRES_URL;
if (!connectionString) throw new Error("LOCAL_POSTGRES_REQUIRED");
const database = new PostgresCanonicalRepository({ connectionString, localOnly: true });
const tenantId=randomUUID(),missionId=randomUUID(),workItemId=randomUUID(),attemptId=randomUUID();
const namespace=`verification-operation-ownership-${randomUUID()}`;
const checks: Record<string, boolean> = {};
try {
  await database.transaction(tenantId, async client => {
    await client.query("insert into orchestration.mission(id,tenant_id,slug,goal) values($1,$2,$3,'Verify durable operation ownership')",[missionId,tenantId,namespace]);
    await client.query("insert into orchestration.work_item(id,tenant_id,mission_id,kind) values($1,$2,$3,'verify_claims')",[workItemId,tenantId,missionId]);
    await client.query("insert into orchestration.attempt(id,tenant_id,work_item_id,attempt_no,agent_deployment_id) values($1,$2,$3,1,'verification-ownership-proof')",[attemptId,tenantId,workItemId]);
  });
  const service=new PostgresKnowledgeOperationService(database,{admittedOperationKinds:["verification_extraction"]});
  const context={tenantId,missionId,workItemId,attemptId,operationId:randomUUID(),correlationId:randomUUID(),
    actor:{kind:"service" as const,id:randomUUID(),serviceIdentity:"mission_control_client" as const},
    capabilityVersion:"verification-service.v1",idempotencyKey:namespace,reason:"local ownership proof",contractVersion:"v1" as const,
    externalExecution:{runtime:"mission_control" as const,runId:namespace}};
  const envelope={context,input:{schemaVersion:"verification-service-request.v1",useCase:"verifyExtraction",proof:true},expectedVersions:{verification:"verification.v1"}};
  const grant={tenantId,actor:context.actor,missionId,agentDeploymentId:"verification-ownership-proof",capabilityVersion:"verification-service.v1",externalExecution:context.externalExecution};
  const resolver=createVerificationOwnershipResolver(database,JSON.stringify([grant]));
  const resolutionInput={tenantId,identity:{actor:context.actor},correlationId:context.correlationId,idempotencyKey:namespace,useCase:"verifyExtraction",hints:{attemptId,missionId,workItemId,externalExecution:context.externalExecution}};
  const resolved=await resolver(resolutionInput);
  assert.equal(resolved?.attemptId,attemptId);assert.equal(resolved?.missionId,missionId);checks.databaseOwnershipResolved=true;
  for(const [name,changed] of Object.entries({
    wrongActor:{...resolutionInput,identity:{actor:{...context.actor,id:randomUUID()}}},
    wrongTenant:{...resolutionInput,tenantId:randomUUID()},
    wrongWorkItem:{...resolutionInput,hints:{...resolutionInput.hints,workItemId:randomUUID()}},
    wrongAttempt:{...resolutionInput,hints:{...resolutionInput.hints,attemptId:randomUUID()}},
    wrongMission:{...resolutionInput,hints:{...resolutionInput.hints,missionId:randomUUID()}},
    wrongExternalRun:{...resolutionInput,hints:{...resolutionInput.hints,externalExecution:{...context.externalExecution,runId:"ungranted-run"}}},
  })) {assert.equal(await resolver(changed),undefined);checks[`${name}Denied`]=true;}
  const wrongDeployment=createVerificationOwnershipResolver(database,JSON.stringify([{...grant,agentDeploymentId:"ungranted-deployment"}]));
  assert.equal(await wrongDeployment(resolutionInput),undefined);checks.wrongDeploymentDenied=true;
  const accepted=await service.submit("verification_extraction",envelope,"http://localhost");
  const row=await database.transaction(tenantId,async client=>(await client.query("select mission_id,work_item_id,attempt_id,actor_identity,request from knowledge_service.operation where tenant_id=$1 and id=$2",[tenantId,accepted.operationId])).rows[0]);
  assert.equal(row?.mission_id,missionId);assert.equal(row?.work_item_id,workItemId);assert.equal(row?.attempt_id,attemptId);
  assert.equal(row?.actor_identity,`service:${context.actor.id}`);
  checks.ownershipColumns=true;
  assert.deepEqual((row?.request as {authenticatedContext:unknown}).authenticatedContext,context);checks.sealedContext=true;
  assert.equal((await service.submit("verification_extraction",envelope,"http://localhost")).operationId,accepted.operationId);checks.exactRetry=true;
  for(const [name,changed] of Object.entries({attempt:{...context,attemptId:randomUUID()},actor:{...context,actor:{...context.actor,id:randomUUID()}},mission:{...context,missionId:randomUUID()},capability:{...context,capabilityVersion:"other/v1"}})) {
    await assert.rejects(service.submit("verification_extraction",{...envelope,context:changed},"http://localhost"),/IDEMPOTENCY_CONFLICT/);
    checks[`${name}DriftRejected`]=true;
  }
  const count=await database.transaction(tenantId,async client=>(await client.query("select count(*)::int n from knowledge_service.operation where tenant_id=$1",[tenantId])).rows[0]);
  assert.equal(count?.n,1);checks.noDuplicateOperation=true;
  const token=`local-proof-${randomUUID()}`;
  const api=buildServer({verificationOperationService:service,resolveVerificationContext:resolver,
    resolveIdentity:candidate=>candidate===token?{actor:context.actor,grants:[{tenantId,roles:["knowledge_operator"],scopes:[]}]}:undefined});
  try {
    const headers={authorization:`Bearer ${token}`,"x-tenant-id":tenantId,"x-correlation-id":context.correlationId,
      "idempotency-key":`${namespace}-http`,"x-verification-attempt-id":attemptId,"x-verification-work-item-id":workItemId,"x-verification-mission-id":missionId};
    const payload={verificationContractVersion:"verification.v1",captureIds:[randomUUID()],
      extractionSchema:{artifactId:randomUUID(),digest:`sha256:${"1".repeat(64)}`},
      extractionOutput:{artifactId:randomUUID(),digest:`sha256:${"2".repeat(64)}`}};
    const request={method:"POST" as const,url:"/v1/verification/extractions:verify",headers,payload};
    const response=await api.inject(request);assert.equal(response.statusCode,202,response.body);checks.authenticatedHttpQueued=true;
    const retry=await api.inject(request);assert.equal(retry.statusCode,202,retry.body);assert.equal(retry.json().operationId,response.json().operationId);checks.httpExactRetry=true;
    const denied=await api.inject({...request,headers:{...headers,"x-verification-attempt-id":randomUUID()}});assert.equal(denied.statusCode,403);checks.httpWrongAttemptDenied=true;
    const drift=await api.inject({...request,payload:{...payload,captureIds:[randomUUID()]}});assert.equal(drift.statusCode,409,drift.body);checks.httpPayloadDriftDenied=true;
  } finally {await api.close();}
  const sourceHashes:Record<string,string>={};
  for(const file of ["packages/persistence/src/operation-service.ts","apps/api/src/verification-ownership.ts","scripts/prove-verification-operation-ownership.ts"])
    sourceHashes[file]=createHash("sha256").update(await readFile(file)).digest("hex");
  const receipt=resolve("..","internal",`${namespace}.json`);
  await writeFile(receipt,JSON.stringify({capturedAt:new Date().toISOString(),scope:"Real local Postgres durable ownership and idempotency; no worker execution or Storage claim",tenantId,missionId,workItemId,attemptId,operationId:accepted.operationId,checks,sourceHashes,providerDispatches:0,passed:true},null,2),{flag:"wx"});
  console.log(JSON.stringify({receipt,checks,passed:true}));
} finally { await database.close(); }
