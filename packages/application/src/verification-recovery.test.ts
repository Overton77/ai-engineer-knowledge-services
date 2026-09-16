import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  type VerificationRecoveryAction, type VerificationRecoveryBatch, type VerificationRecoveryBinding,
  type VerificationRecoveryItem, type VerificationRecoveryPlan, type VerificationArtifactHandle, type VerificationRunManifest,
  type VerificationRecoveryInvalidation,
} from "@aiengineer/knowledge-contracts";
import { canonicalizeJson, sha256Digest, projectionSelectorResolver, digestCanonicalJson, verifyDeterministicBundle,
  createEd25519Signer, createEd25519Verifier, sealAuditBundle, verificationManifestDigest,
  type TrustedArtifactResolver, type VerificationAuditBundle } from "@aiengineer/knowledge-verification";
import {
  admitVerificationRecoveryPlan, composeVerificationFailureSet, reconcileVerificationRecoveryReceipt,
  evaluateVerificationRecoveryInvalidation,
  triageVerificationRecovery,
  type VerificationRecoveryAuthority, type VerificationRecoveryVerifiedResult,
} from "./verification-recovery.js";

const tenantId = "11111111-1111-4111-8111-111111111111";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = (value: unknown) => sha256Digest(canonicalizeJson(value));
const at = "2026-09-13T10:00:00.000Z";
const artifact = (n: number) => ({ artifactId: id(n), tenantId, digest: hash(n), mediaType: "application/json", byteLength: 1, objectKey: `test/${n}`, createdAt: at, producerActivityId: "test", producerVersion: "1", encryptionClass: "managed" as const, retentionClass: "audit" as const, dataClassification: "internal" as const, parentArtifactIds: [] });
const binding = (n: number): VerificationRecoveryBinding => ({ claim: { statement: `Metric ${n} is 10 for 2025`, qualifiers: ["2025"], value: 10 }, evidence: [{ representationDigest: hash("table"), contextDigest: hash("headers"), selector: { kind: "json_pointer", pointer: `/rows/${n}` } }], captureDigests: [hash("capture")], policyDigest: hash("policy"), profileDigest: hash("profile") });

it("triages the complete denominator using the same routes as admission", async () => {
  const originals = [item(1), item(2, "policy"), item(3, "contradicted"), item(4, "none")];
  originals[3]!.observation = goodResult(originals[3]!).observation;
  const h = harness(batch(originals));
  const result = await triageVerificationRecovery({ tenantId, batchId: "batch", authority: h.authority });
  expect(result.failureSet.counts.submitted).toBe(4);
  expect(result.failureSet.questionDenominator).toBe(4);
  expect(result.items.map(row => row.route)).toEqual(["repair", "operator", "reject", "preserve"]);
});
function item(n: number, family: VerificationRecoveryItem["observation"]["family"] = "selector"): VerificationRecoveryItem {
  const input = binding(n);
  return { originalId: `item-${n}`, questionIds: [`question-${n}`], inputDigest: hash(input), binding: input,
    observation: { operationId: id(n), runId: `run-${n}`, execution: "completed", mechanical: "failed", semantic: "locator_error", policy: "fail", family, earliestStage: "selector", signature: `signature-${family}`, dependencyIds: [], diagnosticArtifacts: [artifact(n)] },
    usedRounds: 0, attemptedInputDigests: [], attemptedRepairDigests: [] };
}
function batch(items: VerificationRecoveryItem[]): VerificationRecoveryBatch {
  return { tenantId, callerId: "caller", batchId: "batch", caseId: "case", parentAttemptId: "parent", recoveryPolicyVersion: "recovery.v1", capturedAt: at, closedAt: at,
    items, questionIds: items.flatMap(row => row.questionIds), requirements: items.flatMap(row => row.questionIds.map(questionId => ({ questionId, requirementId: `${questionId}-scope`, description: "Same metric, 2025, units and population" }))),
    limits: { maxRoundsPerOriginal: 2, maxProbeRounds: 1, remainingCalls: 200, remainingCostMicros: 100_000, deadline: "2026-09-14T00:00:00.000Z" }, allowedActions: ["repair", "seek_evidence"], probeRounds: [] };
}
function goodResult(original: VerificationRecoveryItem, material = original.binding): VerificationRecoveryVerifiedResult {
  return { tenantId, inputDigest: hash(material), binding: material,
    observation: { ...original.observation, operationId: material === original.binding ? original.observation.operationId : id(Number(original.observation.operationId.slice(-12)) + 1_000), mechanical: "passed", semantic: "directly_supported", policy: "pass", family: "none" },
    coveredRequirementIds: original.questionIds.map(question => `${question}-scope`), verifiedStages: ["capture", "parser", "selector", "mechanical", "semantic", "policy", "report"], revoked: false, usage: { calls: 1, costMicros: 10 } };
}
function harness(source: VerificationRecoveryBatch) {
  const results = new Map<string, VerificationRecoveryVerifiedResult>();
  const plans = new Map<string, VerificationRecoveryPlan>();
  const invalidations = new Map<string, VerificationRecoveryInvalidation>();
  const probes = new Map<string, Awaited<ReturnType<VerificationRecoveryAuthority["readProbe"]>>>();
  let clock = at;
  const authority: VerificationRecoveryAuthority = {
    now: () => clock,
    async readBatch() { return structuredClone(source); },
    async readPlan({ planDigest }) { const plan = plans.get(planDigest); if (!plan) throw new Error("missing plan"); return structuredClone(plan); },
    async readInvalidation(request) {
      const existing = invalidations.get(request.planDigest);
      if (existing) return structuredClone(existing);
      const empty = { schemaVersion: "verification-recovery-invalidation.v1" as const, ...request, complete: true as const, evaluations: [], invalidatedOutputIds: [], revalidatedOutputIds: [], blockedOutputIds: [] };
      return { ...empty, payloadDigest: hash(empty) };
    },
    async readResult({ inputDigest }) { return structuredClone(results.get(inputDigest) ?? null); },
    async readProbe({ artifact: ref }) { const receipt = probes.get(ref.artifactId); if (!receipt) throw new Error("missing probe"); return structuredClone(receipt); },
  };
  async function plan(actions: VerificationRecoveryAction[], selectedProbes: VerificationRecoveryPlan["probes"] = []) {
    const set = await composeVerificationFailureSet({ tenantId, batchId: source.batchId, authority });
    const admitted = await admitVerificationRecoveryPlan({ failureSet: set, authority, actions, probes: selectedProbes, reservation: { calls: actions.filter(action => action.newBinding).length, costMicros: 1_000 } });
    plans.set(admitted.payloadDigest, admitted);
    return { set, admitted };
  }
  return { authority, source, results, plans, invalidations, probes, plan, setClock: (value: string) => { clock = value; } };
}
function action(original: VerificationRecoveryItem, route: VerificationRecoveryAction["route"] = "repair"): VerificationRecoveryAction {
  return { originalId: original.originalId, route, reason: "Repair locator against preserved source", diagnosticArtifactIds: original.observation.diagnosticArtifacts.map(row => row.artifactId),
    rerunStages: route === "repair" || route === "seek_evidence" ? ["selector", "mechanical", "semantic", "policy", "report"] : [],
    ...(route === "repair" || route === "seek_evidence" ? { newBinding: { ...original.binding, evidence: [{ ...original.binding.evidence[0]!, selector: { kind: "json_pointer" as const, pointer: "/corrected" } }] } } : {}) };
}
async function receipt(h: ReturnType<typeof harness>, planned: Awaited<ReturnType<ReturnType<typeof harness>["plan"]>>) {
  return reconcileVerificationRecoveryReceipt({ failureSet: planned.set, plan: planned.admitted, authority: h.authority });
}

