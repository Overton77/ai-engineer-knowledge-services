import { createHash, randomUUID } from "node:crypto";
import { deepFreeze, sha256Digest } from "@aiengineer/knowledge-domain";

export const DEFAULT_EMBEDDING_MODEL = "openai/text-embedding-3-small";
export const DEFAULT_EMBEDDING_DIMENSIONS = 1536;
export const AI_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh/v1";

export interface ModelDescriptor { readonly modelSlug: string; readonly available: boolean; readonly discoveredAt: string; readonly rawDigest: `sha256:${string}` }
export interface EmbedInput { readonly projectionId: string; readonly text: string; readonly textDigest?: `sha256:${string}` }
export interface EmbedRequestBase { readonly vectorSpaceVersionId: string; readonly modelSlug?: string; readonly expectedDimensions?: number; readonly providerRoute?: readonly string[]; readonly idempotencyKey: string; readonly timeoutMs?: number; readonly maxRetries?: number }
export interface EmbedOneRequest extends EmbedRequestBase { readonly input: EmbedInput }
export interface EmbedManyRequest extends EmbedRequestBase { readonly inputs: readonly EmbedInput[] }
export interface RetryAttempt { readonly attempt: number; readonly status?: number; readonly retryable: boolean; readonly delayMs: number; readonly errorClass: string }
export interface EmbeddedItem { readonly projectionId: string; readonly index: number; readonly inputDigest: `sha256:${string}`; readonly embedding: readonly number[]; readonly outputDigest: `sha256:${string}`; readonly cacheKey: string; readonly cached: boolean }
export interface EmbedBatchReceipt {
  readonly requestId: string; readonly idempotencyKey: string; readonly vectorSpaceVersionId: string;
  readonly modelSlug: string; readonly expectedDimensions: number; readonly requestedProviderRoute: readonly string[];
  readonly observedProviderRoute: string; readonly inputManifestDigest: `sha256:${string}`; readonly outputManifestDigest: `sha256:${string}`;
  readonly routeDigest: `sha256:${string}`; readonly modelDigest: `sha256:${string}`; readonly items: readonly EmbeddedItem[];
  readonly usageTokens: number; readonly costUsd: number; readonly latencyMs: number; readonly retryHistory: readonly RetryAttempt[];
}
export type EmbedReceipt = Omit<EmbedBatchReceipt, "items"> & { readonly item: EmbeddedItem };
export interface EmbeddingAdapter { discoverModel(modelSlug: string): Promise<ModelDescriptor>; embedOne(request: EmbedOneRequest): Promise<EmbedReceipt>; embedMany(request: EmbedManyRequest): Promise<EmbedBatchReceipt> }

