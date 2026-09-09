import {randomUUID} from "node:crypto";
import {describe,expect,it,vi} from "vitest";
import {createBenchmarkReadMcpExecutor} from "./index.js";

describe("benchmark MCP reads",()=>{
  it("rejects foreign tenants and caller signing keys before the HTTP client",async()=>{
    const tenantId=randomUUID(),runId=randomUUID(),getBenchmarkRun=vi.fn(),getBenchmarkRunManifest=vi.fn(),context={tenantId,correlationId:"read"};
    const execute=createBenchmarkReadMcpExecutor({operationService:{} as never,apiOrigin:"https://knowledge.example",identity:{actor:{kind:"human",id:randomUUID()},grants:[{tenantId,roles:["knowledge_reader"],scopes:[]}]},apiClient:{getBenchmarkRun,getBenchmarkRunManifest} as never});
    await expect(execute("knowledge_get_benchmark_run",{context:{...context,tenantId:randomUUID()},runId})).resolves.toMatchObject({isError:true});
    await expect(execute("knowledge_get_benchmark_manifest",{context,runId,publicKeyPem:"caller-key"})).rejects.toThrow();
    expect(getBenchmarkRun).not.toHaveBeenCalled();expect(getBenchmarkRunManifest).not.toHaveBeenCalled();
    await execute("knowledge_get_benchmark_run",{context,runId});await execute("knowledge_get_benchmark_manifest",{context,runId});
    expect(getBenchmarkRun).toHaveBeenCalledWith(runId,context);expect(getBenchmarkRunManifest).toHaveBeenCalledWith(runId,context);
  });
});
