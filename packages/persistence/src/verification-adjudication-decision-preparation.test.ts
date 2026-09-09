import { describe, expect, it, vi } from "vitest";
import { PostgresVerificationAdjudicationDecisionPreparation } from "./verification-adjudication-decision-preparation.js";
import type { PostgresCanonicalRepository } from "./postgres.js";
import type { VerificationAdjudicationReadService } from "@aiengineer/knowledge-application";

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const scope={tenantId:id(1),subjectId:id(2),actor:{kind:"service" as const,id:id(3),serviceIdentity:"human_reviewer" as const}};
function fixture(rows: Record<string, unknown>[]=[]){
  const query=vi.fn().mockResolvedValue({rows,rowCount:rows.length});
  const transaction=vi.fn(async (_tenant:string, work:(client:unknown)=>Promise<unknown>)=>work({query}));
  const getPendingSubject=vi.fn();
  const make=(grants: ConstructorParameters<typeof PostgresVerificationAdjudicationDecisionPreparation>[2]=[])=>new PostgresVerificationAdjudicationDecisionPreparation({transaction} as unknown as Pick<PostgresCanonicalRepository,"transaction">,{getPendingSubject} as Pick<VerificationAdjudicationReadService,"getPendingSubject">,grants);
  return {query,transaction,getPendingSubject,make};
}
describe("canonical reviewer preparation adapter",()=>{
  it("defaults synthetic review to disabled and requires exact configured identity",async()=>{
    const f=fixture();expect(await f.make().authorizeReviewer(scope)).toBeUndefined();
    const adapter=f.make([{tenantId:id(1),actorId:id(3),role:"verification_expert"}]);
    expect(await adapter.authorizeReviewer(scope)).toEqual({provenance:"synthetic_engineering",role:"verification_expert"});
    expect(await adapter.authorizeReviewer({...scope,tenantId:id(9)})).toBeUndefined();
    expect(await adapter.authorizeReviewer({...scope,actor:{kind:"model",id:id(3),serviceIdentity:"inspection_agent",model:"synthetic-test",providerRunId:"fixture"}})).toBeUndefined();
    expect(f.transaction).not.toHaveBeenCalled();
  });
  it("reads human grants using authenticated tenant, subject and actor",async()=>{
    const f=fixture([{id:id(4),reviewer_role:"verification_expert",expires_at:new Date("2026-09-09T00:00:00Z")}]);
    const result=await f.make().authorizeReviewer({...scope,actor:{kind:"human",id:id(3)}});
    expect(result).toEqual({provenance:"human_origin",grantId:id(4),role:"verification_expert",expiresAt:"2026-09-09T00:00:00.000Z"});
    expect(f.query).toHaveBeenCalledWith(expect.stringContaining("g.expires_at>clock_timestamp()"),[id(1),id(2),id(3)]);
    expect(f.transaction).toHaveBeenCalledWith(id(1),expect.any(Function));
    expect(await fixture().make().authorizeReviewer({...scope,actor:{kind:"human",id:id(3)}})).toBeUndefined();
  });
  it("fails closed on absent subjects and reuses the verified reader with exact operation binding",async()=>{
    const f=fixture([{request_operation_id:id(5)}]);
    const resource={tenantId:id(1),operationId:id(5),output:{subjectId:id(2)}};
    f.getPendingSubject.mockResolvedValue(resource);
    expect(await f.make().loadVerifiedSubject(scope)).toBe(resource);
    expect(f.getPendingSubject).toHaveBeenCalledWith({tenantId:id(1),operationId:id(5)});
    f.getPendingSubject.mockResolvedValue({...resource,operationId:id(9)});
    await expect(f.make().loadVerifiedSubject(scope)).rejects.toMatchObject({code:"BINDING"});
    await expect(fixture().make().loadVerifiedSubject(scope)).rejects.toMatchObject({code:"BINDING"});
  });
});
