import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { InMemoryArtifactStore } from "@aiengineer/knowledge-runtime";
import type { VerificationArtifactHandle } from "@aiengineer/knowledge-contracts";
import { canonicalizeJson, sha256Digest } from "@aiengineer/knowledge-verification";
import { createVerificationArtifactHandle, PostgresVerificationRepository } from "./verification.js";
import { PostgresVerificationComponentDriftPublisher, PostgresVerificationDriftRevalidationOutbox } from "./verification-drift-revalidation-outbox.js";

const tenantId="11111111-1111-4111-8111-111111111111",baselineRunId="22222222-2222-4222-8222-222222222222",candidateRunId="33333333-3333-4333-8333-333333333333",sourceOperationId="44444444-4444-4444-8444-444444444444";
const createdAt="2026-09-08T21:00:00.000Z",encoder=new TextEncoder();
type Row=Record<string,unknown>;

const plan={tenantId,observationArtifactId:"77777777-7777-4777-8777-777777777777",observationDigest:`sha256:${"a".repeat(64)}` as const,sourceOperationId,dimensions:["model"] as const,disposition:"review_required" as const,reviewReason:"BUDGET_NOT_ADMITTED",idempotencyKey:"vr031:test"};

function observation(overrides:Record<string,unknown>={}) {
  const unsigned={schemaVersion:"verification-component-drift-observation.v1" as const,tenantId,
    baseline:{runId:baselineRunId,auditBundleArtifact:{artifactId:"55555555-5555-4555-8555-555555555555",digest:"" as `sha256:${string}`}},
    candidate:{runId:candidateRunId,auditBundleArtifact:{artifactId:"66666666-6666-4666-8666-666666666666",digest:"" as `sha256:${string}`}},
    baselineComponents:{provider:"provider.v1",model:"model.v1",parser:"parser.v1",grader:"grader.v1",policy:"policy.v1"},
    candidateComponents:{provider:"provider.v2",model:"model.v2",parser:"parser.v2",grader:"grader.v2",policy:"policy.v2"},
    changedDimensions:["provider","model","parser","grader","policy"] as const,...overrides};
  return {...unsigned,payloadDigest:sha256Digest(canonicalizeJson(unsigned))};
}
const reseal=<T extends {payloadDigest:`sha256:${string}`}>(value:T):T=>{const {payloadDigest:_,...unsigned}=value;return {...value,payloadDigest:sha256Digest(canonicalizeJson(unsigned))};};

