import { sha256Digest } from "@aiengineer/knowledge-domain";
import { deterministicUuid } from "@aiengineer/knowledge-runtime";
import type {
  GovernedEmbeddingContext,GovernedEmbeddingRun,GovernedIndexRepository,GovernedProjectionProposal,
  GovernedProjectionProposalInput,GovernedPromotionDecisionInput,GovernedPublication,GovernedPublicationInput,
  PersistGovernedEmbeddingRunInput,
} from "./types.js";
import type { PostgresCanonicalRepository,TenantSqlClient } from "./postgres.js";

type Row=Record<string,unknown>;
const hex=(value:unknown)=>sha256Digest(JSON.parse(JSON.stringify(value))).slice(7);
const digest=(value:unknown)=>`sha256:${hex(value)}` as const;
const vectorText=(values:readonly number[])=>`[${values.map((value)=>Object.is(value,-0)?"0":String(value)).join(",")}]`;

function proposalFromRow(row:Row):GovernedProjectionProposal {
  const manifest=row.projection_manifest as Record<string,unknown>;
  return {proposalId:String(row.id),proposalDigest:`sha256:${String(row.proposal_sha256)}`,
    projectionIds:(manifest.projectionIds as unknown[]).map(String),projectionManifestDigest:String(manifest.projectionManifestDigest) as `sha256:${string}`,
    chunkSetId:String(manifest.chunkSetId),representationId:String(manifest.representationId)};
}

/** Canonical Gate 2-3 materialization. All methods re-read immutable rows before returning replay success. */
export class PostgresGovernedIndexRepository implements GovernedIndexRepository {
  constructor(private readonly database:PostgresCanonicalRepository) {}

  async persistRepresentationDecision(tenantId:string,input:Parameters<GovernedIndexRepository["persistRepresentationDecision"]>[1]):Promise<string> {
    return this.database.transaction(tenantId,async(client)=>{
      const representation=(await client.query<Row>(`select r.*,e.id evaluation_id from content.document_representation r
        left join content.conversion_evaluation e on e.tenant_id=r.tenant_id and e.representation_id=r.id
        where r.tenant_id=$1 and r.id=$2 order by e.created_at desc nulls last limit 1`,[tenantId,input.representationId])).rows[0];
      if(!representation||String(representation.content_sha256)!==input.guardedDigest.slice(7))throw new Error("REPRESENTATION_GUARDED_DIGEST_MISMATCH");
      const reviewed=(await client.query<Row>(`select * from knowledge_service.review_decision where tenant_id=$1 and id=$2
        and decision_operation_id=$3 and guarded_sha256=$4`,[tenantId,input.knowledgeReviewDecisionId,input.operationId,input.guardedDigest.slice(7)])).rows[0];
      if(!reviewed||String(reviewed.reviewer_identity)!==input.reviewerIdentity)throw new Error("REPRESENTATION_REVIEW_PROVENANCE_MISMATCH");
      const mapped=reviewed.decision==="approve"?"accept":reviewed.decision;
      if(mapped!==input.decision)throw new Error("REPRESENTATION_DECISION_MISMATCH");
      const id=deterministicUuid("representation-decision",`${input.operationId}:${input.representationId}:${input.guardedDigest}`);
      await client.query(`insert into content.representation_decision
        (id,tenant_id,representation_id,conversion_evaluation_id,guarded_sha256,decision,reviewer_identity,policy_version,rationale,expires_at,knowledge_review_decision_id,decision_operation_id)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) on conflict(id) do nothing`,[id,tenantId,input.representationId,representation.evaluation_id??null,
        input.guardedDigest.slice(7),input.decision,input.reviewerIdentity,input.policyVersion,input.rationale,input.expiresAt??null,input.knowledgeReviewDecisionId,input.operationId]);
      const stored=(await client.query<Row>("select * from content.representation_decision where tenant_id=$1 and id=$2",[tenantId,id])).rows[0];
      if(!stored||String(stored.guarded_sha256)!==input.guardedDigest.slice(7)||String(stored.decision)!==input.decision
        ||String(stored.knowledge_review_decision_id)!==input.knowledgeReviewDecisionId)throw new Error("REPRESENTATION_DECISION_REPLAY_CONFLICT");
      return id;
    });
  }