describe("verification recovery contracts through trusted application reads", () => {
  it("F09 / RC01 repairs actual wrong table context without guessing or dropping the original question", async () => {
    const representation = new TextEncoder().encode(canonicalizeJson({ kind: "table", tables: [{ tableId: "metrics", cells: [
      { row: 0, column: 0, value: "10", headerPath: ["Accuracy", "2025", "percent"] },
      { row: 0, column: 1, value: "90", headerPath: ["Recall", "2025", "percent"] },
    ] }] }));
    const original = item(1);
    original.binding.evidence = [{ representationDigest: sha256Digest(representation), contextDigest: hash("omitted headers"), selector: { kind: "table", tableId: "metrics", row: 0, column: 1, headerPath: ["Accuracy"], expectedCellValue: "10" } }];
    original.inputDigest = hash(original.binding);
    const request = (selector: VerificationRecoveryBinding["evidence"][number]["selector"]) => ({ captureId: "capture", representationArtifactId: id(500), representationDigest: sha256Digest(representation), content: representation, selector });
    expect(projectionSelectorResolver.resolve(request(original.binding.evidence[0]!.selector)).resolution.status).toBe("invalid");
    const repair = action(original);
    repair.newBinding!.evidence = [{ representationDigest: sha256Digest(representation), contextDigest: hash("Accuracy 2025 percent"), selector: { kind: "table", tableId: "metrics", row: 0, column: 0, headerPath: ["Accuracy", "2025", "percent"], expectedCellValue: "10" } }];
    expect(projectionSelectorResolver.resolve(request(repair.newBinding!.evidence[0]!.selector)).resolution.status).toBe("resolved");
    expect(projectionSelectorResolver.resolve(request({ kind: "table", tableId: "metrics", row: 0, column: 0, headerPath: ["Accuracy", "2025", "percent"], expectedCellValue: "99" })).resolution.status).toBe("invalid");
    const h = harness(batch([original])), planned = await h.plan([repair]);
    h.results.set(hash(repair.newBinding), goodResult(original, repair.newBinding));
    const result = await receipt(h, planned);
    expect(result.results[0]).toMatchObject({ outcome: "recovered_admitted", originalInputDigest: original.inputDigest, questionIds: original.questionIds, usedRounds: 1 });
    expect(planned.set.batch.items[0]!.observation.diagnosticArtifacts).toEqual(original.observation.diagnosticArtifacts);
    expect(result.coveredQuestionIdsAfter).toEqual(original.questionIds);
    const invalid = { ...repair, rerunStages: ["semantic", "policy"] as VerificationRecoveryAction["rerunStages"] };
    await expect(h.plan([invalid])).rejects.toThrow("DEPENDENT_STAGES_REQUIRED");
  });

  it("RC02 fresh different capture retains historical gap even with a passing candidate", async () => {
    const original = item(1, "capture"), source = batch([original]);
    source.requirements[0]!.historicalCaptureDigest = original.binding.captureDigests[0];
    const h = harness(source), repair = action(original);
    repair.newBinding!.captureDigests = [hash("fresh different content")];
    repair.rerunStages = ["capture", "parser", "selector", "mechanical", "semantic", "policy", "report"];
    const planned = await h.plan([repair]);
    h.results.set(hash(repair.newBinding), goodResult(original, repair.newBinding));
    expect((await receipt(h, planned)).results[0]).toMatchObject({ outcome: "partial_support", gapRequirementIds: ["question-1-scope"] });
  });

  it("RC03 rejects unchanged bindings, judge/profile switches and repeated inputs before reading new results", async () => {
    const original = item(1), h = harness(batch([original])), repair = action(original);
    await expect(h.plan([{ ...repair, newBinding: original.binding }])).rejects.toThrow("NO_OP");
    await expect(h.plan([{ ...repair, newBinding: { ...original.binding, profileDigest: hash("other judge") } }])).rejects.toThrow("POLICY_OR_PROFILE");
    h.source.items[0]!.attemptedInputDigests = [hash(repair.newBinding)];
    await expect(h.plan([repair])).rejects.toThrow("REPEATED_INPUT");
  });

  it("RC04 preserves held policy and routes adjudication without resubmission or weaker policy", async () => {
    const original = item(1); original.observation.policy = "review";
    const h = harness(batch([original]));
    await expect(h.plan([action(original)])).rejects.toThrow("UNSAFE_ROUTE");
    const planned = await h.plan([action(original, "adjudicate")]);
    expect((await receipt(h, planned)).results[0]!.outcome).toBe("review_required");
    original.observation.policy = "fail";
    const repair = action(original); repair.newBinding!.policyDigest = hash("weaker");
    await expect(harness(batch([original])).plan([repair])).rejects.toThrow("POLICY_OR_PROFILE");
  });

  it("RC05 establishes rejection without coverage credit; RC06 preserves narrowed scope gaps", async () => {
    const falseClaim = item(1, "contradicted"), narrower = item(2, "context");
    const h = harness(batch([falseClaim, narrower])), repair = action(narrower);
    const planned = await h.plan([action(falseClaim, "reject"), repair]);
    h.results.set(hash(repair.newBinding), { ...goodResult(narrower, repair.newBinding), coveredRequirementIds: [] });
    const result = await receipt(h, planned);
    expect(result.results.map(row => row.outcome)).toEqual(["resolved_rejected", "partial_support"]);
    expect(result.questionDenominator).toBe(2);
    expect(result.remainingQuestionIds).toEqual(["question-1", "question-2"]);
  });

  it("RC11 reconciles committed original operation after timeout without another semantic attempt", async () => {
    const original = item(1, "execution"); original.observation.execution = "unknown";
    const h = harness(batch([original])), planned = await h.plan([action(original, "reconcile")]);
    h.results.set(original.inputDigest, { ...goodResult(original), observation: { ...goodResult(original).observation, execution: "completed" } });
    const result = await receipt(h, planned);
    expect(result.results[0]).toMatchObject({ outcome: "preserved_admitted", outputInputDigest: original.inputDigest, usedRounds: 0 });
    expect(result.usage).toEqual({ calls: 0, costMicros: 0 });
    expect(result.results[0]!.artifacts[0]!.artifactId).toBe(original.observation.diagnosticArtifacts[0]!.artifactId);
  });

  it("RC12 checkpoints every exhausted, held and cancelled member; prior rounds survive group splitting", async () => {
    const exhausted = item(1), held = item(2), cancelled = item(3);
    exhausted.usedRounds = 2; exhausted.attemptedInputDigests = [hash("old1"), hash("old2")];
    held.observation.policy = "review"; cancelled.observation.execution = "cancelled";
    const h = harness(batch([exhausted, held, cancelled]));
    await expect(h.plan([action(exhausted), action(held, "adjudicate"), action(cancelled, "cancelled")])).rejects.toThrow("UNSAFE_ROUTE");
    const planned = await h.plan([action(exhausted, "exhausted"), action(held, "adjudicate"), action(cancelled, "cancelled")]);
    h.setClock("2026-09-15T00:00:00.000Z");
    const result = await receipt(h, planned);
    expect(result.results.map(row => row.outcome)).toEqual(["exhausted", "review_required", "cancelled"]);
    expect(result.results[0]!.attemptedInputDigests).toEqual(exhausted.attemptedInputDigests);
    expect(result.checkpointReferences).toContain(held.observation.operationId);
    expect(result.questionDenominator).toBe(3);
  });

  it("retains all terminal denominator members and rejects caller denominator, tenant and plan manipulation", async () => {
    const items = Array.from({ length: 30 }, (_, index) => item(index + 1));
    for (const row of items.slice(0, 4)) row.observation = goodResult(row).observation;
    for (const row of items.slice(9, 29)) row.observation.policy = "review";
    items[29]!.observation.execution = "cancelled";
    const h = harness(batch(items));
    const set = await composeVerificationFailureSet({ tenantId, batchId: "batch", authority: h.authority });
    expect(set.failureRatio).toBe(5 / 30); expect(set.cohortTriage).toBe(false);
    expect(Object.isFrozen(set.batch.items)).toBe(true);
    await expect(admitVerificationRecoveryPlan({ failureSet: { ...set, questionDenominator: 1 }, actions: [], probes: [], reservation: { calls: 0, costMicros: 0 }, authority: h.authority })).rejects.toThrow();
    const original = item(100), second = harness(batch([original])), planned = await second.plan([action(original)]);
    await expect(reconcileVerificationRecoveryReceipt({ failureSet: planned.set, plan: { ...planned.admitted, caseId: "foreign" }, authority: second.authority })).rejects.toThrow("PLAN_BINDING");
    second.source.items[0]!.observation.diagnosticArtifacts[0]!.tenantId = id(999);
    await expect(composeVerificationFailureSet({ tenantId, batchId: "batch", authority: second.authority })).rejects.toThrow();
  });

  it("rejects missing independent semantic proof, actual overspend and reused original operations", async () => {
    const original = item(1), h = harness(batch([original])), repair = action(original), planned = await h.plan([repair]);
    const result = goodResult(original, repair.newBinding);
    h.results.set(result.inputDigest, { ...result, verifiedStages: ["mechanical", "policy"] });
    await expect(receipt(h, planned)).rejects.toThrow("RESULT_PROOF_REQUIRED");
    h.results.set(result.inputDigest, { ...result, usage: { calls: 2, costMicros: 10 } });
    await expect(receipt(h, planned)).rejects.toThrow("ACTUAL_USAGE_EXCEEDED");
    h.results.set(result.inputDigest, { ...result, observation: { ...result.observation, operationId: original.observation.operationId } });
    await expect(receipt(h, planned)).rejects.toThrow("CHANGED_INPUT_OPERATION_REUSED");
    h.results.set(result.inputDigest, { ...result, revoked: true });
    expect((await receipt(h, planned)).results[0]!.outcome).toBe("operator_required");
    const { revoked: _revoked, ...withoutRevocation } = result;
    h.results.set(result.inputDigest, withoutRevocation as VerificationRecoveryVerifiedResult);
    await expect(receipt(h, planned)).rejects.toThrow();
    h.results.set(result.inputDigest, { ...result, observation: { ...result.observation, mechanical: "failed", policy: "fail", family: "selector" } });
    const failedRound = await receipt(h, planned);
    expect(failedRound.results[0]!.outcome).toBe("unresolved_gap");
    expect(failedRound.results[0]!.usedRounds).toBe(1);
  });

  it("retains uncertain spending and snapshots caller data across asynchronous reads", async () => {
    const original = item(1), h = harness(batch([original])), repair = action(original);
    const pending = h.plan([repair]);
    repair.reason = "Changed before plan captures caller data";
    const planned = await pending;
    const receiptInput = { failureSet: planned.set, plan: structuredClone(planned.admitted), authority: h.authority };
    const pendingReceipt = reconcileVerificationRecoveryReceipt(receiptInput);
    receiptInput.plan.caseId = "forged while reading";
    const result = await pendingReceipt;
    expect(result.results[0]!.outcome).toBe("reconciliation_unresolved");
    expect(result.retainedReservation).toEqual(planned.admitted.reservation);
    expect(result.remainingLimits.remainingCalls).toBe(h.source.limits.remainingCalls - planned.admitted.reservation.calls);
  });
});

