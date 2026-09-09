import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  VerificationOperationApplicationService,
  parseVerificationBenchmarkComparisonRuntimeConfig,
} from "@aiengineer/knowledge-application";
import { VerificationBenchmarkComparisonOperationResultSchema } from "@aiengineer/knowledge-contracts";
import {
  PostgresCanonicalRepository,
  PostgresKnowledgeOperationService,
  PostgresVerificationRepository,
  type LeasedStep,
} from "@aiengineer/knowledge-persistence";
import { SupabaseArtifactStore, deterministicUuid } from "@aiengineer/knowledge-runtime";
import {
  canonicalizeJson,
  createEd25519Verifier,
  digestCanonicalJson,
  verifyVerificationBenchmarkComparisonPublication,
} from "@aiengineer/knowledge-verification";

type Ref = { artifactId: string; digest: string };
type ProfileId = "paired_default" | "regression_gate";
type ApplicationReceipt = {
  tenantId: string;
  baseline: { runId: string; publicationArtifact: Ref };
  candidate: { runId: string; publicationArtifact: Ref };
  profiles: Record<"pairedDefault" | "regressionGate", { profileArtifact: Ref }>;
};
type InputKeyReceipt = { publicKey: { keyId: string; pem: string } };
type BenchmarkCrashReceipt = { keyId: string; publicKey: string };
type BoundaryDurable = {
  status: "completed" | "sealed";
  startedAt: string;
  completedAt: string;
  resultArtifact: Ref;
  resultDigest: string;
  engineeringGateOutcome: "not_requested" | "pass" | "fail";
  publicationArtifact: Ref | null;
  publicationPayloadDigest: string | null;
};
type ChildMessage = {
  kind: "result_completed" | "sealed" | "completed" | "error";
  claim?: LeasedStep;
  durable?: BoundaryDurable;
  result?: { operation?: { status?: string }; receipt?: unknown };
  code?: string;
};
type ComparisonRow = {
  id: string;
  operation_id: string;
  baseline_run_id: string;
  candidate_run_id: string;
  baseline_publication_artifact_id: string;
  baseline_publication_sha256: string;
  baseline_payload_sha256: string;
  candidate_publication_artifact_id: string;
  candidate_publication_sha256: string;
  candidate_payload_sha256: string;
  profile_id: ProfileId;
  profile_artifact_id: string;
  profile_sha256: string;
  runtime: unknown;
  runtime_sha256: string;
  status: "running" | "completed" | "sealed";
  started_at: Date | string;
  completed_at: Date | string | null;
  result_artifact_id: string | null;
  result_sha256: string | null;
  result_digest_sha256: string | null;
  engineering_gate_outcome: "not_requested" | "pass" | "fail" | null;
  publication_artifact_id: string | null;
  publication_sha256: string | null;
  publication_payload_sha256: string | null;
};

