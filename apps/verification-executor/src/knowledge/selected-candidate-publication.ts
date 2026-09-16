import { CANDIDATE_EVALUATION_GATE, type GovernedCandidateEvaluation, type GovernedSelectedCandidateResult } from "@aiengineer/knowledge-persistence";
import type { SelectedCandidateIndexInput } from "@aiengineer/knowledge-contracts";
import { expect } from "vitest";
import type { SelectedCandidateFixture } from "./selected-candidate-fixture.js";

export const PUBLICATION_SPACE = "engineering_claims" as const;
export const QUERY_DIMENSIONS = 1536;
export const RESULT_LIMIT = 4;
type ReceiptBody = Record<string, unknown>;

export function queryEmbedding(): number[] {
  return Array.from({ length: QUERY_DIMENSIONS }, (_, index) => (index === 0 ? 1 : 0));
}

export function evaluationQueries() {
  return [{ queryId: "preview-selected-membership", embedding: queryEmbedding() }];
}

function evaluationBinding(body: ReceiptBody) {
  const spaces = body.spaces;
  if (!Array.isArray(spaces) || spaces.length !== 1) throw new Error("EVALUATION_SPACE_COUNT");
  const space = spaces[0] as ReceiptBody;
  return { evaluationResultId: String(space.evaluationResultId), evaluationDigest: String(space.resultDigest) as `sha256:${string}` };
}

export async function evaluateCandidate(fixture: SelectedCandidateFixture, input: {
  candidateInput: SelectedCandidateIndexInput;
  candidate: GovernedSelectedCandidateResult;
}) {
  const operationId = await fixture.submitDurable({ kind: "vector_store_evaluation",
    actor: { kind: "service", id: fixture.evaluatorIdentity, serviceIdentity: "evaluation_executor" },
    payload: { schemaVersion: "knowledge.selected-candidate-evaluation/v1", candidate: input.candidateInput,
      candidateEvidenceDigest: input.candidate.evidenceDigest, evaluatorIdentity: fixture.evaluatorIdentity,
      queries: evaluationQueries(), resultLimit: RESULT_LIMIT, minimumRecallAtK: 1 },
    reason: "Independent selected-candidate activation evaluation" });
  await fixture.runDurable({ name: "publication-evaluate", kinds: ["vector_store_evaluation"], operationId, steps: 1 });
  const receipts = await fixture.database.listReceipts(fixture.tenantId, operationId);
  const body = receipts.find(receipt => receipt.receiptKind === "evaluate.succeeded")?.body as ReceiptBody | undefined;
  if (!body) throw new Error("EVALUATION_RECEIPT_MISSING");
  expect(body.passed).toBe(true);
  expect(body.evaluatorIdentity).toBe(fixture.evaluatorIdentity);
  expect(input.candidate.publishable).toBe(false);
  return { operationId, ...evaluationBinding(body), evaluation: body as unknown as GovernedCandidateEvaluation };
}

export async function publishCandidate(fixture: SelectedCandidateFixture, input: {
  candidateInput: SelectedCandidateIndexInput;
  candidate: GovernedSelectedCandidateResult;
  evaluationResultId: string;
  evaluationDigest: `sha256:${string}`;
  steps: number;
  reason: string;
}) {
  const space = input.candidate.spaces[0];
  if (!space) throw new Error("PUBLICATION_CANDIDATE_SPACE_MISSING");
  const operationId = await fixture.submitDurable({ kind: "space_publication",
    actor: { kind: "service", id: fixture.publisherIdentity, serviceIdentity: "control_plane" },
    payload: { schemaVersion: "knowledge.space-publication/v1", vectorStoreSpaceId: fixture.vectorStoreSpaceId,
      vectorSpaceVersionId: space.vectorSpaceVersionId, promotionDecisionId: fixture.promotionDecisionId,
      evaluationResultId: input.evaluationResultId, expectedOwnerIdentity: fixture.publisherIdentity,
      guardedDigest: fixture.proposalDigest, reason: input.reason, candidate: input.candidateInput,
      candidateEvidenceDigest: input.candidate.evidenceDigest, evaluationDigest: input.evaluationDigest },
    reason: input.reason });
  await fixture.runDurable({ name: "publication-activate", kinds: ["space_publication"], operationId, steps: input.steps });
  return operationId;
}

export async function publicationIdFor(fixture: SelectedCandidateFixture, operationId: string, receiptKind: string) {
  const receipts = await fixture.database.listReceipts(fixture.tenantId, operationId);
  const body = receipts.find(receipt => receipt.receiptKind === receiptKind)?.body as ReceiptBody | undefined;
  if (typeof body?.publicationId !== "string") throw new Error(`PUBLICATION_RECEIPT_MISSING:${receiptKind}`);
  return body.publicationId;
}

export async function admittedGateCount(fixture: SelectedCandidateFixture) {
  return fixture.db.transaction({ tenantId: fixture.tenantId, readOnly: true }, async client => {
    const rows = (await client.query<{ slug: string; passed: boolean }>(`
      select v.slug, g.passed from evaluation.promotion_gate_result g
        join evaluation.promotion_gate_version v on v.tenant_id=g.tenant_id and v.id=g.gate_version_id
      where g.tenant_id=$1 order by g.created_at,g.id`, [fixture.tenantId])).rows;
    expect(rows.every(row => row.slug === CANDIDATE_EVALUATION_GATE && row.passed)).toBe(true);
    return rows.length;
  });
}
