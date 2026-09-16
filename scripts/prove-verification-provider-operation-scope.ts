import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PostgresCanonicalRepository, PostgresVerificationRepository, type LeasedStep } from "../packages/persistence/src/index.js";
import { PostgresVerificationProviderAccounting } from "../packages/persistence/src/verification-provider-accounting.js";
import { SupabaseArtifactStore } from "../packages/runtime/src/artifacts.js";
import { VerificationProviderArtifactComposer } from "../packages/application/src/verification/operations/verification-provider.js";
import { canonicalizeJson, sha256Digest } from "../packages/verification/src/index.js";

const pgUrl = process.env.POSTGRES_URL!, storageUrl = process.env.SUPABASE_URL!;
for (const [value, port] of [[pgUrl, "54322"], [storageUrl, "54321"]]) {
  const url = new URL(value!);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.port !== port) throw new Error("LOCAL_ONLY_PROOF_REQUIRED");
}
const tenantId = randomUUID(), namespace = randomUUID(), actorIdentity = "provider-operation-scope-proof";
const database = new PostgresCanonicalRepository({ connectionString: pgUrl, localOnly: true });
const repository = new PostgresVerificationRepository(database, new SupabaseArtifactStore({ projectUrl: storageUrl, serviceRoleKey: process.env.SUPABASE_SECRET_KEY!, bucket: "ai-engineer-cloud-bucket", maximumBytes: 200_000 }), { async authorize(input) { assert.equal(input.tenantId, tenantId); } });
const checks: Record<string, boolean> = {}, operations: string[] = [];
const encode = (value: unknown) => new TextEncoder().encode(canonicalizeJson(value));
const now = new Date().toISOString();
async function denied(name: string, action: () => Promise<unknown>, pattern: RegExp) {
  await assert.rejects(action, pattern); checks[name] = true;
}
async function open(leaseMs = 300_000): Promise<LeasedStep> {
  const id = randomUUID(); operations.push(id);
  await database.createOperation({ id, tenantId, operationKind: "verification_structured_extraction", idempotencyKey: `${namespace}-${id}`, correlationId: namespace, actorIdentity, request: { proof: namespace }, steps: [{ id: randomUUID(), key: "extract_and_register", kind: "extract_and_register", input: { proof: namespace }, maxAttempts: 4 }] });
  const lease = await database.claimOperation(tenantId, id, actorIdentity, leaseMs);
  assert.ok(lease); return lease;
}
try {
  const profile = await repository.registerContentAddressedArtifact({ tenantId, bytes: encode({ proof: namespace, scope: "synthetic accounting identity; not an admitted extraction profile" }), mediaType: "application/json", artifactType: "verification_structured_extraction_profile", bucketClass: "ledger", storageBucket: "ai-engineer-cloud-bucket", createdAt: now, producerActivityId: actorIdentity, producerVersion: "v1", encryptionClass: "supabase-managed", retentionClass: "proof", dataClassification: "restricted" });
  const composer = new VerificationProviderArtifactComposer(repository, { tenantId, storageBucket: "ai-engineer-cloud-bucket", producerActivityId: actorIdentity, producerVersion: "v1", encryptionClass: "supabase-managed", retentionClass: "proof", now: () => now, externalProcessingGrant: { providerId: "gateway", dataClassification: "synthetic", modalities: ["text"] } });
  await composer.registerInput(encode({ synthetic: true, namespace }), "application/json");
  const requestBytes = encode({ identicalWireBody: true, namespace }), requestDigest = sha256Digest(requestBytes);
  await composer.persistBeforeDispatch({ requestDigest, requestBytes });
  await composer.persistAfterResponse({ requestDigest, rawResponseBytes: encode({ syntheticResponse: true, namespace }) });
  const requestArtifactId = composer.requestArtifact(requestDigest)!.artifactId, responseArtifactId = composer.responseEnvelopeArtifact(requestDigest)!.artifactId;
  const budgetId = randomUUID();
  const input = (attemptId: string) => ({ tenantId, budgetId, budgetKey: "operation-scope-proof", ceilingCostMicros: 10_000, attemptId, requestDigest, attemptOrdinal: 0, providerId: "gateway-structured-extraction.v1", model: "openai/gpt-5.6-luna", reservationCostMicros: 100, requestArtifactId });
  const scoped = (lease: LeasedStep, profileDigest = profile.digest as `sha256:${string}`) => new PostgresVerificationProviderAccounting(database, { lease, profileArtifactId: profile.artifactId, profileDigest });
  const legacy = new PostgresVerificationProviderAccounting(database);
  const a = await open(), b = await open(), aid = randomUUID(), bid = randomUUID();
  await Promise.all([scoped(a).reserve(input(aid)), scoped(b).reserve(input(bid))]);
  checks.identical_wire_separate_operations = true;
  assert.equal((await scoped(a).reserve(input(aid))).reused, true); checks.exact_reservation_retry = true;
  await denied("changed_request_rejected", () => scoped(a).reserve({ ...input(aid), requestDigest: `sha256:${"0".repeat(64)}` }), /IDENTITY_CONFLICT/);
  await denied("changed_profile_rejected", () => scoped(a, `sha256:${"0".repeat(64)}`).reserve(input(aid)), /SCOPE_ATTEMPT_MISMATCH/);
  await denied("wrong_lease_token_rejected", () => scoped({ ...a, leaseToken: randomUUID() }).reserve(input(aid)), /STALE_OPERATION_LEASE/);
  await denied("wrong_holder_rejected", () => scoped({ ...a, holderIdentity: "wrong" }).reserve(input(aid)), /STALE_OPERATION_LEASE/);
  await denied("wrong_fence_rejected", () => scoped({ ...a, fencingToken: a.fencingToken + 1000 }).reserve(input(aid)), /STALE_OPERATION_LEASE/);
  await denied("foreign_tenant_rejected", () => scoped(a).reserve({ ...input(aid), tenantId: randomUUID() }), /SCOPE_TENANT_MISMATCH/);
  await denied("sql_profile_digest_admission", () => scoped(a, `sha256:${"0".repeat(64)}`).reserve({ ...input(randomUUID()), attemptOrdinal: 1 }), /inadmissible/);
  await denied("sql_profile_artifact_type_admission", () => new PostgresVerificationProviderAccounting(database, { lease: a, profileArtifactId: requestArtifactId, profileDigest: requestDigest }).reserve({ ...input(randomUUID()), attemptOrdinal: 1 }), /inadmissible/);
  const directDispatch = (changes: string) => database.transaction(tenantId, async client => {
    await client.query("select set_config('verification.provider_claim',$1,true)", [JSON.stringify({ stepId: b.id, leaseToken: b.leaseToken, fencingToken: b.fencingToken, holderIdentity: b.holderIdentity })]);
    return client.query(`update orchestration.verification_provider_attempt set state='dispatched',dispatched_at=clock_timestamp(),dispatch_fence=$3,${changes} where tenant_id=$1 and id=$2`, [tenantId, bid, randomUUID()]);
  });
  await denied("sql_null_dispatch_fence_rejected", () => directDispatch("dispatch_fencing_token=null"), /dispatch fence|scope_ck/);
  await denied("sql_estimate_identity_preserved", () => directDispatch(`dispatch_fencing_token=${b.fencingToken},estimated_cost_micros=1`), /immutable identity/);
  await denied("sql_scope_removal_rejected", () => directDispatch("dispatch_fencing_token=null,operation_id=null,operation_step_id=null,profile_artifact_id=null,profile_sha256=null,reserved_fencing_token=null"), /scope.*(removed|immutable)/);
  const claims = await Promise.all([scoped(a).claimDispatch({ tenantId, attemptId: aid, dispatchFence: randomUUID() }), scoped(a).claimDispatch({ tenantId, attemptId: aid, dispatchFence: randomUUID() })]);
  assert.equal(claims.filter(item => item.claimed).length, 1); assert.equal(claims[0]!.attempt.dispatchFencingToken, a.fencingToken); checks.concurrent_claim_exactly_once = true;
  await denied("legacy_cannot_touch_scoped", () => legacy.claimDispatch({ tenantId, attemptId: aid, dispatchFence: randomUUID() }), /SCOPED_ATTEMPT_REQUIRED/);
  await denied("other_operation_cannot_touch_scoped", () => scoped(b).markUncertain({ tenantId, attemptId: aid }), /SCOPE_ATTEMPT_MISMATCH/);
  await scoped(a).markUncertain({ tenantId, attemptId: aid, responseArtifactId });
  assert.equal((await scoped(a).claimDispatch({ tenantId, attemptId: aid, dispatchFence: randomUUID() })).claimed, false); checks.uncertain_never_redispatched = true;
  await scoped(a).settle({ tenantId, attemptId: aid, actualCostMicros: 40, responseArtifactId });
  await scoped(a).settle({ tenantId, attemptId: aid, actualCostMicros: 40, responseArtifactId }); checks.exact_settlement_retry = true;
  await denied("cached_settlement_profile_drift_rejected", () => scoped(a, `sha256:${"0".repeat(64)}`).settle({ tenantId, attemptId: aid, actualCostMicros: 40, responseArtifactId }), /SCOPE_ATTEMPT_MISMATCH/);
  const c = await open(1500), cid = randomUUID();
  await scoped(c).reserve(input(cid));
  await new Promise(resolve => setTimeout(resolve, 1700));
  const replacement = await database.claimOperation(tenantId, c.operationId, `${actorIdentity}-replacement`, 300_000); assert.ok(replacement); assert.ok(replacement.fencingToken > c.fencingToken);
  await denied("expired_worker_dispatch_rejected", () => scoped(c).claimDispatch({ tenantId, attemptId: cid, dispatchFence: randomUUID() }), /STALE_OPERATION_LEASE/);
  assert.equal((await scoped(replacement).reserve(input(cid))).reused, true);
  const recovered = await scoped(replacement).claimDispatch({ tenantId, attemptId: cid, dispatchFence: randomUUID() });
  assert.equal(recovered.claimed, true); assert.equal(recovered.attempt.reservedFencingToken, c.fencingToken); assert.equal(recovered.attempt.dispatchFencingToken, replacement.fencingToken); checks.replacement_recovers_reserved_identity = true;
  await scoped(replacement).markUncertain({ tenantId, attemptId: cid, responseArtifactId });
  // A second natural lease turnover must preserve the actual dispatch fence.
  const d = await open(1500), did = randomUUID();
  await scoped(d).reserve(input(did)); await scoped(d).claimDispatch({ tenantId, attemptId: did, dispatchFence: randomUUID() });
  await new Promise(resolve => setTimeout(resolve, 1700));
  const replacementD = await database.claimOperation(tenantId, d.operationId, `${actorIdentity}-replacement`, 300_000); assert.ok(replacementD);
  const settled = await scoped(replacementD).settle({ tenantId, attemptId: did, actualCostMicros: 30, responseArtifactId });
  assert.equal(settled.attempt.dispatchFencingToken, d.fencingToken); checks.replacement_settlement_preserves_dispatch_fence = true;
  await denied("direct_update_without_claim_rejected", () => database.transaction(tenantId, client => client.query("update orchestration.verification_provider_attempt set state='dispatched',dispatched_at=clock_timestamp(),dispatch_fence=$3,dispatch_fencing_token=$4 where tenant_id=$1 and id=$2", [tenantId, bid, randomUUID(), b.fencingToken])), /active.*lease claim required/);
  await database.cancelOperation(tenantId, b.operationId, { actorIdentity, correlationId: namespace });
  await denied("cancelled_dispatch_rejected", () => scoped(b).claimDispatch({ tenantId, attemptId: bid, dispatchFence: randomUUID() }), /STALE_OPERATION_LEASE/);
  await database.cancelOperation(tenantId, c.operationId, { actorIdentity, correlationId: namespace });
  await denied("cancelled_settlement_requires_reconciliation", () => scoped(replacement).settle({ tenantId, attemptId: cid, actualCostMicros: 30, responseArtifactId }), /STALE_OPERATION_LEASE/);
  const lid = randomUUID(); await legacy.reserve(input(lid));
  assert.equal((await legacy.claimDispatch({ tenantId, attemptId: lid, dispatchFence: randomUUID() })).claimed, true);
  await legacy.settle({ tenantId, attemptId: lid, actualCostMicros: 20, responseArtifactId }); checks.legacy_same_wire_still_works = true;
  const rows = await database.transaction(tenantId, async client => ({ attempts: (await client.query("select id,operation_id,operation_step_id,request_sha256,profile_artifact_id,profile_sha256,state,reserved_fencing_token,dispatch_fencing_token,reservation_cost_micros,actual_cost_micros from orchestration.verification_provider_attempt where tenant_id=$1 order by id", [tenantId])).rows, budget: (await client.query("select reserved_cost_micros,settled_cost_micros from orchestration.verification_provider_budget where tenant_id=$1 and id=$2", [tenantId, budgetId])).rows[0] }));
  assert.equal(rows.attempts.length, 5); assert.equal(Number(rows.budget!.reserved_cost_micros), 200); assert.equal(Number(rows.budget!.settled_cost_micros), 90); checks.cancelled_liability_retained = true;
  const sourcePaths = ["packages/persistence/src/verification-provider-accounting.ts", "../ai-engineer-db-contract/supabase/migrations/20260906031300_verification_provider_operation_scope.sql", "scripts/prove-verification-provider-operation-scope.ts"];
  const sources = await Promise.all(sourcePaths.map(async path => ({ path, sha256: createHash("sha256").update(await readFile(path)).digest("hex") })));
  const output = resolve("../internal", `verification-provider-operation-scope-${namespace}.json`);
  await writeFile(output, JSON.stringify({ schemaVersion: "verification-provider-operation-scope-proof.v1", passed: true, scope: "real local PostgreSQL and Storage; synthetic accounting, no provider dispatch or supplier charges", providerDispatches: 0, tenantId, budgetId, operations, profile, requestArtifactId, responseArtifactId, checks, rows, sources }, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ passed: true, output, checks: Object.keys(checks).length }));
} finally {
  for (const operationId of operations) await database.cancelOperation(tenantId, operationId, { actorIdentity, correlationId: namespace });
  await database.close();
}
