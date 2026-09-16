import { describe, expect, it, vi } from "vitest";
import { disposableDatabaseUrl, disposableStorageConfig } from "../../../../packages/persistence/test/disposable.mjs";
import { createSelectedCandidateFixture, type SelectedCandidateFixture } from "./selected-candidate-fixture.js";
import { PUBLICATION_SPACE, admittedGateCount, evaluateCandidate, evaluationQueries, publicationIdFor,
  publishCandidate, queryEmbedding, RESULT_LIMIT } from "./selected-candidate-publication.js";
import { readRepresentationDependencies, readRepresentationImpact } from "../../../../packages/persistence/src/representation-dependency.js";

const databaseUrl = disposableDatabaseUrl(), storage = disposableStorageConfig();
const TIMEOUT_MS = 360_000;

async function activeBaseline(fixture: SelectedCandidateFixture) {
  const evaluation = await evaluateCandidate(fixture, fixture);
  const operationId = await publishCandidate(fixture, { ...evaluation, candidateInput: fixture.candidateInput,
    candidate: fixture.candidate, steps: 2, reason: "Establish the independently evaluated invalidation baseline" });
  return { publicationId: await publicationIdFor(fixture, operationId, "verify.succeeded"),
    answer: await fixture.queryPublished({ embedding: queryEmbedding(), mode: "exact", resultLimit: RESULT_LIMIT }) };
}

async function expectBaseline(fixture: SelectedCandidateFixture, baseline: Awaited<ReturnType<typeof activeBaseline>>) {
  const answer = await fixture.queryPublished({ embedding: queryEmbedding(), mode: "exact", resultLimit: RESULT_LIMIT });
  expect(answer.publicationId).toBe(baseline.publicationId);
  expect(answer.items).toEqual(baseline.answer.items);
  expect(answer.gated).toEqual([]);
  expect(await fixture.verifyBaseline(evaluationQueries())).toMatchObject({ publicationId: baseline.publicationId, equivalent: true });
}

async function latestOperation(fixture: SelectedCandidateFixture, kind: string) {
  return fixture.db.transaction({ tenantId: fixture.tenantId, readOnly: true }, async client => {
    const row = (await client.query<{ id: string }>(`select id from knowledge_service.operation
      where tenant_id=$1 and operation_kind=$2 order by created_at desc,id desc limit 1`, [fixture.tenantId, kind])).rows[0];
    expect(row).toBeDefined();
    return row!.id;
  });
}

async function expectFailureReceipt(fixture: SelectedCandidateFixture, operationId: string) {
  const receipts = await fixture.database.listReceipts(fixture.tenantId, operationId);
  expect(receipts.filter(receipt => receipt.receiptKind === "failure")).toHaveLength(1);
  expect(receipts.find(receipt => receipt.receiptKind === "failure")!.outcome).toBe("failed");
  expect(receipts.some(receipt => receipt.receiptKind.endsWith(".succeeded"))).toBe(false);
}

