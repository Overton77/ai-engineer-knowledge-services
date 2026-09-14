import { uuidv7, type ArtifactLedger } from "@aiengineer/knowledge-db-read";
import type { TenantPostgres, TenantSqlClient } from "@aiengineer/knowledge-persistence";
import { assertHeadMatches, domainError, infrastructureError, isKnowledgeError, KnowledgeError, type ExitClass, type Workspace } from "@aiengineer/knowledge-schema-workspace";
import { applyPlan, type ApplyOutcome } from "./apply.js";
import { awaitWinnerReceipt, isIdempotencyKeyCollision } from "./duplicate.js";
import { gatherFacts, type EvidenceOracle } from "./facts.js";
import { IngestionIntentSchema, type IngestionIntent } from "./intent.js";
import { buildPlan, intentDigestOf, intentIdempotencyKey, type IngestionPlan } from "./plan.js";
import type { AffectedRef, IngestionReceipt, ReceiptFailure } from "./receipt.js";
import { loadRules } from "./rules.js";
import { loadVocabulary, type Vocabulary } from "./vocabulary.js";
import { linkReportIngestion } from "./reports/ingestion-links.js";
import { reconcileReceipt } from "./receipt-reconciliation.js";
import { verifySnapshotPreflight } from "./snapshot-preflight.js";

export interface IngestionExecutorConfig {
  readonly db: TenantPostgres;
  readonly workspace: Workspace;
  readonly artifacts: ArtifactLedger;
  readonly executorVersion: string;
  /** Trusted host supplies an authenticated evidence oracle; fixtures must opt in explicitly. */
  readonly evidence?: (intent: IngestionIntent) => EvidenceOracle;
  readonly allowStale?: boolean;
}

export interface IngestionOptions { readonly expectedHead?: number }

const INTENT_TYPE = "knowledge_ingestion";
/** `operation_receipt` is readable only by executor_service; ledger lookups run read-only under it. */
const LEDGER_READER = "executor_service" as const;
const STANDALONE_POLICY = { mode: "standalone", policy: "executor-default.v1" };
const BATCH_OPEN_RETRIES = 3;
const BATCH_OPEN_WAIT_MS = 500;
const PLAN_STATEMENT_TIMEOUT_MS = 30_000;
const APPLY_STATEMENT_TIMEOUT_MS = 120_000;
const MAX_VERIFY_INTENT_ID_LENGTH = 64;
/** Apply failures the agent can act on (exit 1); everything else is infrastructure (exit 2). */
const DOMAIN_FAILURE_CODES: ReadonlySet<string> = new Set(["REBASE_REQUIRED", "VOCABULARY_VIOLATION", "CONSTRAINT_VIOLATION", "HELPER_REJECTED"]);

type Row = Record<string, unknown>;
const hex = (digest: string): string => digest.replace(/^sha256:/, "");
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const exitClassOf = (code: string): ExitClass => (DOMAIN_FAILURE_CODES.has(code) ? 1 : 2);

interface Planned { readonly intent: IngestionIntent; readonly plan: IngestionPlan; readonly vocabulary: Vocabulary }
interface LedgerEntry { readonly intent: IngestionIntent; readonly plan: IngestionPlan; readonly receiptArtifactId: string; readonly outcome: IngestionReceipt["outcome"]; readonly failure: ReceiptFailure | null }
interface LedgerIds { readonly operationIntentId: string; readonly receiptId: string }

export class IngestionExecutor {
  constructor(private readonly config: IngestionExecutorConfig) {
    if (!config.evidence) throw infrastructureError("EVIDENCE_ORACLE_REQUIRED", "An authenticated evidence oracle is required");
  }

