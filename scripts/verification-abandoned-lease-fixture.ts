import { PostgresCanonicalRepository } from "@aiengineer/knowledge-persistence";
const connectionString=process.env.POSTGRES_URL,tenantId=process.env.PROOF_TENANT_ID,operationId=process.env.PROOF_OPERATION_ID;
if(!connectionString||!tenantId||!operationId||!process.send)throw new Error("LOCAL_IPC_FIXTURE_REQUIRED");
const database=new PostgresCanonicalRepository({connectionString,localOnly:true});
const claim=await database.claimOperation(tenantId,operationId,`abandoned-worker-${process.pid}`,1000);
if(!claim)throw new Error("FIXTURE_CLAIM_REQUIRED");
process.send({claim,pid:process.pid});
// Parent kills this process after observing the live lease. No graceful release.
setInterval(()=>{},1000);
