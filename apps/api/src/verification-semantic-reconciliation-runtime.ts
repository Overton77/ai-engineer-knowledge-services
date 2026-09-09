import {z} from "zod";
import {ActorSchema,UuidSchema,VerificationArtifactHandleSchema,type Actor,type VerificationArtifactHandle} from "@aiengineer/knowledge-contracts";
import {actorsMatch} from "@aiengineer/knowledge-config";
import {SemanticProviderReconciliationAdmission} from "@aiengineer/knowledge-application";
import {loadNativeSemanticReconciliationBinding,PostgresSemanticProviderReconciliationStore,PostgresSemanticProviderReconciliationReadRepository,PostgresVerificationRepository,type PostgresCanonicalRepository} from "@aiengineer/knowledge-persistence";
import {SupabaseArtifactStore} from "@aiengineer/knowledge-runtime";
import {createEd25519Verifier} from "@aiengineer/knowledge-verification";
import {createVerificationOperationReadAuthorizer} from "./verification-ownership.js";
import {parseBenchmarkReadPublicKeys} from "./verification-benchmark-reads-runtime.js";

const grantSchema=z.strictObject({tenantId:UuidSchema,actor:ActorSchema,operationId:UuidSchema,providerAttemptId:UuidSchema,
  keyId:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u),operatorId:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u),
  executionMode:z.enum(["synthetic_transport","live_provider"]),billingEvidenceArtifact:VerificationArtifactHandleSchema});
const denied=()=>Object.assign(new Error("RECONCILIATION_NOT_FOUND"),{code:"NOT_FOUND"});
type Scope={tenantId:string;operationId:string;providerAttemptId:string;host:"claims"|"report";actor:Actor};

/** Exact accounting grants supplement original mission ownership; receipts cannot authorize themselves. */
export function createVerificationSemanticReconciliationService(database:PostgresCanonicalRepository|undefined,environment:Readonly<Record<string,string|undefined>>){
  const raw=environment.VERIFICATION_SEMANTIC_PROVIDER_RECONCILIATION_GRANTS_JSON?.trim();if(!raw)return undefined;
  if(Buffer.byteLength(raw)>262_144)throw new Error("SEMANTIC_RECONCILIATION_CONFIG_TOO_LARGE");
  const grants=z.array(grantSchema).min(1).max(256).parse(JSON.parse(raw));
  const identities=grants.map(g=>[g.tenantId,g.actor.kind,g.actor.id,g.operationId,g.providerAttemptId,g.keyId,g.operatorId].join(":"));
  if(new Set(identities).size!==identities.length||grants.some(g=>g.billingEvidenceArtifact.tenantId!==g.tenantId))throw new Error("SEMANTIC_RECONCILIATION_GRANT_INVALID");
  const keys=environment.VERIFICATION_PROVIDER_RECONCILIATION_PUBLIC_KEYS_JSON?.trim(),ownership=environment.VERIFICATION_SERVICE_OWNERSHIP_GRANTS_JSON?.trim();
  const projectUrl=environment.SUPABASE_URL?.trim(),serviceRoleKey=environment.SUPABASE_SECRET_KEY?.trim();
  if(!database||!keys||!ownership||!projectUrl||!serviceRoleKey)throw new Error("SEMANTIC_RECONCILIATION_STORAGE_KEYS_OWNERSHIP_REQUIRED");
  const verifier=createEd25519Verifier(parseBenchmarkReadPublicKeys(keys));
  const authorizers={claims:createVerificationOperationReadAuthorizer(database,ownership,["verification_claims"]),report:createVerificationOperationReadAuthorizer(database,ownership,["verification_report"])};
  const storage=new SupabaseArtifactStore({projectUrl,serviceRoleKey,bucket:environment.VERIFICATION_STORAGE_BUCKET?.trim()||"ai-engineer-cloud-bucket",maximumBytes:1_000_000});
  const control:Pick<PostgresCanonicalRepository,"transaction">={transaction:async(tenant,work)=>database.transaction(tenant,async client=>{await client.query("set local role control_plane");return work(client);})};
  async function scope(input:Scope){
    const scoped={tenantId:UuidSchema.parse(input.tenantId),operationId:UuidSchema.parse(input.operationId),providerAttemptId:UuidSchema.parse(input.providerAttemptId),host:z.enum(["claims","report"]).parse(input.host),actor:ActorSchema.parse(input.actor)};
    const matched=grants.filter(g=>g.tenantId===scoped.tenantId&&g.operationId===scoped.operationId&&g.providerAttemptId===scoped.providerAttemptId&&actorsMatch(g.actor,scoped.actor));
    if(!matched.length||!await authorizers[scoped.host](scoped))throw denied();
    const repository=new PostgresVerificationRepository(database!,storage,{async authorize(request){if(request.tenantId!==scoped.tenantId||!["verification_replay","verification_admission"].includes(request.purpose))throw denied();}});
    const factory=()=>repository.createTrustedArtifactResolver();
    const admission=new SemanticProviderReconciliationAdmission({grants:matched.map(({actor,...grant})=>grant),createResolver:factory,verifier,
      loadOriginalBinding:async(tenantId,providerAttemptId)=>{
        if(tenantId!==scoped.tenantId||providerAttemptId!==scoped.providerAttemptId)throw denied();
        const binding=await loadNativeSemanticReconciliationBinding({database:control,repository,tenantId,providerAttemptId,allowReconciled:true});
        if(binding.operationId!==scoped.operationId||binding.host!==scoped.host)throw denied();return binding;
      }});
    return{scoped,repository,factory,admission};
  }
  return{
    async applyDecision(input:Scope&{artifact:VerificationArtifactHandle}){
      const artifact=VerificationArtifactHandleSchema.parse(input.artifact),{scoped,repository,admission}=await scope(input);
      if(artifact.tenantId!==scoped.tenantId)throw denied();
      const permit=await admission.admit({tenantId:scoped.tenantId,artifact});
      if(permit.receipt.operationId!==scoped.operationId||permit.receipt.providerAttemptId!==scoped.providerAttemptId||permit.receipt.host!==scoped.host)throw denied();
      return new PostgresSemanticProviderReconciliationStore({database:control,repository,admission}).apply(permit);
    },
    async getDecision(input:Scope){
      const {scoped,admission,factory}=await scope(input);
      return new PostgresSemanticProviderReconciliationReadRepository(control,admission,factory).loadAppliedDecision(scoped.tenantId,scoped.operationId,scoped.providerAttemptId);
    },
  };
}
