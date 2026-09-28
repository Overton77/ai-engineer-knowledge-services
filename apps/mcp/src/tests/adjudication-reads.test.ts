import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createVerificationResourceReads } from "@aiengineer/knowledge-application";
import {
  createAdjudicationDecisionReadMcpExecutor,
  createAdjudicationReadMcpExecutor,
} from "../index.js";

const digest = (value: string) => `sha256:${value.repeat(64)}`;
const artifact = (value: string) => ({ artifactId: randomUUID(), digest: digest(value) });

// Schema-valid terminal projections (the API route tests use the same shapes).
const pendingSubject = (tenantId: string, operationId: string) => {
  const runId = randomUUID();
  return {
    verificationContractVersion: "verification.v1" as const,
    tenantId,
    operationId,
    requestDigest: digest("a"),
    packetArtifact: artifact("b"),
    output: {
      subjectId: randomUUID(),
      status: "pending_human_adjudication" as const,
      target: { kind: "run" as const, runId, objectDigest: digest("c") },
      reason: "appeal" as const,
      reviewRequirements: { eligibleReviewerRoles: ["expert"], quorumRequired: 1 },
      originalPolicyOutcome: "review" as const,
      source: {
        runKind: "claims" as const,
        runId,
        manifestArtifact: artifact("d"),
        manifestDigest: digest("e"),
        bundleArtifact: artifact("f"),
        deterministicResultArtifact: artifact("1"),
        policyDecisionArtifact: artifact("2"),
      },
      proof: {
        payloadDigest: digest("3"),
        signatureStatus: "verified" as const,
        deterministicReplay: "exact" as const,
        policyReplay: "exact" as const,
        terminalFencingToken: 1,
      },
      humanDecisionRecorded: false as const,
      admissionChanged: false as const,
    },
  };
};
const decisionTerminal = (tenantId: string, operationId: string) => ({
  verificationContractVersion: "verification.v1" as const,
  tenantId,
  operationId,
  requestDigest: digest("a"),
  terminalFencingToken: 2,
  output: {
    schemaVersion: "verification-adjudication-decision-result.v1" as const,
    subjectId: randomUUID(),
    packetArtifact: artifact("b"),
    decisionArtifact: artifact("c"),
    decision: "affirm" as const,
    reviewerProvenance: "synthetic_engineering" as const,
    quorum: {
      required: 2,
      humanAffirmRecorded: 0,
      humanRejectRecorded: 0,
      humanDeferRecorded: 0,
      syntheticAffirmRecorded: 1,
      reached: false,
    },
    admissionChanged: false as const,
    humanGoldScoringEligible: false as const,
  },
});

describe("adjudication MCP reads", () => {
  it("rejects tenant and authority injection before dispatch and forwards only exact read identifiers", async () => {
    const tenantId = randomUUID(),
      operationId = randomUUID(),
      actor = { kind: "human" as const, id: randomUUID() },
      context = { tenantId, correlationId: "read" };
    const subject = pendingSubject(tenantId, operationId);
    const getPendingSubject = vi.fn().mockResolvedValue(subject);
    const options = {
      operationService: {} as never,
      apiOrigin: "https://knowledge.example",
      identity: {
        actor,
        grants: [
          { tenantId, roles: ["knowledge_reader" as const], scopes: [] },
        ],
      },
      verificationReads: createVerificationResourceReads({
        adjudicationReads: { getPendingSubject },
      }),
    };
    const execute = createAdjudicationReadMcpExecutor(options);
    await expect(
      execute({ context: { ...context, tenantId: randomUUID() }, operationId }),
    ).resolves.toMatchObject({ isError: true });
    await expect(
      execute({ context, operationId, reviewerRole: "expert" }),
    ).rejects.toThrow();
    expect(getPendingSubject).not.toHaveBeenCalled();
    await expect(execute({ context, operationId })).resolves.toMatchObject({
      structuredContent: { output: { status: "pending_human_adjudication" } },
    });
    expect(getPendingSubject).toHaveBeenCalledWith({ tenantId, operationId, actor });
    getPendingSubject.mockRejectedValueOnce(
      Object.assign(new Error("missing"), { code: "NOT_FOUND" }),
    );
    await expect(execute({ context, operationId })).resolves.toMatchObject({
      isError: true,
      content: [{ text: JSON.stringify({ code: "NOT_FOUND" }) }],
    });
    await expect(
      createAdjudicationReadMcpExecutor({ ...options, verificationReads: undefined })({
        context,
        operationId,
      }),
    ).resolves.toMatchObject({ isError: true });
  });
  it("reads a decision with exact compact identifiers and rejects caller authority injection", async () => {
    const tenantId = randomUUID(),
      operationId = randomUUID(),
      actor = { kind: "human" as const, id: randomUUID() },
      context = { tenantId, correlationId: "decision-read" };
    const getDecision = vi
      .fn()
      .mockResolvedValue(decisionTerminal(tenantId, operationId));
    const isAdjudicationDecisionReadAdmitted = vi.fn(async () => true);
    const options = {
      operationService: {} as never,
      apiOrigin: "https://knowledge.example",
      identity: {
        actor,
        grants: [
          { tenantId, roles: ["knowledge_reader" as const], scopes: [] },
        ],
      },
      verificationReads: createVerificationResourceReads({
        adjudicationDecisionReads: { getDecision },
        isAdjudicationDecisionReadAdmitted,
      }),
    };
    const execute = createAdjudicationDecisionReadMcpExecutor(options);
    await expect(
      execute({ context: { ...context, tenantId: randomUUID() }, operationId }),
    ).resolves.toMatchObject({ isError: true });
    await expect(
      execute({ context, operationId, reviewerRole: "caller" }),
    ).rejects.toThrow();
    expect(getDecision).not.toHaveBeenCalled();
    await expect(execute({ context, operationId })).resolves.toMatchObject({
      structuredContent: { output: { decision: "affirm" } },
    });
    expect(isAdjudicationDecisionReadAdmitted).toHaveBeenCalledWith({ tenantId, operationId, actor });
    expect(getDecision).toHaveBeenCalledWith({ tenantId, operationId, actor });
  });
});
