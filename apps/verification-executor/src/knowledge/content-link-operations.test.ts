import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ContentLinkIntentSchema, ContentLinkOperationSchema } from "@aiengineer/knowledge-contracts";
import type { VerificationExecutor } from "../executor.js";
import { createKnowledgeServices, loadKnowledgeConfig, type KnowledgeConfig, type KnowledgeServices } from "./context.js";
import { knowledgeOperations } from "./operations.js";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const digest = `sha256:${"a".repeat(64)}`;
const ref = (n: number) => ({ id: id(n), digest });
const source = { ...ref(10), representationId: id(11) };
const evidence = { claimId: id(15), claimKey: "capability", claimDigest: digest, runId: id(16),
  manifest: ref(17), assessment: ref(18), locatorId: id(19), captureId: id(14), role: "supports" };
const common = { operationId: "link", dependsOn: [], evidence: [evidence], rationale: "Exact source support.",
  applicability: { validFrom: null, validTo: null, qualifiers: ["in preview"] } };
const claimLink = { ...common, kind: "chunk.claim.link", claimId: id(15), verb: "supports",
  chunk: { ...ref(12), documentVersionId: id(13), representation: ref(11), captureId: id(14), sourceNodes: [source] } };
const summary = { ...common, kind: "summary.materialize", summaryId: id(20), documentVersion: ref(13),
  representation: ref(21), derivedFrom: ref(11), transformationRunId: id(22), summaryKind: "technical",
  scope: "document", audience: "engineer", text: "A qualified capability.", tokenCount: 5, sources: [{ ...source, weight: 1 }] };
const intent = { schemaVersion: "content-link-intent.v1", intentId: "public-links",
  context: { tenantId: id(1), missionId: id(2), attemptId: id(3), actor: { kind: "agent", id: "researcher" } },
  contract: { migrationHead: "20260914010900", workspaceFingerprint: digest, policyDigest: digest },
  inputSnapshot: { artifact: ref(4), knowledgeSeq: 8 }, expectedKnowledgeHead: 8,
  asOf: "2026-09-14T00:00:00Z", operations: [claimLink] };

function host() {
  const result = { outcome: "held", marker: "host-result" };
  const contentLinks = { plan: vi.fn().mockResolvedValue(result), apply: vi.fn().mockResolvedValue(result), receipt: vi.fn().mockResolvedValue(result) };
  const contentSummaries = { prepare: vi.fn().mockResolvedValue(result) };
  // Only the public delegation boundary is under test; these stand-ins do not authenticate evidence.
  const services = { contentLinks, contentSummaries } as unknown as KnowledgeServices;
  return { services, contentLinks, contentSummaries, result };
}