function cohort() {
  const items = Array.from({ length: 40 }, (_, index) => item(index + 1, index < 18 ? "selector" : index < 24 ? "context" : index < 28 ? "unsupported" : "none"));
  for (const row of items.slice(0, 18)) row.observation.dependencyIds = ["pdf-conversion"];
  for (const row of items.slice(28)) row.observation = goodResult(row).observation;
  const h = harness(batch(items));
  const actions = items.map((row, index) => action(row, index < 24 ? "repair" : index < 28 ? "gap" : "preserve"));
  const repArtifact = artifact(700), controlArtifact = artifact(701);
  const probe = { dependencyId: "pdf-conversion", representativeIds: ["item-1"], controlId: "item-29", receiptArtifacts: [repArtifact, controlArtifact] };
  for (const [index, ref] of [[0, repArtifact], [28, controlArtifact]] as const) h.probes.set(ref.artifactId, {
    tenantId, dependencyId: probe.dependencyId, originalId: items[index]!.originalId,
    inputDigest: hash(actions[index]!.newBinding ?? items[index]!.binding), signature: items[index]!.observation.signature, passed: true, artifactDigest: ref.digest,
    operationId: index === 0 ? id(1001) : id(29), calls: index === 0 ? 1 : 0, costMicros: index === 0 ? 10 : 0, caseId: "case", recoveryPolicyVersion: "recovery.v1",
  });
  for (const [index, original] of items.entries()) if (index < 24 || index >= 28) {
    const material = actions[index]!.newBinding ?? original.binding;
    h.results.set(hash(material), goodResult(original, material));
  }
  return { h, actions, probe };
}

