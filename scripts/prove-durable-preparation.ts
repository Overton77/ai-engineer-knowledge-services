import { randomUUID } from "node:crypto";
import { mkdir,writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ExactHttpAcquisitionAdapter } from "@aiengineer/knowledge-acquisition";
import type { OperationContext,OperationKind } from "@aiengineer/knowledge-contracts";
import { DeterministicTextConversionProvider,DoclingServeProvider,HttpDoclingServeClient } from "@aiengineer/knowledge-conversion";
import { canonicalJson,sha256Digest } from "@aiengineer/knowledge-domain";
import { canonicalPersistenceConfigFromEnvironment,createCanonicalPersistence,PostgresKnowledgeOperationService,PostgresPreparationRepository } from "@aiengineer/knowledge-persistence";
import { createCanonicalActivityExecutor,createProductionActivityRegistry } from "../apps/worker/src/activity-registry.js";
import { CanonicalDurableKnowledgeWorker } from "../apps/worker/src/canonical-worker.js";
import { SupabaseArtifactStore,type ArtifactStore } from "@aiengineer/knowledge-runtime";

const tenantId=process.env.WORKER_TENANT_ID?.trim()||"00000000-0000-7000-8000-000000000001";
const namespace=randomUUID();
const proofUrl=`https://httpbin.org/anything/durable-preparation-${namespace}`;
const persistenceConfig=canonicalPersistenceConfigFromEnvironment(process.env);
if (!persistenceConfig.postgres.localOnly) throw new Error("DURABLE_PREPARATION_PROOF_REQUIRES_CANONICAL_LOCAL_ONLY");
const persistence=createCanonicalPersistence(persistenceConfig);
const preparation=new PostgresPreparationRepository(persistence.database);
const sourceArtifacts=new SupabaseArtifactStore({projectUrl:persistenceConfig.supabaseUrl,serviceRoleKey:persistenceConfig.supabaseSecretKey,
  bucket:"source-captures",maximumBytes:8_000_000});
const derivativeArtifacts=new SupabaseArtifactStore({projectUrl:persistenceConfig.supabaseUrl,serviceRoleKey:persistenceConfig.supabaseSecretKey,
  bucket:"content-derivatives",maximumBytes:8_000_000});
const preparationArtifacts:ArtifactStore={put:(input)=>derivativeArtifacts.put(input),get:(tenant,digest)=>sourceArtifacts.get(tenant,digest)};
const acquisition=new ExactHttpAcquisitionAdapter(sourceArtifacts,{allowedProtocols:["https:"],allowedPorts:[443],allowedHosts:["httpbin.org"],
  maximumRedirects:2,timeoutMs:15_000,maximumBytes:1_000_000,maximumDecompressionRatio:10});
const providers=[
  new DoclingServeProvider("pinned-f8b324448e7c",new HttpDoclingServeClient({baseUrl:process.env.DOCLING_BASE_URL?.trim()||"http://127.0.0.1:5001",
    maximumResultBytes:8_000_000,requestTimeoutMs:2_000}),preparationArtifacts),
  new DeterministicTextConversionProvider(preparationArtifacts),
];
const registry=createProductionActivityRegistry({retrieval:persistence.database,review:persistence.database,
  durablePreparation:{repository:preparation,sourceArtifacts,derivativeArtifacts,sourceStorageBucket:"source-captures",derivativeStorageBucket:"content-derivatives",
    acquisition,conversionProviders:providers}});
const worker=new CanonicalDurableKnowledgeWorker(`durable-preparation-proof-${process.pid}`,tenantId,persistence.database,
  createCanonicalActivityExecutor(persistence.database,registry),30_000);
const operations=new PostgresKnowledgeOperationService(persistence.database);
function context(kind:OperationKind):OperationContext {
  const operationId=randomUUID();
  return {tenantId,operationId,attemptId:randomUUID(),correlationId:namespace,
    actor:{kind:"service",id:randomUUID(),serviceIdentity:"knowledge_api"},capabilityVersion:"durable-preparation-proof/1.0.0",
    idempotencyKey:`durable-preparation:${namespace}:${kind}`,reason:"local durable preparation acceptance proof",contractVersion:"v1"};
}
async function execute(contextValue:OperationContext,kind:OperationKind,input:unknown,stepCount:number) {
  const envelope={context:contextValue,input,expectedVersions:{api:"v1",worker:"durable-preparation/v1"}};
  await operations.submit(kind,envelope,"http://127.0.0.1:4100");
  for (let index=0;index<stepCount;index++) {
    const result=await worker.runOperationOnce(contextValue.operationId);
    if (!result) throw new Error(`PREPARATION_STEP_NOT_CLAIMED:${kind}:${index}`);
  }
  const status=await operations.get(contextValue.operationId,tenantId);
  if (status?.state!=="succeeded") throw new Error(`PREPARATION_OPERATION_FAILED:${kind}:${status?.state??"missing"}`);
  const receipts=await persistence.database.listReceipts(tenantId,contextValue.operationId);
  if (receipts.length!==stepCount) throw new Error(`PREPARATION_RECEIPT_CARDINALITY:${kind}:${receipts.length}`);
  await operations.submit(kind,envelope,"http://127.0.0.1:4100");
  const replayReceipts=await persistence.database.listReceipts(tenantId,contextValue.operationId);
  if (replayReceipts.length!==receipts.length) throw new Error(`PREPARATION_REPLAY_DUPLICATED_RECEIPTS:${kind}`);
  return {status,receipts};
}

