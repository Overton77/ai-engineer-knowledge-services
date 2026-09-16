import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { sha256Digest } from "@aiengineer/knowledge-domain";
import { disposableDatabaseUrl, disposableStorageConfig } from "../../../../packages/persistence/test/disposable.mjs";
import { createSelectedCandidateFixture, type SelectedCandidateFixture } from "./selected-candidate-fixture.js";
import { PUBLICATION_SPACE, admittedGateCount, evaluateCandidate, evaluationQueries, publicationIdFor,
  publishCandidate, queryEmbedding, RESULT_LIMIT } from "./selected-candidate-publication.js";

const databaseUrl = disposableDatabaseUrl();
const storage = disposableStorageConfig();
const FIXTURE_TIMEOUT_MS = 240_000;

async function openFixture(distinctVectors = false) {
  const fixture = await createSelectedCandidateFixture({ databaseUrl: databaseUrl!, storage: storage!, spaces: [PUBLICATION_SPACE],
    ...(distinctVectors ? { temporalEvents: [
      { key: "announcement", statement: "Synthetic Model X API was announced on 2026-01-15.", eventKind: "product_announced" as const,
        from: "2026-01-15T00:00:00.000Z", to: "2026-01-16T00:00:00.000Z" },
      { key: "ga", statement: "Synthetic Model X API became generally available on 2026-06-10.", eventKind: "product_generally_available" as const,
        from: "2026-06-10T00:00:00.000Z", to: "2026-06-11T00:00:00.000Z" },
    ] } : {}) });
  expect(new Set([fixture.proposerIdentity, fixture.reviewerIdentity, fixture.evaluatorIdentity, fixture.publisherIdentity]).size).toBe(4);
  expect(fixture.candidate.publishable).toBe(false);
  return fixture;
}