  parse(raw: unknown, options: IngestionOptions = {}): IngestionIntent {
    const parsed = IngestionIntentSchema.safeParse(raw);
    if (!parsed.success) throw domainError("INTENT_SCHEMA_INVALID", "intent does not match knowledge-ingestion-intent.v1", { issues: parsed.error.issues });
    const intent = options.expectedHead === undefined ? parsed.data : { ...parsed.data, expectedKnowledgeHead: options.expectedHead };
    if (intent.contract.migrationHead && intent.contract.migrationHead !== this.config.workspace.migrationHead) throw infrastructureError("WORKSPACE_STALE", "intent.contract.migrationHead ≠ executor workspace head", { intent: intent.contract.migrationHead, workspace: this.config.workspace.migrationHead });
    if (intent.contract.workspaceFingerprint && this.config.workspace.fingerprint && intent.contract.workspaceFingerprint !== this.config.workspace.fingerprint) throw infrastructureError("WORKSPACE_STALE", "intent.contract.workspaceFingerprint ≠ executor workspace fingerprint");
    return intent;
  }

  /** Phases 1–7: parse, contract check, gather facts read-only as `pipeline_agent`, plan. No writes. */
  async plan(raw: unknown, options: IngestionOptions = {}): Promise<IngestionPlan> {
    const intent = this.parse(raw, options);
    return (await this.planWithContext(intent)).plan;
  }

  /** Phases 1–10: plan, then apply admitted proposals in one transaction as `executor_service`, then receipt. */
  async apply(raw: unknown, options: IngestionOptions = {}): Promise<IngestionReceipt> {
    const intent = this.parse(raw, options);
    const idempotencyKey = intentIdempotencyKey(intent, loadRules(this.config.workspace).rulesVersion);
    const duplicate = await this.findDuplicate(intent, idempotencyKey);
    if (duplicate) return duplicate;
    const planned = await this.planWithContext(intent);
    assertApplicable(planned.plan);
    return this.applyWithRetry(planned, idempotencyKey);
  }

  async receipt(receiptId: string, tenantId: string): Promise<IngestionReceipt> {
    return reconcileReceipt({ db: this.config.db, artifacts: this.config.artifacts }, { receiptId, tenantId });
  }

  private async planWithContext(intent: IngestionIntent): Promise<Planned> {
    await verifySnapshotPreflight(intent, this.config.artifacts, this.config.workspace);
    const databaseHead = await this.config.db.migrationHead().catch((error: unknown) => { throw infrastructureError("DB_UNAVAILABLE", error instanceof Error ? error.message : String(error)); });
    assertHeadMatches(this.config.workspace, databaseHead, this.config.allowStale ?? false);
    const rules = loadRules(this.config.workspace);
    const oracle = this.config.evidence!(intent);
    // Vocabularies are read as the executor's login identity: `taxonomy.entity_kind` carries a
    // deny-all RLS policy for every bounded role (db-contract follow-up). Everything else runs as pipeline_agent.
    return this.config.db.transaction({ tenantId: intent.context.tenantId, readOnly: true, isolationLevel: "repeatable read", statementTimeoutMs: PLAN_STATEMENT_TIMEOUT_MS }, async (client) => {
      const vocabulary = await loadVocabulary(client);
      await client.query("set local role pipeline_agent");
      const facts = await gatherFacts(client, intent, { vocabulary, rules, evidence: oracle });
      return { intent, plan: buildPlan(intent, facts, { version: this.config.executorVersion, migrationHead: this.config.workspace.migrationHead }), vocabulary };
    });
  }

