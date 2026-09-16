import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Actor, OperationContext, VerifyClaimsRequest, VerificationArtifactHandle, VerificationBenchmarkCase, VerificationPolicyDefinition } from "@aiengineer/knowledge-contracts";
import { createDiagnosticsProviderCaseInput, loadDiagnosticsV1ProviderGrant, SemanticJudgeProfileSchema, VerificationAdmissionService, VerificationClaimsProjectionGrantCatalog } from "@aiengineer/knowledge-application";
import { VERIFICATION_PARSER_LIMITS } from "@aiengineer/knowledge-conversion";
import { PostgresCanonicalRepository, PostgresKnowledgeOperationService, PostgresVerificationRepository } from "@aiengineer/knowledge-persistence";
import { deterministicUuid, SupabaseArtifactStore } from "@aiengineer/knowledge-runtime";
import { canonicalizeJson, digestCanonicalJson, gatewaySemanticConfigurationDigest, gatewaySemanticOutputSchemaDigest, gatewaySemanticPromptDigest, prepareGatewaySemanticRequest, sha256Digest } from "@aiengineer/knowledge-verification";
import { buildServer } from "../apps/api/src/server.js";
import { createVerificationClaimsReportReads } from "../apps/api/src/verification-claims-report-reads-runtime.js";
import { createVerificationOwnershipResolver } from "../apps/api/src/verification-ownership.js";
import { startWorker } from "../apps/worker/src/index.js";
import { createVerificationSemanticMissionFixture, type FrozenSemanticMissionRecord } from "./verification-semantic-mission-fixture.js";

import { selectDiagnosticsSemanticCases, type DiagnosticsSemanticScope } from "./verification-diagnostics-semantic-scope.js";

type Registry = { readonly tenantId: string; readonly records: readonly (FrozenSemanticMissionRecord & { readonly sourceKey: string })[] };
type Plan = { readonly caseId: string; readonly pairCluster: string; readonly context: OperationContext; readonly request: VerifyClaimsRequest; readonly expectedOperationId: string; readonly workflowId: string; readonly profileArtifact: VerificationArtifactHandle; readonly expectedSemanticRequestDigest: `sha256:${string}`; readonly frozen: FrozenSemanticMissionRecord; readonly benchmarkCase: VerificationBenchmarkCase };
const MAX_CALLS = 40, RESERVATION_MICROS = 5_000, MAX_CONSECUTIVE_FAILURES = 3;

async function freezeExecutionSources(): Promise<Readonly<Record<string, string>>> {
  const paths = [
    "scripts/prove-verification-diagnostics-v1-semantic-pairs.ts",
    "scripts/verification-semantic-mission-fixture.ts",
    "scripts/verification-diagnostics-semantic-scope.ts",
    "scripts/prove-verification-diagnostics-v1-semantic-missing-two.ts",
    "apps/worker/src/verification-claims-semantic-stage.ts",
    "apps/worker/src/verification-claims-sealer.ts",
    "packages/application/src/verification/operations/verification-claims.ts",
    "packages/application/src/verification/benchmark/verification-benchmark.ts",
    "../ai-engineer-mission-control/scripts/prove-verification-semantic-temporal.ts",
  ] as const;
  return Object.freeze(Object.fromEntries(await Promise.all(paths.map(async path => [path, createHash("sha256").update(await readFile(resolve(path))).digest("hex")] as const))));
}