interface GatewayResponse { id?: string; model?: string; data?: Array<{ index: number; embedding: number[] }>; usage?: { prompt_tokens?: number; total_tokens?: number }; providerMetadata?: { gateway?: { cost?: string | number; provider?: string } }; provider_metadata?: { gateway?: { cost?: string | number; provider?: string } } }
interface GatewayError extends Error { status?: number }
export interface GatewayAdapterOptions { readonly apiKey: string; readonly baseUrl?: string; readonly fetch?: typeof globalThis.fetch; readonly sleep?: (milliseconds: number) => Promise<void>; readonly now?: () => number; readonly cache?: EmbeddingCache }
export interface EmbeddingCache { get(key: string): readonly number[] | undefined; set(key: string, value: readonly number[]): void }
export class MemoryEmbeddingCache implements EmbeddingCache { readonly #items = new Map<string, readonly number[]>(); get(key: string) { return this.#items.get(key); } set(key: string, value: readonly number[]) { this.#items.set(key, Object.freeze([...value])); } }

export function createGatewayEmbeddingAdapterFromEnvironment(environment: NodeJS.ProcessEnv = process.env, options: Omit<GatewayAdapterOptions, "apiKey"> = {}): VercelAiGatewayEmbeddingAdapter {
  const key = environment.AI_GATEWAY_API_KEY ?? environment.VERCEL_OIDC_TOKEN;
  if (!key) throw new Error("AI_GATEWAY_CREDENTIAL_MISSING");
  return new VercelAiGatewayEmbeddingAdapter({ ...options, apiKey: key });
}

export class VercelAiGatewayEmbeddingAdapter implements EmbeddingAdapter {
  readonly #key: string; readonly #baseUrl: string; readonly #fetch: typeof globalThis.fetch; readonly #sleep: (ms: number) => Promise<void>; readonly #now: () => number; readonly #cache: EmbeddingCache;
  constructor(options: GatewayAdapterOptions) { if (!options.apiKey) throw new Error("AI_GATEWAY_CREDENTIAL_MISSING"); this.#key=options.apiKey; this.#baseUrl=(options.baseUrl ?? AI_GATEWAY_BASE_URL).replace(/\/$/,""); this.#fetch=options.fetch ?? globalThis.fetch; this.#sleep=options.sleep ?? ((ms)=>new Promise((resolve)=>setTimeout(resolve,ms))); this.#now=options.now ?? Date.now; this.#cache=options.cache ?? new MemoryEmbeddingCache(); }
  async discoverModel(modelSlug: string): Promise<ModelDescriptor> {
    const response = await this.#fetch(`${this.#baseUrl}/models`, { headers: { authorization: `Bearer ${this.#key}` } });
    if (!response.ok) throw gatewayError(response.status, `AI_GATEWAY_DISCOVERY_${response.status}`);
    const value: unknown = await response.json(); const records = Array.isArray(value) ? value : typeof value === "object" && value !== null && Array.isArray((value as {data?:unknown}).data) ? (value as {data:unknown[]}).data : [];
    const available = records.some((record) => typeof record === "object" && record !== null && ((record as {id?:unknown}).id === modelSlug || (record as {modelId?:unknown}).modelId === modelSlug));
    return deepFreeze({ modelSlug, available, discoveredAt: new Date(this.#now()).toISOString(), rawDigest: sha256Digest(JSON.stringify(value)) });
  }
  async embedOne(request: EmbedOneRequest): Promise<EmbedReceipt> { const result=await this.embedMany({ ...request, inputs:[request.input] }); const {items,...receipt}=result; return deepFreeze({ ...receipt, item: items[0]! }); }
  async embedMany(request: EmbedManyRequest): Promise<EmbedBatchReceipt> {
    validateRequest(request); const modelSlug=request.modelSlug ?? DEFAULT_EMBEDDING_MODEL; const dimensions=request.expectedDimensions ?? DEFAULT_EMBEDDING_DIMENSIONS; const route=[...(request.providerRoute ?? ["openai"])];
    const digests=request.inputs.map((input)=>{const actual=sha256Digest(input.text);if(input.textDigest!==undefined&&input.textDigest!==actual)throw new Error(`EMBEDDING_TEXT_DIGEST_MISMATCH:${input.projectionId}`);return actual;}); const inputManifestDigest=sha256Digest(JSON.stringify(request.inputs.map((input,index)=>({index,projectionId:input.projectionId,inputDigest:digests[index]}))));
    const routeDigest=sha256Digest(JSON.stringify(route)); const modelDigest=sha256Digest(JSON.stringify({modelSlug,dimensions}));
    const cached = request.inputs.map((_,index)=>this.#cache.get(cacheKey(request.vectorSpaceVersionId,digests[index]!)));
    const missingIndexes=cached.flatMap((value,index)=>value===undefined?[index]:[]); const retryHistory:RetryAttempt[]=[]; let response:GatewayResponse={}; const started=this.#now();
    if(missingIndexes.length){
      const body={model:modelSlug,input:missingIndexes.map((index)=>request.inputs[index]!.text),dimensions,provider_options:{gateway:{only:route}}};
      response=await this.#postWithRetry(body,request.idempotencyKey,request.timeoutMs ?? 30_000,request.maxRetries ?? 2,retryHistory);
      const ordered=validateGatewayData(response.data,missingIndexes.length,dimensions);
      for(let outputIndex=0;outputIndex<ordered.length;outputIndex++){ const originalIndex=missingIndexes[outputIndex]!; const vector=ordered[outputIndex]!; this.#cache.set(cacheKey(request.vectorSpaceVersionId,digests[originalIndex]!),vector); cached[originalIndex]=vector; }
    }
    const items=request.inputs.map((input,index):EmbeddedItem=>{const embedding=cached[index]!; validateVector(embedding,dimensions); return deepFreeze({projectionId:input.projectionId,index,inputDigest:digests[index]!,embedding:[...embedding],outputDigest:vectorDigest(embedding),cacheKey:cacheKey(request.vectorSpaceVersionId,digests[index]!),cached:!missingIndexes.includes(index)});});
    const outputManifestDigest=sha256Digest(JSON.stringify(items.map(({projectionId,index,inputDigest,outputDigest})=>({projectionId,index,inputDigest,outputDigest}))));
    const metadata=response.providerMetadata?.gateway ?? response.provider_metadata?.gateway; const tokens=response.usage?.total_tokens ?? response.usage?.prompt_tokens ?? 0; const cost=Number(metadata?.cost ?? 0);
    return deepFreeze({requestId:response.id ?? `local-${randomUUID()}`,idempotencyKey:request.idempotencyKey,vectorSpaceVersionId:request.vectorSpaceVersionId,modelSlug,expectedDimensions:dimensions,requestedProviderRoute:route,observedProviderRoute:metadata?.provider ?? response.model ?? (missingIndexes.length?"gateway:unreported":"cache"),inputManifestDigest,outputManifestDigest,routeDigest,modelDigest,items,usageTokens:Number.isFinite(tokens)?tokens:0,costUsd:Number.isFinite(cost)?cost:0,latencyMs:Math.max(0,this.#now()-started),retryHistory});
  }
  async #postWithRetry(body:object,idempotencyKey:string,timeoutMs:number,maxRetries:number,history:RetryAttempt[]):Promise<GatewayResponse>{
    for(let attempt=0;;attempt++){ try { const response=await this.#fetch(`${this.#baseUrl}/embeddings`,{method:"POST",headers:{authorization:`Bearer ${this.#key}`,"content-type":"application/json","idempotency-key":idempotencyKey},body:JSON.stringify(body),signal:AbortSignal.timeout(timeoutMs)}); if(response.ok)return await response.json() as GatewayResponse; const retryable=[408,409,425,429,500,502,503,504].includes(response.status); if(!retryable||attempt>=maxRetries)throw gatewayError(response.status,`AI_GATEWAY_EMBED_${response.status}`); const delay=retryDelay(attempt,response.headers.get("retry-after")); history.push({attempt:attempt+1,status:response.status,retryable:true,delayMs:delay,errorClass:`HTTP_${response.status}`}); await this.#sleep(delay); } catch(error){ const typed=error as GatewayError; if(typed.status!==undefined)throw error; if(attempt>=maxRetries)throw error; const delay=retryDelay(attempt); history.push({attempt:attempt+1,retryable:true,delayMs:delay,errorClass:error instanceof Error?error.name:"UNKNOWN"}); await this.#sleep(delay); } }
  }
}

export class DeterministicFakeEmbeddingAdapter implements EmbeddingAdapter {
  constructor(readonly dimensions=DEFAULT_EMBEDDING_DIMENSIONS){}
  async discoverModel(modelSlug:string){return deepFreeze({modelSlug,available:true,discoveredAt:"2000-01-01T00:00:00.000Z",rawDigest:sha256Digest(`fake:${modelSlug}`)});}
  async embedOne(request:EmbedOneRequest):Promise<EmbedReceipt>{const batch=await this.embedMany({...request,inputs:[request.input]});const {items,...receipt}=batch;return deepFreeze({...receipt,item:items[0]!});}
  async embedMany(request:EmbedManyRequest):Promise<EmbedBatchReceipt>{validateRequest(request); const dimensions=request.expectedDimensions ?? this.dimensions; const modelSlug=request.modelSlug ?? DEFAULT_EMBEDDING_MODEL; const route=[...(request.providerRoute??["deterministic-fake"])]; const inputs=request.inputs.map((input,index)=>({projectionId:input.projectionId,index,inputDigest:sha256Digest(input.text),embedding:fakeVector(input.text,dimensions)})); const items=inputs.map((x)=>deepFreeze({...x,outputDigest:vectorDigest(x.embedding),cacheKey:cacheKey(request.vectorSpaceVersionId,x.inputDigest),cached:false})); const inputManifestDigest=sha256Digest(JSON.stringify(items.map(({projectionId,index,inputDigest})=>({projectionId,index,inputDigest})))); const outputManifestDigest=sha256Digest(JSON.stringify(items.map(({projectionId,index,inputDigest,outputDigest})=>({projectionId,index,inputDigest,outputDigest})))); return deepFreeze({requestId:`fake-${request.idempotencyKey}`,idempotencyKey:request.idempotencyKey,vectorSpaceVersionId:request.vectorSpaceVersionId,modelSlug,expectedDimensions:dimensions,requestedProviderRoute:route,observedProviderRoute:"deterministic-fake",inputManifestDigest,outputManifestDigest,routeDigest:sha256Digest(JSON.stringify(route)),modelDigest:sha256Digest(JSON.stringify({modelSlug,dimensions})),items,usageTokens:request.inputs.reduce((n,i)=>n+Math.ceil(i.text.length/4),0),costUsd:0,latencyMs:0,retryHistory:[]});}
}

function validateRequest(request:EmbedManyRequest){if(!request.idempotencyKey.trim())throw new Error("IDEMPOTENCY_KEY_REQUIRED");if(!request.vectorSpaceVersionId.trim())throw new Error("VECTOR_SPACE_VERSION_REQUIRED");if(request.inputs.length===0)throw new Error("EMBEDDING_INPUTS_REQUIRED");const projectionIds=new Set<string>();for(const input of request.inputs){if(!input.text.trim())throw new Error(`EMPTY_EMBEDDING_INPUT:${input.projectionId}`);if(input.textDigest!==undefined&&input.textDigest!==sha256Digest(input.text))throw new Error(`EMBEDDING_TEXT_DIGEST_MISMATCH:${input.projectionId}`);if(projectionIds.has(input.projectionId))throw new Error(`DUPLICATE_EMBEDDING_PROJECTION:${input.projectionId}`);projectionIds.add(input.projectionId);}}
function validateGatewayData(data:GatewayResponse["data"],count:number,dimensions:number){if(!data||data.length!==count)throw new Error(`EMBEDDING_COUNT_MISMATCH:${data?.length??0}:${count}`); data.forEach((item,index)=>{if(item.index!==index)throw new Error(`EMBEDDING_ORDER_MISMATCH:${item.index}:${index}`);validateVector(item.embedding,dimensions);});return data.map((item)=>item.embedding);}
export function validateVector(vector:readonly number[],dimensions:number){if(vector.length!==dimensions)throw new Error(`EMBEDDING_DIMENSION_MISMATCH:${vector.length}:${dimensions}`);if(vector.some((value)=>!Number.isFinite(value)))throw new Error("EMBEDDING_NON_FINITE");}
export function vectorDigest(vector:readonly number[]):`sha256:${string}`{const bytes=Buffer.allocUnsafe(vector.length*8);vector.forEach((value,index)=>bytes.writeDoubleBE(value,index*8));return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;}
function fakeVector(text:string,dimensions:number){const output:number[]=[];for(let block=0;output.length<dimensions;block++){const bytes=createHash("sha256").update(`${text}\0${block}`).digest();for(const byte of bytes){output.push((byte-127.5)/127.5);if(output.length===dimensions)break;}}const norm=Math.sqrt(output.reduce((sum,x)=>sum+x*x,0));return output.map((x)=>x/norm);}
function cacheKey(version:string,digest:string){return `${version}:${digest}`;}
function retryDelay(attempt:number,retryAfter?:string|null){const seconds=retryAfter===undefined||retryAfter===null?NaN:Number(retryAfter);return Number.isFinite(seconds)?Math.min(10_000,seconds*1000):Math.min(2_000,100*2**attempt);}
function gatewayError(status:number,message:string):GatewayError{const error=new Error(message) as GatewayError;error.status=status;return error;}