describe.skipIf(!databaseUrl || !storage)("publication invalidation on guarded disposable services", () => {
  it("RC10 gates every earlier selected projection after a shared source defect and publishes freshly verified content", async () => {
    const fixture = await createSelectedCandidateFixture({ databaseUrl: databaseUrl!, storage: storage!, spaces: [PUBLICATION_SPACE] });
    let replacement: SelectedCandidateFixture | undefined;
    try {
      const baseline = await activeBaseline(fixture);
      const impact = await fixture.db.transaction({ tenantId: fixture.tenantId, readOnly: true }, client =>
        readRepresentationImpact(client, fixture.tenantId, fixture.representationId));
      expect(impact.complete).toBe(true);
      expect(impact.representationIds).toContain(fixture.preparedSummaryRepresentationId);
      expect(impact.projectionIds).toEqual([...fixture.projectionIds].sort());
      expect(impact.unsupportedReportVersionIds).toEqual([]);
      await fixture.reviewRepresentation({ representationId: fixture.representationId, digest: fixture.representationDigest,
        operationId: fixture.transformOperationId, decision: "reject" });
      const dependency = await fixture.db.transaction({ tenantId: fixture.tenantId, readOnly: true }, client =>
        readRepresentationDependencies(client, fixture.tenantId, fixture.preparedSummaryRepresentationId));
      expect(dependency.eligible).toBe(false);
      expect(dependency.blocked).toContain(`SOURCE_REPRESENTATION_NOT_ADMITTED:${fixture.representationId}`);
      const revoked = await fixture.queryPublished({ embedding: queryEmbedding(), mode: "exact", resultLimit: RESULT_LIMIT });
      expect(revoked.publicationId).toBe(baseline.publicationId);
      expect(revoked.items).toEqual([]);
      expect(revoked.gated.map(row => row.vectorItemId).sort()).toEqual(baseline.answer.items.map(row => row.vectorItemId).sort());
      await expect(evaluateCandidate(fixture, fixture)).rejects.toThrow("Representation has no current independent acceptance");
      replacement = await createSelectedCandidateFixture({ databaseUrl: databaseUrl!, storage: storage!,
        spaces: [PUBLICATION_SPACE], rebuildOf: fixture });
      expect(replacement.entityIds).toEqual(fixture.entityIds);
      expect(replacement.representationId).not.toBe(fixture.representationId);
      expect(replacement.candidateInput.selectionArtifact).not.toEqual(fixture.candidateInput.selectionArtifact);
      expect(replacement.projectionIds.some(id => fixture.projectionIds.includes(id))).toBe(false);
      expect(replacement.candidateInput.selection.selected.flatMap(row => row.admittedClaims.map(claim => claim.runId)))
        .not.toEqual(fixture.candidateInput.selection.selected.flatMap(row => row.admittedClaims.map(claim => claim.runId)));
      const evaluation = await evaluateCandidate(replacement, replacement);
      const operationId = await publishCandidate(replacement, { ...evaluation, ...replacement,
        steps: 2, reason: "Replace rejected shared-source projections with fresh native verification and independent evaluation" });
      const current = await replacement.queryPublished({ embedding: queryEmbedding(), mode: "exact", resultLimit: RESULT_LIMIT });
      expect(current.publicationId).toBe(await publicationIdFor(replacement, operationId, "verify.succeeded"));
      expect(current.items.length).toBeGreaterThan(0);
      expect(current.items.map(row => row.searchProjectionId).sort()).toEqual([...replacement.projectionIds].sort());
      expect(current.gated).toEqual([]);
      const oldDependency = await fixture.db.transaction({ tenantId: fixture.tenantId, readOnly: true }, client =>
        readRepresentationDependencies(client, fixture.tenantId, fixture.preparedSummaryRepresentationId));
      expect(oldDependency.eligible).toBe(false);
      const afterReplacement = await fixture.db.transaction({ tenantId: fixture.tenantId, readOnly: true }, client =>
        readRepresentationImpact(client, fixture.tenantId, fixture.representationId));
      expect(afterReplacement.representationIds).not.toContain(replacement.preparedSummaryRepresentationId);
      const freshDependency = await replacement.db.transaction({ tenantId: replacement.tenantId, readOnly: true }, client =>
        readRepresentationDependencies(client, replacement!.tenantId, replacement!.preparedSummaryRepresentationId));
      expect(freshDependency.eligible).toBe(true);
      expect(freshDependency.representationIds).not.toContain(fixture.representationId);
      // Synthetic graph fault: a retained artifact depends only on the root artifact, without a representation input edge.
      const artifactOnlyId = await fixture.db.transaction({ tenantId: fixture.tenantId }, async client => {
        const source = (await client.query<{ artifact_id: string }>("select artifact_id from content.document_representation where tenant_id=$1 and id=$2",
          [fixture.tenantId, fixture.representationId])).rows[0]!.artifact_id;
        const artifact = (await client.query<{ id: string }>("select id from orchestration.artifact where tenant_id=$1 and artifact_type='knowledge_read_snapshot' order by created_at,id limit 1",
          [fixture.tenantId])).rows[0]!.id;
        await client.query("insert into orchestration.artifact_lineage(tenant_id,from_artifact_id,to_artifact_id,relation_kind,activity_id,activity_version,transformation_signature) values($1,$2,$3,'derived_from','synthetic-dependency-fault','1',repeat('a',64)) on conflict do nothing",
          [fixture.tenantId, artifact, source]);
        return artifact;
      });
      const incomplete = await fixture.db.transaction({ tenantId: fixture.tenantId, readOnly: true }, client =>
        readRepresentationImpact(client, fixture.tenantId, fixture.representationId));
      expect(incomplete.complete).toBe(false);
      expect(incomplete.unsupportedArtifactIds).toContain(artifactOnlyId);
      // Synthetic required-parent fault on the fresh root: no typed input authorizes this retained snapshot.
      await replacement.db.transaction({ tenantId: replacement.tenantId }, async client => {
        const source = (await client.query<{ artifact_id: string }>("select artifact_id from content.document_representation where tenant_id=$1 and id=$2",
          [replacement!.tenantId, replacement!.representationId])).rows[0]!.artifact_id;
        await client.query("insert into orchestration.artifact_lineage(tenant_id,from_artifact_id,to_artifact_id,relation_kind,activity_id,activity_version,transformation_signature) values($1,$2,$3,'derived_from','synthetic-dependency-fault','1',repeat('b',64)) on conflict do nothing",
          [replacement!.tenantId, source, artifactOnlyId]);
      });
      const parentFault = await replacement.db.transaction({ tenantId: replacement.tenantId, readOnly: true }, client =>
        readRepresentationDependencies(client, replacement!.tenantId, replacement!.representationId));
      expect(parentFault.eligible).toBe(false);
      expect(parentFault.blocked).toContain(`DEPENDENCY_AUTHORITY_REQUIRED:${artifactOnlyId}`);
    } finally { await replacement?.close(); await fixture.close(); }
  }, TIMEOUT_MS);

  it("P04 rejects the admitted reviewer acting as publisher before any publication is staged", async () => {
    const fixture = await createSelectedCandidateFixture({ databaseUrl: databaseUrl!, storage: storage!, spaces: [PUBLICATION_SPACE] });
    try {
      const evaluation = await evaluateCandidate(fixture, fixture);
      for (const actorId of [fixture.reviewerIdentity]) {
        const operationId = await fixture.submitDurable({ kind: "space_publication",
          actor: { kind: "service", id: actorId, serviceIdentity: "control_plane" },
          payload: { schemaVersion: "knowledge.space-publication/v1", vectorStoreSpaceId: fixture.vectorStoreSpaceId,
            vectorSpaceVersionId: fixture.candidate.spaces[0]!.vectorSpaceVersionId,
            promotionDecisionId: fixture.promotionDecisionId, evaluationResultId: evaluation.evaluationResultId,
            expectedOwnerIdentity: fixture.publisherIdentity, guardedDigest: fixture.proposalDigest,
            reason: "Reject reviewer publication", candidate: fixture.candidateInput,
            candidateEvidenceDigest: fixture.candidate.evidenceDigest, evaluationDigest: evaluation.evaluationDigest },
          reason: "Prohibited reviewer and publisher role combination" });
        await expect(fixture.runDurable({ name: "reviewer-publication", kinds: ["space_publication"], operationId, steps: 1 }))
          .rejects.toThrow("PUBLICATION_SEPARATION_OF_DUTY_VIOLATION");
        await expectFailureReceipt(fixture, operationId);
      }
      const staged = await fixture.db.transaction({ tenantId: fixture.tenantId, readOnly: true }, async client =>
        (await client.query("select id from retrieval.space_publication where tenant_id=$1", [fixture.tenantId])).rows);
      expect(staged).toEqual([]);
      await expect(fixture.queryPublished({ embedding: queryEmbedding(), mode: "exact", resultLimit: RESULT_LIMIT }))
        .rejects.toThrow("PUBLICATION_ACTIVE_POINTER_MISSING");
      expect(await admittedGateCount(fixture)).toBe(1);
    } finally { await fixture.close(); }
  }, TIMEOUT_MS);

  it("P02 rejects synthetic malformed embedding batches atomically and retains the active baseline", async () => {
    const fixture = await createSelectedCandidateFixture({ databaseUrl: databaseUrl!, storage: storage!, spaces: [PUBLICATION_SPACE] });
    try {
      const baseline = await activeBaseline(fixture);
      const original = fixture.embeddingAdapter.embedMany.bind(fixture.embeddingAdapter);
      for (const [mode, expectedError] of [
        ["partial", "EMBEDDING_ITEM_COUNT_MISMATCH"], ["reordered", "EMBEDDING_RECEIPT_ORDER_MISMATCH"],
        ["dimension", "EMBEDDING_VECTOR_INVALID"], ["nonfinite", "EMBEDDING_VECTOR_INVALID"],
      ] as const) {
        let failedVersionId = "";
        const injection = vi.spyOn(fixture.embeddingAdapter, "embedMany").mockImplementation(async request => {
          failedVersionId = request.vectorSpaceVersionId;
          const receipt = await original(request);
          expect(receipt.items.length).toBeGreaterThan(1);
          // Deliberately malformed provider output, never an invented admission or evaluation gate.
          const items = receipt.items.map(item => ({ ...item, embedding: [...item.embedding] }));
          if (mode === "partial") items.pop();
          if (mode === "reordered") items.reverse();
          if (mode === "dimension") items[1]!.embedding.pop();
          if (mode === "nonfinite") items[1]!.embedding[0] = Number.POSITIVE_INFINITY;
          return { ...receipt, items };
        });
        try { await expect(fixture.createReplacementCandidate()).rejects.toThrow(expectedError); }
        finally { injection.mockRestore(); }
        expect(failedVersionId).not.toBe("");
        await expectFailureReceipt(fixture, await latestOperation(fixture, "embedding_run"));
        const counts = await fixture.db.transaction({ tenantId: fixture.tenantId, readOnly: true }, async client =>
          (await client.query<{ runs: string; items: string; physical: string }>(`select
            (select count(*) from retrieval.embedding_run where tenant_id=$1 and vector_space_version_id=$2)::text runs,
            (select count(*) from retrieval.vector_item where tenant_id=$1 and space_version_id=$2)::text items,
            (select count(*) from retrieval.vector_item_embedding_1536 where tenant_id=$1 and vector_space_version_id=$2)::text physical`,
          [fixture.tenantId, failedVersionId])).rows[0]);
        expect(counts).toEqual({ runs: "0", items: "0", physical: "0" });
        expect(await admittedGateCount(fixture)).toBe(1);
        await expectBaseline(fixture, baseline);
      }
      const repaired = await fixture.createReplacementCandidate();
      const evaluation = await evaluateCandidate(fixture, repaired);
      expect(evaluation.evaluation.passed).toBe(true);
      expect(await admittedGateCount(fixture)).toBe(2);
      await expectBaseline(fixture, baseline);
    } finally { await fixture.close(); }
  }, TIMEOUT_MS);

  it("P07 retains baseline after failed release evaluation, then rolls back an independently evaluated replacement", async () => {
    const fixture = await createSelectedCandidateFixture({ databaseUrl: databaseUrl!, storage: storage!, spaces: [PUBLICATION_SPACE] });
    try {
      const baseline = await activeBaseline(fixture);
      const failed = await fixture.createReplacementCandidate();
      await fixture.db.transaction({ tenantId: fixture.tenantId }, client => client.query(
        "delete from retrieval.vector_item_embedding_1536 where tenant_id=$1 and vector_item_id=$2",
        [fixture.tenantId, failed.candidate.spaces[0]!.vectorIds[0]]));
      await expect(evaluateCandidate(fixture, failed)).rejects.toThrow(/CANDIDATE|PHYSICAL|MEMBERSHIP/);
      await expectFailureReceipt(fixture, await latestOperation(fixture, "vector_store_evaluation"));
      expect(await admittedGateCount(fixture)).toBe(1);
      await expectBaseline(fixture, baseline);
      const replacement = await fixture.createReplacementCandidate();
      const evaluation = await evaluateCandidate(fixture, replacement);
      const operationId = await publishCandidate(fixture, { ...evaluation, ...replacement, steps: 2,
        reason: "Activate a newly built and independently evaluated candidate after failure" });
      const currentPublicationId = await publicationIdFor(fixture, operationId, "verify.succeeded");
      expect(currentPublicationId).not.toBe(baseline.publicationId);
      const rollbackId = await fixture.submitDurable({ kind: "publication_rollback",
        actor: { kind: "service", id: fixture.publisherIdentity, serviceIdentity: "control_plane" },
        payload: { schemaVersion: "knowledge.publication-rollback/v1", currentPublicationId,
          targetPublicationId: baseline.publicationId, guardedDigest: fixture.proposalDigest,
          reason: "Restore frozen baseline after failed-evaluation recovery", vectorStoreSpaceId: fixture.vectorStoreSpaceId,
          baselineQueries: evaluationQueries() }, reason: "Verify complete baseline restoration" });
      await fixture.runDurable({ name: "failed-evaluation-rollback", kinds: ["publication_rollback"], operationId: rollbackId, steps: 2 });
      expect((await fixture.database.listReceipts(fixture.tenantId, rollbackId)).map(row => row.receiptKind).sort())
        .toEqual(["rollback.succeeded", "verify.succeeded"]);
      const rollbackReceipts = await fixture.database.listReceipts(fixture.tenantId, rollbackId);
      const rollbackBody = rollbackReceipts.find(row => row.receiptKind === "verify.succeeded")!.body as {
        targetPublicationId: string; baseline: { publicationId: string; equivalent: boolean } };
      expect(rollbackBody.targetPublicationId).toBe(baseline.publicationId);
      expect(rollbackBody.baseline.equivalent).toBe(true);
      const restoredPublicationId = rollbackBody.baseline.publicationId;
      expect(restoredPublicationId).not.toBe(currentPublicationId);
      await expectBaseline(fixture, { ...baseline, publicationId: restoredPublicationId });
      expect(await fixture.verifyBaseline(evaluationQueries())).toMatchObject({
        vectorSpaceVersionId: fixture.candidate.spaces[0]!.vectorSpaceVersionId, equivalent: true });
    } finally { await fixture.close(); }
  }, TIMEOUT_MS);
});
