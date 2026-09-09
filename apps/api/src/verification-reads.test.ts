import { randomUUID } from "node:crypto";
import { describe,expect,it,vi } from "vitest";
import { buildServer } from "./server.js";

describe("verification run HTTP read admission",()=>{
  it("binds all case/evidence reads to authenticated tenant and validates paging before dispatch",async()=>{
    const tenantId=randomUUID(),id=randomUUID(),artifact=(n:number)=>({artifactId:`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`,digest:`sha256:${"a".repeat(64)}`,mediaType:"application/json",sizeBytes:1}),createdAt="2026-09-08T00:00:00.000Z";
    const reads={listRunCases:vi.fn().mockResolvedValue({verificationContractVersion:"verification.v1",tenantId,runId:id,cases:[]}),getCase:vi.fn().mockResolvedValue({verificationContractVersion:"verification.v1",tenantId,runId:id,caseRunId:id,caseKey:"case",inputArtifact:artifact(1),resultArtifact:artifact(2),createdAt,evidence:[]}),getEvidence:vi.fn().mockResolvedValue({verificationContractVersion:"verification.v1",tenantId,runId:id,caseRunId:id,evidenceId:id,evidenceKey:"evidence",kind:"artifact",ordinal:0,artifact:artifact(3),createdAt})};
    const server=buildServer({resolveIdentity:token=>token==="valid"?{actor:{kind:"human",id:randomUUID()},grants:[{tenantId,roles:["knowledge_reader"],scopes:[]}]}:undefined,verificationCaseReads:reads});
    const headers={authorization:"Bearer valid","x-tenant-id":tenantId};
    try{
      for(const url of [`/v1/verification/runs/${id}/cases`,`/v1/verification/cases/${id}`,`/v1/verification/evidence/${id}`]){
        expect((await server.inject({url})).statusCode).toBe(401);
        expect((await server.inject({url,headers:{...headers,"x-tenant-id":randomUUID()}})).statusCode).toBe(403);
      }
      expect(reads.listRunCases).not.toHaveBeenCalled();expect(reads.getCase).not.toHaveBeenCalled();expect(reads.getEvidence).not.toHaveBeenCalled();
      const cursor=randomUUID();
      expect((await server.inject({url:`/v1/verification/runs/${id}/cases?pageSize=2&cursor=${cursor}`,headers})).statusCode).toBe(200);
      expect(reads.listRunCases).toHaveBeenCalledWith({tenantId,runId:id,pageSize:2,cursor});
      for(const query of ["pageSize=101","pageSize=0","pageSize=1.5","cursor=locator-alias","tenantId=forged"]){
        expect((await server.inject({url:`/v1/verification/runs/${id}/cases?${query}`,headers})).statusCode).toBe(400);
      }
      expect(reads.listRunCases).toHaveBeenCalledTimes(1);
      expect((await server.inject({url:`/v1/verification/cases/${id}`,headers})).statusCode).toBe(200);
      expect(reads.getCase).toHaveBeenCalledWith({tenantId,caseRunId:id});
      expect((await server.inject({url:`/v1/verification/evidence/${id}`,headers})).statusCode).toBe(200);
      expect(reads.getEvidence).toHaveBeenCalledWith({tenantId,evidenceId:id});
    }finally{await server.close();}
  });

  it("rejects unparsed raw fields and foreign case scopes from runtime read ports",async()=>{
    const tenantId=randomUUID(),id=randomUUID(),foreign=randomUUID(),createdAt="2026-09-08T00:00:00.000Z",artifact={artifactId:randomUUID(),digest:`sha256:${"a".repeat(64)}`,mediaType:"application/json",sizeBytes:1};
    const server=buildServer({resolveIdentity:()=>({actor:{kind:"human",id:randomUUID()},grants:[{tenantId,roles:["knowledge_reader"],scopes:[]}]}),verificationCaseReads:{
      listRunCases:vi.fn().mockResolvedValue({verificationContractVersion:"verification.v1",tenantId,runId:id,cases:[],objectKey:"private"}),
      getCase:vi.fn().mockResolvedValue({verificationContractVersion:"verification.v1",tenantId:foreign,runId:id,caseRunId:id,caseKey:"case",inputArtifact:artifact,resultArtifact:artifact,createdAt,evidence:[]}),
      getEvidence:vi.fn().mockResolvedValue({verificationContractVersion:"verification.v1",tenantId,runId:id,caseRunId:id,evidenceId:foreign,evidenceKey:"evidence",kind:"artifact",ordinal:0,artifact,createdAt}),
    }});
    const headers={authorization:"Bearer configured","x-tenant-id":tenantId};
    try{for(const url of [`/v1/verification/runs/${id}/cases`,`/v1/verification/cases/${id}`,`/v1/verification/evidence/${id}`]){const response=await server.inject({url,headers});expect(response.statusCode).toBe(503);expect(response.body).not.toContain("private");}}finally{await server.close();}
  });

  it("sanitizes case/evidence integrity failures and keeps missing identities distinct",async()=>{
    const tenantId=randomUUID(),id=randomUUID();
    const server=buildServer({resolveIdentity:()=>({actor:{kind:"human",id:randomUUID()},grants:[{tenantId,roles:["knowledge_reader"],scopes:[]}]}),verificationCaseReads:{listRunCases:vi.fn().mockRejectedValue(new Error("private storage detail")),getCase:vi.fn().mockRejectedValue(Object.assign(new Error("private case"),{code:"NOT_FOUND"})),getEvidence:vi.fn().mockRejectedValue(new Error("private evidence"))}});
    const headers={authorization:"Bearer valid","x-tenant-id":tenantId};
    try{
      for(const [url,status] of [[`/v1/verification/runs/${id}/cases`,503],[`/v1/verification/cases/${id}`,404],[`/v1/verification/evidence/${id}`,503]] as const){
        const response=await server.inject({url,headers});expect(response.statusCode).toBe(status);expect(response.body).not.toContain("private");
      }
    }finally{await server.close();}
  });
  it("denies missing and foreign credentials before reading a run",async()=>{
    const tenantId=randomUUID(),getRun=vi.fn(),getRunManifest=vi.fn();
    const server=buildServer({resolveIdentity:token=>token==="valid"?{actor:{kind:"human",id:randomUUID()},grants:[{tenantId,roles:["knowledge_reader"],scopes:[]}]}:undefined,
      verificationReads:{getRun,getRunManifest}});
    try{
      for(const suffix of ["","/manifest"]){
        const url=`/v1/verification/runs/${randomUUID()}${suffix}`;
        expect((await server.inject({url})).statusCode).toBe(401);
        expect((await server.inject({url,headers:{authorization:"Bearer valid","x-tenant-id":randomUUID()}})).statusCode).toBe(403);
      }
      expect(getRun).not.toHaveBeenCalled();expect(getRunManifest).not.toHaveBeenCalled();
    }finally{await server.close();}
  });
  it("distinguishes missing run from sanitized integrity failures",async()=>{
    const tenantId=randomUUID(),runId=randomUUID();
    const missing=Object.assign(new Error("private object key"),{code:"NOT_FOUND"});
    const getRun=vi.fn().mockRejectedValue(missing),getRunManifest=vi.fn().mockRejectedValue(new Error("private token"));
    const server=buildServer({resolveIdentity:()=>({actor:{kind:"human",id:randomUUID()},grants:[{tenantId,roles:["knowledge_reader"],scopes:[]}]}),verificationReads:{getRun,getRunManifest}});
    const headers={authorization:"Bearer configured","x-tenant-id":tenantId};
    try{
      const missingResponse=await server.inject({url:`/v1/verification/runs/${runId}`,headers});
      expect(missingResponse.statusCode).toBe(404);expect(missingResponse.body).not.toContain("private");
      const broken=await server.inject({url:`/v1/verification/runs/${runId}/manifest`,headers});
      expect(broken.statusCode).toBe(503);expect(broken.body).not.toContain("private");
      expect(getRun).toHaveBeenCalledWith({tenantId,runId});
      expect((await server.inject({url:"/v1/verification/runs/not-a-run",headers})).statusCode).toBe(400);
    }finally{await server.close();}
  });
  it("rejects malformed verification run and manifest projections before response serialization",async()=>{const tenantId=randomUUID(),runId=randomUUID(),server=buildServer({resolveIdentity:()=>({actor:{kind:"human",id:randomUUID()},grants:[{tenantId,roles:["knowledge_reader"],scopes:[]}] }),verificationReads:{getRun:async()=>({objectKey:"private-storage-coordinate"} as any),getRunManifest:async()=>({objectKey:"private-storage-coordinate"} as any)}});const headers={authorization:"Bearer valid","x-tenant-id":tenantId};try{for(const suffix of ["","/manifest"]){const response=await server.inject({url:`/v1/verification/runs/${runId}${suffix}`,headers});expect(response.statusCode).toBe(503);expect(response.body).not.toContain("private-storage-coordinate");}}finally{await server.close();}});

});
