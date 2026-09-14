import { canonicalizeJson, digestCanonicalJson, sha256Digest, validateRecordedPolicyInputsArtifact, verifyAssertionSemantics } from "@aiengineer/knowledge-verification";
import { PolicyDefinitionInputSchema } from "../intents.js";
import { knowledgeOperations } from "./operations.js";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { admissionIssues, proposalEffect, IngestionIntentSchema } from "@aiengineer/knowledge-ingestion";
import { SemanticAssessmentRecordSchema, type VerificationBundle, type DeterministicVerificationResult, type VerificationRecordedPolicyInputs } from "@aiengineer/knowledge-contracts";
import { loadExecutorConfig, VerificationExecutor } from "../executor.js";
import { verificationStoreOracle } from "./evidence-oracle.js";
import { createKnowledgeServices, loadKnowledgeConfig, type KnowledgeServices } from "./context.js";

const tenantId = "00000000-0000-4000-8000-000000000011";
const statement = "Synthetic source says the system is available in preview.";
const policyDigest = (input: unknown = {}): string => {
  const policy = PolicyDefinitionInputSchema.parse(input);
  return digestCanonicalJson({ schemaVersion: "verification-policy.v1", definitionId: `policy-${policy.policyVersion}`, ...policy });
};
const digest = `sha256:${"a".repeat(64)}`;
async function fixture(options: { badQuote?: boolean; value?: string; downstreamUse?: string; legacyValueJudgment?: boolean } = {}) {
  const storeDir = await mkdtemp(join(tmpdir(), "ks-p1-oracle-synthetic-"));
  const executor = await VerificationExecutor.create(loadExecutorConfig({ VERIFY_STORE_DIR: storeDir, VERIFY_TENANT_ID: tenantId, VERIFY_GIT_SHA: "synthetic-unit" }));
  const capture = await executor.captureFile({ bytes: new TextEncoder().encode(statement), filename: "synthetic.txt", sourceUri: "https://synthetic.invalid/proof", runId: "synthetic-run" });
  await executor.verifyClaims({ runId: "synthetic-run", intent: { schemaVersion: "verification-claims-intent.v1", intentId: "synthetic-intent", claims: [{ claimId: "same-claim", proposition: statement, ...(options.value ? { value: options.value } : {}), claimType: "capability", qualifiers: ["in preview"], downstreamUse: ["knowledge_ingestion:claim.materialize", "source_attributed_report", ...(options.downstreamUse ? [options.downstreamUse] : [])], evidence: [{ captureId: capture.captureId, quote: options.badQuote ? "Absent selector text" : statement }] }] } });
  const { state } = await executor.runStatus({ runId: "synthetic-run" });
  const bundle = await executor.store.json<VerificationBundle>(await executor.store.resolveHandle({ artifactId: state.bundleArtifactId! }));
  // Synthetic service judgment exercises storage/schema/policy/seal contracts, without claiming a provider or human reviewed it.
  const result = await executor.store.json<DeterministicVerificationResult>(await executor.store.resolveHandle({ artifactId: state.resultArtifactId! }));
  const identity = { deploymentId: "synthetic-service-judge", provider: "synthetic", family: "synthetic", model: "unit-fixture", capability: "llm_evidence_rubric" as const, graderVersion: "synthetic.v1", promptDigest: digest as `sha256:${string}`, outputSchemaDigest: digest as `sha256:${string}`, configurationDigest: digest as `sha256:${string}` };
  const fragmentId = bundle.assertions[0]!.evidence[0]!.fragment.fragmentId;
  const judgment = options.badQuote ? SemanticAssessmentRecordSchema.parse({ assertionId: "same-claim", verdict: "directly_supported", disposition: "admit", evidenceSupport: "satisfied", worldCorrectness: "not_assessed", attributionFaithfulness: "not_assessed", sourceAuthority: "not_assessed", provenanceIntegrity: "satisfied", judgeIdentities: [identity], supportingFragmentIds: [fragmentId], contradictingFragmentIds: [], unsupportedFacets: [], reasonCodes: ["SYNTHETIC_INVALID_OVERRIDE_TEST"], crossFamilySecondJudge: false, rawProviderConfidences: [] })
    : await verifyAssertionSemantics({ bundle, deterministicResult: result, assertionId: "same-claim", selectedFragments: [{ evidenceId: bundle.assertions[0]!.evidence[0]!.evidenceId, fragmentId, exactText: statement, selectedContentDigest: sha256Digest(statement) }],
      adapters: { primary: { identity, maximumInputCharacters: 64000, judge: async input => {
        expect(input.value).toEqual(options.value);
        return { schemaVersion: "verification-semantic-judge.v1", assertionId: "same-claim", verdict: "directly_supported", nliLabel: "entailed", supportingFragmentIds: [fragmentId], contradictingFragmentIds: [], unsupportedFacets: [], qualifiersPreserved: true, publicRationale: "Explicit synthetic service response; reviewed normalized value is in the received input." };
      } } } });
  if (options.legacyValueJudgment) delete judgment.assertionValueDigest;
  const semantic = await executor.store.putJson({ schemaVersion: "verification-semantic-assessments.v1", runId: "synthetic-run", assessments: [judgment], skipped: [] }, { mediaType: "application/json", producerActivityId: "synthetic:judge", producerVersion: "synthetic.v1", parentArtifactIds: [state.resultArtifactId!], transformation: { kind: "synthetic_unit_judgment" } });
  state.semanticArtifactId = semantic.handle.artifactId;
  await executor.store.writeRun(state);
  await executor.evaluatePolicy({ runId: "synthetic-run" });
  const seal = await executor.sealRun({ runId: "synthetic-run" });
  const intent = IngestionIntentSchema.parse({ schemaVersion: "knowledge-ingestion-intent.v1", intentId: "synthetic-ingest", context: { tenantId }, evidence: { verificationRuns: [{ runId: "synthetic-run", manifestDigest: seal.manifestDigest }] }, proposals: [{ proposalId: "materialize", kind: "claim.materialize", runId: "synthetic-run", claimIds: ["same-claim"] }] });
  return { executor, intent, state };
}

