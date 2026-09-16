import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { ArtifactLedger } from "@aiengineer/knowledge-db-read";
import { sha256Digest } from "@aiengineer/knowledge-domain";
import { PromotionProposalInputSchema } from "@aiengineer/knowledge-contracts";
import {
  composePromotionSelectionHost,
  createPromotionSelectionAdvance,
  startPromotionSelectionWorker,
  type PromotionSelectionHostPins,
} from "./promotion-selection-host.js";

const policyDigest = sha256Digest("pinned host policy");

function pins(overrides: Partial<PromotionSelectionHostPins> = {}): PromotionSelectionHostPins {
  return {
    tenantId: randomUUID(),
    policyDigest,
    artifacts: {} as ArtifactLedger,
    artifactStores: { candidate: { get: vi.fn(), put: vi.fn() } },
    evidence: { loadClaim: vi.fn(), close: vi.fn() },
    measure: vi.fn(async () => ({ tokens: 1, costMicros: 0 })),
    authorityArtifact: { id: randomUUID(), digest: `sha256:${"a".repeat(64)}` },
    ...overrides,
  };
}

describe("promotion selection executor host", () => {
  it("fails closed when host pins or authority artifact are missing", () => {
    expect(() => composePromotionSelectionHost(pins({ measure: undefined as never }))).toThrow(
      "PROMOTION_SELECTION_HOST_PINS_REQUIRED",
    );
    expect(() => composePromotionSelectionHost(pins({ artifacts: undefined as never }))).toThrow(
      "PROMOTION_SELECTION_HOST_PINS_REQUIRED",
    );
    expect(() => composePromotionSelectionHost(pins({ evidence: undefined as never }))).toThrow(
      "PROMOTION_SELECTION_HOST_PINS_REQUIRED",
    );
    expect(() => composePromotionSelectionHost(pins({ authorityArtifact: { id: randomUUID(), digest: "not-a-digest" } })))
      .toThrow();
  });

  it("composes worker authority from executor ports and registered authority bytes", () => {
    const hostPins = pins();
    const host = composePromotionSelectionHost(hostPins);
    expect(host.promotionSelection.selectionPorts.measure).toBe(hostPins.measure);
  });

  it("refuses to start a selection worker without a matching tenant or authority", async () => {
    const hostPins = pins();
    await expect(startPromotionSelectionWorker({ environment: { NODE_ENV: "test" }, pins: hostPins }))
      .rejects.toThrow("WORKER_TENANT_ID_REQUIRED");
    await expect(startPromotionSelectionWorker({
      environment: { NODE_ENV: "test", WORKER_TENANT_ID: randomUUID() },
      pins: hostPins,
    })).rejects.toThrow("PROMOTION_SELECTION_HOST_TENANT_MISMATCH");
    await expect(startPromotionSelectionWorker({
      environment: {
        NODE_ENV: "test",
        WORKER_TENANT_ID: hostPins.tenantId,
        PROMOTION_SELECTION_AUTHORITY_ARTIFACT_JSON: JSON.stringify({
          id: randomUUID(), digest: hostPins.authorityArtifact.digest,
        }),
      },
      pins: hostPins,
    })).rejects.toThrow("PROMOTION_SELECTION_AUTHORITY_LOCATOR_MISMATCH");
  });

  it("starts through startWorker with the composed host and can scope one operation", async () => {
    const hostPins = pins();
    await expect(startPromotionSelectionWorker({
      environment: {
        NODE_ENV: "test",
        KNOWLEDGE_PERSISTENCE_MODE: "postgres",
        WORKER_TENANT_ID: hostPins.tenantId,
        WORKER_OPERATION_ID: randomUUID(),
        PROMOTION_SELECTION_AUTHORITY_ARTIFACT_JSON: JSON.stringify(hostPins.authorityArtifact),
      },
      pins: hostPins,
    })).rejects.toThrow("POSTGRES_URL_REQUIRED");
  });

  it("exposes advance as prepare/embed/index progress, not publication", async () => {
    const digest = `sha256:${"a".repeat(64)}`;
    const tenantId = randomUUID(), claimId = randomUUID();
    const proposal = PromotionProposalInputSchema.parse({
      schemaVersion: "knowledge.promotion-proposal/v1",
      selectionArtifact: { id: randomUUID(), digest },
      chunkSetId: randomUUID(),
      representationDecisionId: randomUUID(),
      projectionProcedureId: randomUUID(),
      purpose: "Host advance",
      contextualPrefix: "",
      visibility: "internal",
      classification: "internal",
      targetDomains: ["engineering_claims"],
      expectedValue: "Pinned selection",
      risks: [],
      exclusions: [],
      reason: "Host composition",
      selection: {
        schemaVersion: "promotion-selection.v1",
        tenantId,
        expectedKnowledgeHead: 1,
        runPinDigest: digest,
        policyDigest: digest,
        proposedBy: randomUUID(),
        requiredReviewer: randomUUID(),
        budget: { maxMembers: 1, maxBytes: 1000, maxTokens: 1000, maxCostMicros: 0, deadline: "2099-01-01T00:00:00Z" },
        excluded: [],
        selected: [{
          memberId: "claim",
          content: { kind: "claim", id: claimId, digest },
          target: { kind: "claim", canonicalId: claimId, projectionTargetId: randomUUID() },
          targetSpaces: ["engineering_claims"],
          sourceChunks: [{
            chunkId: randomUUID(), chunkDigest: digest, representationId: randomUUID(),
            representationDigest: digest, representationClass: "structural_extraction",
            captureId: randomUUID(), sourceFamilyId: "primary",
          }],
          admittedClaims: [{ runId: "run", claimId: "claim", claimDigest: digest, admissionDigest: digest }],
          contentLinkReceiptIds: [randomUUID()],
          reason: "Admitted selection",
          estimatedBytes: 1, estimatedTokens: 1, estimatedCostMicros: 0,
        }],
      },
    });
    const transaction = vi.fn(async () => { throw new Error("unexpected database dispatch"); });
    const advance = createPromotionSelectionAdvance({
      database: { transaction } as never,
      governance: {} as never,
      authority: {} as never,
      proposal,
      attemptId: randomUUID(),
      reviewerAttemptId: randomUUID(),
      correlationId: randomUUID(),
      capabilityVersion: "host.v1",
      embeddingExecutorId: randomUUID(),
      origin: "http://127.0.0.1:4100",
      spaces: [{ space: "engineering_claims", vectorSpaceVersionId: randomUUID(), modelSlug: "fake", providerRoute: ["deterministic-fake"] }],
    });
    await expect(advance({
      selection: { ...proposal.selection, tenantId: randomUUID() },
      artifact: proposal.selectionArtifact,
    })).rejects.toThrow("PROMOTION_SELECTION_PIN_MISMATCH");
    expect(transaction).not.toHaveBeenCalled();
  });
});
