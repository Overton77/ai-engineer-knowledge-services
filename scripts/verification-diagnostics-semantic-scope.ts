import assert from "node:assert/strict";
import type { VerificationBenchmarkCase } from "@aiengineer/knowledge-contracts";

export type DiagnosticsSemanticScope = "full" | "missing_two";
export const missingSemanticCaseIds = Object.freeze([
  "gl-interested-comparison-mutated", "gl-repeatability-mutated",
] as const);

/** Validate the entire original dataset before selecting a bounded engineering attempt. */
export function selectDiagnosticsSemanticCases(v1: readonly VerificationBenchmarkCase[], scope: DiagnosticsSemanticScope): readonly VerificationBenchmarkCase[] {
  assert.ok(scope === "full" || scope === "missing_two", "DIAGNOSTICS_SEMANTIC_SCOPE_INVALID");
  assert.equal(v1.length, 40, "DIAGNOSTICS_V1_CASE_COUNT_REQUIRED");
  assert.equal(new Set(v1.map(item => item.caseId)).size, 40, "DIAGNOSTICS_V1_CASE_IDS_DUPLICATED");
  const clusters = new Map<string, number>();
  for (const item of v1) {
    assert.equal(item.evidence.length, 1, `DIAGNOSTICS_V1_SINGLE_EVIDENCE_REQUIRED:${item.caseId}`);
    assert.ok(item.assertion.length + item.evidence[0]!.excerpt.length <= 2_000, `DIAGNOSTICS_V1_CONTENT_BOUND:${item.caseId}`);
    clusters.set(item.pairCluster, (clusters.get(item.pairCluster) ?? 0) + 1);
  }
  assert.equal(clusters.size, 20, "DIAGNOSTICS_V1_PAIR_CLUSTER_COUNT_REQUIRED");
  for (const [cluster, count] of clusters) assert.equal(count, 2, `DIAGNOSTICS_V1_PAIR_CLUSTER_CARDINALITY:${cluster}`);
  const sorted = [...v1].sort((left, right) => left.caseId.localeCompare(right.caseId));
  if (scope === "full") return sorted;
  const selected = sorted.filter(item => (missingSemanticCaseIds as readonly string[]).includes(item.caseId));
  assert.deepEqual(selected.map(item => item.caseId), [...missingSemanticCaseIds], "DIAGNOSTICS_MISSING_TWO_EXACT_CASES_REQUIRED");
  return selected;
}
