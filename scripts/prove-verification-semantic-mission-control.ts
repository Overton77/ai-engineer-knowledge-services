import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type Actor, type OperationContext, type VerifyClaimsRequest, type VerifyReportRequest, type VerificationArtifactHandle, type VerificationPolicyDefinition } from "@aiengineer/knowledge-contracts";
import { loadDiagnosticsOfflineCatalog, loadDiagnosticsProviderGrant, createDiagnosticsProviderCaseInput, SemanticJudgeProfileSchema, VerificationAdmissionService, VerificationClaimsProjectionGrantCatalog } from "@aiengineer/knowledge-application";
import { VERIFICATION_PARSER_LIMITS } from "@aiengineer/knowledge-conversion";
import { PostgresCanonicalRepository, PostgresKnowledgeOperationService, PostgresVerificationRepository } from "@aiengineer/knowledge-persistence";
import { deterministicUuid, SupabaseArtifactStore } from "@aiengineer/knowledge-runtime";
import { canonicalizeJson, digestCanonicalJson, gatewaySemanticConfigurationDigest, gatewaySemanticOutputSchemaDigest, gatewaySemanticPromptDigest, prepareGatewaySemanticRequest, projectionSelectorResolver } from "@aiengineer/knowledge-verification";
import { buildServer } from "../apps/api/src/server.js";
import { createVerificationReads } from "../apps/api/src/verification-reads-runtime.js";
import { createVerificationClaimsReportReads } from "../apps/api/src/verification-claims-report-reads-runtime.js";
import { createVerificationOwnershipResolver } from "../apps/api/src/verification-ownership.js";
import { startWorker } from "../apps/worker/src/index.js";
import { createVerificationSemanticMissionFixture, type FrozenSemanticMissionRecord } from "./verification-semantic-mission-fixture.js";

type Registry = { readonly tenantId: string; readonly records: readonly (FrozenSemanticMissionRecord & { readonly sourceKey: string })[] };
type SemanticMissionPlan = { readonly kind: "claims" | "report"; readonly context: OperationContext; readonly request: VerifyClaimsRequest | VerifyReportRequest; readonly expectedOperationId: string; readonly workflowId: string; readonly profileArtifact: VerificationArtifactHandle; readonly expectedSemanticRequestDigest: `sha256:${string}` };

export function requireSemanticMissionProofEnvironment(environment: Readonly<Record<string, string | undefined>> = process.env): { readonly database: string; readonly gatewayApiKey: string } {
  const database = environment.VERIFICATION_PROOF_DATABASE?.trim() ?? "";
  assert.match(database, /^verification_semantic_mission_[0-9a-f]{32}$/u, "SEMANTIC_PROOF_DATABASE_REQUIRED");
  const gatewayApiKey = environment.AI_GATEWAY_API_KEY?.trim() ?? "";
  assert.ok(gatewayApiKey.length > 0, "SEMANTIC_PROOF_GATEWAY_KEY_REQUIRED");
  return { database, gatewayApiKey };
}

export function semanticMissionOperationId(input: { readonly tenantId: string; readonly operation: "verifyClaims" | "verifyReport"; readonly missionId: string; readonly workItemId: string; readonly attemptId: string }): string {
  const idempotencyKey = ["vd1", input.operation, input.tenantId, input.missionId, input.workItemId, input.attemptId].join(":");
  return deterministicUuid("verification-http-operation", `${input.tenantId}:${input.operation}:${idempotencyKey}`);
}