  async persistProjectionProposal(tenantId:string,input:GovernedProjectionProposalInput):Promise<GovernedProjectionProposal>{
    return this.database.transaction(tenantId,async(client)=>{
      const rows=(await client.query<Row>(`select c.*,cs.representation_id,r.content_sha256 representation_sha256
        from retrieval.retrieval_chunk c join retrieval.chunk_set cs on cs.tenant_id=c.tenant_id and cs.id=c.chunk_set_id
        join content.document_representation r on r.tenant_id=cs.tenant_id and r.id=cs.representation_id
        where c.tenant_id=$1 and c.chunk_set_id=$2 order by c.ordinal,c.id`,[tenantId,input.chunkSetId])).rows;
      if(!rows.length)throw new Error("PROJECTION_CHUNKS_NOT_FOUND");
      const representationId=String(rows[0]!.representation_id);
      if(rows.some((row)=>String(row.representation_id)!==representationId))throw new Error("PROJECTION_REPRESENTATION_MISMATCH");
      const decision=(await client.query<Row>(`select * from content.representation_decision where tenant_id=$1 and id=$2
        and representation_id=$3 and decision='accept' and (expires_at is null or expires_at>now())`,[tenantId,input.representationDecisionId,representationId])).rows[0];
      if(!decision||String(decision.guarded_sha256)!==String(rows[0]!.representation_sha256))throw new Error("PROJECTION_REPRESENTATION_NOT_ACCEPTED");
      const procedure=(await client.query<Row>(`select * from retrieval.projection_procedure where id=$1 and implementation_sha256 ~ '^[0-9a-f]{64}$'`,[input.projectionProcedureId])).rows[0];
      if(!procedure)throw new Error("PROJECTION_PROCEDURE_NOT_ADMITTED");
      const projections=[] as {projectionId:string;targetId:string;chunkId:string;sourceDigest:string;embeddingDigest:string}[];
      for(const row of rows){
        const source=String(row.source_text),sourceDigest=`sha256:${String(row.source_text_sha256)}` as const;
        if(sha256Digest(source)!==sourceDigest)throw new Error("PROJECTION_SOURCE_DIGEST_MISMATCH");
        const embeddingText=input.contextualPrefix?`${input.contextualPrefix}\n\n${source}`:source;
        const embeddingDigest=sha256Digest(embeddingText);
        const chunkId=String(row.id),targetId=deterministicUuid("projection-target",`${tenantId}:${chunkId}`);
        const projectionId=deterministicUuid("search-projection",`${targetId}:${input.projectionProcedureId}:${input.purpose}:${embeddingDigest}`);
        await client.query(`insert into retrieval.projection_target
          (id,tenant_id,target_kind,schema_version,canonical_table,canonical_record_id,eligibility_validator)
          values($1,$2,'retrieval_chunk',1,'retrieval.retrieval_chunk',$3,'retrieval.validate_chunk_projection_target(uuid,uuid)') on conflict(id) do nothing`,[targetId,tenantId,chunkId]);
        await client.query(`insert into retrieval.search_projection
          (id,tenant_id,projection_target_id,projection_procedure_id,purpose,source_text,contextual_prefix,embedding_text,
           source_text_sha256,contextual_prefix_sha256,embedding_text_sha256,support_manifest,language,content_kind,visibility,classification,promotion_state,generator_identity,prompt_schema_version)
          values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,'retrieval_chunk',$14,$15,'candidate',$16,'knowledge.projection/v1') on conflict(id) do nothing`,
          [projectionId,tenantId,targetId,input.projectionProcedureId,input.purpose,source,input.contextualPrefix,embeddingText,sourceDigest.slice(7),
            sha256Digest(input.contextualPrefix).slice(7),embeddingDigest.slice(7),JSON.stringify([{chunkId,kind:"faithful_source",sourceDigest}]),input.language??null,
            input.visibility,input.classification,input.proposedBy]);
        await client.query(`insert into retrieval.search_projection_chunk_support
          (tenant_id,search_projection_id,ordinal,chunk_id,support_kind,selected_text_sha256)
          values($1,$2,0,$3,'faithful_source',$4) on conflict(tenant_id,search_projection_id,ordinal) do nothing`,[tenantId,projectionId,chunkId,sourceDigest.slice(7)]);
        const stored=(await client.query<Row>(`select p.*,s.chunk_id,s.support_kind,s.selected_text_sha256,t.target_kind,t.schema_version,
          t.canonical_table::text canonical_table_name,t.canonical_record_id,t.eligibility_validator::text validator_name
          from retrieval.search_projection p
          join retrieval.search_projection_chunk_support s on s.tenant_id=p.tenant_id and s.search_projection_id=p.id and s.ordinal=0
          join retrieval.projection_target t on t.tenant_id=p.tenant_id and t.id=p.projection_target_id
          where p.tenant_id=$1 and p.id=$2`,[tenantId,projectionId])).rows[0];
        if(!stored||String(stored.projection_target_id)!==targetId||String(stored.projection_procedure_id)!==input.projectionProcedureId
          ||String(stored.purpose)!==input.purpose||String(stored.source_text)!==source||String(stored.contextual_prefix)!==input.contextualPrefix
          ||String(stored.embedding_text)!==embeddingText||String(stored.source_text_sha256)!==sourceDigest.slice(7)
          ||String(stored.contextual_prefix_sha256)!==sha256Digest(input.contextualPrefix).slice(7)||String(stored.embedding_text_sha256)!==embeddingDigest.slice(7)
          ||String(stored.content_kind)!=="retrieval_chunk"||String(stored.visibility)!==input.visibility||String(stored.classification)!==input.classification
          ||String(stored.promotion_state)!=="candidate"||String(stored.generator_identity)!==input.proposedBy||String(stored.prompt_schema_version)!=="knowledge.projection/v1"
          ||String(stored.target_kind)!=="retrieval_chunk"||Number(stored.schema_version)!==1||String(stored.canonical_table_name)!=="retrieval.retrieval_chunk"
          ||String(stored.canonical_record_id)!==chunkId||!String(stored.validator_name).startsWith("retrieval.validate_chunk_projection_target")
          ||String(stored.chunk_id)!==chunkId||String(stored.support_kind)!=="faithful_source"
          ||String(stored.selected_text_sha256)!==sourceDigest.slice(7))throw new Error("SEARCH_PROJECTION_REPLAY_CONFLICT");
        projections.push({projectionId,targetId,chunkId,sourceDigest:sourceDigest.slice(7),embeddingDigest:embeddingDigest.slice(7)});
      }
      const projectionManifestDigest=digest(projections);
      const proposalDocument={chunkSetId:input.chunkSetId,representationId,representationDecisionId:input.representationDecisionId,
        projectionProcedureId:input.projectionProcedureId,projectionIds:projections.map((item)=>item.projectionId),projectionManifestDigest,
        targetDomains:[...input.targetDomains],expectedValue:input.expectedValue,risks:[...input.risks],exclusions:[...input.exclusions],reason:input.reason};
      const proposalDigest=digest(proposalDocument),proposalId=deterministicUuid("content-promotion-proposal",`${tenantId}:${proposalDigest}`);
      await client.query(`insert into retrieval.content_promotion_proposal
        (id,tenant_id,proposal_sha256,source_manifest,chunk_manifest,projection_manifest,target_domains,expected_value,risks,exclusions,procedures,reason,proposed_by,operation_id)
        values($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11::jsonb,$12,$13,$14) on conflict(id) do nothing`,
        [proposalId,tenantId,proposalDigest.slice(7),JSON.stringify({representationId,representationDecisionId:input.representationDecisionId}),
          JSON.stringify({chunkSetId:input.chunkSetId,count:rows.length}),JSON.stringify(proposalDocument),input.targetDomains,input.expectedValue,input.risks,input.exclusions,
          JSON.stringify({projectionProcedureId:input.projectionProcedureId}),input.reason,input.proposedBy,input.operationId]);
      const stored=(await client.query<Row>("select * from retrieval.content_promotion_proposal where tenant_id=$1 and id=$2",[tenantId,proposalId])).rows[0];
      if(!stored||String(stored.proposal_sha256)!==proposalDigest.slice(7)||String(stored.operation_id)!==input.operationId
        ||String(stored.proposed_by)!==input.proposedBy)throw new Error("PROMOTION_PROPOSAL_REPLAY_CONFLICT");
      return proposalFromRow(stored);
    });
  }

