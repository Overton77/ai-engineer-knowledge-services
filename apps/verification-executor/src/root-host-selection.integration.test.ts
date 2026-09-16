import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { ArtifactLedger } from "@aiengineer/knowledge-db-read";
import { SupabaseArtifactStore } from "@aiengineer/knowledge-runtime";
import { sha256Digest } from "@aiengineer/knowledge-domain";
import { disposableDatabaseUrl, disposableStorageConfig } from "../../../packages/persistence/test/disposable.mjs";
import { createSelectedCandidateFixture, FIXTURE_POLICY_DIGEST } from "./knowledge/selected-candidate-fixture.js";
import { createCanonicalEvidenceReader } from "./evidence-reader.js";
import { createRootSelectionComposition } from "./root-host-selection-composition.js";
import { createRootRunInspector } from "./root-host-inspection.js";
import { FilesystemStore } from "./store.js";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const databaseUrl = disposableDatabaseUrl(), storage = disposableStorageConfig();

describe.skipIf(!databaseUrl || !storage)("root selected composition on actual disposable canonical services (explicit synthetic judge and deterministic embeddings)", () => {
  it.each(["direct", "t14-handoff"])("registers real infrastructure and publishes through %s", async mode => {
    const fixture = await createSelectedCandidateFixture({ databaseUrl: databaseUrl!, storage: storage!, spaces: ["engineering_claims"] });
    const evidence = createCanonicalEvidenceReader({ databaseUrl: databaseUrl!, ...storage!, tenantId: fixture.tenantId,
      policyVersion: "executor-default.v1", policyDigest: FIXTURE_POLICY_DIGEST });
    try {
      const actor = () => ({ identity: randomUUID(), attemptId: randomUUID() });
      const roles = { producer: actor(), reviewer: actor(), evaluator: actor(), publisher: actor(), embeddingExecutor: actor() };
      const workItemId = randomUUID();
      await fixture.database.transaction(fixture.tenantId, async client => {
        await client.query("insert into orchestration.work_item(id,tenant_id,mission_id,kind) values($1,$2,$3,'build_vectors')", [workItemId, fixture.tenantId, fixture.missionId]);
        for (const [index, [role, pin]] of Object.entries(roles).entries())
          await client.query("insert into orchestration.attempt(id,tenant_id,work_item_id,attempt_no,agent_deployment_id) values($1,$2,$3,$4,$5)",
            [pin.attemptId, fixture.tenantId, workItemId, index + 1, `root-proof-${role}-${pin.identity}`]);
      });
      const stores = Object.fromEntries(["ai-engineer-cloud-bucket", "research-ingestion-intents"].map(bucket => [bucket,
        new SupabaseArtifactStore({ projectUrl: storage!.projectUrl, serviceRoleKey: storage!.secretKey, bucket, maximumBytes: 64000000 })]));
      const artifacts = new ArtifactLedger({ db: fixture.db, store: stores["research-ingestion-intents"]!, bucket: "research-ingestion-intents",
        uploaded: true, executorVersion: "root-selection-synthetic-service-proof.v1", readStores: stores });
      const selection = { ...fixture.selection, proposedBy: roles.producer.identity, requiredReviewer: roles.reviewer.identity,
        runPinDigest: sha256Digest(`root-selection-proof:${randomUUID()}`) };
      const scope = { ...roles, policyDigest: FIXTURE_POLICY_DIGEST,
        authority: { schemaVersion: "promotion-selection-authority.v1", tenantId: fixture.tenantId, policyDigest: FIXTURE_POLICY_DIGEST,
          proposedBy: roles.producer.identity, requiredReviewer: roles.reviewer.identity, runPinDigest: selection.runPinDigest, budget: selection.budget },
        targetSpaces: ["engineering_claims"], evaluationQueryTexts: [{ queryId: "original-question", text: "How do Synthetic Child and Parent operate together?" }],
        embeddingAdapter: fixture.embeddingAdapter, embeddingAdapterVersion: "deterministic-fake.test-only.NOT-live-provider",
        measure: async ({ text }: { text: string }) => ({ tokens: Buffer.byteLength(text), costMicros: 0 }),
        reviewAuthority: { kind: "synthetic_development_fixture" as const, synthetic: true as const, authorizationReference: "explicit-offline-service-test-fixture" },
        infrastructure: { namespace: `proof-${randomUUID().slice(0, 8)}`, authorizationReference: "guarded disposable service proof; no live-provider claim" } };
      const host = await createRootSelectionComposition({ database: fixture.database, artifacts, artifactStores: stores, evidence,
        tenantId: fixture.tenantId, correlationId: fixture.missionId, origin: "http://127.0.0.1:4100" }, scope);
      const infrastructure = await host.prepareInfrastructure(), replay = await host.prepareInfrastructure();
      expect(replay.operation?.id).toBe(infrastructure.operation?.id);
      expect(infrastructure.receipts.some(receipt => receipt.receiptKind === "create.succeeded")).toBe(true);
      const subject = await fixture.database.transaction(fixture.tenantId, async client => (await client.query<{ id: string }>(
        "select id from knowledge_service.review_subject where tenant_id=$1 and subject_ref->>'representationId'=$2 order by created_at desc limit 1",
        [fixture.tenantId, fixture.representationId])).rows[0]!);
      const representationReview = await host.reviewRepresentation({ representationId: fixture.representationId,
        reviewSubjectId: subject.id, guardedDigest: fixture.representationDigest, decision: "accept", policyVersion: "synthetic-root-proof.v1",
        rationale: "Explicit synthetic reviewer inspects native source custody; no human review claim." });
      expect(representationReview.operation?.status).toBe("succeeded");
      if (mode === "t14-handoff") {
        const store = new FilesystemStore(fixture.producerDirectory, fixture.tenantId);
        const runId = selection.selected[0]!.admittedClaims[0]!.runId;
        const inspectRun = createRootRunInspector({ verification: { store,
          runStatus: async ({ runId }) => ({ state: await store.readRun(runId) }) }, tenantId: fixture.tenantId,
          policyVersion: "executor-default.v1", policyDigest: FIXTURE_POLICY_DIGEST, allowedRunIds: [runId] });
        const { publishSelectionHandoff } = await import(pathToFileURL(resolve(import.meta.dirname,
          "../../../../research_ingestion_systems_agent/tools/team/t14-selection-handoff.mjs")).href);
        const observations: unknown[] = [];
        const handoff = { selection, selectionHost: host, infrastructure,
          sourceReviews: new Map([[fixture.representationId, { review: representationReview }]]), inspectRun,
          runId, tenantId: fixture.tenantId, question: scope.evaluationQueryTexts[0]!.text,
          pool: { query: (sql: string, parameters: unknown[]) => fixture.database.transaction(fixture.tenantId,
            client => client.query(sql, parameters)) }, persist: async (value: unknown) => { observations.push(value); } };
        const result = await publishSelectionHandoff(handoff);
        expect(result.publication.status).toBe("published");
        expect(observations).toHaveLength(4);
        const repeated = await publishSelectionHandoff(handoff);
        expect(repeated.publication.status).toBe("published");
        expect(repeated.publication.publications[0].operation.id).toBe(result.publication.publications[0].operation.id);
        expect(repeated.review).toBeNull();
        const { collectPublicationEvidence } = await import(pathToFileURL(resolve(import.meta.dirname,
          "../../../../research_ingestion_systems_agent/tools/team/t14-collection.mjs")).href);
        const collectionScope = { completed: repeated, tenantId: fixture.tenantId, roles, spaces: infrastructure.spaces,
          readOperation: async (id: string) => ({ operation: await fixture.database.getOperationRecord(fixture.tenantId, id),
            receipts: await Promise.all((await fixture.database.listReceipts(fixture.tenantId, id))
              .map(receipt => fixture.database.getReceiptResource(fixture.tenantId, receipt.id))) }),
          readActiveVersion: async (id: string) => fixture.database.transaction(fixture.tenantId, async client =>
            (await client.query("select active_space_version_id from retrieval.vector_store_space where tenant_id=$1 and id=$2",
              [fixture.tenantId, id])).rows[0]?.active_space_version_id) };
        expect((await collectPublicationEvidence(collectionScope)).receipts.length).toBeGreaterThan(0);
        await expect(collectPublicationEvidence({ ...collectionScope, roles: { ...roles, publisher: roles.producer } }))
          .rejects.toThrow("ROLE_BINDING");
        await expect(collectPublicationEvidence({ ...collectionScope, readActiveVersion: async () => null }))
          .rejects.toThrow("NOT_ACTIVE");
        return;
      }
      const representationDecisionId = (representationReview.receipts.find(receipt => receipt.receiptKind === "decide.succeeded")!.body as Record<string, unknown>).decisionId;
      const selected = await host.persistSelection(selection);
      const original = await fixture.database.getOperationRecord(fixture.tenantId, fixture.candidateInput.preparation.operationId);
      const proposal = { ...((original!.request as Record<string, unknown>).input as object), ...selected,
        representationDecisionId, projectionProcedureId: infrastructure.projectionProcedureId };
      const bound = await host.bind({ ...selected, proposal });
      const awaitingReview = await bound.advance();
      expect(awaitingReview.progress.status).toBe("review_required");
      expect(await bound.evaluateAndPublish()).toMatchObject({ status: "review_required" });
      const preparedBody = awaitingReview.executions.flatMap(execution => execution.receipts)
        .find(receipt => receipt.receiptKind === "propose.succeeded")!.body as Record<string, unknown>;
      await expect(bound.continueReview({ guardedDigest: `sha256:${"0".repeat(64)}`, decision: "accept", gates: {}, policyVersion: "synthetic-root-proof.v1", rationale: "wrong digest" }))
        .rejects.toThrow("REVIEW_DIGEST_MISMATCH");
      const review = await bound.continueReview({ guardedDigest: preparedBody.proposalDigest, decision: "accept",
        gates: { exactMembership: true, retainedQualifications: true }, policyVersion: "synthetic-root-proof.v1", rationale: "Explicit independent synthetic fixture review." });
      expect(review.execution.operation?.status).toBe("succeeded");
      expect((await bound.advance()).progress.status).toBe("complete");
      const publication = await bound.evaluateAndPublish();
      expect(publication.status).toBe("published");
      if (publication.status !== "published" || !publication.publications) throw new Error("PUBLICATION_PROOF_MISSING");
      expect(publication.publications.flatMap(item => item.receipts).some(receipt => receipt.receiptKind === "verify.succeeded")).toBe(true);
      const active = await fixture.database.transaction(fixture.tenantId, async client => (await client.query<{ active_space_version_id: string }>(
        "select active_space_version_id from retrieval.vector_store_space where tenant_id=$1 and id=$2",
        [fixture.tenantId, infrastructure.spaces[0]!.vectorStoreSpaceId])).rows[0]!);
      expect(active.active_space_version_id).toBe(infrastructure.spaces[0]!.vectorSpaceVersionId);
      await fixture.database.transaction(fixture.tenantId, client => client.query("update retrieval.vector_space_version set index_configuration='{}'::jsonb where tenant_id=$1 and id=$2",
        [fixture.tenantId, infrastructure.spaces[0]!.vectorSpaceVersionId]));
      await expect(host.prepareInfrastructure()).rejects.toThrow("INFRASTRUCTURE_REPLAY_MISMATCH");
    } finally { await evidence.close(); await fixture.close(); }
  }, 300000);
});
