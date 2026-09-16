import { describe, expect, it } from "vitest";
import type { PostgresCanonicalRepository } from "@aiengineer/knowledge-persistence";
import { canonicalUsage, createCanonicalRecoveryResultReader } from "./recovery-host-canonical.js";
import { loadKnowledgeConfig } from "./context.js";
import { recoveryHostOperations } from "./recovery-host-operations.js";
import { knowledgeOperations } from "./operations.js";

it("passes the original identity into native binding resolution and rejects a substituted original before reading evidence", async () => {
  const tenantId = "11111111-1111-4111-8111-111111111111";
  const operationId = "22222222-2222-4222-8222-222222222222";
  const inputDigest = `sha256:${"a".repeat(64)}`;
  const unexpected = async () => { throw new Error("UNEXPECTED_EVIDENCE_ACCESS"); };
  let seen: unknown;
  const read = createCanonicalRecoveryResultReader({ tenantId,
    database: { transaction: unexpected }, reads: { loadVerifiedClaimsReport: unexpected },
    custody: { lookup: unexpected, resolve: unexpected, register: unexpected },
    async binding(reference) {
      seen = reference;
      return { originalId: "first", binding: { claim: { statement: "shared", qualifiers: [] },
        evidence: [], captureDigests: [], policyDigest: inputDigest, profileDigest: inputDigest } };
    } });
  await expect(read({ tenantId, operationId, inputDigest, originalId: "second" })).rejects.toThrow("RECOVERY_NATIVE_ORIGINAL_MISMATCH");
  expect(seen).toEqual({ operationId, inputDigest, originalId: "second" });
});

it("keeps original requirements and permitted report runs in host configuration", () => {
  const operation = knowledgeOperations.get("report_assess");
  if (!operation) throw new Error("REPORT_ASSESS_OPERATION_MISSING");
  const reportVersionId = "11111111-1111-4111-8111-111111111111";
  expect(operation.input.safeParse({ reportVersionId }).success).toBe(true);
  for (const injected of [{ requirements: {} }, { runs: [] }, { authority: {} }, { verdict: "pass" }]) {
    expect(operation.input.safeParse({ reportVersionId, ...injected }).success).toBe(false);
  }
});

it("rejects authority configuration without its canonical database", () => {
  expect(() => loadKnowledgeConfig({ KNOWLEDGE_RECOVERY_CONFIG_JSON: "{}" })).toThrow("KNOWLEDGE_AUTHORITY_DATABASE_REQUIRED");
  expect(() => loadKnowledgeConfig({ KNOWLEDGE_REPORT_ASSESSMENT_PINS_JSON: "{}" })).toThrow("KNOWLEDGE_AUTHORITY_DATABASE_REQUIRED");
});

it("keeps execution results and authority grants out of public recovery requests", () => {
  for (const name of ["recovery_submit", "recovery_observe"]) {
    const operation = recoveryHostOperations.find(item => item.name === name)!;
    for (const injected of [{ verdict: "pass" }, { coveredQuestionIds: ["omitted"] }, { limits: {} }, { authorityArtifact: {} }]) {
      expect(operation.input.safeParse({ runId: "11111111-1111-4111-8111-111111111111", ...injected }).success).toBe(false);
    }
  }
});

function accounting(rows: { state: string; actual_cost_micros: number | string | null }[]) {
  return { transaction: async (_tenantId: string, work: (client: unknown) => Promise<unknown>) =>
    work({ query: async () => ({ rows }) }) } as unknown as Pick<PostgresCanonicalRepository, "transaction">;
}

describe("canonical recovery usage authority", () => {
  it("preserves unknown and uncertain charges instead of freeing a reservation", async () => {
    for (const row of [{ state: "uncertain", actual_cost_micros: null },
      { state: "dispatched", actual_cost_micros: 0 }, { state: "settled", actual_cost_micros: null }]) {
      expect(await canonicalUsage(accounting([row]), "tenant", "operation", true)).toBeNull();
    }
    expect(await canonicalUsage(accounting([]), "tenant", "operation", true)).toBeNull();
  });

  it("aggregates every settled provider attempt and permits verified provider-free absence", async () => {
    expect(await canonicalUsage(accounting([{ state: "settled", actual_cost_micros: "17" },
      { state: "settled", actual_cost_micros: 23 }]), "tenant", "operation", true))
      .toEqual({ calls: 2, costMicros: 40 });
    expect(await canonicalUsage(accounting([]), "tenant", "operation", false))
      .toEqual({ calls: 0, costMicros: 0 });
  });

  it("rejects corrupt or overflowing monetary values", async () => {
    for (const value of [-1, "not-a-cost", Number.MAX_SAFE_INTEGER + 1]) {
      await expect(canonicalUsage(accounting([{ state: "settled", actual_cost_micros: value }]), "tenant", "operation", true))
        .rejects.toThrow("RECOVERY_NATIVE_USAGE_INVALID");
    }
  });
});
