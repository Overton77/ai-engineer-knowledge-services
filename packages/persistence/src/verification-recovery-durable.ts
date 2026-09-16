import { randomUUID } from "node:crypto";
import { assertDurableProbeAccounting } from "./verification-recovery-durable-accounting.js";
import {
  DurableRecoveryCaseSchema, DurableRecoveryClaimSchema, DurableRecoveryExecutionSchema,
  VerificationRecoveryBatchSchema, VerificationRecoveryPlanSchema, VerificationRecoveryReceiptSchema,
  type DurableRecoveryCase, type DurableRecoveryExecution, type DurableRecoveryUsage, type VerificationRecoveryPlan,
} from "@aiengineer/knowledge-contracts";
import type { DurableRecoveryStore, RecoveryRevisionInput } from "@aiengineer/knowledge-application";
import { canonicalizeJson } from "@aiengineer/knowledge-verification";
import type { PostgresCanonicalRepository, TenantSqlClient } from "./postgres.js";

type Row = Record<string, unknown>;
const zero = (): DurableRecoveryUsage => ({ calls: 0, costMicros: 0 });
function same(a: unknown, b: unknown, error: string): void { if (canonicalizeJson(a) !== canonicalizeJson(b)) throw new Error(error); }
function execution(row: Row): DurableRecoveryExecution {
  return DurableRecoveryExecutionSchema.parse({ executionId: row.execution_id, tenantId: row.tenant_id, caseId: row.case_id,
    originalId: row.original_id, planDigest: row.plan_digest, repairDigest: row.repair_digest, inputDigest: row.input_digest,
    plannedOperationId: row.planned_operation_id, ...(row.operation_id ? { operationId: row.operation_id, requestDigest: row.request_digest } : {}),
    reservation: { calls: Number(row.reservation_calls), costMicros: Number(row.reservation_cost_micros) },
    ...(row.usage_calls !== null ? { usage: { calls: Number(row.usage_calls), costMicros: Number(row.usage_cost_micros) } } : {}),
    state: row.state, authorizationToken: row.authorization_token, claimToken: row.claim_token, claimFence: Number(row.claim_fence) });
}

export class PostgresDurableVerificationRecoveryStore implements DurableRecoveryStore {
  constructor(private readonly database: PostgresCanonicalRepository,
    private readonly originalSource: "knowledge_service" | "orchestration" = "knowledge_service") {}

  async open(input: Parameters<DurableRecoveryStore["open"]>[0]): Promise<DurableRecoveryCase> {
    return this.database.transaction(input.tenantId, async client => {
      await client.query("insert into knowledge_service.recovery_case(tenant_id,case_id,initial_batch,authority_handle,authority_digest) values($1,$2,$3::jsonb,$4::jsonb,$5) on conflict do nothing",
        [input.tenantId, input.batch.caseId, JSON.stringify(input.batch), JSON.stringify(input.authorityArtifact), input.authorityArtifact.digest]);
      const row = await this.lock(client, input.tenantId, input.batch.caseId);
      same(row.initial_batch, input.batch, "RECOVERY_ORIGINAL_DENOMINATOR_IMMUTABLE");
      same(row.authority_handle, input.authorityArtifact, "RECOVERY_INITIAL_AUTHORITY_IMMUTABLE");
      for (const item of [...input.batch.items].sort((a, b) => a.originalId.localeCompare(b.originalId))) {
        await client.query(`insert into knowledge_service.recovery_original(tenant_id,case_id,original_id,original_operation_id,original_intent_id,original_input_digest,used_rounds,attempted_input_digests,attempted_repair_digests)
          values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb) on conflict(tenant_id,case_id,original_id) do nothing`,
        [input.tenantId, input.batch.caseId, item.originalId,
          this.originalSource === "knowledge_service" ? item.observation.operationId : null,
          this.originalSource === "orchestration" ? item.observation.operationId : null,
          item.inputDigest, item.usedRounds, JSON.stringify(item.attemptedInputDigests), JSON.stringify(item.attemptedRepairDigests)]);
      }
      const existing = (await client.query("select revision from knowledge_service.recovery_revision where tenant_id=$1 and case_id=$2 limit 1", [input.tenantId, input.batch.caseId])).rows;
      if (!existing.length) await this.insertRevision(client, input.tenantId, input.batch.caseId, 1,
        { kind: "batch", idempotencyKey: input.batch.caseId, artifact: input.batchArtifact, value: input.batch });
      // The application records the notification revision before acknowledging open.
      return this.readInTransaction(client, input.tenantId, input.batch.caseId);
    });
  }