  async getProjectionProposal(tenantId:string,proposalId:string):Promise<GovernedProjectionProposal|undefined>{
    return this.database.transaction(tenantId,async(client)=>{const row=(await client.query<Row>("select * from retrieval.content_promotion_proposal where tenant_id=$1 and id=$2",[tenantId,proposalId])).rows[0];return row?proposalFromRow(row):undefined;});
  }

  async persistPromotionDecision(tenantId:string,input:GovernedPromotionDecisionInput):Promise<string>{
    return this.database.transaction(tenantId,async(client)=>{
      const proposal=(await client.query<Row>("select * from retrieval.content_promotion_proposal where tenant_id=$1 and id=$2",[tenantId,input.proposalId])).rows[0];
      if(!proposal||String(proposal.proposal_sha256)!==input.guardedDigest.slice(7))throw new Error("PROMOTION_GUARDED_DIGEST_MISMATCH");
      if(String(proposal.proposed_by)===input.reviewerIdentity)throw new Error("PROMOTION_SEPARATION_OF_DUTY_VIOLATION");
      const review=(await client.query<Row>(`select d.* from knowledge_service.review_decision d join knowledge_service.review_subject s
        on s.tenant_id=d.tenant_id and s.id=d.review_subject_id where d.tenant_id=$1 and d.id=$2 and d.decision_operation_id=$3
        and d.guarded_sha256=$4 and s.subject_kind='content_promotion'`,[tenantId,input.knowledgeReviewDecisionId,input.operationId,input.guardedDigest.slice(7)])).rows[0];
      const expectedReview=input.decision==="accept"?"approve":input.decision;
      if(!review||String(review.reviewer_identity)!==input.reviewerIdentity||String(review.decision)!==expectedReview)throw new Error("PROMOTION_REVIEW_PROVENANCE_MISMATCH");
      const id=deterministicUuid("content-promotion-decision",`${input.operationId}:${input.proposalId}:${input.reviewerIdentity}`);
      await client.query(`insert into retrieval.content_promotion_decision
        (id,tenant_id,proposal_id,guarded_sha256,decision,gates,reviewer_identity,policy_version,rationale,expires_at,knowledge_review_decision_id,decision_operation_id)
        values($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12) on conflict(id) do nothing`,[id,tenantId,input.proposalId,input.guardedDigest.slice(7),input.decision,
        JSON.stringify(input.gates),input.reviewerIdentity,input.policyVersion,input.rationale,input.expiresAt??null,input.knowledgeReviewDecisionId,input.operationId]);
      const stored=(await client.query<Row>("select * from retrieval.content_promotion_decision where tenant_id=$1 and id=$2",[tenantId,id])).rows[0];
      if(!stored||String(stored.guarded_sha256)!==input.guardedDigest.slice(7)||String(stored.decision)!==input.decision
        ||String(stored.knowledge_review_decision_id)!==input.knowledgeReviewDecisionId)throw new Error("PROMOTION_DECISION_REPLAY_CONFLICT");
      return id;
    });
  }

