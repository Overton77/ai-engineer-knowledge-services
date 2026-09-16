import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { digestCanonicalJson, sha256Digest } from "@aiengineer/knowledge-verification";
import { VerificationExecutor, loadExecutorConfig, type SemanticExecutionContext } from "./executor.js";
import { PolicyDefinitionInputSchema } from "./intents.js";
import { coverageFragments, createRootCoverageEvaluator, RootCoverageScopeSchema } from "./root-host-coverage.js";

it("retains every character across bounded fragments and rejects overflow without truncation", () => {
  const text = `${"a".repeat(3999)}🧪Cafe\u0301\r\n${"b".repeat(4000)}`;
  const fragments = coverageFragments(text);
  expect(fragments.join("")).toBe(text);
  expect(fragments.every(fragment => fragment.length <= 4000 && fragment.isWellFormed())).toBe(true);
  expect(coverageFragments("a".repeat(32000))).toHaveLength(8);
  expect(() => coverageFragments("a".repeat(32001))).toThrow("CAPACITY_EXCEEDED");
  expect(() => coverageFragments("")).toThrow("REPORT_EMPTY");
  expect(RootCoverageScopeSchema.safeParse({ questionId: "q", facets: [{ id: "f", proposition: "a".repeat(601), qualifiers: [] }] }).success).toBe(false);
});

it("seals fixed coverage facets, preserves missing facets and reuses the judged run (synthetic adapter)", async () => {
  let calls = 0;
  const executions: SemanticExecutionContext[] = [];
  const tenantId = randomUUID(), directory = await mkdtemp(join(tmpdir(), "ks-coverage-"));
  const verification = await VerificationExecutor.create({ ...loadExecutorConfig({ VERIFY_STORE_DIR: directory,
    VERIFY_TENANT_ID: tenantId, VERIFY_GIT_SHA: "synthetic-coverage-test", AI_GATEWAY_API_KEY: "synthetic-not-a-provider-key" }),
    semanticJudgeAdapterFactory: (config, context) => ({ identity: config.identity, maximumInputCharacters: 64000,
      judge: async input => {
        executions.push(context);
        expect(context.tenantId).toBe(tenantId);
        const state = await verification.store.readRun(context.runId);
        expect(context.resultArtifactId).toBe(state.resultArtifactId);
        expect((await verification.store.resolveHandle({ artifactId: context.resultArtifactId })).digest).toBe(context.resultDigest);
        calls++;
        const covered = input.fragments.some(fragment => fragment.exactText.includes(input.proposition));
        return { schemaVersion: "verification-semantic-judge.v1", assertionId: input.assertionId,
          verdict: covered ? "directly_supported" : "not_supported", nliLabel: covered ? "entailed" : "neutral",
          supportingFragmentIds: covered ? input.fragments.map(fragment => fragment.fragmentId) : [],
          contradictingFragmentIds: [], unsupportedFacets: covered ? [] : ["required_answer_facet"], qualifiersPreserved: true,
          publicRationale: "Deterministic synthetic coverage adapter; no provider or semantic-quality claim." };
      } }) });
  const policyDigest = digestCanonicalJson({ schemaVersion: "verification-policy.v1", definitionId: "policy-executor-default.v1",
    ...PolicyDefinitionInputSchema.parse({}) });
  const first = "Aurora introduced batch export on 2026-01-10.", second = "Batch export uses JSON Lines.";
  const completeId = randomUUID(), incompleteId = randomUUID();
  const evaluate = createRootCoverageEvaluator({ verification, tenantId, policyVersion: "executor-default.v1", policyDigest,
    scope: { questionId: "question", facets: [{ id: "date", proposition: first, qualifiers: [] },
      { id: "format", proposition: second, qualifiers: [] }] },
    loadReport: async id => {
      const markdown = `\n# 🧪 Cafe\u0301 report\r\n${"context ".repeat(600)}\n${id === completeId ? `${first}\n${second}` : first}\n`;
      return { artifactId: id, digest: sha256Digest(markdown), markdown };
    } });
  expect(await evaluate(completeId)).toMatchObject({ passed: true, facets: [{ id: "date", covered: true }, { id: "format", covered: true }] });
  expect(executions.length).toBeGreaterThan(0);
  const beforeReplay = calls;
  expect(await evaluate(completeId)).toMatchObject({ passed: true });
  expect(calls).toBe(beforeReplay);
  const completedRun = executions[0]!.runId;
  const firstSeal = await verification.sealRun({ runId: completedRun });
  expect(await verification.sealRun({ runId: completedRun })).toEqual(firstSeal);
  expect(await evaluate(incompleteId)).toMatchObject({ passed: false, facets: [{ id: "date", covered: true }, { id: "format", covered: false }] });
  const otherRun = executions.at(-1)!.runId;
  const otherState = await verification.store.readRun(otherRun);
  otherState.auditArtifactId = firstSeal.auditArtifactId;
  await verification.store.writeRun(otherState);
  await expect(verification.sealRun({ runId: otherRun })).rejects.toThrow("RUN_SEAL_REPLAY_CONFLICT");
});
