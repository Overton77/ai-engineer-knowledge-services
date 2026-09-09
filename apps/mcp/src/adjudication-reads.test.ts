import {randomUUID} from "node:crypto";
import {describe,expect,it,vi} from "vitest";
import {createAdjudicationDecisionReadMcpExecutor,createAdjudicationReadMcpExecutor} from "./index.js";

describe("adjudication MCP reads",()=>{
  it("rejects tenant and authority injection before dispatch and forwards only exact read identifiers",async()=>{
    const tenantId=randomUUID(),operationId=randomUUID(),context={tenantId,correlationId:"read"};
    const getAdjudicationSubject=vi.fn().mockResolvedValue({output:{status:"pending_human_adjudication"}});
    const options={operationService:{} as never,apiOrigin:"https://knowledge.example",identity:{actor:{kind:"human" as const,id:randomUUID()},grants:[{tenantId,roles:["knowledge_reader" as const],scopes:[]}]},apiClient:{getAdjudicationSubject} as never};
    const execute=createAdjudicationReadMcpExecutor(options);
    await expect(execute({context:{...context,tenantId:randomUUID()},operationId})).resolves.toMatchObject({isError:true});
    await expect(execute({context,operationId,reviewerRole:"expert"})).rejects.toThrow();
    expect(getAdjudicationSubject).not.toHaveBeenCalled();
    await expect(execute({context,operationId})).resolves.toMatchObject({structuredContent:{output:{status:"pending_human_adjudication"}}});
    expect(getAdjudicationSubject).toHaveBeenCalledWith(operationId,context);
    getAdjudicationSubject.mockRejectedValueOnce(Object.assign(new Error("missing"),{code:"NOT_FOUND"}));
    await expect(execute({context,operationId})).rejects.toMatchObject({code:"NOT_FOUND"});
    await expect(createAdjudicationReadMcpExecutor({...options,apiClient:undefined})({context,operationId})).resolves.toMatchObject({isError:true});
  });
  it("reads a decision with exact compact identifiers and rejects caller authority injection",async()=>{
    const tenantId=randomUUID(),operationId=randomUUID(),context={tenantId,correlationId:"decision-read"};
    const getAdjudicationDecision=vi.fn().mockResolvedValue({output:{decision:"affirm"}});
    const options={operationService:{} as never,apiOrigin:"https://knowledge.example",identity:{actor:{kind:"human" as const,id:randomUUID()},grants:[{tenantId,roles:["knowledge_reader" as const],scopes:[]}]},apiClient:{getAdjudicationDecision} as never};
    const execute=createAdjudicationDecisionReadMcpExecutor(options);
    await expect(execute({context:{...context,tenantId:randomUUID()},operationId})).resolves.toMatchObject({isError:true});
    await expect(execute({context,operationId,reviewerRole:"caller"})).rejects.toThrow();
    expect(getAdjudicationDecision).not.toHaveBeenCalled();
    await expect(execute({context,operationId})).resolves.toMatchObject({structuredContent:{output:{decision:"affirm"}}});
    expect(getAdjudicationDecision).toHaveBeenCalledWith(operationId,context);
  });

});