describe("bounded recovery cohorts", () => {
  it("RC07 probes shared failures, individually verifies all 24 repairs and preserves 4 gaps plus 12 passes", async () => {
    const { h, actions, probe } = cohort();
    await expect(h.plan(actions)).rejects.toThrow("SHARED_PROBE_REQUIRED");
    const planned = await h.plan(actions, [probe]), result = await receipt(h, planned);
    expect(result.results).toHaveLength(40);
    expect(result.results.filter(row => row.outcome === "recovered_admitted")).toHaveLength(24);
    expect(result.results.filter(row => row.outcome === "preserved_admitted")).toHaveLength(12);
    expect(result.remainingQuestionIds).toHaveLength(4);
    expect(result.probeRounds).toEqual([{ dependencyId: "pdf-conversion", used: 1, receiptDigests: probe.receiptArtifacts.map(artifact => artifact.digest) }]);
    h.results.delete(hash(actions[17]!.newBinding));
    const missing = await receipt(h, planned);
    expect(missing.results[17]!.outcome).toBe("reconciliation_unresolved");
    expect(missing.results.filter(row => row.outcome === "recovered_admitted")).toHaveLength(23);
    expect(missing.results).toHaveLength(40);
    expect(missing.retainedReservation.calls).toBe(1);
  });

  it("RC08 rejects failed or mixed probes, missing controls and reset probe counters", async () => {
    const { h, actions, probe } = cohort();
    h.probes.get(probe.receiptArtifacts[0]!.artifactId)!.passed = false;
    await expect(h.plan(actions, [probe])).rejects.toThrow("PROBE_NOT_VERIFIED");
    h.probes.get(probe.receiptArtifacts[0]!.artifactId)!.passed = true;
    h.source.items[1]!.observation.signature = "different-cause";
    await expect(h.plan(actions, [probe])).rejects.toThrow("PROBE_SIGNATURE_MISSING");
    h.source.items[1]!.observation.signature = h.source.items[0]!.observation.signature;
    const { controlId: _control, ...withoutControl } = probe;
    await expect(h.plan(actions, [withoutControl])).rejects.toThrow("PROBE_CONTROL_REQUIRED");
    h.source.probeRounds = [{ dependencyId: "pdf-conversion", used: 2, receiptDigests: [] }];
    await expect(h.plan(actions, [probe])).rejects.toThrow("PROBE_LIMIT");
    h.source.probeRounds = [{ dependencyId: "pdf-conversion", used: 1, receiptDigests: [hash("different prior probe")] }];
    await expect(h.plan(actions, [probe])).rejects.toThrow("PROBE_ROUND_RESET");
    const splitActions: VerificationRecoveryAction[] = actions.map(({ newBinding: _binding, ...row }) => ({ ...row, route: "operator" as const, rerunStages: [] }));
    for (let index = 24; index < 28; index++) splitActions[index] = { ...splitActions[index]!, route: "operator" };
    for (let index = 28; index < 40; index++) splitActions[index] = actions[index]!;
    const planned = await h.plan(splitActions);
    expect((await receipt(h, planned)).results).toHaveLength(40);
  });
});
const createdAt = "2026-09-05T02:00:00.000Z";
const policyBytes = new TextEncoder().encode('{"policy":"component drift fixture","version":"verification-policy-0.1.0"}');
const tenantA = "11111111-1111-4111-8111-111111111111";

