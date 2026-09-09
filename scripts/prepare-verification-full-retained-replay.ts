import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFile,readdir,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {DiagnosticsBenchmarkLiveCallCheckpointSchema,DiagnosticsBenchmarkLiveFailedCallCheckpointSchema,type VerificationArtifactHandle} from "@aiengineer/knowledge-contracts";
import {PostgresCanonicalRepository,PostgresVerificationRepository} from "@aiengineer/knowledge-persistence";
import {SupabaseArtifactStore} from "@aiengineer/knowledge-runtime";
import {canonicalizeJson,digestCanonicalJson,sha256Digest} from "@aiengineer/knowledge-verification";
import {diagnosticsBenchmarkArms} from "@aiengineer/knowledge-application";

const postgres=process.env.POSTGRES_URL!,projectUrl=process.env.SUPABASE_URL!,key=process.env.SUPABASE_SECRET_KEY!;
for(const [value,port] of [[postgres,"54322"],[projectUrl,"54321"]]){const url=new URL(value!);assert.ok(["localhost","127.0.0.1"].includes(url.hostname)&&url.port===port,"LOCAL_SERVICES_REQUIRED");}
assert.ok(key);
const internal=resolve("../internal"),directory=resolve(internal,"verification-benchmark-extraction-live-feeb824c-e4d0-597f-abd7-7667fa080869");
const fixture=JSON.parse(await readFile(resolve(internal,"verification-registered-replay-df378d7d-9e83-4abc-986c-8d66919e8cd3.json"),"utf8"));
const tenantId=fixture.tenantId as string,namespace=randomUUID(),bucket="ai-engineer-cloud-bucket",createdAt=new Date().toISOString();
const database=new PostgresCanonicalRepository({connectionString:postgres,localOnly:true});
const repository=new PostgresVerificationRepository(database,new SupabaseArtifactStore({projectUrl,serviceRoleKey:key,bucket,maximumBytes:8*1024*1024}),{async authorize(input){assert.equal(input.tenantId,tenantId);assert.equal(input.purpose,"verification_admission");}});
const compact=(handle:{artifactId:string;digest:string})=>({artifactId:handle.artifactId,digest:handle.digest});
const encoded=(value:unknown)=>new TextEncoder().encode(canonicalizeJson(value));
async function retain(bytes:Uint8Array,artifactType:string,parents:string[]):Promise<VerificationArtifactHandle>{
  const digest=sha256Digest(bytes),signature=digestCanonicalJson({kind:"retain_historical_replay_record.v1",parents,digest});
  const existing=await database.transaction(tenantId,async sql=>(await sql.query<{id:string;artifact_type:string}>("select id,artifact_type from orchestration.artifact where tenant_id=$1 and sha256=$2 and storage_state='available'",[tenantId,digest.slice(7)])).rows);
  assert.ok(existing.length<=1,"AMBIGUOUS_CAS_IDENTITY");
  if(existing[0]){
    assert.equal(existing[0].artifact_type,artifactType);
    const resolver=repository.createTrustedArtifactResolver();await resolver.authorizeArtifact({tenantId,artifactId:existing[0].id,purpose:"verification_admission"});
    const value=await resolver.hydrateRegisteredArtifact({tenantId,artifactId:existing[0].id});
    assert.equal(value.registration.digest,digest);assert.deepEqual(Buffer.from(value.bytes),Buffer.from(bytes));
    assert.deepEqual(value.registration.parentArtifactIds,parents);assert.equal(value.registration.transformationSignature,signature);
    return value.registration;
  }
  return repository.registerContentAddressedArtifact({tenantId,bytes,mediaType:"application/json",createdAt,producerActivityId:"registered-full-retained-replay-preparation",producerVersion:"1",encryptionClass:"supabase-managed",retentionClass:"verification-audit",dataClassification:"restricted",artifactType,bucketClass:"ledger",storageBucket:bucket,parentArtifactIds:parents,transformationSignature:signature});
}
try{
  const files=(await readdir(directory)).filter(name=>/-(luna_extractor|interfaze_extractor|haiku_judge)(-failure)?\.json$/u.test(name)).sort();assert.equal(files.length,117);
  const records=[],observations=[],unique=new Set<string>(),artifactCache=new Map<string,VerificationArtifactHandle>();
  let datasetDigest:string|undefined,experimentDigest:string|undefined,totalBytes=0;
  for(const file of files){
    const bytes=new Uint8Array(await readFile(resolve(directory,file))),raw=JSON.parse(new TextDecoder("utf8",{fatal:true}).decode(bytes));
    const checkpoint=raw.schemaVersion==="diagnostics-benchmark-live-call-checkpoint.v1"?DiagnosticsBenchmarkLiveCallCheckpointSchema.parse(raw):DiagnosticsBenchmarkLiveFailedCallCheckpointSchema.parse(raw);
    const {checkpointDigest,...material}=checkpoint;assert.equal(checkpointDigest,digestCanonicalJson(material));
    datasetDigest??=checkpoint.datasetManifestDigest;experimentDigest??=checkpoint.experimentManifestDigest;
    assert.equal(checkpoint.datasetManifestDigest,datasetDigest);assert.equal(checkpoint.experimentManifestDigest,experimentDigest);
    const caseRole=`${checkpoint.caseId}:${checkpoint.role}`;assert.ok(!unique.has(caseRole));unique.add(caseRole);
    for(const packed of checkpoint.artifacts){
      const handle=packed.handle;assert.equal(handle.tenantId,tenantId);
      const packedBytes=Buffer.from(packed.bytesBase64,"base64");assert.equal(packedBytes.length,handle.byteLength);assert.equal(sha256Digest(packedBytes),handle.digest);
      if(artifactCache.has(handle.artifactId)){assert.deepEqual(artifactCache.get(handle.artifactId),handle);continue;}
      const resolver=repository.createTrustedArtifactResolver();await resolver.authorizeArtifact({tenantId,artifactId:handle.artifactId,purpose:"verification_admission"});
      const hydrated=await resolver.hydrateRegisteredArtifact({tenantId,artifactId:handle.artifactId});assert.deepEqual(hydrated.registration,handle);assert.deepEqual(Buffer.from(hydrated.bytes),packedBytes);
      artifactCache.set(handle.artifactId,handle);totalBytes+=packedBytes.length;assert.ok(totalBytes<32*1024*1024);
    }
    const retained=await retain(bytes,"verification_benchmark_recorded_call",checkpoint.artifacts.map(item=>item.handle.artifactId));
    const succeeded=checkpoint.schemaVersion==="diagnostics-benchmark-live-call-checkpoint.v1";
    if(succeeded)observations.push(compact(checkpoint.artifacts.find(item=>item.role==="observation")!.handle));
    records.push({file,...compact(retained),runIdentityDigest:checkpoint.runIdentityDigest,checkpointDigest,caseId:checkpoint.caseId,role:checkpoint.role,outcome:succeeded?"observed":"failed"});
  }
  assert.equal(observations.length,110);assert.equal(records.filter(item=>item.outcome==="failed").length,7);assert.equal(new Set(records.map(item=>item.caseId)).size,39);
  const experiment=await retain(encoded({schemaVersion:"verification-benchmark-experiment.v1",verificationContractVersion:"verification.v1",experimentId:"historical-full-retained-replay.v1",datasetManifestDigest:datasetDigest,runnerVersion:"verification-benchmark-runner.v1",randomSeed:17,repetitions:1,arms:diagnosticsBenchmarkArms(),networkPolicy:"offline",recordedObservationArtifacts:observations}),"verification_benchmark_experiment",[fixture.dataset.artifactId]);
  const output=resolve(internal,`verification-full-retained-replay-preparation-${namespace}.json`);
  await writeFile(output,JSON.stringify({status:"prepared",scope:"Actual local artifact registration and exact historical Storage byte custody; failed-call application admission and canonical execution remain pending",tenantId,dataset:fixture.dataset,experiment:compact(experiment),records,checkpointRefs:records.map(({artifactId,digest,runIdentityDigest})=>({artifactId,digest,runIdentityDigest})),sourceImportEvidence:fixture.sourceImportEvidence,counts:{calls:117,observed:110,failed:7,cases:39,uniqueHydratedArtifacts:artifactCache.size,hydratedBytes:totalBytes},externalProviderRequests:0},null,2),{flag:"wx"});
  console.log(JSON.stringify({status:"prepared",output,calls:117,observed:110,failed:7,uniqueHydratedArtifacts:artifactCache.size}));
}finally{await database.close();}