  async loadEmbeddingContext(tenantId:string,vectorSpaceVersionId:string,promotionDecisionId:string,projectionIds:readonly string[]):Promise<GovernedEmbeddingContext>{
    if(!projectionIds.length||new Set(projectionIds).size!==projectionIds.length)throw new Error("INVALID_EMBEDDING_PROJECTION_SET");
    return this.database.transaction(tenantId,async(client)=>{
      const version=(await client.query<Row>(`select v.*,s.slug from retrieval.vector_space_version v join retrieval.vector_space s
        on s.tenant_id=v.tenant_id and s.id=v.vector_space_id where v.tenant_id=$1 and v.id=$2`,[tenantId,vectorSpaceVersionId])).rows[0];
      if(!version||Number(version.dims)!==1536||String(version.precision)!=="halfvec")throw new Error("EMBEDDING_SPACE_CONFIGURATION_REJECTED");
      const decision=(await client.query<Row>(`select d.*,p.projection_manifest from retrieval.content_promotion_decision d
        join retrieval.content_promotion_proposal p on p.tenant_id=d.tenant_id and p.id=d.proposal_id
        where d.tenant_id=$1 and d.id=$2 and d.decision='accept' and (d.expires_at is null or d.expires_at>now())`,[tenantId,promotionDecisionId])).rows[0];
      if(!decision)throw new Error("EMBEDDING_PROMOTION_NOT_APPROVED");
      const admitted=(decision.projection_manifest as Record<string,unknown>).projectionIds as string[];
      if(digest([...projectionIds].sort())!==digest([...admitted].sort()))throw new Error("EMBEDDING_PROJECTION_MANIFEST_MISMATCH");
      const projections=(await client.query<Row>(`select p.*,s.chunk_id from retrieval.search_projection p
        join retrieval.search_projection_chunk_support s on s.tenant_id=p.tenant_id and s.search_projection_id=p.id and s.ordinal=0
        join retrieval.projection_target t on t.tenant_id=p.tenant_id and t.id=p.projection_target_id
        where p.tenant_id=$1 and p.id=any($2::uuid[]) and p.projection_procedure_id=$3
          and t.target_kind='retrieval_chunk' and retrieval.validate_chunk_projection_target(p.tenant_id,t.canonical_record_id)
        order by p.id`,[tenantId,projectionIds,version.projection_procedure_id])).rows;
      if(projections.length!==projectionIds.length)throw new Error("EMBEDDING_PROJECTION_INELIGIBLE");
      const byId=new Map(projections.map((row)=>[String(row.id),row]));
      return {vectorSpaceVersionId,modelSlug:String(version.embedding_model),dimensions:Number(version.dims),projectionProcedureId:String(version.projection_procedure_id),
        vectorSpaceKey:`${String(version.slug)}-v${Number(version.version)}`,promotionDecisionId,inputs:projectionIds.map((projectionId)=>{
          const row=byId.get(projectionId);if(!row)throw new Error("EMBEDDING_PROJECTION_NOT_FOUND");
          return {projectionId,text:String(row.embedding_text),textDigest:`sha256:${String(row.embedding_text_sha256)}`};
        })};
    });
  }