function auditFixture(overrides: Partial<{ provider: string; model: string; parser: string; grader: string; policy: string; tenantId: string }> = {}) {
  // Frozen test data from the core parity fixture, without importing another package's source tree.
  const input = JSON.parse(readFileSync(new URL("./fixtures/component-drift-input.json", import.meta.url), "utf8")) as Parameters<typeof verifyDeterministicBundle>[0];
  const tenantId = overrides.tenantId ?? tenantA;
  const source = { ...input.bundle.captures[0]!.contentArtifact, tenantId };
  const bundle = structuredClone(input.bundle);
  bundle.captures[0]!.contentArtifact = source;
  bundle.policyVersion = overrides.policy ?? bundle.policyVersion;
  const deterministicResult = verifyDeterministicBundle({ ...input, bundle });
  const policyArtifact: VerificationArtifactHandle = { artifactId: "44444444-4444-4444-8444-444444444444", tenantId, digest: sha256Digest(policyBytes), mediaType: "application/json", byteLength: policyBytes.byteLength, objectKey: `${tenantId}/policy`, createdAt, producerActivityId: "policy-publisher", producerVersion: "1", encryptionClass: "managed", retentionClass: "audit", dataClassification: "internal", parentArtifactIds: [] };
  const inputsBytes = new TextEncoder().encode(JSON.stringify({ schemaVersion: "verification-policy-inputs.v1", policyVersion: bundle.policyVersion, runId: "run-1", recordedAt: createdAt, deterministicResult, assertions: [{ assertionId: "claim-1", riskClass: "medium", downstreamUse: ["semantic_verification"], claimScope: "source_summary", semantic: { assertionId: "claim-1", verdict: "pending_semantic_review", disposition: "review", evidenceSupport: "not_assessed", worldCorrectness: "not_assessed", attributionFaithfulness: "not_assessed", provenanceIntegrity: "satisfied", sourceAuthority: "not_assessed", judgeIdentities: [], supportingFragmentIds: ["fragment-evidence-1"], contradictingFragmentIds: [], unsupportedFacets: [], reasonCodes: [], crossFamilySecondJudge: false, rawProviderConfidences: [] }, authorityStatus: "unknown", independentCorroboration: false, conflictPresent: false, criticalFactsKnown: true }], metrics: [], sourceAssessments: [] }));
  const inputsArtifact: VerificationArtifactHandle = { ...policyArtifact, artifactId: "55555555-5555-4555-8555-555555555555", digest: sha256Digest(inputsBytes), byteLength: inputsBytes.byteLength, objectKey: `${tenantId}/inputs`, producerActivityId: "policy-input-recorder" };
  const manifest: VerificationRunManifest = { verificationContractVersion: "verification.v1", manifestId: `manifest-${tenantId}`, runId: "run-1", versions: { policy: overrides.policy ?? input.bundle.policyVersion, schema: "verification.v1", normalizer: "text.v1", parser: overrides.parser ?? "parser.v1", grader: overrides.grader ?? "grader.v1" }, code: { gitSha: "fixture-sha", dirty: false }, runtime: { platform: "test", deploymentId: "verification-agent" }, provider: { endpointIdentity: overrides.provider ?? "fixture-provider", model: overrides.model ?? "fixture-model", nativeConfiguration: { tokenUsage: 1, inputTokens: 1, outputTokens: 0 }, pricingSnapshotArtifactId: policyArtifact.artifactId }, inputArtifacts: [source, policyArtifact, inputsArtifact], outputArtifacts: [], stages: [{ name: "deterministic", status: "succeeded", startedAt: createdAt, endedAt: createdAt }], calls: [], toolPolicy: [], networkPolicy: "disabled", deterministicResult, judgments: [], policyOutcome: "pass", resultDigest: digestCanonicalJson(deterministicResult), lineage: [], canonicalization: { algorithm: "RFC8785", implementationVersion: "knowledge-verification.v1", manifestDigest: sha256Digest("") }, startedAt: createdAt, completedAt: createdAt };
  manifest.canonicalization.manifestDigest = verificationManifestDigest(manifest);
  return { input, bundle, manifest, tenantId, policyArtifact, inputsArtifact, inputsBytes };
}

