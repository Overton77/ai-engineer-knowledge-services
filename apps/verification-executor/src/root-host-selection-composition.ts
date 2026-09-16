import { JsonValueSchema, PromotionProposalInputSchema, PromotionSelectionAuthoritySchema, PromotionSelectionSchema, UuidSchema, VectorSpaceSchema } from "@aiengineer/knowledge-contracts";
import { sha256Digest } from "@aiengineer/knowledge-domain";
import { PostgresKnowledgeOperationService, PostgresGovernedIndexRepository, PostgresVectorStoreLifecycleRepository, validatePromotionSelection } from "@aiengineer/knowledge-persistence";
import { deterministicUuid } from "@aiengineer/knowledge-runtime";
import { z } from "zod";
import { createProductionActivityRegistry, createCanonicalActivityExecutor } from "../../worker/src/activity-registry.js";
import { CanonicalDurableKnowledgeWorker } from "../../worker/src/canonical-worker.js";
import { composePromotionSelectionHost } from "./knowledge/promotion-selection-host.js";
import { createRootSelectionHost, type RootSelectionHostPins } from "./root-host-selection.js";

type RootPorts = Pick<RootSelectionHostPins, "database" | "artifacts" | "artifactStores" | "evidence" | "tenantId" | "correlationId" | "origin">;
export interface RootSelectionScope extends Pick<RootSelectionHostPins, "producer" | "reviewer" | "evaluator" | "publisher" | "embeddingExecutor"
  | "policyDigest" | "measure" | "embeddingAdapter" | "embeddingAdapterVersion" | "reviewAuthority"> {
  readonly authority: unknown;
  readonly targetSpaces: readonly string[];
  readonly evaluationQueryTexts: readonly { queryId: string; text: string }[];
  readonly infrastructure: { readonly namespace: string; readonly authorizationReference: string };
}
const digest = (value: unknown) => sha256Digest(JsonValueSchema.parse(value));

