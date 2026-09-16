import { z } from "zod";
import type { FilesystemStore } from "./store.js";
import type { PostgresCanonicalRepository } from "@aiengineer/knowledge-persistence";
import { digestCanonicalJson } from "@aiengineer/knowledge-verification";

const Digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const JournalDigest = z.string().regex(/^[a-f0-9]{64}$/);
const Count = z.number().int().min(0).max(10000);
const Cost = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const Execution = z.strictObject({ execution: z.strictObject({ tenantId: z.uuid(), runId: z.uuid(),
  resultArtifactId: z.uuid(), resultDigest: Digest }), calls: Count, costMicros: Cost,
  evidence: z.array(z.strictObject({ callId: z.string().min(1), requestDigest: Digest,
    reservationDigest: JournalDigest, settlementDigest: JournalDigest })).max(10000),
  lifecycle: z.strictObject({ openedDigest: JournalDigest, closedDigest: JournalDigest }).optional() });
const RunUsage = z.strictObject({ tenantId: z.uuid(), runId: z.uuid(), calls: Count, costMicros: Cost,
  executions: z.array(Execution).min(1).max(256) });

export type RunUsageReader = (scope: { tenantId: string; runId: string }) => Promise<unknown> | unknown;

interface Completion {
  operationId: string; receiptId: string; digest: string; summary: {
    submission: { tenantId: string; runId: string; missionId: string; attemptId: string }; resultArtifactId: string;
    auditArtifact: { artifactId: string; digest: string } } };

async function validateUsage(input: { store: FilesystemStore; completion: Completion; observed: unknown }) {
  const { tenantId, runId } = input.completion.summary.submission;
  const usage = RunUsage.parse(input.observed);
  const callIds = usage.executions.flatMap(execution => execution.evidence.map(call => call.callId));
  const resultIds = usage.executions.map(execution => execution.execution.resultArtifactId);
  if (usage.tenantId !== tenantId || usage.runId !== runId || input.store.tenantId !== tenantId
    || new Set(callIds).size !== callIds.length || new Set(resultIds).size !== resultIds.length
    || !resultIds.includes(input.completion.summary.resultArtifactId)
    || usage.calls !== callIds.length || usage.costMicros !== usage.executions.reduce((sum, execution) => sum + execution.costMicros, 0))
    throw new Error("ROOT_ACCOUNTING_SCOPE_OR_TOTAL");
  for (const execution of usage.executions) {
    const context = execution.execution;
    if (context.tenantId !== tenantId || context.runId !== runId || execution.calls !== execution.evidence.length)
      throw new Error("ROOT_ACCOUNTING_EXECUTION_BINDING");
    if (execution.calls === 0 && (execution.costMicros !== 0 || !execution.lifecycle
      || execution.lifecycle.openedDigest === execution.lifecycle.closedDigest))
      throw new Error("ROOT_ACCOUNTING_ZERO_DISPATCH_PROOF_REQUIRED");
    const result = await input.store.resolveHandle({ artifactId: context.resultArtifactId });
    await input.store.bytes(result);
    if (result.digest !== context.resultDigest || result.producerActivityId !== "verification-executor:verify_claims"
      || result.producerVersion !== "knowledge-verification-executor.v1") throw new Error("ROOT_ACCOUNTING_RESULT_CUSTODY");
  }
  return { usage, resultIds };
}

/** Only the trusted host supplies accounting; this is not a producer-facing tool. */
export async function retainVerificationAccounting(input: { store: FilesystemStore; readUsage?: RunUsageReader; completion: Completion }) {
  const { tenantId, runId } = input.completion.summary.submission;
  const observed = await input.readUsage?.({ tenantId, runId });
  if (observed === null || observed === undefined) return null;
  const { usage, resultIds } = await validateUsage({ ...input, observed });
  const value = { schemaVersion: "root-verification-accounting.v1", operationId: input.completion.operationId,
    receiptId: input.completion.receiptId, receiptDigest: input.completion.digest,
    auditArtifact: input.completion.summary.auditArtifact, usage };
  const retained = await input.store.putJson(value, { mediaType: "application/vnd.aiengineer.verification-accounting+json",
    producerActivityId: "root-host:verification-accounting", producerVersion: "root-verification-accounting.v1",
    dataClassification: "internal", parentArtifactIds: [input.completion.summary.auditArtifact.artifactId, ...resultIds],
    transformation: { kind: "root-verification-accounting.v1", receiptDigest: input.completion.digest } });
  return { artifactId: retained.handle.artifactId, digest: retained.handle.digest, value };
}

