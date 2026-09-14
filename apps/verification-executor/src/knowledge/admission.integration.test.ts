import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ArtifactLedger, ReadExecutor } from "@aiengineer/knowledge-db-read";
import { IngestionExecutor, IngestionIntentSchema, proposalEffect } from "@aiengineer/knowledge-ingestion";
import { PostgresCanonicalRepository, TenantPostgres } from "@aiengineer/knowledge-persistence";
import { LocalArtifactStore } from "@aiengineer/knowledge-runtime";
import { loadWorkspace } from "@aiengineer/knowledge-schema-workspace";
import { type DeterministicVerificationResult, type VerificationBundle } from "@aiengineer/knowledge-contracts";
import { digestCanonicalJson, sha256Digest, verifyAssertionSemantics } from "@aiengineer/knowledge-verification";
import { disposableDatabaseUrl } from "../../../../packages/persistence/test/disposable.mjs";
import { prepareCurrentSchemaFixture } from "../../../../packages/ingestion/test/preparation-fixture.mjs";
import { withSnapshot } from "../../../../packages/ingestion/test/snapshot-fixture.mjs";
import { loadExecutorConfig, VerificationExecutor } from "../executor.js";
import { PolicyDefinitionInputSchema } from "../intents.js";
import { verificationStoreOracle } from "./evidence-oracle.js";

const url = disposableDatabaseUrl();
const schemaPath = resolve(import.meta.dirname, "../../../../../ai-engineer-db-contract/workspace");
const hash = `sha256:${"b".repeat(64)}`;
const version = "synthetic-p1-adapter-db.v1";