export function requireDiagnosticsV1SemanticPairsEnvironment(environment: Readonly<Record<string, string | undefined>> = process.env): { readonly database: string; readonly gatewayApiKey: string } {
  const database = environment.VERIFICATION_PROOF_DATABASE?.trim() ?? "";
  assert.match(database, /^verification_diagnostics_v1_semantic_[0-9a-f]{32}$/u, "DIAGNOSTICS_V1_SEMANTIC_DATABASE_REQUIRED");
  const gatewayApiKey = environment.AI_GATEWAY_API_KEY?.trim() ?? "";
  assert.ok(gatewayApiKey.length > 0, "DIAGNOSTICS_V1_SEMANTIC_GATEWAY_KEY_REQUIRED");
  return { database, gatewayApiKey };
}
function operationId(input: Pick<OperationContext, "tenantId" | "missionId" | "workItemId" | "attemptId">, verificationDispatchIdempotencyKey: (input: unknown) => string): { readonly operationId: string; readonly idempotencyKey: string } {
  const idempotencyKey = verificationDispatchIdempotencyKey({ operation: "verifyClaims", context: input });
  return { idempotencyKey, operationId: deterministicUuid("verification-http-operation", `${input.tenantId}:verifyClaims:${idempotencyKey}`) };
}

export function boundV1Cases(v1: readonly VerificationBenchmarkCase[]): readonly VerificationBenchmarkCase[] {
  return selectDiagnosticsSemanticCases(v1, "full");
}
export async function runDiagnosticsV1SemanticPairs(scope: DiagnosticsSemanticScope = "full"): Promise<void> {
  assert.ok(scope === "full" || scope === "missing_two", "DIAGNOSTICS_SEMANTIC_SCOPE_INVALID");
  const maximumCalls = scope === "full" ? MAX_CALLS : 2;
  const proof = requireDiagnosticsV1SemanticPairsEnvironment();
  // @ts-expect-error local proof configuration is deliberately outside the package graph.
  const { loadVerifiedLocalDevelopmentConfig } = await import("../../internal/verification-local-direct-config.mjs") as { loadVerifiedLocalDevelopmentConfig(): Promise<{ DB_URL: string; API_URL: string; SECRET_KEY: string }> };
  const local = await loadVerifiedLocalDevelopmentConfig(), dbUrl = new URL(local.DB_URL), storageUrl = new URL(local.API_URL);
  dbUrl.pathname = `/${proof.database}`;
  assert.ok(["localhost", "127.0.0.1"].includes(dbUrl.hostname) && dbUrl.port === "54322" && !dbUrl.search && !dbUrl.hash, "DIAGNOSTICS_V1_SEMANTIC_LOCAL_DB_ONLY");
  assert.ok(["localhost", "127.0.0.1"].includes(storageUrl.hostname) && storageUrl.port === "54321" && !storageUrl.search && !storageUrl.hash, "DIAGNOSTICS_V1_SEMANTIC_LOCAL_STORAGE_ONLY");
  const temporalAddress = process.argv[2]?.trim() || "127.0.0.1:7233";
  assert.match(temporalAddress, /^(127\.0\.0\.1|localhost):\d{1,5}$/u, "DIAGNOSTICS_V1_SEMANTIC_TEMPORAL_LOCAL_ONLY");
  const namespace = randomUUID(), bucket = "ai-engineer-cloud-bucket";
  const registry = JSON.parse(await readFile(resolve("../internal/verification-frozen-source-registry-7a74a7a8-0dc4-4591-8bb1-5781ebddef42.json"), "utf8")) as Registry;
  const catalogDirectory = resolve("catalog/verification-benchmarks/diagnostics-companies-v1");
  const provider = await loadDiagnosticsV1ProviderGrant(catalogDirectory);
  const cases = selectDiagnosticsSemanticCases(provider.dataset.cases, scope);
  for (const item of cases) createDiagnosticsProviderCaseInput(item, provider.authority);
  const sourceHashes = await freezeExecutionSources();
  const { verificationDispatchIdempotencyKey } = await import(pathToFileURL(resolve("../ai-engineer-mission-control/packages/mission-kernel/src/verification-dispatch.ts")).href) as { verificationDispatchIdempotencyKey(input: unknown): string };
  const startupPath = resolve("../internal", `verification-diagnostics-v1-semantic-pairs-startup-${namespace}.json`), outputPath = resolve("../internal", `verification-diagnostics-v1-semantic-pairs-${namespace}.json`), failurePath = outputPath.replace(/\.json$/u, ".failure.json");
  await writeFile(startupPath, JSON.stringify({ schemaVersion: "verification-diagnostics-v1-semantic-pairs-startup.v1", namespace, tenantId: registry.tenantId, proofDatabase: proof.database, temporalAddress, model: "openai/gpt-5.6-luna", caseCount: cases.length, scope, maximumCalls, reservationMicrosPerCall: RESERVATION_MICROS, maximumReservationMicros: maximumCalls * RESERVATION_MICROS, automaticQualityRetries: 0, concurrency: 1, stopAfterConsecutiveFailures: MAX_CONSECUTIVE_FAILURES, sourceProcessingGrant: "D-013 exact public assertion/fragment; D-014 cph completion cohort", sourceHashes, createdAt: new Date().toISOString() }, null, 2) + "\n", { flag: "wx" });
  const database = new PostgresCanonicalRepository({ connectionString: dbUrl.toString(), localOnly: true });
  let server: ReturnType<typeof buildServer> | undefined, worker: Awaited<ReturnType<typeof startWorker>> | undefined, phase = "startup";
  const createdOperationIds: string[] = [];
  try {
    const store = new SupabaseArtifactStore({ projectUrl: local.API_URL, serviceRoleKey: local.SECRET_KEY, bucket, maximumBytes: 32_000_000 });
    const repository = new PostgresVerificationRepository(database, store, { async authorize(value) { assert.equal(value.tenantId, registry.tenantId); assert.ok(["verification_admission", "verification_replay", "policy_replay"].includes(value.purpose)); } });
    const tenantId = registry.tenantId, missionId = randomUUID(), producerWorkItemId = randomUUID(), producerAttemptId = randomUUID(), producerDeploymentId = `diagnostics-v1-producer-${namespace}`, verifierDeploymentId = `diagnostics-v1-verifier-${namespace}`;
    await database.transaction(tenantId, async client => { await client.query("insert into orchestration.mission(id,tenant_id,slug,goal) values($1,$2,$3,$4)", [missionId, tenantId, `diagnostics-v1-semantic-${namespace}`, "Authorized D-013 diagnostics v1 Luna semantic pair run"]); await client.query("insert into orchestration.work_item(id,tenant_id,mission_id,kind,spec) values($1,$2,$3,'verify_extraction',$4::jsonb)", [producerWorkItemId, tenantId, missionId, JSON.stringify({ namespace, role: "diagnostics_v1_semantic_fixture" })]); await client.query("insert into orchestration.attempt(id,tenant_id,work_item_id,attempt_no,agent_deployment_id,started_at) values($1,$2,$3,1,$4,clock_timestamp())", [producerAttemptId, tenantId, producerWorkItemId, producerDeploymentId]); });
    const register = async (value: unknown, artifactType: string): Promise<VerificationArtifactHandle> => repository.registerContentAddressedArtifact({ tenantId, producerAttemptId, missionId, artifactType, bytes: new TextEncoder().encode(canonicalizeJson(value)), createdAt: new Date().toISOString(), parentArtifactIds: [], producerActivityId: "verification-diagnostics-v1-semantic-pairs", producerVersion: "v1", mediaType: "application/json", encryptionClass: "supabase-managed", retentionClass: "verification-audit", dataClassification: "restricted", bucketClass: "ledger", storageBucket: bucket });
    const policyVersion = `diagnostics-v1-semantic-policy-${namespace}`, policy: VerificationPolicyDefinition = { schemaVersion: "verification-policy.v1", policyVersion, definitionId: `diagnostics-v1-semantic-${namespace}`, criticalDownstreamUses: [], requireCrossFamilyForRisk: [], requireIndependentAuthorityForScopes: [], mixedEvidenceOutcome: "review", unknownCriticalOutcome: "review", authorityWithheldOutcome: "review", reviewAvailable: true }, policyArtifact = await register(policy, "verification_policy");
    const key = generateKeyPairSync("ed25519"), keyId = `diagnostics-v1-semantic-${namespace}`, privateKeyPem = key.privateKey.export({ type: "pkcs8", format: "pem" }).toString(), publicKeyPem = key.publicKey.export({ type: "spki", format: "pem" }).toString();
    const actor: Actor = { kind: "service", id: randomUUID(), serviceIdentity: "mission_control_client" };
    const plans: Plan[] = [];
    for (const benchmarkCase of cases) {
      const frozen = registry.records.find(record => record.sourceKey === benchmarkCase.evidence[0]!.sourceKey); assert.ok(frozen?.projections[0], `DIAGNOSTICS_V1_FROZEN_RECORD_REQUIRED:${benchmarkCase.caseId}`);
      const projection = frozen.projections[0]!;
      const admission = new VerificationAdmissionService(repository, { async parse(): Promise<never> { throw new Error("PARSER_FORBIDDEN_IN_DIAGNOSTICS_V1_SEMANTIC"); } }, { parserVersion: projection.parserVersion as "verification-native-parser.v1", imageDigest: projection.imageDigest, limits: VERIFICATION_PARSER_LIMITS }, { storageBucket: bucket, producerVersion: "diagnostics-v1-semantic.v1", encryptionClass: "supabase-managed", retentionClass: "verification-audit", now: () => new Date().toISOString() });
      const workItemId = randomUUID(), attemptId = randomUUID(), dispatch = operationId({ tenantId, missionId, workItemId, attemptId }, verificationDispatchIdempotencyKey), expectedOperationId = dispatch.operationId, workflowId = `diagnostics-v1-${benchmarkCase.caseId}-${namespace}`;
      await database.transaction(tenantId, async client => { await client.query("insert into orchestration.work_item(id,tenant_id,mission_id,kind,spec) values($1,$2,$3,'verify_extraction',$4::jsonb)", [workItemId, tenantId, missionId, JSON.stringify({ namespace, role: "diagnostics_v1_semantic_claims", caseId: benchmarkCase.caseId, pairCluster: benchmarkCase.pairCluster })]); await client.query("insert into orchestration.attempt(id,tenant_id,work_item_id,attempt_no,agent_deployment_id,started_at) values($1,$2,$3,1,$4,clock_timestamp())", [attemptId, tenantId, workItemId, verifierDeploymentId]); });
      const fixture = await createVerificationSemanticMissionFixture({ database, repository, admission, tenantId, namespace, missionId, producerAttemptId, producerDeploymentId, verifierDeploymentId, kind: "claims", verifierAttemptId: attemptId, policyVersion, frozenRecord: frozen, benchmarkCase });
      const model = "openai/gpt-5.6-luna" as const, identity = SemanticJudgeProfileSchema.parse({ schemaVersion: "verification-semantic-judge-profile.v1", identity: { deploymentId: `diagnostics-v1-luna-${namespace}`, provider: "vercel-ai-gateway", family: "openai", model, capability: "llm_evidence_rubric", graderVersion: "evidence-only.v1", promptDigest: gatewaySemanticPromptDigest, outputSchemaDigest: gatewaySemanticOutputSchemaDigest, configurationDigest: gatewaySemanticConfigurationDigest(model) } }).identity;
      const profileArtifact = await register({ schemaVersion: "verification-semantic-judge-profile.v1", identity }, "verification_semantic_judge_profile");
      const context: OperationContext = { contractVersion: "v1", tenantId, operationId: expectedOperationId, attemptId, missionId, workItemId, correlationId: `diagnostics-v1-${benchmarkCase.caseId}-${namespace}`, actor: { ...actor, id: randomUUID() }, capabilityVersion: "verification.v1", idempotencyKey: dispatch.idempotencyKey, reason: "Authorized D-013 bounded diagnostics v1 Luna semantic comparison", externalExecution: { runtime: "mission_control", runId: workflowId } };
      const resolver = repository.createTrustedArtifactResolver();
      await resolver.authorizeArtifact({ tenantId, artifactId: fixture.assertionsArtifact.artifactId, purpose: "verification_admission" });
      const stored = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode((await resolver.hydrateRegisteredArtifact({ tenantId, artifactId: fixture.assertionsArtifact.artifactId })).bytes)) as { readonly bundle?: { readonly assertions?: readonly { readonly assertionId: string; readonly proposition: string; readonly qualifiers: readonly string[]; readonly entityBindings: readonly { readonly role: string; readonly canonicalId: string }[]; readonly evidence: readonly { readonly fragment: { readonly fragmentId: string } }[] }[] } };
      const assertion = stored.bundle?.assertions?.[0]; assert.ok(assertion, `DIAGNOSTICS_V1_ASSERTION_REQUIRED:${benchmarkCase.caseId}`);
      const blinded = { rubricVersion: "evidence-only.v1" as const, assertionId: assertion.assertionId, proposition: assertion.proposition, qualifiers: assertion.qualifiers, entityBindings: assertion.entityBindings, fragments: assertion.evidence.map(edge => ({ fragmentId: edge.fragment.fragmentId, exactText: fixture.evidenceText })) };
      assert.ok(blinded.proposition.length + blinded.fragments.reduce((sum, fragment) => sum + fragment.exactText.length, 0) <= 2_000, `DIAGNOSTICS_V1_ACTUAL_CONTENT_BOUND:${benchmarkCase.caseId}`);
      const preflight = prepareGatewaySemanticRequest({ ...blinded, inputArtifactDigest: digestCanonicalJson(blinded) }, model);
      assert.ok(preflight.requestBytes.byteLength <= 10_000, `DIAGNOSTICS_V1_WIRE_BOUND:${benchmarkCase.caseId}`);
      plans.push({ caseId: benchmarkCase.caseId, pairCluster: benchmarkCase.pairCluster, context, request: fixture.request as VerifyClaimsRequest, expectedOperationId, workflowId, profileArtifact, expectedSemanticRequestDigest: preflight.requestDigest, frozen, benchmarkCase });
    }
    assert.equal(plans.length, maximumCalls, "DIAGNOSTICS_V1_PLAN_COUNT_REQUIRED");
    const preparedPath = outputPath.replace(/\.json$/u, ".prepared.json");
    await writeFile(preparedPath, JSON.stringify({ schemaVersion: "verification-diagnostics-v1-semantic-pairs-prepared.v1", namespace, tenantId, datasetManifestDigest: provider.authority.datasetManifestDigest, providerGrant: provider.authority, publicKeyPem, sourceHashes, plans: plans.map(plan => ({ caseId: plan.caseId, pairCluster: plan.pairCluster, operationId: plan.expectedOperationId, idempotencyKey: plan.context.idempotencyKey, requestDigest: digestCanonicalJson(plan.request), expectedSemanticRequestDigest: plan.expectedSemanticRequestDigest, inputManifestArtifactId: plan.benchmarkCase.inputManifestArtifactId, captureId: plan.benchmarkCase.evidence[0]!.captureId, projectionArtifactId: plan.benchmarkCase.evidence[0]!.projectionArtifactId, projectionDigest: plan.benchmarkCase.evidence[0]!.projectionDigest, transformationArtifactId: plan.benchmarkCase.evidence[0]!.transformationArtifactId, selectedContentDigest: plan.benchmarkCase.evidence[0]!.selectedContentDigest })), createdAt: new Date().toISOString() }, null, 2) + "\n", { flag: "wx" });
    const grants = plans.map(plan => ({ tenantId, assertions: plan.request.assertions, admissions: [{ captureId: plan.frozen.captureId, projectionArtifactId: plan.frozen.projections[0]!.projectionArtifact.artifactId, transformationArtifactId: plan.frozen.projections[0]!.transformationArtifact.artifactId }] }));
    const catalog = new VerificationClaimsProjectionGrantCatalog(grants), ownershipGrants = JSON.stringify(plans.map(plan => ({ tenantId, actor: plan.context.actor, missionId, agentDeploymentId: verifierDeploymentId, capabilityVersion: plan.context.capabilityVersion, externalExecution: plan.context.externalExecution })));
    const reads = createVerificationClaimsReportReads(database, { VERIFICATION_CLAIMS_REPORT_READ_PUBLIC_KEYS_JSON: JSON.stringify([{ keyId, publicKeyPem }]), VERIFICATION_SERVICE_OWNERSHIP_GRANTS_JSON: ownershipGrants, SUPABASE_URL: local.API_URL, SUPABASE_SECRET_KEY: local.SECRET_KEY, VERIFICATION_STORAGE_BUCKET: bucket }); assert.ok(reads, "DIAGNOSTICS_V1_TYPED_READS_REQUIRED");
    const operations = new PostgresKnowledgeOperationService(database, { admittedOperationKinds: ["verification_claims"] }), token = `diagnostics-v1-semantic-token-${namespace}`;
    server = buildServer({ publicOrigin: "http://127.0.0.1", verificationOperationService: operations, resourceReader: database, verificationClaimsReportReads: reads, isClaimsRequestAdmitted: (candidateTenant, request) => { try { if (!("assertions" in request)) return false; catalog.resolve(candidateTenant, request.assertions); return true; } catch { return false; } }, resolveIdentity: value => { const plan = plans.find(item => value === `${token}-${item.context.actor.id}`); return plan ? { actor: plan.context.actor, grants: [{ tenantId, roles: ["knowledge_operator"], scopes: [] }] } : undefined; }, resolveVerificationContext: createVerificationOwnershipResolver(database, ownershipGrants) });
    await server.listen({ host: "127.0.0.1", port: 0 }); const address = server.server.address(); assert.ok(address && typeof address !== "string"); const baseUrl = `http://127.0.0.1:${address.port}`;
    const profileGrants = plans.map(plan => ({ tenantId, operationId: plan.expectedOperationId, host: "claims" as const, role: "primary" as const, profileArtifact: plan.profileArtifact, identity: SemanticJudgeProfileSchema.parse({ schemaVersion: "verification-semantic-judge-profile.v1", identity: { deploymentId: `diagnostics-v1-luna-${namespace}`, provider: "vercel-ai-gateway", family: "openai", model: "openai/gpt-5.6-luna", capability: "llm_evidence_rubric", graderVersion: "evidence-only.v1", promptDigest: gatewaySemanticPromptDigest, outputSchemaDigest: gatewaySemanticOutputSchemaDigest, configurationDigest: gatewaySemanticConfigurationDigest("openai/gpt-5.6-luna") } }).identity }));
    worker = await startWorker({ NODE_ENV: "test", KNOWLEDGE_PERSISTENCE_MODE: "postgres", WORKER_TENANT_ID: tenantId, WORKER_POLL_MS: "25", POSTGRES_URL: dbUrl.toString(), CANONICAL_LOCAL_ONLY: "1", SUPABASE_URL: local.API_URL, SUPABASE_SECRET_KEY: local.SECRET_KEY, VERIFICATION_STORAGE_BUCKET: bucket, VERIFICATION_CLAIMS_PROJECTION_GRANTS_JSON: JSON.stringify(grants), VERIFICATION_SEAL_POLICY_GRANTS_JSON: JSON.stringify([{ tenantId, policyVersion, policyArtifact: { artifactId: policyArtifact.artifactId, digest: policyArtifact.digest } }]), VERIFICATION_PARSER_IMAGE_DIGEST: plans[0]!.frozen.projections[0]!.imageDigest, VERIFICATION_CODE_GIT_SHA: "uncommitted-diagnostics-v1-semantic-proof", VERIFICATION_CODE_DIRTY: "1", VERIFICATION_RUNTIME_PLATFORM: "node24-windows", VERIFICATION_RUNTIME_DEPLOYMENT_ID: verifierDeploymentId, VERIFICATION_SEMANTIC_RUNTIME_JSON: JSON.stringify({ classification: "public", ceilingCostMicros: RESERVATION_MICROS, reservationCostMicros: RESERVATION_MICROS, deadlineMs: 60_000 }), VERIFICATION_SEMANTIC_PROFILE_GRANTS_JSON: JSON.stringify(profileGrants), AI_GATEWAY_API_KEY: proof.gatewayApiKey, VERIFICATION_AUDIT_SIGNING_KEY_ID: keyId, VERIFICATION_AUDIT_SIGNING_PRIVATE_KEY_PEM: privateKeyPem });
    const helper = await import(pathToFileURL(resolve("../ai-engineer-mission-control/scripts/prove-verification-semantic-temporal.ts")).href) as { proveVerificationSemanticTemporal(input: { operation: "verifyClaims"; baseUrl: string; token: string; context: OperationContext; request: VerifyClaimsRequest; missionExecutionId: string; temporalAddress: string }): Promise<{ result: { operationId: string; disposition: string; state: string; receiptId?: string }; evidence: { receiptPath: string; historyPath: string } }> };
    phase = "temporal"; const results: unknown[] = []; let consecutiveFailures = 0;
    for (const plan of plans) {
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) { results.push({ caseId: plan.caseId, pairCluster: plan.pairCluster, state: "not_started", reason: "CONSECUTIVE_FAILURE_STOP" }); continue; }
      createdOperationIds.push(plan.expectedOperationId);
      try {
        const result = await helper.proveVerificationSemanticTemporal({ operation: "verifyClaims", baseUrl, token: `${token}-${plan.context.actor.id}`, context: plan.context, request: plan.request, missionExecutionId: plan.workflowId, temporalAddress });
        assert.equal(result.result.operationId, plan.expectedOperationId); assert.equal(result.result.state, "succeeded"); assert.ok(["review_required", "quality_rejected"].includes(result.result.disposition));
        const terminal = await reads.getClaims({ tenantId, operationId: plan.expectedOperationId, actor: plan.context.actor });
        const custody = await database.transaction(tenantId, async client => { const [attempts, observations, captures] = await Promise.all([client.query<{ request_sha256: string }>("select request_sha256 from orchestration.verification_provider_attempt where tenant_id=$1 and operation_id=$2", [tenantId, plan.expectedOperationId]), client.query<{ count: string }>("select count(*)::text as count from orchestration.verification_semantic_response_observation where tenant_id=$1 and operation_id=$2", [tenantId, plan.expectedOperationId]), client.query<{ count: string }>("select count(*)::text as count from orchestration.verification_provider_response_capture where tenant_id=$1 and operation_id=$2", [tenantId, plan.expectedOperationId])]); assert.equal(attempts.rows.length, 1, "DIAGNOSTICS_V1_ONE_PROVIDER_CALL_PER_CASE"); assert.ok(attempts.rows.some(row => `sha256:${row.request_sha256}` === plan.expectedSemanticRequestDigest), "DIAGNOSTICS_V1_PROVIDER_REQUEST_DIGEST_DRIFT"); assert.equal(Number(observations.rows[0]?.count ?? 0), 1, "DIAGNOSTICS_V1_OBSERVATION_REQUIRED"); assert.equal(Number(captures.rows[0]?.count ?? 0), 1, "DIAGNOSTICS_V1_CAPTURE_REQUIRED"); return { providerAttempts: 1, observations: 1, responseCaptures: 1 }; });
        results.push({ caseId: plan.caseId, pairCluster: plan.pairCluster, operationId: plan.expectedOperationId, requestDigest: digestCanonicalJson(plan.request), state: result.result.state, disposition: result.result.disposition, receiptId: result.result.receiptId, temporal: result.evidence, terminal, providerCustody: custody }); consecutiveFailures = 0;
      } catch (error) { consecutiveFailures += 1; results.push({ caseId: plan.caseId, pairCluster: plan.pairCluster, operationId: plan.expectedOperationId, state: "failed", failureCount: consecutiveFailures, errorClass: error instanceof Error ? error.name : "unknown", failureStage: "temporal_or_terminal" }); }
    }
    const retainedArtifacts = await database.transaction(tenantId, async client => (await client.query("select to_jsonb(a) as artifact,to_jsonb(m) as metadata from orchestration.artifact a join orchestration.verification_artifact_metadata m on m.tenant_id=a.tenant_id and m.artifact_id=a.id where a.tenant_id=$1 and a.producer_attempt_id=any($2::uuid[])", [tenantId, [producerAttemptId, ...plans.map(plan => plan.context.attemptId)]])).rows);
    const completed = results.filter(value => typeof value === "object" && value !== null && (value as { state?: unknown }).state === "succeeded").length, failed = results.filter(value => typeof value === "object" && value !== null && (value as { state?: unknown }).state === "failed").length, notStarted = results.filter(value => typeof value === "object" && value !== null && (value as { state?: unknown }).state === "not_started").length, passed = completed === maximumCalls && failed === 0 && notStarted === 0;
    phase = "receipt"; await writeFile(outputPath, JSON.stringify({ schemaVersion: "verification-diagnostics-v1-semantic-pairs-proof.v1", namespace, tenantId, proofDatabase: proof.database, temporalAddress, preparedPath, datasetManifestDigest: provider.authority.datasetManifestDigest, providerGrant: provider.authority, model: "openai/gpt-5.6-luna", publicKeyPem, sourceHashes, requestedCases: plans.map(plan => ({ caseId: plan.caseId, pairCluster: plan.pairCluster, inputManifestArtifactId: plan.benchmarkCase.inputManifestArtifactId, captureId: plan.benchmarkCase.evidence[0]!.captureId, projectionArtifactId: plan.benchmarkCase.evidence[0]!.projectionArtifactId, projectionDigest: plan.benchmarkCase.evidence[0]!.projectionDigest, transformationArtifactId: plan.benchmarkCase.evidence[0]!.transformationArtifactId, selectedContentDigest: plan.benchmarkCase.evidence[0]!.selectedContentDigest, assertionDigest: sha256Digest(new TextEncoder().encode(plan.benchmarkCase.assertion)), requestDigest: digestCanonicalJson(plan.request), expectedSemanticRequestDigest: plan.expectedSemanticRequestDigest })), results, resultCounts: { completed, failed, notStarted, requested: maximumCalls }, retainedArtifacts, checks: { exactV1GrantAssertionExcerptInputCrossbinding: true, distinctClaimsContexts: plans.length === new Set(plans.map(plan => plan.context.attemptId)).size, serialExecution: true, scope, maximumCalls, reservationMicrosPerCall: RESERVATION_MICROS, automaticQualityRetries: 0, stopAfterThreeConsecutiveFailures: true, typedTerminalsAndSignedAuditArtifactsRetainedPerSucceededCase: true }, passed, limitations: ["Missing-two scope is a new engineering attempt; earlier failed attempts remain retained and count toward costs, not single-pass quality", "Luna only; no cross-family or Terra comparison", "No human labels, policy promotion, or admission change", "Full VR-041 mutation-family coverage remains unavailable"], sourceSha256: createHash("sha256").update(await readFile(new URL(import.meta.url))).digest("hex") }, null, 2) + "\n", { flag: "wx" });
    if (!passed) process.exitCode = 1;
  } catch (error) { await writeFile(failurePath, JSON.stringify({ schemaVersion: "verification-diagnostics-v1-semantic-pairs-failure.v1", namespace, phase, proofDatabase: proof.database, createdOperationIds, errorClass: error instanceof Error ? error.name : "unknown", failureStage: "temporal_or_terminal" }, null, 2) + "\n", { flag: "wx" }).catch(() => undefined); throw error; }
  finally { if (worker) await worker.stop("diagnostics-v1-semantic-pairs"); if (server) await server.close(); await database.close(); }
  process.stdout.write(`${JSON.stringify({ output: outputPath })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runDiagnosticsV1SemanticPairs().catch(error => { process.stderr.write(`${JSON.stringify({ event: "verification.diagnostics_v1_semantic_pairs.failed", error: error instanceof Error ? error.message : "unknown" })}\n`); process.exitCode = 1; });







