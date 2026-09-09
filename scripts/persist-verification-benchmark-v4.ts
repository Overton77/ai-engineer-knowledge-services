import { createHash } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { VerificationBenchmarkDatasetSchema, type VerificationArtifactHandle } from "@aiengineer/knowledge-contracts";
import { assertFrozenVerificationBenchmarkDataset, verificationBenchmarkDigest } from "../packages/evaluation/dist/index.js";
import { createVerificationArtifactHandle, PostgresCanonicalRepository, PostgresVerificationRepository, type RegisterContentAddressedVerificationArtifactInput } from "@aiengineer/knowledge-persistence";
import { deterministicUuid, SupabaseArtifactStore } from "@aiengineer/knowledge-runtime";
import { canonicalizeJson, providerDigest, sha256Digest } from "@aiengineer/knowledge-verification";

type Json = Record<string, any>;
const root = resolve(import.meta.dirname, "..");
const workspace = resolve(root, "..");
const catalog = resolve(root, "catalog/verification-benchmarks/diagnostics-companies-pilot-v4");
const internal = resolve(workspace, "internal");
const tenantId = "6d057f43-6aaf-48d9-b3ba-374169abb989";
const datasetSeal = "sha256:a6bc1cf3ecbb335e4f5ef49165798d29ce937a9324f2a1ba7d9768f23ad7feee" as const;
const catalogSeal = "sha256:f86c5a28f352d9714945cd2fc14f536a0ca25491e0ca5264267d135b71cd5a92" as const;
const catalogFileDigest = "sha256:7e15210f5d59d5afb458208549b9606b9ca71bf3946b6a3b409c4161aef43af3" as const;
const reviewDigest = "sha256:a81a2109edc9ae1cc50b3f0d6749a903c31d5d627909efb396cce3e986401c0e" as const;
const receiptPath = resolve(internal, "verification-benchmark-v4-persistence-receipt-a6bc1cf3-ecbb-435e-8f5e-f49165798d29.json");
const replayPath = resolve(internal, "verification-benchmark-v4-replay-pack-a6bc1cf3-ecbb-435e-8f5e-f49165798d29.json");
const ids = { dataset: deterministicUuid("verification-benchmark", `${tenantId}:diagnostics-companies`), version: deterministicUuid("verification-benchmark", `${tenantId}:${datasetSeal}:dataset-version`), mission: deterministicUuid("verification-benchmark", `${tenantId}:${datasetSeal}:mission`), workItem: deterministicUuid("verification-benchmark", `${tenantId}:${datasetSeal}:work-item`), attempt: deterministicUuid("verification-benchmark", `${tenantId}:${datasetSeal}:attempt`), artifactManifest: deterministicUuid("verification-benchmark", `${tenantId}:${datasetSeal}:artifact-manifest`) };
const required = (name: string) => { const value = process.env[name]?.trim(); if (!value) throw new Error(`V4_PERSIST_${name}_MISSING`); return value; };
const fileDigest = async (path: string) => `sha256:${createHash("sha256").update(await readFile(path)).digest("hex")}` as const;
const writeOnce = async (path: string, bytes: Uint8Array) => { try { await access(path); if (!Buffer.from(await readFile(path)).equals(bytes)) throw new Error(`IMMUTABLE_OUTPUT_CONFLICT:${path}`); } catch (error: any) { if (error?.code === "ENOENT") await writeFile(path, bytes, { flag: "wx" }); else throw error; } };