describe("authoritative filesystem evidence adapter (explicit synthetic service judgment)", () => {
  it("hydrates assessments (not response assessed), preserving qualification and policy binding", async () => {
    const { executor, intent } = await fixture();
    const oracle = verificationStoreOracle(executor, { tenantId, policyVersion: "executor-default.v1", policyDigest: policyDigest() })(intent);
    expect(await oracle.runSealed("synthetic-run")).toBe(true);
    expect(await oracle.claimEligible("synthetic-run", "same-claim")).toMatchObject({ eligible: true, authoritative: { statement, qualifiers: ["in preview"], policyVersion: "executor-default.v1" } });
    expect(await oracle.claimEligible("synthetic-run", "missing")).toEqual({ eligible: false });
  });
  it("rejects wrong manifest and wrong host policy", async () => {
    const { executor, intent } = await fixture();
    const wrongManifest = structuredClone(intent); wrongManifest.evidence.verificationRuns[0]!.manifestDigest = digest;
    expect(await verificationStoreOracle(executor, { tenantId, policyVersion: "executor-default.v1", policyDigest: policyDigest() })(wrongManifest).runSealed("synthetic-run")).toBe(false);
    expect(await verificationStoreOracle(executor, { tenantId, policyVersion: "different-policy", policyDigest: policyDigest() })(intent).runSealed("synthetic-run")).toBe(false);
  });
  it("rejects an absent semantic artifact even when a prior seal exists", async () => {
    const { executor, intent } = await fixture();
    const sealedState = (await executor.runStatus({ runId: "synthetic-run" })).state;
    delete sealedState.semanticArtifactId; await executor.store.writeRun(sealedState);
    expect(await verificationStoreOracle(executor, { tenantId, policyVersion: "executor-default.v1", policyDigest: policyDigest() })(intent).runSealed("synthetic-run")).toBe(false);
  });
  it("rejects cross-tenant requests before run or artifact reads", async () => {
    const { executor, intent } = await fixture();
    const status = vi.spyOn(executor, "runStatus"); const bytes = vi.spyOn(executor.store, "bytes");
    intent.context.tenantId = "00000000-0000-4000-8000-000000000022";
    expect(() => verificationStoreOracle(executor, { tenantId, policyVersion: "executor-default.v1", policyDigest: policyDigest() })(intent)).toThrow("EVIDENCE_NOT_AUTHORIZED");
    expect(status).not.toHaveBeenCalled(); expect(bytes).not.toHaveBeenCalled();
  });
  it("cannot promote failed deterministic selectors through semantic pass (F03)", async () => {
    const { executor, intent } = await fixture({ badQuote: true });
    expect(await verificationStoreOracle(executor, { tenantId, policyVersion: "executor-default.v1", policyDigest: policyDigest() })(intent).claimEligible("synthetic-run", "same-claim")).toEqual({ eligible: false });
  });
  it("binds a genuine report check to exact bytes and the cited run (F10/F11)", async () => {
    const { executor, intent } = await fixture();
    const checked = await executor.checkReport({ runId: "synthetic-run", intent: { schemaVersion: "verification-report-intent.v1", intentId: "report-intent", claimsRunId: "synthetic-run", reportText: statement, assertions: [{ exactText: statement, claimIds: ["same-claim"], requiredQualifiers: ["in preview"] }] } });
    const handle = await executor.store.resolveHandle({ artifactId: checked.resultArtifactId });
    const proposal = IngestionIntentSchema.parse({ ...intent, proposals: [{ proposalId: "report", kind: "report.publish", title: "Synthetic report", asOf: "2026", markdown: statement, claimRefs: [{ runId: "synthetic-run", claimId: "same-claim" }], reportCheck: { artifactId: handle.artifactId, digest: handle.digest, runId: "synthetic-run" } }] }).proposals[0]!;
    if (proposal.kind !== "report.publish") throw new Error("fixture kind");
    const oracle = verificationStoreOracle(executor, { tenantId, policyVersion: "executor-default.v1", policyDigest: policyDigest() })(intent);
    expect(await oracle.reportEligible!(proposal)).toEqual({ eligible: true });
    expect(await oracle.reportEligible!({ ...proposal, markdown: statement + " Changed." })).toMatchObject({ eligible: false });
    expect(await oracle.reportEligible!({ ...proposal, claimRefs: [{ runId: "other-run", claimId: "same-claim", role: "primary" }] })).toMatchObject({ eligible: false });
  });
  it.each(["fact.assert_state", "event.assert"] as const)("hydrates an exact normalized %s effect for admission", async kind => {
    const subject = { mode: "resolved", ref: "system", kind: "organization", entityId: tenantId };
    const effect = kind === "fact.assert_state"
      ? { kind, streamKind: "organization_status", subjectRef: "system", status: "operating", worldInterval: { from: "2026-01-01T00:00:00Z", to: null }, temporalBasis: "explicit" }
      : { kind, eventKind: "founded", subjectRef: "system", occurredDuring: { from: "2026-01-01T00:00:00Z", to: null } };
    const typed = IngestionIntentSchema.parse({ schemaVersion: "knowledge-ingestion-intent.v1", intentId: "typed-effect", context: { tenantId }, subjects: [subject], proposals: [{ ...effect, proposalId: "effect", proposition: statement, qualifiers: ["in preview"], evidence: [{ runId: "synthetic-run", claimId: "same-claim" }] }] });
    const { executor, intent } = await fixture({ value: proposalEffect(typed, typed.proposals[0]!), downstreamUse: `knowledge_ingestion:${kind}` });
    const oracle = verificationStoreOracle(executor, { tenantId, policyVersion: "executor-default.v1", policyDigest: policyDigest() })(intent);
    const eligibility = await oracle.claimEligible("synthetic-run", "same-claim");
    expect(eligibility.eligible).toBe(true);
    const facts = { currentHead: 0, subjects: {}, existing: { segments: {}, relationships: {}, occurrences: {}, seriesKeys: {} }, vocabulary: {} as Parameters<typeof admissionIssues>[0]["facts"]["vocabulary"], rules: { rulesVersion: "synthetic", loaded: false, rules: [] }, whatChanged: [], claims: [{ runId: "synthetic-run", claimId: "same-claim", sealed: true, claimRowId: tenantId, ...eligibility }] };
    expect(admissionIssues({ intent: typed, proposal: typed.proposals[0]!, facts })).toEqual([]);
  });
  it("rejects stored artifact bytes altered after sealing", async () => {
    const { executor, intent, state } = await fixture();
    const handle = await executor.store.resolveHandle({ artifactId: state.intentArtifactId! });
    await writeFile(join(executor.store.rootDir, handle.objectKey), "{}");
    expect(await verificationStoreOracle(executor, { tenantId, policyVersion: "executor-default.v1", policyDigest: policyDigest() })(intent).runSealed("synthetic-run")).toBe(false);
  });
  it.each(["ingest_plan", "ingest_apply", "db_read_intent"])("authorizes %s through the shared CLI/HTTP/MCP operation registry before dispatch", async operation => {
    const dispatch = vi.fn();
    const services = { config: { defaultTenantId: tenantId }, ingestion: { plan: dispatch, apply: dispatch }, reads: { runIntent: dispatch } } as unknown as KnowledgeServices;
    await expect(knowledgeOperations.invoke(operation, { intent: { context: { tenantId: "00000000-0000-4000-8000-000000000033" } } }, services)).rejects.toThrow("EVIDENCE_NOT_AUTHORIZED");
    expect(dispatch).not.toHaveBeenCalled();
  });
  it("admits policy-authorized literal extraction without any fabricated semantic judgment", async () => {
    const storeDir = await mkdtemp(join(tmpdir(), "ks-p1-literal-"));
    const executor = await VerificationExecutor.create(loadExecutorConfig({ VERIFY_STORE_DIR: storeDir, VERIFY_TENANT_ID: tenantId, VERIFY_GIT_SHA: "synthetic-corpus" }));
    const text = "verbatim value";
    const capture = await executor.captureFile({ bytes: new TextEncoder().encode(text), filename: "literal.txt", sourceUri: "https://synthetic.invalid/literal", runId: "literal-run" });
    await executor.verifyClaims({ runId: "literal-run", intent: { schemaVersion: "verification-claims-intent.v1", intentId: "literal-intent", policyVersion: "literal-policy.v1", claims: [{ claimId: "literal", proposition: text, value: text, claimType: "attribute", downstreamUse: ["knowledge_ingestion:claim.materialize"], evidence: [{ captureId: capture.captureId, quote: text }] }] } });
    await executor.evaluatePolicy({ runId: "literal-run", policy: { policyVersion: "literal-policy.v1", literalExtraction: { assertionIds: ["literal"], downstreamUses: ["knowledge_ingestion:claim.materialize"] } } });
    const sealed = await executor.sealRun({ runId: "literal-run" });
    expect((await executor.runStatus({ runId: "literal-run" })).state.semanticArtifactId).toBeUndefined();
    const intent = IngestionIntentSchema.parse({ schemaVersion: "knowledge-ingestion-intent.v1", intentId: "literal-ingest", context: { tenantId }, evidence: { verificationRuns: [{ runId: "literal-run", manifestDigest: sealed.manifestDigest }] }, proposals: [{ proposalId: "literal", kind: "claim.materialize", runId: "literal-run", claimIds: ["literal"] }] });
    const oracle = verificationStoreOracle(executor, { tenantId, policyVersion: "literal-policy.v1", policyDigest: policyDigest({ policyVersion: "literal-policy.v1", literalExtraction: { assertionIds: ["literal"], downstreamUses: ["knowledge_ingestion:claim.materialize"] } }) })(intent);
    expect(await oracle.claimEligible("literal-run", "literal")).toMatchObject({ eligible: true, verdict: "literal_extraction_verified", authoritative: { statement: text, qualifiers: [] } });
  });
  it("rejects a different policy definition even under the configured version", async () => {
    const { executor, intent } = await fixture();
    const oracle = verificationStoreOracle(executor, { tenantId, policyVersion: "executor-default.v1", policyDigest: policyDigest({ reviewAvailable: false }) })(intent);
    expect(await oracle.runSealed("synthetic-run")).toBe(false);
  });
  it("rejects value-bearing historical judgments that never bound the reviewed value", async () => {
    await expect(fixture({ value: "normalized effect", legacyValueJudgment: true })).rejects.toThrow("POLICY_SEMANTIC_VALUE_BINDING_MISMATCH");
  });
  it.each(["missing", "changed"])("rejects %s reviewed-value binding even when outer bytes/digest are recomputed", async mutation => {
    const { executor } = await fixture({ value: "normalized effect" });
    const { state } = await executor.runStatus({ runId: "synthetic-run" });
    const original = await executor.store.resolveHandle({ artifactId: state.policyInputsArtifactId! });
    const inputs = await executor.store.json<VerificationRecordedPolicyInputs>(original);
    if (mutation === "missing") delete inputs.assertions[0]!.semantic.assertionValueDigest;
    else inputs.assertions[0]!.semantic.assertionValueDigest = sha256Digest("changed value");
    const bytes = new TextEncoder().encode(canonicalizeJson(inputs));
    const handle = { ...original, digest: sha256Digest(bytes), byteLength: bytes.length };
    const bundle = await executor.store.json<VerificationBundle>(await executor.store.resolveHandle({ artifactId: state.bundleArtifactId! }));
    expect(() => validateRecordedPolicyInputsArtifact({ handle, bytes, bundle, deterministicResult: inputs.deterministicResult, runId: "synthetic-run", policyVersion: "executor-default.v1" })).toThrow("POLICY_SEMANTIC_VALUE_BINDING_MISMATCH");
  });
  it("rejects declared or missing verifier at startup before database initialization", () => {
    const config = loadKnowledgeConfig({ KNOWLEDGE_DB_URL: "postgres://invalid", KNOWLEDGE_EVIDENCE_ORACLE: "declared" })!;
    expect(() => createKnowledgeServices(config)).toThrow("EVIDENCE_ORACLE_REQUIRED");
    expect(() => createKnowledgeServices({ ...config, evidenceOracle: "verification-store" })).toThrow("EVIDENCE_ORACLE_REQUIRED");
  });
});
