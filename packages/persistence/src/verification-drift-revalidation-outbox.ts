import { VerificationArtifactHandleSchema, type VerificationArtifactHandle } from "@aiengineer/knowledge-contracts";
import type { VerificationComponentDriftObservation } from "@aiengineer/knowledge-application";
import { canonicalizeJson, digestCanonicalJson, sha256Digest } from "@aiengineer/knowledge-verification";
import { z } from "zod";
import type { PostgresCanonicalRepository } from "./postgres.js";
import type { PostgresVerificationRepository } from "./verification.js";
type DriftDimension="provider"|"model"|"parser"|"grader"|"policy";
interface DurableDriftPlan { readonly tenantId:string; readonly observationArtifactId:string; readonly observationDigest:`sha256:${string}`; readonly sourceOperationId:string; readonly idempotencyKey:string; readonly dimensions:readonly DriftDimension[]; readonly disposition:"revalidate"|"review_required"; readonly reviewReason?:string; }
const componentDimensions=["provider","model","parser","grader","policy"] as const;
const encoder=new TextEncoder();
const digestSchema=z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const runArtifactSchema=z.strictObject({artifactId:z.uuid(),digest:digestSchema});
const runBindingSchema=z.strictObject({runId:z.uuid(),auditBundleArtifact:runArtifactSchema});
const componentsSchema=z.strictObject({provider:z.string().trim().min(1).max(4096),model:z.string().trim().min(1).max(4096),parser:z.string().trim().min(1).max(4096),grader:z.string().trim().min(1).max(4096),policy:z.string().trim().min(1).max(4096)});
const componentObservationSchema=z.strictObject({schemaVersion:z.literal("verification-component-drift-observation.v1"),tenantId:z.uuid(),baseline:runBindingSchema,candidate:runBindingSchema,
  baselineComponents:componentsSchema,candidateComponents:componentsSchema,changedDimensions:z.array(z.enum(componentDimensions)).min(1).max(5),payloadDigest:digestSchema});

export interface VerificationComponentDriftPublisherOptions {
  readonly storageBucket:string;
  readonly producerVersion?:string;
  readonly encryptionClass?:string;
  readonly retentionClass?:string;
  readonly now?:()=>string;
}

function validateComponentObservation(value:VerificationComponentDriftObservation):VerificationComponentDriftObservation {
  let observation:z.infer<typeof componentObservationSchema>;
  try{observation=componentObservationSchema.parse(structuredClone(value));}catch{throw new Error("COMPONENT_DRIFT_OBSERVATION_BINDING_INVALID");}
  const unsigned={...observation} as Record<string,unknown>;delete unsigned.payloadDigest;
  if(observation.baseline.runId===observation.candidate.runId||observation.baseline.auditBundleArtifact.artifactId===observation.candidate.auditBundleArtifact.artifactId
    ||sha256Digest(canonicalizeJson(unsigned))!==observation.payloadDigest) throw new Error("COMPONENT_DRIFT_OBSERVATION_BINDING_INVALID");
  const actual=componentDimensions.filter(dimension=>observation.baselineComponents[dimension]!==observation.candidateComponents[dimension]);
  if(canonicalizeJson(actual)!==canonicalizeJson(observation.changedDimensions)) throw new Error("COMPONENT_DRIFT_OBSERVATION_DIMENSIONS_INVALID");
  return observation as VerificationComponentDriftObservation;
}

async function hydrateRunManifest(repository:PostgresVerificationRepository,tenantId:string,expected:{readonly artifactId:string;readonly digest:`sha256:${string}`}):Promise<VerificationArtifactHandle>{
  const resolver=repository.createTrustedArtifactResolver();
  await resolver.authorizeArtifact({tenantId,artifactId:expected.artifactId,purpose:"verification_replay"});
  const loaded=await resolver.hydrateRegisteredArtifact({tenantId,artifactId:expected.artifactId}),artifact=VerificationArtifactHandleSchema.parse(loaded.registration);
  if(artifact.tenantId!==tenantId||artifact.artifactId!==expected.artifactId||artifact.digest!==expected.digest||artifact.byteLength!==loaded.bytes.byteLength||sha256Digest(loaded.bytes)!==artifact.digest) throw new Error("COMPONENT_DRIFT_RUN_ARTIFACT_BINDING_INVALID");
  return artifact;
}

