import { mkdir,writeFile } from "node:fs/promises";
import { createGatewayEmbeddingAdapterFromEnvironment,DEFAULT_EMBEDDING_MODEL } from "../packages/embeddings/src/index.js";
import { KnowledgePreparationService } from "../packages/application/src/index.js";
import { loadEmbeddingBundles } from "../packages/testkit/src/index.js";

const outputPath=process.argv[2]??"catalog/live-embedding-receipt.json";
const adapter=createGatewayEmbeddingAdapterFromEnvironment();
const model=await adapter.discoverModel(DEFAULT_EMBEDDING_MODEL);
if(!model.available)throw new Error(`Gateway model is unavailable: ${DEFAULT_EMBEDDING_MODEL}`);
const loaded=await loadEmbeddingBundles();const inputs=[];
for(const {bundle} of loaded){const prepared=await new KnowledgePreparationService().preparePreview(bundle);for(const projection of prepared.engineeringClaimProjections)inputs.push({projectionId:projection.projectionId,text:projection.text});}
if(inputs.length<41)throw new Error(`Expected at least 41 claim projections, received ${inputs.length}`);
const receipt=await adapter.embedMany({vectorSpaceVersionId:"internal-exploratory-live-1536-v1",idempotencyKey:"internal-exploratory-41-claims-2026-09-03",modelSlug:DEFAULT_EMBEDDING_MODEL,expectedDimensions:1536,providerRoute:["openai"],inputs,timeoutMs:30_000,maxRetries:2});
const safe={storeClass:"internal_exploratory",model:{modelSlug:model.modelSlug,available:model.available,rawDigest:model.rawDigest},receipt:{requestId:receipt.requestId,modelSlug:receipt.modelSlug,expectedDimensions:receipt.expectedDimensions,requestedProviderRoute:receipt.requestedProviderRoute,observedProviderRoute:receipt.observedProviderRoute,inputManifestDigest:receipt.inputManifestDigest,outputManifestDigest:receipt.outputManifestDigest,routeDigest:receipt.routeDigest,modelDigest:receipt.modelDigest,itemCount:receipt.items.length,itemDigests:receipt.items.map(x=>({projectionId:x.projectionId,inputDigest:x.inputDigest,outputDigest:x.outputDigest})),usageTokens:receipt.usageTokens,costUsd:receipt.costUsd,latencyMs:receipt.latencyMs,retryHistory:receipt.retryHistory}};
await mkdir(new URL("../catalog/",import.meta.url),{recursive:true});await writeFile(outputPath,`${JSON.stringify(safe,null,2)}\n`,"utf8");console.log(JSON.stringify({ok:true,model:model.modelSlug,itemCount:receipt.items.length,dimensions:receipt.expectedDimensions,usageTokens:receipt.usageTokens,costUsd:receipt.costUsd,latencyMs:receipt.latencyMs,outputPath}));