async function signedAudit(overrides: Parameters<typeof auditFixture>[0] = {}, signer = createEd25519Signer(generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString(), "audit-key")) {
  const raw = auditFixture(overrides);
  const audit = await sealAuditBundle({ tenantId: raw.tenantId, verificationBundle: raw.bundle, manifest: raw.manifest, policyBinding: { policyVersion: raw.bundle.policyVersion, policyArtifact: raw.policyArtifact, recordedPolicyInputsArtifact: raw.inputsArtifact }, recordedPolicyInputsBytes: raw.inputsBytes, policyDecision: { outcome: "pass" }, signer }) as unknown as VerificationAuditBundle;
  return { audit, signer };
}

function resolverFor(entries: Map<string, { artifact: VerificationArtifactHandle; bytes: Uint8Array }>): TrustedArtifactResolver {
  const stable = new Map([...entries].map(([key, row]) => [key, { artifact: structuredClone(row.artifact), bytes: row.bytes.slice() }] as const));
  return { async authorizeArtifact(input) { if (!stable.has(input.artifactId)) throw new Error("UNAUTHORIZED_ARTIFACT"); }, async hydrateRegisteredArtifact(input) { const row = stable.get(input.artifactId); if (!row) throw new Error("MISSING_ARTIFACT"); return { registration: row.artifact, bytes: row.bytes.slice() }; } };
}

