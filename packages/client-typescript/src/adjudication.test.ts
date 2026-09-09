import { describe, expect, it, vi } from "vitest";
import { KnowledgeClient } from "./client.js";

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const request={verificationContractVersion:"verification.v1" as const,target:{kind:"assertion" as const,assertionId:"assertion-1"},reason:"appeal" as const,evidencePacket:{artifactId:id(3),digest:`sha256:${"a".repeat(64)}`}};
const context={tenantId:id(1),correlationId:"adjudication-client",idempotencyKey:"adjudication-client-001"};

describe("adjudication client",()=>{
  it("posts only the strict request with tenant-bound ownership headers",async()=>{
    const fetch=vi.fn<typeof globalThis.fetch>(async(input,init)=>{
      expect(String(input)).toBe("https://knowledge.example/v1/verification/adjudications:request");
      expect(new Headers(init?.headers).get("x-tenant-id")).toBe(context.tenantId);
      expect(new Headers(init?.headers).get("idempotency-key")).toBe(context.idempotencyKey);
      expect(JSON.parse(String(init?.body))).toEqual(request);
      return new Response(JSON.stringify({operationId:id(4),state:"queued",contractVersion:"v1",statusUrl:"https://knowledge.example/status",eventStreamUrl:"https://knowledge.example/events",cancellationUrl:"https://knowledge.example/cancel",retryUrl:"https://knowledge.example/retry",reconcileUrl:"https://knowledge.example/reconcile"}),{status:202});
    });
    const client=new KnowledgeClient({baseUrl:"https://knowledge.example",getAccessToken:()=>"token",fetch});
    await expect(client.requestAdjudication(request,context)).resolves.toMatchObject({operationId:id(4),state:"queued"});
    expect(()=>client.requestAdjudication({...request,reviewerRole:"caller"} as never,context)).toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