const postgres = process.env.POSTGRES_URL;
const projectUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SECRET_KEY;
if (!postgres || !/^postgres(?:ql)?:\/\/(?:[^@/]+@)?(?:127\.0\.0\.1|localhost):54322\//u.test(postgres)) throw new Error("COMPARISON_CRASH_LOCAL_DB_REQUIRED");
if (!projectUrl || !serviceRoleKey || !["localhost", "127.0.0.1"].includes(new URL(projectUrl).hostname) || new URL(projectUrl).port !== "54321") throw new Error("COMPARISON_CRASH_LOCAL_STORAGE_REQUIRED");

const internal = resolve("../internal");
const readJson = async <T>(name: string): Promise<T> => JSON.parse(await readFile(resolve(internal, name), "utf8")) as T;
const applicationReceipt = await readJson<ApplicationReceipt>("verification-benchmark-comparison-application-a8f9486b-c122-4b7b-b9b5-e5c986dfaa9a.json");
const benchmarkWorker = await readJson<InputKeyReceipt>("verification-benchmark-worker-62c9b30e-fb46-478c-9e8c-3da5701fce3a.json");
const benchmarkCrash = await readJson<BenchmarkCrashReceipt>("verification-benchmark-crash-5b42b488-405c-4b02-b28b-44eeaacc1bcd.json");
const tenantId = applicationReceipt.tenantId;
const namespace = randomUUID();
const missionId = randomUUID();
const workItemId = randomUUID();
const attemptId = randomUUID();
const bucket = "ai-engineer-cloud-bucket";
const database = new PostgresCanonicalRepository({ connectionString: postgres, localOnly: true });
const repository = new PostgresVerificationRepository(
  database,
  new SupabaseArtifactStore({ projectUrl, serviceRoleKey, bucket, maximumBytes: 8_000_000 }),
  { async authorize(input) { if (input.tenantId !== tenantId || !["verification_admission", "verification_replay"].includes(input.purpose)) throw new Error("COMPARISON_CRASH_ARTIFACT_DENIED"); } },
);
const operationService = new PostgresKnowledgeOperationService(database, { admittedOperationKinds: ["verification_benchmark_compare"] });
const application = new VerificationOperationApplicationService(operationService, "http://localhost");
const actor = { kind: "service" as const, id: attemptId, serviceIdentity: "evaluation_executor" as const };
const keys = generateKeyPairSync("ed25519");
const privateKeyPem = keys.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
const publicKeyPem = keys.publicKey.export({ format: "pem", type: "spki" }).toString();
const keyId = `comparison-crash-${namespace}`;
const childProcesses = new Set<ChildProcess>();
const operationIds: string[] = [];
const configFiles: string[] = [];

const profileRef = (profileId: ProfileId): Ref => {
  const artifact = profileId === "paired_default"
    ? applicationReceipt.profiles.pairedDefault.profileArtifact
    : applicationReceipt.profiles.regressionGate.profileArtifact;
  return { artifactId: artifact.artifactId, digest: artifact.digest };
};
const request = (profileId: ProfileId) => ({
  verificationContractVersion: "verification.v1" as const,
  baselineRunId: applicationReceipt.baseline.runId,
  candidateRunId: applicationReceipt.candidate.runId,
  comparisonProfile: profileId,
});
const sha = (hex: string | null): string | null => hex === null ? null : `sha256:${hex}`;
const iso = (value: Date | string | null): string | null => value === null ? null : new Date(value).toISOString();

async function comparisonRow(operationId: string): Promise<ReturnType<typeof projectRow>> {
  const row = await database.transaction(tenantId, async sql => (await sql.query<ComparisonRow>(
    "select * from evaluation.verification_benchmark_comparison where tenant_id=$1 and operation_id=$2",
    [tenantId, operationId],
  )).rows[0]);
  assert.ok(row, "comparison row missing");
  return projectRow(row);
}

function projectRow(row: ComparisonRow) {
  return {
    comparisonId: row.id,
    operationId: row.operation_id,
    baseline: {
      runId: row.baseline_run_id,
      publicationArtifact: { artifactId: row.baseline_publication_artifact_id, digest: sha(row.baseline_publication_sha256)! },
      payloadDigest: sha(row.baseline_payload_sha256)!,
    },
    candidate: {
      runId: row.candidate_run_id,
      publicationArtifact: { artifactId: row.candidate_publication_artifact_id, digest: sha(row.candidate_publication_sha256)! },
      payloadDigest: sha(row.candidate_payload_sha256)!,
    },
    profile: { profileId: row.profile_id, artifact: { artifactId: row.profile_artifact_id, digest: sha(row.profile_sha256)! } },
    runtime: row.runtime,
    runtimeDigest: sha(row.runtime_sha256)!,
    status: row.status,
    startedAt: iso(row.started_at)!,
    completedAt: iso(row.completed_at),
    resultArtifact: row.result_artifact_id === null ? null : { artifactId: row.result_artifact_id, digest: sha(row.result_sha256)! },
    resultDigest: sha(row.result_digest_sha256),
    engineeringGateOutcome: row.engineering_gate_outcome,
    publicationArtifact: row.publication_artifact_id === null ? null : { artifactId: row.publication_artifact_id, digest: sha(row.publication_sha256)! },
    publicationPayloadDigest: sha(row.publication_payload_sha256),
  };
}

function startChild(operationId: string, configPath: string, crashPoint: "result_completed" | "sealed" | "none") {
  const child = spawn(process.execPath, ["--import", "tsx", resolve("scripts/verification-benchmark-comparison-crash-child.ts")], {
    windowsHide: true,
    env: {
      SYSTEMROOT: process.env.SYSTEMROOT,
      WINDIR: process.env.WINDIR,
      POSTGRES_URL: postgres,
      SUPABASE_URL: projectUrl,
      SUPABASE_SECRET_KEY: serviceRoleKey,
      VERIFICATION_STORAGE_BUCKET: bucket,
      VERIFICATION_BENCHMARK_COMPARISON_SIGNING_PRIVATE_KEY_PEM: privateKeyPem,
      VERIFICATION_BENCHMARK_COMPARISON_SIGNING_KEY_ID: keyId,
      COMPARISON_CRASH_OPERATION_ID: operationId,
      COMPARISON_CRASH_CONFIG_FILE: configPath,
      COMPARISON_CRASH_POINT: crashPoint,
    },
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  childProcesses.add(child);
  let stderr = "";
  child.stderr!.on("data", value => { stderr = (stderr + value.toString()).slice(-12_000); });
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolveExit => child.once("exit", (code, signal) => {
    childProcesses.delete(child);
    resolveExit({ code, signal });
  }));
  const message = new Promise<ChildMessage>((resolveMessage, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`COMPARISON_CRASH_CHILD_TIMEOUT:${crashPoint}`));
    }, 90_000);
    child.once("error", error => { clearTimeout(timeout); reject(error); });
    child.once("exit", () => { clearTimeout(timeout); reject(new Error(`COMPARISON_CRASH_CHILD_PREMATURE_EXIT:${stderr}`)); });
    child.once("message", raw => {
      clearTimeout(timeout);
      const value = raw as ChildMessage;
      if (value.kind === "error") reject(new Error(value.code ?? "COMPARISON_CRASH_CHILD_FAILURE"));
      else resolveMessage(value);
    });
  });
  return { child, exit, message, stderr: () => stderr };
}

