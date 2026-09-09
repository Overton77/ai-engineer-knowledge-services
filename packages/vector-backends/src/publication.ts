import { sha256Digest } from "@aiengineer/knowledge-domain";
import { CANONICAL_EMBEDDING_DIMENSIONS, VectorBackendError } from "./types.js";

export type Digest = `sha256:${string}`;
export type PublicationState = "published" | "superseded" | "withdrawn";

export interface PublicationManifests {
  readonly source: Digest;
  readonly representation: Digest;
  readonly chunkSet: Digest;
  readonly projection: Digest;
  readonly vectorItem: Digest;
  readonly embedding: Digest;
  readonly index: Digest;
  readonly retrievalPolicy: Digest;
  readonly evaluation: Digest;
}

export interface PublicationInspection {
  readonly vectorSpaceVersionId: string;
  readonly itemCount: number;
  readonly dimensions: number;
  readonly precision: "halfvec" | "vector" | string;
  readonly manifests: PublicationManifests;
  readonly indexReady: boolean;
  readonly authorizationPassed: boolean;
  readonly evaluationPassed: boolean;
  readonly sampleSearchPassed: boolean;
}

export interface PublicationInspector {
  inspect(vectorSpaceVersionId: string): Promise<PublicationInspection>;
}

export interface ExploratoryPublication {
  readonly id: string;
  readonly tenantId: string;
  readonly vectorStoreId: string;
  readonly vectorStoreSpaceId: string;
  readonly vectorSpaceVersionId: string;
  readonly storeClass: "internal_exploratory";
  readonly expectedItemCount: number;
  readonly dimensions: typeof CANONICAL_EMBEDDING_DIMENSIONS;
  readonly manifests: PublicationManifests;
  readonly promotionDecisionId: string;
  readonly evaluationGateResultId: string;
  readonly predecessorId?: string;
  readonly state: PublicationState;
  readonly verificationDigest: Digest;
  readonly receiptId: string;
  readonly publishedAt: string;
}

export interface ActivePublicationPointer {
  readonly tenantId: string;
  readonly vectorStoreSpaceId: string;
  readonly publicationId: string;
  readonly vectorSpaceVersionId: string;
  readonly revision: number;
  readonly updatedAt: string;
}

export interface PublicationEvent {
  readonly id: string;
  readonly tenantId: string;
  readonly vectorStoreSpaceId: string;
  readonly kind: "publication.activated" | "publication.rolled_back";
  readonly fromPublicationId?: string;
  readonly toPublicationId: string;
  readonly reason: string;
  readonly receiptId: string;
  readonly occurredAt: string;
}

export interface PublishExploratoryRequest {
  readonly publicationId: string;
  readonly eventId: string;
  readonly receiptId: string;
  readonly tenantId: string;
  readonly vectorStoreId: string;
  readonly vectorStoreSpaceId: string;
  readonly vectorSpaceVersionId: string;
  readonly storeClass: "internal_exploratory";
  readonly expectedItemCount: number;
  readonly manifests: PublicationManifests;
  readonly promotionDecisionId: string;
  readonly evaluationGateResultId: string;
  readonly reason: string;
}

export interface RollbackPublicationRequest {
  readonly eventId: string;
  readonly receiptId: string;
  readonly tenantId: string;
  readonly vectorStoreSpaceId: string;
  readonly targetPublicationId: string;
  readonly reason: string;
}

export interface PublicationTransaction {
  getPublication(tenantId: string, publicationId: string): ExploratoryPublication | undefined;
  getActivePointer(tenantId: string, vectorStoreSpaceId: string): ActivePublicationPointer | undefined;
  insertPublication(publication: ExploratoryPublication): void;
  setActivePointer(pointer: ActivePublicationPointer): void;
  appendEvent(event: PublicationEvent): void;
}

export interface PublicationRepository {
  transaction<T>(operation: (transaction: PublicationTransaction) => T | Promise<T>): Promise<T>;
  getPublication(tenantId: string, publicationId: string): Promise<ExploratoryPublication | undefined>;
  getActivePointer(tenantId: string, vectorStoreSpaceId: string): Promise<ActivePublicationPointer | undefined>;
  listEvents(tenantId: string, vectorStoreSpaceId: string): Promise<readonly PublicationEvent[]>;
}

/** Serializable local repository. A failed callback commits no partial publication or pointer. */
export class InMemoryPublicationRepository implements PublicationRepository {
  #publications = new Map<string, ExploratoryPublication>();
  #pointers = new Map<string, ActivePublicationPointer>();
  #events: PublicationEvent[] = [];
  #tail: Promise<void> = Promise.resolve();