async function publisherFixture() {
  const artifacts=new Map<string,Row>(),metadata=new Map<string,Row>(),plans=new Map<string,Row>();
  const store=new InMemoryArtifactStore(),runBindings=new Map<string,{artifactId:string;sourceOperationId:string}>();
  let publishedSourceOperation:string|undefined;
  const query=async(sql:string,values:readonly unknown[]=[])=>{
    if(sql.includes("insert into orchestration.artifact\n")){const [id,tenant_id,artifact_type,sha256,bucket_class,storage_bucket,object_path,media_type,size_bytes,producer_attempt_id,mission_id,rowCreatedAt]=values;if(!artifacts.has(String(id)))artifacts.set(String(id),{id,tenant_id,artifact_type,schema_version:1,sha256,bucket_class,storage_bucket,object_path,media_type,size_bytes,producer_attempt_id,mission_id,created_at:rowCreatedAt,storage_state:"pending",available_at:null,verification_contract_version:"verification.v1"});return {rows:[],rowCount:1};}
    if(sql.includes("select verification_contract_version from orchestration.artifact")){const row=artifacts.get(String(values[1]));return {rows:row?[{verification_contract_version:row.verification_contract_version}]:[],rowCount:row?1:0};}
    if(sql.includes("insert into orchestration.verification_artifact_metadata")){const [storedTenantId,artifact_id,producer_activity_id,producer_version,content_encoding,encryption_class,retention_class,data_classification,parent_artifact_ids,transformation_signature,attestation_artifact_id,rowCreatedAt]=values;if(!metadata.has(String(artifact_id)))metadata.set(String(artifact_id),{tenant_id:storedTenantId,artifact_id,producer_activity_id,producer_version,content_encoding,encryption_class,retention_class,data_classification,parent_artifact_ids,transformation_signature,attestation_artifact_id,created_at:rowCreatedAt});return {rows:[],rowCount:1};}
    if(sql.includes("select a.id from orchestration.artifact")){const row=artifacts.get(String(values[1]));return {rows:row?.storage_state==="available"?[{id:row.id}]:[],rowCount:row?.storage_state==="available"?1:0};}
    if(sql.includes("from orchestration.artifact a join orchestration.verification_artifact_metadata")){const artifact=artifacts.get(String(values[1])),meta=metadata.get(String(values[1]));return {rows:artifact&&meta?[{...artifact,...meta}]:[],rowCount:artifact&&meta?1:0};}
    if(sql.includes("select storage_state from orchestration.artifact")&&sql.includes("for update")){const row=artifacts.get(String(values[1]));return {rows:row?[{storage_state:row.storage_state}]:[],rowCount:row?1:0};}
    if(sql.includes("set storage_state='available'")){const row=artifacts.get(String(values[1]));if(row)row.storage_state="available";return {rows:[],rowCount:row?1:0};}
    if(sql.includes("set storage_state='failed'")){const row=artifacts.get(String(values[1]));if(row&&row.storage_state==="pending")row.storage_state="failed";return {rows:[],rowCount:row?1:0};}
    if(sql.includes("insert into orchestration.artifact_lineage"))return {rows:[],rowCount:1};
    if(sql.includes("publish_verification_component_drift_observation")){
      const [observationId,observationSha,payloadSha,bRun,bArtifact,bSha,cRun,cArtifact,cSha,dimensions,idempotencyKey]=values;
      const baseline=runBindings.get(String(bRun)),candidate=runBindings.get(String(cRun)),artifact=artifacts.get(String(observationId)),meta=metadata.get(String(observationId));
      if(!baseline||!candidate||baseline.artifactId!==bArtifact||candidate.artifactId!==cArtifact||artifacts.get(String(bArtifact))?.sha256!==bSha||artifacts.get(String(cArtifact))?.sha256!==cSha)throw new Error("component drift signed run lineage invalid");
      if(!artifact||artifact.artifact_type!=="verification_component_drift_observation"||artifact.sha256!==observationSha||artifact.storage_state!=="available"||canonicalizeJson(meta?.parent_artifact_ids)!==canonicalizeJson([bArtifact,cArtifact]))throw new Error("component drift observation artifact lineage invalid");
      publishedSourceOperation=candidate.sourceOperationId;const prior=plans.get(String(observationId)),next={observationSha,payloadSha,bRun,bArtifact,bSha,cRun,cArtifact,cSha,dimensions,idempotencyKey,sourceOperationId:publishedSourceOperation};
      if(prior&&canonicalizeJson(prior)!==canonicalizeJson(next))throw new Error("component drift custody idempotency conflict");
      if(prior)return {rows:[{inserted:false}],rowCount:1};plans.set(String(observationId),next);return {rows:[{inserted:true}],rowCount:1};
    }
    throw new Error(`UNEXPECTED_SQL:${sql.slice(0,100)}`);
  };
  const database={transaction:async(_tenant:string,work:(client:{query:typeof query})=>Promise<unknown>)=>work({query})};
  const repository=new PostgresVerificationRepository(database as never,store,{async authorize(input){if(input.tenantId!==tenantId||input.purpose!=="verification_replay")throw new Error("DENIED");}});
  const registerManifest=async(label:string):Promise<VerificationArtifactHandle>=>{const bytes=encoder.encode(label),handle=createVerificationArtifactHandle({tenantId,bytes,mediaType:"application/json",createdAt,producerActivityId:"verification-run-sealer",producerVersion:"v1",encryptionClass:"supabase-managed",retentionClass:"verification-audit",dataClassification:"restricted"});await repository.registerArtifact({handle,bytes,artifactType:"verification_run_manifest",bucketClass:"ledger",storageBucket:"proof"});return handle;};
  const baseline=await registerManifest("baseline-signed-audit"),candidate=await registerManifest("candidate-signed-audit");
  runBindings.set(baselineRunId,{artifactId:baseline.artifactId,sourceOperationId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"});runBindings.set(candidateRunId,{artifactId:candidate.artifactId,sourceOperationId});
  const publisher=new PostgresVerificationComponentDriftPublisher(database as never,repository,{storageBucket:"proof",now:()=>createdAt});
  return {publisher,artifacts,metadata,plans,baseline,candidate,getPublishedSourceOperation:()=>publishedSourceOperation};
}

describe("PostgresVerificationDriftRevalidationOutbox",()=>{
  it("uses the existing atomic semantic-observation plan function",async()=>{const query=vi.fn().mockResolvedValue({rows:[{inserted:true}]}),transaction=vi.fn(async(_:string,fn:(x:unknown)=>unknown)=>fn({query}));const outbox=new PostgresVerificationDriftRevalidationOutbox({transaction} as never);await expect(outbox.persistPlan(plan)).resolves.toBe("planned");expect(query.mock.calls[0]![0]).toContain("plan_verification_drift_revalidation");expect(query.mock.calls[0]![1][1]).toBe("a".repeat(64));});
});

describe("PostgresVerificationComponentDriftPublisher",()=>{
  const bound=async()=>{const value=await publisherFixture(),input=observation({baseline:{runId:baselineRunId,auditBundleArtifact:{artifactId:value.baseline.artifactId,digest:value.baseline.digest}},candidate:{runId:candidateRunId,auditBundleArtifact:{artifactId:value.candidate.artifactId,digest:value.candidate.digest}}});return {value,input:reseal(input)};};
  it("registers immutable five-component custody and lets SQL derive the candidate operation",async()=>{const {value,input}=await bound();await expect(value.publisher.publishComponentObservation(input)).resolves.toBe("planned");expect(value.getPublishedSourceOperation()).toBe(sourceOperationId);expect([...value.plans.values()][0]).toMatchObject({dimensions:["provider","model","parser","grader","policy"],sourceOperationId});const registered=[...value.artifacts.values()].find(row=>row.artifact_type==="verification_component_drift_observation")!;expect(registered).toMatchObject({bucket_class:"ledger",storage_state:"available"});expect(value.metadata.get(String(registered.id))).toMatchObject({data_classification:"restricted",parent_artifact_ids:[value.baseline.artifactId,value.candidate.artifactId]});});
  it("returns already_planned for exact replay without duplicating custody",async()=>{const {value,input}=await bound();await expect(value.publisher.publishComponentObservation(input)).resolves.toBe("planned");await expect(value.publisher.publishComponentObservation(input)).resolves.toBe("already_planned");expect(value.plans.size).toBe(1);});
  it("rejects payload, artifact digest, and candidate-run binding drift",async()=>{const {value,input}=await bound();await expect(value.publisher.publishComponentObservation({...input,payloadDigest:`sha256:${"f".repeat(64)}`})).rejects.toThrow("COMPONENT_DRIFT_OBSERVATION_BINDING_INVALID");const forged=reseal({...structuredClone(input),candidate:{...input.candidate,auditBundleArtifact:{...input.candidate.auditBundleArtifact,digest:`sha256:${"e".repeat(64)}` as const}}});await expect(value.publisher.publishComponentObservation(forged)).rejects.toThrow("COMPONENT_DRIFT_RUN_ARTIFACT_BINDING_INVALID");const wrongRun=reseal({...structuredClone(input),candidate:{...input.candidate,runId:"99999999-9999-4999-8999-999999999999"}});await expect(value.publisher.publishComponentObservation(wrongRun)).rejects.toThrow("component drift signed run lineage invalid");expect(value.plans.size).toBe(0);});
  it("rejects self-hashed component claims that are inconsistent or contain unknown fields",async()=>{const {value,input}=await bound();const inconsistent=reseal({...structuredClone(input),candidateComponents:{...input.candidateComponents,provider:input.baselineComponents.provider}});await expect(value.publisher.publishComponentObservation(inconsistent)).rejects.toThrow("COMPONENT_DRIFT_OBSERVATION_DIMENSIONS_INVALID");const extraTop=reseal({...structuredClone(input),invented:"value"} as typeof input&{invented:string});await expect(value.publisher.publishComponentObservation(extraTop)).rejects.toThrow("COMPONENT_DRIFT_OBSERVATION_BINDING_INVALID");const extraComponent=reseal({...structuredClone(input),candidateComponents:{...input.candidateComponents,invented:"value"}} as typeof input);await expect(value.publisher.publishComponentObservation(extraComponent)).rejects.toThrow("COMPONENT_DRIFT_OBSERVATION_BINDING_INVALID");expect(value.plans.size).toBe(0);});
  it("keeps the unapplied migration canonical, immutable, and candidate-operation derived",()=>{const sql=readFileSync(new URL("../../../../ai-engineer-db-contract/supabase/migrations/20260908030000_verification_drift_revalidation_outbox.sql",import.meta.url),"utf8");expect(sql).toContain("create table orchestration.verification_component_drift_observation");expect(sql).toContain("verification_component_drift_observation_immutable");expect(sql).toContain("select candidate.operation_id into v_source_operation");expect(sql).toContain("artifact.artifact_type='verification_component_drift_observation'");expect(sql).toContain("metadata.parent_artifact_ids=array[p_baseline_audit,p_candidate_audit]::uuid[]");const fn=sql.indexOf("create function orchestration.publish_verification_component_drift_observation");expect(sql.indexOf("insert into orchestration.verification_component_drift_observation",fn)).toBeLessThan(sql.indexOf("insert into orchestration.verification_drift_revalidation_outbox",fn));});
});