  /** `BATCH_OPEN` is retried; an idempotency-key collision defers to the winner; anything else leaves a rejected receipt. */
  private async applyWithRetry(planned: Planned, idempotencyKey: string): Promise<IngestionReceipt> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.applyOnce(planned);
      } catch (error) {
        if (isIdempotencyKeyCollision(error)) return this.awaitWinner(planned.intent, idempotencyKey);
        // A transaction can commit successfully while its response is lost. Reconcile before recording rejection.
        const committed = await this.findDuplicate(planned.intent, idempotencyKey);
        if (committed) return committed;
        const failure = classifyFailure(error);
        if (failure.code === "BATCH_OPEN" && attempt < BATCH_OPEN_RETRIES) { await sleep(BATCH_OPEN_WAIT_MS); continue; }
        const receipt = await this.recordRejection(planned, failure);
        throw new KnowledgeError(failure.code, failure.message, exitClassOf(failure.code), { receipt, failure });
      }
    }
  }

  /** Same bytes ⇒ same key ⇒ the existing receipt, checked before planning so a created subject cannot shadow its own resubmission. */
  private async findDuplicate(intent: IngestionIntent, idempotencyKey: string): Promise<IngestionReceipt | undefined> {
    const tenantId = intent.context.tenantId;
    const existing = await this.config.db.transaction({ tenantId, role: LEDGER_READER, readOnly: true }, async (client) =>
      (await client.query<Row>("select r.id receipt_id from orchestration.operation_intent i join orchestration.operation_receipt r on r.intent_id=i.id where i.tenant_id=$1 and i.idempotency_key=$2", [tenantId, hex(idempotencyKey)])).rows[0]);
    if (!existing) return undefined;
    const receipt = await this.receipt(String(existing.receipt_id), tenantId);
    if (receipt.intentRef.intentDigest !== intentDigestOf(intent)) throw domainError("IDEMPOTENCY_CONFLICT", "The idempotency key already belongs to a different request digest");
    return { ...receipt, duplicateOf: String(existing.receipt_id) };
  }

  /** The loser of a parallel submission (23505 on the idempotency key) returns the winner's receipt instead of failing. */
  private awaitWinner(intent: IngestionIntent, idempotencyKey: string): Promise<IngestionReceipt> {
    const lookup = (): Promise<IngestionReceipt | undefined> => this.findDuplicate(intent, idempotencyKey).catch((error: unknown) => {
      if (isKnowledgeError(error) && error.code === "STORAGE_PENDING") return undefined;
      throw error;
    });
    return awaitWinnerReceipt(lookup, { intentId: intent.intentId, idempotencyKey });
  }

  private async priorReceipts(client: TenantSqlClient, intent: IngestionIntent, excludingKey: string): Promise<string[]> {
    return (await client.query<Row>("select r.id from orchestration.operation_intent i join orchestration.operation_receipt r on r.intent_id=i.id where i.tenant_id=$1 and i.intent_type=$2 and i.payload->>'intentId'=$3 and i.idempotency_key<>$4 order by r.applied_at", [intent.context.tenantId, INTENT_TYPE, intent.intentId, excludingKey])).rows.map((row) => String(row.id));
  }

  private async applyOnce({ intent, plan, vocabulary }: Planned): Promise<IngestionReceipt> {
    const tenantId = intent.context.tenantId;
    const executedAt = new Date().toISOString();
    const receiptArtifactId = uuidv7();
    const needsBatch = plan.plannedOutcome !== "noop";
    return this.config.db.transaction({ tenantId, role: "executor_service", statementTimeoutMs: APPLY_STATEMENT_TIMEOUT_MS }, async (client) => {
      const entry = { intent, plan, receiptArtifactId, outcome: plan.plannedOutcome, failure: null };
      const ids = await this.insertLedger(client, entry);
      await client.query("set constraints corpus.entity_created_by_receipt_id_fkey, staging.resolution_decision_receipt_id_fkey, evidence.claim_created_by_receipt_id_fkey, corpus.entity_receipt_tenant deferred");
      const knowledgeSeq = needsBatch ? Number(await scalar(client, "select temporal.begin_batch($1::bigint)", [plan.head.effectiveExpectedHead])) : null;
      const applied = needsBatch ? await applyPlan({ client, tenantId, receiptId: ids.receiptId, intent, plan, vocabulary, artifacts: this.config.artifacts }) : outcomeWithoutBatch(plan);
      await this.insertReceipt(client, entry, { ...ids, affectedRefs: applied.affectedRefs });
      const summary = { proposals: plan.plannedSummary, affected: applied.affectedRefs.length };
      const committed = needsBatch ? Number(await scalar(client, "select temporal.commit_batch($1,$2,$3,$4::jsonb)", [ids.receiptId, hex(plan.intentRef.idempotencyKey), hex(plan.intentRef.intentDigest), JSON.stringify(summary)])) : plan.head.current;
      if (knowledgeSeq !== null && committed !== knowledgeSeq) throw infrastructureError("EXECUTOR_INTERNAL", "commit_batch returned an unexpected knowledge_seq", { opened: knowledgeSeq, committed });
      const intentArtifact = await this.config.artifacts.putWith(client, { tenantId, artifactType: "ingestion_intent", value: intent, ...(intent.context.missionId ? { missionId: intent.context.missionId } : {}) });
      const planArtifact = await this.config.artifacts.putWith(client, { tenantId, artifactType: "knowledge_ingestion_plan", value: { ...plan, intentRef: { ...plan.intentRef, artifactId: intentArtifact.artifactId } } });
      const receipt: IngestionReceipt = {
        schemaVersion: "knowledge-ingestion-receipt.v1",
        receiptId: ids.receiptId, operationIntentId: ids.operationIntentId,
        intentRef: plan.intentRef, planRef: { planId: plan.planId, artifactId: planArtifact.artifactId },
        outcome: plan.plannedOutcome,
        knowledgeBatch: needsBatch ? { knowledgeSeq: committed, inputDigest: plan.intentRef.intentDigest } : null,
        head: { before: plan.head.current, after: committed, rebased: plan.head.rebased },
        proposals: applied.proposals, subjects: applied.subjects, claims: applied.claims, affectedRefs: applied.affectedRefs,
        duplicateOf: null, priorReceiptsForIntentId: await this.priorReceipts(client, intent, hex(plan.intentRef.idempotencyKey)),
        failure: null,
        storage: { intentArtifactId: intentArtifact.artifactId, planArtifactId: planArtifact.artifactId, receiptArtifactId, storageState: intentArtifact.storageState === "available" && planArtifact.storageState === "available" ? "stored" : "pending" },
        verify: suggestedVerification(intent, applied, plan.head.current, committed),
        executedAt, executorVersion: this.config.executorVersion,
      };
      await this.config.artifacts.putWith(client, { tenantId, artifactType: "knowledge_ingestion_receipt", artifactId: receiptArtifactId, value: receipt });
      await linkReportIngestion(client, { intent, receipt });
      const lineage = await this.linkLineage(client, { tenantId, receiptId: ids.receiptId, intentArtifactId: intentArtifact.artifactId, planArtifactId: planArtifact.artifactId, receiptArtifactId });
      return { ...receipt, storage: { ...receipt.storage, lineage } };
    });
  }

  /** Plan `derived_from` intent; receipt `produced_by` plan and `consumed_by` intent (spec §6.4). */
  private async linkLineage(client: TenantSqlClient, refs: { tenantId: string; receiptId: string; intentArtifactId: string; planArtifactId: string; receiptArtifactId: string }): Promise<"written" | "denied"> {
    const { tenantId, receiptId } = refs;
    const states = [
      await this.config.artifacts.link(client, { tenantId, from: refs.planArtifactId, to: refs.intentArtifactId, relation: "derived_from", receiptId }),
      await this.config.artifacts.link(client, { tenantId, from: refs.receiptArtifactId, to: refs.planArtifactId, relation: "produced_by", receiptId }),
      await this.config.artifacts.link(client, { tenantId, from: refs.receiptArtifactId, to: refs.intentArtifactId, relation: "consumed_by", receiptId }),
    ];
    return states.every((state) => state === "written") ? "written" : "denied";
  }

  /** A failed apply still leaves a durable `rejected` receipt (no batch is opened for it). */
  private async recordRejection({ intent, plan }: Planned, failure: ReceiptFailure): Promise<IngestionReceipt | undefined> {
    const tenantId = intent.context.tenantId;
    const receiptArtifactId = uuidv7();
    try {
      return await this.config.db.transaction({ tenantId, role: "executor_service" }, async (client) => {
        const entry: LedgerEntry = { intent, plan, receiptArtifactId, outcome: "rejected", failure };
        const ids = await this.insertLedger(client, entry);
        await this.insertReceipt(client, entry, { ...ids, affectedRefs: [] });
        const current = Number((await client.query<Row>("select knowledge_seq from api.knowledge_head()")).rows[0]?.knowledge_seq ?? plan.head.current);
        const receipt: IngestionReceipt = {
          schemaVersion: "knowledge-ingestion-receipt.v1", receiptId: ids.receiptId, operationIntentId: ids.operationIntentId,
          intentRef: plan.intentRef, planRef: { planId: plan.planId }, outcome: "rejected", knowledgeBatch: null,
          head: { before: plan.head.current, after: current, rebased: false },
          proposals: plan.proposals.map((proposal) => ({ proposalId: proposal.proposalId, outcome: "rejected" as const, reason: failure.code })),
          subjects: plan.subjects.map((subject) => ({ ref: subject.ref, entityId: subject.resolution === "create" ? null : subject.entityId, created: false })),
          claims: [], affectedRefs: [], duplicateOf: null, priorReceiptsForIntentId: [], failure,
          storage: { receiptArtifactId, storageState: "pending" }, verify: null, executedAt: new Date().toISOString(), executorVersion: this.config.executorVersion,
        };
        await this.config.artifacts.putWith(client, { tenantId, artifactType: "knowledge_ingestion_receipt", artifactId: receiptArtifactId, value: receipt });
        return receipt;
      });
    } catch {
      return undefined;
    }
  }

  private async insertLedger(client: TenantSqlClient, entry: LedgerEntry): Promise<LedgerIds> {
    const { intent, plan } = entry;
    const { proposals: _proposals, subjects: _subjects, notes: _notes, ...envelope } = intent;
    const operationIntentId = uuidv7();
    await client.query(
      `insert into orchestration.operation_intent(id,intent_type,schema_version,payload,preconditions,idempotency_key,proposed_by_attempt,mission_id,approval_state,policy_decision,tenant_id)
       values($1,$2,1,$3::jsonb,$4::jsonb,$5,$6,$7,'approved',$8::jsonb,$9)`,
      [operationIntentId, INTENT_TYPE, JSON.stringify({ ...envelope, proposalCount: intent.proposals.length, subjectCount: intent.subjects.length }), JSON.stringify({ expectedKnowledgeHead: plan.head.effectiveExpectedHead, snapshotDigest: intent.inputSnapshot?.snapshotDigest ?? null, rebased: plan.head.rebased }), hex(plan.intentRef.idempotencyKey), intent.context.attemptId ?? null, intent.context.missionId ?? null, JSON.stringify(STANDALONE_POLICY), intent.context.tenantId],
    );
    return { operationIntentId, receiptId: uuidv7() };
  }

  private async insertReceipt(client: TenantSqlClient, entry: LedgerEntry, ids: LedgerIds & { affectedRefs: readonly AffectedRef[] }): Promise<void> {
    const { plan, intent } = entry;
    await client.query(
      `insert into orchestration.operation_receipt(id,intent_id,executor_version,precondition_results,outcome,changes_summary,affected_refs) values($1,$2,$3,$4::jsonb,$5,$6::jsonb,$7::jsonb)`,
      [ids.receiptId, ids.operationIntentId, this.config.executorVersion, JSON.stringify({ expectedKnowledgeHead: plan.head.effectiveExpectedHead, observedHead: plan.head.current, snapshotDigest: intent.inputSnapshot?.snapshotDigest ?? null, rebased: plan.head.rebased }), entry.outcome, JSON.stringify({ planId: plan.planId, receiptArtifactId: entry.receiptArtifactId, intentDigest: plan.intentRef.intentDigest, planned: plan.plannedSummary, ...(entry.failure ? { failure: entry.failure } : {}) }), JSON.stringify(ids.affectedRefs)],
    );
  }
}

