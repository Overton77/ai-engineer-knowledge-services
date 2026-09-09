import { createHash } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DiagnosticsBenchmarkProviderObservationSchema, DiagnosticsBenchmarkSupportOutputSchema, SemanticJudgeOutputSchema, VerificationBenchmarkDatasetSchema, type DiagnosticsBenchmarkProviderObservation, type VerificationArtifactHandle } from "@aiengineer/knowledge-contracts";
import { assertDiagnosticsProviderWireRequest, loadDiagnosticsProviderGrant } from "@aiengineer/knowledge-application";
import { verificationBenchmarkDigest } from "../packages/evaluation/dist/index.js";
import { createVerificationArtifactHandle, PostgresCanonicalRepository, PostgresVerificationRepository, type RegisterContentAddressedVerificationArtifactInput } from "@aiengineer/knowledge-persistence";
import { deterministicUuid, SupabaseArtifactStore } from "@aiengineer/knowledge-runtime";
import { canonicalizeJson, providerDigest, sha256Digest } from "@aiengineer/knowledge-verification";

type Digest = `sha256:${string}`;
type Json = Record<string, any>;
const workspace = resolve(import.meta.dirname, "../..");
const repositoryRoot = resolve(import.meta.dirname, "..");
const internal = resolve(workspace, "internal");
const recoveryDirectory = resolve(internal, "verification-reset-recovery-ad277aa3-6d08-4a04-9c6c-e82957511e30");
const catalogDirectory = resolve(repositoryRoot, "catalog/verification-benchmarks/diagnostics-companies-pilot-v3");
const sourcePreparationDirectory = resolve(internal, "verification-offline-source-preparation-9093b465-16c2-4cc1-b7f4-728d3958b0ed");
const writeSetPath = resolve(internal, "verification-reset-recovery-write-set-32254f8f-b81e-4dc3-aec6-ea1db03843a9.json");
const receiptPath = resolve(internal, "verification-reset-recovery-receipt-32254f8f-b81e-4dc3-aec6-ea1db03843a9.json");
const replayPackPath = resolve(internal, "verification-reset-recovery-replay-pack-32254f8f-b81e-4dc3-aec6-ea1db03843a9.json");
const providerTenantId = "6d057f43-6aaf-48d9-b3ba-374169abb989";
const sourceTenantId = "fbfa12cf-0cef-423d-858e-f7a3e213fa80";
const sealedAt = "2026-09-05T07:36:10.842Z";
const incidentDigest = "sha256:545c93fb4af9ff184e8a31830316bc9d8cb6d9ae6dd81954d128ef0874c2b7c2" as const;
const recoveryInventoryDigest = "sha256:7613ef8cb3802294f7c3175fd16af711bdd9cc2cd981020063263a3ce288601f" as const;
const sourceReceiptDigest = "sha256:b37b7785529a24e8c95e5ae85f281dcdd40b83dbda0e1cd8ce3dee93f0a8f7eb" as const;
const reviewDigest = "sha256:eea987f6d64c39d4e7ba0944007d522a1c3ad0ab9905b31050b25fbdcd301923" as const;
const planDigest = "sha256:4dfdf5d446e2054023834f8577a3f9db928bece05580c3468f30f25d15226fbe" as const;
const budget = { id: deterministicUuid("verification-reset-recovery", `${incidentDigest}:successor-budget`), key: "ws07-pilot-recovery-20260905", ceilingCostMicros: 17_928_167 };
const ids = {
  mission: deterministicUuid("verification-reset-recovery", `${incidentDigest}:mission`),
  workItem: deterministicUuid("verification-reset-recovery", `${incidentDigest}:work-item`),
  attempt: deterministicUuid("verification-reset-recovery", `${incidentDigest}:attempt`),
  artifactManifest: deterministicUuid("verification-reset-recovery", `${incidentDigest}:artifact-manifest`),
};
const encode = (value: unknown) => new TextEncoder().encode(canonicalizeJson(value));
const fileSha = async (path: string): Promise<Digest> => `sha256:${createHash("sha256").update(await readFile(path)).digest("hex")}`;
const requireFile = async (path: string, digest: Digest) => { if (await fileSha(path) !== digest) throw new Error(`RECOVERY_INPUT_DIGEST_MISMATCH:${path}`); };
const required = (name: string) => { const value = process.env[name]?.trim(); if (!value) throw new Error(`RECOVERY_${name}_MISSING`); return value; };
const omitDigest = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).filter(([key]) => key !== "observationDigest"));

