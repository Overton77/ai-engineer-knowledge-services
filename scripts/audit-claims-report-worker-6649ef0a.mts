import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { PostgresCanonicalRepository } from "@aiengineer/knowledge-persistence";
import { SupabaseArtifactStore } from "@aiengineer/knowledge-runtime";
import { createEd25519Verifier, inspectAuditBundle, sha256Digest } from "@aiengineer/knowledge-verification";
const receiptPath=resolve("../internal/verification-claims-report-worker-6649ef0a-3f32-4360-9ee3-7e9fdd11f8e1.json");
const receipt=JSON.parse(await readFile(receiptPath,"utf8"));
const {loadVerifiedLocalDevelopmentConfig}=await import("../../internal/verification-local-direct-config.mjs");
const local=await loadVerifiedLocalDevelopmentConfig();
for(const [value,port] of [[local.DB_URL,"54322"],[local.API_URL,"54321"]]){const url=new URL(value);if(!["localhost","127.0.0.1"].includes(url.hostname)||url.port!==port)throw new Error("LOCAL_ONLY_AUDIT_REQUIRED");}
const tenantId=receipt.tenantId as string;
const db=new PostgresCanonicalRepository({connectionString:local.DB_URL,localOnly:true});
const storage=new SupabaseArtifactStore({projectUrl:local.API_URL,serviceRoleKey:local.SECRET_KEY,bucket:"ai-engineer-cloud-bucket",maximumBytes:32_000_000});
const resultEntries=Object.entries(receipt.results) as [string,any][];
const resultHandles=resultEntries.flatMap(([_,value])=>[value.resultArtifact,value.manifestArtifact].filter(Boolean));
const projectionHandles=[receipt.projection.projectionArtifact,receipt.projection.transformationArtifact];
const handleAudit=[] as unknown[];
for(const handle of [...resultHandles,...projectionHandles]){const bytes=await storage.get(tenantId,handle.digest);handleAudit.push({artifactId:handle.artifactId,digest:handle.digest,storagePresent:bytes!==undefined,byteLength:bytes?.byteLength??null,digestMatches:bytes?sha256Digest(bytes)===handle.digest:false});}
const manifests=[] as unknown[];
for(const value of resultEntries.map(([,value])=>value).filter((value)=>value.manifestArtifact)){const bytes=await storage.get(tenantId,value.manifestArtifact.digest);if(!bytes)throw new Error("MANIFEST_OBJECT_MISSING");const audit=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));const inspected=await inspectAuditBundle(audit,createEd25519Verifier({[audit.seal.keyId]:receipt.publicKeyPem}));manifests.push({runId:value.runId,manifestArtifactId:value.manifestArtifact.artifactId,signatureStatus:inspected.signatureStatus,valid:inspected.valid,manifestDigest:inspected.manifestDigest,gateDigest:audit.manifest.gateDigest??null,policyOutcome:audit.manifest.policyOutcome});}
const operationIds=resultEntries.map(([,value])=>value.operationId).filter(Boolean) as string[];
const allArtifactIds=[...new Set([...resultHandles,...projectionHandles].map((handle:any)=>handle.artifactId))];
const sql=await db.transaction(tenantId,async client=>{
 const operations=(await client.query("select id,operation_kind,status,attempt_id from knowledge_service.operation where tenant_id=$1 and id=any($2::uuid[]) order by id",[tenantId,operationIds])).rows;
 const receipts=(await client.query("select operation_id,receipt_kind,outcome,count(*)::int count from knowledge_service.receipt where tenant_id=$1 and operation_id=any($2::uuid[]) group by operation_id,receipt_kind,outcome order by operation_id",[tenantId,operationIds])).rows;
 const steps=(await client.query("select operation_id,step_key,status,count(*)::int count from knowledge_service.operation_step where tenant_id=$1 and operation_id=any($2::uuid[]) group by operation_id,step_key,status order by operation_id",[tenantId,operationIds])).rows;
 const artifacts=(await client.query("select id,sha256,storage_state from orchestration.artifact where tenant_id=$1 and id=any($2::uuid[]) order by id",[tenantId,allArtifactIds])).rows;
 const runs=(await client.query("select id,operation_id,producer_attempt_id,verifier_attempt_id,status,run_manifest_artifact_id,deterministic_result_artifact_id from evidence.verification_run where tenant_id=$1 and operation_id=any($2::uuid[]) order by operation_id",[tenantId,operationIds])).rows;
 const cancellationId=receipt.results.cancellation.operationId;
 const cancellationArtifacts=(await client.query("select count(*)::int count from orchestration.artifact where tenant_id=$1 and producer_attempt_id=(select attempt_id from knowledge_service.operation where tenant_id=$1 and id=$2)",[tenantId,cancellationId])).rows[0];
 const cancellationReceipts=(await client.query("select count(*)::int count from knowledge_service.receipt where tenant_id=$1 and operation_id=$2",[tenantId,cancellationId])).rows[0];
 const prior=JSON.parse(await readFile(resolve("../internal/verification-claims-report-worker-failure-6adcfb10-d67e-4439-8100-8fb62f3e22b1.json"),"utf8"));
 const priorOps=(await client.query("select id,status from knowledge_service.operation where tenant_id=$1 and id=any($2::uuid[]) order by id",[tenantId,prior.createdOperationIds])).rows;
 return {operations,receipts,steps,artifacts,runs,cancellationArtifacts:Number(cancellationArtifacts.count),cancellationReceipts:Number(cancellationReceipts.count),priorFailureOperations:priorOps};
});
const output={schemaVersion:"verification-claims-report-worker-independent-audit.v1",receiptSha256:createHash("sha256").update(await readFile(receiptPath)).digest("hex"),namespace:receipt.namespace,tenantId,storage:handleAudit,signatures:manifests,sql,limitations:["Read-only local PostgreSQL/Storage audit","Report canonical replay remains separately unproven while report-aware replay repair is pending","Interruption scenario is injected after result registration, not an OS process kill"]};
const outputPath=resolve("../internal/verification-claims-report-worker-independent-audit-6649ef0a-3f32-4360-9ee3-7e9fdd11f8e1.json");
await writeFile(outputPath,JSON.stringify(output,null,2)+"\n");
console.log(JSON.stringify({outputPath,sha256:createHash("sha256").update(await readFile(outputPath)).digest("hex"),operationRows:sql.operations.length,runRows:sql.runs.length,artifactRows:sql.artifacts.length,signatures:manifests.length}));
await db.close();


