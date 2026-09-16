import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ArtifactLedger, ReadExecutor } from "@aiengineer/knowledge-db-read";
import { IngestionExecutor, IngestionIntentSchema, deterministicId, proposalEffect, type IngestionIntent } from "@aiengineer/knowledge-ingestion";
import { TenantPostgres, PostgresCanonicalRepository, PostgresPreparationRepository } from "@aiengineer/knowledge-persistence";
import { LocalArtifactStore } from "@aiengineer/knowledge-runtime";
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

describe.skipIf(!databaseUrl || !storage)("P3 hydrated canonical provenance on guarded disposable Postgres and Storage", () => {
  it("materializes claims before new entities, links subjects after creation, retains qualified support and reconciles an idempotent replay", async () => {
    const tenantId = randomUUID(), missionId = randomUUID(), workItemId = randomUUID(), attemptId = randomUUID(), verifierAttemptId = randomUUID();
    const directory = await mkdtemp(join(tmpdir(), "ks-p3-provenance-"));
    const db = new TenantPostgres({ connectionString: databaseUrl! });
    const custody = createExecutorCustody({ databaseUrl: databaseUrl!, tenantId, ...storage!, producerAttemptId: attemptId, missionId });
    try {
      await db.transaction({ tenantId }, async client => {
        await client.query("insert into orchestration.mission(id,tenant_id,goal) values($1,$2,'P3 isolated synthetic provenance proof')", [missionId, tenantId]);
        await client.query("insert into orchestration.work_item(id,tenant_id,mission_id,kind) values($1,$2,$3,'build_vectors')", [workItemId, tenantId, missionId]);
        await client.query("insert into orchestration.attempt(id,tenant_id,work_item_id,attempt_no,agent_deployment_id) values($1,$2,$3,1,'p3-provenance-proof-producer')", [attemptId, tenantId, workItemId]);
        await client.query("insert into orchestration.attempt(id,tenant_id,work_item_id,attempt_no,agent_deployment_id) values($1,$2,$3,2,'p3-provenance-proof-verifier')", [verifierAttemptId, tenantId, workItemId]);
      });
      const verifier = await VerificationExecutor.create(loadExecutorConfig({ VERIFY_STORE_DIR: join(directory, "verifier"), VERIFY_TENANT_ID: tenantId, VERIFY_GIT_SHA: "p3-synthetic-proof",
        VERIFY_PRODUCER_ATTEMPT_ID: attemptId, VERIFY_VERIFIER_ATTEMPT_ID: verifierAttemptId, VERIFY_PRODUCER_DEPLOYMENT_ID: "p3-provenance-proof-producer", VERIFY_VERIFIER_DEPLOYMENT_ID: "p3-provenance-proof-verifier" }));
      verifier.store.attachCustody(custody);
      const runId = randomUUID();
      const common = { proposition: statement, qualifiers: ["in preview"] };
      const intent = IngestionIntentSchema.parse({ schemaVersion: "knowledge-ingestion-intent.v1", intentId: "p3-provenance", context: { tenantId, missionId, attemptId },
        evidence: { verificationRuns: [{ runId }] }, subjects: [{ mode: "new", ref: "organization", kind: "organization", displayName: "P3 Synthetic Organization", onMatch: "fail" }],
        proposals: [
          { kind: "claim.materialize", proposalId: "claims", runId, claimIds: ["identity", "status", "support", "founded", "event-support"] },
          { kind: "entity.create", proposalId: "organization", subjectRef: "organization", ...common, evidence: [{ runId, claimId: "identity" }] },
          { kind: "fact.assert_state", proposalId: "status", subjectRef: "organization", streamKind: "organization_status", status: "operating",
            worldInterval: { from: "2026-01-01T00:00:00Z", to: null }, temporalBasis: "explicit", extent: { sourceText: "2026", precision: "year", earliest: "2026-01-01", latest: "2026-12-31" }, ...common, evidence: [{ runId, claimId: "status" }] },
          { kind: "support.admit", proposalId: "support", targetRef: "status", dependsOn: ["status"], ...common, evidence: [{ runId, claimId: "support" }] },
          { kind: "event.assert", proposalId: "founded", eventKind: "founded", subjectRef: "organization", occurredDuring: { from: "2026-01-01T00:00:00Z", to: "2027-01-01T00:00:00Z" }, precision: "year",
            ...common, evidence: [{ runId, claimId: "founded" }] },
          { kind: "support.admit", proposalId: "event-support", targetRef: "founded", ...common, evidence: [{ runId, claimId: "event-support" }] },
        ] });
      const capture = await seal(verifier, intent);
      const preparationDatabase = new PostgresCanonicalRepository({ connectionString: databaseUrl! });
      const preparation = new PostgresPreparationRepository(preparationDatabase);
      const preparedCaptureId = randomUUID(), preparationOperationId = randomUUID();
      try {
        await db.transaction({ tenantId }, async client => {
          await client.query("insert into knowledge_service.operation(id,tenant_id,operation_kind,idempotency_key,correlation_id,actor_identity,request,request_sha256) values($1,$2,'capture_source',$3::text,$3::uuid,'p3-preparation-proof','{}',repeat('0',64))", [preparationOperationId, tenantId, preparationOperationId]);
        });
        const registered = await verifier.store.resolveHandle({ artifactId: capture.contentArtifact.artifactId });
        const physical = await db.transaction({ tenantId, readOnly: true }, async client => (await client.query<{ object_path: string }>("select object_path from orchestration.artifact where tenant_id=$1 and id=$2", [tenantId, registered.artifactId])).rows[0]!);
        const prepared = await preparation.persistCapture(tenantId, { operationId: preparationOperationId, sourceId: randomUUID(), captureId: preparedCaptureId,
          sourceClass: "other", canonicalUrl: capture.finalUrl, sensitivity: "public", requestUrl: capture.finalUrl,
          capturedAt: capture.capturedAt, captureMethod: capture.captureMethod, captureMethodVersion: "verification-executor-capture.v2", observations: { fixture: "P3 preparation-first identity" },
          artifact: { artifactId: registered.artifactId, digest: `sha256:${registered.digest.slice(7)}`, mediaType: registered.mediaType, byteLength: registered.byteLength,
            storageKey: physical.object_path, artifactType: "source_capture", bucketClass: "source_captures", storageBucket: "ai-engineer-cloud-bucket" } });
        expect(prepared.captureId).toBe(preparedCaptureId);
        expect((await preparation.getCaptureByOperation(tenantId, preparationOperationId))?.captureId).toBe(preparedCaptureId);
      } finally { await preparationDatabase.close(); }
      const artifacts = new ArtifactLedger({ db, store: new LocalArtifactStore(join(directory, "receipts")), bucket: "research-ingestion-intents", uploaded: false, executorVersion: "p3-proof" });
      const workspace = loadWorkspace(resolve(import.meta.dirname, "../../../../../ai-engineer-db-contract/workspace"));
      const reads = new ReadExecutor({ db, artifacts, workspace, executorVersion: "p3-proof" });
      const executor = new IngestionExecutor({ db, artifacts, workspace, executorVersion: "p3-proof", evidence: verificationStoreOracle(verifier, { tenantId, policyVersion: "executor-default.v1", policyDigest }) });
      const held = structuredClone(intent);
      held.proposals.find(proposal => proposal.kind === "entity.create")!.dependsOn = ["review"];
      held.proposals.push(IngestionIntentSchema.parse({ ...intent, proposals: [{ kind: "candidate.stage", proposalId: "review", entityKind: "organization", displayName: "Independent unresolved identity", reason: "needs_human" }] }).proposals[0]!);
      const heldReceipt = await executor.apply(await withSnapshot(reads, held));
      expect(heldReceipt.outcome).toBe("partial");
      expect(heldReceipt.proposals.filter(proposal => proposal.proposalId !== "review").every(proposal => proposal.outcome === "held")).toBe(true);
      expect(heldReceipt.subjects).toEqual([{ ref: "organization", entityId: null, created: false }]);
      expect(heldReceipt.claims.every(claim => claim.claimRowId === null)).toBe(true);
      expect(await db.transaction({ tenantId, readOnly: true }, async client => (await client.query("select id from evidence.claim where tenant_id=$1", [tenantId])).rows)).toEqual([]);
      const snapshotted = await withSnapshot(reads, intent);
      const plan = await executor.plan(snapshotted);
      expect(plan.errors).toEqual([]);
      expect(plan.proposals.every(proposal => proposal.outcome === "admitted")).toBe(true);
      const receipt = await executor.apply(snapshotted);
      expect(receipt.outcome).toBe("applied");
      const entityId = receipt.subjects[0]!.entityId!;
      const rows = await db.transaction({ tenantId, readOnly: true }, async client => ({
        claims: (await client.query("select c.id,c.statement,c.status,c.structured,c.producer_attempt_id,s.entity_id from evidence.claim c join evidence.claim_subject s on s.claim_id=c.id where c.tenant_id=$1 order by c.id", [tenantId])).rows,
        captures: (await client.query("select c.id,c.content_sha256 from evidence.source_capture c where c.tenant_id=$1", [tenantId])).rows,
        links: (await client.query("select l.id from evidence.claim_evidence_link l join evidence.claim c on c.id=l.claim_id where c.tenant_id=$1", [tenantId])).rows,
        subjects: (await client.query("select e.id from corpus.entity e join corpus.organization o on o.id=e.id where e.tenant_id=$1", [tenantId])).rows,
        support: (await client.query("select s.id,l.verification_contract_version from evidence.segment_support s join evidence.locator l on l.id=s.locator_id where s.tenant_id=$1", [tenantId])).rows,
      }));
      expect(rows.claims).toHaveLength(5);
      expect(rows.claims.every(row => row.entity_id === entityId && row.producer_attempt_id === attemptId && row.statement === statement)).toBe(true);
      expect(rows.claims.every(row => row.status === "verified")).toBe(true);
      expect(rows.claims.every(row => (row.structured as { verification: { qualifiers: string[] } }).verification.qualifiers.includes("in preview"))).toBe(true);
      expect(rows.captures).toHaveLength(1);
      expect(rows.captures[0]!.id).toBe(preparedCaptureId);
      expect(rows.captures[0]!.content_sha256).toBe(capture.contentArtifact.digest.slice(7));
      expect(rows.links).toHaveLength(5);
      expect(rows.support).toHaveLength(2);
      expect(rows.support[0]!.verification_contract_version).toBe("verification.v1");
      expect(rows.subjects).toHaveLength(1);
      expect([...(receipt.proposals.find(proposal => proposal.proposalId === "claims")!.created!.claimSubjectKeys as string[])].sort()).toEqual(rows.claims.map(row => JSON.stringify([row.id, entityId, "subject"])).sort());
      await db.transaction({ tenantId, readOnly: true }, async client => {
        for (const reference of receipt.affectedRefs) expect((await client.query(`select id from "${reference.schema}"."${reference.table}" where id=$1`, [reference.id])).rows).toHaveLength(1);
      });
      const repeated = await executor.apply(snapshotted);
      expect(repeated.duplicateOf).toBe(receipt.receiptId);
      expect(repeated.affectedRefs).toEqual(receipt.affectedRefs);
      expect((await executor.receipt(receipt.receiptId, tenantId)).affectedRefs).toEqual(receipt.affectedRefs);
      const correctedRun = randomUUID();
      const correctionText = "Synthetic organization dissolved while in preview.";
      const corrected = IngestionIntentSchema.parse({ schemaVersion: "knowledge-ingestion-intent.v1", intentId: "p3-corrected", context: intent.context,
        evidence: { verificationRuns: [{ runId: correctedRun }] }, subjects: [{ mode: "resolved", ref: "organization", kind: "organization", entityId }], proposals: [
          { kind: "claim.materialize", proposalId: "claims", runId: correctedRun, claimIds: ["correction", "support"] },
          { kind: "fact.assert_state", proposalId: "corrected-status", subjectRef: "organization", streamKind: "organization_status", status: "dissolved",
            worldInterval: { from: "2026-01-01T00:00:00Z", to: null }, temporalBasis: "observation_bounded", proposition: correctionText, qualifiers: ["in preview"], evidence: [{ runId: correctedRun, claimId: "correction" }] },
          { kind: "support.admit", proposalId: "support", targetRef: "corrected-status", proposition: correctionText, qualifiers: ["in preview"], evidence: [{ runId: correctedRun, claimId: "support" }] },
        ] });
      const correctedCapture = await seal(verifier, corrected);
      const correction = await executor.apply(await withSnapshot(reads, corrected));
      const reverseDatabase = new PostgresCanonicalRepository({ connectionString: databaseUrl! });
      try {
        const reverse = new PostgresPreparationRepository(reverseDatabase), operationId = randomUUID();
        const before = await db.transaction({ tenantId }, async client => {
          await client.query("insert into knowledge_service.operation(id,tenant_id,operation_kind,idempotency_key,correlation_id,actor_identity,request,request_sha256) values($1,$2,'capture_source',$3::text,$3::uuid,'p3-reverse-preparation-proof','{}',repeat('0',64))", [operationId,tenantId,operationId]);
          return (await client.query("select c.*,a.object_path,a.size_bytes from evidence.source_capture c join orchestration.artifact a on a.id=c.artifact_id where c.tenant_id=$1 and c.artifact_id=$2", [tenantId,correctedCapture.contentArtifact.artifactId])).rows[0]!;
        });
        const input = { operationId,sourceId:randomUUID(),captureId:randomUUID(),sourceClass:"other" as const,canonicalUrl:correctedCapture.finalUrl,sensitivity:"public" as const,
          requestUrl:correctedCapture.finalUrl,capturedAt:correctedCapture.capturedAt,captureMethod:correctedCapture.captureMethod,captureMethodVersion:"verification-executor-capture.v2",
          observations:{fixture:"P3 verification-first identity"},artifact:{artifactId:correctedCapture.contentArtifact.artifactId,digest:`sha256:${before.content_sha256}` as const,
            mediaType:String(before.media_type),byteLength:Number(before.size_bytes),storageKey:String(before.object_path),artifactType:"source_capture",bucketClass:"source_captures" as const,storageBucket:"ai-engineer-cloud-bucket" as const}};
        const bound = await reverse.persistCapture(tenantId,input);
        expect(bound.captureId).toBe(before.id);
        expect(bound.operationId).toBe(operationId);
        expect(await reverse.persistCapture(tenantId,input)).toEqual(bound);
        expect(await reverse.getCaptureByOperation(tenantId,operationId)).toEqual(bound);
        await expect(reverse.persistCapture(tenantId,{...input,observations:{fixture:"changed"}})).rejects.toThrow("CAPTURE_IDEMPOTENCY_CONFLICT");
        const after = await db.transaction({ tenantId,readOnly:true },async client => (await client.query("select c.*,a.object_path,a.size_bytes from evidence.source_capture c join orchestration.artifact a on a.id=c.artifact_id where c.tenant_id=$1 and c.artifact_id=$2", [tenantId,correctedCapture.contentArtifact.artifactId])).rows);
        expect(after).toEqual([before]);
        expect(after[0]!.produced_by_attempt_id).toBe(attemptId);
        expect(after[0]!.knowledge_operation_id).toBeNull();
        const freshCapture = await verifier.captureFile({bytes:new TextEncoder().encode(correctionText),filename:"provenance.txt",sourceUri:correctedCapture.finalUrl,runId:randomUUID(),captureId:randomUUID()});
        const freshArtifact = await db.transaction({tenantId,readOnly:true},async client => (await client.query("select * from orchestration.artifact where tenant_id=$1 and id=$2", [tenantId,freshCapture.contentArtifact.artifactId])).rows[0]!);
        expect(freshCapture.contentArtifact.artifactId).not.toBe(input.artifact.artifactId);
        expect(freshCapture.capturedAt).not.toBe(input.capturedAt);
        expect(freshArtifact.sha256).toBe(before.content_sha256);
        const concurrentInputs = [randomUUID(),randomUUID()].map(operationId => ({...input,operationId,captureId:randomUUID(),
          capturedAt:freshCapture.capturedAt,artifact:{...input.artifact,artifactId:freshCapture.contentArtifact.artifactId,storageKey:String(freshArtifact.object_path)}}));
        await db.transaction({tenantId},async client => {
          for (const item of concurrentInputs) await client.query("insert into knowledge_service.operation(id,tenant_id,operation_kind,idempotency_key,correlation_id,actor_identity,request,request_sha256) values($1,$2,'capture_source',$3::text,$3::uuid,'p3-concurrent-preparation-proof','{}',repeat('0',64))", [item.operationId,tenantId,item.operationId]);
        });
        let settled = 0, settledWhileSourceLocked = -1;
        let concurrent!: Promise<Awaited<ReturnType<typeof reverse.persistCapture>>[]>;
        await db.transaction({tenantId},async client => {
          await client.query("select id from evidence.source where tenant_id=$1 and id=$2 for update", [tenantId,before.source_id]);
          concurrent = Promise.all(concurrentInputs.map(async item => {try {return await reverse.persistCapture(tenantId,item);} finally {settled++;}}));
          await new Promise(resolve => setTimeout(resolve,150));
          settledWhileSourceLocked = settled;
        });
        const concurrentCaptures = await concurrent;
        expect(settledWhileSourceLocked).toBe(0);
        expect(concurrentCaptures[0]!.captureId).toBe(concurrentCaptures[1]!.captureId);
        expect(concurrentCaptures[0]!.captureId).not.toBe(before.id);
        for (const [index,item] of concurrentInputs.entries()) expect(await reverse.getCaptureByOperation(tenantId,item.operationId)).toEqual(concurrentCaptures[index]);
        expect(await db.transaction({tenantId,readOnly:true},async client => (await client.query("select id from evidence.source_capture where tenant_id=$1 and source_id=$2 and artifact_id=$3 and captured_at=$4", [tenantId,before.source_id,freshCapture.contentArtifact.artifactId,concurrentInputs[0]!.capturedAt])).rows)).toHaveLength(1);
      } finally { await reverseDatabase.close(); }
      expect(correction.head.before).toBe(receipt.head.after);
      const historical = await db.transaction({ tenantId, readOnly: true }, async client => (await client.query<{ status: string; k_from: string; k_to: string | null; support_count: string }>(
        `select s.status,s.k_from,s.k_to,(select count(*) from evidence.segment_support es where es.segment_id=s.id) support_count
         from temporal.segment s join temporal.stream st on st.id=s.stream_id where st.subject_entity_id=$1 and st.kind='organization_status' order by s.k_from`, [entityId])).rows);
      expect(historical).toEqual([
        { status: "operating", k_from: String(receipt.head.after), k_to: String(correction.head.after), support_count: "1" },
        { status: "dissolved", k_from: String(correction.head.after), k_to: null, support_count: "1" },
      ]);
      const restored = await db.transaction({ tenantId, readOnly: true }, async client => (await client.query<{ status: string }>(
        `select s.status from temporal.segment s join temporal.stream st on st.id=s.stream_id where st.subject_entity_id=$1 and st.kind='organization_status'
         and s.k_from <= $2 and (s.k_to is null or s.k_to > $2)`, [entityId, receipt.head.after])).rows);
      expect(restored).toEqual([{ status: "operating" }]);
      const invalidRun = randomUUID();
      const invalid = IngestionIntentSchema.parse({ ...corrected, intentId: "p3-invalid-locator", evidence: { verificationRuns: [{ runId: invalidRun }] },
        proposals: corrected.proposals.map(proposal => proposal.kind === "claim.materialize" ? { ...proposal, runId: invalidRun }
          : { ...proposal, evidence: proposal.evidence.map(reference => ({ ...reference, runId: invalidRun })),
            ...(proposal.kind === "support.admit" ? { locatorId: randomUUID() } : {}) }) });
      await seal(verifier, invalid);
      const acceptedState = async () => db.transaction({ tenantId, readOnly: true }, async client => ({
        claims: (await client.query("select id from evidence.claim where tenant_id=$1 order by id", [tenantId])).rows,
        support: (await client.query("select id from evidence.segment_support where tenant_id=$1 order by id", [tenantId])).rows,
        segments: (await client.query("select id,k_from,k_to from temporal.segment where tenant_id=$1 order by id", [tenantId])).rows,
        runs: (await client.query("select id from evidence.verification_run where tenant_id=$1 order by id", [tenantId])).rows,
      }));
      const beforeInvalid = await acceptedState();
      await expect(executor.apply(await withSnapshot(reads, invalid))).rejects.toMatchObject({ code: "SUPPORT_LOCATOR_NOT_AUTHORIZED" });
      expect(await acceptedState()).toEqual(beforeInvalid);
      expect((await reads.head(tenantId)).knowledgeSeq).toBe(correction.head.after);
    } finally { await custody.close(); await db.close(); await rm(directory, { recursive: true, force: true }); }
  }, 120000);
});
