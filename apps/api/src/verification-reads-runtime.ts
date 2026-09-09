import { VerificationCaseReadService, VerificationRunReadService } from "@aiengineer/knowledge-application";
import { PostgresVerificationCaseReads, PostgresVerificationRepository, type PostgresCanonicalRepository } from "@aiengineer/knowledge-persistence";
import { SupabaseArtifactStore } from "@aiengineer/knowledge-runtime";

export function createVerificationReads(database:PostgresCanonicalRepository|undefined,environment:Readonly<Record<string,string|undefined>>){
  const enabled=environment.VERIFICATION_READS_ENABLED?.trim();
  if(enabled&&enabled!=="0"&&enabled!=="1")throw new Error("INVALID_VERIFICATION_READS_ENABLED");
  if(enabled!=="1")return undefined;
  const projectUrl=environment.SUPABASE_URL?.trim(),serviceRoleKey=environment.SUPABASE_SECRET_KEY?.trim();
  if(!database||!projectUrl||!serviceRoleKey)throw new Error("VERIFICATION_READS_STORAGE_REQUIRED");
  const store=new SupabaseArtifactStore({projectUrl,serviceRoleKey,bucket:environment.VERIFICATION_STORAGE_BUCKET?.trim()||"ai-engineer-cloud-bucket",maximumBytes:4_194_304});
  const audits={async loadAuditBundle(tenantId:string,runId:string){
    // The caller is the authenticated read application. Give each request its
    // own authorization closure and one-use hydration tickets.
    const repository=new PostgresVerificationRepository(database,store,{async authorize(input){
      if(input.tenantId!==tenantId||input.purpose!=="verification_replay")throw new Error("VERIFICATION_READ_ARTIFACT_DENIED");
    }});
    return repository.loadAuditBundle(tenantId,runId);
  }};
  return Object.assign(new VerificationRunReadService(audits),{cases:new VerificationCaseReadService(new PostgresVerificationCaseReads(database,audits))});
}
