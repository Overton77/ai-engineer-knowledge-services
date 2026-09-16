import { describe, expect, it, vi } from "vitest";
import { createVerificationMcpToolExecutor } from "../index.js";

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const tenant = id(1),
  actor = {
    kind: "service" as const,
    id: id(2),
    serviceIdentity: "mission_control_client" as const,
  };
const context = {
  tenantId: tenant,
  correlationId: "adjudication-mcp",
  idempotencyKey: "adjudication-mcp-001",
};
const request = {
  verificationContractVersion: "verification.v1",
  target: { kind: "assertion", assertionId: "assertion-1" },
  reason: "appeal",
  evidencePacket: { artifactId: id(3), digest: `sha256:${"a".repeat(64)}` },
};

describe("adjudication MCP adapter", () => {
  it("forwards a strict request through tenant-granted API authority only", async () => {
    const requestAdjudication = vi.fn(async () => ({
      operationId: id(4),
      state: "queued",
    }));
    const execute = createVerificationMcpToolExecutor({
      operationService: {} as never,
      apiOrigin: "https://knowledge.example",
      identity: {
        actor,
        grants: [
          { tenantId: tenant, roles: ["knowledge_operator"], scopes: [] },
        ],
      },
      apiClient: { requestAdjudication } as never,
    });
    await expect(
      execute("knowledge_request_adjudication", { context, request }),
    ).resolves.toMatchObject({ structuredContent: { operationId: id(4) } });
    expect(requestAdjudication).toHaveBeenCalledWith(request, context);
    await expect(
      execute("knowledge_request_adjudication", {
        context,
        request: { ...request, humanDecision: "overturn" },
      }),
    ).rejects.toThrow();
  });
  it("forwards a strict packet-bound decision without accepting caller authority", async () => {
    const recordAdjudicationDecision = vi.fn(async () => ({
      operationId: id(4),
      state: "queued",
    }));
    const execute = createVerificationMcpToolExecutor({
      operationService: {} as never,
      apiOrigin: "https://knowledge.example",
      identity: {
        actor,
        grants: [
          { tenantId: tenant, roles: ["knowledge_operator"], scopes: [] },
        ],
      },
      apiClient: { recordAdjudicationDecision } as never,
    });
    const decision = {
      verificationContractVersion: "verification.v1",
      subjectId: id(3),
      packetArtifact: { artifactId: id(4), digest: `sha256:${"b".repeat(64)}` },
      decision: "affirm",
      rationale: "Synthetic engineering review record.",
    };
    await expect(
      execute("knowledge_record_adjudication_decision", {
        context,
        request: decision,
      }),
    ).resolves.toMatchObject({ structuredContent: { operationId: id(4) } });
    expect(recordAdjudicationDecision).toHaveBeenCalledWith(decision, context);
    await expect(
      execute("knowledge_record_adjudication_decision", {
        context,
        request: { ...decision, reviewerRole: "caller" },
      }),
    ).rejects.toThrow();
  });
  it("keeps record-decision on the HTTP shim until decision admission is present", async () => {
    const recordAdjudicationDecision = vi.fn(async () => ({
      operationId: id(4),
      state: "queued",
    }));
    const submitRecordAdjudicationDecision = vi.fn();
    const execute = createVerificationMcpToolExecutor({
      operationService: {} as never,
      apiOrigin: "https://knowledge.example",
      identity: {
        actor,
        grants: [
          { tenantId: tenant, roles: ["knowledge_operator"], scopes: [] },
        ],
      },
      verificationOperations: { submitRecordAdjudicationDecision } as never,
      resolveVerificationContext: () => ({
        ...context,
        operationId: id(5),
        attemptId: id(6),
        actor,
        capabilityVersion: "verification-service.v1",
        reason: "test",
        contractVersion: "v1",
      }),
      apiClient: { recordAdjudicationDecision } as never,
    });
    const decision = {
      verificationContractVersion: "verification.v1",
      subjectId: id(3),
      packetArtifact: { artifactId: id(4), digest: `sha256:${"b".repeat(64)}` },
      decision: "affirm",
      rationale: "Synthetic engineering review record.",
    };
    await expect(
      execute("knowledge_record_adjudication_decision", {
        context,
        request: decision,
      }),
    ).resolves.toMatchObject({ structuredContent: { operationId: id(4) } });
    expect(recordAdjudicationDecision).toHaveBeenCalledWith(decision, context);
    expect(submitRecordAdjudicationDecision).not.toHaveBeenCalled();
  });
});