async function waitForNaturalExpiry(claim: LeasedStep): Promise<void> {
  const deadline = Date.now() + 50_000;
  while (Date.now() < deadline) {
    const expired = await database.transaction(tenantId, async sql => (await sql.query<{ expired: boolean }>(
      "select expires_at<=clock_timestamp() expired from knowledge_service.lease where tenant_id=$1 and operation_step_id=$2 and lease_token=$3 and fencing_token=$4",
      [tenantId, claim.id, claim.leaseToken, claim.fencingToken],
    )).rows[0]?.expired ?? false);
    if (expired) return;
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  throw new Error("COMPARISON_CRASH_NATURAL_LEASE_EXPIRY_TIMEOUT");
}

try {
  await database.transaction(tenantId, async sql => {
    await sql.query("insert into orchestration.mission(id,tenant_id,slug,goal) values($1,$2,$3,'Actual comparison process recovery proof')", [missionId, tenantId, `comparison-crash-${namespace}`]);
    await sql.query("insert into orchestration.work_item(id,tenant_id,mission_id,kind) values($1,$2,$3,'review_task')", [workItemId, tenantId, missionId]);
    await sql.query("insert into orchestration.attempt(id,tenant_id,work_item_id,attempt_no,agent_deployment_id) values($1,$2,$3,1,'benchmark-comparison-crash-proof')", [attemptId, tenantId, workItemId]);
  });

  const sourcePaths = [
    "scripts/prove-verification-benchmark-comparison-crash.ts",
    "scripts/verification-benchmark-comparison-crash-child.ts",
    "apps/worker/src/verification-benchmark-comparison-activity.ts",
    "apps/worker/src/verification-benchmark-comparison-runtime.ts",
    "apps/worker/src/activity-registry.ts",
    "apps/worker/src/canonical-worker.ts",
    "packages/application/src/verification-benchmark-comparison.ts",
    "packages/application/src/verification-benchmark-comparison-publication.ts",
    "packages/application/src/verification-benchmark-comparison-runtime-config.ts",
    "packages/persistence/src/verification-benchmark-comparison.ts",
    "packages/verification/src/provenance/benchmark-comparison-publication.ts",
  ];
  const sourceFiles = await Promise.all(sourcePaths.map(async path => {
    const bytes = await readFile(path);
    return { path, digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`, bytesBase64: bytes.toString("base64") };
  }));
  const snapshotBytes = new TextEncoder().encode(canonicalizeJson({
    schemaVersion: "verification-benchmark-comparison-crash-source-snapshot.v1",
    scope: "Configured comparison worker, lifecycle, signature and proof sources; scoped custody, not a complete dependency or deployment image",
    files: sourceFiles,
  }));
  const sourceSnapshot = await repository.registerContentAddressedArtifact({
    tenantId,
    producerAttemptId: attemptId,
    missionId,
    bytes: snapshotBytes,
    mediaType: "application/json",
    createdAt: new Date().toISOString(),
    producerActivityId: "verification-benchmark-comparison-crash-proof",
    producerVersion: "1",
    encryptionClass: "supabase-managed",
    retentionClass: "verification-audit",
    dataClassification: "restricted",
    artifactType: "verification_benchmark_provenance",
    bucketClass: "ledger",
    storageBucket: bucket,
    parentArtifactIds: [],
  });
  const runtime = {
    deploymentId: "benchmark-comparison-crash-proof",
    capabilityVersion: "verification-service.v1",
    targetCodeRef: `uncommitted:${sourceSnapshot.digest}`,
    gitSha: "uncommitted",
    dirty: true,
    dirtyStateArtifact: sourceSnapshot,
  };
  const config = {
    schemaVersion: "verification-benchmark-comparison-runtime.v1",
    tenantId,
    profiles: (["paired_default", "regression_gate"] as const).map(profileId => ({ profileId, artifact: profileRef(profileId) })),
    inputPublicKeys: [
      { keyId: benchmarkWorker.publicKey.keyId, publicKeyPem: benchmarkWorker.publicKey.pem },
      { keyId: benchmarkCrash.keyId, publicKeyPem: benchmarkCrash.publicKey },
    ],
    runtime,
  };
  const configText = JSON.stringify(config);
  parseVerificationBenchmarkComparisonRuntimeConfig(configText);
  const configPath = resolve(internal, `verification-benchmark-comparison-crash-config-${namespace}.json`);
  configFiles.push(configPath);
  await writeFile(configPath, configText, { flag: "wx" });

  const verifier = createEd25519Verifier({ [keyId]: publicKeyPem });
  const trusted = repository.createTrustedArtifactResolver();
  const scenarios = [];
  for (const [crashPoint, profileId] of [["result_completed", "paired_default"], ["sealed", "regression_gate"]] as const) {
    const operationId = randomUUID();
    operationIds.push(operationId);
    const comparisonId = deterministicUuid("verification-benchmark-comparison", `${tenantId}:${operationId}`);
    const comparisonRequest = request(profileId);
    await application.submitCompareBenchmarkRuns(comparisonRequest, {
      tenantId,
      missionId,
      workItemId,
      attemptId,
      operationId,
      actor,
      correlationId: namespace,
      capabilityVersion: "verification-service.v1",
      idempotencyKey: `comparison-crash-${namespace}-${crashPoint}`,
      reason: "Actual comparison worker process kill and replacement proof",
      contractVersion: "v1",
    });

    const before = startChild(operationId, configPath, crashPoint);
    const boundary = await before.message;
    assert.equal(boundary.kind, crashPoint);
    assert.ok(boundary.claim);
    assert.ok(boundary.durable);
    const originalClaim = boundary.claim;
    const original = await comparisonRow(operationId);
    assert.equal(original.comparisonId, comparisonId);
    assert.equal(original.status, crashPoint === "result_completed" ? "completed" : "sealed");
    assert.equal(original.startedAt, boundary.durable.startedAt);
    assert.equal(original.completedAt, boundary.durable.completedAt);
    assert.deepEqual(original.resultArtifact, boundary.durable.resultArtifact);
    assert.equal(original.resultDigest, boundary.durable.resultDigest);
    assert.equal(original.engineeringGateOutcome, boundary.durable.engineeringGateOutcome);
    if (crashPoint === "result_completed") {
      assert.equal(original.publicationArtifact, null);
      assert.equal(original.publicationPayloadDigest, null);
    } else {
      assert.deepEqual(original.publicationArtifact, boundary.durable.publicationArtifact);
      assert.equal(original.publicationPayloadDigest, boundary.durable.publicationPayloadDigest);
    }
    assert.equal((await database.listReceipts(tenantId, operationId)).length, 0);

    assert.equal(before.child.kill("SIGKILL"), true);
    const termination = await before.exit;
    assert.equal(termination.signal, "SIGKILL");
    await waitForNaturalExpiry(originalClaim);

    const replacement = startChild(operationId, configPath, "none");
    const completed = await replacement.message;
    assert.equal(completed.kind, "completed");
    assert.equal(completed.result?.operation?.status, "succeeded");
    assert.ok(completed.claim);
    assert.ok(completed.claim.fencingToken > originalClaim.fencingToken);
    const replacementExit = await replacement.exit;
    assert.equal(replacementExit.code, 0, replacement.stderr());

    const final = await comparisonRow(operationId);
    assert.equal(final.status, "sealed");
    assert.equal(final.startedAt, original.startedAt);
    assert.equal(final.completedAt, original.completedAt);
    assert.deepEqual(final.resultArtifact, original.resultArtifact);
    assert.equal(final.resultDigest, original.resultDigest);
    assert.equal(final.engineeringGateOutcome, original.engineeringGateOutcome);
    assert.equal(digestCanonicalJson(final.runtime), digestCanonicalJson({ ...runtime, attemptId }));
    assert.equal(final.runtimeDigest, digestCanonicalJson(final.runtime));
    assert.deepEqual(final.baseline.publicationArtifact, {
      artifactId: applicationReceipt.baseline.publicationArtifact.artifactId,
      digest: applicationReceipt.baseline.publicationArtifact.digest,
    });
    assert.deepEqual(final.candidate.publicationArtifact, {
      artifactId: applicationReceipt.candidate.publicationArtifact.artifactId,
      digest: applicationReceipt.candidate.publicationArtifact.digest,
    });
    assert.equal(final.baseline.runId, applicationReceipt.baseline.runId);
    assert.equal(final.candidate.runId, applicationReceipt.candidate.runId);
    assert.equal(final.profile.profileId, profileId);
    assert.deepEqual(final.profile.artifact, profileRef(profileId));
    if (crashPoint === "sealed") {
      assert.deepEqual(final.publicationArtifact, original.publicationArtifact);
      assert.equal(final.publicationPayloadDigest, original.publicationPayloadDigest);
    }

    const counts = await database.transaction(tenantId, async sql => (await sql.query<{ by_operation: number; by_identity: number }>(
      `select
        (select count(*)::int from evaluation.verification_benchmark_comparison where tenant_id=$1 and operation_id=$2) by_operation,
        (select count(*)::int from evaluation.verification_benchmark_comparison where tenant_id=$1 and id=$3) by_identity`,
      [tenantId, operationId, comparisonId],
    )).rows[0]!);
    assert.deepEqual(counts, { by_operation: 1, by_identity: 1 });
    const receipts = await database.listReceipts(tenantId, operationId);
    assert.equal(receipts.length, 1);
    const receipt = receipts[0]!;
    assert.equal(receipt.outcome, "succeeded");
    assert.equal(receipt.id, deterministicUuid("knowledge-worker-receipt", `${operationId}:${originalClaim.id}:${originalClaim.inputSha256}`));
    assert.equal(receipt.receiptKind, "compare_registered_and_publish.succeeded");
    const receiptBody = receipt.body as {
      schemaVersion: string;
      operationId: string;
      useCase: string;
      resultArtifact: Ref;
      output: unknown;
      fencingToken: number;
    };
    assert.equal(receiptBody.schemaVersion, "verification-operation-result.v1");
    assert.equal(receiptBody.operationId, operationId);
    assert.equal(receiptBody.useCase, "compareBenchmarkRuns");
    assert.equal(receiptBody.fencingToken, completed.claim.fencingToken);
    assert.equal(receiptBody.resultArtifact.artifactId, final.publicationArtifact?.artifactId);
    assert.equal(receiptBody.resultArtifact.digest, final.publicationArtifact?.digest);
    const output = VerificationBenchmarkComparisonOperationResultSchema.parse(receiptBody.output);
    assert.equal(output.comparisonId, comparisonId);
    assert.equal(output.resultDigest, final.resultDigest);
    assert.equal(output.manifestDigest, final.publicationPayloadDigest);
    assert.equal(output.engineeringGateOutcome, profileId === "paired_default" ? "not_requested" : "pass");
    assert.deepEqual(output.qualityClaims, { humanGoldValidated: false, sourceAuthorityAssessed: false, calibrated: false });

    assert.ok(final.publicationArtifact && final.resultArtifact && final.resultDigest && final.publicationPayloadDigest);
    await trusted.authorizeArtifact({ tenantId, artifactId: final.publicationArtifact.artifactId, purpose: "verification_admission" });
    const publicationBytes = await trusted.hydrateRegisteredArtifact({ tenantId, artifactId: final.publicationArtifact.artifactId });
    const verified = await verifyVerificationBenchmarkComparisonPublication(JSON.parse(new TextDecoder().decode(publicationBytes.bytes)), verifier);
    assert.equal(verified.signatureStatus, "verified");
    assert.equal(verified.manifest.seal.signature?.keyId, keyId);
    assert.equal(verified.manifest.operationId, operationId);
    assert.equal(verified.manifest.comparisonId, comparisonId);
    assert.equal(verified.manifest.startedAt, original.startedAt);
    assert.equal(verified.manifest.completedAt, original.completedAt);
    assert.equal(verified.manifest.result.artifact.artifactId, final.resultArtifact.artifactId);
    assert.equal(verified.manifest.result.artifact.digest, final.resultArtifact.digest);
    assert.equal(verified.manifest.result.resultDigest, final.resultDigest);
    assert.equal(verified.manifest.seal.payloadDigest, final.publicationPayloadDigest);
    assert.equal(verified.manifest.execution.externalProviderRequests, 0);

    await trusted.authorizeArtifact({ tenantId, artifactId: final.resultArtifact.artifactId, purpose: "verification_admission" });
    const resultBytes = await trusted.hydrateRegisteredArtifact({ tenantId, artifactId: final.resultArtifact.artifactId });
    const resultValue = JSON.parse(new TextDecoder().decode(resultBytes.bytes)) as Record<string, unknown>;
    const { resultDigest: embeddedResultDigest, ...resultMaterial } = resultValue;
    assert.equal(embeddedResultDigest, final.resultDigest);
    assert.equal(digestCanonicalJson(resultMaterial), final.resultDigest);

    await assert.rejects(database.completeStep(tenantId, originalClaim, {
      id: randomUUID(),
      idempotencyKey: `dead-comparison-worker-${namespace}-${crashPoint}`,
      receiptKind: "dead-comparison-worker.succeeded",
      executorIdentity: "dead-comparison-worker",
      output: { stale: true },
    }), /STALE_LEASE/u);

    scenarios.push({
      crashPoint,
      profileId,
      operationId,
      comparisonId,
      originalProcessId: before.child.pid,
      replacementProcessId: replacement.child.pid,
      termination,
      originalFence: originalClaim.fencingToken,
      replacementFence: completed.claim.fencingToken,
      original,
      final,
      receiptId: receipt.id,
      publication: verified.manifest,
      checks: {
        actualProcessKilledAfterCommittedBoundary: true,
        naturalLeaseExpiryObserved: true,
        replacementAcquiredHigherFence: true,
        originalTimingPreserved: true,
        durableResultReused: true,
        exactIdentityAndRuntimePreserved: true,
        singleComparisonRowAndReceipt: true,
        signedPublicationAndSemanticResultVerified: true,
        deadWorkerCompletionRejected: true,
        externalProviderRequestsZero: true,
        ...(crashPoint === "sealed" ? { sealedPublicationReused: true } : {}),
      },
    });
  }

  const receiptPath = resolve(internal, `verification-benchmark-comparison-crash-${namespace}.json`);
  await writeFile(receiptPath, JSON.stringify({
    status: "passed",
    capturedAt: new Date().toISOString(),
    scope: "Actual separate-process SIGKILL and naturally expired lease recovery for configured registered benchmark comparison after result completion and after publication sealing; offline recorded engineering observations only",
    tenantId,
    missionId,
    workItemId,
    attemptId,
    inputPublications: { baseline: applicationReceipt.baseline, candidate: applicationReceipt.candidate },
    profiles: { pairedDefault: profileRef("paired_default"), regressionGate: profileRef("regression_gate") },
    runtime,
    publicKey: { keyId, pem: publicKeyPem },
    sourceSnapshot,
    sourceHashes: Object.fromEntries(sourceFiles.map(source => [source.path, source.digest])),
    sourceSnapshotScope: "Scoped source custody, not a complete dependency graph or deployment image",
    scenarios,
    externalProviderRequests: 0,
    limitations: [
      "This proof covers two named committed comparison boundaries on the local configured runtime; it is not a proof of every crash point or deployment topology.",
      "Inputs are completed offline-recorded benchmark publications and the results are engineering observations without human-gold, source-authority, calibration, population or promotion claims.",
    ],
  }, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: "passed", receipt: receiptPath, scenarios: scenarios.map(value => ({ crashPoint: value.crashPoint, operationId: value.operationId, comparisonId: value.comparisonId })) }));
} finally {
  for (const child of childProcesses) child.kill("SIGKILL");
  for (const operationId of operationIds) {
    try {
      const operation = await database.getOperation(tenantId, operationId);
      if (operation?.status === "queued" || operation?.status === "running") {
        await database.cancelOperation(tenantId, operationId, { actorIdentity: "comparison-crash-proof-cleanup", correlationId: namespace });
      }
    } catch { /* Preserve the primary proof failure. */ }
  }
  await database.close();
}
