import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  assertPreparedVerificationBenchmarkComparison,
  VerificationBenchmarkComparisonApplicationService,
  VerificationBenchmarkComparisonProfileCatalog,
} from "@aiengineer/knowledge-application";
import { VerificationBenchmarkComparisonProfileSchema } from "@aiengineer/knowledge-contracts";
import { PostgresCanonicalRepository, PostgresVerificationBenchmarkReadRepository, PostgresVerificationRepository } from "@aiengineer/knowledge-persistence";
import { SupabaseArtifactStore } from "@aiengineer/knowledge-runtime";
import { canonicalizeJson, createEd25519Verifier } from "@aiengineer/knowledge-verification";

const postgres = process.env.POSTGRES_URL, projectUrl = process.env.SUPABASE_URL, serviceRoleKey = process.env.SUPABASE_SECRET_KEY;
if (!postgres || !/^postgres(?:ql)?:\/\/(?:[^@/]+@)?(?:127\.0\.0\.1|localhost):54322\//u.test(postgres)) throw new Error("LOCAL_DB_REQUIRED");
if (!projectUrl || !serviceRoleKey || !["localhost", "127.0.0.1"].includes(new URL(projectUrl).hostname) || new URL(projectUrl).port !== "54321") throw new Error("LOCAL_STORAGE_REQUIRED");

const internal = resolve("../internal"), bucket = "ai-engineer-cloud-bucket";
const readJson = async (name: string) => JSON.parse(await readFile(resolve(internal, name), "utf8")) as unknown;
const worker = await readJson("verification-benchmark-worker-62c9b30e-fb46-478c-9e8c-3da5701fce3a.json") as { tenantId: string; benchmarkRunId: string; attemptId: string; configFile: string; publicKey: { keyId: string; pem: string } };
const crash = await readJson("verification-benchmark-crash-5b42b488-405c-4b02-b28b-44eeaacc1bcd.json") as { keyId: string; publicKey: string; scenarios: { runId: string }[] };
const workerConfig = JSON.parse(await readFile(worker.configFile, "utf8")) as { config: { runtime: unknown } };
const tenantId = worker.tenantId, baselineRunId = worker.benchmarkRunId, candidateRunId = crash.scenarios[0]!.runId;
const database = new PostgresCanonicalRepository({ connectionString: postgres, localOnly: true });
const repository = new PostgresVerificationRepository(database, new SupabaseArtifactStore({ projectUrl, serviceRoleKey, bucket, maximumBytes: 8_000_000 }), {
  async authorize(input) {
    if (input.tenantId !== tenantId || !["verification_replay", "verification_admission"].includes(input.purpose)) throw new Error("PROOF_TENANT_DENIED");
  },
});
const publications = new PostgresVerificationBenchmarkReadRepository(database, repository, { verifier: createEd25519Verifier({ [worker.publicKey.keyId]: worker.publicKey.pem, [crash.keyId]: crash.publicKey }) });
const fileHash = (value: Uint8Array | string): `sha256:${string}` => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const encode = (value: unknown) => new TextEncoder().encode(canonicalizeJson(value));

async function expectFailure(action: () => Promise<unknown>, pattern: RegExp) {
  let failure: unknown;
  try { await action(); } catch (error) { failure = error; }
  assert.ok(failure instanceof Error && pattern.test(failure.message), `expected ${pattern}, received ${failure instanceof Error ? failure.message : String(failure)}`);
}

try {
  const baselinePublication = await publications.loadVerifiedBenchmarkPublication(tenantId, baselineRunId);
  const candidatePublication = await publications.loadVerifiedBenchmarkPublication(tenantId, candidateRunId);
  assert.deepEqual(baselinePublication.manifest.arms.map((arm) => arm.armId), candidatePublication.manifest.arms.map((arm) => arm.armId));
  const armPairs = baselinePublication.manifest.arms.map((arm) => ({ pairId: arm.armId, baselineArmId: arm.armId, candidateArmId: arm.armId }));
  const common = {
    schemaVersion: "verification-benchmark-comparison-profile.v1" as const,
    verificationContractVersion: "verification.v1" as const,
    tenantId,
    version: 3,
    armPairs,
    clusterUnit: "source_family" as const,
    seed: 207_197,
    bootstrapReplicates: 2_000,
    correction: "holm" as const,
    primaryMetric: "engineering_expectation_agreement" as const,
  };
  const pairedProfile = VerificationBenchmarkComparisonProfileSchema.parse({ ...common, profileId: "paired_default", regressionGate: null });
  const gateProfile = VerificationBenchmarkComparisonProfileSchema.parse({ ...common, profileId: "regression_gate", regressionGate: { maximumAllowedObservedDecrease: 0 } });
  const registerProfile = async (profile: typeof pairedProfile) => repository.registerContentAddressedArtifact({
    tenantId,
    bytes: encode(profile),
    mediaType: "application/json",
    createdAt: new Date().toISOString(),
    producerActivityId: "verification-benchmark-comparison-application-proof",
    producerVersion: "1",
    encryptionClass: "supabase-managed",
    retentionClass: "verification-audit",
    dataClassification: "restricted",
    artifactType: "verification_benchmark_comparison_profile",
    bucketClass: "ledger",
    storageBucket: bucket,
    parentArtifactIds: [],
  });
  const pairedArtifact = await registerProfile(pairedProfile), gateArtifact = await registerProfile(gateProfile);
  const ref = (artifact: typeof pairedArtifact) => ({ artifactId: artifact.artifactId, digest: artifact.digest });
  const catalog = new VerificationBenchmarkComparisonProfileCatalog([
    { tenantId, profileId: "paired_default", artifact: ref(pairedArtifact) },
    { tenantId, profileId: "regression_gate", artifact: ref(gateArtifact) },
  ]);
  const service = new VerificationBenchmarkComparisonApplicationService({ publications, createResolver: () => repository.createTrustedArtifactResolver(), catalog });
  const pairedRequest = { verificationContractVersion: "verification.v1" as const, baselineRunId, candidateRunId, comparisonProfile: "paired_default" as const };
  const gateRequest = { ...pairedRequest, comparisonProfile: "regression_gate" as const };
  const inputsBefore = canonicalizeJson({ baselinePublication, candidatePublication, pairedProfile, gateProfile });
  const paired = await service.prepare({ tenantId, request: pairedRequest });
  const gated = await service.prepare({ tenantId, request: gateRequest });

  const retainResult = async (prepared: typeof paired, profileArtifact: typeof pairedArtifact) => {
    const resultBytes = encode(prepared.result);
    const parentArtifactIds = [profileArtifact.artifactId, baselinePublication.publicationArtifact.artifactId, candidatePublication.publicationArtifact.artifactId];
    const transformationSignature = fileHash([
      "verification-benchmark-comparison-artifact.v2",
      "verification_benchmark_comparison_result",
      fileHash(resultBytes),
      ...parentArtifactIds,
      prepared.result.resultDigest,
    ].join("|"));
    return repository.registerContentAddressedArtifact({
      tenantId,
      bytes: resultBytes,
      mediaType: "application/json",
      createdAt: new Date().toISOString(),
      producerActivityId: "verification-benchmark-comparison-application-proof",
      producerVersion: "1",
      encryptionClass: "supabase-managed",
      retentionClass: "verification-audit",
      dataClassification: "restricted",
      artifactType: "verification_benchmark_comparison_result",
      bucketClass: "ledger",
      storageBucket: bucket,
      producerAttemptId: worker.attemptId,
      parentArtifactIds,
      transformationSignature,
    });
  };
  const pairedResultArtifact = await retainResult(paired, pairedArtifact), gatedResultArtifact = await retainResult(gated, gateArtifact);

  for (const prepared of [paired, gated]) {
    assert.equal(prepared.result.pairComparisons.length, 4);
    assert.equal(prepared.result.globalInference.correction, "holm");
    assert.equal(prepared.result.globalInference.tests.length, 72);
    assert.ok(prepared.result.globalInference.tests.every((test) => test.id.includes(":")));
    assert.ok(prepared.result.pairComparisons.every((pair) => pair.comparison.inference.correction === "none"));
    assert.ok(prepared.result.pairComparisons.every((pair) => Object.values(pair.comparison.metrics).every((metric) => metric.delta === 0)));
    assert.equal(prepared.result.claimScope.humanGoldQualityClaim, false);
    assert.equal(prepared.result.claimScope.populationInferenceClaim, false);
    assert.equal(prepared.result.claimScope.promotionClaim, false);
    const { resultDigest, ...material } = prepared.result;
    assert.equal(fileHash(canonicalizeJson(material)), resultDigest);
  }
  assert.equal(paired.result.engineeringRegressionGate.outcome, "not_requested");
  assert.equal(gated.result.engineeringRegressionGate.outcome, "pass");
  assert.equal(gated.result.engineeringRegressionGate.maximumAllowedObservedDecrease, 0);
  assertPreparedVerificationBenchmarkComparison(paired, { tenantId, request: pairedRequest });
  assertPreparedVerificationBenchmarkComparison(gated, { tenantId, request: gateRequest });
  assert.throws(() => assertPreparedVerificationBenchmarkComparison(structuredClone(paired), { tenantId, request: pairedRequest }), /BENCHMARK_COMPARISON_PREPARATION_IDENTITY_MISMATCH/);
  assert.throws(() => assertPreparedVerificationBenchmarkComparison(paired, { tenantId, request: gateRequest }), /BENCHMARK_COMPARISON_PREPARATION_IDENTITY_MISMATCH/);

  const denied = new VerificationBenchmarkComparisonApplicationService({ publications, createResolver: () => repository.createTrustedArtifactResolver(), catalog: new VerificationBenchmarkComparisonProfileCatalog([{ tenantId, profileId: "paired_default", artifact: ref(pairedArtifact) }]) });
  await expectFailure(() => denied.prepare({ tenantId, request: gateRequest }), /BENCHMARK_COMPARISON_PROFILE_TRUSTED_GRANT_REQUIRED/);
  const mismatched = new VerificationBenchmarkComparisonApplicationService({ publications, createResolver: () => repository.createTrustedArtifactResolver(), catalog: new VerificationBenchmarkComparisonProfileCatalog([{ tenantId, profileId: "regression_gate", artifact: ref(pairedArtifact) }]) });
  await expectFailure(() => mismatched.prepare({ tenantId, request: gateRequest }), /BENCHMARK_COMPARISON_PROFILE_IDENTITY_MISMATCH/);

  assert.equal(canonicalizeJson({ baselinePublication, candidatePublication, pairedProfile, gateProfile }), inputsBefore);
  assert.equal(baselinePublication.manifest.execution.externalProviderRequests, 0);
  assert.equal(candidatePublication.manifest.execution.externalProviderRequests, 0);
  assert.notEqual(paired.result.resultDigest, gated.result.resultDigest);
  assert.equal(pairedResultArtifact.digest, fileHash(canonicalizeJson(paired.result)));
  assert.equal(gatedResultArtifact.digest, fileHash(canonicalizeJson(gated.result)));

  const sourcePaths = [
    "packages/contracts/src/verification/benchmark-comparison.ts",
    "packages/evaluation/src/verification-benchmark-run-comparison.ts",
    "packages/application/src/verification/benchmark/verification-benchmark-comparison.ts",
    "scripts/prove-verification-benchmark-comparison-application.ts",
  ];
  const sources = await Promise.all(sourcePaths.map(async (path) => { const source = await readFile(path); return { path, digest: fileHash(source), bytesBase64: source.toString("base64") }; }));
  const output = resolve(internal, `verification-benchmark-comparison-application-${randomUUID()}.json`);
  await writeFile(output, JSON.stringify({
    status: "passed",
    capturedAt: new Date().toISOString(),
    scope: "Registered comparison profile and application computation against two actual signed completed offline publications; no durable comparison operation or provider request",
    tenantId,
    baseline: { runId: baselineRunId, publicationArtifact: baselinePublication.publicationArtifact },
    candidate: { runId: candidateRunId, publicationArtifact: candidatePublication.publicationArtifact },
    profiles: {
      pairedDefault: { profileArtifact: pairedArtifact, resultArtifact: pairedResultArtifact, resultDigest: paired.result.resultDigest, outcome: paired.result.engineeringRegressionGate.outcome },
      regressionGate: { profileArtifact: gateArtifact, resultArtifact: gatedResultArtifact, resultDigest: gated.result.resultDigest, outcome: gated.result.engineeringRegressionGate.outcome },
    },
    runtime: workerConfig.config.runtime,
    checks: {
      exactRegisteredProfileArtifacts: true,
      twoSignedCanonicalCompletedInputs: true,
      fourDeclaredPairsPerProfile: true,
      oneGlobalHolmFamilyPerResult: true,
      zeroReplayMetricDeltas: true,
      engineeringGateNotRequestedAndPass: true,
      preparationIdentityBrandAndCloneDenial: true,
      ungrantedProfileDenied: true,
      mismatchedProfileArtifactDenied: true,
      inputSnapshotsUnchanged: true,
      noHumanGoldPopulationPromotionClaims: true,
      internalResultArtifactsRetained: true,
    },
    pairCounts: { pairedDefault: paired.result.pairComparisons.length, regressionGate: gated.result.pairComparisons.length },
    globalTestCounts: { pairedDefault: paired.result.globalInference.tests.length, regressionGate: gated.result.globalInference.tests.length },
    caseCount: paired.result.pairComparisons[0]!.comparison.pairing.caseCount,
    clusterCount: paired.result.pairComparisons[0]!.comparison.pairing.clusterCount,
    results: { pairedDefault: paired.result, regressionGate: gated.result },
    internalResultOnly: true,
    sources,
    externalProviderRequests: 0,
  }, null, 2));
  console.log(JSON.stringify({ status: "passed", output, profiles: 2, pairComparisons: 8, globalTests: 144 }));
} finally {
  await database.close();
}