async function pair(changes: Parameters<typeof auditFixture>[0] = { provider: "provider.changed", model: "model.changed", parser: "parser.changed", grader: "grader.changed", policy: "verification-policy.changed" }) {
  const keys = generateKeyPairSync("ed25519");
  const privatePem = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicPem = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const signer = createEd25519Signer(privatePem, "audit-key");
  const verifier = createEd25519Verifier({ "audit-key": publicPem });
  const baseline = await signedAudit({}, signer);
  const candidate = await signedAudit(changes, signer);
  const make = (audit: VerificationAuditBundle, artifactId: string) => { const bytes = new TextEncoder().encode(canonicalizeJson(audit)); const artifact: VerificationArtifactHandle = { artifactId, tenantId: audit.tenantId, digest: sha256Digest(bytes), mediaType: "application/json", byteLength: bytes.byteLength, objectKey: `${audit.tenantId}/${artifactId}`, createdAt, producerActivityId: "audit-fixture", producerVersion: "1", encryptionClass: "managed", retentionClass: "audit", dataClassification: "internal", parentArtifactIds: [] }; return { artifact, bytes }; };
  const b = make(baseline.audit, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"); const c = make(candidate.audit, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  const entries = new Map([[b.artifact.artifactId, b], [c.artifact.artifactId, c]]);
  return { baseline: b, candidate: c, verifier, resolver: () => resolverFor(entries), signer };
}

describe("F13 authenticated dependency invalidation and reuse eligibility", () => {
  it("F13 receipt binds real signed invalidation, exact revalidated closure and complete trusted empty results", async () => {
    const original = item(1), h = harness(batch([original])), repair = action(original), planned = await h.plan([repair]);
    h.results.set(hash(repair.newBinding), goodResult(original, repair.newBinding));
    const empty = await receipt(h, planned);
    expect(empty.invalidatedOutputIds).toEqual([]);
    expect(empty.invalidationDigest).toMatch(/^sha256:/);
    const signed = await pair({ parser: "parser.changed" });
    const graph = { tenantId, caseId: "case", planDigest: planned.admitted.payloadDigest, baselineAuditDigest: signed.baseline.artifact.digest,
      rootIds: ["prior-claim"], nodes: [
        { id: "prior-claim", dependencyIds: [], admissionAuditDigest: signed.candidate.artifact.digest, revoked: false, revalidatedStages: goodResult(original).verifiedStages },
        { id: "prior-report", dependencyIds: ["prior-claim"], admissionAuditDigest: signed.baseline.artifact.digest, revoked: false, revalidatedStages: [] as VerificationRecoveryVerifiedResult["verifiedStages"] },
      ] };
    const invalidationInput = { caseId: "case", planDigest: planned.admitted.payloadDigest, baseline: { artifact: signed.baseline.artifact }, candidate: { artifact: signed.candidate.artifact }, createResolver: signed.resolver, verifier: signed.verifier, readDependencyGraph: async () => graph };
    const partial = await evaluateVerificationRecoveryInvalidation(invalidationInput);
    h.invalidations.set(planned.admitted.payloadDigest, partial);
    const partiallyRevalidated = await receipt(h, planned);
    expect(partiallyRevalidated.invalidatedOutputIds).toEqual(["prior-claim", "prior-report"]);
    expect(partiallyRevalidated.revalidatedOutputIds).toEqual(["prior-claim"]);
    expect(partiallyRevalidated.invalidationObservationDigests).toEqual([partial.evaluations[0]!.observation.payloadDigest]);
    graph.nodes[1]!.admissionAuditDigest = signed.candidate.artifact.digest;
    graph.nodes[1]!.revalidatedStages = goodResult(original).verifiedStages;
    const complete = await evaluateVerificationRecoveryInvalidation(invalidationInput);
    h.invalidations.set(planned.admitted.payloadDigest, complete);
    expect((await receipt(h, planned)).revalidatedOutputIds).toEqual(["prior-claim", "prior-report"]);

    const reseal = (value: VerificationRecoveryInvalidation) => { const { payloadDigest: _digest, ...body } = value; return { ...body, payloadDigest: hash(body) }; };
    for (const change of [{ tenantId: id(999) }, { caseId: "wrong-case" }, { planDigest: hash("wrong-plan") }]) {
      h.invalidations.set(planned.admitted.payloadDigest, reseal({ ...complete, ...change }));
      await expect(receipt(h, planned)).rejects.toThrow("INVALIDATION_BINDING");
    }
    h.invalidations.set(planned.admitted.payloadDigest, reseal({ ...partial, revalidatedOutputIds: ["prior-claim", "prior-report"] }));
    await expect(receipt(h, planned)).rejects.toThrow("INVALIDATION_CLOSURE");
    h.invalidations.set(planned.admitted.payloadDigest, reseal({ ...complete, invalidatedOutputIds: ["prior-claim"] }));
    await expect(receipt(h, planned)).rejects.toThrow("INVALIDATION_CLOSURE");
    const observationTamper = structuredClone(complete);
    observationTamper.evaluations[0]!.observation.candidate.auditBundleArtifact.digest = hash("different signed observation");
    h.invalidations.set(planned.admitted.payloadDigest, reseal(observationTamper));
    await expect(receipt(h, planned)).rejects.toThrow("DRIFT_OBSERVATION_BINDING");
    h.invalidations.set(planned.admitted.payloadDigest, { ...complete, complete: false } as unknown as VerificationRecoveryInvalidation);
    await expect(receipt(h, planned)).rejects.toThrow();
  });

  it.each(["parser", "model", "grader", "policy"] as const)("blocks stale decisions after signed %s drift until the exact dependent candidate is revalidated", async dimension => {
    const signed = await pair({ [dimension]: `${dimension}.changed` });
    const graph = { tenantId, caseId: "case", planDigest: hash("plan"), baselineAuditDigest: signed.baseline.artifact.digest,
      rootIds: ["claim"], nodes: [
        { id: "claim", dependencyIds: [], admissionAuditDigest: signed.baseline.artifact.digest, revoked: false, revalidatedStages: [] as VerificationRecoveryVerifiedResult["verifiedStages"] },
        { id: "report", dependencyIds: ["claim"], admissionAuditDigest: signed.baseline.artifact.digest, revoked: false, revalidatedStages: [] as VerificationRecoveryVerifiedResult["verifiedStages"] },
        { id: "independent", dependencyIds: [], admissionAuditDigest: hash("unrelated"), revoked: false, revalidatedStages: [] as VerificationRecoveryVerifiedResult["verifiedStages"] },
      ] };
    const input = { caseId: "case", planDigest: hash("plan"), baseline: { artifact: signed.baseline.artifact }, candidate: { artifact: signed.candidate.artifact }, createResolver: signed.resolver, verifier: signed.verifier, readDependencyGraph: async () => graph };
    const stale = await evaluateVerificationRecoveryInvalidation(input);
    expect(stale.blockedOutputIds).toEqual(["claim", "report"]);
    expect(stale.invalidatedOutputIds).not.toContain("independent");
    graph.nodes[0]!.admissionAuditDigest = signed.candidate.artifact.digest;
    graph.nodes[0]!.revalidatedStages = goodResult(item(1)).verifiedStages;
    expect((await evaluateVerificationRecoveryInvalidation(input)).blockedOutputIds).toEqual(["report"]);
    graph.nodes[1]!.admissionAuditDigest = signed.candidate.artifact.digest;
    graph.nodes[1]!.revalidatedStages = goodResult(item(1)).verifiedStages;
    expect((await evaluateVerificationRecoveryInvalidation(input)).blockedOutputIds).toEqual([]);
  });

  it("revoked binding blocks publication even with unchanged signed versions and a claimed passing replacement", async () => {
    const signed = await pair({});
    const graph = { tenantId, caseId: "case", planDigest: hash("plan"), baselineAuditDigest: signed.baseline.artifact.digest, rootIds: ["claim"], nodes: [
      { id: "claim", dependencyIds: [], admissionAuditDigest: signed.candidate.artifact.digest, revoked: true, revalidatedStages: ["policy", "report"] as const },
      { id: "report", dependencyIds: ["claim"], admissionAuditDigest: signed.candidate.artifact.digest, revoked: false, revalidatedStages: ["policy", "report"] as const },
    ] };
    const result = await evaluateVerificationRecoveryInvalidation({ caseId: "case", planDigest: hash("plan"), baseline: { artifact: signed.baseline.artifact }, candidate: { artifact: signed.candidate.artifact }, createResolver: signed.resolver, verifier: signed.verifier, readDependencyGraph: async () => graph });
    expect(result.blockedOutputIds).toEqual(["claim", "report"]);
    expect(result.revalidatedOutputIds).toEqual([]);
  });

  it("rejects forged audit registrations and unrelated/incomplete trusted dependency projections", async () => {
    const signed = await pair();
    const graph = { tenantId, caseId: "case", planDigest: hash("plan"), baselineAuditDigest: signed.baseline.artifact.digest, rootIds: ["claim"], nodes: [{ id: "claim", dependencyIds: [], admissionAuditDigest: signed.baseline.artifact.digest, revoked: false, revalidatedStages: [] }] };
    const input = { caseId: "case", planDigest: hash("plan"), baseline: { artifact: signed.baseline.artifact }, candidate: { artifact: signed.candidate.artifact }, createResolver: signed.resolver, verifier: signed.verifier, readDependencyGraph: async () => graph };
    await expect(evaluateVerificationRecoveryInvalidation({ ...input, candidate: { artifact: { ...signed.candidate.artifact, digest: hash("forged") } } })).rejects.toThrow("COMPONENT_DRIFT");
    await expect(evaluateVerificationRecoveryInvalidation({ ...input, readDependencyGraph: async () => ({ ...graph, baselineAuditDigest: hash("unrelated") }) })).rejects.toThrow("DEPENDENCY_GRAPH_BINDING");
    await expect(evaluateVerificationRecoveryInvalidation({ ...input, readDependencyGraph: async () => ({ ...graph, rootIds: ["missing"] }) })).rejects.toThrow("DEPENDENCY_GRAPH_INCOMPLETE");
  });
});


