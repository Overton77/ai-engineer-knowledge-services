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

const resolved = {
  ...context,
  operationId: id(5),
  attemptId: id(6),
  actor,
  capabilityVersion: "verification-service.v1",
  reason: "test",
  contractVersion: "v1" as const,
};
const reviewer = {
  kind: "service" as const,
  id: id(7),
  serviceIdentity: "human_reviewer" as const,
};
const reviewerIdentity = {
  actor: reviewer,
  grants: [
    { tenantId: tenant, roles: ["knowledge_operator" as const], scopes: [] },
  ],
};
const operatorIdentity = {
  actor,
  grants: [
    { tenantId: tenant, roles: ["knowledge_operator" as const], scopes: [] },
  ],
};

describe("adjudication MCP adapter", () => {
  it("forwards a strict request through tenant-granted in-process authority only", async () => {
    const submitRequestAdjudication = vi.fn(async () => ({
      operationId: id(4),
      state: "queued",
    }));
    const isAdjudicationRequestAdmitted = vi.fn(async () => true);
    const execute = createVerificationMcpToolExecutor({
      operationService: {} as never,
      apiOrigin: "https://knowledge.example",
      identity: operatorIdentity,
      verificationOperations: { submitRequestAdjudication } as never,
      resolveVerificationContext: () => resolved,
      verificationAdmission: { isAdjudicationRequestAdmitted },
    });
    await expect(
      execute("knowledge_request_adjudication", { context, request }),
    ).resolves.toMatchObject({ structuredContent: { operationId: id(4) } });
    expect(isAdjudicationRequestAdmitted).toHaveBeenCalledWith(tenant, request);
    expect(submitRequestAdjudication).toHaveBeenCalledWith(request, resolved);
    await expect(
      execute("knowledge_request_adjudication", {
        context,
        request: { ...request, humanDecision: "overturn" },
      }),
    ).rejects.toThrow();
  });
  it("forwards a strict packet-bound decision without accepting caller authority", async () => {
    const submitRecordAdjudicationDecision = vi.fn(async () => ({
      operationId: id(4),
      state: "queued",
    }));
    const isAdjudicationDecisionAdmitted = vi.fn(async () => true);
    const reviewed = { ...resolved, actor: reviewer };
    const execute = createVerificationMcpToolExecutor({
      operationService: {} as never,
      apiOrigin: "https://knowledge.example",
      identity: reviewerIdentity,
      verificationOperations: { submitRecordAdjudicationDecision } as never,
      resolveVerificationContext: () => reviewed,
      verificationAdmission: { isAdjudicationDecisionAdmitted },
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
    expect(isAdjudicationDecisionAdmitted).toHaveBeenCalledWith({
      request: decision,
      context: reviewed,
    });
    expect(submitRecordAdjudicationDecision).toHaveBeenCalledWith(
      decision,
      reviewed,
    );
    // As on the API route, a non-reviewer service is rejected before decision admission.
    const nonReviewer = createVerificationMcpToolExecutor({
      operationService: {} as never,
      apiOrigin: "https://knowledge.example",
      identity: operatorIdentity,
      verificationOperations: { submitRecordAdjudicationDecision } as never,
      resolveVerificationContext: () => resolved,
      verificationAdmission: { isAdjudicationDecisionAdmitted },
    });
    await expect(
      nonReviewer("knowledge_record_adjudication_decision", {
        context,
        request: decision,
      }),
    ).resolves.toMatchObject({
      isError: true,
      content: [{ text: JSON.stringify({ code: "FORBIDDEN" }) }],
    });
    expect(isAdjudicationDecisionAdmitted).toHaveBeenCalledTimes(1);
    await expect(
      execute("knowledge_record_adjudication_decision", {
        context,
        request: { ...decision, reviewerRole: "caller" },
      }),
    ).rejects.toThrow();
  });
  it("returns CAPABILITY_NOT_ADMITTED for record-decision until decision admission is present", async () => {
    const submitRecordAdjudicationDecision = vi.fn();
    const execute = createVerificationMcpToolExecutor({
      operationService: {} as never,
      apiOrigin: "https://knowledge.example",
      identity: operatorIdentity,
      verificationOperations: { submitRecordAdjudicationDecision } as never,
      resolveVerificationContext: () => resolved,
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
    ).resolves.toMatchObject({
      isError: true,
      content: [{ text: JSON.stringify({ code: "CAPABILITY_NOT_ADMITTED" }) }],
    });
    expect(submitRecordAdjudicationDecision).not.toHaveBeenCalled();
  });
});
