import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ArtifactLedger, ReadExecutor } from "@aiengineer/knowledge-db-read";
import { IngestionExecutor, IngestionIntentSchema, deterministicId, proposalEffect, type IngestionIntent } from "@aiengineer/knowledge-ingestion";
import { TenantPostgres } from "@aiengineer/knowledge-persistence";
import { SupabaseArtifactStore } from "@aiengineer/knowledge-runtime";
import { loadWorkspace } from "@aiengineer/knowledge-schema-workspace";
import { digestCanonicalJson, sha256Digest, verifyAssertionSemantics } from "@aiengineer/knowledge-verification";
import type { VerificationBundle, DeterministicVerificationResult } from "@aiengineer/knowledge-contracts";
import { disposableDatabaseUrl, disposableStorageConfig } from "../../../../packages/persistence/test/disposable.mjs";
import { withSnapshot } from "../../../../packages/ingestion/test/snapshot-fixture.mjs";
import { VerificationExecutor, loadExecutorConfig } from "../executor.js";
import { PolicyDefinitionInputSchema } from "../intents.js";
import { createExecutorCustody } from "../store-custody-postgres.js";
import { verificationStoreOracle } from "./evidence-oracle.js";

const databaseUrl = disposableDatabaseUrl();
const storage = disposableStorageConfig();
const statement = "Synthetic organization operates in preview.";
const policyDigest = digestCanonicalJson({ schemaVersion: "verification-policy.v1", definitionId: "policy-executor-default.v1", ...PolicyDefinitionInputSchema.parse({}) });
const digest = `sha256:${"a".repeat(64)}` as const;

async function seal(executor: VerificationExecutor, intent: IngestionIntent) {
  const runId = intent.evidence.verificationRuns[0]!.runId;
  const text = intent.proposals.find(proposal => proposal.proposition)?.proposition ?? statement;
  const capture = await executor.captureFile({ bytes: new TextEncoder().encode(text), filename: "provenance.txt", sourceUri: `https://synthetic.invalid/${intent.context.tenantId}`, runId });
  const subject = intent.subjects[0]!;
  const entityId = subject.mode === "resolved" ? subject.entityId : deterministicId("corpus.entity", [intent.context.tenantId, intent.intentId, "organization"].join("\0"));
  const effects = intent.proposals.filter(proposal => proposal.kind !== "claim.materialize");
  await executor.verifyClaims({ runId, intent: { schemaVersion: "verification-claims-intent.v1", intentId: `claims-${intent.intentId}`, claims: effects.map(proposal => ({
    claimId: proposal.evidence[0]!.claimId, claimType: "capability", proposition: text, qualifiers: ["in preview"], value: proposalEffect(intent, proposal),
    entityBindings: [{ role: "subject", canonicalId: entityId }], downstreamUse: ["knowledge_ingestion:claim.materialize", `knowledge_ingestion:${proposal.kind}`],
    evidence: [{ captureId: capture.captureId, quote: text }],
  })) } });
  const { state } = await executor.runStatus({ runId });
  const bundle = await executor.store.json<VerificationBundle>(await executor.store.resolveHandle({ artifactId: state.bundleArtifactId! }));
  const result = await executor.store.json<DeterministicVerificationResult>(await executor.store.resolveHandle({ artifactId: state.resultArtifactId! }));
  const identity = { deploymentId: "p3-synthetic-independent-judge", provider: "synthetic", family: "synthetic", model: "disposable-proof", capability: "llm_evidence_rubric" as const, graderVersion: "synthetic.v1", promptDigest: digest, outputSchemaDigest: digest, configurationDigest: digest };
  const assessments = [];
  for (const assertion of bundle.assertions) {
    const edge = assertion.evidence[0]!;
    assessments.push(await verifyAssertionSemantics({ bundle, deterministicResult: result, assertionId: assertion.assertionId,
      selectedFragments: [{ evidenceId: edge.evidenceId, fragmentId: edge.fragment.fragmentId, exactText: text, selectedContentDigest: sha256Digest(text) }],
      adapters: { primary: { identity, maximumInputCharacters: 64000, judge: async () => ({ schemaVersion: "verification-semantic-judge.v1", assertionId: assertion.assertionId,
        verdict: "directly_supported", nliLabel: "entailed", supportingFragmentIds: [edge.fragment.fragmentId], contradictingFragmentIds: [], unsupportedFacets: [],
        qualifiersPreserved: true, publicRationale: "Synthetic proof response retaining the preview qualification." }) } } }));
  }
  const semantic = await executor.store.putJson({ schemaVersion: "verification-semantic-assessments.v1", runId, assessments, skipped: [] },
    { mediaType: "application/json", producerActivityId: "p3-proof:judge", producerVersion: "synthetic.v1", parentArtifactIds: [state.resultArtifactId!], transformation: { kind: "synthetic_test_judgment" } });
  state.semanticArtifactId = semantic.handle.artifactId;
  await executor.store.writeRun(state);
  await executor.evaluatePolicy({ runId });
  const sealed = await executor.sealRun({ runId });
  intent.evidence.verificationRuns[0]!.manifestDigest = sealed.manifestDigest;
  return capture;
}

