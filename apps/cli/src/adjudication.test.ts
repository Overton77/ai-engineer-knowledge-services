import { describe, expect, it, vi } from "vitest";
import type { OperationContext } from "@aiengineer/knowledge-contracts";
import { dispatchCliCommand, resolveCommand, type CliKnowledgeClient } from "./commands.js";

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const context:OperationContext={tenantId:id(1),operationId:id(2),attemptId:id(3),correlationId:"adjudication-cli",actor:{kind:"service",id:id(4),serviceIdentity:"mission_control_client"},capabilityVersion:"v1",idempotencyKey:"adjudication-cli-001",reason:"test",contractVersion:"v1"};
const request={verificationContractVersion:"verification.v1",target:{kind:"assertion",assertionId:"assertion-1"},reason:"appeal",evidencePacket:{artifactId:id(5),digest:`sha256:${"a".repeat(64)}`}};

describe("adjudication CLI",()=>{
  it("uses the strict client request path and rejects caller authority fields",async()=>{
    const requestAdjudication=vi.fn(async()=>({operationId:id(6),state:"queued"}));
    const client={requestAdjudication} as unknown as CliKnowledgeClient;
    await dispatchCliCommand(client,resolveCommand("adjudication","request")!,request,context);
    expect(requestAdjudication).toHaveBeenCalledWith(request,context);
    await expect(dispatchCliCommand(client,resolveCommand("adjudication","request")!,{...request,reviewerRole:"caller"},context)).rejects.toThrow();
  });
  it("forwards a strict packet-bound decision without caller authority fields",async()=>{
    const recordAdjudicationDecision=vi.fn(async()=>({operationId:id(6),state:"queued"}));
    const client={recordAdjudicationDecision} as unknown as CliKnowledgeClient;
    const decision={verificationContractVersion:"verification.v1",subjectId:id(5),packetArtifact:{artifactId:id(6),digest:`sha256:${"b".repeat(64)}`},decision:"affirm",rationale:"Synthetic engineering review record."};
    await dispatchCliCommand(client,resolveCommand("adjudication","decision")!,decision,context);
    expect(recordAdjudicationDecision).toHaveBeenCalledWith(decision,context);
    await expect(dispatchCliCommand(client,resolveCommand("adjudication","decision")!,{...decision,reviewerRole:"caller"},context)).rejects.toThrow();
  });

  it("reads a decision through the compact tenant-scoped client method",async()=>{
    const getAdjudicationDecision=vi.fn(async()=>({output:{decision:"affirm"}}));
    const client={getAdjudicationDecision} as unknown as CliKnowledgeClient;
    await expect(dispatchCliCommand(client,resolveCommand("adjudication","get-decision")!,{operationId:id(5)},context)).resolves.toMatchObject({output:{decision:"affirm"}});
    expect(getAdjudicationDecision).toHaveBeenCalledWith(id(5),context);
    await expect(dispatchCliCommand(client,resolveCommand("adjudication","get-decision")!,{operationId:id(5),reviewerRole:"caller"},context)).rejects.toThrow();
  });

});