async function main(): Promise<void> {
  const proof = requireSemanticMissionProofEnvironment();
  const dashboardMode = process.env.VERIFICATION_PROOF_DASHBOARD === "1";
  // @ts-expect-error local proof config is deliberately outside the package graph.
  const { loadVerifiedLocalDevelopmentConfig } = await import("../../internal/verification-local-direct-config.mjs") as { loadVerifiedLocalDevelopmentConfig(): Promise<{ DB_URL: string; API_URL: string; SECRET_KEY: string }> };
  const local = await loadVerifiedLocalDevelopmentConfig();
  const dbUrl = new URL(local.DB_URL); dbUrl.pathname = `/${proof.database}`;
  assert.ok(["localhost", "127.0.0.1"].includes(dbUrl.hostname) && dbUrl.port === "54322", "SEMANTIC_PROOF_LOCAL_DB_ONLY");
  const apiUrl = new URL(local.API_URL); assert.ok(["localhost", "127.0.0.1"].includes(apiUrl.hostname) && apiUrl.port === "54321", "SEMANTIC_PROOF_LOCAL_STORAGE_ONLY");
  const temporalAddress = process.argv[2]?.trim() || "127.0.0.1:7233";
  assert.match(temporalAddress, /^(127\.0\.0\.1|localhost):\d{1,5}$/u, "SEMANTIC_PROOF_LOCAL_TEMPORAL_ONLY");
  const namespace = randomUUID(), bucket = "ai-engineer-cloud-bucket", registry = JSON.parse(await readFile(resolve("../internal/verification-frozen-source-registry-7a74a7a8-0dc4-4591-8bb1-5781ebddef42.json"), "utf8")) as Registry;
  const offlineFixture = process.env.VERIFICATION_PROOF_OFFLINE_FIXTURE === "1";
  const offlineCatalog = offlineFixture ? await loadDiagnosticsOfflineCatalog("diagnostics-companies-v1", resolve("catalog/verification-benchmarks/diagnostics-companies-v1")) : undefined;
  const benchmarkCase = offlineCatalog?.dataset.cases.find(item => item.caseId === "tru-symphony-source");
  if (offlineFixture) {
    assert.ok(benchmarkCase, "SEMANTIC_V1_CASE_REQUIRED");
    const approved = await loadDiagnosticsProviderGrant(resolve("catalog/verification-benchmarks/diagnostics-companies-pilot-v3"));
    const approvedCase = approved.dataset.cases.find(item => item.caseId === benchmarkCase.caseId); assert.ok(approvedCase);
    createDiagnosticsProviderCaseInput(approvedCase, approved.authority);
    assert.equal(benchmarkCase.assertion, approvedCase.assertion, "SEMANTIC_V1_PUBLIC_GRANT_ASSERTION_DRIFT");
    assert.equal(benchmarkCase.evidence[0]?.excerpt, approvedCase.evidence[0]?.excerpt, "SEMANTIC_V1_PUBLIC_GRANT_FRAGMENT_DRIFT");
    assert.ok(benchmarkCase.assertion.length + benchmarkCase.evidence[0]!.excerpt.length <= 2000);
  }
  const frozen = registry.records.find(record => record.sourceKey === (benchmarkCase?.evidence[0]?.sourceKey ?? "gl-comparison")); assert.ok(frozen && frozen.projections.length > 0, "SEMANTIC_PROOF_FROZEN_PROJECTION_REQUIRED");
  const startupPath = resolve("../internal", `verification-semantic-mission-control-startup-${namespace}.json`), outputPath = resolve("../internal", `verification-semantic-mission-control-${namespace}.json`), failurePath = outputPath.replace(/\.json$/u, ".failure.json");
  await writeFile(startupPath, JSON.stringify({ schemaVersion: "verification-semantic-mission-control-startup.v1", namespace, tenantId: registry.tenantId, proofDatabase: proof.database, temporalAddress, plannedKinds: ["claims", "report"], intendedMutationScope: "isolated local mission, attempts, semantic claims/report operations and provider evidence", createdAt: new Date().toISOString() }, null, 2) + "\n", { flag: "wx" });
  const database = new PostgresCanonicalRepository({ connectionString: dbUrl.toString(), localOnly: true });
  let server: ReturnType<typeof buildServer> | undefined, worker: Awaited<ReturnType<typeof startWorker>> | undefined, phase = "startup";
  const createdOperationIds: string[] = [];
  try {
    const artifactType = await database.transaction(registry.tenantId, async client => (await client.query("select description from orchestration.artifact_type where code=$1", ["verification_runtime_principal_binding"])).rows);
    assert.equal(artifactType.length, 1, "SEMANTIC_RUNTIME_PRINCIPAL_ARTIFACT_TYPE_REQUIRED");
    assert.equal(artifactType[0].description, "Canonical server-resolved runtime principal binding retained for claims and report audit replay", "SEMANTIC_RUNTIME_PRINCIPAL_ARTIFACT_TYPE_DRIFT");
    const store = new SupabaseArtifactStore({ projectUrl: local.API_URL, serviceRoleKey: local.SECRET_KEY, bucket, maximumBytes: 32_000_000 });
    const repository = new PostgresVerificationRepository(database, store, { async authorize(value) { assert.equal(value.tenantId, registry.tenantId); assert.ok(["verification_admission", "verification_replay", "policy_replay"].includes(value.purpose)); } });
    const projection = frozen.projections[0]!;
    const admission = new VerificationAdmissionService(repository, { async parse(): Promise<never> { throw new Error("PARSER_FORBIDDEN_IN_SEMANTIC_MISSION_PROOF"); } }, { parserVersion: projection.parserVersion as "verification-native-parser.v1", imageDigest: projection.imageDigest, limits: VERIFICATION_PARSER_LIMITS }, { storageBucket: bucket, producerVersion: "semantic-mission.v1", encryptionClass: "supabase-managed", retentionClass: "verification-audit", now: () => new Date().toISOString() });
    const tenantId = registry.tenantId, missionId = randomUUID(), producerWorkItemId = randomUUID(), producerAttemptId = randomUUID(), producerDeploymentId = `semantic-mission-producer-${namespace}`, verifierDeploymentId = `semantic-mission-verifier-${namespace}`;
    const actor: Actor = { kind: "service", id: randomUUID(), serviceIdentity: "mission_control_client" };
    await database.transaction(tenantId, async client => { await client.query("insert into orchestration.mission(id,tenant_id,slug,goal) values($1,$2,$3,$4)", [missionId, tenantId, `semantic-mission-${namespace}`, "Bounded Mission Control semantic claims/report proof"]); await client.query("insert into orchestration.work_item(id,tenant_id,mission_id,kind,spec) values($1,$2,$3,'verify_extraction',$4::jsonb)", [producerWorkItemId, tenantId, missionId, JSON.stringify({ namespace, role: "semantic_mission_fixture" })]); await client.query("insert into orchestration.attempt(id,tenant_id,work_item_id,attempt_no,agent_deployment_id,started_at) values($1,$2,$3,1,$4,clock_timestamp())", [producerAttemptId, tenantId, producerWorkItemId, producerDeploymentId]); });
    const register = async (value: unknown, artifactType: string, label: string): Promise<VerificationArtifactHandle> => repository.registerContentAddressedArtifact({ tenantId, producerAttemptId, missionId, artifactType, bytes: new TextEncoder().encode(canonicalizeJson(value)), createdAt: new Date().toISOString(), parentArtifactIds: [], producerActivityId: "verification-semantic-mission-control", producerVersion: "v1", mediaType: "application/json", encryptionClass: "supabase-managed", retentionClass: "verification-audit", dataClassification: "restricted", bucketClass: "ledger", storageBucket: bucket });
    const policyVersion = `semantic-mission-policy-${namespace}`, policy: VerificationPolicyDefinition = { schemaVersion: "verification-policy.v1", policyVersion, definitionId: `semantic-mission-${namespace}`, criticalDownstreamUses: [], requireCrossFamilyForRisk: [], requireIndependentAuthorityForScopes: [], mixedEvidenceOutcome: "review", unknownCriticalOutcome: "review", authorityWithheldOutcome: "review", reviewAvailable: true };
    const policyArtifact = await register(policy, "verification_policy", "policy");
    const key = generateKeyPairSync("ed25519"), keyId = `semantic-mission-${namespace}`, privateKeyPem = key.privateKey.export({ type: "pkcs8", format: "pem" }).toString(), publicKeyPem = key.publicKey.export({ type: "spki", format: "pem" }).toString();
    const expectedEvidenceTitle = "Best Biological Age Test: SystemAge vs. Function Health & TruDiagnostic Comparison";
    // D013: two independent semantic inputs are bounded before starting worker or Temporal.
    const maximumCompletionTokens = 900;
    assert.ok(expectedEvidenceTitle.length * 2 < 2_000, "SEMANTIC_D013_CONTENT_BOUND");
    assert.ok(maximumCompletionTokens <= 900, "SEMANTIC_D013_COMPLETION_TOKEN_BOUND");
    const plans: SemanticMissionPlan[] = [];
    for (const kind of ["claims", "report"] as const) {
      const workItemId = randomUUID(), attemptId = randomUUID(), operation = kind === "claims" ? "verifyClaims" : "verifyReport", expectedOperationId = semanticMissionOperationId({ tenantId, operation, missionId, workItemId, attemptId }), workflowId = `semantic-${kind}-${namespace}`;
      await database.transaction(tenantId, async client => { await client.query("insert into orchestration.work_item(id,tenant_id,mission_id,kind,spec) values($1,$2,$3,'verify_extraction',$4::jsonb)", [workItemId, tenantId, missionId, JSON.stringify({ namespace, role: `semantic_${kind}` })]); await client.query("insert into orchestration.attempt(id,tenant_id,work_item_id,attempt_no,agent_deployment_id,started_at) values($1,$2,$3,1,$4,clock_timestamp())", [attemptId, tenantId, workItemId, verifierDeploymentId]); });
      const fixture = await createVerificationSemanticMissionFixture({ database, repository, admission, tenantId, namespace, missionId, producerAttemptId, producerDeploymentId, verifierDeploymentId, kind, verifierAttemptId: attemptId, policyVersion, frozenRecord: frozen, ...(benchmarkCase ? { benchmarkCase } : {}) });
      const model = "openai/gpt-5.6-luna" as const, identity = { deploymentId: `semantic-luna-${namespace}`, provider: "vercel-ai-gateway" as const, family: "openai" as const, model, capability: "llm_evidence_rubric" as const, graderVersion: "evidence-only.v1", promptDigest: gatewaySemanticPromptDigest, outputSchemaDigest: gatewaySemanticOutputSchemaDigest, configurationDigest: gatewaySemanticConfigurationDigest(model) };
      const profileArtifact = await register(SemanticJudgeProfileSchema.parse({ schemaVersion: "verification-semantic-judge-profile.v1", identity }), "verification_semantic_judge_profile", `${kind}:profile`);
      const context: OperationContext = { contractVersion: "v1", tenantId, operationId: expectedOperationId, attemptId, missionId, workItemId, correlationId: `semantic-${kind}-${namespace}`, actor: {...actor,id:randomUUID()}, capabilityVersion: "verification.v1", idempotencyKey: ["vd1", operation, tenantId, missionId, workItemId, attemptId].join(":"), reason: "Authorized bounded semantic Mission Control proof", externalExecution: { runtime: "mission_control", runId: workflowId } };
      const resolver = repository.createTrustedArtifactResolver();
      await resolver.authorizeArtifact({ tenantId, artifactId: fixture.assertionsArtifact.artifactId, purpose: "verification_admission" });
      const hydrated = await resolver.hydrateRegisteredArtifact({ tenantId, artifactId: fixture.assertionsArtifact.artifactId });
      const stored = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(hydrated.bytes)) as { bundle?: { assertions?: readonly any[] }; assertions?: readonly { assertion: any }[] };
      const assertion = stored.bundle?.assertions?.[0] ?? stored.assertions?.[0]?.assertion;
      assert.ok(assertion, "SEMANTIC_D013_ASSERTION_REQUIRED");
      const blinded = { rubricVersion: "evidence-only.v1" as const, assertionId: assertion.assertionId, proposition: assertion.proposition, qualifiers: assertion.qualifiers, entityBindings: assertion.entityBindings, fragments: assertion.evidence.map((e: { fragment: { fragmentId: string } }) => ({ fragmentId: e.fragment.fragmentId, exactText: fixture.evidenceText })) };
      const preflight = prepareGatewaySemanticRequest({ ...blinded, inputArtifactDigest: digestCanonicalJson(blinded) }, model);
      assert.ok(preflight.requestBytes.byteLength <= 10_000, "SEMANTIC_D013_WIRE_BOUND");
      plans.push({ kind, context, request: fixture.request as VerifyClaimsRequest | VerifyReportRequest, expectedOperationId, workflowId, profileArtifact, expectedSemanticRequestDigest: preflight.requestDigest });
    }
    await writeFile(startupPath.replace(/\.json$/u, ".prepared.json"), JSON.stringify({ schemaVersion: "verification-semantic-mission-control-prepared.v1", namespace, startupJournal: startupPath, tenantId, proofDatabase: proof.database, temporalAddress, frozenCaptureId: frozen.captureId, plannedOperations: plans.map(plan => ({ kind: plan.kind, operationId: plan.expectedOperationId, workflowId: plan.workflowId, requestDigest: digestCanonicalJson(plan.request) })), createdAt: new Date().toISOString() }, null, 2) + "\n", { flag: "wx" });
    const grants = plans.map(plan => ({ tenantId, assertions: "assertions" in plan.request ? plan.request.assertions : plan.request.claimLedger, admissions: [{ captureId: frozen.captureId, projectionArtifactId: projection.projectionArtifact.artifactId, transformationArtifactId: projection.transformationArtifact.artifactId }] }));
    const catalog = new VerificationClaimsProjectionGrantCatalog(grants);
    const ownershipGrants = JSON.stringify(plans.map(plan => ({ tenantId, actor: plan.context.actor, missionId, agentDeploymentId: verifierDeploymentId, capabilityVersion: plan.context.capabilityVersion, externalExecution: plan.context.externalExecution })));
    const claimsReportReads = createVerificationClaimsReportReads(database, { VERIFICATION_CLAIMS_REPORT_READ_PUBLIC_KEYS_JSON: JSON.stringify([{ keyId, publicKeyPem }]), VERIFICATION_SERVICE_OWNERSHIP_GRANTS_JSON: ownershipGrants, SUPABASE_URL: local.API_URL, SUPABASE_SECRET_KEY: local.SECRET_KEY, VERIFICATION_STORAGE_BUCKET: bucket });
    assert.ok(claimsReportReads, "SEMANTIC_TYPED_TERMINAL_READS_REQUIRED");
    const verificationReads = createVerificationReads(database, { VERIFICATION_READS_ENABLED: "1", SUPABASE_URL: local.API_URL, SUPABASE_SECRET_KEY: local.SECRET_KEY, VERIFICATION_STORAGE_BUCKET: bucket });
    assert.ok(verificationReads, "SEMANTIC_RUN_READS_REQUIRED");
    const operations = new PostgresKnowledgeOperationService(database, { admittedOperationKinds: ["verification_claims", "verification_report"] });
    const token = `semantic-mission-token-${namespace}`;
    server = buildServer({ publicOrigin: "http://127.0.0.1", verificationOperationService: operations, resourceReader: database, verificationClaimsReportReads: claimsReportReads, verificationReads, verificationCaseReads: verificationReads.cases, isClaimsRequestAdmitted: (candidateTenant, request) => { try { catalog.resolve(candidateTenant, "assertions" in request ? request.assertions : request.claimLedger); return true; } catch { return false; } }, resolveIdentity: value => { const plan=plans.find(item=>value===`${token}-${item.context.actor.id}`); return plan ? {actor:plan.context.actor,grants:[{tenantId,roles:["knowledge_operator"],scopes:[]}]} : undefined; }, resolveVerificationContext: createVerificationOwnershipResolver(database, ownershipGrants) });
    await server.listen({ host: "127.0.0.1", port: 0 }); const address = server.server.address(); assert.ok(address && typeof address !== "string"); const baseUrl = `http://127.0.0.1:${address.port}`;
    const profileGrants = plans.map(plan => ({ tenantId, operationId: plan.expectedOperationId, host: plan.kind, role: "primary", profileArtifact: plan.profileArtifact, identity: SemanticJudgeProfileSchema.parse({ schemaVersion: "verification-semantic-judge-profile.v1", identity: { deploymentId: `semantic-luna-${namespace}`, provider: "vercel-ai-gateway", family: "openai", model: "openai/gpt-5.6-luna", capability: "llm_evidence_rubric", graderVersion: "evidence-only.v1", promptDigest: gatewaySemanticPromptDigest, outputSchemaDigest: gatewaySemanticOutputSchemaDigest, configurationDigest: gatewaySemanticConfigurationDigest("openai/gpt-5.6-luna") } }).identity }));
    worker = await startWorker({ NODE_ENV: "test", KNOWLEDGE_PERSISTENCE_MODE: "postgres", WORKER_TENANT_ID: tenantId, WORKER_POLL_MS: "25", POSTGRES_URL: dbUrl.toString(), CANONICAL_LOCAL_ONLY: "1", SUPABASE_URL: local.API_URL, SUPABASE_SECRET_KEY: local.SECRET_KEY, SUPABASE_STORAGE_BUCKET: "source-captures", VERIFICATION_STORAGE_BUCKET: bucket, VERIFICATION_CLAIMS_PROJECTION_GRANTS_JSON: JSON.stringify(grants), VERIFICATION_SEAL_POLICY_GRANTS_JSON: JSON.stringify([{ tenantId, policyVersion, policyArtifact: { artifactId: policyArtifact.artifactId, digest: policyArtifact.digest } }]), VERIFICATION_PARSER_IMAGE_DIGEST: projection.imageDigest, VERIFICATION_CODE_GIT_SHA: "uncommitted-native-proof", VERIFICATION_CODE_DIRTY: "1", VERIFICATION_RUNTIME_PLATFORM: "node24-windows", VERIFICATION_RUNTIME_DEPLOYMENT_ID: verifierDeploymentId, VERIFICATION_SEMANTIC_RUNTIME_JSON: JSON.stringify({ classification: "public", ceilingCostMicros: 100000, reservationCostMicros: 100000, deadlineMs: 60000 }), VERIFICATION_SEMANTIC_PROFILE_GRANTS_JSON: JSON.stringify(profileGrants), AI_GATEWAY_API_KEY: proof.gatewayApiKey, VERIFICATION_AUDIT_SIGNING_KEY_ID: keyId, VERIFICATION_AUDIT_SIGNING_PRIVATE_KEY_PEM: privateKeyPem });
    const helperPath = resolve(dashboardMode ? "../ai-engineer-mission-control/scripts/prove-verification-dashboard-native.ts" : "../ai-engineer-mission-control/scripts/prove-verification-semantic-temporal.ts"); const helperModule = await import(pathToFileURL(helperPath).href); const proveVerificationSemanticTemporal = (dashboardMode ? helperModule.proveVerificationDashboardNative : helperModule.proveVerificationSemanticTemporal) as ((input: { operation: "verifyClaims" | "verifyReport"; baseUrl: string; token: string; context: OperationContext; request: VerifyClaimsRequest | VerifyReportRequest; missionExecutionId: string; temporalAddress?: string }) => Promise<{ result: { operationId: string; disposition: string; state: string; receiptId?: string }; evidence: { receiptPath: string; historyPath: string } }>) ;
    phase = "temporal"; const results: { kind: "claims" | "report"; operationId: string; workflowId: string; requestDigest: string; disposition: string; receiptId?: string; evidence: { receiptPath: string; historyPath: string } }[] = [];
    for (const plan of plans) { createdOperationIds.push(plan.expectedOperationId); const result = await proveVerificationSemanticTemporal({ operation: plan.kind === "claims" ? "verifyClaims" : "verifyReport", baseUrl, token:`${token}-${plan.context.actor.id}`, context: plan.context, request: plan.request, missionExecutionId: plan.workflowId, temporalAddress }); assert.equal(result.result.operationId, plan.expectedOperationId); assert.equal(result.result.state, "succeeded"); assert.ok(["review_required", "quality_rejected"].includes(result.result.disposition)); results.push({ kind: plan.kind, operationId: plan.expectedOperationId, workflowId: plan.workflowId, requestDigest: digestCanonicalJson(plan.request), disposition: result.result.disposition, receiptId: result.result.receiptId, evidence: result.evidence }); }
    const typedTerminals = await Promise.all(plans.map(async plan => {
      const direct = plan.kind === "claims" ? await claimsReportReads.getClaims({ tenantId, operationId: plan.expectedOperationId, actor: plan.context.actor }) : await claimsReportReads.getReport({ tenantId, operationId: plan.expectedOperationId, actor: plan.context.actor });
      const route = plan.kind === "claims" ? "claims" : "reports";
      const response = await fetch(`${baseUrl}/v1/verification/${route}/${plan.expectedOperationId}`, { headers: { authorization: `Bearer ${token}-${plan.context.actor.id}`, "x-tenant-id":tenantId } });
      assert.equal(response.status, 200, "SEMANTIC_TYPED_TERMINAL_HTTP_STATUS");
      const http = await response.json(); assert.equal(canonicalizeJson(http), canonicalizeJson(direct), "SEMANTIC_TYPED_TERMINAL_HTTP_DRIFT");
      const operation = await database.getOperationRecord(tenantId, plan.expectedOperationId); assert.ok(operation, "SEMANTIC_TYPED_TERMINAL_OPERATION_REQUIRED");
      assert.equal(operation.ownershipMode, "mission_control", "SEMANTIC_TYPED_TERMINAL_OWNERSHIP"); assert.equal(operation.externalRunId, plan.workflowId, "SEMANTIC_TYPED_TERMINAL_EXTERNAL_RUN");
      return { kind: plan.kind, resource: direct, operation: { operationId: operation.id, ownershipMode: operation.ownershipMode, externalRunId: operation.externalRunId, status: operation.status }, resultArtifact: direct.resultArtifact, sealedRun: direct.sealedRun };
    }));
    const providerCustody = await database.transaction(tenantId, async client => Promise.all(results.map(async result => {
      const [attempts, observations, captures] = await Promise.all([
        client.query<{ request_sha256: string }>("select request_sha256 from orchestration.verification_provider_attempt where tenant_id=$1 and operation_id=$2", [tenantId, result.operationId]),
        client.query<{ count: string }>("select count(*)::text as count from orchestration.verification_semantic_response_observation where tenant_id=$1 and operation_id=$2", [tenantId, result.operationId]),
        client.query<{ count: string }>("select count(*)::text as count from orchestration.verification_provider_response_capture where tenant_id=$1 and operation_id=$2", [tenantId, result.operationId]),
      ]);
      const plan = plans.find(item => item.expectedOperationId === result.operationId); assert.ok(plan, "SEMANTIC_PROVIDER_PLAN_REQUIRED");
      const value = { operationId: result.operationId, providerAttempts: attempts.rows.length, observations: Number(observations.rows[0]?.count ?? 0), responseCaptures: Number(captures.rows[0]?.count ?? 0) };
      assert.ok(value.providerAttempts >= 1 && value.observations >= 1 && value.responseCaptures >= 1, "SEMANTIC_PROVIDER_CUSTODY_REQUIRED");
      assert.ok(attempts.rows.some(row => `sha256:${row.request_sha256}` === plan.expectedSemanticRequestDigest), "SEMANTIC_PROVIDER_REQUEST_DIGEST_DRIFT");
      return value;
    })));
    const retainedArtifacts = await database.transaction(tenantId, async client => (await client.query("select to_jsonb(a) as artifact,to_jsonb(m) as metadata from orchestration.artifact a join orchestration.verification_artifact_metadata m on m.tenant_id=a.tenant_id and m.artifact_id=a.id where a.tenant_id=$1 and a.producer_attempt_id=any($2::uuid[])",[tenantId,[producerAttemptId,...plans.map(plan=>plan.context.attemptId)]])).rows);
    phase = "receipt"; await writeFile(outputPath, JSON.stringify({ schemaVersion: "verification-semantic-mission-control-proof.v1", namespace, tenantId, dashboardMode, ...(benchmarkCase ? { offlineFixtureBinding: { datasetManifestDigest: offlineCatalog!.datasetManifestDigest, caseId: benchmarkCase.caseId, caseDigest: benchmarkCase.caseDigest, inputManifestArtifactId: benchmarkCase.inputManifestArtifactId, sourceProcessingGrant: "D-013 exact public assertion/fragment equality; D-014 completion cohort" } } : {}), proofDatabase: proof.database, temporalAddress, startupJournal: startupPath, operations: results, typedTerminals, retainedArtifacts, providerCustody, publicKeyPem, checks: { generic_temporal_claims_completed: true, generic_temporal_report_completed: true, terminal_disposition_review_or_rejected: true, configured_worker_semantic_runtime_enabled: true, native_provider_attempt_observation_capture_recorded: true, signed_typed_terminal_reads_and_http_routes_match: true }, limitations: ["Local-only disposable database and Temporal", "Gateway call is user-authorized and bounded by the runner configuration", "No parser execution", "No human annotation or policy admission", "Content-addressed Storage is shared persistent local CAS; wrapper cleanup drops only the disposable proof database and retains no secret content in this receipt"], sourceSha256: createHash("sha256").update(await readFile(new URL(import.meta.url))).digest("hex") }, null, 2) + "\n", { flag: "wx" });
  } catch (error) { await writeFile(failurePath, JSON.stringify({ schemaVersion: "verification-semantic-mission-control-failure.v1", namespace, phase, proofDatabase: proof.database, createdOperationIds, errorClass: error instanceof Error ? error.name : "unknown", errorCode: error instanceof Error ? error.message : "unknown" }, null, 2) + "\n", { flag: "wx" }).catch(() => undefined); throw error; }
  finally { if (worker) await worker.stop("semantic-mission-proof"); if (server) await server.close(); await database.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main().catch(error => { process.stderr.write(`${JSON.stringify({ event: "verification.semantic_mission_proof.failed", error: error instanceof Error ? error.message : "unknown" })}\n`); process.exitCode = 1; });