  async read(tenantId: string, caseId: string): Promise<DurableRecoveryCase> {
    return this.database.transaction(tenantId, async client => {
      await client.query("select case_id from knowledge_service.recovery_case where tenant_id=$1 and case_id=$2 for share", [tenantId, caseId]);
      return this.readInTransaction(client, tenantId, caseId);
    });
  }

  async append(input: Parameters<DurableRecoveryStore["append"]>[0]): Promise<DurableRecoveryCase> {
    return this.database.transaction(input.tenantId, async client => {
      const row = await this.lock(client, input.tenantId, input.caseId);
      const duplicate = await this.existingEntries(client, input.tenantId, input.caseId, input.entries);
      if (duplicate) return this.readInTransaction(client, input.tenantId, input.caseId);
      if (Number(row.revision) !== input.expectedRevision) throw new Error("RECOVERY_REVISION_CONFLICT");
      if (input.activePlanDigest && (row.active_plan_digest || row.state !== "ready")) throw new Error("RECOVERY_PLAN_ALREADY_ACTIVE");
      const snapshot = await this.readInTransaction(client, input.tenantId, input.caseId);
      for (const entry of input.entries.filter(entry => entry.kind === "plan")) {
        const plan = VerificationRecoveryPlanSchema.parse(entry.value);
        const previousPlans = snapshot.revisions.filter(revision => revision.kind === "plan").map(revision => VerificationRecoveryPlanSchema.parse(revision.value));
        assertDurableProbeAccounting(plan, previousPlans, snapshot.executions);
        if (plan.reservation.calls > snapshot.batch.limits.remainingCalls || plan.reservation.costMicros > snapshot.batch.limits.remainingCostMicros) throw new Error("RECOVERY_BUDGET_EXCEEDED");
        same(plan.actions.map(action => action.originalId).sort(), snapshot.batch.items.map(item => item.originalId).sort(), "RECOVERY_ALL_ORIGINALS_REQUIRED");
      }
      await this.appendEntries(client, input.tenantId, input.caseId, input.expectedRevision, input.entries);
      await client.query(`update knowledge_service.recovery_case set state=coalesce($3,state),
        active_plan_digest=case when $4 then $5 else active_plan_digest end,authority_digest=coalesce($6,authority_digest) where tenant_id=$1 and case_id=$2`,
      [input.tenantId, input.caseId, input.state ?? null, input.activePlanDigest !== undefined, input.activePlanDigest ?? null, input.authorityDigest ?? null]);
      if (input.releaseClaims) await this.release(client, input.tenantId, input.caseId);
      return this.readInTransaction(client, input.tenantId, input.caseId);
    });
  }