try {
  const captureContext=context("capture");
  const capture=await execute(captureContext,"capture",{schemaVersion:"knowledge.capture/v1",
    source:{sourceClass:"web_page",canonicalUrl:proofUrl,publisher:"httpbin",sensitivity:"public"},
    request:{purpose:"bounded durable preparation proof",target:{kind:"http",url:proofUrl},expectedSourceClass:"web_page",
      preferredMediaTypes:["text/html"],egressProfile:"public-web-v1",maximumBytes:1_000_000,renderingPolicy:"none",interactionPolicy:"none",
      classification:"public",expectedOutputs:["source_capture"]}},2);
  const captureRecord=await preparation.getCaptureByOperation(tenantId,captureContext.operationId);
  if (!captureRecord) throw new Error("DURABLE_CAPTURE_MISSING");

  const transformationContext=context("transformation");
  const transformation=await execute(transformationContext,"transformation",{schemaVersion:"knowledge.transformation/v1",
    captureOperationId:captureContext.operationId,document:{documentKind:"reference_web_page",canonicalTitle:`Example Domain ${namespace}`,
      versionLabel:`capture-${captureRecord.artifact.digest}`,identifier:{type:"url",value:proofUrl,authority:"httpbin"}},
    profile:{profileKey:"html-structural-v1",version:"1.0.0",mediaType:captureRecord.artifact.mediaType,managedProcessingAllowed:false},
    providerRoute:["docling-serve","deterministic-structural-text"]},2);
  const representation=await preparation.getRepresentationByOperation(tenantId,transformationContext.operationId);
  if (!representation) throw new Error("DURABLE_REPRESENTATION_MISSING");
  const conversionBody=transformation.receipts.find((item)=>item.receiptKind==="convert.succeeded")?.body as Record<string,unknown>|undefined;
  const conversionReceipt=conversionBody?.receipt as Record<string,unknown>|undefined;
  const attempts=conversionReceipt?.attempts as {provider?:unknown;outcome?:unknown}[]|undefined;
  const fallbackObserved=attempts?.[0]?.provider==="docling-serve"&&attempts[0].outcome==="failed"
    &&attempts[1]?.provider==="deterministic-structural-text"&&attempts[1].outcome==="succeeded";
  if (!fallbackObserved) throw new Error("DOCLING_TO_DETERMINISTIC_FALLBACK_NOT_OBSERVED");

  const chunkContext=context("chunk_set");
  const chunked=await execute(chunkContext,"chunk_set",{schemaVersion:"knowledge.chunk-set/v1",representationId:representation.structuralRepresentationId,
    profileName:"heading-sections-v1",profileVersion:"1.0.0"},2);
  const chunkSet=await preparation.getChunkSetByOperation(tenantId,chunkContext.operationId);
  if (!chunkSet||chunkSet.chunkCount<1) throw new Error("DURABLE_CHUNK_SET_MISSING");

  const core={schemaVersion:"durable-preparation-proof/1.0.0",localOnly:true,tenantId,namespace,registeredActivities:registry.activities(),
    capture:{operationId:captureContext.operationId,artifactDigest:captureRecord.artifact.digest,sizeBytes:captureRecord.artifact.byteLength,receiptIds:capture.status.receiptIds},
    transformation:{operationId:transformationContext.operationId,representationId:representation.structuralRepresentationId,
      structuralArtifactDigest:representation.structuralArtifactDigest,nodeCount:representation.nodeCount,acceptanceState:representation.acceptanceState,
      conversionGrade:representation.conversionGrade,receiptIds:transformation.status.receiptIds},
    chunkSet:{operationId:chunkContext.operationId,chunkSetId:chunkSet.chunkSetId,chunkCount:chunkSet.chunkCount,spanCount:chunkSet.spanCount,
      inputDigest:chunkSet.inputDigest,outputDigest:chunkSet.outputDigest,status:chunkSet.status,receiptIds:chunked.status.receiptIds},
    invariants:{privateContentAddressedStorage:captureRecord.artifact.storageKey.endsWith(captureRecord.artifact.digest.slice(7)),
      captureByteIdentityVerified:capture.receipts.some((item)=>item.receiptKind==="seal.succeeded"),
      conversionRequiresReview:representation.acceptanceState==="pending",candidateChunkSetStored:chunkSet.status==="succeeded",
      operationReplayDidNotDuplicate:[capture,transformation,chunked].every((item)=>item.receipts.length===2),
      doclingOutageFellBackToDeterministic:fallbackObserved},completedAt:new Date().toISOString()};
  if (Object.values(core.invariants).some((value)=>value!==true)) throw new Error("DURABLE_PREPARATION_INVARIANT_FAILED");
  const receipt={...core,receiptDigest:sha256Digest(JSON.parse(JSON.stringify(core)))};
  const output=resolve("catalog/durable-preparation-proof.json");
  await mkdir(resolve("catalog"),{recursive:true});
  await writeFile(output,`${canonicalJson(JSON.parse(JSON.stringify(receipt)))}\n`,"utf8");
  process.stdout.write(`${JSON.stringify({ok:true,output,receiptDigest:receipt.receiptDigest,capture:core.capture,transformation:core.transformation,chunkSet:core.chunkSet})}\n`);
} finally { await persistence.close(); }
