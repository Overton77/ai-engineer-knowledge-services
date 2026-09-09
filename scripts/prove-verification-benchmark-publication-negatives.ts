import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PostgresCanonicalRepository } from "@aiengineer/knowledge-persistence";

type Fixture={manifest:{tenantId:string;runId:string;operationId:string;dataset:{datasetId:string;datasetVersionId:string;artifact:{artifactId:string;digest:string}};arms:readonly {armId:string;experimentArmId:string;evalRunId:string;configurationArtifact:{artifactId:string;digest:string};policyArtifact:{artifactId:string;digest:string}}[]}};
const root=resolve("../internal"); const publication=resolve(root,"verification-benchmark-publication-06ead5cc-14a8-4b0d-889a-9f1ce0a53ea7.json");
const url=process.env.POSTGRES_URL;if(!url||!/^postgres(?:ql)?:\/\/(?:[^@/]+@)?(?:127\.0\.0\.1|localhost):54322\//.test(url))throw new Error("PUBLICATION_NEGATIVE_LOCAL_POSTGRES_REQUIRED");
const fixture=JSON.parse(await readFile(publication,"utf8")) as Fixture;const m=fixture.manifest;const database=new PostgresCanonicalRepository({connectionString:url,localOnly:true});
const q=<T extends Record<string,unknown>=Record<string,unknown>>(text:string,values:readonly unknown[]=[])=>database.transaction(m.tenantId,client=>client.query<T>(text,values));
type Probe={readonly rejected:boolean;readonly code?:string;readonly message?:string;};
const probe=async(label:string,sql:string,values:readonly unknown[]=[],required=true):Promise<Probe>=>{const sentinel=`PUBLICATION_NEGATIVE_ACCEPTED:${label}`;try{await database.transaction(m.tenantId,async client=>{try{await client.query(sql,values);}catch(error){throw error;}throw new Error(sentinel);});throw new Error(sentinel);}catch(error){if(error instanceof Error&&error.message===sentinel){if(required)throw error;return {rejected:false,message:sentinel};}const code=typeof error==='object'&&error!==null&&'code' in error?String((error as {code?:unknown}).code):undefined;const message=error instanceof Error?error.message:String(error);if(code!=="23001"&&code!=="23503")throw new Error(`PUBLICATION_NEGATIVE_UNEXPECTED_FAILURE:${label}:${code??"none"}:${message}`);return {rejected:true,code,message};}};
try{
 const audit=await q<{arm_count:string;sealed:boolean;dataset_bound:boolean;times_bound:boolean;operation_bound:boolean}>(`select count(*)::text arm_count, bool_and(b.status='sealed') sealed,
 bool_and(v.manifest_artifact_id=b.dataset_artifact_id and v.manifest_sha256=b.dataset_sha256 and v.contract_version='verification.v1') dataset_bound,
 bool_and(e.started_at=b.started_at and e.ended_at=b.completed_at and e.executed_at=b.completed_at) times_bound,
 bool_and(e.attempt_id=o.attempt_id and e.mission_id is not distinct from o.mission_id and e.work_item_id is not distinct from o.work_item_id) operation_bound
 from evaluation.verification_benchmark_arm_publication p join evaluation.verification_benchmark_run b on b.tenant_id=p.tenant_id and b.id=p.benchmark_run_id
 join evaluation.eval_run e on e.tenant_id=p.tenant_id and e.id=p.eval_run_id join evaluation.eval_dataset_version v on v.tenant_id=e.tenant_id and v.id=e.dataset_version_id
 join knowledge_service.operation o on o.tenant_id=b.tenant_id and o.id=b.operation_id where p.tenant_id=$1 and p.benchmark_run_id=$2`,[m.tenantId,m.runId]);
 const a=audit.rows[0];if(!a||a.arm_count!=="4"||!a.sealed||!a.dataset_bound||!a.times_bound||!a.operation_bound)throw new Error("PUBLICATION_NEGATIVE_AUDIT_FAILED");
 const first=m.arms[0]!;const probes={
  mappedEvalImmutable:await probe("eval", "update evaluation.eval_run set status='succeeded' where tenant_id=$1 and id=$2",[m.tenantId,first.evalRunId]),
  mappedVersionImmutable:await probe("version", "update evaluation.eval_dataset_version set case_count=44 where tenant_id=$1 and id=$2",[m.tenantId,m.dataset.datasetVersionId]),
  mappedExperimentImmutable:await probe("experiment", "update evaluation.experiment set name='drift' where tenant_id=$1 and id=(select experiment_id from evaluation.experiment_arm where tenant_id=$1 and id=$2)",[m.tenantId,first.experimentArmId]),
  mappedArmImmutable:await probe("arm", "update evaluation.experiment_arm set name='drift' where tenant_id=$1 and id=$2",[m.tenantId,first.experimentArmId]),
  mappingImmutable:await probe("mapping", "delete from evaluation.verification_benchmark_arm_publication where tenant_id=$1 and benchmark_run_id=$2 and benchmark_arm_id=$3",[m.tenantId,m.runId,first.armId]),
  sealedRunImmutable:await probe("sealed", "update evaluation.verification_benchmark_run set status='completed' where tenant_id=$1 and id=$2",[m.tenantId,m.runId]),
  mappedDatasetImmutable:await probe("dataset", "update evaluation.eval_dataset set purpose='drift' where tenant_id=$1 and id=$2",[m.tenantId,m.dataset.datasetId],false),
 };const checks={exactFourBindings:true,...Object.fromEntries(Object.entries(probes).map(([key,value])=>[key,value.rejected]))};const gaps=Object.entries(probes).filter(([,value])=>!value.rejected).map(([key])=>key);
 const output={status:gaps.length?"gaps_found":"passed",checks,probes,gaps,runId:m.runId,operationId:m.operationId};const receipt=resolve(root,`verification-benchmark-publication-negatives-${m.runId}.json`);await writeFile(receipt,JSON.stringify(output,null,2));process.stdout.write(JSON.stringify({...output,receipt})+"\n");if(gaps.length)process.exitCode=2;
}finally{await database.close();}