  async persistEmbeddingRun(tenantId:string,input:PersistGovernedEmbeddingRunInput):Promise<GovernedEmbeddingRun>{
    return this.database.transaction(tenantId,async(client)=>{
      const prior=(await client.query<Row>("select * from retrieval.embedding_run where tenant_id=$1 and operation_id=$2",[tenantId,input.operationId])).rows[0];
      if(prior){
        if(String(prior.id)!==input.embeddingRunId||String(prior.vector_space_version_id)!==input.context.vectorSpaceVersionId
          ||String(prior.promotion_decision_id)!==input.context.promotionDecisionId||String(prior.idempotency_key)!==input.idempotencyKey
          ||String(prior.adapter_version)!==input.adapterVersion||String(prior.gateway_model_slug)!==input.context.modelSlug
          ||Number(prior.expected_dimensions)!==input.context.dimensions||String(prior.input_manifest_sha256)!==input.receipt.inputManifestDigest.slice(7)
          ||String(prior.output_manifest_sha256)!==input.receipt.outputManifestDigest.slice(7)||String(prior.status)!=="succeeded")
          throw new Error("EMBEDDING_RUN_REPLAY_CONFLICT");
        const replay=await this.embeddingRunFromRow(client,tenantId,prior);
        if(replay.itemCount!==input.receipt.items.length)throw new Error("EMBEDDING_RUN_REPLAY_CARDINALITY_CONFLICT");
        return replay;
      }
      if(input.receipt.items.length!==input.context.inputs.length)throw new Error("EMBEDDING_ITEM_COUNT_MISMATCH");
      await client.query(`insert into retrieval.embedding_run
        (id,tenant_id,vector_space_version_id,operation_id,promotion_decision_id,adapter_version,gateway_model_slug,provider_route_policy,expected_dimensions,
         input_manifest_sha256,output_manifest_sha256,idempotency_key,status,request_id,observed_provider_route,usage,latency_ms,retry_history,cost_usd,receipt,completed_at)
        values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,'succeeded',$13,$14,$15::jsonb,$16,$17::jsonb,$18,$19::jsonb,clock_timestamp())`,
        [input.embeddingRunId,tenantId,input.context.vectorSpaceVersionId,input.operationId,input.context.promotionDecisionId,input.adapterVersion,input.context.modelSlug,
          JSON.stringify(input.providerRoutePolicy),input.context.dimensions,input.receipt.inputManifestDigest.slice(7),input.receipt.outputManifestDigest.slice(7),input.idempotencyKey,
          input.receipt.requestId,input.receipt.observedProviderRoute,JSON.stringify({tokens:input.receipt.usageTokens}),input.receipt.latencyMs,
          JSON.stringify(input.receipt.retryHistory),input.receipt.costUsd,JSON.stringify(input.receipt)]);
      const vectorManifest=[] as {id:string;projectionId:string;content:string;embeddingItemId:string;output:string}[];
      for(const [index,item] of input.receipt.items.entries()){
        if(item.embedding.length!==input.context.dimensions||item.embedding.some((value)=>!Number.isFinite(value)))throw new Error("EMBEDDING_VECTOR_INVALID");
        const expected=input.context.inputs[index];if(!expected||expected.projectionId!==item.projectionId||expected.textDigest!==item.inputDigest)throw new Error("EMBEDDING_RECEIPT_ORDER_MISMATCH");
        const support=(await client.query<Row>(`select s.chunk_id,p.embedding_text,p.language,p.visibility,p.classification from retrieval.search_projection_chunk_support s
          join retrieval.search_projection p on p.tenant_id=s.tenant_id and p.id=s.search_projection_id
          where s.tenant_id=$1 and s.search_projection_id=$2 and s.ordinal=0`,[tenantId,item.projectionId])).rows[0];
        if(!support)throw new Error("EMBEDDING_SUPPORT_MISSING");
        const embeddingItemId=deterministicUuid("embedding-item",`${input.embeddingRunId}:${item.projectionId}`);
        const vectorItemId=deterministicUuid("vector-item",`${input.context.vectorSpaceVersionId}:${item.projectionId}:${item.outputDigest}`);
        await client.query(`insert into retrieval.embedding_item
          (id,tenant_id,embedding_run_id,search_projection_id,input_sha256,output_sha256,dimensions,cache_key,status,provider_metadata)
          values($1,$2,$3,$4,$5,$6,$7,$8,'succeeded',$9::jsonb) on conflict(id) do nothing`,[embeddingItemId,tenantId,input.embeddingRunId,item.projectionId,
          item.inputDigest.slice(7),item.outputDigest.slice(7),item.embedding.length,item.cacheKey,JSON.stringify({route:input.receipt.observedProviderRoute,index})]);
        await client.query(`insert into retrieval.vector_item
          (id,tenant_id,space_version_id,retrieval_chunk_id,search_projection_id,embedding_item_id,source_version_hash,content_sha256,
           backend_location,verification_state,language,visibility,classification,lifecycle,authority_level,search_text)
          select $1,$2,$3,$4,p.id,$5,$6,p.embedding_text_sha256,'pgvector:halfvec1536','verified',p.language,p.visibility,p.classification,'active','reviewed',p.embedding_text
          from retrieval.search_projection p where p.tenant_id=$2 and p.id=$7 on conflict(id) do nothing`,[vectorItemId,tenantId,input.context.vectorSpaceVersionId,
          support.chunk_id,embeddingItemId,item.inputDigest.slice(7),item.projectionId]);
        await client.query(`insert into retrieval.vector_item_embedding_1536
          (tenant_id,vector_space_key,vector_space_version_id,vector_item_id,embedding,embedding_sha256)
          values($1,$2,$3,$4,$5::extensions.halfvec(1536),$6) on conflict(vector_space_key,vector_item_id) do nothing`,[tenantId,input.context.vectorSpaceKey,
          input.context.vectorSpaceVersionId,vectorItemId,vectorText(item.embedding),item.outputDigest.slice(7)]);
        const stored=(await client.query<Row>(`select v.space_version_id,v.retrieval_chunk_id,v.search_projection_id,v.embedding_item_id,v.source_version_hash,
          v.content_sha256,v.backend_location,v.verification_state,v.language,v.visibility,v.classification,v.lifecycle,v.authority_level,v.search_text,
          e.embedding_run_id,e.input_sha256,e.output_sha256,e.dimensions,e.cache_key,e.status embedding_status,
          x.vector_space_key,x.vector_space_version_id,x.embedding_sha256,x.physical_embedding_sha256,
          (x.physical_embedding_sha256=encode(extensions.digest(x.embedding::text,'sha256'),'hex')) physical_digest_verified
          from retrieval.vector_item v join retrieval.embedding_item e on e.tenant_id=v.tenant_id and e.id=v.embedding_item_id
          join retrieval.vector_item_embedding_1536 x on x.tenant_id=v.tenant_id and x.vector_item_id=v.id
          where v.tenant_id=$1 and v.id=$2`,[tenantId,vectorItemId])).rows[0];
        if(!stored||String(stored.space_version_id)!==input.context.vectorSpaceVersionId||String(stored.retrieval_chunk_id)!==String(support.chunk_id)
          ||String(stored.search_projection_id)!==item.projectionId||String(stored.embedding_item_id)!==embeddingItemId
          ||String(stored.source_version_hash)!==item.inputDigest.slice(7)||String(stored.content_sha256)!==item.inputDigest.slice(7)
          ||String(stored.backend_location)!=="pgvector:halfvec1536"||String(stored.verification_state)!=="verified"
          ||String(stored.language??"")!==String(support.language??"")||String(stored.visibility)!==String(support.visibility)
          ||String(stored.classification)!==String(support.classification)||String(stored.lifecycle)!=="active"
          ||String(stored.authority_level)!=="reviewed"||String(stored.search_text)!==String(support.embedding_text)
          ||String(stored.embedding_run_id)!==input.embeddingRunId||String(stored.input_sha256)!==item.inputDigest.slice(7)
          ||String(stored.output_sha256)!==item.outputDigest.slice(7)||Number(stored.dimensions)!==item.embedding.length
          ||String(stored.cache_key)!==item.cacheKey||String(stored.embedding_status)!=="succeeded"
          ||String(stored.vector_space_key)!==input.context.vectorSpaceKey||String(stored.vector_space_version_id)!==input.context.vectorSpaceVersionId
          ||String(stored.embedding_sha256)!==item.outputDigest.slice(7)||stored.physical_digest_verified!==true
          ||!/^[a-f0-9]{64}$/.test(String(stored.physical_embedding_sha256)))throw new Error("VECTOR_ITEM_REPLAY_CONFLICT");
        vectorManifest.push({id:vectorItemId,projectionId:item.projectionId,content:item.inputDigest.slice(7),embeddingItemId,output:item.outputDigest.slice(7)});
      }
      const stored=(await client.query<Row>("select * from retrieval.embedding_run where tenant_id=$1 and id=$2",[tenantId,input.embeddingRunId])).rows[0]!;
      const result=await this.embeddingRunFromRow(client,tenantId,stored);
      if(result.itemCount!==input.receipt.items.length||result.vectorItemManifestDigest!==digest(vectorManifest.sort((a,b)=>a.projectionId.localeCompare(b.projectionId))))throw new Error("VECTOR_ITEM_MANIFEST_CONFLICT");
      return result;
    });
  }