  async transaction<T>(operation: (transaction: PublicationTransaction) => T | Promise<T>): Promise<T> {
    let release!: () => void;
    const turn = new Promise<void>((resolve) => { release = resolve; });
    const predecessor = this.#tail;
    this.#tail = predecessor.then(() => turn);
    await predecessor;
    const publications = new Map(this.#publications);
    const pointers = new Map(this.#pointers);
    const events = [...this.#events];
    const transaction = transactionView(publications, pointers, events);
    try {
      const result = await operation(transaction);
      this.#publications = publications;
      this.#pointers = pointers;
      this.#events = events;
      return result;
    } finally {
      release();
    }
  }

  async getPublication(tenantId: string, publicationId: string): Promise<ExploratoryPublication | undefined> {
    return this.#publications.get(publicationKey(tenantId, publicationId));
  }

  async getActivePointer(tenantId: string, vectorStoreSpaceId: string): Promise<ActivePublicationPointer | undefined> {
    return this.#pointers.get(pointerKey(tenantId, vectorStoreSpaceId));
  }

  async listEvents(tenantId: string, vectorStoreSpaceId: string): Promise<readonly PublicationEvent[]> {
    return Object.freeze(this.#events.filter((event) => event.tenantId === tenantId && event.vectorStoreSpaceId === vectorStoreSpaceId));
  }
}

export interface ReconciliationFinding {
  readonly code: string;
  readonly classification: "repairable" | "retryable" | "review_required" | "security_critical";
  readonly detail: string;
}

export interface PublicationReconciliationReport {
  readonly healthy: boolean;
  readonly publicationId?: string;
  readonly findings: readonly ReconciliationFinding[];
}

export class ExploratoryPublicationCoordinator {
  constructor(
    private readonly repository: PublicationRepository,
    private readonly inspector: PublicationInspector,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async publish(request: PublishExploratoryRequest): Promise<ExploratoryPublication> {
    validatePublishRequest(request);
    const inspection = await this.inspector.inspect(request.vectorSpaceVersionId);
    const verificationDigest = verifyInspection(request.vectorSpaceVersionId, request.expectedItemCount, request.manifests, inspection);
    const publishedAt = this.now().toISOString();

    return this.repository.transaction((transaction) => {
      const existing = transaction.getPublication(request.tenantId, request.publicationId);
      if (existing !== undefined) {
        if (existing.verificationDigest !== verificationDigest || existing.vectorSpaceVersionId !== request.vectorSpaceVersionId || existing.vectorStoreId !== request.vectorStoreId || existing.vectorStoreSpaceId !== request.vectorStoreSpaceId || existing.promotionDecisionId !== request.promotionDecisionId || existing.evaluationGateResultId !== request.evaluationGateResultId || existing.receiptId !== request.receiptId) {
          throw new VectorBackendError("IDEMPOTENCY_CONFLICT", `Publication ${request.publicationId} already exists with different verified content`);
        }
        return existing;
      }
      const active = transaction.getActivePointer(request.tenantId, request.vectorStoreSpaceId);
      const publication = freezePublication({
        id: request.publicationId,
        tenantId: request.tenantId,
        vectorStoreId: request.vectorStoreId,
        vectorStoreSpaceId: request.vectorStoreSpaceId,
        vectorSpaceVersionId: request.vectorSpaceVersionId,
        storeClass: request.storeClass,
        expectedItemCount: request.expectedItemCount,
        dimensions: CANONICAL_EMBEDDING_DIMENSIONS,
        manifests: request.manifests,
        promotionDecisionId: request.promotionDecisionId,
        evaluationGateResultId: request.evaluationGateResultId,
        ...(active === undefined ? {} : { predecessorId: active.publicationId }),
        state: "published",
        verificationDigest,
        receiptId: request.receiptId,
        publishedAt,
      });
      const pointer = Object.freeze({
        tenantId: request.tenantId,
        vectorStoreSpaceId: request.vectorStoreSpaceId,
        publicationId: publication.id,
        vectorSpaceVersionId: publication.vectorSpaceVersionId,
        revision: (active?.revision ?? 0) + 1,
        updatedAt: publishedAt,
      });
      transaction.insertPublication(publication);
      transaction.setActivePointer(pointer);
      transaction.appendEvent(Object.freeze({
        id: request.eventId,
        tenantId: request.tenantId,
        vectorStoreSpaceId: request.vectorStoreSpaceId,
        kind: "publication.activated",
        ...(active === undefined ? {} : { fromPublicationId: active.publicationId }),
        toPublicationId: publication.id,
        reason: request.reason,
        receiptId: request.receiptId,
        occurredAt: publishedAt,
      }));
      return publication;
    });
  }

  async rollback(request: RollbackPublicationRequest): Promise<ActivePublicationPointer> {
    if (request.reason.trim().length === 0) throw new VectorBackendError("INVALID_ROLLBACK", "Rollback requires a reason");
    const target = await this.repository.getPublication(request.tenantId, request.targetPublicationId);
    if (target === undefined || target.vectorStoreSpaceId !== request.vectorStoreSpaceId || target.state !== "published") {
      throw new VectorBackendError("INVALID_ROLLBACK_TARGET", "Rollback target is not an intact publication for this tenant and store space");
    }
    const inspection = await this.inspector.inspect(target.vectorSpaceVersionId);
    verifyInspection(target.vectorSpaceVersionId, target.expectedItemCount, target.manifests, inspection);
    const occurredAt = this.now().toISOString();
    return this.repository.transaction((transaction) => {
      const active = transaction.getActivePointer(request.tenantId, request.vectorStoreSpaceId);
      if (active === undefined) throw new VectorBackendError("NO_ACTIVE_PUBLICATION", "Cannot rollback without an active publication");
      if (active.publicationId === target.id) return active;
      const pointer = Object.freeze({
        tenantId: request.tenantId,
        vectorStoreSpaceId: request.vectorStoreSpaceId,
        publicationId: target.id,
        vectorSpaceVersionId: target.vectorSpaceVersionId,
        revision: active.revision + 1,
        updatedAt: occurredAt,
      });
      transaction.setActivePointer(pointer);
      transaction.appendEvent(Object.freeze({
        id: request.eventId,
        tenantId: request.tenantId,
        vectorStoreSpaceId: request.vectorStoreSpaceId,
        kind: "publication.rolled_back",
        fromPublicationId: active.publicationId,
        toPublicationId: target.id,
        reason: request.reason,
        receiptId: request.receiptId,
        occurredAt,
      }));
      return pointer;
    });
  }

  async reconcile(tenantId: string, vectorStoreSpaceId: string): Promise<PublicationReconciliationReport> {
    const pointer = await this.repository.getActivePointer(tenantId, vectorStoreSpaceId);
    if (pointer === undefined) return freezeReport(undefined, [{ code: "MISSING_ACTIVE_POINTER", classification: "review_required", detail: "No active publication pointer exists" }]);
    const publication = await this.repository.getPublication(tenantId, pointer.publicationId);
    if (publication === undefined) return freezeReport(pointer.publicationId, [{ code: "ORPHAN_ACTIVE_POINTER", classification: "security_critical", detail: "Active pointer references a missing publication" }]);
    const findings: ReconciliationFinding[] = [];
    if (publication.vectorSpaceVersionId !== pointer.vectorSpaceVersionId) findings.push({ code: "POINTER_VERSION_MISMATCH", classification: "security_critical", detail: "Pointer and publication vector-space versions differ" });
    try {
      const inspection = await this.inspector.inspect(publication.vectorSpaceVersionId);
      collectInspectionFindings(publication, inspection, findings);
    } catch (error) {
      findings.push({ code: "INSPECTION_FAILED", classification: "retryable", detail: error instanceof Error ? error.message : "Publication inspection failed" });
    }
    return freezeReport(publication.id, findings);
  }
}

function verifyInspection(versionId: string, count: number, manifests: PublicationManifests, inspection: PublicationInspection): Digest {
  const findings: string[] = [];
  if (inspection.vectorSpaceVersionId !== versionId) findings.push("vector-space version mismatch");
  if (inspection.itemCount !== count) findings.push(`item count ${inspection.itemCount}/${count}`);
  if (inspection.dimensions !== CANONICAL_EMBEDDING_DIMENSIONS) findings.push(`dimensions ${inspection.dimensions}/${CANONICAL_EMBEDDING_DIMENSIONS}`);
  if (inspection.precision !== "halfvec") findings.push(`precision ${inspection.precision}/halfvec`);
  for (const key of manifestKeys) if (inspection.manifests[key] !== manifests[key]) findings.push(`${key} manifest mismatch`);
  if (!inspection.indexReady) findings.push("index not ready");
  if (!inspection.authorizationPassed) findings.push("authorization verification failed");
  if (!inspection.evaluationPassed) findings.push("evaluation gate failed");
  if (!inspection.sampleSearchPassed) findings.push("sample search failed");
  if (findings.length > 0) throw new VectorBackendError("PUBLICATION_VERIFICATION_FAILED", findings.join("; "));
  return sha256Digest(JSON.stringify({ versionId, count, dimensions: inspection.dimensions, precision: inspection.precision, manifests, indexReady: true, authorizationPassed: true, evaluationPassed: true, sampleSearchPassed: true }));
}

function collectInspectionFindings(publication: ExploratoryPublication, inspection: PublicationInspection, findings: ReconciliationFinding[]): void {
  if (inspection.vectorSpaceVersionId !== publication.vectorSpaceVersionId) findings.push({ code: "VERSION_MISMATCH", classification: "security_critical", detail: "Inspected version does not match publication" });
  if (inspection.itemCount !== publication.expectedItemCount) findings.push({ code: "COUNT_MISMATCH", classification: "repairable", detail: `Expected ${publication.expectedItemCount}, observed ${inspection.itemCount}` });
  if (inspection.dimensions !== publication.dimensions || inspection.precision !== "halfvec") findings.push({ code: "VECTOR_FORMAT_MISMATCH", classification: "security_critical", detail: "Published vector format changed" });
  for (const key of manifestKeys) if (inspection.manifests[key] !== publication.manifests[key]) findings.push({ code: `${key.toUpperCase()}_MANIFEST_MISMATCH`, classification: "security_critical", detail: `${key} manifest does not match publication` });
  if (!inspection.indexReady) findings.push({ code: "INDEX_NOT_READY", classification: "repairable", detail: "Published index is unavailable" });
  if (!inspection.authorizationPassed) findings.push({ code: "AUTHORIZATION_CHECK_FAILED", classification: "security_critical", detail: "Authorization verification failed" });
  if (!inspection.evaluationPassed) findings.push({ code: "EVALUATION_REGRESSION", classification: "review_required", detail: "Evaluation gate no longer passes" });
  if (!inspection.sampleSearchPassed) findings.push({ code: "SAMPLE_SEARCH_FAILED", classification: "repairable", detail: "Immediate sample search failed" });
}

const manifestKeys = ["source", "representation", "chunkSet", "projection", "vectorItem", "embedding", "index", "retrievalPolicy", "evaluation"] as const;

function validatePublishRequest(request: PublishExploratoryRequest): void {
  if (request.storeClass !== "internal_exploratory") throw new VectorBackendError("AUTHORITY_CLASS_VIOLATION", "This coordinator only publishes internal exploratory stores");
  if (!Number.isInteger(request.expectedItemCount) || request.expectedItemCount < 0) throw new VectorBackendError("INVALID_ITEM_COUNT", "Expected item count must be a non-negative integer");
  if (request.reason.trim().length === 0) throw new VectorBackendError("INVALID_PUBLICATION", "Publication requires a reason");
}

function transactionView(publications: Map<string, ExploratoryPublication>, pointers: Map<string, ActivePublicationPointer>, events: PublicationEvent[]): PublicationTransaction {
  return {
    getPublication: (tenantId, publicationId) => publications.get(publicationKey(tenantId, publicationId)),
    getActivePointer: (tenantId, vectorStoreSpaceId) => pointers.get(pointerKey(tenantId, vectorStoreSpaceId)),
    insertPublication: (publication) => {
      const key = publicationKey(publication.tenantId, publication.id);
      if (publications.has(key)) throw new VectorBackendError("DUPLICATE_PUBLICATION", `Publication ${publication.id} already exists`);
      publications.set(key, publication);
    },
    setActivePointer: (pointer) => pointers.set(pointerKey(pointer.tenantId, pointer.vectorStoreSpaceId), pointer),
    appendEvent: (event) => {
      if (events.some((candidate) => candidate.tenantId === event.tenantId && candidate.id === event.id)) throw new VectorBackendError("DUPLICATE_EVENT", `Event ${event.id} already exists`);
      events.push(event);
    },
  };
}

function publicationKey(tenantId: string, publicationId: string): string { return `${tenantId}\u0000${publicationId}`; }
function pointerKey(tenantId: string, vectorStoreSpaceId: string): string { return `${tenantId}\u0000${vectorStoreSpaceId}`; }
function freezePublication(publication: ExploratoryPublication): ExploratoryPublication { return Object.freeze({ ...publication, manifests: Object.freeze({ ...publication.manifests }) }); }
function freezeReport(publicationId: string | undefined, findings: ReconciliationFinding[]): PublicationReconciliationReport {
  return Object.freeze({ healthy: findings.length === 0, ...(publicationId === undefined ? {} : { publicationId }), findings: Object.freeze(findings.map((finding) => Object.freeze(finding))) });
}