const artifactDefaults = { tenantId: providerTenantId, createdAt: sealedAt, producerActivityId: "verification-reset-recovery-staging", producerVersion: "ws07-recovery.v1", encryptionClass: "supabase-managed", retentionClass: "verification-audit", dataClassification: "restricted" as const, storageBucket: "ai-engineer-cloud-bucket", producerAttemptId: ids.attempt, missionId: ids.mission };
const candidate = (bytes: Uint8Array, mediaType: string, artifactType: "verification_bundle" | "verification_run_manifest", bucketClass: "candidate" | "ledger", parents: readonly string[] = []): RegisterContentAddressedVerificationArtifactInput => ({ ...artifactDefaults, bytes, mediaType, artifactType, bucketClass, parentArtifactIds: [...parents], ...(parents.length ? { transformationSignature: providerDigest({ kind: "verification_reset_recovery_assembly.v1", parents }) } : {}) });

async function main() {
  await Promise.all([
    requireFile(resolve(internal, "verification-local-reset-incident-22ed52a4-680f-4e6a-a70c-9f164278b9ac.json"), incidentDigest),
    requireFile(resolve(recoveryDirectory, "inventory.json"), recoveryInventoryDigest),
    requireFile(resolve(internal, "verification-benchmark-live-smoke-d6d4656f-3ce7-4563-a283-1bb422c658dc.json"), sourceReceiptDigest),
    requireFile(resolve(internal, "verification-benchmark-live-review-d9bec8ed-7380-449e-804d-08842436c7c8.json"), reviewDigest),
    requireFile(resolve(internal, "verification-reset-recovery-plan-e2231713-667c-4ec1-85e7-26902c1b47ee.json"), planDigest),
  ]);
  const inventory = JSON.parse(await readFile(resolve(recoveryDirectory, "inventory.json"), "utf8")) as Json;
  if (inventory.fileCount !== 597 || inventory.totalBytes !== 160066983 || !Array.isArray(inventory.files) || inventory.files.length !== 597) throw new Error("RECOVERY_INVENTORY_SHAPE_INVALID");
  let totalBytes = 0;
  for (const item of inventory.files as Json[]) {
    const bytes = await readFile(resolve(recoveryDirectory, String(item.path)));
    if (bytes.byteLength !== item.size || sha256Digest(bytes) !== `sha256:${item.sha256}`) throw new Error(`RECOVERY_PHYSICAL_BYTE_MISMATCH:${item.path}`);
    totalBytes += bytes.byteLength;
  }
  if (totalBytes !== inventory.totalBytes) throw new Error("RECOVERY_INVENTORY_TOTAL_MISMATCH");
  const originalReceipt = JSON.parse(await readFile(resolve(internal, "verification-benchmark-live-smoke-d6d4656f-3ce7-4563-a283-1bb422c658dc.json"), "utf8")) as Json;
  const review = JSON.parse(await readFile(resolve(internal, "verification-benchmark-live-review-d9bec8ed-7380-449e-804d-08842436c7c8.json"), "utf8")) as Json;
  const { dataset, authority } = await loadDiagnosticsProviderGrant(catalogDirectory);
  VerificationBenchmarkDatasetSchema.parse(dataset);
  const testCase = dataset.cases.find((item) => item.caseId === originalReceipt.caseId);
  if (!testCase || testCase.caseId !== "tru-turnaround-product-mutated" || review.passed !== true || review.providerDispatches !== 0 || review.accountingWrites !== 0) throw new Error("RECOVERY_SMOKE_RECEIPT_BINDING_INVALID");
  const sourceManifestBytes = await readFile(resolve(sourcePreparationDirectory, "manifest.json"));
  if (sha256Digest(sourceManifestBytes) !== dataset.sourcePreparationDigest) throw new Error("RECOVERY_SOURCE_PREPARATION_DIGEST_MISMATCH");
  const sourceManifest = JSON.parse(sourceManifestBytes.toString("utf8")) as Json;
  const sourceArtifactIds = (sourceManifest.artifacts as Json[]).map((item) => String(item.handle.artifactId));
  if (sourceArtifactIds.length !== 82 || new Set(sourceArtifactIds).size !== 82 || (sourceManifest.captures as Json[]).length !== 16 || (sourceManifest.artifacts as Json[]).some((item) => item.handle.tenantId !== sourceTenantId)) throw new Error("RECOVERY_SOURCE_SCOPE_INVALID");

  const fileByDigest = new Map<string, Json[]>();
  for (const item of inventory.files as Json[]) fileByDigest.set(String(item.sha256), [...(fileByDigest.get(String(item.sha256)) ?? []), item]);
  const recoveredBytes = async (digest: Digest) => {
    const entries = fileByDigest.get(digest.slice(7)) ?? [];
    if (entries.length !== 1) throw new Error(`RECOVERY_PHYSICAL_MATCH_COUNT:${digest}:${entries.length}`);
    return readFile(resolve(recoveryDirectory, String(entries[0]!.path)));
  };
  const profiles = {
    "gateway-luna": { role: "luna_extractor", provider: "gateway", model: "openai/gpt-5.6-luna", reservationCostMicros: 5_000, actualCostMicros: 229 },
    "gateway-haiku": { role: "haiku_judge", provider: "gateway", model: "anthropic/claude-haiku-4.5", reservationCostMicros: 20_000, actualCostMicros: 2_131 },
    "interfaze": { role: "interfaze_extractor", provider: "interfaze", model: "interfaze-beta", reservationCostMicros: 50_000, actualCostMicros: null },
  } as const;
  const wrapperInputs: RegisterContentAddressedVerificationArtifactInput[] = [], observationMaterials: Omit<DiagnosticsBenchmarkProviderObservation, "observationDigest">[] = [];
  for (const observed of review.observations as Json[]) {
    const profile = profiles[observed.name as keyof typeof profiles];
    const receiptRecord = (originalReceipt.records as Json[]).find((item) => item.name === observed.name);
    if (!profile || !receiptRecord) throw new Error("RECOVERY_PROVIDER_RECORD_MISSING");
    const requestDigest = observed.requestDigest as Digest, rawDigest = observed.rawDigest as Digest, envelopeDigest = observed.envelopeDigest as Digest;
    const [requestBytes, rawBytes, envelopeBytes] = await Promise.all([recoveredBytes(requestDigest), recoveredBytes(rawDigest), recoveredBytes(envelopeDigest)]);
    assertDiagnosticsProviderWireRequest(testCase, authority, requestBytes, { provider: profile.provider, model: profile.model });
    const raw = JSON.parse(rawBytes.toString("utf8")) as Json, envelope = JSON.parse(envelopeBytes.toString("utf8")) as Json;
    const parsedOutput = JSON.parse(String(raw.choices?.[0]?.message?.content)) as unknown;
    const output = profile.role === "haiku_judge" ? SemanticJudgeOutputSchema.parse(parsedOutput) : DiagnosticsBenchmarkSupportOutputSchema.parse(parsedOutput);
    if (verificationBenchmarkDigest(output) !== verificationBenchmarkDigest(observed.output) || envelope.schemaVersion !== "verification-provider-response-envelope.v1" || envelope.requestDigest !== requestDigest || envelope.rawResponseDigest !== rawDigest || envelope.requestArtifactId !== receiptRecord.requestArtifactId || envelope.rawResponseArtifactId !== receiptRecord.rawResponseArtifactId) throw new Error(`RECOVERY_PROVIDER_CHAIN_INVALID:${observed.name}`);
    const wrapper = { schemaVersion: "verification-reset-recovery-wire-wrapper.v1", custody: { incidentDigest, recoveryInventoryDigest, sourceReceiptDigest, reviewDigest, state: "recovered_bytes_original_registration_lost", stagedAt: sealedAt }, datasetManifestDigest: dataset.manifestDigest, caseId: testCase.caseId, caseDigest: testCase.caseDigest, provider: profile.provider, model: profile.model, role: profile.role, historicalArtifactIds: { request: receiptRecord.requestArtifactId, rawResponse: receiptRecord.rawResponseArtifactId, responseEnvelope: receiptRecord.responseEnvelopeArtifactId }, exactBytes: { request: { digest: requestDigest, base64: requestBytes.toString("base64") }, rawResponse: { digest: rawDigest, base64: rawBytes.toString("base64") }, responseEnvelope: { digest: envelopeDigest, base64: envelopeBytes.toString("base64") } }, parsedOutput: output, providerUsage: observed.providerUsage, limitation: "Original bytes under new recovery custody; lost database registration metadata is not reconstructed." };
    const wrapperInput = candidate(encode(wrapper), "application/vnd.aiengineer.verification-reset-recovery-wire-wrapper+json", "verification_bundle", "candidate");
    const wrapperHandle = createVerificationArtifactHandle(wrapperInput);
    wrapperInputs.push(wrapperInput);
    observationMaterials.push({ schemaVersion: "verification-benchmark-provider-observation.v1", caseId: testCase.caseId, caseDigest: testCase.caseDigest, role: profile.role, provider: profile.provider, model: profile.model, requestDigest, rawResponseDigest: rawDigest, envelopeDigest, output, promptTokens: Number.isInteger(observed.providerUsage?.prompt_tokens) ? observed.providerUsage.prompt_tokens : null, completionTokens: Number.isInteger(observed.providerUsage?.completion_tokens) ? observed.providerUsage.completion_tokens : null, actualCostMicros: profile.actualCostMicros, reservationCostMicros: profile.reservationCostMicros, latencyMs: null, costState: profile.actualCostMicros === null ? "unknown_dispatched" : "actual", runDisposition: "recorded_exact_reuse", capturedAt: sealedAt, custody: { state: "recovered_bytes_original_registration_lost", sourceReceiptDigest, recoveryInventoryDigest, recoveryWrapperArtifactId: wrapperHandle.artifactId } });
  }
  if (wrapperInputs.length !== 3) throw new Error("RECOVERY_PROVIDER_OBSERVATION_COUNT_INVALID");
  const observationInputs = observationMaterials.map((material) => {
    const observation = DiagnosticsBenchmarkProviderObservationSchema.parse({ ...material, observationDigest: verificationBenchmarkDigest(material) });
    return candidate(encode(observation), "application/vnd.aiengineer.verification-benchmark-provider-observation+json", "verification_bundle", "candidate", [observation.custody.recoveryWrapperArtifactId!]);
  });
  const liability = { schemaVersion: "verification-provider-pre-reset-liability.v1", incidentDigest, originalBudget: { tenantId: providerTenantId, budgetId: "7b3d7c52-3f9c-4594-9f4c-57be81c8fa58", budgetKey: "ws06-ws07-pilot", ceilingCostMicros: 20_000_000 }, settledMicros: 1_833, heldMicros: 2_070_000, totalLiabilityMicros: 2_071_833, haikuHoldReleased: false, interfazeBillingState: "unknown", sourceReceiptDigest, reviewDigest, recoveryInventoryDigest, recordedAt: sealedAt, limitation: "External liability record; the lost historical budget and provider-attempt rows are not reconstructed." };
  const liabilityInput = candidate(encode(liability), "application/vnd.aiengineer.verification-provider-pre-reset-liability+json", "verification_run_manifest", "ledger");
  const stagedInputs = [...wrapperInputs, ...observationInputs, liabilityInput];
  const stagedHandles = stagedInputs.map(createVerificationArtifactHandle);
  const custodyManifest = { schemaVersion: "verification-reset-recovery-custody-manifest.v1", incidentDigest, planDigest, recoveryInventoryDigest, sourceReceiptDigest, reviewDigest, datasetManifestDigest: dataset.manifestDigest, sourceImportScope: { tenantId: sourceTenantId, artifactIds: sourceArtifactIds, artifactCount: 82, captureCount: 16 }, recoveredProviderObservations: stagedHandles.slice(3, 6).map((handle, index) => ({ role: observationMaterials[index]!.role, artifactId: handle.artifactId, digest: handle.digest, wrapperArtifactId: stagedHandles[index]!.artifactId })), liabilityArtifact: { artifactId: stagedHandles[6]!.artifactId, digest: stagedHandles[6]!.digest }, successorBudget: { tenantId: providerTenantId, budgetId: budget.id, budgetKey: budget.key, ceilingCostMicros: budget.ceilingCostMicros }, accepted: false, sealedAt, limitations: ["The original local database metadata was lost.", "Historical provider-attempt rows are not reconstructed.", "V3 smoke remains protocol evidence and is not human-gold model-quality evidence."] };
  const custodyInput = candidate(encode(custodyManifest), "application/vnd.aiengineer.verification-reset-recovery-custody-manifest+json", "verification_run_manifest", "ledger", stagedHandles.map((item) => item.artifactId));
  stagedInputs.push(custodyInput); stagedHandles.push(createVerificationArtifactHandle(custodyInput));
  const writeSet = { schemaVersion: "verification-reset-recovery-write-set.v1", sealedAt, incidentDigest, providerTenantId, sourceTenantId, ids, budget, sourceArtifactIds, candidates: stagedHandles.map((handle, index) => ({ artifactId: handle.artifactId, digest: handle.digest, byteLength: handle.byteLength, mediaType: handle.mediaType, artifactType: stagedInputs[index]!.artifactType, bucketClass: stagedInputs[index]!.bucketClass })), custodyManifestArtifactId: stagedHandles.at(-1)!.artifactId, mutationPolicy: { idempotent: true, providerDispatches: 0, historicalProviderAttemptsInserted: 0, deletes: 0, resets: 0 } };
  const writeSetBytes = encode({ ...writeSet, writeSetDigest: verificationBenchmarkDigest(writeSet) });
  try { await writeFile(writeSetPath, writeSetBytes, { flag: "wx" }); } catch (error: any) { if (error?.code !== "EEXIST" || !Buffer.from(await readFile(writeSetPath)).equals(writeSetBytes)) throw error; }

  const postgresUrl = required("POSTGRES_URL"), supabaseUrl = required("SUPABASE_URL"), supabaseSecret = required("SUPABASE_SECRET_KEY");
  if (new URL(postgresUrl).port !== "54322" || new URL(supabaseUrl).port !== "54321") throw new Error("RECOVERY_REFUSED_NONLOCAL_TARGET");
  const database = new PostgresCanonicalRepository({ connectionString: postgresUrl, localOnly: true, connectionTimeoutMs: 3_000 });
  const artifactStore = new SupabaseArtifactStore({ projectUrl: supabaseUrl, serviceRoleKey: supabaseSecret, bucket: "ai-engineer-cloud-bucket", maximumBytes: 4_194_304 });
  const repository = new PostgresVerificationRepository(database, artifactStore, { async authorize() { throw new Error("RECOVERY_HYDRATION_NOT_USED"); } });
  const writeSetDigest = verificationBenchmarkDigest(writeSet), custodyHandleExpected = stagedHandles.at(-1)!;
  const missionGoal = "Accept staged WS-07 recovery custody without reconstructing lost provider attempts";
  const workSpec = { writeSetDigest, custodyManifestArtifactId: custodyHandleExpected.artifactId, providerDispatches: 0 };
  const terminalEvidence = { custodyManifestArtifactId: custodyHandleExpected.artifactId, custodyManifestDigest: custodyHandleExpected.digest };
  let lifecycleInitialized = false, alreadyAccepted = false;
  try {
    await database.transaction(sourceTenantId, async (client) => {
      const rows = (await client.query<{ id: string; storage_state: string }>("select id,storage_state from orchestration.artifact where tenant_id=$1 and id=any($2::uuid[])", [sourceTenantId, sourceArtifactIds])).rows;
      if (rows.length !== 82 || rows.some((row) => row.storage_state !== "available")) throw new Error("RECOVERY_SOURCE_REGISTRATIONS_CHANGED");
      const objects = Number((await client.query<{ count: string }>("select count(*)::text as count from orchestration.artifact a join storage.objects o on o.bucket_id=a.storage_bucket and o.name=a.object_path where a.tenant_id=$1 and a.id=any($2::uuid[])", [sourceTenantId, sourceArtifactIds])).rows[0]!.count);
      if (objects !== 82) throw new Error("RECOVERY_SOURCE_STORAGE_METADATA_CHANGED");
      const captures = Number((await client.query<{ count: string }>("select count(*)::text as count from evidence.source_capture where tenant_id=$1", [sourceTenantId])).rows[0]!.count);
      if (captures !== 16) throw new Error("RECOVERY_SOURCE_CAPTURE_SCOPE_CHANGED");
    });
    const executionStartedAt = new Date().toISOString();
    await database.transaction(providerTenantId, async (client) => {
      await client.query("insert into orchestration.mission(id,tenant_id,slug,goal,status,started_at) values($1,$2,$3,$4,'running',$5) on conflict(id) do nothing", [ids.mission, providerTenantId, "ws07-reset-recovery-20260905", missionGoal, executionStartedAt]);
      const mission = (await client.query<Json>("select id,tenant_id,slug,goal,status,started_at,ended_at from orchestration.mission where id=$1 for update", [ids.mission])).rows[0];
      if (!mission || mission.tenant_id !== providerTenantId || mission.slug !== "ws07-reset-recovery-20260905" || mission.goal !== missionGoal || !["running", "succeeded"].includes(mission.status)) throw new Error("RECOVERY_MISSION_IDENTITY_CONFLICT");
      alreadyAccepted = mission.status === "succeeded";
      await client.query("insert into orchestration.work_item(id,tenant_id,mission_id,kind,spec,status,max_attempts,attempt_count) values($1,$2,$3,'verify_claims',$4::jsonb,'pending',1,1) on conflict(id) do nothing", [ids.workItem, providerTenantId, ids.mission, canonicalizeJson(workSpec)]);
      const workItem = (await client.query<Json>("select id,tenant_id,mission_id,kind,spec,status,max_attempts,attempt_count,terminal_evidence from orchestration.work_item where id=$1 for update", [ids.workItem])).rows[0];
      if (!workItem || workItem.tenant_id !== providerTenantId || workItem.mission_id !== ids.mission || workItem.kind !== "verify_claims" || verificationBenchmarkDigest(workItem.spec) !== verificationBenchmarkDigest(workSpec) || Number(workItem.max_attempts) !== 1 || Number(workItem.attempt_count) !== 1 || !["pending", "succeeded"].includes(workItem.status) || (alreadyAccepted && verificationBenchmarkDigest(workItem.terminal_evidence) !== verificationBenchmarkDigest(terminalEvidence))) throw new Error("RECOVERY_WORK_ITEM_IDENTITY_CONFLICT");
      await client.query("insert into orchestration.attempt(id,tenant_id,work_item_id,attempt_no,agent_deployment_id,started_at) values($1,$2,$3,1,'verification-reset-recovery',$4) on conflict(id) do nothing", [ids.attempt, providerTenantId, ids.workItem, executionStartedAt]);
      const attempt = (await client.query<Json>("select id,tenant_id,work_item_id,attempt_no,agent_deployment_id,outcome,started_at,ended_at from orchestration.attempt where id=$1 for update", [ids.attempt])).rows[0];
      if (!attempt || attempt.tenant_id !== providerTenantId || attempt.work_item_id !== ids.workItem || Number(attempt.attempt_no) !== 1 || attempt.agent_deployment_id !== "verification-reset-recovery" || (alreadyAccepted ? attempt.outcome !== "succeeded" || attempt.ended_at === null : attempt.outcome !== null || attempt.ended_at !== null)) throw new Error("RECOVERY_ATTEMPT_IDENTITY_CONFLICT");
      lifecycleInitialized = true;
    });
    const registered: VerificationArtifactHandle[] = [];
    for (const input of stagedInputs) registered.push(await repository.registerContentAddressedArtifact(input));
    if (registered.some((handle, index) => handle.artifactId !== stagedHandles[index]!.artifactId || handle.digest !== stagedHandles[index]!.digest)) throw new Error("RECOVERY_STAGED_HANDLE_MISMATCH");
    const custodyHandle = registered.at(-1)!;
    let acceptedAt = "";
    await database.transaction(providerTenantId, async (client) => {
      await client.query("insert into orchestration.verification_provider_budget(id,tenant_id,budget_key,ceiling_cost_micros) values($1,$2,$3,$4) on conflict do nothing", [budget.id, providerTenantId, budget.key, budget.ceilingCostMicros]);
      const budgetRow = (await client.query<Json>("select id,budget_key,ceiling_cost_micros,reserved_cost_micros,settled_cost_micros from orchestration.verification_provider_budget where tenant_id=$1 and budget_key=$2 for update", [providerTenantId, budget.key])).rows[0];
      if (!budgetRow || budgetRow.id !== budget.id || Number(budgetRow.ceiling_cost_micros) !== budget.ceilingCostMicros || Number(budgetRow.reserved_cost_micros) !== 0 || Number(budgetRow.settled_cost_micros) !== 0) throw new Error("RECOVERY_SUCCESSOR_BUDGET_CONFLICT");
      for (const handle of registered) await client.query("insert into orchestration.work_item_artifact(work_item_id,artifact_id,role) values($1,$2,'produced') on conflict do nothing", [ids.workItem, handle.artifactId]);
      await client.query("insert into orchestration.artifact_manifest(id,mission_id,work_item_id,produced) values($1,$2,$3,$4::jsonb) on conflict(id) do nothing", [ids.artifactManifest, ids.mission, ids.workItem, canonicalizeJson(registered.map((handle) => ({ artifactId: handle.artifactId, digest: handle.digest })))]);
      const manifest = (await client.query<Json>("select id,mission_id,work_item_id,produced from orchestration.artifact_manifest where id=$1 for update", [ids.artifactManifest])).rows[0];
      const expectedProduced = registered.map((handle) => ({ artifactId: handle.artifactId, digest: handle.digest }));
      if (!manifest || manifest.mission_id !== ids.mission || manifest.work_item_id !== ids.workItem || verificationBenchmarkDigest(manifest.produced) !== verificationBenchmarkDigest(expectedProduced)) throw new Error("RECOVERY_ARTIFACT_MANIFEST_IDENTITY_CONFLICT");
      const links = (await client.query<{ artifact_id: string }>("select artifact_id from orchestration.work_item_artifact where work_item_id=$1 and role='produced' order by artifact_id", [ids.workItem])).rows.map((row) => row.artifact_id);
      if (links.length !== registered.length || links.join(",") !== registered.map((handle) => handle.artifactId).sort().join(",")) throw new Error("RECOVERY_ACCEPTED_ARTIFACT_LINKS_INCOMPLETE");
      if (!alreadyAccepted) {
        acceptedAt = String((await client.query<{ accepted_at: string }>("select clock_timestamp()::text as accepted_at")).rows[0]!.accepted_at);
        await client.query("update orchestration.attempt set outcome='succeeded',ended_at=$2 where id=$1 and outcome is null and ended_at is null", [ids.attempt, acceptedAt]);
        await client.query("update orchestration.work_item set status='succeeded',terminal_evidence=$2::jsonb where id=$1 and status='pending'", [ids.workItem, canonicalizeJson(terminalEvidence)]);
        await client.query("update orchestration.mission set status='succeeded',ended_at=$2 where id=$1 and status='running'", [ids.mission, acceptedAt]);
      }
      const lifecycle = (await client.query<Json>("select m.status,m.ended_at,w.status as work_status,w.terminal_evidence,a.outcome,a.ended_at as attempt_ended_at from orchestration.mission m join orchestration.work_item w on w.mission_id=m.id join orchestration.attempt a on a.work_item_id=w.id where m.id=$1 and w.id=$2 and a.id=$3", [ids.mission, ids.workItem, ids.attempt])).rows[0];
      if (!lifecycle || lifecycle.status !== "succeeded" || lifecycle.work_status !== "succeeded" || lifecycle.outcome !== "succeeded" || lifecycle.ended_at === null || lifecycle.attempt_ended_at === null || verificationBenchmarkDigest(lifecycle.terminal_evidence) !== verificationBenchmarkDigest(terminalEvidence)) throw new Error("RECOVERY_LIFECYCLE_ACCEPTANCE_INVALID");
      acceptedAt = new Date(lifecycle.ended_at).toISOString();
    });
    const hydratedBytes: Uint8Array[] = [];
    for (const handle of registered) {
      const bytes = await artifactStore.get(providerTenantId, handle.digest as Digest);
      if (!bytes || bytes.byteLength !== handle.byteLength || sha256Digest(bytes) !== handle.digest) throw new Error(`RECOVERY_REGISTERED_HYDRATION_FAILED:${handle.artifactId}`);
      hydratedBytes.push(bytes);
    }
    const replayed = [];
    for (let index = 0; index < 3; index++) {
      const wrapper = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(hydratedBytes[index]!)) as Json;
      const observation = DiagnosticsBenchmarkProviderObservationSchema.parse(JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(hydratedBytes[index + 3]!)));
      if (observation.custody.recoveryWrapperArtifactId !== registered[index]!.artifactId || verificationBenchmarkDigest(omitDigest(observation as unknown as Record<string, unknown>)) !== observation.observationDigest) throw new Error("RECOVERY_OBSERVATION_REPLAY_BINDING_INVALID");
      for (const key of ["request", "rawResponse", "responseEnvelope"] as const) {
        const decoded = Buffer.from(String(wrapper.exactBytes[key].base64), "base64"), expected = wrapper.exactBytes[key].digest as Digest;
        if (sha256Digest(decoded) !== expected) throw new Error(`RECOVERY_WRAPPER_BYTE_REPLAY_FAILED:${observation.role}:${key}`);
      }
      const requestBytes = Buffer.from(String(wrapper.exactBytes.request.base64), "base64");
      assertDiagnosticsProviderWireRequest(testCase, authority, requestBytes, { provider: observation.provider, model: observation.model });
      if (verificationBenchmarkDigest(wrapper.parsedOutput) !== verificationBenchmarkDigest(observation.output)) throw new Error("RECOVERY_WRAPPER_OUTPUT_REPLAY_FAILED");
      replayed.push({ role: observation.role, artifactId: registered[index + 3]!.artifactId, digest: registered[index + 3]!.digest, observationDigest: observation.observationDigest, wrapperArtifactId: registered[index]!.artifactId, requestDigest: observation.requestDigest, rawResponseDigest: observation.rawResponseDigest, envelopeDigest: observation.envelopeDigest });
    }
    const accountingSnapshot = await database.transaction(providerTenantId, async (client) => {
      const currentBudget = (await client.query<Json>("select id,tenant_id,budget_key,ceiling_cost_micros,reserved_cost_micros,settled_cost_micros,created_at from orchestration.verification_provider_budget where tenant_id=$1 and id=$2", [providerTenantId, budget.id])).rows[0];
      const attempts = Number((await client.query<{ count: string }>("select count(*)::text as count from orchestration.verification_provider_attempt where tenant_id=$1", [providerTenantId])).rows[0]!.count);
      const originalBudgets = Number((await client.query<{ count: string }>("select count(*)::text as count from orchestration.verification_provider_budget where tenant_id=$1 and budget_key='ws06-ws07-pilot'", [providerTenantId])).rows[0]!.count);
      if (!currentBudget || attempts !== 0 || originalBudgets !== 0) throw new Error("RECOVERY_ACCOUNTING_SNAPSHOT_INVALID");
      return { budget: currentBudget, providerAttemptCount: attempts, originalBudgetRowCount: originalBudgets, externalLiability: liability };
    });
    const replayPack = { schemaVersion: "verification-reset-recovery-offline-replay-pack.v1", acceptedAt, incidentDigest, writeSetDigest, datasetManifestDigest: dataset.manifestDigest, caseId: testCase.caseId, registeredHandles: registered, wrappers: hydratedBytes.slice(0, 3).map((bytes) => JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes))), observations: hydratedBytes.slice(3, 6).map((bytes) => JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes))), liability: JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(hydratedBytes[6]!)), custodyManifest: JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(hydratedBytes[7]!)), accountingSnapshot, replayed, providerDispatches: 0, secretsIncluded: false };
    const replayPackBytes = new TextEncoder().encode(`${JSON.stringify(replayPack, null, 2)}\n`);
    try { await writeFile(replayPackPath, replayPackBytes, { flag: "wx" }); } catch (error: any) { if (error?.code !== "EEXIST" || !Buffer.from(await readFile(replayPackPath)).equals(replayPackBytes)) throw error; }
    const receipt = { schemaVersion: "verification-reset-recovery-receipt.v1", completedAt: acceptedAt, incidentDigest, writeSetPath, writeSetDigest, recoveryInventoryDigest, sourceScope: { tenantId: sourceTenantId, artifactCount: 82, storageObjectCount: 82, captureCount: 16 }, custodyManifest: { artifactId: custodyHandle.artifactId, digest: custodyHandle.digest }, stagedArtifactCount: registered.length, recoveredObservations: replayed, offlineReplayPack: { path: replayPackPath, digest: sha256Digest(replayPackBytes), byteLength: replayPackBytes.byteLength }, successorBudget: { tenantId: providerTenantId, ...budget, reservedCostMicros: 0, settledCostMicros: 0 }, historicalProviderAttemptsInserted: 0, providerDispatches: 0, liabilities: { settledMicros: 1_833, heldMicros: 2_070_000, totalMicros: 2_071_833, haikuHoldReleased: false }, limitations: ["Original database registrations were lost and are not claimed as restored.", "The three smoke calls remain v3 protocol evidence.", "V4 dataset persistence is excluded pending separate manifest and diff review."] };
    const receiptBytes = new TextEncoder().encode(`${JSON.stringify(receipt, null, 2)}\n`);
    try { await access(receiptPath); const prior = await readFile(receiptPath); if (!prior.equals(receiptBytes)) throw new Error("RECOVERY_RECEIPT_REENTRY_CONFLICT"); } catch (error: any) { if (error?.code === "ENOENT") await writeFile(receiptPath, receiptBytes, { flag: "wx" }); else throw error; }
    process.stdout.write(`${JSON.stringify({ receiptPath, receiptSha256: createHash("sha256").update(receiptBytes).digest("hex"), custodyManifestArtifactId: custodyHandle.artifactId, stagedArtifactCount: registered.length, successorBudget: receipt.successorBudget, providerDispatches: 0 }, null, 2)}\n`);
  } catch (error) {
    if (lifecycleInitialized && !alreadyAccepted) {
      const failedAt = new Date().toISOString();
      await database.transaction(providerTenantId, async (client) => {
        await client.query("update orchestration.attempt set outcome='failed',ended_at=$2 where id=$1 and outcome is null and ended_at is null", [ids.attempt, failedAt]);
        await client.query("update orchestration.work_item set status='failed',terminal_evidence=$2::jsonb where id=$1 and status='pending'", [ids.workItem, canonicalizeJson({ errorClass: error instanceof Error ? error.message : "UNKNOWN_RECOVERY_FAILURE", candidateArtifactIds: stagedHandles.map((item) => item.artifactId) })]);
        await client.query("update orchestration.mission set status='failed',terminal_reason=$2,ended_at=$3 where id=$1 and status='running'", [ids.mission, error instanceof Error ? error.message.slice(0, 500) : "UNKNOWN_RECOVERY_FAILURE", failedAt]);
      }).catch(() => undefined);
    }
    throw error;
  } finally { await database.close(); }
}

await main();
