import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PostgresCanonicalRepository, PostgresVerificationRepository } from "@aiengineer/knowledge-persistence";
import { SupabaseArtifactStore } from "@aiengineer/knowledge-runtime";
import { VerificationBenchmarkCaseResultSchema } from "@aiengineer/knowledge-contracts";
import { createVerificationBenchmarkCheckpointPlan, verificationBenchmarkDigest } from "../packages/evaluation/src/verification-benchmark.js";
import { OfflineBenchmarkInputCatalog, RegisteredBenchmarkInputAdmission } from "../packages/application/src/verification/benchmark/verification-benchmark-inputs.js";
import { PostgresVerificationBenchmarkRunStore, type DurableVerificationBenchmarkRunInput } from "../packages/persistence/src/verification-benchmark-run.js";

const pgUrl = process.env.POSTGRES_URL!, storageUrl = process.env.SUPABASE_URL!;
const pg = new URL(pgUrl), storage = new URL(storageUrl);
if (!["localhost", "127.0.0.1"].includes(pg.hostname) || pg.port !== "54322" || !["localhost", "127.0.0.1"].includes(storage.hostname) || storage.port !== "54321") throw new Error("LOCAL_ONLY_PROOF_REFUSED_REMOTE_TARGET");
const root = resolve("../internal"), namespace = randomUUID(), actorIdentity = "benchmark-negative-proof";
const receipt = JSON.parse(await readFile(resolve(root, "verification-registered-replay-0fb07c1b-4b78-4177-8939-942701e5382a.json"), "utf8")) as { tenantId: string; dataset: { artifactId: string; digest: string }; experiment: { artifactId: string; digest: string } };
const tenantId = receipt.tenantId, operationIds: string[] = [], checks: Record<string, boolean> = {};
const database = new PostgresCanonicalRepository({ connectionString: pgUrl, localOnly: true });
const repository = new PostgresVerificationRepository(database, new SupabaseArtifactStore({ projectUrl: storageUrl, serviceRoleKey: process.env.SUPABASE_SECRET_KEY!, bucket: "ai-engineer-cloud-bucket", maximumBytes: 8 * 1024 * 1024 }), { async authorize(input) { if (input.tenantId !== tenantId || input.purpose !== "verification_admission") throw new Error("ARTIFACT_ACCESS_DENIED"); } });
const store = new PostgresVerificationBenchmarkRunStore(database);
async function denied(name: string, action: () => Promise<unknown>, expected: RegExp) {
  try { await action(); } catch (error) { if (!expected.test(error instanceof Error ? error.message : String(error))) throw error; checks[name] = true; return; }
  throw new Error(`${name}_NOT_DENIED`);
}
function checkpoint(input: DurableVerificationBenchmarkRunInput, entry = input.checkpointPlan.entries[0]!, completedAt = new Date().toISOString()) {
  const material = { schemaVersion: "verification-benchmark.v1", runId: input.runId, armId: entry.armId, caseId: entry.caseId, repetition: entry.repetition, checkpointContextDigest: entry.checkpointContextDigest, completedAt, schemaValid: false, locatorValid: false, fieldMechanics: false, support: "not_applicable", authority: "not_applicable", worldCorrectness: "unknown", policy: "abstain", confidence: null, confidenceCalibrated: false, failureClass: "local", callAttributions: [] };
  return VerificationBenchmarkCaseResultSchema.parse({ ...material, checkpointDigest: verificationBenchmarkDigest(material) });
}
try {
  const admitted = await new RegisteredBenchmarkInputAdmission(new OfflineBenchmarkInputCatalog([{ ...receipt, runnerVersion: "verification-benchmark-runner.v1" }]), repository.createTrustedArtifactResolver()).load({ verificationContractVersion: "verification.v1", dataset: receipt.dataset, experimentDefinition: receipt.experiment, executionMode: "offline_recorded" }, { tenantId });
  async function open(leaseMs = 300_000) {
    const operationId = randomUUID(), runId = randomUUID(); operationIds.push(operationId);
    await database.createOperation({ id: operationId, tenantId, operationKind: "verification_benchmark", idempotencyKey: `${namespace}-${operationId}`, correlationId: namespace, actorIdentity, request: { schemaVersion: "knowledge-operation-request/v1", kind: "verification_benchmark", input: { schemaVersion: "verification-service-request.v1", useCase: "runBenchmark", request: admitted.request } }, steps: [{ id: randomUUID(), key: "replay_recorded_and_register", kind: "replay_recorded_and_register", input: { runId }, maxAttempts: 3 }] });
    const lease = await database.claimOperation(tenantId, operationId, actorIdentity, leaseMs); if (!lease) throw new Error("PROOF_LEASE_MISSING");
    const options = { runId, dataset: admitted.dataset, experimentDefinitionDigest: admitted.experimentArtifact.digest as `sha256:${string}`, arms: admitted.experiment.arms, repetitions: admitted.experiment.repetitions, randomSeed: admitted.experiment.randomSeed, networkPolicy: "offline" as const };
    const identity: DurableVerificationBenchmarkRunInput = { tenantId, operationId, lease, runId, datasetArtifact: admitted.datasetArtifact, experimentArtifact: admitted.experimentArtifact, runnerVersion: admitted.experiment.runnerVersion, networkPolicy: "offline", randomSeed: admitted.experiment.randomSeed, repetitions: admitted.experiment.repetitions, checkpointPlan: createVerificationBenchmarkCheckpointPlan(options), startedAt: new Date().toISOString() };
    return { identity, execution: await store.initialize(identity) };
  }
  const a = await open(), b = await open();
  const first = checkpoint(a.identity), firstKey = first.checkpointContextDigest;
  await Promise.all([a.execution.checkpoints.save(firstKey, first), a.execution.checkpoints.save(firstKey, first)]);
  const count = async (runId: string) => database.transaction(tenantId, async client => Number((await client.query<{ count: string }>("select count(*)::text count from evaluation.verification_benchmark_checkpoint where tenant_id=$1 and benchmark_run_id=$2", [tenantId, runId])).rows[0]!.count));
  checks.concurrent_exact_retry_one_row = await count(a.identity.runId) === 1;
  const loaded = await a.execution.checkpoints.load(firstKey);
  checks.database_checkpoint_roundtrip_exact = verificationBenchmarkDigest(loaded!) === verificationBenchmarkDigest(first);
  const retry = await store.initialize({ ...a.identity, startedAt: new Date().toISOString() });
  checks.retry_retains_original_start = retry.run.startedAt === a.execution.run.startedAt;
  await denied("changed_checkpoint_rejected", () => a.execution.checkpoints.save(firstKey, checkpoint(a.identity)), /CHECKPOINT_DRIFT/);
  await denied("incomplete_matrix_cannot_complete", () => a.execution.lifecycle.complete(), /PLAN_INCOMPLETE/);
  const offPlan = { ...a.identity.checkpointPlan.entries[1]!, checkpointContextDigest: verificationBenchmarkDigest("off-plan") };
  await denied("off_plan_checkpoint_rejected", () => a.execution.checkpoints.save(offPlan.checkpointContextDigest, checkpoint(a.identity, offPlan)), /CHECKPOINT_BINDING_INVALID/);
  const otherResult = checkpoint(b.identity), forgedOther = { ...b.execution.run, operationId: a.identity.operationId };
  await denied("cross_operation_save_rejected", () => store.save(forgedOther, a.identity.lease, otherResult.checkpointContextDigest, otherResult), /RUN_BINDING_INVALID/);
  await denied("cross_operation_completion_rejected", () => store.complete(forgedOther, a.identity.lease), /RUN_BINDING_INVALID/);
  const alteredEntries = a.execution.run.checkpointPlan.entries.map((entry, index) => index === 1 ? { ...entry, caseId: "forged-case" } : entry);
  const forgedPlan = { ...a.execution.run, checkpointPlan: { ...a.execution.run.checkpointPlan, entries: alteredEntries } };
  const forgedCase = checkpoint(a.identity, alteredEntries[1]!);
  await denied("forged_plan_save_rejected", () => store.save(forgedPlan, a.identity.lease, forgedCase.checkpointContextDigest, forgedCase), /RUN_BINDING_INVALID/);
  await denied("forged_plan_completion_rejected", () => store.complete(forgedPlan, a.identity.lease), /RUN_BINDING_INVALID/);
  const next = a.identity.checkpointPlan.entries[1]!;
  await denied("future_checkpoint_rejected", () => a.execution.checkpoints.save(next.checkpointContextDigest, checkpoint(a.identity, next, new Date(Date.now() + 60_000).toISOString())), /TIMESTAMP_INVALID/);
  await denied("prestart_checkpoint_rejected", () => a.execution.checkpoints.save(next.checkpointContextDigest, checkpoint(a.identity, next, new Date(Date.parse(a.identity.startedAt) - 1).toISOString())), /TIMESTAMP_INVALID/);
  checks.rejected_writes_leave_both_runs_unchanged = await count(a.identity.runId) === 1 && await count(b.identity.runId) === 0;
  await database.cancelOperation(tenantId, a.identity.operationId, { actorIdentity, correlationId: namespace });
  await denied("cancelled_save_rejected", () => a.execution.checkpoints.save(next.checkpointContextDigest, checkpoint(a.identity, next)), /OPERATION_NOT_ACTIVE/);
  await denied("cancelled_completion_rejected", () => a.execution.lifecycle.complete(), /OPERATION_NOT_ACTIVE/);
  const c = await open(500);
  await new Promise(resolve => setTimeout(resolve, 650));
  const replacement = await database.claimOperation(tenantId, c.identity.operationId, `${actorIdentity}-replacement`, 300_000);
  if (!replacement || replacement.fencingToken <= c.identity.lease.fencingToken) throw new Error("REPLACEMENT_FENCE_NOT_INCREASED");
  const cResult = checkpoint(c.identity);
  await denied("expired_fence_save_rejected", () => c.execution.checkpoints.save(cResult.checkpointContextDigest, cResult), /STALE_LEASE/);
  await denied("expired_fence_completion_rejected", () => c.execution.lifecycle.complete(), /STALE_LEASE/);
  const replacementRun = await store.initialize({ ...c.identity, lease: replacement, startedAt: new Date().toISOString() });
  await replacementRun.checkpoints.save(cResult.checkpointContextDigest, cResult);
  checks.replacement_fence_can_resume_same_run = await count(c.identity.runId) === 1 && replacementRun.run.startedAt === c.execution.run.startedAt;
  if (!Object.values(checks).every(Boolean)) throw new Error("BENCHMARK_NEGATIVE_PROOF_FAILED");
  const output = resolve(root, `verification-benchmark-durable-negatives-${namespace}.json`);
  const result = { status: "passed", scope: "actual local DB fence/custody tests with synthetic checkpoint decisions; not benchmark quality or process-kill proof", tenantId, namespace, checks, operationIds, runs: [a, b, c].map(item => ({ runId: item.identity.runId, operationId: item.identity.operationId })), expiredFence: c.identity.lease.fencingToken, replacementFence: replacement.fencingToken };
  await writeFile(output, JSON.stringify(result, null, 2)); console.log(JSON.stringify({ output, ...result }));
} finally {
  for (const operationId of operationIds) await database.cancelOperation(tenantId, operationId, { actorIdentity, correlationId: namespace });
  await database.close();
}
