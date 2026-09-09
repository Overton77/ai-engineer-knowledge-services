import { VerificationAdjudicationDecisionError, VerificationAdjudicationDecisionPreparationService } from "@aiengineer/knowledge-application";
import { ActorSchema, UuidSchema, type Actor, type OperationContext, type VerificationAdjudicationDecisionRequest } from "@aiengineer/knowledge-contracts";
import { PostgresVerificationAdjudicationDecisionPreparation, PostgresVerificationAdjudicationDecisionReadRepository, PostgresVerificationRepository, type PostgresCanonicalRepository } from "@aiengineer/knowledge-persistence";
import { SupabaseArtifactStore } from "@aiengineer/knowledge-runtime";
import { z } from "zod";
import { allowsVerificationAdjudicationReadArtifact, createVerificationAdjudicationReads } from "./verification-adjudication-reads-runtime.js";
import { createVerificationOperationReadAuthorizer } from "./verification-ownership.js";

type Environment = Readonly<Record<string,string|undefined>>;
const grantsSchema=z.array(z.strictObject({tenantId:UuidSchema,actorId:UuidSchema,role:z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u)})).max(256).refine(grants=>new Set(grants.map(grant=>`${grant.tenantId}:${grant.actorId}`)).size===grants.length,"duplicate reviewer authority");

/** Decision intake remains opt-in. Review authority is resolved on the server;
 * the worker rechecks it under its commit lease. This never changes admission. */
export function createVerificationAdjudicationDecisionRuntime(database:PostgresCanonicalRepository|undefined,environment:Environment){
 const enabled=environment.VERIFICATION_ADJUDICATION_DECISIONS_ENABLED?.trim();
 const raw=environment.VERIFICATION_ADJUDICATION_SYNTHETIC_REVIEWER_GRANTS_JSON?.trim();
 if(enabled!==undefined&&enabled!=="0"&&enabled!=="1")throw new Error("VERIFICATION_ADJUDICATION_DECISIONS_ENABLED_INVALID");
 if(enabled!=="1"){
  if(raw)throw new Error("VERIFICATION_ADJUDICATION_DECISIONS_DISABLED_WITH_GRANTS");
  return undefined;
 }
 if(!database||!environment.VERIFICATION_SERVICE_OWNERSHIP_GRANTS_JSON?.trim())throw new Error("VERIFICATION_ADJUDICATION_DECISION_RUNTIME_REQUIRED");
 if(raw&&Buffer.byteLength(raw)>262_144)throw new Error("VERIFICATION_ADJUDICATION_DECISION_GRANTS_TOO_LARGE");
 let grants:z.infer<typeof grantsSchema>;
 try{grants=grantsSchema.parse(raw?JSON.parse(raw):[]);}catch{throw new Error("VERIFICATION_ADJUDICATION_DECISION_GRANTS_INVALID");}
 const subjects=createVerificationAdjudicationReads(database,environment);
 if(!subjects)throw new Error("VERIFICATION_ADJUDICATION_DECISION_SIGNED_READER_REQUIRED");
 const authorize=createVerificationOperationReadAuthorizer(database,environment.VERIFICATION_SERVICE_OWNERSHIP_GRANTS_JSON,["verification_adjudication_decision"]);
 const store=new SupabaseArtifactStore({projectUrl:environment.SUPABASE_URL!.trim(),serviceRoleKey:environment.SUPABASE_SECRET_KEY!.trim(),bucket:environment.VERIFICATION_STORAGE_BUCKET?.trim()||"ai-engineer-cloud-bucket",maximumBytes:32_000_000});
 const scopedSubjects=(actor:Actor)=>({getPendingSubject:(input:{tenantId:string;operationId:string})=>subjects.getPendingSubject({...input,actor})});
 return {
  isAdjudicationDecisionReadAdmitted:authorize,
  verificationAdjudicationDecisionReadService:{async getDecision(input:{tenantId:string;operationId:string;actor:Actor}){
   const scope={tenantId:UuidSchema.parse(input.tenantId),operationId:UuidSchema.parse(input.operationId),actor:ActorSchema.parse(input.actor)};
   if(!await authorize(scope))throw Object.assign(new Error("VERIFICATION_DECISION_NOT_FOUND"),{code:"NOT_FOUND"});
   const repository=new PostgresVerificationRepository(database,store,{async authorize(request){if(!allowsVerificationAdjudicationReadArtifact(request,scope.tenantId))throw new Error("VERIFICATION_DECISION_ARTIFACT_DENIED");}});
   return new PostgresVerificationAdjudicationDecisionReadRepository(database,()=>repository.createTrustedArtifactResolver(),scopedSubjects(scope.actor)).getDecision(scope);
  }},
  async isAdjudicationDecisionAdmitted(input:{request:VerificationAdjudicationDecisionRequest;context:OperationContext}){
   const preparation=new VerificationAdjudicationDecisionPreparationService(new PostgresVerificationAdjudicationDecisionPreparation(database,scopedSubjects(input.context.actor),grants));
   try{await preparation.prepare({...input,signal:AbortSignal.timeout(120_000)});return true;}
   catch(error){if(error instanceof VerificationAdjudicationDecisionError||error instanceof Error&&"code" in error&&error.code==="NOT_FOUND")return false;throw error;}
  },
 };
}
