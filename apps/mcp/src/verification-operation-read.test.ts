import {randomUUID} from "node:crypto";
import {describe,expect,it,vi} from "vitest";
import {createVerificationOperationReadMcpExecutor} from "./index.js";

describe("knowledge_get_verification_operation MCP read",()=>{
  it("polls only tenant-owned operations through the verification-aware client read and never fabricates state",async()=>{
    const tenantId=randomUUID(),operationId=randomUUID(),context={tenantId,correlationId:"poll"};
    const status={operationId,kind:"verification_claims",state:"running",receiptIds:[]};
    const getVerificationOperation=vi.fn().mockResolvedValue(status),getOperation=vi.fn();
    const options={operationService:{} as never,apiOrigin:"https://knowledge.example",identity:{actor:{kind:"human" as const,id:randomUUID()},grants:[{tenantId,roles:["knowledge_reader" as const],scopes:[]}]},apiClient:{getVerificationOperation,getOperation} as never};
    const execute=createVerificationOperationReadMcpExecutor(options);
    await expect(execute({context:{...context,tenantId:randomUUID()},operationId})).resolves.toMatchObject({isError:true});
    await expect(execute({context,operationId:"latest"})).rejects.toThrow();
    await expect(execute({context,operationId,state:"succeeded"})).rejects.toThrow();
    expect(getVerificationOperation).not.toHaveBeenCalled();
    await expect(execute({context,operationId})).resolves.toMatchObject({structuredContent:status});
    expect(getVerificationOperation).toHaveBeenCalledWith(operationId,context);
    expect(getOperation).not.toHaveBeenCalled();
    getVerificationOperation.mockRejectedValueOnce(Object.assign(new Error("missing"),{code:"NOT_FOUND"}));
    await expect(execute({context,operationId})).rejects.toMatchObject({code:"NOT_FOUND"});
    await expect(createVerificationOperationReadMcpExecutor({...options,apiClient:undefined})({context,operationId})).resolves.toMatchObject({isError:true});
  });
});
