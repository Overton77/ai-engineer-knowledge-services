import { z } from "zod";
import {
  EvidencePacketSchema,
  RetrievalRunInputSchema,
  type EvidencePacket,
  type JsonValue,
  type MutationEnvelope,
} from "@aiengineer/knowledge-contracts";
import { sha256Digest } from "@aiengineer/knowledge-domain";
import type { EmbeddingAdapter } from "@aiengineer/knowledge-embeddings";
import {
  type HybridSearchResult,
  type PostgresCanonicalRepository,
  type RetrievalEvidenceRecord,
} from "@aiengineer/knowledge-persistence";
import { deterministicUuid } from "@aiengineer/knowledge-runtime";
import type { LocalApiIdentity } from "./auth.js";

const RuntimePolicySchema = z.strictObject({
  admittedSpaces:z.array(z.string()).min(1).max(8),
  allowedFilterFields:z.array(z.enum(["language","visibility","classification","source_kind","authority_level","freshness_after"])).max(6),
  allowedVisibilities:z.array(z.string()).min(1),
  maxCandidateK:z.int().min(1).max(1_000), maxFinalK:z.int().min(1).max(100),
  rrfK:z.int().min(1).max(1_000), minimumCoverage:z.number().min(0).max(1),
  providerRoute:z.array(z.string().min(1)).min(1).max(8).default(["openai"]),
  maximumRerankCandidates:z.int().min(1).max(100).default(50),
  maxPerSource:z.int().min(1).max(100).default(3), contextRadius:z.int().min(0).max(10).default(0),
});

export interface RetrievalReranker {
  readonly version: string;
  rerank(query: string, candidates: readonly { readonly vectorItemId: string; readonly text: string }[]): Promise<readonly { readonly vectorItemId: string; readonly score: number }[]>;
}

export interface CanonicalRetrievalExecutionResult {
  readonly retrievalRunId: string;
  readonly evidencePacketId: string;
  readonly resultCount: number;
  readonly abstained: boolean;
  readonly replayed: boolean;
}

export interface CanonicalRetrievalExecutorPort {
  execute(envelope: MutationEnvelope, identity: LocalApiIdentity): Promise<CanonicalRetrievalExecutionResult>;
}

interface FusedHit { hit: HybridSearchResult; contributions: { targetVersionId:string; rank:number; score:number; contribution:number }[]; score:number }

export class CanonicalRetrievalExecutor implements CanonicalRetrievalExecutorPort {
  constructor(
    private readonly database: PostgresCanonicalRepository,
    private readonly embeddings: EmbeddingAdapter,
    private readonly options: { readonly reranker?: RetrievalReranker; readonly now?: () => Date } = {},
  ) {}

  async execute(envelope: MutationEnvelope, identity: LocalApiIdentity): Promise<CanonicalRetrievalExecutionResult> {
    try{return await this.executeCanonical(envelope,identity);}catch(error){
      if(!await this.database.getRetrievalRunResource(envelope.context.tenantId,envelope.context.operationId))await this.failOperation(envelope,error);
      throw error;
    }
  }