describe.skipIf(!url)("guarded real evidence adapter through persisted ingestion", () => {
  it("hydrates sealed claims, rejects altered evidence without writes, and persists bound fact/event effects", async () => {
    const tenantId = randomUUID();
    const artifactDirectory = await mkdtemp(join(tmpdir(), "ks-p1-admission-"));
    const db = new TenantPostgres({ connectionString: url! });
    const canonical = new PostgresCanonicalRepository({ connectionString: url! });
    const store = new LocalArtifactStore(join(artifactDirectory, "ledger"));
    const workspace = loadWorkspace(schemaPath);
    const artifacts = new ArtifactLedger({ db, store, bucket: "research-ingestion-intents", uploaded: false, executorVersion: version });
    const reads = new ReadExecutor({ db, workspace, artifacts, executorVersion: version });
    try {
      const prepared = await prepareCurrentSchemaFixture({ database: canonical, tenantId, store });
      const context = { tenantId, missionId: prepared.parents.missionId, attemptId: prepared.parents.attemptId };
      const runId = `synthetic-p1-${tenantId}`;
      const statement = prepared.sourceText;
      const raw = IngestionIntentSchema.parse({ schemaVersion: "knowledge-ingestion-intent.v1", intentId: `p1-${tenantId}`, context,
        expectedKnowledgeHead: 0, subjects: [{ mode: "resolved", ref: "organization", kind: "organization", entityId: prepared.parents.entityId }],
        proposals: [
          { proposalId: "claims", kind: "claim.materialize", runId, claimIds: ["status", "founded"] },
          { proposalId: "status", kind: "fact.assert_state", streamKind: "organization_status", subjectRef: "organization", status: "operating", worldInterval: { from: "2026-01-01T00:00:00Z", to: null }, temporalBasis: "explicit", extent: { sourceText: "January 1, 2026", precision: "day", earliest: "2026-01-01", latest: "2026-01-01" }, proposition: statement, qualifiers: [], evidence: [{ runId, claimId: "status" }] },
          { proposalId: "founded", kind: "event.assert", eventKind: "founded", subjectRef: "organization", occurredDuring: { from: "2026-01-01T00:00:00Z", to: "2026-01-02T00:00:00Z" }, proposition: statement, qualifiers: [], evidence: [{ runId, claimId: "founded" }] },
        ] });
      const verification = await VerificationExecutor.create(loadExecutorConfig({ VERIFY_STORE_DIR: join(artifactDirectory, "verification"), VERIFY_TENANT_ID: tenantId, VERIFY_GIT_SHA: "synthetic-primary-corpus" }));
      const capture = await verification.captureFile({ bytes: new TextEncoder().encode(statement), filename: "primary.txt", sourceUri: "https://synthetic.invalid/organization", runId });
      await verification.verifyClaims({ runId, intent: { schemaVersion: "verification-claims-intent.v1", intentId: `verify-${tenantId}`, claims: raw.proposals.slice(1).map(proposal => ({
        claimId: proposal.proposalId, proposition: statement, claimType: proposal.kind === "event.assert" ? "event" : "attribute", value: proposalEffect(raw, proposal),
        entityBindings: [{ role: "subject", canonicalId: prepared.parents.entityId }], downstreamUse: ["knowledge_ingestion:claim.materialize", `knowledge_ingestion:${proposal.kind}`],
        evidence: [{ captureId: capture.captureId, quote: statement }] })) } });
      const { state } = await verification.runStatus({ runId });
      const bundle = await verification.store.json<VerificationBundle>(await verification.store.resolveHandle({ artifactId: state.bundleArtifactId! }));
      // Explicit synthetic service judgments test the actual admission transport and DB; no provider quality or human approval is claimed.
      const result = await verification.store.json<DeterministicVerificationResult>(await verification.store.resolveHandle({ artifactId: state.resultArtifactId! }));
      const assessments = await Promise.all(bundle.assertions.map(assertion => verifyAssertionSemantics({ bundle, deterministicResult: result, assertionId: assertion.assertionId,
        selectedFragments: assertion.evidence.map(edge => ({ evidenceId: edge.evidenceId, fragmentId: edge.fragment.fragmentId, exactText: statement, selectedContentDigest: sha256Digest(statement) })),
        adapters: { primary: { identity: { deploymentId: "synthetic-independent-service", provider: "synthetic", family: "synthetic", model: "fixture", capability: "llm_evidence_rubric", graderVersion: version, promptDigest: hash as `sha256:${string}`, outputSchemaDigest: hash as `sha256:${string}`, configurationDigest: hash as `sha256:${string}` }, maximumInputCharacters: 64000,
          judge: async input => {
            expect(input.value).toBe(assertion.value);
            expect(input.proposition).toBe(statement);
            return { schemaVersion: "verification-semantic-judge.v1", assertionId: assertion.assertionId, verdict: "directly_supported", nliLabel: "entailed", supportingFragmentIds: assertion.evidence.map(edge => edge.fragment.fragmentId), contradictingFragmentIds: [], unsupportedFacets: [], qualifiersPreserved: true, publicRationale: "Synthetic service response for the exact reviewed normalized value; not a quality evaluation." };
          } } } })));
      const semantic = await verification.store.putJson({ schemaVersion: "verification-semantic-assessments.v1", runId, assessments, skipped: [] }, { mediaType: "application/json", producerActivityId: "synthetic:service_review", producerVersion: version, parentArtifactIds: [state.resultArtifactId!], transformation: { kind: "synthetic_service_judgments" } });
      state.semanticArtifactId = semantic.handle.artifactId; await verification.store.writeRun(state);
      await verification.evaluatePolicy({ runId });
      const sealed = await verification.sealRun({ runId });
      raw.evidence.verificationRuns = [{ runId, manifestDigest: sealed.manifestDigest }];
      const intent = await withSnapshot(reads, raw);
      const defaultPolicy = { schemaVersion: "verification-policy.v1", definitionId: "policy-executor-default.v1", ...PolicyDefinitionInputSchema.parse({}) };
      const evidence = verificationStoreOracle(verification, { tenantId, policyVersion: "executor-default.v1", policyDigest: digestCanonicalJson(defaultPolicy) });
      const ingestion = new IngestionExecutor({ db, workspace, artifacts, executorVersion: version, evidence });
      const altered = structuredClone(intent); altered.intentId = `bad-${tenantId}`;
      altered.evidence!.claims = [{ runId, claimId: "status", claimType: "attribute", statement: "Forged unrestricted meaning", subjects: [] }];
      await expect(ingestion.apply(altered)).rejects.toThrow();
      expect((await reads.head(tenantId)).knowledgeSeq).toBe(0);
      const empty = structuredClone(intent); empty.intentId = `empty-${tenantId}`; empty.proposals = [structuredClone(raw.proposals[1]!)];
      empty.proposals[0]!.evidence = [];
      await expect(ingestion.apply(empty)).rejects.toThrow();
      expect((await reads.head(tenantId)).knowledgeSeq).toBe(0);
      const plan = await ingestion.plan(intent);
      expect(plan.errors).toEqual([]); expect(plan.plannedOutcome).toBe("applied");
      const receipt = await ingestion.apply(intent);
      expect(receipt.outcome).toBe("applied"); expect((await reads.head(tenantId)).knowledgeSeq).toBe(1);
      const rows = await db.transaction({ tenantId, role: "pipeline_agent", readOnly: true }, client => client.query(`select c.id,c.statement,c.structured,cs.entity_id from evidence.claim c join evidence.claim_subject cs on cs.claim_id=c.id where c.producer_attempt_id=$1`, [context.attemptId]));
      expect(rows.rows).toHaveLength(2);
      expect(rows.rows.every(row => row.statement === statement && row.entity_id === prepared.parents.entityId)).toBe(true);
      expect(receipt.affectedRefs.filter(ref => ref.table === "claim")).toHaveLength(2);
      expect(receipt.affectedRefs.some(ref => ref.table === "segment")).toBe(true);
      expect(receipt.affectedRefs.some(ref => ref.table === "event_occurrence")).toBe(true);
      process.stdout.write(`${JSON.stringify({ proof: "p1-real-adapter-db-synthetic-service", tenantId, artifactDirectory, runId, manifestDigest: sealed.manifestDigest, receiptId: receipt.receiptId, receiptArtifactId: receipt.storage.receiptArtifactId, snapshotArtifactId: intent.inputSnapshot?.artifactId, assertionValueDigests: assessments.map(item => item.assertionValueDigest), affectedRefs: receipt.affectedRefs })}\n`);
    } finally { await db.close(); await canonical.close(); }
  });
});