async function main() {
  const [datasetBytes, manifestBytes, registryBytes] = await Promise.all([readFile(resolve(catalog, "dataset.json")), readFile(resolve(catalog, "manifest.json")), readFile(resolve(catalog, "case-artifact-registry.json"))]);
  if (await fileDigest(resolve(catalog, "manifest.json")) !== catalogFileDigest || await fileDigest(resolve(internal, "verification-benchmark-v4-review-b4b84a37-fb2b-4509-af6d-102ba09f0006.json")) !== reviewDigest) throw new Error("V4_PERSIST_REVIEW_OR_CATALOG_FILE_MISMATCH");
  const dataset = VerificationBenchmarkDatasetSchema.parse(JSON.parse(datasetBytes.toString("utf8"))), manifest = JSON.parse(manifestBytes.toString("utf8")) as Json, registry = JSON.parse(registryBytes.toString("utf8")) as Json;
  assertFrozenVerificationBenchmarkDataset(dataset);
  if (dataset.manifestDigest !== datasetSeal || manifest.manifestDigest !== catalogSeal || registry.datasetManifestDigest !== datasetSeal || registry.tenantId !== tenantId || !Array.isArray(registry.artifacts) || registry.artifacts.length !== 86) throw new Error("V4_PERSIST_SEAL_MISMATCH");
  const createdAt = dataset.sealedAt;
  const common = { tenantId, createdAt, producerActivityId: "verification-benchmark-v4-freeze", producerVersion: "verification-benchmark-catalog.v4", encryptionClass: "supabase-managed", retentionClass: "verification-audit", dataClassification: "restricted" as const, storageBucket: "ai-engineer-cloud-bucket", producerAttemptId: ids.attempt, missionId: ids.mission };
  const staged: RegisterContentAddressedVerificationArtifactInput[] = [];
  for (const item of registry.artifacts as Json[]) {
    const bytes = await readFile(resolve(catalog, String(item.file))), expected = item.handle as VerificationArtifactHandle;
    if (sha256Digest(bytes) !== expected.digest || bytes.byteLength !== expected.byteLength || expected.artifactId !== deterministicUuid("artifact", `${tenantId}:${expected.digest}`)) throw new Error(`V4_PERSIST_ARTIFACT_MISMATCH:${item.caseId}:${item.role}`);
    const inputId = registry.artifacts.find((candidate: Json) => candidate.caseId === item.caseId && candidate.role === "case_input")?.handle.artifactId;
    staged.push({ ...common, bytes, mediaType: expected.mediaType, artifactType: "evaluation_case_input", bucketClass: item.role === "case_input" ? "candidate" : "ledger", parentArtifactIds: item.role === "engineering_expectation" ? [inputId] : [], ...(item.role === "engineering_expectation" ? { transformationSignature: providerDigest({ kind: "verification_benchmark_engineering_expectation.v1", sourceDatasetManifestDigest: registry.sourceDatasetManifestDigest, caseId: item.caseId, inputArtifactId: inputId }) } : {}) });
  }
  const datasetManifestInput: RegisterContentAddressedVerificationArtifactInput = { ...common, bytes: datasetBytes, mediaType: "application/vnd.aiengineer.verification-benchmark-dataset+json", artifactType: "evaluation_dataset_manifest", bucketClass: "ledger", parentArtifactIds: [], transformationSignature: providerDigest({ kind: "verification_benchmark_dataset_manifest.v4", semanticManifestDigest: datasetSeal, catalogManifestDigest: catalogSeal }) };
  staged.push(datasetManifestInput);
  const expectedHandles = staged.map(createVerificationArtifactHandle), datasetManifestHandle = expectedHandles.at(-1)!;
  if (datasetManifestHandle.digest !== sha256Digest(datasetBytes)) throw new Error("V4_PERSIST_RAW_MANIFEST_DIGEST_MISMATCH");

  const postgresUrl = required("POSTGRES_URL"), supabaseUrl = required("SUPABASE_URL"), secret = required("SUPABASE_SECRET_KEY");
  if (new URL(postgresUrl).port !== "54322" || new URL(supabaseUrl).port !== "54321") throw new Error("V4_PERSIST_REFUSED_NONLOCAL_TARGET");
  const database = new PostgresCanonicalRepository({ connectionString: postgresUrl, localOnly: true, connectionTimeoutMs: 3_000 });
  const store = new SupabaseArtifactStore({ projectUrl: supabaseUrl, serviceRoleKey: secret, bucket: "ai-engineer-cloud-bucket", maximumBytes: 4_194_304 });
  const repository = new PostgresVerificationRepository(database, store, { async authorize() { throw new Error("V4_PERSIST_HYDRATION_AUTHORIZATION_UNUSED"); } });
  let initialized = false, accepted = false;
  try {
    const executionStartedAt = new Date().toISOString(), workSpec = { datasetManifestDigest: datasetSeal, catalogManifestDigest: catalogSeal, artifactCount: staged.length };
    await database.transaction(tenantId, async (client) => {
      await client.query("insert into orchestration.mission(id,tenant_id,slug,goal,status,started_at) values($1,$2,'verification-benchmark-v4-freeze','Persist accepted immutable V4 benchmark artifacts and canonical dataset rows','running',$3) on conflict(id) do nothing", [ids.mission, tenantId, executionStartedAt]);
      const mission = (await client.query<Json>("select * from orchestration.mission where id=$1 for update", [ids.mission])).rows[0];
      if (!mission || mission.tenant_id !== tenantId || mission.slug !== "verification-benchmark-v4-freeze" || mission.goal !== "Persist accepted immutable V4 benchmark artifacts and canonical dataset rows" || !["running", "succeeded"].includes(mission.status)) throw new Error("V4_PERSIST_MISSION_CONFLICT");
      accepted = mission.status === "succeeded";
      await client.query("insert into orchestration.work_item(id,tenant_id,mission_id,kind,spec,status,max_attempts,attempt_count) values($1,$2,$3,'synthesize_report',$4::jsonb,'pending',1,1) on conflict(id) do nothing", [ids.workItem, tenantId, ids.mission, canonicalizeJson(workSpec)]);
      const work = (await client.query<Json>("select * from orchestration.work_item where id=$1 for update", [ids.workItem])).rows[0];
      if (!work || work.tenant_id !== tenantId || work.mission_id !== ids.mission || work.kind !== "synthesize_report" || verificationBenchmarkDigest(work.spec) !== verificationBenchmarkDigest(workSpec) || Number(work.max_attempts) !== 1 || Number(work.attempt_count) !== 1 || !["pending", "succeeded"].includes(work.status)) throw new Error("V4_PERSIST_WORK_ITEM_CONFLICT");
      await client.query("insert into orchestration.attempt(id,tenant_id,work_item_id,attempt_no,agent_deployment_id,started_at) values($1,$2,$3,1,'verification-benchmark-v4-persistence',$4) on conflict(id) do nothing", [ids.attempt, tenantId, ids.workItem, executionStartedAt]);
      const attempt = (await client.query<Json>("select * from orchestration.attempt where id=$1 for update", [ids.attempt])).rows[0];
      if (!attempt || attempt.tenant_id !== tenantId || attempt.work_item_id !== ids.workItem || Number(attempt.attempt_no) !== 1 || attempt.agent_deployment_id !== "verification-benchmark-v4-persistence" || (accepted ? attempt.outcome !== "succeeded" || attempt.ended_at === null : attempt.outcome !== null || attempt.ended_at !== null)) throw new Error("V4_PERSIST_ATTEMPT_CONFLICT");
      initialized = true;
    });
    const handles: VerificationArtifactHandle[] = [];
    for (const input of staged) handles.push(await repository.registerContentAddressedArtifact(input));
    if (handles.some((item, index) => item.artifactId !== expectedHandles[index]!.artifactId || item.digest !== expectedHandles[index]!.digest)) throw new Error("V4_PERSIST_REGISTERED_HANDLE_MISMATCH");
    let acceptedAt = "";
    await database.transaction(tenantId, async (client) => {
      await client.query("insert into evaluation.eval_dataset(id,tenant_id,slug,purpose,description) values($1,$2,'diagnostics-companies','Verification diagnostics benchmark','Frozen Pilot V4 with agent engineering expectations; human review pending') on conflict(id) do nothing", [ids.dataset, tenantId]);
      const rootRow = (await client.query<Json>("select * from evaluation.eval_dataset where id=$1 for update", [ids.dataset])).rows[0];
      if (!rootRow || rootRow.tenant_id !== tenantId || rootRow.slug !== "diagnostics-companies") throw new Error("V4_PERSIST_DATASET_IDENTITY_CONFLICT");
      const manifestMetadata = { artifactId: datasetManifestHandle.artifactId, rawByteDigest: datasetManifestHandle.digest, semanticManifestDigest: datasetSeal, catalogManifestDigest: catalogSeal };
      await client.query(`insert into evaluation.eval_dataset_version(id,tenant_id,dataset_id,version,manifest_sha256,manifest,contract_version,manifest_artifact_id,frozen_at,label_provenance,case_count) values($1,$2,$3,4,$4,$5::jsonb,'verification.v1',$6,$7,'agent_generated',$8) on conflict(id) do nothing`, [ids.version, tenantId, ids.dataset, datasetManifestHandle.digest.slice(7), canonicalizeJson(manifestMetadata), datasetManifestHandle.artifactId, dataset.sealedAt, dataset.cases.length]);
      const version = (await client.query<Json>("select * from evaluation.eval_dataset_version where id=$1 for update", [ids.version])).rows[0];
      if (!version || version.tenant_id !== tenantId || version.dataset_id !== ids.dataset || Number(version.version) !== 4 || version.manifest_sha256 !== datasetManifestHandle.digest.slice(7) || version.manifest_artifact_id !== datasetManifestHandle.artifactId || version.contract_version !== "verification.v1" || version.label_provenance !== "agent_generated" || new Date(version.frozen_at).toISOString() !== dataset.sealedAt || Number(version.case_count) !== dataset.cases.length || verificationBenchmarkDigest(version.manifest) !== verificationBenchmarkDigest(manifestMetadata)) throw new Error("V4_PERSIST_DATASET_VERSION_CONFLICT");
      for (const testCase of dataset.cases) {
        const caseId = deterministicUuid("verification-benchmark-case", `${ids.version}:${testCase.caseId}`);
        await client.query(`insert into evaluation.eval_case(id,tenant_id,dataset_id,external_key,input,expected,metadata,dataset_version_id,verification_contract_version,input_manifest_artifact_id,gold_artifact_id,case_sha256) values($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,'verification.v1',$9,$10,$11) on conflict(id) do nothing`, [caseId, tenantId, ids.dataset, testCase.caseId, canonicalizeJson({ assertion: testCase.assertion, evidence: testCase.evidence, inputManifestArtifactId: testCase.inputManifestArtifactId }), canonicalizeJson({ expectation: testCase.expectation, engineeringExpectationArtifactId: testCase.goldArtifactId, humanGoldScoringEligible: false }), canonicalizeJson({ partition: testCase.partition, sourceFamily: testCase.sourceFamily, entityFamily: testCase.entityFamily, reportCluster: testCase.reportCluster, pairCluster: testCase.pairCluster, independentObservation: testCase.independentObservation }), ids.version, testCase.inputManifestArtifactId, testCase.goldArtifactId, testCase.caseDigest.slice(7)]);
      }
      const rows = (await client.query<Json>("select * from evaluation.eval_case where tenant_id=$1 and dataset_version_id=$2 order by external_key", [tenantId, ids.version])).rows;
      if (rows.length !== dataset.cases.length || rows.some((row) => {
        const expected = dataset.cases.find((item) => item.caseId === row.external_key); if (!expected) return true;
        const expectedInput = { assertion: expected.assertion, evidence: expected.evidence, inputManifestArtifactId: expected.inputManifestArtifactId };
        const expectedOutput = { expectation: expected.expectation, engineeringExpectationArtifactId: expected.goldArtifactId, humanGoldScoringEligible: false };
        const expectedMetadata = { partition: expected.partition, sourceFamily: expected.sourceFamily, entityFamily: expected.entityFamily, reportCluster: expected.reportCluster, pairCluster: expected.pairCluster, independentObservation: expected.independentObservation };
        return row.tenant_id !== tenantId || row.dataset_id !== ids.dataset || row.dataset_version_id !== ids.version || row.input_manifest_artifact_id !== expected.inputManifestArtifactId || row.gold_artifact_id !== expected.goldArtifactId || row.case_sha256 !== expected.caseDigest.slice(7) || row.verification_contract_version !== "verification.v1" || verificationBenchmarkDigest(row.input) !== verificationBenchmarkDigest(expectedInput) || verificationBenchmarkDigest(row.expected) !== verificationBenchmarkDigest(expectedOutput) || verificationBenchmarkDigest(row.metadata) !== verificationBenchmarkDigest(expectedMetadata);
      })) throw new Error("V4_PERSIST_CASE_MATRIX_CONFLICT");
      for (const item of handles) await client.query("insert into orchestration.work_item_artifact(work_item_id,artifact_id,role) values($1,$2,'produced') on conflict do nothing", [ids.workItem, item.artifactId]);
      const produced = handles.map((item) => ({ artifactId: item.artifactId, digest: item.digest }));
      await client.query("insert into orchestration.artifact_manifest(id,mission_id,work_item_id,produced) values($1,$2,$3,$4::jsonb) on conflict(id) do nothing", [ids.artifactManifest, ids.mission, ids.workItem, canonicalizeJson(produced)]);
      const artifactManifest = (await client.query<Json>("select * from orchestration.artifact_manifest where id=$1 for update", [ids.artifactManifest])).rows[0];
      if (!artifactManifest || artifactManifest.mission_id !== ids.mission || artifactManifest.work_item_id !== ids.workItem || verificationBenchmarkDigest(artifactManifest.produced) !== verificationBenchmarkDigest(produced)) throw new Error("V4_PERSIST_ARTIFACT_MANIFEST_CONFLICT");
      const links = Number((await client.query<{ count: string }>("select count(*)::text as count from orchestration.work_item_artifact where work_item_id=$1 and role='produced'", [ids.workItem])).rows[0]!.count);
      if (links !== handles.length) throw new Error("V4_PERSIST_ARTIFACT_LINK_COUNT_INVALID");
      if (!accepted) {
        acceptedAt = String((await client.query<{ value: string }>("select clock_timestamp()::text as value")).rows[0]!.value);
        await client.query("update orchestration.attempt set outcome='succeeded',ended_at=$2 where id=$1 and outcome is null", [ids.attempt, acceptedAt]);
        await client.query("update orchestration.work_item set status='succeeded',terminal_evidence=$2::jsonb where id=$1 and status='pending'", [ids.workItem, canonicalizeJson({ datasetVersionId: ids.version, datasetManifestArtifactId: datasetManifestHandle.artifactId, semanticManifestDigest: datasetSeal })]);
        await client.query("update orchestration.mission set status='succeeded',ended_at=$2 where id=$1 and status='running'", [ids.mission, acceptedAt]);
      }
      const lifecycle = (await client.query<Json>("select m.status,m.ended_at,w.status as work_status,w.terminal_evidence,a.outcome,a.ended_at as attempt_ended_at from orchestration.mission m join orchestration.work_item w on w.id=$2 join orchestration.attempt a on a.id=$3 where m.id=$1", [ids.mission, ids.workItem, ids.attempt])).rows[0];
      const expectedTerminal = { datasetVersionId: ids.version, datasetManifestArtifactId: datasetManifestHandle.artifactId, semanticManifestDigest: datasetSeal };
      if (!lifecycle || lifecycle.status !== "succeeded" || lifecycle.ended_at === null || lifecycle.work_status !== "succeeded" || verificationBenchmarkDigest(lifecycle.terminal_evidence) !== verificationBenchmarkDigest(expectedTerminal) || lifecycle.outcome !== "succeeded" || lifecycle.attempt_ended_at === null) throw new Error("V4_PERSIST_ACCEPTANCE_INVALID");
      acceptedAt = new Date(lifecycle.ended_at).toISOString();
    });
    const replayArtifacts = [];
    for (const item of handles) { const bytes = await store.get(tenantId, item.digest as `sha256:${string}`); if (!bytes || bytes.byteLength !== item.byteLength || sha256Digest(bytes) !== item.digest) throw new Error(`V4_PERSIST_HYDRATION_FAILED:${item.artifactId}`); replayArtifacts.push({ handle: item, bytesBase64: Buffer.from(bytes).toString("base64") }); }
    const replay = { schemaVersion: "verification-benchmark-v4-offline-replay-pack.v1", acceptedAt, tenantId, datasetId: ids.dataset, datasetVersionId: ids.version, semanticDatasetManifestDigest: datasetSeal, datasetManifestArtifact: datasetManifestHandle, catalogManifestDigest: catalogSeal, humanGoldScoringEligibleCount: 0, artifacts: replayArtifacts };
    const replayBytes = new TextEncoder().encode(`${JSON.stringify(replay, null, 2)}\n`); await writeOnce(replayPath, replayBytes);
    const receipt = { schemaVersion: "verification-benchmark-v4-persistence-receipt.v1", acceptedAt, tenantId, datasetId: ids.dataset, datasetVersionId: ids.version, caseCount: dataset.cases.length, stagedArtifactCount: handles.length, semanticDatasetManifestDigest: datasetSeal, datasetManifestArtifactId: datasetManifestHandle.artifactId, datasetManifestRawByteDigest: datasetManifestHandle.digest, catalogManifestDigest: catalogSeal, artifactManifestId: ids.artifactManifest, offlineReplayPack: { path: replayPath, digest: sha256Digest(replayBytes), byteLength: replayBytes.byteLength }, humanGoldScoringEligibleCount: 0, providerDispatches: 0 };
    const receiptBytes = new TextEncoder().encode(`${JSON.stringify(receipt, null, 2)}\n`); await writeOnce(receiptPath, receiptBytes);
    process.stdout.write(`${JSON.stringify({ receiptPath, receiptSha256: sha256Digest(receiptBytes), ...receipt }, null, 2)}\n`);
  } catch (error) {
    if (initialized && !accepted) { const failedAt = new Date().toISOString(); await database.transaction(tenantId, async (client) => { await client.query("update orchestration.attempt set outcome='failed',ended_at=$2 where id=$1 and outcome is null", [ids.attempt, failedAt]); await client.query("update orchestration.work_item set status='failed',terminal_evidence=$2::jsonb where id=$1 and status='pending'", [ids.workItem, canonicalizeJson({ errorClass: error instanceof Error ? error.message : "UNKNOWN" })]); await client.query("update orchestration.mission set status='failed',ended_at=$2,terminal_reason=$3 where id=$1 and status='running'", [ids.mission, failedAt, error instanceof Error ? error.message.slice(0, 500) : "UNKNOWN"]); }).catch(() => undefined); }
    throw error;
  } finally { await database.close(); }
}
await main();