  private async executeCanonical(envelope: MutationEnvelope, identity: LocalApiIdentity): Promise<CanonicalRetrievalExecutionResult> {
    const { plan } = RetrievalRunInputSchema.parse(envelope.input);
    if (envelope.expectedVersions.retrieval !== "v1") throw new Error("RETRIEVAL_CONTRACT_VERSION_NOT_ADMITTED");
    const requestDigest=sha256Digest(asJson({plan,expectedVersions:envelope.expectedVersions}));
    const existing=await this.database.getRetrievalRunResource(envelope.context.tenantId,envelope.context.operationId);
    if(existing){
      const packetId=existing.evidencePacketIds[0];
      if(!packetId)throw new Error("RESOURCE_INTEGRITY_CONFLICT");
      const packet=EvidencePacketSchema.parse(await this.database.getEvidencePacket(envelope.context.tenantId,packetId));
      await this.completeOperation(envelope,packet,true);
      return {retrievalRunId:existing.id,evidencePacketId:packet.id,resultCount:packet.members.length,abstained:packet.abstention.recommended,replayed:true};
    }
    const resolved=await this.database.resolveRetrievalPolicy(envelope.context.tenantId,plan.policyVersion,plan.spaces);
    const policy=RuntimePolicySchema.parse(resolved.policy);
    const forbiddenSpaces=plan.spaces.filter((space)=>!policy.admittedSpaces.includes(space));
    if(forbiddenSpaces.length)throw new Error(`RETRIEVAL_SPACE_NOT_ADMITTED:${forbiddenSpaces.join(",")}`);
    if(plan.candidateK>policy.maxCandidateK||plan.finalK>policy.maxFinalK)throw new Error("RETRIEVAL_LIMIT_EXCEEDED");
    if(plan.abstention.minimumCoverage<policy.minimumCoverage)throw new Error("RETRIEVAL_ABSTENTION_POLICY_WEAKENED");
    if(plan.graph.maxDepth>0||plan.graph.allowedEdges.length>0)throw new Error("RETRIEVAL_GRAPH_STAGE_NOT_BACKED");
    if(plan.softBoosts.length>0)throw new Error("RETRIEVAL_SOFT_BOOST_STAGE_NOT_BACKED");
    if(plan.anchors.entities.length||plan.anchors.concepts.length||plan.anchors.useCases.length)throw new Error("RETRIEVAL_ANCHOR_STAGE_NOT_BACKED");
    if(plan.temporalScope.effectiveBefore||plan.temporalScope.observedBefore)throw new Error("RETRIEVAL_UPPER_TEMPORAL_FILTER_NOT_BACKED");
    if(policy.contextRadius>0)throw new Error("RETRIEVAL_CONTEXT_STAGE_NOT_BACKED");
    const filters:Record<string,string>={};
    for(const filter of plan.hardFilters){
      if(!(policy.allowedFilterFields as readonly string[]).includes(filter.field)||filter.op!=="eq"||typeof filter.value!=="string")throw new Error(`RETRIEVAL_FILTER_NOT_ADMITTED:${filter.field}:${filter.op}`);
      if(filter.field==="visibility"&&!policy.allowedVisibilities.includes(filter.value))throw new Error("RETRIEVAL_VISIBILITY_NOT_ADMITTED");
      filters[filter.field]=filter.value;
    }
    if(plan.temporalScope.effectiveAfter)filters.freshness_after=plan.temporalScope.effectiveAfter;
    if(!resolved.targets.length)throw new Error("NO_ACTIVE_PUBLISHED_VECTOR_SPACE");

    const stageStarted=performance.now();
    const searches=await Promise.all(resolved.targets.map(async(target)=>{
      if(target.dimensions!==1_536)throw new Error(`UNSUPPORTED_RETRIEVAL_DIMENSIONS:${target.dimensions}`);
      const receipt=await this.embeddings.embedOne({vectorSpaceVersionId:target.vectorSpaceVersionId,modelSlug:target.embeddingModel,
        expectedDimensions:target.dimensions,providerRoute:policy.providerRoute,idempotencyKey:`${envelope.context.idempotencyKey}:query:${target.vectorSpaceVersionId}`,
        input:{projectionId:deterministicUuid("retrieval-query",`${envelope.context.operationId}:${target.vectorSpaceVersionId}`),text:plan.query}});
      const hits=await this.database.hybridSearch({tenantId:envelope.context.tenantId,vectorSpaceVersionId:target.vectorSpaceVersionId,
        queryText:plan.query,queryEmbedding:receipt.item.embedding,filters,resultLimit:plan.candidateK,candidateLimit:plan.candidateK,rrfK:policy.rrfK});
      return {target,hits};
    }));
    const searchMs=performance.now()-stageStarted;
    const fused=new Map<string,FusedHit>();
    for(const search of searches)for(const [index,hit] of search.hits.entries()){
      const contribution=1/(policy.rrfK+index+1);const prior=fused.get(hit.vectorItemId);
      const detail={targetVersionId:search.target.vectorSpaceVersionId,rank:index+1,score:hit.fusedScore,contribution};
      fused.set(hit.vectorItemId,prior?{...prior,contributions:[...prior.contributions,detail],score:prior.score+contribution}:{hit,contributions:[detail],score:contribution});
    }
    let ordered=[...fused.values()].sort((a,b)=>b.score-a.score||a.hit.vectorItemId.localeCompare(b.hit.vectorItemId));
    const omissions:{recordId?:string;reason:string}[]=[];let rerankMs=0;let rerankerId:string|undefined;
    const evidence=await this.database.getRetrievalEvidenceRecords(envelope.context.tenantId,ordered.map(({hit})=>hit.vectorItemId));
    const byId=new Map(evidence.map((record)=>[record.vectorItemId,record]));
    if(plan.rerankerVersion){
      if(this.options.reranker&&this.options.reranker.version===plan.rerankerVersion){
        const started=performance.now();
        try{const subset=ordered.slice(0,policy.maximumRerankCandidates);const scores=await this.options.reranker.rerank(plan.query,subset.map(({hit})=>({vectorItemId:hit.vectorItemId,text:byId.get(hit.vectorItemId)?.sourceText??hit.searchText})));
          validateRerankerOutput(subset.map(({hit})=>hit.vectorItemId),scores);
          const scoreMap=new Map(scores.map(item=>[item.vectorItemId,item.score]));ordered=ordered.sort((a,b)=>(scoreMap.get(b.hit.vectorItemId)??-Infinity)-(scoreMap.get(a.hit.vectorItemId)??-Infinity)||b.score-a.score||a.hit.vectorItemId.localeCompare(b.hit.vectorItemId));rerankerId=this.options.reranker.version;
        }catch{omissions.push({reason:"reranker_failed; deterministic fused ordering used"});}
        rerankMs=performance.now()-started;
      }else omissions.push({reason:"requested reranker unavailable; deterministic fused ordering used"});
    }
    const locatorBound=ordered.filter(({hit})=>{const record=byId.get(hit.vectorItemId);if(record?.locator&&record.artifactReference)return true;omissions.push({recordId:hit.vectorItemId,reason:"candidate omitted because no accepted representation locator is bound to its projection evidence"});return false;});
    const selected:FusedHit[]=[];const sourceCounts=new Map<string,number>();for(const item of locatorBound){if(selected.length>=plan.finalK)break;const sourceId=byId.get(item.hit.vectorItemId)!.artifactReference!.artifactId,count=sourceCounts.get(sourceId)??0;if(count>=policy.maxPerSource){omissions.push({recordId:item.hit.vectorItemId,reason:"candidate omitted by per-source diversity cap"});continue;}sourceCounts.set(sourceId,count+1);selected.push(item);}
    const termSet=(text:string)=>new Set(text.normalize("NFKC").toLowerCase().split(/[^a-z0-9_+.#/-]+/).filter(term=>term.length>1));
    const coverage=plan.subqueries.map(subquery=>{const terms=termSet(subquery.text);return{subqueryId:subquery.id,coverage:selected.some(({hit})=>{const candidate=termSet(byId.get(hit.vectorItemId)!.sourceText);return [...terms].some(term=>candidate.has(term));})?1:0};});
    const requiredCoverage=coverage.filter((_,index)=>plan.subqueries[index]!.coverageRole==="required");
    const coverageScore=requiredCoverage.reduce((sum,item)=>sum+item.coverage,0)/Math.max(1,requiredCoverage.length);
    const missingSpaces=plan.spaces.filter(space=>!resolved.targets.some(target=>target.vectorSpace===space));
    if(missingSpaces.length)omissions.push({reason:`no active published vector-space version for: ${missingSpaces.join(",")}`});
    const bypass=/\b(?:ignore|bypass|disable|override)\b.{0,48}\b(?:tenant|authorization|access|policy|filter)s?\b|\b(?:reveal|exfiltrate|leak)\b.{0,48}\b(?:private|secret|other (?:tenant|customer))\b/i.test(plan.query);
    const abstained=bypass||missingSpaces.length>0||coverageScore<plan.abstention.minimumCoverage||selected.length===0;
    const packetId=deterministicUuid("retrieval-evidence-packet",`${envelope.context.operationId}:${requestDigest}`);
    const planId=deterministicUuid("retrieval-plan",`${envelope.context.operationId}:${requestDigest}`);
    const receiptIds=["retrieve","packet"].map(step=>deterministicUuid("canonical-retrieval-receipt",`${envelope.context.operationId}:${step}`));
    const createdAt=(this.options.now?.()??new Date()).toISOString();
    const members=selected.map((item,index)=>this.member(envelope.context.tenantId,packetId,item,index+1,byId.get(item.hit.vectorItemId)!,plan.subqueries));
    const core={id:packetId,tenantId:envelope.context.tenantId,schemaVersion:"v1" as const,createdAt,retrievalRunId:envelope.context.operationId,
      normalizedQuery:plan.query.normalize("NFKC").replace(/\s+/g," ").trim(),plan,
      authorization:{decisionId:deterministicUuid("retrieval-authorization",`${envelope.context.operationId}:${identity.actor.id}`),tenantId:envelope.context.tenantId,
        actorId:identity.actor.id,action:"retrieval.execute",resource:`retrieval_run:${envelope.context.operationId}`,allowed:true,policyVersion:plan.policyVersion,reasonCodes:["authenticated_actor_match","tenant_scope_match","active_retrieval_policy"]},
      procedureVersionIds:[...new Set(resolved.targets.map(target=>target.projectionProcedureId))],members,omittedResults:omissions,coverage,
      abstention:{recommended:abstained,...(abstained?{reason:bypass?"query requests authorization-policy bypass":missingSpaces.length?`required retrieval spaces have no active publication: ${missingSpaces.join(",")}`:selected.length===0?"no locator-backed canonical evidence matched":`required subquery coverage ${coverageScore.toFixed(2)} is below ${plan.abstention.minimumCoverage.toFixed(2)}`}:{})},
      eventIds:[],artifactIds:[...new Set(members.flatMap(member=>member.artifactReferences.map(artifact=>artifact.artifactId)))],receiptIds};
    const packet=EvidencePacketSchema.parse({...core,digest:sha256Digest(asJson(core))});
    const candidates=selected.map((item,index)=>({id:deterministicUuid("retrieval-candidate",`${envelope.context.operationId}:${item.hit.vectorItemId}`),vectorItemId:item.hit.vectorItemId,
      stageScores:{databaseRrf:item.hit.fusedScore,crossSpaceRrf:item.score,channels:item.hit.channelScores},finalScore:item.score,rank:index+1,
      sources:this.sources(envelope.context.operationId,item,byId.get(item.hit.vectorItemId)!.searchProjectionId)}));
    await this.database.storeRetrievalExecution(envelope.context.tenantId,{operationId:envelope.context.operationId,requestSha256:requestDigest.slice(7),planId,
      policyVersionNumber:resolved.version,activeVectorSpaceVersionIds:resolved.targets.map(target=>target.vectorSpaceVersionId),packet,
      stageTimings:{hybridSearchMs:searchMs,rerankMs,evidenceBindingMs:Math.max(0,performance.now()-stageStarted-searchMs-rerankMs)},
      fusionParameters:{method:"reciprocal_rank_fusion",rrfK:policy.rrfK,targetCount:resolved.targets.length,stages:{exact:"executed",fts:"executed",trigram:"executed",ann:"executed",graph:"not_requested",rerank:plan.rerankerVersion?(rerankerId?"executed":"degraded_fallback"):"not_requested",diversity:"executed",context:"not_configured"}},...(rerankerId?{rerankerId}:{}),candidates});
    await this.completeOperation(envelope,packet,false);
    return {retrievalRunId:envelope.context.operationId,evidencePacketId:packet.id,resultCount:packet.members.length,abstained,replayed:false};
  }

  private member(tenantId:string,packetId:string,item:FusedHit,rank:number,record:RetrievalEvidenceRecord,subqueries:EvidencePacket["plan"]["subqueries"]):EvidencePacket["members"][number]{
    const channelScores=item.hit.channelScores as Record<string,{score?:number;rank?:number}>;const covered=subqueries.filter(query=>{const terms=new Set(query.text.toLowerCase().split(/\W+/).filter(Boolean));const text=new Set(record.sourceText.toLowerCase().split(/\W+/).filter(Boolean));return[...terms].some(term=>text.has(term));}).map(query=>query.id);
    return {memberId:deterministicUuid("retrieval-packet-member",`${packetId}:${record.vectorItemId}`),
      ...(record.authority==="canonical"&&CANONICAL_PACKET_MEMBER_KINDS.has(record.canonicalRecord.kind)?{canonicalRecord:record.canonicalRecord}:{faithfulSectionRepresentationId:record.locator!.representationId}),matchedProjectionId:record.searchProjectionId,
      locators:[record.locator!],scores:{lexical:Math.max(0,...[channelScores.exact?.score,channelScores.fts?.score,channelScores.trigram?.score].filter((x):x is number=>typeof x==="number")),semantic:channelScores.ann?.score,fusion:item.score,final:item.score},
      channelExplanations:Object.entries(channelScores).map(([channel,value])=>`${channel}: score=${value.score??0}, rank=${value.rank??0}`),graphPaths:[],authority:record.authority,assurance:record.assurance,
      freshAt:record.freshnessAt,contradictionIds:[],supersedesIds:[],coveredSubqueryIds:covered,artifactReferences:[record.artifactReference!]};
  }

  private sources(operationId:string,item:FusedHit,projectionId:string){
    const raw=item.hit.channelScores as Record<string,{score?:number;rank?:number}>;const sources:{id:string;channel:"vector"|"lexical"|"exact";searchProjectionId:string;sourceRank:number;score:number;explanation:unknown}[]=[];
    for(const [channel,value] of Object.entries(raw)){const normalized=channel==="ann"?"vector":channel==="exact"?"exact":"lexical" as const;sources.push({id:deterministicUuid("retrieval-candidate-source",`${operationId}:${item.hit.vectorItemId}:${channel}`),channel:normalized,searchProjectionId:projectionId,sourceRank:Number(value.rank??1),score:Number(value.score??0),explanation:{provider:"postgres",channel,rrfContribution:1}});}
    return sources;
  }

  private async completeOperation(envelope:MutationEnvelope,packet:EvidencePacket,replayed:boolean){
    for(const step of ["retrieve","packet"]){const existing=(await this.database.listSteps(envelope.context.tenantId,envelope.context.operationId)).find(item=>item.stepKey===step);if(existing?.status==="succeeded")continue;
      const lease=await this.database.claimOperation(envelope.context.tenantId,envelope.context.operationId,"knowledge-api:canonical-retrieval");if(!lease)throw new Error("RETRIEVAL_OPERATION_STEP_UNAVAILABLE");
      if(lease.stepKey!==step)throw new Error(`RETRIEVAL_OPERATION_STEP_ORDER:${lease.stepKey}:${step}`);
      await this.database.completeStep(envelope.context.tenantId,lease,{id:deterministicUuid("canonical-retrieval-receipt",`${envelope.context.operationId}:${step}`),idempotencyKey:`${envelope.context.idempotencyKey}:${step}`,
        receiptKind:`retrieval.${step}.succeeded`,executorIdentity:"knowledge-api:canonical-retrieval",output:step==="retrieve"?{retrievalRunId:envelope.context.operationId,candidateCount:packet.members.length,replayed}:{evidencePacketId:packet.id,abstained:packet.abstention.recommended,replayed}});
    }
  }

  private async failOperation(envelope:MutationEnvelope,error:unknown){
    const lease=await this.database.claimOperation(envelope.context.tenantId,envelope.context.operationId,"knowledge-api:canonical-retrieval");if(!lease)return;
    const errorClass=error instanceof z.ZodError?"INVALID_RETRIEVAL_CONTRACT":error instanceof Error?error.message.split(":",1)[0]!:"RETRIEVAL_EXECUTION_FAILED";
    await this.database.failStep(envelope.context.tenantId,lease,{id:deterministicUuid("canonical-retrieval-receipt",`${envelope.context.operationId}:${lease.stepKey}:failed`),
      idempotencyKey:`${envelope.context.idempotencyKey}:${lease.stepKey}:failed`,executorIdentity:"knowledge-api:canonical-retrieval",errorClass,retryable:false});
  }
}

function asJson(value:unknown):JsonValue{return JSON.parse(JSON.stringify(value)) as JsonValue;}

export function validateRerankerOutput(admittedIds:readonly string[],scores:readonly {readonly vectorItemId:string;readonly score:number}[]):void{
  const admitted=new Set(admittedIds);if(scores.length<1||scores.length>admittedIds.length||new Set(scores.map(item=>item.vectorItemId)).size!==scores.length||scores.some(item=>!admitted.has(item.vectorItemId)||!Number.isFinite(item.score)||item.score < -1||item.score > 1))throw new Error("INVALID_RERANKER_OUTPUT");
}

const CANONICAL_PACKET_MEMBER_KINDS=new Set(["claim","evidence.claim","technical_problem","knowledge.technical_problem","solution_pattern","knowledge.solution_pattern","advanced_usage_pattern","knowledge.advanced_usage_pattern","implementation_example","knowledge.implementation_example","failure_mode","knowledge.failure_mode","benchmark_result","knowledge.benchmark_result","compatibility_constraint","knowledge.compatibility_constraint","operational_practice","knowledge.operational_practice","security_consideration","knowledge.security_consideration"]);
