import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { canonicalizeJson, sha256Digest } from "@aiengineer/knowledge-verification";

type Digest=`sha256:${string}`;
type Artifact={kind:"request"|"raw_response"|"judge_output";digest:Digest;bytes:number;file:string;httpStatus?:number};
type Record={entryDigest:Digest;reportId:string;assertionId:string;assessment?:unknown;failure?:string;artifacts:Artifact[];observation?:unknown};
const workspace=resolve(import.meta.dirname,"../.."),internal=resolve(workspace,"internal"),repository=resolve(workspace,"ai-engineer-knowledge-services");
const liveRoot=resolve(internal,"verification-EV162-report-semantics-live-20260908"),liveReceiptPath=resolve(liveRoot,"receipt.json");
const expectedLiveReceiptDigest="sha256:6d38d6a74c28f848823ecde39002d5d1db3bf95ead4a4a5acf4b73564f524b8b";
const destinationParent=resolve(repository,"catalog/verification-semantic-fixtures");
const digest=(bytes:Uint8Array|string):Digest=>`sha256:${createHash("sha256").update(bytes).digest("hex")}`;

async function main(){
 const liveBytes=await readFile(liveReceiptPath);if(digest(liveBytes)!==expectedLiveReceiptDigest)throw new Error("EV162_REPORT_SEMANTIC_LIVE_RECEIPT_DRIFT");
 const live=JSON.parse(liveBytes.toString("utf8")) as {schemaVersion:string;plan:{datasetManifestDigest:Digest;runManifestDigest:Digest;planDigest:Digest;entries:{entryDigest:Digest;reportId:string;assertionId:string}[]};records:Record[];result:{attempted:number;completed:number;failed:number}};
 if(live.schemaVersion!=="verification-ev162-generated-report-semantics-live.v1"||live.records.length!==29||live.result.attempted!==29||live.result.completed!==29||live.result.failed!==0||live.plan.entries.length!==29)throw new Error("EV162_REPORT_SEMANTIC_LIVE_SCOPE_INVALID");
 const artifacts=new Map<string,Artifact>(),records=[];
 for(const[index,item]of live.records.entries()){
  const entry=live.plan.entries[index];if(!entry||item.entryDigest!==entry.entryDigest||item.reportId!==entry.reportId||item.assertionId!==entry.assertionId||item.failure||!item.assessment||!item.observation)throw new Error("EV162_REPORT_SEMANTIC_LIVE_RECORD_INVALID");
  const byKind=new Map(item.artifacts.map(artifact=>[artifact.kind,artifact]));if(byKind.size!==3)throw new Error("EV162_REPORT_SEMANTIC_LIVE_ARTIFACT_CLOSURE");
  for(const artifact of item.artifacts){const key=`${artifact.kind}:${artifact.digest}`,prior=artifacts.get(key);if(prior&&canonicalizeJson(prior)!==canonicalizeJson(artifact))throw new Error("EV162_REPORT_SEMANTIC_LIVE_ARTIFACT_CONFLICT");artifacts.set(key,artifact);}
  records.push({entryDigest:item.entryDigest,reportId:item.reportId,assertionId:item.assertionId,requestDigest:byKind.get("request")!.digest,rawResponseDigest:byKind.get("raw_response")!.digest,judgeOutputDigest:byKind.get("judge_output")!.digest,observation:item.observation,assessment:item.assessment});
 }
 if(artifacts.size!==77)throw new Error("EV162_REPORT_SEMANTIC_UNIQUE_ARTIFACT_COUNT");
 const declaredArtifacts=[...artifacts.values()].sort((left,right)=>left.file.localeCompare(right.file));
 const material={schemaVersion:"diagnostics-generated-report-semantic-replay-fixture.v1" as const,datasetManifestDigest:live.plan.datasetManifestDigest,sourceRunManifestDigest:live.plan.runManifestDigest,planDigest:live.plan.planDigest,plan:live.plan,records,artifacts:declaredArtifacts};
 const fixtureDigest=sha256Digest(canonicalizeJson(material)),destination=resolve(destinationParent,fixtureDigest.slice(7)),temporary=resolve(destinationParent,`.tmp-${fixtureDigest.slice(7)}`);
 await mkdir(resolve(temporary,"artifacts"),{recursive:true});
 for(const artifact of declaredArtifacts){if(artifact.file!==`artifacts/${artifact.kind}-${artifact.digest.slice(7)}.bin`)throw new Error("EV162_REPORT_SEMANTIC_ARTIFACT_PATH_INVALID");const source=resolve(liveRoot,artifact.file),bytes=await readFile(source);if(bytes.byteLength!==artifact.bytes||digest(bytes)!==artifact.digest)throw new Error("EV162_REPORT_SEMANTIC_ARTIFACT_DRIFT");await copyFile(source,resolve(temporary,artifact.file));}
 await writeFile(resolve(temporary,"manifest.json"),`${canonicalizeJson({...material,fixtureDigest})}\n`,{flag:"wx"});await rename(temporary,destination);
 process.stdout.write(`${JSON.stringify({directory:destination,fixtureDigest,records:records.length,artifacts:declaredArtifacts.length,sourceReceiptDigest:expectedLiveReceiptDigest})}\n`);
}
main().catch(error=>{process.stderr.write(`${error instanceof Error?error.message:"unknown"}\n`);process.exitCode=1;});