/** Explicit host configuration. No factual rows, embeddings, admissions or publication receipts are synthesized. */
export async function createRootSelectionComposition(ports: RootPorts, proposedScope: RootSelectionScope) {
  const scope = { ...proposedScope, infrastructure: { ...proposedScope.infrastructure },
    producer: { ...proposedScope.producer }, reviewer: { ...proposedScope.reviewer }, evaluator: { ...proposedScope.evaluator },
    publisher: { ...proposedScope.publisher }, embeddingExecutor: { ...proposedScope.embeddingExecutor },
    evaluationQueryTexts: structuredClone(proposedScope.evaluationQueryTexts),
    targetSpaces: z.array(VectorSpaceSchema).min(1).max(8).parse(proposedScope.targetSpaces) };
  const authority = PromotionSelectionAuthoritySchema.parse(scope.authority);
  if (authority.tenantId !== ports.tenantId || authority.policyDigest !== scope.policyDigest
    || authority.proposedBy !== scope.producer.identity || authority.requiredReviewer !== scope.reviewer.identity)
    throw new Error("ROOT_SELECTION_AUTHORITY_SCOPE_MISMATCH");
  if (!scope.infrastructure.authorizationReference.trim() || !/^[a-z0-9-]{1,64}$/.test(scope.infrastructure.namespace)
    || new Set(scope.targetSpaces).size !== scope.targetSpaces.length) throw new Error("ROOT_SELECTION_INFRASTRUCTURE_AUTHORITY_REQUIRED");
  const roles = [scope.producer, scope.reviewer, scope.evaluator, scope.publisher, scope.embeddingExecutor];
  roles.forEach(role => { UuidSchema.parse(role.identity); UuidSchema.parse(role.attemptId); });
  if (new Set(roles.map(role => role.identity)).size !== roles.length || new Set(roles.map(role => role.attemptId)).size !== roles.length)
    throw new Error("ROOT_SELECTION_SEPARATION_OF_DUTY_REQUIRED");
  const attempts = await ports.database.transaction(ports.tenantId, async client => (await client.query<{ id: string; agent_deployment_id: string }>(
    `select a.id,a.agent_deployment_id from orchestration.attempt a join orchestration.work_item w on w.tenant_id=a.tenant_id and w.id=a.work_item_id
      where a.tenant_id=$1 and a.id=any($2::uuid[]) and w.mission_id=$3`,
    [ports.tenantId, roles.map(role => role.attemptId), ports.correlationId])).rows);
  if (attempts.length !== roles.length || new Set(attempts.map(attempt => attempt.agent_deployment_id)).size !== roles.length)
    throw new Error("ROOT_SELECTION_CANONICAL_ATTEMPTS_REQUIRED");
  if (!scope.evaluationQueryTexts.length || scope.evaluationQueryTexts.length > 16
    || new Set(scope.evaluationQueryTexts.map(query => query.queryId)).size !== scope.evaluationQueryTexts.length
    || scope.evaluationQueryTexts.some(query => !query.queryId.trim() || !query.text.trim())) throw new Error("ROOT_SELECTION_ORIGINAL_QUERIES_REQUIRED");
  const authorityArtifact = await ports.artifacts.put({ tenantId: ports.tenantId, missionId: ports.correlationId,
    artifactType: "workspace_file", mediaType: "application/vnd.aiengineer.promotion-selection-authority+json", value: authority });
  if (authorityArtifact.storageState !== "available") throw new Error("ROOT_SELECTION_REMOTE_AUTHORITY_REQUIRED");
  const locator = { id: authorityArtifact.artifactId, digest: authorityArtifact.digest };
  const hostPins = { ...ports, ...scope, authorityArtifact: locator };
  const selectionAuthority = composePromotionSelectionHost(hostPins).promotionSelection;
  const registry = createProductionActivityRegistry({ retrieval: ports.database, review: ports.database,
    vectorStore: new PostgresVectorStoreLifecycleRepository(ports.database),
    governedIndex: { repository: new PostgresGovernedIndexRepository(ports.database, selectionAuthority),
      embeddingAdapter: scope.embeddingAdapter, embeddingAdapterVersion: scope.embeddingAdapterVersion } });
  const worker = new CanonicalDurableKnowledgeWorker(`root-infrastructure:${ports.tenantId}`, ports.tenantId, ports.database,
    createCanonicalActivityExecutor(ports.database, registry));
  const operations = new PostgresKnowledgeOperationService(ports.database);
  const identity = `${ports.tenantId}:${scope.infrastructure.namespace}`;
  const projectionProcedureId = deterministicUuid("root-selection-procedure", identity);
  const spaces = scope.targetSpaces.map(space => ({ space, vectorSpaceId: deterministicUuid("root-selection-space", `${identity}:${space}`),
    vectorSpaceVersionId: deterministicUuid("root-selection-version", `${identity}:${space}`),
    vectorStoreSpaceId: deterministicUuid("root-selection-store-space", `${identity}:${space}`),
    modelSlug: "openai/text-embedding-3-small", providerRoute: ["openai"] }));
  let infrastructure: Awaited<ReturnType<typeof prepareInfrastructure>> | undefined;
  async function prepareInfrastructure() {
    const operationId = deterministicUuid("root-selection-store-operation", identity);
    await operations.submit("vector_store_create", { context: { tenantId: ports.tenantId, operationId, attemptId: scope.publisher.attemptId,
      correlationId: ports.correlationId, actor: { kind: "service", id: scope.publisher.identity, serviceIdentity: "control_plane" },
      capabilityVersion: "root-selection.v1", idempotencyKey: `root-selection-store:${identity}`, reason: scope.infrastructure.authorizationReference, contractVersion: "v1" },
      input: { schemaVersion: "knowledge.vector-store/v1", slug: `root-${scope.infrastructure.namespace}`, name: "Host-authorized selected knowledge",
        purpose: "Independent selected candidate evaluation", storeClass: "internal_exploratory", visibility: "tenant",
        quotaProfile: { maximumDocuments: 100, maximumBytes: 64000000, maximumSpaces: 8 }, retentionPolicy: { mode: "indefinite" },
        deletionPolicy: { mode: "review_required", minimumRetentionDays: 0 } }, expectedVersions: { api: "v1" } }, ports.origin);
    if ((await ports.database.getOperation(ports.tenantId, operationId))?.status !== "succeeded") await worker.runOperationOnce(operationId);
    const operation = await ports.database.getOperation(ports.tenantId, operationId), receipts = await ports.database.listReceipts(ports.tenantId, operationId);
    if (operation?.status !== "succeeded") throw new Error("ROOT_SELECTION_STORE_CREATION_INCOMPLETE");
    const vectorStoreId = deterministicUuid("vector-store", operationId);
    const configuration = { exactSelection: true, contextualPrefix: "" }, codeDigest = digest({ procedure: "canonical-selected-membership.v1", configuration });
    await ports.database.transaction(ports.tenantId, async client => {
      await client.query(`insert into retrieval.projection_procedure(id,slug,version,description,code_ref,implementation_sha256,projection_policy)
        values($1,$2,1,'Exact admitted selected membership','packages/persistence/src/promotion-selection.ts',$3,$4::jsonb) on conflict(id) do nothing`,
      [projectionProcedureId, `root-${scope.infrastructure.namespace}-${ports.tenantId}`, codeDigest.slice(7), JSON.stringify(configuration)]);
      const procedure = (await client.query<{ valid: boolean }>(`select slug=$2 and version=1 and code_ref='packages/persistence/src/promotion-selection.ts'
        and implementation_sha256=$3 and projection_policy=$4::jsonb valid from retrieval.projection_procedure where id=$1`,
      [projectionProcedureId, `root-${scope.infrastructure.namespace}-${ports.tenantId}`, codeDigest.slice(7), JSON.stringify(configuration)])).rows[0];
      if (procedure?.valid !== true) throw new Error("ROOT_SELECTION_PROCEDURE_REPLAY_MISMATCH");
      for (const pin of spaces) {
        await client.query(`insert into retrieval.vector_space(id,tenant_id,slug,purpose,class) values($1,$2,$3,'Host-authorized selected knowledge','exploratory') on conflict(tenant_id,slug) do nothing`,
          [pin.vectorSpaceId, ports.tenantId, pin.space]);
        const retainedSpace = (await client.query<{ id: string; class: string }>("select id,class from retrieval.vector_space where tenant_id=$1 and slug=$2 for update", [ports.tenantId, pin.space])).rows[0];
        if (!retainedSpace || retainedSpace.class !== "exploratory") throw new Error("ROOT_SELECTION_SPACE_AUTHORITY_MISMATCH");
        pin.vectorSpaceId = retainedSpace.id;
        await client.query(`insert into retrieval.vector_space_version(id,tenant_id,vector_space_id,version,embedding_model,dims,projection_procedure_id,backend,precision,index_configuration,provider_routing_policy)
          values($1,$2,$3,(select coalesce(max(version),0)+1 from retrieval.vector_space_version where tenant_id=$2 and vector_space_id=$3),$4,1536,$5,'pgvector','halfvec',$6::jsonb,$7::jsonb) on conflict(id) do nothing`,
        [pin.vectorSpaceVersionId, ports.tenantId, pin.vectorSpaceId, pin.modelSlug, projectionProcedureId,
          JSON.stringify({ type: "hnsw", operator: "halfvec_cosine_ops" }), JSON.stringify({ ordered: pin.providerRoute })]);
        await client.query(`insert into retrieval.vector_store_space(id,tenant_id,vector_store_id,vector_space_id,authority_class)
          values($1,$2,$3,$4,'exploratory') on conflict(id) do nothing`, [pin.vectorStoreSpaceId, ports.tenantId, vectorStoreId, pin.vectorSpaceId]);
        const matched = (await client.query<{ valid: boolean }>(`select s.slug=$7 and s.class='exploratory' and v.embedding_model=$8 and v.dims=1536
          and v.projection_procedure_id=$6 and v.backend='pgvector' and v.precision='halfvec'
          and v.index_configuration=$9::jsonb and v.provider_routing_policy=$10::jsonb and ss.authority_class='exploratory' valid
          from retrieval.vector_space s join retrieval.vector_space_version v on v.tenant_id=s.tenant_id and v.vector_space_id=s.id
          join retrieval.vector_store_space ss on ss.tenant_id=s.tenant_id and ss.vector_space_id=s.id
          where s.tenant_id=$1 and s.id=$2 and v.id=$3 and ss.id=$4 and ss.vector_store_id=$5`,
        [ports.tenantId, pin.vectorSpaceId, pin.vectorSpaceVersionId, pin.vectorStoreSpaceId, vectorStoreId, projectionProcedureId, pin.space, pin.modelSlug,
          JSON.stringify({ type: "hnsw", operator: "halfvec_cosine_ops" }), JSON.stringify({ ordered: pin.providerRoute })])).rows[0];
        if (matched?.valid !== true) throw new Error("ROOT_SELECTION_INFRASTRUCTURE_REPLAY_MISMATCH");
      }
    });
    const result = { projectionProcedureId, vectorStoreId, spaces, operation, receipts, authorityArtifact: locator };
    infrastructure = result; return result;
  }
  const representationReview = z.strictObject({ representationId: UuidSchema, reviewSubjectId: UuidSchema,
    guardedDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/), decision: z.enum(["accept", "reject", "quarantine", "defer", "request_changes"]),
    policyVersion: z.string().min(1), rationale: z.string().min(1) });
  return {
    authorityArtifact: locator, prepareInfrastructure,
    async reviewRepresentation(proposed: unknown) {
      if (!scope.reviewAuthority) throw new Error("ROOT_SELECTION_REVIEW_AUTHORITY_REQUIRED");
      const request = representationReview.parse(proposed);
      const operationId = deterministicUuid("root-representation-review", `${identity}:${digest(request)}`);
      await operations.submit("representation_decision", { context: { tenantId: ports.tenantId, operationId,
        attemptId: scope.reviewer.attemptId, correlationId: ports.correlationId, actor: { kind: "service", id: scope.reviewer.identity, serviceIdentity: "human_reviewer" },
        capabilityVersion: "root-selection.v1", idempotencyKey: `root-representation-review:${operationId}`,
        reason: scope.reviewAuthority.authorizationReference, contractVersion: "v1" },
        input: { schemaVersion: "knowledge.representation-decision/v1", ...request,
          rationale: `${scope.reviewAuthority.kind}: ${request.rationale}` }, expectedVersions: { api: "v1" } }, ports.origin);
      if ((await ports.database.getOperation(ports.tenantId, operationId))?.status !== "succeeded") await worker.runOperationOnce(operationId);
      return { operation: await ports.database.getOperation(ports.tenantId, operationId), receipts: await ports.database.listReceipts(ports.tenantId, operationId), reviewAuthority: scope.reviewAuthority };
    },
    async persistSelection(proposed: unknown) {
      const selection = PromotionSelectionSchema.parse(proposed);
      if (selection.tenantId !== ports.tenantId || selection.runPinDigest !== authority.runPinDigest || selection.policyDigest !== authority.policyDigest
        || selection.proposedBy !== authority.proposedBy || selection.requiredReviewer !== authority.requiredReviewer)
        throw new Error("ROOT_SELECTION_REQUEST_PIN_MISMATCH");
      const artifact = await ports.artifacts.put({ tenantId: ports.tenantId, missionId: ports.correlationId,
        artifactType: "workspace_file", mediaType: "application/vnd.aiengineer.promotion-selection+json", value: selection });
      if (artifact.storageState !== "available") throw new Error("ROOT_SELECTION_REMOTE_SELECTION_REQUIRED");
      return { selection, selectionArtifact: { id: artifact.artifactId, digest: artifact.digest } };
    },
    async bind(request: Parameters<ReturnType<typeof createRootSelectionHost>["bind"]>[0]) {
      if (!infrastructure) throw new Error("ROOT_SELECTION_INFRASTRUCTURE_REQUIRED");
      const proposal = PromotionProposalInputSchema.parse(request.proposal);
      if (proposal.projectionProcedureId !== projectionProcedureId || digest(proposal.selection) !== digest(request.selection)
        || digest(proposal.selectionArtifact) !== digest(request.selectionArtifact)) throw new Error("ROOT_SELECTION_REQUEST_PIN_MISMATCH");
      await ports.database.transaction(ports.tenantId, async client => validatePromotionSelection(client, {
        selection: proposal.selection, artifact: proposal.selectionArtifact,
        authority: await selectionAuthority.selectionAuthority(client, ports.tenantId), ports: selectionAuthority.selectionPorts,
      }));
      const queries = [], queryReceipts = [];
      for (const query of scope.evaluationQueryTexts) {
        const receipt = await scope.embeddingAdapter.embedOne({ modelSlug: "openai/text-embedding-3-small", expectedDimensions: 1536,
          vectorSpaceVersionId: spaces[0]!.vectorSpaceVersionId, providerRoute: ["openai"],
          idempotencyKey: `root-evaluation-query:${identity}:${digest(query)}`, input: { projectionId: query.queryId, text: query.text } });
        queries.push({ queryId: query.queryId, embedding: receipt.item.embedding }); queryReceipts.push(receipt);
      }
      const host = createRootSelectionHost({ ...hostPins, publisherOwnerIdentity: `service:${scope.publisher.identity}`, capabilityVersion: "root-selection.v1",
        spaces: spaces.map(({ vectorSpaceId: _id, ...pin }) => pin), evaluation: { queries, resultLimit: 20, minimumRecallAtK: 1 } });
      return { ...host.bind(request), queryReceipts };
    },
  };
}
