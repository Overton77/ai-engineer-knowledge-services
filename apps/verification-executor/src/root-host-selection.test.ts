import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { assertRootSelectionPins, createRootSelectionHost, type RootSelectionHostPins } from "./root-host-selection.js";

const digest = `sha256:${"a".repeat(64)}`;
function fixture() {
  const actor = () => ({ identity: randomUUID(), attemptId: randomUUID() });
  const transaction = vi.fn(() => { throw new Error("UNEXPECTED_DATABASE_ACCESS"); });
  const pins: RootSelectionHostPins = {
    tenantId: randomUUID(), policyDigest: digest, producer: actor(), reviewer: actor(), evaluator: actor(), publisher: actor(), embeddingExecutor: actor(),
    correlationId: randomUUID(), capabilityVersion: "root-selection-test.v1", origin: "http://127.0.0.1:4100",
    database: { transaction, recordReviewDecision: vi.fn() } as never,
    artifacts: {} as never, artifactStores: {}, evidence: { loadClaim: vi.fn(), close: vi.fn() },
    measure: vi.fn(async () => ({ tokens: 1, costMicros: 0 })), authorityArtifact: { id: randomUUID(), digest },
    embeddingAdapter: {} as never, embeddingAdapterVersion: "unit-port.v1",
    spaces: [{ space: "engineering_claims", vectorSpaceVersionId: randomUUID(), vectorStoreSpaceId: randomUUID(), modelSlug: "host-pinned", providerRoute: ["host-pinned"] }],
    evaluation: { queries: [{ queryId: "independent-baseline", embedding: Array.from({ length: 1536 }, (_, index) => index === 0 ? 1 : 0) }], resultLimit: 4, minimumRecallAtK: 1 },
  };
  const claimId = randomUUID();
  const selection = { schemaVersion: "promotion-selection.v1", tenantId: pins.tenantId, expectedKnowledgeHead: 1,
    runPinDigest: digest, policyDigest: digest, proposedBy: pins.producer.identity, requiredReviewer: pins.reviewer.identity,
    budget: { maxMembers: 1, maxBytes: 1000, maxTokens: 1000, maxCostMicros: 0, deadline: "2099-01-01T00:00:00Z" }, excluded: [],
    selected: [{ memberId: "claim", content: { kind: "claim", id: claimId, digest },
      target: { kind: "claim", canonicalId: claimId, projectionTargetId: randomUUID() }, targetSpaces: ["engineering_claims"],
      sourceChunks: [{ chunkId: randomUUID(), chunkDigest: digest, representationId: randomUUID(), representationDigest: digest,
        representationClass: "structural_extraction", captureId: randomUUID(), sourceFamilyId: "primary" }],
      admittedClaims: [{ runId: "run", claimId: "claim", claimDigest: digest, admissionDigest: digest }],
      contentLinkReceiptIds: [randomUUID()], reason: "Unit authority boundary", estimatedBytes: 1, estimatedTokens: 1, estimatedCostMicros: 0 }] };
  const selectionArtifact = { id: randomUUID(), digest };
  const proposal = { schemaVersion: "knowledge.promotion-proposal/v1", selection, selectionArtifact, chunkSetId: randomUUID(),
    representationDecisionId: randomUUID(), projectionProcedureId: randomUUID(), purpose: "Unit authority boundary", contextualPrefix: "",
    visibility: "internal", classification: "internal", targetDomains: ["engineering_claims"], expectedValue: "Pinned selection", risks: [], exclusions: [], reason: "Bounded host" };
  return { pins, transaction, request: { selection, selectionArtifact, proposal } };
}

describe("root selected pipeline authority boundaries (offline)", () => {
  it("accepts distinct host pins without granting review or touching canonical state", () => {
    const { pins, transaction } = fixture();
    expect(() => assertRootSelectionPins(pins)).not.toThrow();
    expect(transaction).not.toHaveBeenCalled();
  });
  it.each(["reviewer", "evaluator", "publisher", "embeddingExecutor"] as const)("rejects producer identity or attempt reused as %s", key => {
    const { pins } = fixture();
    expect(() => assertRootSelectionPins({ ...pins, [key]: { ...pins[key], identity: pins.producer.identity } })).toThrow("SEPARATION_OF_DUTY");
    expect(() => assertRootSelectionPins({ ...pins, [key]: { ...pins[key], attemptId: pins.producer.attemptId } })).toThrow("SEPARATION_OF_DUTY");
  });
  it("refuses empty, duplicate, zero, nonfinite or weakened independent evaluation baselines", () => {
    const { pins } = fixture(), query = pins.evaluation.queries[0]!;
    for (const queries of [[], [query, query], [{ ...query, embedding: Array(1536).fill(0) }], [{ ...query, embedding: Array(1536).fill(NaN) }]])
      expect(() => assertRootSelectionPins({ ...pins, evaluation: { ...pins.evaluation, queries } })).toThrow("EVALUATION_PINS");
    expect(() => assertRootSelectionPins({ ...pins, evaluation: { ...pins.evaluation, minimumRecallAtK: 0 } })).toThrow("EVALUATION_PINS");
  });
  it("requires an explicit labelled synthetic review grant and authorization reference", () => {
    const { pins } = fixture();
    expect(() => assertRootSelectionPins({ ...pins, reviewAuthority: { kind: "synthetic_development_fixture", synthetic: false, authorizationReference: "fixture" } as never })).toThrow("REVIEW_AUTHORITY");
    expect(() => assertRootSelectionPins({ ...pins, reviewAuthority: { kind: "independent_reviewer", authorizationReference: " " } })).toThrow("REVIEW_AUTHORITY");
  });
  it("prevents cross-tenant, policy, proposer, reviewer and artifact substitution before database access", () => {
    const { pins, request, transaction } = fixture(), host = createRootSelectionHost(pins);
    for (const patch of [{ tenantId: randomUUID() }, { policyDigest: `sha256:${"b".repeat(64)}` }, { proposedBy: randomUUID() }, { requiredReviewer: randomUUID() }]) {
      const selection = { ...request.selection, ...patch };
      expect(() => host.bind({ ...request, selection, proposal: { ...request.proposal, selection } })).toThrow("REQUEST_PIN_MISMATCH");
    }
    expect(() => host.bind({ ...request, selectionArtifact: { ...request.selectionArtifact, id: randomUUID() } })).toThrow("REQUEST_PIN_MISMATCH");
    expect(transaction).not.toHaveBeenCalled();
  });
  it("does not dispatch a review without a host grant even when the producer supplies an accept decision", async () => {
    const { pins, request, transaction } = fixture(), bound = createRootSelectionHost(pins).bind(request);
    await expect(bound.continueReview({ decision: "accept", guardedDigest: digest, gates: {}, policyVersion: "unit", rationale: "self approve" }))
      .rejects.toThrow("REVIEW_AUTHORITY_REQUIRED");
    expect(transaction).not.toHaveBeenCalled();
  });
});