  private async embeddingRunFromRow(client:TenantSqlClient,tenantId:string,row:Row):Promise<GovernedEmbeddingRun>{
    const items=(await client.query<Row>(`select v.id,v.search_projection_id,v.content_sha256,v.embedding_item_id,e.output_sha256
      from retrieval.vector_item v join retrieval.embedding_item e on e.tenant_id=v.tenant_id and e.id=v.embedding_item_id
      where v.tenant_id=$1 and e.embedding_run_id=$2 order by e.search_projection_id`,[tenantId,row.id])).rows;
    const manifest=items.map((item)=>({id:String(item.id),projectionId:String(item.search_projection_id),content:String(item.content_sha256),
      embeddingItemId:String(item.embedding_item_id),output:String(item.output_sha256)}));
    return {embeddingRunId:String(row.id),vectorSpaceVersionId:String(row.vector_space_version_id),itemCount:items.length,
      inputManifestDigest:`sha256:${String(row.input_manifest_sha256)}`,outputManifestDigest:`sha256:${String(row.output_manifest_sha256)}`,
      vectorItemManifestDigest:digest(manifest),status:"succeeded"};
  }

  async getEmbeddingRunByOperation(tenantId:string,operationId:string):Promise<GovernedEmbeddingRun|undefined>{
    return this.database.transaction(tenantId,async(client)=>{const row=(await client.query<Row>("select * from retrieval.embedding_run where tenant_id=$1 and operation_id=$2",[tenantId,operationId])).rows[0];return row?this.embeddingRunFromRow(client,tenantId,row):undefined;});
  }

  async stagePublication(tenantId:string,input:GovernedPublicationInput):Promise<GovernedPublication>{
    return this.database.transaction(tenantId,async(client)=>{
      const context=await this.publicationContext(client,tenantId,input.vectorStoreSpaceId,input.vectorSpaceVersionId,input.promotionDecisionId,input.evaluationResultId);
      if(context.ownerIdentity!==input.expectedOwnerIdentity)throw new Error("VECTOR_STORE_OWNER_MISMATCH");
      if(context.reviewerIdentity===input.publisherIdentity)throw new Error("PUBLICATION_SEPARATION_OF_DUTY_VIOLATION");
      await client.query(`insert into retrieval.space_publication
        (id,tenant_id,vector_store_space_id,vector_space_version_id,vector_item_manifest_sha256,embedding_manifest_sha256,index_manifest_sha256,
         evaluation_result_id,publication_decision_id,status,expected_item_count,operation_id)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,'approved',$10,$11) on conflict(id) do nothing`,[input.publicationId,tenantId,input.vectorStoreSpaceId,
          input.vectorSpaceVersionId,context.vectorManifest.slice(7),context.embeddingManifest.slice(7),context.indexManifest.slice(7),input.evaluationResultId,
          input.promotionDecisionId,context.count,input.operationId]);
      const stored=(await client.query<Row>("select * from retrieval.space_publication where tenant_id=$1 and id=$2",[tenantId,input.publicationId])).rows[0];
      if(!stored||String(stored.vector_item_manifest_sha256)!==context.vectorManifest.slice(7)||String(stored.embedding_manifest_sha256)!==context.embeddingManifest.slice(7)
        ||String(stored.operation_id)!==input.operationId)throw new Error("PUBLICATION_REPLAY_CONFLICT");
      return {publicationId:input.publicationId,guardedDigest:context.guardedDigest,vectorSpaceVersionId:input.vectorSpaceVersionId,
        expectedItemCount:context.count,status:String(stored.status) as "approved"|"published"};
    });
  }

