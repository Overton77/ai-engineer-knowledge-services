import { JsonValueSchema, PromotionProposalInputSchema, SelectedCandidateIndexInputSchema,
  SelectedCandidateEvaluationInputSchema, UuidSchema, type JsonValue, type OperationKind } from "@aiengineer/knowledge-contracts";
import { sha256Digest } from "@aiengineer/knowledge-domain";
import { PostgresGovernedIndexRepository, PostgresKnowledgeOperationService, sameActorIdentity,
  type PostgresCanonicalRepository } from "@aiengineer/knowledge-persistence";
import { deterministicUuid } from "@aiengineer/knowledge-runtime";
import { z } from "zod";
import { createCanonicalActivityExecutor, createProductionActivityRegistry,
  type ProductionActivityDependencies } from "../../worker/src/activity-registry.js";
import { CanonicalDurableKnowledgeWorker } from "../../worker/src/canonical-worker.js";
import type { CanonicalPromotionSelectionConfiguration } from "../../worker/src/promotion-selection.js";
import { composePromotionSelectionHost, createPromotionSelectionAdvance,
  type PromotionSelectionHostPins } from "./knowledge/promotion-selection-host.js";

type Row = Record<string, unknown>;
type ActorPin = { readonly identity: string; readonly attemptId: string };
const digest = (value: unknown) => sha256Digest(JsonValueSchema.parse(value));
const reviewSchema = z.strictObject({
  decision: z.enum(["accept", "reject", "defer", "request_changes"]),
  guardedDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  gates: JsonValueSchema, policyVersion: z.string().trim().min(1), rationale: z.string().trim().min(1).max(8000),
});

export interface RootSelectionHostPins extends PromotionSelectionHostPins {
  readonly database: PostgresCanonicalRepository;
  readonly producer: ActorPin;
  readonly reviewer: ActorPin;
  readonly evaluator: ActorPin;
  readonly publisher: ActorPin;
  readonly publisherOwnerIdentity?: string;
  readonly embeddingExecutor: ActorPin;
  readonly correlationId: string;
  readonly capabilityVersion: string;
  readonly origin: string;
  readonly embeddingAdapter: NonNullable<ProductionActivityDependencies["governedIndex"]>["embeddingAdapter"];
  readonly embeddingAdapterVersion: string;
  readonly spaces: readonly (CanonicalPromotionSelectionConfiguration["spaces"][number] & { readonly vectorStoreSpaceId: string })[];
  readonly evaluation: {
    readonly queries: readonly { readonly queryId: string; readonly embedding: readonly number[] }[];
    readonly resultLimit: number;
    readonly minimumRecallAtK: number;
  };
  /** Host-only authority. Never populate this from a producer tool argument. */
  readonly reviewAuthority?: { readonly kind: "independent_reviewer"; readonly authorizationReference: string }
    | { readonly kind: "synthetic_development_fixture"; readonly authorizationReference: string; readonly synthetic: true };
}