/** Registers immutable five-component drift custody and atomically enqueues operator review. */
export class PostgresVerificationComponentDriftPublisher {
  private readonly options:Required<Omit<VerificationComponentDriftPublisherOptions,"now">>&Pick<VerificationComponentDriftPublisherOptions,"now">;
  constructor(private readonly database:PostgresCanonicalRepository,private readonly artifacts:PostgresVerificationRepository,options:VerificationComponentDriftPublisherOptions){
    if(!options.storageBucket.trim())throw new Error("COMPONENT_DRIFT_STORAGE_BUCKET_REQUIRED");
    this.options={storageBucket:options.storageBucket,producerVersion:options.producerVersion??"verification-component-drift.v1",encryptionClass:options.encryptionClass??"supabase-managed",retentionClass:options.retentionClass??"verification-audit",...(options.now?{now:options.now}:{})};
  }
  async publishComponentObservation(value:VerificationComponentDriftObservation):Promise<"planned"|"already_planned"> {
    const observation=validateComponentObservation(value),tenantId=observation.tenantId;
    const [baseline,candidate]=await Promise.all([
      hydrateRunManifest(this.artifacts,tenantId,observation.baseline.auditBundleArtifact),
      hydrateRunManifest(this.artifacts,tenantId,observation.candidate.auditBundleArtifact),
    ]);
    const bytes=encoder.encode(canonicalizeJson(observation));
    const transformationSignature=digestCanonicalJson({schemaVersion:"verification-component-drift-lineage.v1",baseline:observation.baseline,candidate:observation.candidate,payloadDigest:observation.payloadDigest});
    const artifact=await this.artifacts.registerContentAddressedArtifact({tenantId,bytes,mediaType:"application/json",artifactType:"verification_component_drift_observation",bucketClass:"ledger",storageBucket:this.options.storageBucket,
      createdAt:(this.options.now??(()=>new Date().toISOString()))(),parentArtifactIds:[baseline.artifactId,candidate.artifactId],transformationSignature,
      producerActivityId:"verification-component-drift-publisher",producerVersion:this.options.producerVersion,encryptionClass:this.options.encryptionClass,
      retentionClass:this.options.retentionClass,dataClassification:"restricted"});
    const idempotencyKey=`vr031-component:${sha256Digest(canonicalizeJson({tenantId,artifactId:artifact.artifactId,digest:artifact.digest,payloadDigest:observation.payloadDigest})).slice(7)}`;
    return this.database.transaction(tenantId,async client=>{
      const row=(await client.query<{inserted:boolean}>("select orchestration.publish_verification_component_drift_observation($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::text[],$11) inserted",[
        artifact.artifactId,artifact.digest.slice(7),observation.payloadDigest.slice(7),observation.baseline.runId,baseline.artifactId,baseline.digest.slice(7),
        observation.candidate.runId,candidate.artifactId,candidate.digest.slice(7),observation.changedDimensions,idempotencyKey,
      ])).rows[0];
      if(!row||typeof row.inserted!=="boolean")throw new Error("COMPONENT_DRIFT_PUBLISH_RESULT_INVALID");
      return row.inserted?"planned":"already_planned";
    });
  }
}

/** Adapter for the VR031 atomic plan/outbox database function. It never dispatches a provider. */
export class PostgresVerificationDriftRevalidationOutbox {
  constructor(private readonly database: PostgresCanonicalRepository) {}
  async persistPlan(input: DurableDriftPlan): Promise<"planned"|"already_planned"> {
    return this.database.transaction(input.tenantId, async client => {
      const row=(await client.query<{ inserted:boolean }>("select orchestration.plan_verification_drift_revalidation($1,$2,$3,$4,$5::text[],$6,$7) inserted",[
        input.observationArtifactId,input.observationDigest.slice(7),input.sourceOperationId,input.idempotencyKey,input.dimensions,input.disposition,input.reviewReason??null,
      ])).rows[0];
      if (!row || typeof row.inserted !== "boolean") throw new Error("DRIFT_REVALIDATION_PLAN_RESULT_INVALID");
      return row.inserted ? "planned" : "already_planned";
    });
  }
  async scanModelObservations(tenantId:string,limit:number):Promise<{planned:number;alreadyPlanned:number}>{
    return this.database.transaction(tenantId,async client=>{const rows=(await client.query<{observation_artifact_id:string;observation_sha256:string;operation_id:string}>(`select o.observation_artifact_id,o.observation_sha256,o.operation_id from orchestration.verification_semantic_response_observation o left join orchestration.verification_drift_revalidation_outbox q on q.tenant_id=o.tenant_id and q.observation_artifact_id=o.observation_artifact_id where o.tenant_id=$1 and o.revalidation_required and q.id is null order by o.recorded_at,o.observation_artifact_id limit $2`,[tenantId,limit])).rows;let planned=0;for(const row of rows){const key=`vr031:${row.observation_artifact_id}:${row.observation_sha256}:model:review_required`;const inserted=(await client.query<{inserted:boolean}>("select orchestration.plan_verification_drift_revalidation($1,$2,$3,$4,$5::text[],'review_required','MODEL_DRIFT_REVIEW_REQUIRED') inserted",[row.observation_artifact_id,row.observation_sha256,row.operation_id,key,["model"]])).rows[0]?.inserted;if(inserted)planned++;}return {planned,alreadyPlanned:rows.length-planned};});
  }
  async claim(tenantId:string,owner:string,limit:number,visibilityTimeoutMs:number){
    return this.database.transaction(tenantId,async client=>{
      const rows=(await client.query<Record<string,unknown>>("select * from orchestration.claim_verification_drift_revalidation($1,$2,$3)",[owner,limit,visibilityTimeoutMs])).rows;
      return rows.map(row=>({id:String(row.id),observationArtifactId:String(row.observation_artifact_id),sourceOperationId:String(row.source_operation_id),dimensions:(row.dimensions as unknown[]).map(String),disposition:String(row.disposition) as "revalidate"|"review_required",...(row.review_reason?{reviewReason:String(row.review_reason)}:{}),claimToken:String(row.claim_token)}));
    });
  }
  async ack(tenantId:string,id:string,owner:string,claimToken:string):Promise<void>{await this.database.transaction(tenantId,async client=>{await client.query("select orchestration.ack_verification_drift_revalidation($1,$2,$3)",[id,owner,claimToken]);});}
  async listPublishedReviewAlerts(tenantId:string,limit:number){
    return this.database.transaction(tenantId,async client=>{
      const rows=(await client.query<Record<string,unknown>>("select id,observation_artifact_id,source_operation_id,dimensions,review_reason,published_at from orchestration.verification_drift_revalidation_outbox where tenant_id=$1 and disposition='review_required' and state='published' order by published_at desc,id desc limit $2",[tenantId,limit])).rows;
      return rows.map(row=>({id:String(row.id),observationArtifactId:String(row.observation_artifact_id),sourceOperationId:String(row.source_operation_id),dimensions:(row.dimensions as unknown[]).map(String),reviewReason:String(row.review_reason),publishedAt:row.published_at instanceof Date?row.published_at.toISOString():String(row.published_at)}));
    });
  }
}