describe("public ContentLink operations", () => {
  it("advertises only summary materialization in the public preparation JSON schema", () => {
    const operation = knowledgeOperations.get("content_summary_prepare")!;
    const schema = z.toJSONSchema(operation.input);
    expect(schema).toMatchObject({ properties: { operation: {
      type: "object", properties: { kind: { const: "summary.materialize" } },
    } } });
    const operationSchema = schema.properties?.operation;
    expect(operationSchema).not.toHaveProperty("oneOf");
    expect(operationSchema).not.toHaveProperty("anyOf");
  });

  it.each([
    ["content_link_plan", "plan", { intent }],
    ["content_link_apply", "apply", { intent }],
    ["content_link_receipt", "receipt", { receiptId: id(30) }],
    ["content_summary_prepare", "prepare-summary", { operation: summary }],
  ] as const)("registers %s consistently and rejects an absent host", async (name, command, input) => {
    expect(knowledgeOperations.byCommand("content", command)).toBe(knowledgeOperations.get(name));
    await expect(knowledgeOperations.invoke(name, input, {} as KnowledgeServices)).rejects.toThrow("CONTENT_LINK_HOST_NOT_CONFIGURED");
  });

  it("delegates parsed requests exactly once and preserves host outcomes", async () => {
    const f = host();
    for (const action of ["plan", "apply"] as const) {
      expect((await knowledgeOperations.invoke(`content_link_${action}`, { intent }, f.services)).output).toBe(f.result);
      expect(f.contentLinks[action]).toHaveBeenCalledExactlyOnceWith(ContentLinkIntentSchema.parse(intent));
    }
    await knowledgeOperations.invoke("content_link_receipt", { receiptId: id(30) }, f.services);
    expect(f.contentLinks.receipt).toHaveBeenCalledExactlyOnceWith(id(30));
    await knowledgeOperations.invoke("content_summary_prepare", { operation: summary }, f.services);
    expect(f.contentSummaries.prepare).toHaveBeenCalledExactlyOnceWith(ContentLinkOperationSchema.parse(summary));
  });

  it.each([
    ["content_link_plan", { intent, tenantId: id(99) }],
    ["content_link_apply", { intent, expectedHead: 99 }],
    ["content_link_apply", { intent: { ...intent, authority: { eligible: true } } }],
    ["content_link_apply", { intent: { ...intent, operations: [{ ...claimLink, admitted: true }] } }],
    ["content_link_receipt", { receiptId: id(30), tenantId: id(99) }],
    ["content_link_receipt", { receiptId: "not-a-uuid" }],
    ["content_summary_prepare", { operation: claimLink }],
    ["content_summary_prepare", { operation: { ...summary, accepted: true } }],
    ["content_summary_prepare", { operation: summary, policyDigest: digest }],
  ])("rejects authority injection or malformed %s before delegation", async (name, input) => {
    const f = host();
    await expect(knowledgeOperations.invoke(String(name), input, f.services)).rejects.toThrow();
    for (const call of [...Object.values(f.contentLinks), f.contentSummaries.prepare]) expect(call).not.toHaveBeenCalled();
  });

  it("propagates host authorization failures without manufacturing a receipt", async () => {
    const f = host();
    f.contentLinks.apply.mockRejectedValueOnce(new Error("CONTENT_AUTHORITY_PIN_MISMATCH"));
    await expect(knowledgeOperations.invoke("content_link_apply", { intent }, f.services)).rejects.toThrow("CONTENT_AUTHORITY_PIN_MISMATCH");
    expect(f.contentLinks.receipt).not.toHaveBeenCalled();
  });
});

describe("ContentLink host configuration", () => {
  it("requires a database when explicitly enabled", () => {
    expect(() => loadKnowledgeConfig({ KNOWLEDGE_CONTENT_LINKS_ENABLED: "1" })).toThrow("KNOWLEDGE_AUTHORITY_DATABASE_REQUIRED");
    expect(loadKnowledgeConfig({ KNOWLEDGE_CONTENT_LINKS_ENABLED: "0" })).toBeUndefined();
    expect(loadKnowledgeConfig({ KNOWLEDGE_DB_URL: "postgres://unused", KNOWLEDGE_CONTENT_LINKS_ENABLED: "1" })?.contentLinksEnabled).toBe(true);
  });

  it.each([undefined, "postgres://unused"])("rejects invalid enable syntax even with database %s", databaseUrl => {
    expect(() => loadKnowledgeConfig({ KNOWLEDGE_DB_URL: databaseUrl, KNOWLEDGE_CONTENT_LINKS_ENABLED: "true" })).toThrow("CONTENT_LINK_ENABLE_VALUE_INVALID");
  });

  const config: KnowledgeConfig = { databaseUrl: "postgres://unused", workspaceDir: "not-opened", artifactDir: "not-created",
    defaultTenantId: id(1), allowStale: false, evidenceOracle: "verification-store", contentLinksEnabled: true,
    missionId: id(2), producerAttemptId: id(3), storage: { projectUrl: "https://unused.invalid", secretKey: "synthetic" } };
  const verification = { store: { tenantId: id(1) } } as VerificationExecutor;

  it.each([
    { storage: undefined }, { missionId: undefined }, { producerAttemptId: undefined },
    { missionId: "invalid" }, { producerAttemptId: "invalid" }, { defaultTenantId: "invalid" },
  ])("rejects incomplete or malformed authority pins before constructing dependencies %#", override => {
    expect(() => createKnowledgeServices({ ...config, ...override }, { verification })).toThrow("CONTENT_LINK_HOST_PINS_REQUIRED");
  });

  it("requires the verifier and a digest for custom policies before opening the database", () => {
    expect(() => createKnowledgeServices(config)).toThrow("EVIDENCE_ORACLE_REQUIRED");
    expect(() => createKnowledgeServices({ ...config, evidencePolicyVersion: "custom.v1" }, { verification })).toThrow("EVIDENCE_POLICY_DIGEST_REQUIRED");
    expect(() => createKnowledgeServices({ ...config, evidencePolicyDigest: "invalid" }, { verification })).toThrow("EVIDENCE_NOT_AUTHORIZED");
  });
});
