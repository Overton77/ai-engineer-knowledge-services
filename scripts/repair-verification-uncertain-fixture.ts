import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PostgresCanonicalRepository } from "../packages/persistence/src/postgres.js";

// Exact failed synthetic fixture only. Preserve its history and append canonical
// cancellation custody rather than leave accepted work queued after the test.
const tenantId="eddca540-cef1-4d4d-88e1-24cfc5b185e0";
const attemptId="f47c67fa-32d1-4dbf-9561-6e8bce095df2";
const connectionString=process.env.POSTGRES_URL!;
const url=new URL(connectionString);
assert.ok(["localhost","127.0.0.1"].includes(url.hostname)&&url.port==="54322");
const database=new PostgresCanonicalRepository({connectionString,localOnly:true});
try{
  const records=await database.transaction(tenantId,async client=>(await client.query<{id:string;status:string}>(
    "select id,status from knowledge_service.operation where tenant_id=$1 and attempt_id=$2 and operation_kind='verification_metric'",[tenantId,attemptId])).rows);
  assert.equal(records.length,1);
  const operation=records[0]!;
  assert.ok(["queued","cancelled"].includes(operation.status));
  await database.cancelOperation(tenantId,operation.id,{actorIdentity:"system:verification-fixture-coordinator",correlationId:randomUUID()});
  const after=await database.transaction(tenantId,async client=>(await client.query<{status:string}>("select status from knowledge_service.operation where tenant_id=$1 and id=$2",[tenantId,operation.id])).rows[0]);
  assert.equal(after?.status,"cancelled");
  const receipt=fileURLToPath(new URL(`../../internal/verification-uncertain-fixture-repair-${randomUUID()}.json`,import.meta.url));
  await writeFile(receipt,JSON.stringify({capturedAt:new Date().toISOString(),tenantId,attemptId,operationId:operation.id,before:operation.status,after:after.status,
    reason:"Manual canonical reconciliation after failed branch proof; not automatic cancellation evidence",providerDispatches:0,remoteWrites:0,passed:true},null,2),{flag:"wx"});
  process.stdout.write(JSON.stringify({receipt})+"\n");
}finally{await database.close();}