export async function readVerificationAccounting(input: {
  store: FilesystemStore; database: Pick<PostgresCanonicalRepository, "transaction">; completion: Completion;
}) {
  const { tenantId, missionId, attemptId } = input.completion.summary.submission;
  const rows = await input.database.transaction(tenantId, async client => (await client.query<{ id: string }>(`
    select a.id from orchestration.artifact a join orchestration.verification_artifact_metadata m
      on m.tenant_id=a.tenant_id and m.artifact_id=a.id
    where a.tenant_id=$1 and a.mission_id=$2 and a.producer_attempt_id=$3
      and a.verification_contract_version='verification.v1'
      and m.producer_activity_id='root-host:verification-accounting'
      and m.producer_version='root-verification-accounting.v1'
      and $4::uuid=any(m.parent_artifact_ids)
    order by a.id limit 257`, [tenantId, missionId, attemptId, input.completion.summary.auditArtifact.artifactId])).rows);
  if (rows.length > 256) throw new Error("ROOT_ACCOUNTING_HISTORY_CAPACITY");
  const snapshots = [];
  for (const row of rows) {
    const handle = await input.store.resolveHandle({ artifactId: row.id });
    const value = z.strictObject({ schemaVersion: z.literal("root-verification-accounting.v1"), operationId: z.uuid(),
      receiptId: z.uuid(), receiptDigest: Digest, auditArtifact: z.strictObject({ artifactId: z.uuid(), digest: Digest }), usage: RunUsage
    }).parse(await input.store.json(handle));
    if (value.operationId !== input.completion.operationId) continue;
    if (value.receiptId !== input.completion.receiptId || value.receiptDigest !== input.completion.digest
      || digestCanonicalJson(value.auditArtifact) !== digestCanonicalJson(input.completion.summary.auditArtifact)
      || handle.producerActivityId !== "root-host:verification-accounting" || handle.producerVersion !== value.schemaVersion)
      throw new Error("ROOT_ACCOUNTING_RECEIPT_BINDING");
    const { resultIds } = await validateUsage({ ...input, observed: value.usage });
    const parents = [value.auditArtifact.artifactId, ...resultIds].sort();
    if (digestCanonicalJson([...handle.parentArtifactIds].sort()) !== digestCanonicalJson(parents))
      throw new Error("ROOT_ACCOUNTING_LINEAGE");
    snapshots.push({ artifactId: handle.artifactId, digest: handle.digest, value });
  }
  return snapshots;
}

/** Select by cumulative immutable call evidence, never by artifact timestamp. */
export function selectVerificationAccounting(snapshots: Awaited<ReturnType<typeof readVerificationAccounting>>) {
  if (!snapshots.length) return null;
  const identity = (snapshot: typeof snapshots[number]) => digestCanonicalJson({
    operationId: snapshot.value.operationId, receiptId: snapshot.value.receiptId, receiptDigest: snapshot.value.receiptDigest,
    auditArtifact: snapshot.value.auditArtifact, tenantId: snapshot.value.usage.tenantId, runId: snapshot.value.usage.runId });
  const expected = identity(snapshots[0]!);
  if (snapshots.some(snapshot => identity(snapshot) !== expected)) throw new Error("ROOT_ACCOUNTING_SNAPSHOT_SCOPE");
  const calls = (snapshot: typeof snapshots[number]) => new Map(snapshot.value.usage.executions.flatMap(execution =>
    execution.evidence.map(call => [call.callId, digestCanonicalJson({ execution: execution.execution, call })] as const)));
  const ordered = [...snapshots].sort((left, right) => right.value.usage.calls - left.value.usage.calls
    || right.value.usage.executions.length - left.value.usage.executions.length
    || left.artifactId.localeCompare(right.artifactId));
  const selected = ordered[0]!, selectedCalls = calls(selected);
  for (const snapshot of ordered) {
    if ([...calls(snapshot)].some(([id, digest]) => selectedCalls.get(id) !== digest))
      throw new Error("ROOT_ACCOUNTING_SNAPSHOTS_INCOMPARABLE");
    for (const previous of snapshot.value.usage.executions) {
      const current = selected.value.usage.executions.find(execution =>
        digestCanonicalJson(execution.execution) === digestCanonicalJson(previous.execution));
      if (!current || current.costMicros < previous.costMicros
        || (current.calls === previous.calls && current.costMicros !== previous.costMicros))
        throw new Error("ROOT_ACCOUNTING_SETTLEMENT_CONFLICT");
    }
  }
  return selected;
}