  async publishStaged(tenantId:string,publicationId:string,operationId:string,expectedGuardedDigest:`sha256:${string}`,reason:string,publisherIdentity:string,idempotencyKey:string):Promise<GovernedPublication>{
    return this.database.transaction(tenantId,async(client)=>{
      const staged=(await client.query<Row>(`select p.*,d.reviewer_identity,d.guarded_sha256 from retrieval.space_publication p
        join retrieval.content_promotion_decision d on d.tenant_id=p.tenant_id and d.id=p.publication_decision_id
        where p.tenant_id=$1 and p.id=$2 and p.operation_id=$3`,[tenantId,publicationId,operationId])).rows[0];
      if(!staged||String(staged.guarded_sha256)!==expectedGuardedDigest.slice(7))throw new Error("PUBLICATION_GUARDED_DIGEST_MISMATCH");
      if(String(staged.reviewer_identity)===publisherIdentity)throw new Error("PUBLICATION_SEPARATION_OF_DUTY_VIOLATION");
      const receipt=(await client.query<Row>(`select id from knowledge_service.receipt where tenant_id=$1 and operation_id=$2
        and receipt_kind='publish.succeeded' and outcome='succeeded' order by created_at limit 1`,[tenantId,operationId])).rows[0];
      if(!receipt)throw new Error("PUBLICATION_STAGE_RECEIPT_REQUIRED");
      const switchId=String((await client.query<Row>("select retrieval.publish_vector_space($1,$2,$3,$4,$5) id",[publicationId,expectedGuardedDigest.slice(7),reason,publisherIdentity,idempotencyKey])).rows[0]!.id);
      const authorizationId=deterministicUuid("authorized-publication",`${operationId}:${switchId}`);
      await client.query(`insert into retrieval.authorized_publication_execution
        (id,tenant_id,operation_id,switch_receipt_id,action,guarded_sha256,publisher_identity)
        values($1,$2,$3,$4,'publish',$5,$6) on conflict(id) do nothing`,[authorizationId,tenantId,operationId,switchId,expectedGuardedDigest.slice(7),publisherIdentity]);
      return {publicationId,guardedDigest:expectedGuardedDigest,vectorSpaceVersionId:String(staged.vector_space_version_id),
        expectedItemCount:Number(staged.expected_item_count),status:"published",switchReceiptId:switchId};
    });
  }

  async verifyPublication(tenantId:string,publicationId:string):Promise<GovernedPublication>{
    return this.database.transaction(tenantId,async(client)=>{
      const row=(await client.query<Row>(`select p.*,d.guarded_sha256,s.active_space_version_id,
        (select count(*) from retrieval.vector_item_embedding_1536 e where e.tenant_id=p.tenant_id and e.vector_space_version_id=p.vector_space_version_id)::int actual
        from retrieval.space_publication p join retrieval.content_promotion_decision d on d.tenant_id=p.tenant_id and d.id=p.publication_decision_id
        join retrieval.vector_store_space s on s.tenant_id=p.tenant_id and s.id=p.vector_store_space_id where p.tenant_id=$1 and p.id=$2`,[tenantId,publicationId])).rows[0];
      if(!row||row.status!=="published"||String(row.active_space_version_id)!==String(row.vector_space_version_id)||Number(row.actual)!==Number(row.expected_item_count))throw new Error("PUBLICATION_VERIFICATION_FAILED");
      return {publicationId,guardedDigest:`sha256:${String(row.guarded_sha256)}`,vectorSpaceVersionId:String(row.vector_space_version_id),expectedItemCount:Number(row.expected_item_count),status:"published"};
    });
  }

  async planRollback(tenantId:string,currentPublicationId:string,targetPublicationId:string,publisherIdentity:string):Promise<{guardedDigest:`sha256:${string}`;vectorStoreSpaceId:string}>{
    return this.database.transaction(tenantId,async(client)=>{
      const rows=(await client.query<Row>(`select p.id,p.vector_store_space_id,p.status,d.guarded_sha256,d.reviewer_identity from retrieval.space_publication p
        join retrieval.content_promotion_decision d on d.tenant_id=p.tenant_id and d.id=p.publication_decision_id
        where p.tenant_id=$1 and p.id=any($2::uuid[])`,[tenantId,[currentPublicationId,targetPublicationId]])).rows;
      const current=rows.find((row)=>String(row.id)===currentPublicationId),target=rows.find((row)=>String(row.id)===targetPublicationId);
      if(!current||!target||current.status!=="published"||String(current.vector_store_space_id)!==String(target.vector_store_space_id))throw new Error("ROLLBACK_TARGET_INVALID");
      if(String(target.reviewer_identity)===publisherIdentity)throw new Error("ROLLBACK_SEPARATION_OF_DUTY_VIOLATION");
      return {guardedDigest:`sha256:${String(target.guarded_sha256)}`,vectorStoreSpaceId:String(target.vector_store_space_id)};
    });
  }