describe.skipIf(!databaseUrl || !storage)("canonical compatibility records on guarded PostgreSQL and Storage", () => {
  it("binds exact qualified effects to canonical records, new subjects, receipts, replay and held closures", async () => {
    const tenantId = randomUUID(), missionId = randomUUID(), workItemId = randomUUID(), attemptId = randomUUID(), verifierAttemptId = randomUUID();
    const directory = await mkdtemp(join(tmpdir(), "ks-p3-record-"));
    const db = new TenantPostgres({ connectionString: databaseUrl! });
    const custody = createExecutorCustody({ databaseUrl: databaseUrl!, tenantId, ...storage!, producerAttemptId: attemptId, missionId });
    try {
      await db.transaction({ tenantId }, async client => {
        await client.query("insert into orchestration.mission(id,tenant_id,goal) values($1,$2,'P3 isolated synthetic record proof')", [missionId, tenantId]);
        await client.query("insert into orchestration.work_item(id,tenant_id,mission_id,kind) values($1,$2,$3,'build_vectors')", [workItemId, tenantId, missionId]);
        await client.query("insert into orchestration.attempt(id,tenant_id,work_item_id,attempt_no,agent_deployment_id) values($1,$2,$3,1,'p3-record-producer'),($4,$2,$3,2,'p3-record-verifier')", [attemptId, tenantId, workItemId, verifierAttemptId]);
      });
      const verifier = await VerificationExecutor.create(loadExecutorConfig({ VERIFY_STORE_DIR: directory, VERIFY_TENANT_ID: tenantId, VERIFY_GIT_SHA: "p3-synthetic-record-proof",
        VERIFY_PRODUCER_ATTEMPT_ID: attemptId, VERIFY_VERIFIER_ATTEMPT_ID: verifierAttemptId, VERIFY_PRODUCER_DEPLOYMENT_ID: "p3-record-producer", VERIFY_VERIFIER_DEPLOYMENT_ID: "p3-record-verifier" }));
      verifier.store.attachCustody(custody);
      const runId = randomUUID();
      const common = { proposition: statement, qualifiers: ["in preview"] };
      const intent = IngestionIntentSchema.parse({ schemaVersion: "knowledge-ingestion-intent.v1", intentId: "p3-record", context: { tenantId, missionId, attemptId },
        evidence: { verificationRuns: [{ runId }] }, subjects: [{ mode: "new", ref: "organization", kind: "organization", displayName: `P3 Record ${tenantId}`, onMatch: "fail" }],
        proposals: [
          { kind: "record.materialize", proposalId: "restriction", recordKind: "compatibility_constraint", subjectRef: "organization", title: "Preview capability restriction", constraintKind: "capability_restriction", expression: "preview_only", ...common, evidence: [{ runId, claimId: "restriction" }] },
          { kind: "claim.materialize", proposalId: "claims", runId, claimIds: ["identity", "restriction"] },
          { kind: "entity.create", proposalId: "organization", subjectRef: "organization", ...common, evidence: [{ runId, claimId: "identity" }] },
        ] });
      await seal(verifier, intent);
      const remote = new SupabaseArtifactStore({ ...storage!, serviceRoleKey: storage!.secretKey, bucket: "research-ingestion-intents", maximumBytes: 64000000 });
      const artifacts = new ArtifactLedger({ db, store: remote, bucket: "research-ingestion-intents", uploaded: true, executorVersion: "p3-record-proof" });
      const workspace = loadWorkspace(resolve(import.meta.dirname, "../../../../../ai-engineer-db-contract/workspace"));
      const reads = new ReadExecutor({ db, artifacts, workspace, executorVersion: "p3-record-proof" });
      const executor = new IngestionExecutor({ db, artifacts, workspace, executorVersion: "p3-record-proof", evidence: verificationStoreOracle(verifier, { tenantId, policyVersion: "executor-default.v1", policyDigest }) });
      const held = structuredClone(intent);
      held.proposals.find(proposal => proposal.kind === "entity.create")!.dependsOn = ["review"];
      held.proposals.push(IngestionIntentSchema.parse({ ...intent, proposals: [{ kind: "candidate.stage", proposalId: "review", entityKind: "organization", displayName: "Unresolved", reason: "needs_human" }] }).proposals[0]!);
      const heldReceipt = await executor.apply(await withSnapshot(reads, held));
      expect(heldReceipt.outcome).toBe("partial");
      expect(heldReceipt.proposals.find(proposal => proposal.proposalId === "restriction")).toMatchObject({ outcome: "held" });
      expect(heldReceipt.subjects[0]!.entityId).toBeNull();
      const altered = structuredClone(intent);
      const changed = altered.proposals.find(proposal => proposal.kind === "record.materialize")!;
      if (changed.kind !== "record.materialize") throw new Error("missing record proposal");
      changed.expression = "production_unlimited";
      const alteredPlan = await executor.plan(await withSnapshot(reads, altered));
      expect(alteredPlan.errors.some(error => error.code === "PROPOSAL_REVERIFICATION_REQUIRED")).toBe(true);
      const snapshot = await withSnapshot(reads, intent);
      const plan = await executor.plan(snapshot);
      expect(plan.errors).toEqual([]);
      expect(plan.order.indexOf("organization")).toBeLessThan(plan.order.indexOf("restriction"));
      const receipt = await executor.apply(snapshot);
      expect(receipt.outcome, JSON.stringify(receipt.failure)).toBe("applied");
      const record = receipt.proposals.find(proposal => proposal.proposalId === "restriction")!;
      const recordId = record.created!.recordId as string;
      const entityId = receipt.subjects[0]!.entityId!;
      const claimId = receipt.claims.find(claim => claim.claimId === "restriction")!.claimRowId!;
      expect(record.created).toEqual({ recordId, compatibilityConstraintId: recordId,
        claimRecordKey: JSON.stringify([tenantId, claimId, recordId]), recordEntityKey: JSON.stringify([tenantId, recordId, entityId, "subject"]) });
      const rows = await db.transaction({ tenantId, readOnly: true }, async client => ({
        records: (await client.query("select r.*,c.constraint_kind,c.expression from knowledge.record r join knowledge.compatibility_constraint c on c.id=r.id where r.tenant_id=$1", [tenantId])).rows,
        links: (await client.query("select cr.claim_id, cr.record_id, re.entity_id, re.role, c.status from evidence.claim_record cr join knowledge.record_entity_link re on re.tenant_id=cr.tenant_id and re.record_id=cr.record_id join evidence.claim c on c.id=cr.claim_id where cr.tenant_id=$1", [tenantId])).rows,
        receipts: (await client.query("select r.id from orchestration.operation_receipt r join orchestration.operation_intent i on i.id=r.intent_id where i.tenant_id=$1 and r.id=$2", [tenantId, receipt.receiptId])).rows,
      }));
      expect(rows.records).toHaveLength(1);
      expect(rows.records[0]).toMatchObject({ id: recordId, kind: "compatibility_constraint", statement, scope: { qualifiers: ["in preview"] }, assurance_level: "source_inspection", provenance_claim_id: claimId, created_by_receipt_id: receipt.receiptId, constraint_kind: "capability_restriction", expression: "preview_only" });
      expect(rows.links).toEqual([{ claim_id: claimId, record_id: recordId, entity_id: entityId, role: "subject", status: "verified" }]);
      expect(rows.receipts).toHaveLength(1);
      for (const denied of [{ tenantId, receiptId: randomUUID() }, { tenantId: randomUUID(), receiptId: receipt.receiptId }]) {
        let insertedBeforeCommit = false;
        await expect(db.transaction({ tenantId: denied.tenantId, role: "executor_service" }, async client => {
          await client.query("set constraints knowledge.record_created_by_receipt_id_fkey, knowledge.record_receipt_tenant deferred");
          await client.query(`insert into knowledge.record(id,tenant_id,kind,title,statement,created_by_receipt_id)
            values($1,$2,'compatibility_constraint','Deferred receipt negative','Synthetic receipt guard proof',$3)`,
          [randomUUID(), denied.tenantId, denied.receiptId]);
          insertedBeforeCommit = true;
        })).rejects.toThrow(/receipt|foreign key/);
        expect(insertedBeforeCommit).toBe(true);
      }
      expect(receipt.affectedRefs.filter(ref => ["record", "compatibility_constraint", "claim_record", "record_entity_link"].includes(ref.table))).toHaveLength(4);
      const replay = await executor.apply(snapshot);
      expect(replay.duplicateOf).toBe(receipt.receiptId);
      const stored = await artifacts.get(tenantId, receipt.storage.receiptArtifactId!);
      expect(stored.json).toMatchObject({ proposals: expect.arrayContaining([expect.objectContaining({ proposalId: "restriction", created: record.created })]) });
      const wrongTenant = structuredClone(intent); wrongTenant.context.tenantId = randomUUID();
      await expect(executor.plan(wrongTenant)).rejects.toBeDefined();
      const duplicate = structuredClone(intent);
      duplicate.intentId = "p3-record-duplicate";
      duplicate.subjects = [{ mode: "resolved", ref: "organization", kind: "organization", entityId }];
      duplicate.proposals = duplicate.proposals.filter(proposal => proposal.kind === "record.materialize");
      // A resolved subject is a different exact effect, so the original admission cannot authorize it.
      expect((await executor.plan(await withSnapshot(reads, duplicate))).errors.some(error => error.code === "PROPOSAL_REVERIFICATION_REQUIRED")).toBe(true);
      const resolvedRun = randomUUID();
      duplicate.evidence.verificationRuns = [{ runId: resolvedRun }];
      duplicate.proposals[0]!.evidence[0]!.runId = resolvedRun;
      duplicate.proposals.push(IngestionIntentSchema.parse({ ...duplicate, proposals: [{ kind: "claim.materialize", proposalId: "claims", runId: resolvedRun, claimIds: ["restriction"] }] }).proposals[0]!);
      await seal(verifier, duplicate);
      const resolvedSnapshot = await withSnapshot(reads, duplicate);
      const concurrent = await Promise.all([executor.apply(resolvedSnapshot), executor.apply(resolvedSnapshot)]);
      const resolvedReceipt = concurrent.find(result => result.duplicateOf === null)!;
      expect(resolvedReceipt.outcome, JSON.stringify(resolvedReceipt.failure)).toBe("applied");
      expect(concurrent.find(result => result.duplicateOf !== null)?.duplicateOf).toBe(resolvedReceipt.receiptId);
      await expect(executor.apply({ ...resolvedSnapshot, intentId: "p3-record-stale" })).rejects.toMatchObject({ code: "REBASE_REQUIRED" });
      duplicate.intentId = "p3-record-noop";
      const noOp = await executor.apply(await withSnapshot(reads, duplicate));
      expect(noOp.outcome, JSON.stringify(noOp.failure)).toBe("noop");
      expect(noOp.proposals.find(proposal => proposal.proposalId === "restriction")).toMatchObject({ outcome: "no_op_duplicate", existing: { recordId: resolvedReceipt.proposals.find(proposal => proposal.proposalId === "restriction")!.created!.recordId } });
      expect(await db.transaction({ tenantId, readOnly: true }, async client => Number((await client.query<{ count: string }>("select count(*) from knowledge.record where tenant_id=$1", [tenantId])).rows[0]!.count))).toBe(2);
    } finally {
      await custody.close(); await db.close(); await rm(directory, { recursive: true, force: true });
    }
  }, 180000);
});