describe.skipIf(!databaseUrl || !storage)("selected-candidate evaluate, activate, revoke and rollback on guarded disposable services", () => {
  it("rejects evaluator impersonation and prefixed self-evaluation without admitting a gate", async () => {
    const fixture = await openFixture();
    try {
      for (const [name, actorId, claimedId, failure] of [
        ["impersonation", fixture.proposerIdentity, fixture.evaluatorIdentity, "Candidate evaluation requires its authenticated evaluation executor"],
        ["self-evaluation", fixture.proposerIdentity, `service:${fixture.proposerIdentity}`, "EVALUATION_SEPARATION_OF_DUTY_VIOLATION"],
        ["reviewer-evaluation", fixture.reviewerIdentity, `service:${fixture.reviewerIdentity}`, "EVALUATION_SEPARATION_OF_DUTY_VIOLATION"],
      ] as const) {
        const operationId = await fixture.submitDurable({ kind: "vector_store_evaluation",
          actor: { kind: "service", id: actorId, serviceIdentity: "evaluation_executor" },
          payload: { schemaVersion: "knowledge.selected-candidate-evaluation/v1", candidate: fixture.candidateInput,
            candidateEvidenceDigest: fixture.candidate.evidenceDigest, evaluatorIdentity: claimedId,
            queries: evaluationQueries(), resultLimit: RESULT_LIMIT, minimumRecallAtK: 1 },
          reason: `Reject ${name} before recording an evaluation gate` });
        await expect(fixture.runDurable({ name, kinds: ["vector_store_evaluation"], operationId, steps: 1 }))
          .rejects.toThrow(failure);
        expect(await admittedGateCount(fixture)).toBe(0);
      }
      await expect(fixture.queryPublished({ embedding: queryEmbedding(), mode: "exact", resultLimit: RESULT_LIMIT }))
        .rejects.toThrow("PUBLICATION_ACTIVE_POINTER_MISSING");
    } finally { await fixture.close(); }
  }, FIXTURE_TIMEOUT_MS);

  it("evaluate then revoke before activate leaves no official pointer", async () => {
    const fixture = await openFixture();
    try {
      const evaluation = await evaluateCandidate(fixture, fixture);
      expect(await admittedGateCount(fixture)).toBe(1);
      const operationId = await publishCandidate(fixture, { ...evaluation, candidateInput: fixture.candidateInput,
        candidate: fixture.candidate, steps: 1, reason: "Stage the evaluated candidate before the activation race" });
      await publicationIdFor(fixture, operationId, "publish.succeeded");
      await fixture.reviewRepresentation({ representationId: fixture.representationId, digest: fixture.representationDigest,
        operationId: fixture.transformOperationId, decision: "reject" });
      await expect(fixture.runDurable({ name: "publication-activate-race", kinds: ["space_publication"], operationId, steps: 1 }))
        .rejects.toThrow(/PUBLICATION_DEPENDENCY_INELIGIBLE/);
      await expect(fixture.queryPublished({ embedding: queryEmbedding(), mode: "exact", resultLimit: RESULT_LIMIT }))
        .rejects.toThrow("PUBLICATION_ACTIVE_POINTER_MISSING");
      expect(fixture.candidate.publishable).toBe(false);
    } finally { await fixture.close(); }
  }, FIXTURE_TIMEOUT_MS);

  it.each(["mutation", "swap"])("rejects physical vector %s between evaluation and activation", async mode => {
    const fixture = await openFixture(mode === "swap");
    try {
      const evaluation = await evaluateCandidate(fixture, fixture);
      const operationId = await publishCandidate(fixture, { ...evaluation, candidateInput: fixture.candidateInput,
        candidate: fixture.candidate, steps: 1, reason: "Stage a candidate before physical vector corruption" });
      await publicationIdFor(fixture, operationId, "publish.succeeded");
      if (mode === "swap") {
        await fixture.db.transaction({ tenantId: fixture.tenantId }, async client => {
          const vectors = (await client.query<{ vector_item_id: string; embedding: string; physical_embedding_sha256: string }>(
            "select vector_item_id,embedding::text,physical_embedding_sha256 from retrieval.vector_item_embedding_1536 where tenant_id=$1 and vector_item_id=any($2::uuid[])",
            [fixture.tenantId, fixture.candidate.spaces[0]!.vectorIds])).rows;
          const first = vectors[0]!;
          const second = vectors.find(row => row.physical_embedding_sha256 !== first.physical_embedding_sha256);
          expect(second, "swap proof requires two distinct evaluated embeddings").toBeDefined();
          await client.query("update retrieval.vector_item_embedding_1536 set embedding=case when vector_item_id=$2 then $4::extensions.halfvec else $5::extensions.halfvec end where tenant_id=$1 and vector_item_id in ($2,$3)",
            [fixture.tenantId, first.vector_item_id, second!.vector_item_id, second!.embedding, first.embedding]);
        });
      } else {
        const embedding = queryEmbedding().map((value, index) => index === 1 ? 0.25 : value);
        await fixture.db.transaction({ tenantId: fixture.tenantId }, client => client.query(
        "update retrieval.vector_item_embedding_1536 set embedding=$3::extensions.halfvec where tenant_id=$1 and vector_item_id=$2",
        [fixture.tenantId, fixture.candidate.spaces[0]!.vectorIds[0], `[${embedding.join(",")}]`]));
      }
      await expect(fixture.runDurable({ name: "reject-vector-drift", kinds: ["space_publication"], operationId, steps: 1 }))
        .rejects.toThrow("PUBLICATION_EVALUATED_VECTOR_DRIFT");
      await expect(fixture.queryPublished({ embedding: queryEmbedding(), mode: "exact", resultLimit: RESULT_LIMIT }))
        .rejects.toThrow("PUBLICATION_ACTIVE_POINTER_MISSING");
    } finally { await fixture.close(); }
  }, FIXTURE_TIMEOUT_MS);

  it("activate then revoke gates official query items", async () => {
    const fixture = await openFixture();
    try {
      const oldDefinition = { schemaVersion: "knowledge.selected-candidate-gate/v1", requires: [
        "exact_candidate_membership", "physical_index_ready", "finite_ordered_embeddings",
        "required_dependency_eligibility", "independent_evaluation", "exact_versus_ann_equivalence",
      ] };
      await fixture.db.transaction({ tenantId: fixture.tenantId }, client => client.query(
        "insert into evaluation.promotion_gate_version(id,tenant_id,slug,version,definition,definition_sha256) values($1,$2,'selected-candidate-activation',1,$3::jsonb,$4)",
        [randomUUID(), fixture.tenantId, JSON.stringify(oldDefinition), sha256Digest(oldDefinition).slice(7)]));
      const evaluation = await evaluateCandidate(fixture, fixture);
      const versions = await fixture.db.transaction({ tenantId: fixture.tenantId, readOnly: true }, async client =>
        (await client.query<{ version: number }>("select version from evaluation.promotion_gate_version where tenant_id=$1 and slug='selected-candidate-activation' order by version", [fixture.tenantId])).rows);
      expect(versions.map(row => row.version)).toEqual([1, 2]);
      const operationId = await publishCandidate(fixture, { ...evaluation, candidateInput: fixture.candidateInput,
        candidate: fixture.candidate, steps: 2, reason: "Activate the independently evaluated selected candidate" });
      const published = await publicationIdFor(fixture, operationId, "verify.succeeded");
      const official = await fixture.queryPublished({ embedding: queryEmbedding(), mode: "exact", resultLimit: RESULT_LIMIT });
      expect(official.publicationId).toBe(published);
      expect(official.items.length).toBeGreaterThan(0);
      expect(official.gated).toEqual([]);
      const ann = await fixture.queryPublished({ embedding: queryEmbedding(), mode: "ann", resultLimit: RESULT_LIMIT });
      expect(ann.annPlan).toMatch(/Index Scan using \S*hnsw\S* on/i);
      expect(ann.items.map(item => item.vectorItemId).sort()).toEqual(official.items.map(item => item.vectorItemId).sort());
      const cases = await fixture.db.transaction({ tenantId: fixture.tenantId, readOnly: true }, async client =>
        (await client.query<{ tenant_id: string }>("select tenant_id from evaluation.eval_case where tenant_id=$1", [fixture.tenantId])).rows);
      expect(cases.length).toBeGreaterThan(0);
      expect(cases.every(row => row.tenant_id === fixture.tenantId)).toBe(true);
      expect(fixture.candidate.publishable).toBe(false);
      expect(await admittedGateCount(fixture)).toBe(1);
      await fixture.reviewRepresentation({ representationId: fixture.representationId, digest: fixture.representationDigest,
        operationId: fixture.transformOperationId, decision: "reject" });
      const gated = await fixture.queryPublished({ embedding: queryEmbedding(), mode: "exact", resultLimit: RESULT_LIMIT });
      expect(gated.publicationId).toBe(published);
      expect(gated.historical.length).toBe(official.items.length);
      expect(gated.gated.length).toBeGreaterThan(0);
      expect(gated.items).toEqual([]);
    } finally { await fixture.close(); }
  }, FIXTURE_TIMEOUT_MS);

  it("replacement activate then rollback restores the frozen baseline", async () => {
    const fixture = await openFixture();
    try {
      const baselineEvaluation = await evaluateCandidate(fixture, fixture);
      const baselineOperationId = await publishCandidate(fixture, { ...baselineEvaluation, candidateInput: fixture.candidateInput,
        candidate: fixture.candidate, steps: 2, reason: "Activate the frozen baseline candidate" });
      const baselinePublicationId = await publicationIdFor(fixture, baselineOperationId, "verify.succeeded");
      const replacement = await fixture.createReplacementCandidate();
      expect(replacement.candidate.publishable).toBe(false);
      expect(replacement.vectorSpaceVersionId).not.toBe(fixture.candidate.spaces[0]!.vectorSpaceVersionId);
      const replacementEvaluation = await evaluateCandidate(fixture, replacement);
      const replacementOperationId = await publishCandidate(fixture, { ...replacementEvaluation, candidateInput: replacement.candidateInput,
        candidate: replacement.candidate, steps: 2, reason: "Activate the independently evaluated replacement" });
      const replacementPublicationId = await publicationIdFor(fixture, replacementOperationId, "verify.succeeded");
      expect(replacementPublicationId).not.toBe(baselinePublicationId);
      const rollbackId = await fixture.submitDurable({ kind: "publication_rollback",
        actor: { kind: "service", id: fixture.publisherIdentity, serviceIdentity: "control_plane" },
        payload: { schemaVersion: "knowledge.publication-rollback/v1", currentPublicationId: replacementPublicationId,
          targetPublicationId: baselinePublicationId, guardedDigest: fixture.proposalDigest,
          reason: "Restore the frozen evaluated baseline", vectorStoreSpaceId: fixture.vectorStoreSpaceId,
          baselineQueries: evaluationQueries() },
        reason: "Control-plane rollback to the frozen baseline publication" });
      await fixture.runDurable({ name: "publication-rollback", kinds: ["publication_rollback"], operationId: rollbackId, steps: 2 });
      const receipts = await fixture.database.listReceipts(fixture.tenantId, rollbackId);
      expect(receipts.map(receipt => receipt.receiptKind).sort()).toEqual(["rollback.succeeded", "verify.succeeded"]);
      const baseline = await fixture.verifyBaseline(evaluationQueries());
      expect(baseline.equivalent).toBe(true);
      expect(baseline.publicationId).not.toBe(replacementPublicationId);
      expect(baseline.vectorSpaceVersionId).toBe(fixture.candidate.spaces[0]!.vectorSpaceVersionId);
      expect(await admittedGateCount(fixture)).toBe(2);
      expect(fixture.candidate.publishable).toBe(false);
    } finally { await fixture.close(); }
  }, FIXTURE_TIMEOUT_MS);
});
