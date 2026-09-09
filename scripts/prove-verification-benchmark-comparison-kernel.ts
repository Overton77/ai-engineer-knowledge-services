import assert from "node:assert/strict";
import {readFile,writeFile} from "node:fs/promises";
import {createHash,randomUUID} from "node:crypto";
import {resolve} from "node:path";
import {PostgresCanonicalRepository,PostgresVerificationRepository,PostgresVerificationBenchmarkReadRepository} from "@aiengineer/knowledge-persistence";
import {SupabaseArtifactStore} from "@aiengineer/knowledge-runtime";
import {createEd25519Verifier} from "@aiengineer/knowledge-verification";
import {VerificationBenchmarkDatasetSchema,type VerificationArtifactHandle} from "@aiengineer/knowledge-contracts";
import {compareVerificationBenchmarkRuns} from "../packages/evaluation/src/verification-benchmark-run-comparison.js";
import type {VerificationBenchmarkRun} from "../packages/evaluation/src/verification-benchmark.js";

const postgres=process.env.POSTGRES_URL,projectUrl=process.env.SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY;
if(!postgres||!/^postgres(?:ql)?:\/\/(?:[^@/]+@)?(?:127\.0\.0\.1|localhost):54322\//u.test(postgres))throw new Error("LOCAL_DB_REQUIRED");
if(!projectUrl||!key||!["localhost","127.0.0.1"].includes(new URL(projectUrl).hostname)||new URL(projectUrl).port!=="54321")throw new Error("LOCAL_STORAGE_REQUIRED");
const internal=resolve("../internal"),read=async(file:string)=>JSON.parse(await readFile(resolve(internal,file),"utf8"));
const worker=await read("verification-benchmark-worker-62c9b30e-fb46-478c-9e8c-3da5701fce3a.json") as {tenantId:string;benchmarkRunId:string;publicKey:{keyId:string;pem:string}};
const crash=await read("verification-benchmark-crash-5b42b488-405c-4b02-b28b-44eeaacc1bcd.json") as {keyId:string;publicKey:string;scenarios:{runId:string}[]};
const database=new PostgresCanonicalRepository({connectionString:postgres,localOnly:true}),tenantId=worker.tenantId;
const repository=new PostgresVerificationRepository(database,new SupabaseArtifactStore({projectUrl,serviceRoleKey:key,bucket:"ai-engineer-cloud-bucket",maximumBytes:8_000_000}),{async authorize(input){if(input.tenantId!==tenantId||input.purpose!=="verification_replay")throw new Error("PROOF_TENANT_DENIED");}});
const reads=new PostgresVerificationBenchmarkReadRepository(database,repository,{verifier:createEd25519Verifier({[worker.publicKey.keyId]:worker.publicKey.pem,[crash.keyId]:crash.publicKey})});
const hash=(value:Uint8Array|string)=>`sha256:${createHash("sha256").update(value).digest("hex")}`;
const canonical=(value:unknown):string=>value===null||typeof value!=="object"?JSON.stringify(value):Array.isArray(value)?`[${value.map(canonical).join(",")}]`:`{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical((value as Record<string,unknown>)[k])}`).join(",")}}`;
async function hydrate(handle:VerificationArtifactHandle){const resolver=repository.createTrustedArtifactResolver();await resolver.authorizeArtifact({tenantId,artifactId:handle.artifactId,purpose:"verification_replay"});const loaded=await resolver.hydrateRegisteredArtifact({tenantId,artifactId:handle.artifactId});assert.equal(loaded.registration.digest,handle.digest);assert.equal(hash(loaded.bytes),handle.digest);assert.equal(loaded.bytes.byteLength,handle.byteLength);return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(loaded.bytes)) as unknown;}
try{
 const baseline=await reads.loadVerifiedBenchmarkPublication(tenantId,worker.benchmarkRunId),candidate=await reads.loadVerifiedBenchmarkPublication(tenantId,crash.scenarios[0]!.runId);
 const baselineDataset=VerificationBenchmarkDatasetSchema.parse(await hydrate(baseline.manifest.dataset.artifact)),candidateDataset=VerificationBenchmarkDatasetSchema.parse(await hydrate(candidate.manifest.dataset.artifact));
 const baselineRun=await hydrate(baseline.manifest.runnerPayload) as VerificationBenchmarkRun,candidateRun=await hydrate(candidate.manifest.runnerPayload) as VerificationBenchmarkRun;
 const original=canonical({baselineRun,candidateRun,baselineDataset,candidateDataset}),results=[];
 for(const arm of baseline.manifest.arms){
  const result=compareVerificationBenchmarkRuns({baseline:{dataset:baselineDataset,run:baselineRun,armId:arm.armId},candidate:{dataset:candidateDataset,run:candidateRun,armId:arm.armId},clusterUnit:"source_family",seed:207197,resamples:2000,correction:"holm"});
  const {comparisonDigest,...body}=result;assert.equal(hash(canonical(body)),comparisonDigest);
  for(const metric of Object.values(result.metrics))assert.equal(metric.delta,0);
  assert.equal(result.claimScope.humanGoldQualityClaim,false);assert.equal(result.claimScope.populationInferenceClaim,false);assert.equal(result.claimScope.promotionClaim,false);
  results.push(result);
 }
 assert.equal(results.length,4);assert.equal(canonical({baselineRun,candidateRun,baselineDataset,candidateDataset}),original);
 const sources=await Promise.all(["packages/evaluation/src/verification-benchmark-run-comparison.ts","packages/evaluation/src/verification-statistics.ts","packages/evaluation/src/verification-benchmark.ts","scripts/prove-verification-benchmark-comparison-kernel.ts"].map(async path=>{const bytes=await readFile(path);return{path,digest:hash(bytes),bytesBase64:bytes.toString("base64")};}));
 const output=resolve(internal,`verification-benchmark-comparison-kernel-${randomUUID()}.json`);await writeFile(output,JSON.stringify({status:"passed",capturedAt:new Date().toISOString(),scope:"Actual signed completed-run and registered input hydration with local engineering comparison kernel only; no durable compare operation or new provider request",tenantId,baseline:{publicationArtifact:baseline.publicationArtifact,runId:baselineRun.runId},candidate:{publicationArtifact:candidate.publicationArtifact,runId:candidateRun.runId},checks:{twoSignedCanonicalCompletedInputs:true,exactRegisteredDatasetAndRunnerBytes:true,fourCorrespondingArmComparisons:true,independentResultDigests:true,identicalRecordedEngineeringMetricsZeroDelta:true,inputBytesUnchanged:true,noHumanGoldPopulationPromotionClaims:true},results,sources,externalProviderRequests:0},null,2));console.log(JSON.stringify({status:"passed",output,comparisons:results.length}));
}finally{await database.close();}