/** Submit refuses a plan with errors, and one where nothing would be written or staged. */
function assertApplicable(plan: IngestionPlan): void {
  const first = plan.errors[0];
  if (first) throw new KnowledgeError(first.code, first.message, 1, { errors: plan.errors, plan });
  if (plan.proposals.every((proposal) => proposal.outcome === "held")) throw domainError("REVIEW_REQUIRED_ONLY", "every proposal is held or requires review; nothing to apply", { plan });
}

/** A `noop` plan opens no batch: the receipt echoes the planned outcomes and known ids. */
function outcomeWithoutBatch(plan: IngestionPlan): ApplyOutcome {
  return {
    proposals: plan.proposals.map((proposal) => ({ proposalId: proposal.proposalId, outcome: proposal.outcome, ...(proposal.existing ? { existing: proposal.existing } : {}) })),
    affectedRefs: [],
    subjects: plan.subjects.map((subject) => ({ ref: subject.ref, entityId: subject.entityId, created: false })),
    claims: plan.evidence.claims.map((claim) => ({ runId: claim.runId, claimId: claim.claimId, claimRowId: claim.claimRowId })),
  };
}

async function scalar(client: TenantSqlClient, sql: string, params: readonly unknown[]): Promise<string> {
  const row = (await client.query<Row>(sql, params)).rows[0];
  if (!row) throw infrastructureError("EXECUTOR_INTERNAL", `no row from ${sql}`);
  return String(Object.values(row)[0]);
}

