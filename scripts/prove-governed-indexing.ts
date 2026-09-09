import { randomUUID } from "node:crypto";
import { readFile,writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { OperationContext,OperationKind } from "@aiengineer/knowledge-contracts";
import { DeterministicFakeEmbeddingAdapter } from "@aiengineer/knowledge-embeddings";
import { canonicalJson,sha256Digest } from "@aiengineer/knowledge-domain";
import { canonicalPersistenceConfigFromEnvironment,createCanonicalPersistence,PostgresGovernedIndexRepository,PostgresKnowledgeOperationService } from "@aiengineer/knowledge-persistence";
import { deterministicUuid } from "@aiengineer/knowledge-runtime";
import { createCanonicalActivityExecutor,createProductionActivityRegistry } from "../apps/worker/src/activity-registry.js";
import { CanonicalDurableKnowledgeWorker } from "../apps/worker/src/canonical-worker.js";

const tenantId=process.env.WORKER_TENANT_ID?.trim()||"00000000-0000-7000-8000-000000000001";
const config=canonicalPersistenceConfigFromEnvironment(process.env);
if(!config.postgres.localOnly)throw new Error("GOVERNED_INDEXING_PROOF_REQUIRES_CANONICAL_LOCAL_ONLY");
const database=createCanonicalPersistence(config).database;
const governance=new PostgresGovernedIndexRepository(database),operations=new PostgresKnowledgeOperationService(database);
const embeddings=new DeterministicFakeEmbeddingAdapter(1536);
const registry=createProductionActivityRegistry({retrieval:database,review:database,governedIndex:{repository:governance,embeddingAdapter:embeddings,embeddingAdapterVersion:"deterministic-fake/v1"}});
const worker=new CanonicalDurableKnowledgeWorker(`governed-index-proof-${process.pid}`,tenantId,database,createCanonicalActivityExecutor(database,registry),30_000,registry.operationKinds());
const namespace=randomUUID(),proof=JSON.parse(await readFile(resolve("catalog/durable-preparation-proof.json"),"utf8")) as any;
const representationId=String(proof.transformation.representationId),representationDigest=String(proof.transformation.structuralArtifactDigest) as `sha256:${string}`;
const chunkSetId=String(proof.chunkSet.chunkSetId);
const curatorId=randomUUID(),reviewerId=randomUUID(),controlPlaneId=randomUUID(),embeddingExecutorId=randomUUID();
const procedureId=deterministicUuid("governed-proof",`${namespace}:procedure`),vectorSpaceId=deterministicUuid("governed-proof",`${namespace}:space`),
  vectorStoreId=deterministicUuid("governed-proof",`${namespace}:store`),storeSpaceId=deterministicUuid("governed-proof",`${namespace}:store-space`),
  gateVersionId=deterministicUuid("governed-proof",`${namespace}:gate`),datasetId=deterministicUuid("governed-proof",`${namespace}:dataset`);
const versionId=(version:number)=>deterministicUuid("governed-proof",`${namespace}:version:${version}`);
const gateResultId=(version:number)=>deterministicUuid("governed-proof",`${namespace}:gate-result:${version}`);

function context(kind:OperationKind,authority:"curator"|"reviewer"|"embedding"|"control"):OperationContext{
  const actor=authority==="curator"?{kind:"model" as const,id:curatorId,serviceIdentity:"content_curator_agent" as const,model:"governed-proof-curator",providerRunId:namespace}
    :authority==="reviewer"?{kind:"service" as const,id:reviewerId,serviceIdentity:"human_reviewer" as const}
    :authority==="embedding"?{kind:"service" as const,id:embeddingExecutorId,serviceIdentity:"embedding_executor" as const}
    :{kind:"service" as const,id:controlPlaneId,serviceIdentity:"control_plane" as const};
  const operationId=randomUUID();return {tenantId,operationId,attemptId:randomUUID(),correlationId:namespace,actor,
    capabilityVersion:"governed-index-proof/1.0.0",idempotencyKey:`governed:${namespace}:${kind}:${operationId}`,reason:"local Gate 2-3 governed indexing proof",contractVersion:"v1"};
}
async function execute(kind:OperationKind,ctx:OperationContext,input:unknown,steps:number){
  const envelope={context:ctx,input,expectedVersions:{api:"v1",worker:"governed-index/v1"}};await operations.submit(kind,envelope,"http://127.0.0.1:4100");
  for(let i=0;i<steps;i++)if(!await worker.runOperationOnce(ctx.operationId))throw new Error(`GOVERNED_STEP_NOT_CLAIMED:${kind}:${i}`);
  const status=await operations.get(ctx.operationId,tenantId);if(status?.state!=="succeeded")throw new Error(`GOVERNED_OPERATION_FAILED:${kind}`);
  const receipts=await database.listReceipts(tenantId,ctx.operationId);if(receipts.length!==steps)throw new Error(`GOVERNED_RECEIPT_COUNT:${kind}`);
  await operations.submit(kind,envelope,"http://127.0.0.1:4100");if((await database.listReceipts(tenantId,ctx.operationId)).length!==steps)throw new Error(`GOVERNED_REPLAY_DUPLICATED:${kind}`);
  return {status,receipts};
}
async function expectOperationFailure(kind:OperationKind,ctx:OperationContext,input:unknown){
  await operations.submit(kind,{context:ctx,input,expectedVersions:{api:"v1",worker:"governed-index/v1"}},"http://127.0.0.1:4100");
  let status=await operations.get(ctx.operationId,tenantId);
  for(let attempt=0;attempt<5&&status?.state!=="failed";attempt++){
    let claimed=true;
    try{claimed=Boolean(await worker.runOperationOnce(ctx.operationId));}catch{/* terminal errors are also surfaced to the executor */}
    if(!claimed)break;
    status=await operations.get(ctx.operationId,tenantId);
  }
  if(status?.state!=="failed")throw new Error(`NEGATIVE_OPERATION_DID_NOT_FAIL:${kind}`);
}
async function expectReject(label:string,action:()=>Promise<unknown>){
  try{await action();}catch{return true;}
  throw new Error(`NEGATIVE_DRILL_DID_NOT_REJECT:${label}`);
}
const body=(result:Awaited<ReturnType<typeof execute>>,kind:string)=>result.receipts.find((item)=>item.receiptKind===kind)?.body as Record<string,any>;

try{
  await database.transaction(tenantId,async(client)=>{
    await client.query(`insert into retrieval.projection_procedure(id,slug,version,description,code_ref,implementation_sha256,projection_policy)
      values($1,$2,1,'faithful chunk projection','packages/persistence/src/governance.ts',$3,$4::jsonb)`,[procedureId,`governed-${namespace}`,sha256Digest("governed-projection/v1").slice(7),JSON.stringify({faithful:true})]);
    await client.query("insert into retrieval.vector_space(id,tenant_id,slug,purpose,class) values($1,$2,$3,'Gate 2-3 proof','exploratory')",[vectorSpaceId,tenantId,`governed-${namespace}`]);
    await client.query(`insert into retrieval.vector_store(id,tenant_id,owner_identity,store_class,slug,name,purpose,visibility)
      values($1,$2,$3,'exploratory',$4,'Governed proof','Gate 2-3 proof','internal')`,[vectorStoreId,tenantId,controlPlaneId,`governed-${namespace}`]);
    await client.query("insert into retrieval.vector_store_space(id,tenant_id,vector_store_id,vector_space_id,authority_class) values($1,$2,$3,$4,'exploratory')",[storeSpaceId,tenantId,vectorStoreId,vectorSpaceId]);
    await client.query("insert into evaluation.eval_dataset(id,tenant_id,slug,purpose) values($1,$2,$3,'Gate 2-3 proof')",[datasetId,tenantId,`governed-${namespace}`]);
    await client.query("insert into evaluation.promotion_gate_version(id,tenant_id,slug,version,definition,definition_sha256) values($1,$2,$3,1,$4::jsonb,$5)",
      [gateVersionId,tenantId,`governed-${namespace}`,JSON.stringify({minimumItems:1,falseAcceptanceCount:0}),sha256Digest({minimumItems:1,falseAcceptanceCount:0}).slice(7)]);
    for(const version of [1,2]){
      const v=versionId(version),runId=deterministicUuid("governed-proof",`${namespace}:eval:${version}`);
      await client.query(`insert into retrieval.vector_space_version
        (id,tenant_id,vector_space_id,version,embedding_model,dims,projection_procedure_id,backend,precision,index_configuration,provider_routing_policy)
        values($1,$2,$3,$4,'deterministic-fake/local-proof',1536,$5,'pgvector','halfvec',$6::jsonb,$7::jsonb)`,[v,tenantId,vectorSpaceId,version,procedureId,
          JSON.stringify({type:"hnsw",operator:"halfvec_cosine_ops"}),JSON.stringify({ordered:["deterministic-fake"]})]);
      await client.query("insert into evaluation.eval_run(id,tenant_id,dataset_id,space_version_id,config) values($1,$2,$3,$4,$5::jsonb)",[runId,tenantId,datasetId,v,JSON.stringify({proof:true,version})]);
      await client.query(`insert into evaluation.promotion_gate_result(id,tenant_id,gate_version_id,eval_run_id,passed,false_acceptance_count,observations,result_sha256)
        values($1,$2,$3,$4,true,0,$5::jsonb,$6)`,[gateResultId(version),tenantId,gateVersionId,runId,JSON.stringify({proof:true,itemCount:1}),sha256Digest({passed:true,version}).slice(7)]);
    }
  });

  const representationReviewSubjectId=deterministicUuid("representation-review",`${representationId}:${representationDigest}`);
  await expectOperationFailure("representation_decision",context("representation_decision","curator"),{schemaVersion:"knowledge.representation-decision/v1",
    representationId,reviewSubjectId:representationReviewSubjectId,guardedDigest:representationDigest,decision:"accept",policyVersion:"proof-review/v1",
    rationale:"A model must never be able to approve its own output."});
  await expectOperationFailure("representation_decision",context("representation_decision","control"),{schemaVersion:"knowledge.representation-decision/v1",
    representationId,reviewSubjectId:representationReviewSubjectId,guardedDigest:representationDigest,decision:"accept",policyVersion:"proof-review/v1",
    rationale:"An input role string must not confer reviewer authority.",reviewerRole:"human_reviewer"});
  const representationContext=context("representation_decision","reviewer");
  const representationDecision=body(await execute("representation_decision",representationContext,{schemaVersion:"knowledge.representation-decision/v1",representationId,
    reviewSubjectId:representationReviewSubjectId,guardedDigest:representationDigest,decision:"accept",policyVersion:"proof-review/v1",rationale:"Fixture reviewer service accepts exact high-fidelity representation."},1),"decide.succeeded");

  const proposalContext=context("promotion_proposal","curator");
  const proposed=body(await execute("promotion_proposal",proposalContext,{schemaVersion:"knowledge.promotion-proposal/v1",chunkSetId,
    representationDecisionId:representationDecision.decisionId,projectionProcedureId:procedureId,purpose:"faithful retrieval of the captured source",
    contextualPrefix:"Governed durable preparation proof",language:"en",visibility:"internal",classification:"internal",targetDomains:["source_native_sections"],
    expectedValue:"Verify the governed preparation and indexing path",risks:["local deterministic embedding"],exclusions:["official publication"],reason:"Gate 2-3 acceptance proof"},1),"propose.succeeded");

  await expectOperationFailure("promotion_decision",context("promotion_decision","curator"),{schemaVersion:"knowledge.promotion-decision/v1",proposalId:proposed.proposalId,
    reviewSubjectId:proposed.reviewSubjectId,guardedDigest:proposed.proposalDigest,decision:"accept",gates:{representationAccepted:true,faithfulSupport:true},
    policyVersion:"proof-promotion/v1",rationale:"The proposal author must not approve the proposal."});
  await expectOperationFailure("promotion_decision",context("promotion_decision","reviewer"),{schemaVersion:"knowledge.promotion-decision/v1",proposalId:proposed.proposalId,
    reviewSubjectId:proposed.reviewSubjectId,guardedDigest:sha256Digest("substituted proposal"),decision:"accept",gates:{representationAccepted:true,faithfulSupport:true},
    policyVersion:"proof-promotion/v1",rationale:"A decision over a substituted digest must fail."});

  const decisionContext=context("promotion_decision","reviewer");
  const decided=body(await execute("promotion_decision",decisionContext,{schemaVersion:"knowledge.promotion-decision/v1",proposalId:proposed.proposalId,
    reviewSubjectId:proposed.reviewSubjectId,guardedDigest:proposed.proposalDigest,decision:"accept",gates:{representationAccepted:true,faithfulSupport:true},
    policyVersion:"proof-promotion/v1",rationale:"Fixture reviewer service accepts only this guarded exploratory proposal."},1),"decide.succeeded");

  const publications=[] as Record<string,any>[];let immediateRetrieval:any;
  for(const version of [1,2]){
    if(version===1)await expectOperationFailure("embedding_run",context("embedding_run","embedding"),{schemaVersion:"knowledge.embedding-run/v1",
      vectorSpaceVersionId:versionId(version),promotionDecisionId:decided.decisionId,projectionIds:proposed.projectionIds,providerRoute:["deterministic-fake"],
      expectedDimensions:1535,modelSlug:"deterministic-fake/local-proof"});
    const embeddingContext=context("embedding_run","embedding");
    const embedded=body(await execute("embedding_run",embeddingContext,{schemaVersion:"knowledge.embedding-run/v1",vectorSpaceVersionId:versionId(version),
      promotionDecisionId:decided.decisionId,projectionIds:proposed.projectionIds,providerRoute:["deterministic-fake"],expectedDimensions:1536,
      modelSlug:"deterministic-fake/local-proof"},2),"verify.succeeded");
    if(version===1){
      const replayEnvelope={context:embeddingContext,input:{schemaVersion:"knowledge.embedding-run/v1",vectorSpaceVersionId:versionId(version),
        promotionDecisionId:decided.decisionId,projectionIds:proposed.projectionIds,providerRoute:["deterministic-fake"],expectedDimensions:1536,
        modelSlug:"substituted-model"},expectedVersions:{api:"v1",worker:"governed-index/v1"}};
      await expectReject("operation replay substitution",()=>operations.submit("embedding_run",replayEnvelope,"http://127.0.0.1:4100"));
      await expectOperationFailure("space_publication",context("space_publication","control"),{schemaVersion:"knowledge.space-publication/v1",
        vectorStoreSpaceId:storeSpaceId,vectorSpaceVersionId:versionId(version),promotionDecisionId:decided.decisionId,evaluationResultId:gateResultId(version),
        expectedOwnerIdentity:randomUUID(),guardedDigest:proposed.proposalDigest,reason:"A mismatched store owner must fail closed."});
    }
    const publicationContext=context("space_publication","control");
    const published=body(await execute("space_publication",publicationContext,{schemaVersion:"knowledge.space-publication/v1",vectorStoreSpaceId:storeSpaceId,
      vectorSpaceVersionId:versionId(version),promotionDecisionId:decided.decisionId,evaluationResultId:gateResultId(version),expectedOwnerIdentity:controlPlaneId,
      guardedDigest:proposed.proposalDigest,reason:`publish governed proof version ${version}`},2),"verify.succeeded");
    publications.push({...published,embeddingRunId:embedded.embeddingRunId});
    const query=(await embeddings.embedMany({vectorSpaceVersionId:versionId(version),idempotencyKey:`query:${namespace}:${version}`,expectedDimensions:1536,
      modelSlug:"deterministic-fake/local-proof",inputs:[{projectionId:"query",text:"governed durable preparation proof"}]})).items[0]!.embedding;
    const [ann,exact]=await Promise.all([database.annNearest({tenantId,vectorSpaceVersionId:versionId(version),queryEmbedding:query,resultLimit:5}),
      database.exactNearest({tenantId,vectorSpaceVersionId:versionId(version),queryEmbedding:query,resultLimit:5})]);
    if(!ann.length||!exact.length||ann[0]!.vectorItemId!==exact[0]!.vectorItemId)throw new Error("IMMEDIATE_RETRIEVAL_VERIFICATION_FAILED");
    immediateRetrieval={version,annTop:ann[0]!.vectorItemId,exactTop:exact[0]!.vectorItemId};
  }

  const rollbackContext=context("publication_rollback","control");
  const rolledBack=body(await execute("publication_rollback",rollbackContext,{schemaVersion:"knowledge.publication-rollback/v1",
    currentPublicationId:publications[1]!.publicationId,targetPublicationId:publications[0]!.publicationId,guardedDigest:proposed.proposalDigest,
    reason:"rehearse rollback and rebuild the prior immutable publication"},2),"verify.succeeded");
  const state=await database.transaction(tenantId,async(client)=>(await client.query<any>(`select s.active_space_version_id,
    (select count(*)::int from retrieval.authorized_publication_execution a join retrieval.publication_switch_receipt r
      on r.tenant_id=a.tenant_id and r.id=a.switch_receipt_id where a.tenant_id=$1 and r.vector_store_space_id=$2) authorized_count,
    (select count(*)::int from retrieval.search_projection_chunk_support where tenant_id=$1 and search_projection_id=any($3::uuid[])) support_count
    from retrieval.vector_store_space s where s.tenant_id=$1 and s.id=$2`,[tenantId,storeSpaceId,proposed.projectionIds])).rows[0]);
  if(String(state.active_space_version_id)!==versionId(1)||Number(state.authorized_count)!==3||Number(state.support_count)<1)throw new Error("ROLLBACK_REBUILD_VERIFICATION_FAILED");

  const core={schemaVersion:"governed-indexing-proof/1.0.0",tenantId,namespace,storeClass:"exploratory",representationDecisionId:representationDecision.decisionId,
    proposalId:proposed.proposalId,proposalDigest:proposed.proposalDigest,promotionDecisionId:decided.decisionId,projectionIds:proposed.projectionIds,
    publications,rollback:rolledBack,immediateRetrieval,activeSpaceVersionId:state.active_space_version_id,
    invariants:{curatorDidNotDecide:curatorId!==reviewerId,reviewerDidNotPublish:reviewerId!==controlPlaneId,faithfulChunkSupport:Number(state.support_count)>=1,
      fixedDimensions:true,atomicActivePointer:String(state.active_space_version_id)===versionId(1),authorizedSwitchLedger:Number(state.authorized_count)===3,
      rollbackCreatedRebuild:rolledBack.rebuilt===true,modelDecisionRejected:true,forgedRoleRejected:true,selfApprovalRejected:true,digestMismatchRejected:true,
      wrongDimensionsRejected:true,wrongStoreOwnershipRejected:true,replaySubstitutionRejected:true},completedAt:new Date().toISOString()};
  if(Object.values(core.invariants).some((value)=>value!==true))throw new Error("GOVERNED_INDEXING_INVARIANT_FAILED");
  const receipt={...core,receiptDigest:sha256Digest(JSON.parse(JSON.stringify(core)))};const output=resolve("catalog/governed-indexing-proof.json");
  await writeFile(output,`${canonicalJson(JSON.parse(JSON.stringify(receipt)))}\n`);process.stdout.write(`${JSON.stringify({ok:true,output,receiptDigest:receipt.receiptDigest,...core.invariants})}\n`);
}finally{await database.close();}