/** Validate the immutable root identities before opening any canonical operation. */
export function assertRootSelectionPins(pins: RootSelectionHostPins): void {
  UuidSchema.parse(pins.tenantId);
  if (pins.publisherOwnerIdentity !== undefined && !sameActorIdentity(pins.publisherOwnerIdentity, pins.publisher.identity))
    throw new Error("ROOT_SELECTION_OWNER_PIN_MISMATCH");
  const actors = [pins.producer, pins.reviewer, pins.evaluator, pins.publisher, pins.embeddingExecutor];
  for (const actor of actors) { UuidSchema.parse(actor.identity); UuidSchema.parse(actor.attemptId); }
  if (actors.some((actor, index) => actors.slice(index + 1).some(other =>
    sameActorIdentity(actor.identity, other.identity) || actor.attemptId === other.attemptId)))
    throw new Error("ROOT_SELECTION_SEPARATION_OF_DUTY_REQUIRED");
  if (pins.reviewAuthority && (!pins.reviewAuthority.authorizationReference.trim()
    || !["independent_reviewer", "synthetic_development_fixture"].includes(pins.reviewAuthority.kind)
    || (pins.reviewAuthority.kind === "synthetic_development_fixture" && pins.reviewAuthority.synthetic !== true)))
    throw new Error("ROOT_SELECTION_REVIEW_AUTHORITY_REQUIRED");
  if (!pins.spaces.length || new Set(pins.spaces.map(space => space.space)).size !== pins.spaces.length
    || new Set(pins.spaces.map(space => space.vectorStoreSpaceId)).size !== pins.spaces.length)
    throw new Error("ROOT_SELECTION_SPACE_PINS_REQUIRED");
  for (const space of pins.spaces) { UuidSchema.parse(space.vectorSpaceVersionId); UuidSchema.parse(space.vectorStoreSpaceId); }
  if (!pins.evaluation.queries.length || pins.evaluation.queries.length > 16
    || new Set(pins.evaluation.queries.map(query => query.queryId)).size !== pins.evaluation.queries.length
    || pins.evaluation.queries.some(query => !query.queryId.trim() || query.embedding.length !== 1536
      || query.embedding.some(value => !Number.isFinite(value)) || !query.embedding.some(value => value !== 0))
    || !Number.isInteger(pins.evaluation.resultLimit) || pins.evaluation.resultLimit < 1 || pins.evaluation.resultLimit > 100
    || pins.evaluation.minimumRecallAtK !== 1)
    throw new Error("ROOT_SELECTION_EVALUATION_PINS_REQUIRED");
}