function suggestedVerification(intent: IngestionIntent, applied: ApplyOutcome, before: number, after: number): IngestionReceipt["verify"] {
  const entityIds = applied.subjects.map((subject) => subject.entityId).filter((id): id is string => Boolean(id));
  if (entityIds.length === 0 || before === after) return null;
  return { suggestedReadIntent: { schemaVersion: "knowledge-read-intent.v1", intentId: `verify-${intent.intentId}`.slice(0, MAX_VERIFY_INTENT_ID_LENGTH), context: { tenantId: intent.context.tenantId }, operations: entityIds.map((entityId, index) => ({ opId: `changed-${index}`, kind: "named_query", query: "entity.what_changed", params: { entity_id: entityId, k_from: before, k_to: after } })) } };
}

/** Maps helper and constraint failures onto the contract's error codes. */
export function classifyFailure(error: unknown): ReceiptFailure {
  if (isKnowledgeError(error)) return { code: error.code, message: error.message, ...(error.details === undefined ? {} : { details: error.details }) };
  const pg = error as { code?: string; message?: string; detail?: string };
  const message = pg.message ?? String(error);
  if (pg.code === "40001" || /rebase_required/.test(message)) return { code: "REBASE_REQUIRED", message: "knowledge head advanced since the snapshot; re-snapshot and resubmit", sqlstate: "40001" };
  if (/knowledge batch already open/.test(message)) return { code: "BATCH_OPEN", message, sqlstate: pg.code ?? "P0001" };
  if (pg.code === "23514") return { code: "VOCABULARY_VIOLATION", message, sqlstate: pg.code, ...(pg.detail ? { details: pg.detail } : {}) };
  if (pg.code?.startsWith("23")) return { code: "CONSTRAINT_VIOLATION", message, sqlstate: pg.code, ...(pg.detail ? { details: pg.detail } : {}) };
  if (pg.code === "P0001" || pg.code === "P0002") return { code: "HELPER_REJECTED", message, sqlstate: pg.code };
  if (pg.code === "42501") return { code: "ROLE_DENIED", message, sqlstate: pg.code };
  if (pg.code?.startsWith("08") || pg.code === "57P01" || pg.code === "ECONNREFUSED") return { code: "DB_UNAVAILABLE", message, ...(pg.code ? { sqlstate: pg.code } : {}) };
  return { code: "EXECUTOR_INTERNAL", message, ...(pg.code ? { sqlstate: pg.code } : {}) };
}