  async executeRollback(tenantId:string,operationId:string,currentPublicationId:string,targetPublicationId:string,expectedGuardedDigest:`sha256:${string}`,reason:string,publisherIdentity:string,idempotencyKey:string):Promise<string>{
    return this.database.transaction(tenantId,async(client)=>{
      const receipt=(await client.query<Row>(`select id from knowledge_service.receipt where tenant_id=$1 and operation_id=$2
        and receipt_kind='rollback.succeeded' and outcome='succeeded'`,[tenantId,operationId])).rows[0];
      if(!receipt)throw new Error("ROLLBACK_PLAN_RECEIPT_REQUIRED");
      const switchId=String((await client.query<Row>("select retrieval.rollback_vector_space($1,$2,$3,$4,$5,$6,$7) id",
        [currentPublicationId,targetPublicationId,expectedGuardedDigest.slice(7),reason,publisherIdentity,idempotencyKey,operationId])).rows[0]!.id);
      const authorizationId=deterministicUuid("authorized-publication",`${operationId}:${switchId}`);
      await client.query(`insert into retrieval.authorized_publication_execution
        (id,tenant_id,operation_id,switch_receipt_id,action,guarded_sha256,publisher_identity)
        values($1,$2,$3,$4,'rollback',$5,$6) on conflict(id) do nothing`,[authorizationId,tenantId,operationId,switchId,expectedGuardedDigest.slice(7),publisherIdentity]);
      return switchId;
    });
  }

  private async publicationContext(client:TenantSqlClient,tenantId:string,storeSpaceId:string,versionId:string,decisionId:string,evaluationId:string){
    const root=(await client.query<Row>(`select ss.authority_class,vs.owner_identity,vs.store_class,v.dims,v.precision,s.class space_class,
      d.guarded_sha256,d.reviewer_identity,g.passed from retrieval.vector_store_space ss
      join retrieval.vector_store vs on vs.tenant_id=ss.tenant_id and vs.id=ss.vector_store_id
      join retrieval.vector_space s on s.tenant_id=ss.tenant_id and s.id=ss.vector_space_id
      join retrieval.vector_space_version v on v.tenant_id=ss.tenant_id and v.id=$3 and v.vector_space_id=s.id
      join retrieval.content_promotion_decision d on d.tenant_id=ss.tenant_id and d.id=$4 and d.decision='accept' and (d.expires_at is null or d.expires_at>now())
      join evaluation.promotion_gate_result g on g.tenant_id=ss.tenant_id and g.id=$5 and g.passed
      where ss.tenant_id=$1 and ss.id=$2`,[tenantId,storeSpaceId,versionId,decisionId,evaluationId])).rows[0];
    if(!root||Number(root.dims)!==1536||String(root.precision)!=="halfvec")throw new Error("PUBLICATION_GATE_CONFIGURATION_REJECTED");
    const compatible=(root.store_class==="official"&&root.authority_class==="official"&&root.space_class==="canonical")
      ||(root.store_class==="exploratory"&&root.authority_class==="exploratory"&&root.space_class==="exploratory")
      ||(root.store_class==="user_managed"&&root.authority_class==="user_managed");
    if(!compatible)throw new Error("PUBLICATION_AUTHORITY_CLASS_MISMATCH");
    const rows=(await client.query<Row>(`select v.id,v.search_projection_id,v.content_sha256,v.embedding_item_id,e.output_sha256,x.embedding_sha256
      from retrieval.vector_item v join retrieval.embedding_item e on e.tenant_id=v.tenant_id and e.id=v.embedding_item_id
      join retrieval.embedding_run r on r.tenant_id=e.tenant_id and r.id=e.embedding_run_id and r.promotion_decision_id=$3
      join retrieval.vector_item_embedding_1536 x on x.tenant_id=v.tenant_id and x.vector_item_id=v.id and x.vector_space_version_id=v.space_version_id
      where v.tenant_id=$1 and v.space_version_id=$2 and v.verification_state='verified' and v.lifecycle='active'
        and exists(select 1 from retrieval.search_projection_chunk_support s where s.tenant_id=v.tenant_id and s.search_projection_id=v.search_projection_id)
      order by v.id`,[tenantId,versionId,decisionId])).rows;
    if(!rows.length)throw new Error("PUBLICATION_ITEMS_MISSING");
    const vectorManifest=digest(rows.map((row)=>({id:String(row.id),projectionId:String(row.search_projection_id),content:String(row.content_sha256),embeddingItemId:String(row.embedding_item_id),output:String(row.output_sha256)})));
    const embeddingManifest=digest(rows.map((row)=>({vectorItemId:String(row.id),embeddingItemId:String(row.embedding_item_id),output:String(row.embedding_sha256)})));
    const indexManifest=digest({backend:"pgvector-hnsw-halfvec",vectorSpaceVersionId:versionId,count:rows.length});
    return {count:rows.length,vectorManifest,embeddingManifest,indexManifest,guardedDigest:`sha256:${String(root.guarded_sha256)}` as `sha256:${string}`,
      ownerIdentity:String(root.owner_identity),reviewerIdentity:String(root.reviewer_identity)};
  }
}