/** Selected promotion through the existing canonical scheduler and production activities. */
export function createRootSelectionHost(input: RootSelectionHostPins) {
  assertRootSelectionPins(input);
  const pins = { ...input, producer: { ...input.producer }, reviewer: { ...input.reviewer }, evaluator: { ...input.evaluator },
    publisher: { ...input.publisher }, embeddingExecutor: { ...input.embeddingExecutor },
    spaces: structuredClone(input.spaces), evaluation: structuredClone(input.evaluation),
    reviewAuthority: input.reviewAuthority ? { ...input.reviewAuthority } : undefined };
  const authority = composePromotionSelectionHost(pins).promotionSelection;
  const governance = new PostgresGovernedIndexRepository(pins.database, authority);
  const operations = new PostgresKnowledgeOperationService(pins.database);
  const registry = createProductionActivityRegistry({ retrieval: pins.database, review: pins.database,
    governedIndex: { repository: governance, embeddingAdapter: pins.embeddingAdapter, embeddingAdapterVersion: pins.embeddingAdapterVersion } });
  const worker = new CanonicalDurableKnowledgeWorker(`root-selection:${pins.tenantId}`, pins.tenantId, pins.database,
    createCanonicalActivityExecutor(pins.database, registry));

  const retained = async (operationId: string) => ({ operation: await pins.database.getOperation(pins.tenantId, operationId),
    receipts: await pins.database.listReceipts(pins.tenantId, operationId) });
  async function drive(operationId: string, maximumSteps: number) {
    let failure: string | undefined;
    for (let step = 0; step < maximumSteps; step++) {
      const operation = await pins.database.getOperation(pins.tenantId, operationId);
      if (!operation || ["succeeded", "failed", "cancelled", "quarantined", "needs_review"].includes(operation.status)) break;
      try { if (!await worker.runOperationOnce(operationId)) break; }
      catch (error) { failure = error instanceof Error ? error.name : "ACTIVITY_ERROR"; break; }
    }
    return { ...await retained(operationId), ...(failure ? { failure } : {}) };
  }
  async function submit(kind: OperationKind, actor: ActorPin, serviceIdentity: "human_reviewer" | "evaluation_executor" | "control_plane", payload: JsonValue) {
    const key = `root-selection:${kind}:${digest(payload)}`;
    const operationId = deterministicUuid("root-selection-operation", `${pins.tenantId}:${key}`);
    await operations.submit(kind, { context: { tenantId: pins.tenantId, operationId, attemptId: actor.attemptId,
      correlationId: pins.correlationId, actor: { kind: "service", id: actor.identity, serviceIdentity },
      capabilityVersion: pins.capabilityVersion, idempotencyKey: key, reason: "Host-authorized selected publication", contractVersion: "v1" },
      input: payload, expectedVersions: { api: "v1" } }, pins.origin);
    return operationId;
  }
  return {
    bind(request: { readonly selection: unknown; readonly selectionArtifact: { readonly id: string; readonly digest: string }; readonly proposal: unknown }) {
      const proposal = PromotionProposalInputSchema.parse(request.proposal);
      if (digest(proposal.selection) !== digest(request.selection) || digest(proposal.selectionArtifact) !== digest(request.selectionArtifact)
        || proposal.selection.tenantId !== pins.tenantId || proposal.selection.policyDigest !== pins.policyDigest
        || proposal.selection.proposedBy !== pins.producer.identity || proposal.selection.requiredReviewer !== pins.reviewer.identity)
        throw new Error("ROOT_SELECTION_REQUEST_PIN_MISMATCH");
      const reconcile = createPromotionSelectionAdvance({ database: pins.database, governance, authority, proposal,
        attemptId: pins.producer.attemptId, reviewerAttemptId: pins.reviewer.attemptId, correlationId: pins.correlationId,
        capabilityVersion: pins.capabilityVersion, embeddingExecutorId: pins.embeddingExecutor.identity,
        origin: pins.origin, spaces: pins.spaces.map(({ vectorStoreSpaceId: _store, ...space }) => space) });
      const requestPin = { selection: proposal.selection, artifact: proposal.selectionArtifact };
      async function advance() {
        let progress = await reconcile(requestPin);
        const executions = [];
        for (let stage = 0; stage < pins.spaces.length + 2 && progress.status === "waiting"; stage++) {
          const pending = progress.operations.at(-1);
          if (!pending) throw new Error("ROOT_SELECTION_OPERATION_MISSING");
          const execution = await drive(pending.operationId, pending.stage === "prepare" ? 1 : pending.stage === "embed" ? 2 : 3);
          executions.push(execution);
          progress = await reconcile(requestPin);
          if (execution.operation?.status !== "succeeded") break;
        }
        return { progress, executions };
      }
      async function prepared() {
        const progress = await reconcile(requestPin);
        const preparation = progress.operations.find(operation => operation.stage === "prepare");
        if (!preparation || preparation.status !== "succeeded") throw new Error("ROOT_SELECTION_PREPARATION_REQUIRED");
        const receipt = (await pins.database.listReceipts(pins.tenantId, preparation.operationId))
          .find(item => item.id === preparation.receiptId && item.receiptKind === "propose.succeeded");
        if (!receipt) throw new Error("ROOT_SELECTION_PREPARATION_RECEIPT_MISSING");
        return { progress, receipt, body: receipt.body as Row };
      }
      return {
        advance,
        inspectPreparation: prepared,
        /** Keep this closure exclusively in the trusted host; no producer-facing registration. */
        async continueReview(decisionInput: unknown) {
          if (!pins.reviewAuthority) throw new Error("ROOT_SELECTION_REVIEW_AUTHORITY_REQUIRED");
          const decision = reviewSchema.parse(decisionInput), preparation = await prepared();
          if (decision.guardedDigest !== preparation.body.proposalDigest) throw new Error("ROOT_SELECTION_REVIEW_DIGEST_MISMATCH");
          const operationId = await submit("promotion_decision", pins.reviewer, "human_reviewer", JsonValueSchema.parse({
            schemaVersion: "knowledge.promotion-decision/v1", proposalId: preparation.body.proposalId,
            reviewSubjectId: preparation.body.reviewSubjectId, ...decision,
            gates: { supplied: decision.gates, hostReviewAuthority: pins.reviewAuthority },
          }));
          return { reviewAuthority: pins.reviewAuthority, execution: await drive(operationId, 1), progress: await reconcile(requestPin) };
        },
        async evaluateAndPublish() {
          const preparation = await prepared();
          if (preparation.progress.status !== "complete") return { status: preparation.progress.status, progress: preparation.progress };
          const indexed = preparation.progress.operations.find(operation => operation.stage === "index")!;
          const record = await pins.database.getOperationRecord(pins.tenantId, indexed.operationId);
          if (!record || digest(record.request).slice(7) !== record.requestSha256) throw new Error("ROOT_SELECTION_INDEX_REQUEST_MISMATCH");
          const candidate = SelectedCandidateIndexInputSchema.parse((record.request as Row).input);
          if (digest(candidate.selection) !== digest(proposal.selection) || digest(candidate.selectionArtifact) !== digest(proposal.selectionArtifact))
            throw new Error("ROOT_SELECTION_CANDIDATE_MISMATCH");
          const verified = await governance.verifySelectedCandidate(pins.tenantId, candidate);
          const evaluationInput = SelectedCandidateEvaluationInputSchema.parse({ schemaVersion: "knowledge.selected-candidate-evaluation/v1",
            candidate, candidateEvidenceDigest: verified.evidenceDigest, evaluatorIdentity: pins.evaluator.identity, ...pins.evaluation });
          const evaluationId = await submit("vector_store_evaluation", pins.evaluator, "evaluation_executor", JsonValueSchema.parse(evaluationInput));
          const evaluation = await drive(evaluationId, 1);
          const evaluationBody = evaluation.receipts.find(receipt => receipt.receiptKind === "evaluate.succeeded")?.body as Row | undefined;
          if (evaluation.operation?.status !== "succeeded" || evaluationBody?.passed !== true)
            return { status: "evaluation_not_passed", evaluation };
          if (evaluationBody.evaluatorIdentity !== pins.evaluator.identity) throw new Error("ROOT_SELECTION_EVALUATOR_MISMATCH");
          const evaluatedSpaces = z.array(z.object({ vectorSpaceVersionId: UuidSchema, evaluationResultId: UuidSchema,
            resultDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/) })).parse(evaluationBody.spaces);
          if (evaluatedSpaces.length !== pins.spaces.length || new Set(evaluatedSpaces.map(space => space.vectorSpaceVersionId)).size !== pins.spaces.length)
            throw new Error("ROOT_SELECTION_EVALUATION_SPACE_MISMATCH");
          const publications = [];
          for (const pin of pins.spaces) {
            const space = evaluatedSpaces.find(item => item.vectorSpaceVersionId === pin.vectorSpaceVersionId);
            if (!space) throw new Error("ROOT_SELECTION_EVALUATION_SPACE_MISMATCH");
            const operationId = await submit("space_publication", pins.publisher, "control_plane", JsonValueSchema.parse({
              schemaVersion: "knowledge.space-publication/v1", vectorStoreSpaceId: pin.vectorStoreSpaceId,
              vectorSpaceVersionId: pin.vectorSpaceVersionId, promotionDecisionId: candidate.review.decisionId,
              evaluationResultId: space.evaluationResultId, expectedOwnerIdentity: pins.publisherOwnerIdentity ?? pins.publisher.identity,
              guardedDigest: preparation.body.proposalDigest, reason: "Independent evaluated selected candidate",
              candidate, candidateEvidenceDigest: verified.evidenceDigest, evaluationDigest: space.resultDigest,
            }));
            const publication = await drive(operationId, 2);
            publications.push(publication);
            if (publication.operation?.status !== "succeeded") return { status: "publication_incomplete", evaluation, publications };
          }
          return { status: "published", candidate, evaluation, publications };
        },
      };
    },
  };
}