  async claim(input: Parameters<DurableRecoveryStore["claim"]>[0]) {
    if (!input.holderIdentity.trim() || input.leaseMs < 1 || input.leaseMs > 3600000) throw new Error("RECOVERY_INVALID_LEASE");
    return this.database.transaction(input.tenantId, async client => {
      const current = await this.lock(client, input.tenantId, input.caseId);
      if (current.state !== "active" || current.active_plan_digest !== input.planDigest) throw new Error("RECOVERY_PLAN_NOT_ACTIVE");
      const keys = [...new Set(input.keys)].sort();
      if (!keys.length || keys.length > 10000) throw new Error("RECOVERY_CLAIM_KEYS_INVALID");
      const token = randomUUID();
      const fence = Number((await client.query("select nextval('knowledge_service.recovery_claim_fence') n")).rows[0]!.n);
      let expiresAt = "";
      for (const key of keys) {
        await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`${input.tenantId}:recovery:${key}`]);
        await client.query("select dependency_key from knowledge_service.recovery_dependency_claim where tenant_id=$1 and dependency_key=$2 for update", [input.tenantId, key]);
        const unfinished = (await client.query(`select 1 from knowledge_service.recovery_dependency_claim prior
          join knowledge_service.recovery_execution execution on execution.tenant_id=prior.tenant_id and execution.case_id=prior.case_id
          where prior.tenant_id=$1 and prior.dependency_key=$2 and prior.case_id<>$3 and execution.state<>'settled' limit 1`, [input.tenantId, key, input.caseId])).rows[0];
        if (unfinished) throw new Error("RECOVERY_PREVIOUS_OWNER_RECONCILIATION_REQUIRED");
        const active = (await client.query("select 1 from knowledge_service.recovery_dependency_claim where tenant_id=$1 and dependency_key=$2 and released_at is null and expires_at>clock_timestamp()", [input.tenantId, key])).rows[0];
        if (active) throw new Error("RECOVERY_DEPENDENCY_BUSY");
        const result = (await client.query(`insert into knowledge_service.recovery_dependency_claim(tenant_id,dependency_key,case_id,plan_digest,holder_identity,claim_token,fencing_token,expires_at)
          values($1,$2,$3,$4,$5,$6,$7,clock_timestamp()+($8::text||' milliseconds')::interval)
          on conflict(tenant_id,dependency_key) do update set case_id=excluded.case_id,plan_digest=excluded.plan_digest,holder_identity=excluded.holder_identity,
          claim_token=excluded.claim_token,fencing_token=excluded.fencing_token,expires_at=excluded.expires_at,released_at=null returning expires_at`,
        [input.tenantId, key, input.caseId, input.planDigest, input.holderIdentity, token, fence, input.leaseMs])).rows[0]!;
        expiresAt = (result.expires_at as Date).toISOString();
      }
      return DurableRecoveryClaimSchema.parse({ tenantId: input.tenantId, caseId: input.caseId, planDigest: input.planDigest, holderIdentity: input.holderIdentity, keys, token, fencingToken: fence, expiresAt });
    });
  }

  async reserve(input: Parameters<DurableRecoveryStore["reserve"]>[0]): Promise<DurableRecoveryExecution> {
    const { claim, execution: proposed } = input;
    return this.database.transaction(claim.tenantId, async client => {
      const row = await this.lock(client, claim.tenantId, claim.caseId);
      const prior = (await client.query("select * from knowledge_service.recovery_execution where tenant_id=$1 and execution_id=$2", [claim.tenantId, proposed.executionId])).rows[0];
      if (prior) {
        const retained = execution(prior);
        for (const key of ["caseId", "originalId", "planDigest", "repairDigest", "inputDigest", "plannedOperationId", "reservation", "authorizationToken"] as const) same(retained[key], proposed[key], "RECOVERY_EXECUTION_CONFLICT");
        return retained;
      }
      if (row.state !== "active" || row.active_plan_digest !== claim.planDigest) throw new Error("RECOVERY_PLAN_NOT_ACTIVE");
      await this.assertClaim(client, claim);
      const snapshot = await this.readInTransaction(client, claim.tenantId, claim.caseId);
      const plan = snapshot.latestPlan!;
      if (snapshot.executions.some(execution => execution.state !== "settled" && execution.claimToken !== claim.token)) throw new Error("RECOVERY_PREVIOUS_OWNER_RECONCILIATION_REQUIRED");
      const original = snapshot.batch.items.find(item => item.originalId === proposed.originalId);
      if (!original || original.usedRounds >= snapshot.batch.limits.maxRoundsPerOriginal || Date.parse(snapshot.batch.limits.deadline) <= Date.now()) throw new Error("RECOVERY_LIMIT_EXHAUSTED");
      const reserved = snapshot.executions.filter(item => item.planDigest === proposed.planDigest).reduce((total, item) => ({ calls: total.calls + item.reservation.calls, costMicros: total.costMicros + item.reservation.costMicros }), zero());
      const probes = [...new Map(plan.probeExecutions.filter(item => !item.previouslyAccounted).map(item => [item.operationId, item])).values()].reduce((total, item) => ({ calls: total.calls + item.calls, costMicros: total.costMicros + item.costMicros }), zero());
      if (reserved.calls + probes.calls + proposed.reservation.calls > plan.reservation.calls || reserved.costMicros + probes.costMicros + proposed.reservation.costMicros > plan.reservation.costMicros) throw new Error("RECOVERY_RESERVATION_EXCEEDED");
      if (original.attemptedInputDigests.includes(proposed.inputDigest) || original.attemptedRepairDigests.includes(proposed.repairDigest)) throw new Error("RECOVERY_REPEATED_INPUT");
      await client.query(`insert into knowledge_service.recovery_execution(tenant_id,execution_id,case_id,original_id,plan_digest,repair_digest,input_digest,planned_operation_id,
        reservation_calls,reservation_cost_micros,state,authorization_token,claim_token,claim_fence) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'authorized',$11,$12,$13)`,
      [claim.tenantId, proposed.executionId, claim.caseId, proposed.originalId, proposed.planDigest, proposed.repairDigest, proposed.inputDigest, proposed.plannedOperationId,
        proposed.reservation.calls, proposed.reservation.costMicros, proposed.authorizationToken, claim.token, claim.fencingToken]);
      await client.query(`update knowledge_service.recovery_original set used_rounds=used_rounds+1,
        attempted_input_digests=attempted_input_digests||to_jsonb($4::text),attempted_repair_digests=attempted_repair_digests||to_jsonb($5::text)
        where tenant_id=$1 and case_id=$2 and original_id=$3`, [claim.tenantId, claim.caseId, proposed.originalId, proposed.inputDigest, proposed.repairDigest]);
      await client.query("update knowledge_service.recovery_case set revision=revision+1 where tenant_id=$1 and case_id=$2", [claim.tenantId, claim.caseId]);
      return proposed;
    });
  }

  async link(input: Parameters<DurableRecoveryStore["link"]>[0]): Promise<DurableRecoveryExecution> {
    return this.database.transaction(input.tenantId, async client => {
      const identity = (await client.query("select case_id from knowledge_service.recovery_execution where tenant_id=$1 and execution_id=$2", [input.tenantId, input.executionId])).rows[0];
      if (!identity) throw new Error("RECOVERY_EXECUTION_NOT_FOUND");
      await this.lock(client, input.tenantId, String(identity.case_id));
      const row = (await client.query("select * from knowledge_service.recovery_execution where tenant_id=$1 and execution_id=$2 for update", [input.tenantId, input.executionId])).rows[0];
      if (!row || row.planned_operation_id !== input.operationId) throw new Error("RECOVERY_OPERATION_BINDING");
      if (row.operation_id) {
        if (row.operation_id !== input.operationId || row.request_digest !== input.requestDigest) throw new Error("RECOVERY_OPERATION_BINDING");
        return execution(row);
      }
      const operation = (await client.query("select request_sha256 from knowledge_service.operation where tenant_id=$1 and id=$2", [input.tenantId, input.operationId])).rows[0];
      if (!operation || `sha256:${operation.request_sha256}` !== input.requestDigest) throw new Error("RECOVERY_OPERATION_REQUEST_MISMATCH");
      await client.query("update knowledge_service.recovery_case set revision=revision+1 where tenant_id=$1 and case_id=$2", [input.tenantId, String(identity.case_id)]);
      return execution((await client.query("update knowledge_service.recovery_execution set operation_id=$3,request_digest=$4,state='linked' where tenant_id=$1 and execution_id=$2 returning *", [input.tenantId, input.executionId, input.operationId, input.requestDigest])).rows[0]!);
    });
  }

  async settle(input: Parameters<DurableRecoveryStore["settle"]>[0]): Promise<DurableRecoveryCase> {
    return this.database.transaction(input.tenantId, async client => {
      const row = await this.lock(client, input.tenantId, input.caseId);
      if (await this.existingEntries(client, input.tenantId, input.caseId, input.entries)) return this.readInTransaction(client, input.tenantId, input.caseId);
      if (Number(row.revision) !== input.expectedRevision) throw new Error("RECOVERY_REVISION_CONFLICT");
      if (row.active_plan_digest && row.active_plan_digest !== input.planDigest) throw new Error("RECOVERY_ACTIVE_PLAN_CONFLICT");
      const snapshot = await this.readInTransaction(client, input.tenantId, input.caseId);
      const receipt = VerificationRecoveryReceiptSchema.parse(input.receipt);
      same(receipt.questionIds, snapshot.batch.questionIds, "RECOVERY_DENOMINATOR_MISMATCH");
      same(receipt.results.map(item => item.originalId).sort(), snapshot.batch.items.map(item => item.originalId).sort(), "RECOVERY_ALL_ORIGINALS_REQUIRED");
      if (snapshot.latestPlan?.payloadDigest !== input.planDigest) throw new Error("RECOVERY_SUPERSEDED_PLAN");
      const pending = receipt.results.some(item => item.outcome === "reconciliation_unresolved");
      const requiresCheckpoint = receipt.results.some(item => ["review_required", "operator_required", "exhausted"].includes(item.outcome));
      // P1.4 usage is an immutable, independently reconciled total. The projection charges
      // the latest total for this plan, rather than charging duplicate receipt deliveries.
      const priorReceipts = snapshot.revisions.filter(item => item.kind === "receipt").map(item => VerificationRecoveryReceiptSchema.parse(item.value)).filter(item => item.planDigest === input.planDigest);
      const prior = priorReceipts.at(-1);
      if (prior && (receipt.usage.calls < prior.usage.calls || receipt.usage.costMicros < prior.usage.costMicros)) throw new Error("RECOVERY_USAGE_CANNOT_RESET");
      for (const settlement of input.settlements) {
        const retained = snapshot.executions.find(item => item.executionId === settlement.executionId && item.planDigest === input.planDigest);
        if (!retained?.operationId) throw new Error("RECOVERY_SETTLEMENT_OPERATION_REQUIRED");
        if (retained.usage) same(retained.usage, settlement.usage, "RECOVERY_USAGE_CONFLICT");
        else await client.query("update knowledge_service.recovery_execution set state='settled',usage_calls=$3,usage_cost_micros=$4 where tenant_id=$1 and execution_id=$2", [input.tenantId, settlement.executionId, settlement.usage.calls, settlement.usage.costMicros]);
      }
      await this.appendEntries(client, input.tenantId, input.caseId, input.expectedRevision, input.entries);
      if (!pending) {
        await client.query("update knowledge_service.recovery_case set active_plan_digest=null,state=case when state='waiting' then 'waiting' else $3 end where tenant_id=$1 and case_id=$2", [input.tenantId, input.caseId, requiresCheckpoint ? "active" : "ready"]);
        if (!requiresCheckpoint) await this.release(client, input.tenantId, input.caseId);
      }
      return this.readInTransaction(client, input.tenantId, input.caseId);
    });
  }

  private async lock(client: TenantSqlClient, tenantId: string, caseId: string): Promise<Row> {
    const row = (await client.query("select * from knowledge_service.recovery_case where tenant_id=$1 and case_id=$2 for update", [tenantId, caseId])).rows[0];
    if (!row) throw new Error("RECOVERY_CASE_NOT_FOUND");
    return row;
  }
  private async assertClaim(client: TenantSqlClient, claim: Parameters<DurableRecoveryStore["reserve"]>[0]["claim"]): Promise<void> {
    const rows = (await client.query(`select dependency_key from knowledge_service.recovery_dependency_claim where tenant_id=$1 and case_id=$2 and plan_digest=$3
      and claim_token=$4 and fencing_token=$5 and holder_identity=$6 and released_at is null and expires_at>clock_timestamp() for update`,
    [claim.tenantId, claim.caseId, claim.planDigest, claim.token, claim.fencingToken, claim.holderIdentity])).rows;
    same(rows.map(row => String(row.dependency_key)).sort(), [...claim.keys].sort(), "RECOVERY_STALE_CLAIM");
  }
  private async release(client: TenantSqlClient, tenantId: string, caseId: string): Promise<void> {
    await client.query("update knowledge_service.recovery_dependency_claim set released_at=clock_timestamp() where tenant_id=$1 and case_id=$2 and released_at is null", [tenantId, caseId]);
  }
  private async existingEntries(client: TenantSqlClient, tenantId: string, caseId: string, entries: readonly RecoveryRevisionInput[]): Promise<boolean> {
    let found = 0;
    for (const entry of entries) {
      const row = (await client.query("select payload,artifact_handle from knowledge_service.recovery_revision where tenant_id=$1 and case_id=$2 and kind=$3 and idempotency_key=$4", [tenantId, caseId, entry.kind, entry.idempotencyKey])).rows[0];
      if (row) { same(row.payload, entry.value, "RECOVERY_REVISION_IDEMPOTENCY_CONFLICT"); same(row.artifact_handle, entry.artifact, "RECOVERY_REVISION_ARTIFACT_CONFLICT"); found++; }
    }
    return entries.length > 0 && found === entries.length;
  }
  private async appendEntries(client: TenantSqlClient, tenantId: string, caseId: string, revision: number, entries: readonly RecoveryRevisionInput[]): Promise<void> {
    for (const entry of entries) {
      if (!(await this.existingEntries(client, tenantId, caseId, [entry]))) await this.insertRevision(client, tenantId, caseId, ++revision, entry);
    }
    await client.query("update knowledge_service.recovery_case set revision=$3 where tenant_id=$1 and case_id=$2", [tenantId, caseId, revision]);
  }
  private async insertRevision(client: TenantSqlClient, tenantId: string, caseId: string, revision: number, entry: RecoveryRevisionInput): Promise<void> {
    if (entry.kind === "notification") {
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`${tenantId}:recovery-notification:${entry.idempotencyKey}`]);
      const other = (await client.query("select case_id from knowledge_service.recovery_revision where tenant_id=$1 and kind='notification' and idempotency_key=$2 and case_id<>$3 limit 1", [tenantId, entry.idempotencyKey, caseId])).rows[0];
      if (other) throw new Error("RECOVERY_NOTIFICATION_CASE_CONFLICT");
    }
    const artifact = (await client.query("select sha256,storage_state from orchestration.artifact where tenant_id=$1 and id=$2 for share", [tenantId, entry.artifact.artifactId])).rows[0];
    if (!artifact || artifact.storage_state !== "available" || `sha256:${artifact.sha256}` !== entry.artifact.digest) throw new Error("RECOVERY_ARTIFACT_UNAVAILABLE");
    const closure = (await client.query<{ artifact_id: string }>(`with recursive closure(artifact_id) as (
      select $2::uuid union select dependency.artifact_id from closure c
      join orchestration.verification_artifact_metadata m on m.tenant_id=$1 and m.artifact_id=c.artifact_id
      cross join lateral unnest(m.parent_artifact_ids||case when m.attestation_artifact_id is null then '{}'::uuid[] else array[m.attestation_artifact_id] end) dependency(artifact_id)
    ) select artifact_id from closure limit 10001`, [tenantId, entry.artifact.artifactId])).rows;
    if (closure.length > 10000) throw new Error("RECOVERY_ARTIFACT_CLOSURE_LIMIT");
    const ids = closure.map(item => item.artifact_id).sort();
    const retained = (await client.query("select id,storage_state,size_bytes from orchestration.artifact where tenant_id=$1 and id=any($2::uuid[]) order by id for share", [tenantId, ids])).rows;
    if (retained.length !== ids.length || retained.some(item => item.storage_state !== "available")) throw new Error("RECOVERY_ARTIFACT_CLOSURE_UNAVAILABLE");
    if (retained.reduce((total, item) => total + Number(item.size_bytes), 0) > 268435456) throw new Error("RECOVERY_ARTIFACT_CLOSURE_BYTES_LIMIT");
    await client.query(`insert into knowledge_service.recovery_revision(tenant_id,case_id,revision,kind,idempotency_key,artifact_id,artifact_handle,payload,checkpoint_id)
      values($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9)`, [tenantId, caseId, revision, entry.kind, entry.idempotencyKey, entry.artifact.artifactId, JSON.stringify(entry.artifact), JSON.stringify(entry.value), entry.checkpointId ?? null]);
    for (const artifactId of ids) await client.query("insert into knowledge_service.recovery_artifact_reference(tenant_id,case_id,artifact_id) values($1,$2,$3) on conflict do nothing", [tenantId, caseId, artifactId]);
  }
  private async readInTransaction(client: TenantSqlClient, tenantId: string, caseId: string): Promise<DurableRecoveryCase> {
    const row = (await client.query("select * from knowledge_service.recovery_case where tenant_id=$1 and case_id=$2", [tenantId, caseId])).rows[0];
    if (!row) throw new Error("RECOVERY_CASE_NOT_FOUND");
    const initialBatch = VerificationRecoveryBatchSchema.parse(row.initial_batch);
    const batch = structuredClone(initialBatch);
    const originals = (await client.query("select * from knowledge_service.recovery_original where tenant_id=$1 and case_id=$2", [tenantId, caseId])).rows;
    batch.items = batch.items.map(item => {
      const stored = originals.find(original => original.original_id === item.originalId);
      if (!stored) throw new Error("RECOVERY_ORIGINAL_MISSING");
      const expectedOperation = this.originalSource === "knowledge_service" ? item.observation.operationId : null;
      const expectedIntent = this.originalSource === "orchestration" ? item.observation.operationId : null;
      if (stored.original_operation_id !== expectedOperation || stored.original_intent_id !== expectedIntent
        || stored.original_input_digest !== item.inputDigest) throw new Error("RECOVERY_ORIGINAL_AUTHORITY_MISMATCH");
      return { ...item, usedRounds: Number(stored.used_rounds), attemptedInputDigests: stored.attempted_input_digests as string[], attemptedRepairDigests: stored.attempted_repair_digests as string[] };
    });
    const revisions = (await client.query("select * from knowledge_service.recovery_revision where tenant_id=$1 and case_id=$2 order by revision", [tenantId, caseId])).rows.map(entry => ({ revision: Number(entry.revision), kind: entry.kind, idempotencyKey: entry.idempotency_key, artifact: entry.artifact_handle, value: entry.payload, ...(entry.checkpoint_id ? { checkpointId: entry.checkpoint_id } : {}) }));
    const executions = (await client.query("select * from knowledge_service.recovery_execution where tenant_id=$1 and case_id=$2 order by execution_id", [tenantId, caseId])).rows.map(execution);
    const receipts = revisions.filter(item => item.kind === "receipt").map(item => VerificationRecoveryReceiptSchema.parse(item.value));
    const plans = revisions.filter(item => item.kind === "plan").map(item => VerificationRecoveryPlanSchema.parse(item.value));
    const latestReceipts = new Map(receipts.map(receipt => [receipt.planDigest, receipt]));
    const spent = [...latestReceipts.values()].reduce((total, receipt) => ({ calls: total.calls + receipt.usage.calls, costMicros: total.costMicros + receipt.usage.costMicros }), zero());
    const active = plans.find(plan => plan.payloadDigest === row.active_plan_digest);
    const activeUsage = active ? latestReceipts.get(active.payloadDigest)?.usage ?? zero() : zero();
    const reserved = active ? { calls: active.reservation.calls - activeUsage.calls, costMicros: active.reservation.costMicros - activeUsage.costMicros } : zero();
    batch.limits = { ...batch.limits, remainingCalls: batch.limits.remainingCalls - spent.calls - reserved.calls,
      remainingCostMicros: batch.limits.remainingCostMicros - spent.costMicros - reserved.costMicros };
    const latest = receipts.at(-1);
    if (latest) batch.probeRounds = latest.probeRounds;
    const rows = (await client.query("select * from knowledge_service.recovery_dependency_claim where tenant_id=$1 and case_id=$2 and released_at is null and expires_at>clock_timestamp() order by dependency_key", [tenantId, caseId])).rows;
    const grouped = new Map<string, Row[]>();
    for (const claim of rows) grouped.set(String(claim.claim_token), [...(grouped.get(String(claim.claim_token)) ?? []), claim]);
    const claims = [...grouped.values()].map(group => ({ tenantId, caseId, planDigest: group[0]!.plan_digest, holderIdentity: group[0]!.holder_identity,
      token: group[0]!.claim_token, fencingToken: Number(group[0]!.fencing_token), expiresAt: (group[0]!.expires_at as Date).toISOString(), keys: group.map(item => item.dependency_key) }));
    return DurableRecoveryCaseSchema.parse({ tenantId, caseId, revision: Number(row.revision), state: row.state, initialBatch, batch,
      authorityDigest: row.authority_digest, initialAuthorityArtifact: row.authority_handle, revisions, executions, claims,
      ...(row.active_plan_digest ? { activePlanDigest: row.active_plan_digest } : {}), spent, reserved,
      ...(plans.at(-1) ? { latestPlan: plans.at(-1) } : {}), ...(latest ? { latestReceipt: latest } : {}) });
  }
}
