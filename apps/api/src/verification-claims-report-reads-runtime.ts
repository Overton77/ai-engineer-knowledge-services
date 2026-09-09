import { VerificationClaimsReportReadService } from "@aiengineer/knowledge-application";
import { UuidSchema,type Actor,type VerificationClaimsTerminalResource,type VerificationReportTerminalResource } from "@aiengineer/knowledge-contracts";
import { PostgresClaimsReportReadRepository,PostgresVerificationRepository,type PostgresCanonicalRepository } from "@aiengineer/knowledge-persistence";
import { SupabaseArtifactStore } from "@aiengineer/knowledge-runtime";
import { createEd25519Verifier } from "@aiengineer/knowledge-verification";
import { parseBenchmarkReadPublicKeys } from "./verification-benchmark-reads-runtime.js";
import { createVerificationOperationReadAuthorizer } from "./verification-ownership.js";

type ReadInput={tenantId:string;operationId:string;actor:Actor};

/** Composes trusted keys, operation ownership, registered Storage, and the strict native reader. */
export function createVerificationClaimsReportReads(database:PostgresCanonicalRepository|undefined,environment:Readonly<Record<string,string|undefined>>){
  const raw=environment.VERIFICATION_CLAIMS_REPORT_READ_PUBLIC_KEYS_JSON?.trim();
  if(!raw)return undefined;
  const verifier=createEd25519Verifier(parseBenchmarkReadPublicKeys(raw));
  const projectUrl=environment.SUPABASE_URL?.trim(),serviceRoleKey=environment.SUPABASE_SECRET_KEY?.trim(),grants=environment.VERIFICATION_SERVICE_OWNERSHIP_GRANTS_JSON?.trim();
  if(!database||!projectUrl||!serviceRoleKey||!grants)throw new Error("VERIFICATION_CLAIMS_REPORT_READS_STORAGE_AND_OWNERSHIP_REQUIRED");
  const authorize=createVerificationOperationReadAuthorizer(database,grants,["verification_claims","verification_report"]);
  const store=new SupabaseArtifactStore({projectUrl,serviceRoleKey,bucket:environment.VERIFICATION_STORAGE_BUCKET?.trim()||"ai-engineer-cloud-bucket",maximumBytes:32_000_000});
  const get=async(input:ReadInput)=>{
    const scoped={tenantId:UuidSchema.parse(input.tenantId),operationId:UuidSchema.parse(input.operationId),actor:structuredClone(input.actor)};
    if(!await authorize(scoped))throw Object.assign(new Error("VERIFICATION_CLAIMS_REPORT_NOT_FOUND"),{code:"NOT_FOUND"});
    const repository=new PostgresVerificationRepository(database,store,{async authorize(request){if(request.tenantId!==scoped.tenantId||request.purpose!=="verification_replay")throw new Error("VERIFICATION_CLAIMS_REPORT_READ_DENIED");}});
    return new VerificationClaimsReportReadService(new PostgresClaimsReportReadRepository(database,()=>repository.createTrustedArtifactResolver(),verifier)).getTerminal(scoped);
  };
  return{
    async getClaims(input:ReadInput):Promise<VerificationClaimsTerminalResource>{const result=await get(input);if(result.useCase!=="verifyClaims")throw Object.assign(new Error("VERIFICATION_CLAIMS_NOT_FOUND"),{code:"NOT_FOUND"});return result;},
    async getReport(input:ReadInput):Promise<VerificationReportTerminalResource>{const result=await get(input);if(result.useCase!=="verifyReport")throw Object.assign(new Error("VERIFICATION_REPORT_NOT_FOUND"),{code:"NOT_FOUND"});return result;},
  };
}
