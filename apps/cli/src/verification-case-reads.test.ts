import { describe, expect, it, vi } from "vitest";
import type { OperationContext } from "@aiengineer/knowledge-contracts";
import { dispatchCliCommand, resolveCommand, type CliKnowledgeClient } from "./commands.js";

const id="11111111-1111-4111-8111-111111111111";
const context={tenantId:id,correlationId:"case-read-test"} as OperationContext;
function fixture(){
  const methods={listVerificationRunCases:vi.fn(),getVerificationCase:vi.fn(),getVerificationEvidence:vi.fn(),submitOperation:vi.fn()};
  return {methods,client:methods as unknown as CliKnowledgeClient};
}
describe("CLI authored case reads",()=>{
  it("dispatches bounded reads without submitting an operation",async()=>{
    const {methods,client}=fixture();
    await dispatchCliCommand(client,resolveCommand("verify","cases")!,{runId:id,pageSize:2,cursor:id},context);
    await dispatchCliCommand(client,resolveCommand("verify","case")!,{caseRunId:id},context);
    await dispatchCliCommand(client,resolveCommand("verify","evidence")!,{evidenceId:id},context);
    expect(methods.listVerificationRunCases).toHaveBeenCalledWith(id,{pageSize:2,cursor:id},context);
    expect(methods.getVerificationCase).toHaveBeenCalledWith(id,context);
    expect(methods.getVerificationEvidence).toHaveBeenCalledWith(id,context);
    expect(methods.submitOperation).not.toHaveBeenCalled();
  });
  it("rejects invalid paging, textual aliases and unknown request fields before dispatch",async()=>{
    const {methods,client}=fixture();
    for(const input of [{runId:id,pageSize:101},{runId:id,pageSize:"2"},{runId:id,cursor:"locator"},{runId:id,tenantId:id}]){
      await expect(dispatchCliCommand(client,resolveCommand("verify","cases")!,input,context)).rejects.toThrow();
    }
    await expect(dispatchCliCommand(client,resolveCommand("verify","evidence")!,{evidenceId:"judgment-evidence"},context)).rejects.toThrow();
    expect(methods.listVerificationRunCases).not.toHaveBeenCalled();expect(methods.getVerificationEvidence).not.toHaveBeenCalled();
  });
});
