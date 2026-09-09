import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { cp, rm, symlink } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type Actor, type OperationContext, type VerifyClaimsRequest, type VerifyReportRequest, type VerificationArtifactHandle, type VerificationPolicyDefinition } from "@aiengineer/knowledge-contracts";
import { loadDiagnosticsV1ProviderGrant, SemanticJudgeProfileSchema, VerificationAdmissionService, VerificationClaimsProjectionGrantCatalog } from "@aiengineer/knowledge-application";
import { VERIFICATION_PARSER_LIMITS } from "@aiengineer/knowledge-conversion";
import { PostgresCanonicalRepository, PostgresKnowledgeOperationService, PostgresVerificationRepository } from "@aiengineer/knowledge-persistence";
import { deterministicUuid, SupabaseArtifactStore } from "@aiengineer/knowledge-runtime";
import { canonicalizeJson, digestCanonicalJson, gatewaySemanticConfigurationDigest, gatewaySemanticOutputSchemaDigest, gatewaySemanticPromptDigest, prepareGatewaySemanticRequest, projectionSelectorResolver } from "@aiengineer/knowledge-verification";
import { buildServer } from "../apps/api/src/server.js";
import { createVerificationReads } from "../apps/api/src/verification-reads-runtime.js";
import { createVerificationClaimsReportReads } from "../apps/api/src/verification-claims-report-reads-runtime.js";
import { createVerificationOwnershipResolver } from "../apps/api/src/verification-ownership.js";
import { startWorker } from "../apps/worker/src/index.js";
import { createVerificationAgentReportFixture, type AgentReportFrozenRecord } from "./verification-agent-report-fixture.js";

type Registry = { readonly tenantId: string; readonly records: readonly (AgentReportFrozenRecord & { readonly sourceKey: string })[] };
type CursorInput = { readonly reportMarkdown: string; readonly assertion: { readonly text: string; readonly start: number; readonly end: number; readonly citation?: { readonly start: number; readonly end: number } }; readonly producerAgentId: string; readonly producerRunId: string };
type SemanticMissionPlan = { readonly kind: "claims" | "report"; readonly context: OperationContext; readonly request: VerifyClaimsRequest | VerifyReportRequest; readonly expectedOperationId: string; readonly workflowId: string; readonly profileArtifact: VerificationArtifactHandle; readonly expectedSemanticRequestDigest: `sha256:${string}` };

export function requireEveNegativeProofEnvironment(environment: Readonly<Record<string, string | undefined>> = process.env): { readonly database: string; readonly negativeCase: "same_deployment" | "corrupted_locator"; readonly deadlineMs: number } {
  const database = environment.VERIFICATION_PROOF_DATABASE?.trim() ?? "";
  assert.match(database, /^verification_eve_negative_[0-9a-f]{32}$/u, "EVE_NEGATIVE_PROOF_DATABASE_REQUIRED");
  const negativeCase = environment.VERIFICATION_EVE_NEGATIVE_CASE;
  assert.ok(negativeCase === "same_deployment" || negativeCase === "corrupted_locator", "EVE_NEGATIVE_CASE_REQUIRED");
  const deadlineValue = environment.VERIFICATION_EVE_NEGATIVE_DEADLINE_MS?.trim() ?? "";
  assert.match(deadlineValue, /^\d{13}$/u, "EVE_NEGATIVE_DEADLINE_REQUIRED");
  const deadlineMs = Number(deadlineValue);
  assert.ok(Number.isSafeInteger(deadlineMs) && deadlineMs > Date.now(), "EVE_NEGATIVE_DEADLINE_EXPIRED");
  return { database, negativeCase, deadlineMs };
}

export function eveReportOperationId(tenantId: string, idempotencyKey: string): string {
  return deterministicUuid("verification-http-operation", `${tenantId}:verifyReport:${idempotencyKey}`);
}

async function runEveCommand(executable: string, args: readonly string[], environment: NodeJS.ProcessEnv, cwd: string, timeoutMs: number): Promise<{ readonly exitCode: number | null; readonly stdout: string; readonly stderr: string }> {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(executable, [...args], { cwd, env: environment, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, timeout: timeoutMs, killSignal: "SIGTERM" });
    let stdout = "", stderr = "";
    child.stdout.on("data", value => { stdout += String(value); });
    child.stderr.on("data", value => { stderr += String(value); });
    child.once("error", reject);
    child.once("close", exitCode => resolveCommand({ exitCode, stdout, stderr }));
  });
}

function safeEveEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const name of ["APPDATA", "ComSpec", "HOMEDRIVE", "HOMEPATH", "LOCALAPPDATA", "PATH", "PATHEXT", "SystemRoot", "TEMP", "TMP", "USERPROFILE"]) {
    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  }
  return environment;
}

function publicCommandTail(value: string): string {
  return value
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/gu, "[redacted-pem]")
    .replace(/Bearer\s+[^\s"']+/giu, "Bearer [redacted]")
    .replace(/(?:AI_GATEWAY_API_KEY|KNOWLEDGE_API_TOKEN|EVE_VERIFICATION_SIGNING_PRIVATE_KEY_PEM)=[^\s]+/giu, "$1=[redacted]")
    .replace(/(?:https?|postgres(?:ql)?):\/\/[^\s"']+/giu, "[redacted-url]")
    .slice(-4_000);
}

function parseEveToolReceipt(stdout: string, expectedOperationId: string, expectedStatus: "succeeded" | "failed"): Record<string, unknown> {
  const line = stdout.split(/\r?\n/u).find(value => value.startsWith("EVE_NEGATIVE_TOOL_RECEIPT="));
  assert.ok(line, "EVE_NEGATIVE_TOOL_RECEIPT_MISSING");
  const receipt = JSON.parse(line.slice("EVE_NEGATIVE_TOOL_RECEIPT=".length)) as Record<string, unknown>;
  assert.equal(receipt.status, expectedStatus, "EVE_NEGATIVE_TOOL_RECEIPT_STATUS");
  assert.equal(receipt.operationId, expectedOperationId, "EVE_NEGATIVE_TOOL_RECEIPT_OPERATION");
  const permitted = expectedStatus === "succeeded"
    ? ["status", "operationId", "host", "intent", "tenantId", "requestDigest", "sealedRun", "disposition"]
    : ["status", "operationId", "host", "intent", "tenantId", "requestDigest", "failureCode"];
  assert.ok(Object.keys(receipt).every(key => permitted.includes(key)), "EVE_NEGATIVE_TOOL_RECEIPT_KEYS");
  return receipt;
}

async function main(): Promise<void> {
  const proof = requireEveNegativeProofEnvironment();
  const remainingDeadlineMs = () => proof.deadlineMs - Date.now();
  // @ts-expect-error local proof config is deliberately outside the package graph.
  const { loadVerifiedLocalDevelopmentConfig } = await import("../../internal/verification-local-direct-config.mjs") as { loadVerifiedLocalDevelopmentConfig(): Promise<{ DB_URL: string; API_URL: string; SECRET_KEY: string }> };
  const local = await loadVerifiedLocalDevelopmentConfig();
  const dbUrl = new URL(local.DB_URL); dbUrl.pathname = `/${proof.database}`;
  assert.ok(["localhost", "127.0.0.1"].includes(dbUrl.hostname) && dbUrl.port === "54322", "EVE_NEGATIVE_PROOF_LOCAL_DB_ONLY");
  const apiUrl = new URL(local.API_URL); assert.ok(["localhost", "127.0.0.1"].includes(apiUrl.hostname) && apiUrl.port === "54321", "EVE_NEGATIVE_PROOF_LOCAL_STORAGE_ONLY");

  const namespace = randomUUID(), bucket = "ai-engineer-cloud-bucket", registry = JSON.parse(await readFile(resolve("../internal/verification-frozen-source-registry-7a74a7a8-0dc4-4591-8bb1-5781ebddef42.json"), "utf8")) as Registry;
  const provider = await loadDiagnosticsV1ProviderGrant(resolve("catalog/verification-benchmarks/diagnostics-companies-v1"));
  const benchmarkCase = provider.dataset.cases.find(item => item.caseId === "tru-symphony-source"); assert.ok(benchmarkCase, "EVE_NEGATIVE_V1_CASE_REQUIRED");
  const cursor: CursorInput = { reportMarkdown: benchmarkCase.assertion, assertion: { text: benchmarkCase.assertion, start: 0, end: benchmarkCase.assertion.length }, producerAgentId: proof.negativeCase === "same_deployment" ? `eve-negative-verifier-${namespace}` : `eve-negative-producer-${namespace}`, producerRunId: `negative-${namespace}` };
  assert.ok(typeof cursor.reportMarkdown === "string" && cursor.reportMarkdown.length > 0 && cursor.reportMarkdown.length <= 3_000 && typeof cursor.producerAgentId === "string" && cursor.producerAgentId.length > 0 && cursor.producerAgentId.length <= 200 && typeof cursor.producerRunId === "string" && cursor.producerRunId.length > 0 && cursor.producerRunId.length <= 200 && cursor.assertion && typeof cursor.assertion.text === "string", "EVE_NEGATIVE_INPUT_INVALID");
  const frozen = registry.records.find(record => record.sourceKey === benchmarkCase.evidence[0]!.sourceKey); assert.ok(frozen && frozen.projections.length > 0, "EVE_NEGATIVE_PROOF_FROZEN_PROJECTION_REQUIRED");
  const startupPath = resolve("../internal", `verification-eve-negative-controls-startup-${namespace}.json`), outputPath = resolve("../internal", `verification-eve-negative-controls-${namespace}.json`), failurePath = outputPath.replace(/\.json$/u, ".failure.json");
  await writeFile(startupPath, JSON.stringify({ schemaVersion: "verification-eve-negative-controls-startup.v1", namespace, tenantId: registry.tenantId, proofDatabase: proof.database, plannedKinds: ["report"], intendedMutationScope: "isolated local Eve verifier operation, semantic provider evidence and signed terminal only", createdAt: new Date().toISOString() }, null, 2) + "\n", { flag: "wx" });
  const database = new PostgresCanonicalRepository({ connectionString: dbUrl.toString(), localOnly: true });
  let server: ReturnType<typeof buildServer> | undefined, worker: Awaited<ReturnType<typeof startWorker>> | undefined, phase = "startup";
  let trappedFetch: typeof fetch | undefined;
  let rejectedExternalFetches = 0;
  const createdOperationIds: string[] = [];
  const failureDiagnostic = async (error: unknown) => {
    const firstLine = error instanceof Error ? error.message.split(/\r?\n/u)[0] ?? "" : "";
    const errorCode = /^[A-Z0-9_]{3,160}$/u.test(firstLine) ? firstLine : error instanceof Error ? error.name : "UNKNOWN";
    const operations = await Promise.all(createdOperationIds.map(async operationId => {
      const [operation, steps, receipts, events] = await Promise.all([
        database.getOperationRecord(registry.tenantId, operationId),
        database.listSteps(registry.tenantId, operationId),
        database.listReceipts(registry.tenantId, operationId),
        database.listOperationEvents(registry.tenantId, operationId),
      ]);
      return {
        operationId,
        ...(operation ? { status: operation.status, operationKind: operation.operationKind, requestSha256: operation.requestSha256, ownershipMode: operation.ownershipMode, externalRunId: operation.externalRunId ?? null } : { status: "missing" }),
        steps: steps.map(step => ({ id: step.id, status: step.status, stepKind: step.stepKind, inputSha256: step.inputSha256, attemptCount: step.attemptCount })),
        receipts: receipts.map(receipt => { const body = receipt.body as { errorClass?: unknown; retryable?: unknown; attemptsExhausted?: unknown }; return { id: receipt.id, receiptKind: receipt.receiptKind, inputSha256: receipt.inputSha256, outputSha256: receipt.outputSha256, failure: receipt.receiptKind === "failure" ? { errorClass: typeof body.errorClass === "string" ? body.errorClass.replace(/(?:https?:\/\/|postgres(?:ql)?:\/\/)[^\s]+/giu, "[redacted-url]").slice(0, 500) : "UNKNOWN", retryable: body.retryable, attemptsExhausted: body.attemptsExhausted } : undefined }; }),
        events: (events ?? []).map(event => ({ id: event.id, sequence: event.sequence, type: event.type })),
      };
    }));
    const artifacts = await database.transaction(registry.tenantId, async client => (await client.query<{ id: string; artifact_type: string; sha256: string; storage_state: string }>("select id,artifact_type,sha256,storage_state from orchestration.artifact where tenant_id=$1 and producer_attempt_id in (select id from orchestration.attempt where tenant_id=$1 and work_item_id in (select id from orchestration.work_item where tenant_id=$1 and mission_id in (select id from orchestration.mission where tenant_id=$1 and slug like 'eve-negative-%')))", [registry.tenantId])).rows);
    return { errorClass: error instanceof Error ? error.name : "unknown", errorCode, operations, artifacts };
  };
  try {
    const artifactType = await database.transaction(registry.tenantId, async client => (await client.query("select description from orchestration.artifact_type where code=$1", ["verification_runtime_principal_binding"])).rows);
    assert.equal(artifactType.length, 1, "EVE_NEGATIVE_RUNTIME_PRINCIPAL_ARTIFACT_TYPE_REQUIRED");
    assert.equal(artifactType[0].description, "Canonical server-resolved runtime principal binding retained for claims and report audit replay", "EVE_NEGATIVE_RUNTIME_PRINCIPAL_ARTIFACT_TYPE_DRIFT");
    const store = new SupabaseArtifactStore({ projectUrl: local.API_URL, serviceRoleKey: local.SECRET_KEY, bucket, maximumBytes: 32_000_000 });
    const repository = new PostgresVerificationRepository(database, store, { async authorize(value) { assert.equal(value.tenantId, registry.tenantId); assert.ok(["verification_admission", "verification_replay", "policy_replay"].includes(value.purpose)); } });
    const projection = frozen.projections[0]!;
    const admission = new VerificationAdmissionService(repository, { async parse(): Promise<never> { throw new Error("PARSER_FORBIDDEN_IN_EVE_NEGATIVE_MISSION_PROOF"); } }, { parserVersion: projection.parserVersion as "verification-native-parser.v1", imageDigest: projection.imageDigest, limits: VERIFICATION_PARSER_LIMITS }, { storageBucket: bucket, producerVersion: "eve-negative-proof.v1", encryptionClass: "supabase-managed", retentionClass: "verification-audit", now: () => new Date().toISOString() });
    const tenantId = registry.tenantId, missionId = randomUUID(), producerWorkItemId = randomUUID(), producerAttemptId = randomUUID(), producerDeploymentId = cursor.producerAgentId, verifierDeploymentId = proof.negativeCase === "same_deployment" ? cursor.producerAgentId : `eve-negative-verifier-${namespace}`;
    const actor: Actor = { kind: "service", id: randomUUID(), serviceIdentity: "mission_control_client" };
    await database.transaction(tenantId, async client => { await client.query("insert into orchestration.mission(id,tenant_id,slug,goal) values($1,$2,$3,$4)", [missionId, tenantId, `eve-negative-${namespace}`, "Bounded Eve semantic verification of a retained Cursor-authored report"]); await client.query("insert into orchestration.work_item(id,tenant_id,mission_id,kind,spec) values($1,$2,$3,'verify_extraction',$4::jsonb)", [producerWorkItemId, tenantId, missionId, JSON.stringify({ namespace, role: "semantic_mission_fixture" })]); await client.query("insert into orchestration.attempt(id,tenant_id,work_item_id,attempt_no,agent_deployment_id,started_at) values($1,$2,$3,1,$4,clock_timestamp())", [producerAttemptId, tenantId, producerWorkItemId, producerDeploymentId]); });
    const register = async (value: unknown, artifactType: string, label: string): Promise<VerificationArtifactHandle> => repository.registerContentAddressedArtifact({ tenantId, producerAttemptId, missionId, artifactType, bytes: new TextEncoder().encode(canonicalizeJson(value)), createdAt: new Date().toISOString(), parentArtifactIds: [], producerActivityId: "verification-eve-negative-controls", producerVersion: "v1", mediaType: "application/json", encryptionClass: "supabase-managed", retentionClass: "verification-audit", dataClassification: "restricted", bucketClass: "ledger", storageBucket: bucket });
    const policyVersion = `eve-negative-policy-${namespace}`, policy: VerificationPolicyDefinition = { schemaVersion: "verification-policy.v1", policyVersion, definitionId: `eve-negative-${namespace}`, criticalDownstreamUses: [], requireCrossFamilyForRisk: [], requireIndependentAuthorityForScopes: [], mixedEvidenceOutcome: "review", unknownCriticalOutcome: "review", authorityWithheldOutcome: "review", reviewAvailable: true };
    const policyArtifact = await register(policy, "verification_policy", "policy");
    const key = generateKeyPairSync("ed25519"), keyId = `eve-negative-${namespace}`, privateKeyPem = key.privateKey.export({ type: "pkcs8", format: "pem" }).toString(), publicKeyPem = key.publicKey.export({ type: "spki", format: "pem" }).toString();
    const maximumCompletionTokens = 900;
    assert.ok(benchmarkCase.assertion.length + benchmarkCase.evidence[0]!.excerpt.length <= 2_000, "EVE_NEGATIVE_D013_CONTENT_BOUND");
    assert.ok(maximumCompletionTokens <= 900, "EVE_NEGATIVE_D013_COMPLETION_TOKEN_BOUND");
    const workItemId = randomUUID(), attemptId = randomUUID(), operation = "verifyReport" as const;
    const hostIdempotencyKey = `eve-negative-${namespace}`;
    const expectedOperationId = eveReportOperationId(tenantId, hostIdempotencyKey);
    const eveRuntimeLabel = `eve-negative-${namespace}`;
    await database.transaction(tenantId, async client => { await client.query("insert into orchestration.work_item(id,tenant_id,mission_id,kind,spec) values($1,$2,$3,'verify_extraction',$4::jsonb)", [workItemId, tenantId, missionId, JSON.stringify({ namespace, role: "eve_verifier_for_cursor_authored_report", producerAgentId: cursor.producerAgentId, producerRunId: cursor.producerRunId })]); await client.query("insert into orchestration.attempt(id,tenant_id,work_item_id,attempt_no,agent_deployment_id,started_at) values($1,$2,$3,1,$4,clock_timestamp())", [attemptId, tenantId, workItemId, verifierDeploymentId]); });
    const fixture = await createVerificationAgentReportFixture({ repository, admission, tenantId, namespace, missionId, producerAttemptId, producerDeploymentId: cursor.producerAgentId, verifierDeploymentId, verifierAttemptId: attemptId, policyVersion, frozenRecord: frozen, benchmarkCase, reportMarkdown: cursor.reportMarkdown, assertion: cursor.assertion });
    let request: VerifyReportRequest = fixture.request as VerifyReportRequest;
    if (proof.negativeCase === "corrupted_locator") {
      const resolver = repository.createTrustedArtifactResolver(); await resolver.authorizeArtifact({ tenantId, artifactId: fixture.assertionsArtifact.artifactId, purpose: "verification_admission" });
      const ledger = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode((await resolver.hydrateRegisteredArtifact({ tenantId, artifactId: fixture.assertionsArtifact.artifactId })).bytes)) as any;
      const corrupt = (value: any) => { value.fragment.selector = { kind: "html", domPath: "999/999/999" }; };
      corrupt(ledger.bundle.assertions[0].evidence[0]); corrupt(ledger.assertions[0].assertion.evidence[0]);
      const corruptedLedger = await repository.registerContentAddressedArtifact({ tenantId, producerAttemptId, missionId, artifactType: "verification_report_ledger", bytes: new TextEncoder().encode(canonicalizeJson(ledger)), createdAt: new Date().toISOString(), parentArtifactIds: [fixture.reportArtifact.artifactId, frozen.projections[0]!.transformationArtifact.artifactId], transformationSignature: digestCanonicalJson({ namespace, negativeCase: proof.negativeCase, originalLedger: fixture.assertionsArtifact.artifactId }), producerActivityId: "verification-eve-negative-controls", producerVersion: "v1", mediaType: "application/json", encryptionClass: "supabase-managed", retentionClass: "verification-audit", dataClassification: "restricted", bucketClass: "ledger", storageBucket: bucket });
      request = { ...request, claimLedger: { artifactId: corruptedLedger.artifactId, digest: corruptedLedger.digest } };
    }
    const model = "openai/gpt-5.6-luna" as const, identity = { deploymentId: `eve-negative-luna-${namespace}`, provider: "vercel-ai-gateway" as const, family: "openai" as const, model, capability: "llm_evidence_rubric" as const, graderVersion: "evidence-only.v1", promptDigest: gatewaySemanticPromptDigest, outputSchemaDigest: gatewaySemanticOutputSchemaDigest, configurationDigest: gatewaySemanticConfigurationDigest(model) };
    const profileArtifact = await register(SemanticJudgeProfileSchema.parse({ schemaVersion: "verification-semantic-judge-profile.v1", identity }), "verification_semantic_judge_profile", "report:profile");
    const context: OperationContext = { contractVersion: "v1", tenantId, operationId: expectedOperationId, attemptId, missionId, workItemId, correlationId: `eve-verification:${expectedOperationId}`, actor, capabilityVersion: "verification.v1", idempotencyKey: hostIdempotencyKey, reason: "Authorized bounded Eve verification of retained Cursor-authored report bytes" };
    const resolver = repository.createTrustedArtifactResolver(); await resolver.authorizeArtifact({ tenantId, artifactId: fixture.assertionsArtifact.artifactId, purpose: "verification_admission" });
    const stored = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode((await resolver.hydrateRegisteredArtifact({ tenantId, artifactId: fixture.assertionsArtifact.artifactId })).bytes)) as { assertions?: readonly { assertion: any }[] };
    const assertion = stored.assertions?.[0]?.assertion; assert.ok(assertion, "EVE_NEGATIVE_ASSERTION_REQUIRED");
    const blinded = { rubricVersion: "evidence-only.v1" as const, assertionId: assertion.assertionId, proposition: assertion.proposition, qualifiers: assertion.qualifiers, entityBindings: assertion.entityBindings, fragments: assertion.evidence.map((e: { fragment: { fragmentId: string } }) => ({ fragmentId: e.fragment.fragmentId, exactText: fixture.evidenceText })) };
    const preflight = prepareGatewaySemanticRequest({ ...blinded, inputArtifactDigest: digestCanonicalJson(blinded) }, model); assert.ok(preflight.requestBytes.byteLength <= 10_000, "EVE_NEGATIVE_D013_WIRE_BOUND");
    const plans: SemanticMissionPlan[] = [{ kind: "report", context, request: request, expectedOperationId, workflowId: eveRuntimeLabel, profileArtifact, expectedSemanticRequestDigest: preflight.requestDigest }];    await writeFile(startupPath.replace(/\.json$/u, ".prepared.json"), JSON.stringify({ schemaVersion: "verification-eve-negative-controls-prepared.v1", namespace, startupJournal: startupPath, tenantId, proofDatabase: proof.database, frozenCaptureId: frozen.captureId, plannedOperations: plans.map(plan => ({ kind: plan.kind, operationId: plan.expectedOperationId, requestDigest: digestCanonicalJson(plan.request) })), createdAt: new Date().toISOString() }, null, 2) + "\n", { flag: "wx" });
    const grants = plans.map(plan => ({ tenantId, assertions: "assertions" in plan.request ? plan.request.assertions : plan.request.claimLedger, admissions: [{ captureId: frozen.captureId, projectionArtifactId: projection.projectionArtifact.artifactId, transformationArtifactId: projection.transformationArtifact.artifactId }] }));
    const catalog = new VerificationClaimsProjectionGrantCatalog(grants);
    const eveSigning = generateKeyPairSync("ed25519"), eveKeyId = `eve-negative-${namespace}`;
    const evePrivateKeyPem = eveSigning.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const evePublicKeyPem = eveSigning.publicKey.export({ type: "spki", format: "pem" }).toString();
    const eveAuthority = { grantId: `eve-negative-grant-${namespace}`, issuer: "local-eve-proof", keyIds: [eveKeyId] };
    const ownershipGrants = JSON.stringify([{ tenantId, actor, missionId, agentDeploymentId: verifierDeploymentId, capabilityVersion: context.capabilityVersion, eveRuntimeAuthority: eveAuthority }]);
    const claimsReportReads = createVerificationClaimsReportReads(database, { VERIFICATION_CLAIMS_REPORT_READ_PUBLIC_KEYS_JSON: JSON.stringify([{ keyId, publicKeyPem }]), VERIFICATION_SERVICE_OWNERSHIP_GRANTS_JSON: ownershipGrants, SUPABASE_URL: local.API_URL, SUPABASE_SECRET_KEY: local.SECRET_KEY, VERIFICATION_STORAGE_BUCKET: bucket });
    assert.ok(claimsReportReads, "EVE_NEGATIVE_TYPED_TERMINAL_READS_REQUIRED");
    const verificationReads = createVerificationReads(database, { VERIFICATION_READS_ENABLED: "1", SUPABASE_URL: local.API_URL, SUPABASE_SECRET_KEY: local.SECRET_KEY, VERIFICATION_STORAGE_BUCKET: bucket });
    assert.ok(verificationReads, "EVE_NEGATIVE_RUN_READS_REQUIRED");
    const operations = new PostgresKnowledgeOperationService(database, { admittedOperationKinds: ["verification_claims", "verification_report"] });
    const token = `eve-negative-token-${namespace}`;
    server = buildServer({ publicOrigin: "http://127.0.0.1", verificationOperationService: operations, resourceReader: database, verificationClaimsReportReads: claimsReportReads, verificationReads, verificationCaseReads: verificationReads.cases, isClaimsRequestAdmitted: (candidateTenant, request) => { try { catalog.resolve(candidateTenant, "assertions" in request ? request.assertions : request.claimLedger); return true; } catch { return false; } }, resolveIdentity: value => value === token ? { actor, grants: [{ tenantId, roles: ["knowledge_operator"], scopes: [] }] } : undefined, resolveVerificationContext: createVerificationOwnershipResolver(database, ownershipGrants, { eveRuntimeAttestationKeysJson: JSON.stringify([{ issuer: eveAuthority.issuer, keyId: eveKeyId, publicKeyPem: evePublicKeyPem }]) }) });
    await server.listen({ host: "127.0.0.1", port: 0 }); const address = server.server.address(); assert.ok(address && typeof address !== "string"); const baseUrl = `http://127.0.0.1:${address.port}`;
    const profileGrants = plans.map(plan => ({ tenantId, operationId: plan.expectedOperationId, host: plan.kind, role: "primary", profileArtifact: plan.profileArtifact, identity }));
    phase = "worker-preflight";
    const runnableBeforeWorker = await database.transaction(tenantId, async client => (await client.query<{ count: string }>("select count(*)::text as count from knowledge_service.operation_step where tenant_id=$1 and status in ('queued','running') and available_at<=clock_timestamp()", [tenantId])).rows[0]?.count ?? "0");
    assert.equal(Number(runnableBeforeWorker), 0, "EVE_NEGATIVE_PREEXISTING_RUNNABLE_STEP");
    assert.ok(remainingDeadlineMs() >= 150_000, "EVE_NEGATIVE_DEADLINE_INSUFFICIENT_BEFORE_WORKER");
    const workerStartedAt = new Date().toISOString();
    trappedFetch = globalThis.fetch; globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => { const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url); if (["localhost", "127.0.0.1"].includes(url.hostname)) return trappedFetch!(input, init); rejectedExternalFetches++; throw new Error("EVE_NEGATIVE_EXTERNAL_NETWORK_FORBIDDEN"); }) as typeof fetch;
    worker = await startWorker({ NODE_ENV: "test", KNOWLEDGE_PERSISTENCE_MODE: "postgres", WORKER_TENANT_ID: tenantId, WORKER_POLL_MS: "25", POSTGRES_URL: dbUrl.toString(), CANONICAL_LOCAL_ONLY: "1", SUPABASE_URL: local.API_URL, SUPABASE_SECRET_KEY: local.SECRET_KEY, SUPABASE_STORAGE_BUCKET: "source-captures", VERIFICATION_STORAGE_BUCKET: bucket, VERIFICATION_CLAIMS_PROJECTION_GRANTS_JSON: JSON.stringify(grants), VERIFICATION_SEAL_POLICY_GRANTS_JSON: JSON.stringify([{ tenantId, policyVersion, policyArtifact: { artifactId: policyArtifact.artifactId, digest: policyArtifact.digest } }]), VERIFICATION_PARSER_IMAGE_DIGEST: projection.imageDigest, VERIFICATION_CODE_GIT_SHA: "uncommitted-native-proof", VERIFICATION_CODE_DIRTY: "1", VERIFICATION_RUNTIME_PLATFORM: "node24-windows", VERIFICATION_RUNTIME_DEPLOYMENT_ID: verifierDeploymentId, VERIFICATION_SEMANTIC_RUNTIME_JSON: JSON.stringify({ classification: "public", ceilingCostMicros: 5000, reservationCostMicros: 5000, deadlineMs: 60000 }), VERIFICATION_SEMANTIC_PROFILE_GRANTS_JSON: JSON.stringify(profileGrants), AI_GATEWAY_API_KEY: "network-trap-only", VERIFICATION_AUDIT_SIGNING_KEY_ID: keyId, VERIFICATION_AUDIT_SIGNING_PRIVATE_KEY_PEM: privateKeyPem });
    createdOperationIds.push(expectedOperationId);
    phase = "eve";
    const eveRoot = resolve("../research_ingestion_systems_agent/agents/verification"), fixtureRoot = join(dirname(eveRoot), `.verification-eve-negative-controls-${namespace}`);
    let fixtureCreated = false;
    let effectiveAgentSummary: Record<string, unknown> | undefined;
    let eveToolReceipt: Record<string, unknown> | undefined;
    const commandReceipts: { readonly command: string; readonly exitCode: number | null; readonly stdoutSha256: string; readonly stderrSha256: string; readonly failureDiagnostic?: { readonly stdoutTail: string; readonly stderrTail: string } }[] = [];
    try {
      await cp(eveRoot, fixtureRoot, { recursive: true, filter: source => ![".eve", ".output", "node_modules"].includes(source.split(/[\\/]/).at(-1) ?? "") }); fixtureCreated = true;
      await symlink(resolve(eveRoot, "node_modules"), resolve(fixtureRoot, "node_modules"), process.platform === "win32" ? "junction" : "dir");
      await writeFile(resolve(fixtureRoot, "evals/native-eve-negative.eval.ts"), `import {defineEval} from "eve/evals"; import {equals} from "eve/evals/expect"; export default defineEval({description:"Real KS Eve report verification; mock model invokes one authored tool",async test(t){const turn=await t.send("Submit the configured report verification.");const expected=process.env.EVE_VERIFICATION_NEGATIVE_CASE==="same_deployment"?"failed":"succeeded";if(expected==="succeeded")t.succeeded();turn.calledTool("verify_evidence_bundle",{status:"completed",count:1});const message=turn.events.filter(e=>e.type==="message.completed").at(-1)?.data?.message??turn.data;const value=typeof message==="string"?JSON.parse(message):message;t.check(value?.status,equals(expected));t.check(value?.operationId,equals(process.env.EVE_VERIFICATION_FIXTURE_OPERATION_ID));const receipt=expected==="failed"?{status:value?.status,operationId:value?.operationId,host:value?.host,intent:value?.intent,tenantId:value?.tenantId,requestDigest:value?.requestDigest,failureCode:value?.failureCode}:{status:value?.status,operationId:value?.operationId,host:value?.host,intent:value?.intent,tenantId:value?.tenantId,requestDigest:value?.requestDigest,sealedRun:value?.sealedRun,disposition:value?.disposition};console.log("EVE_NEGATIVE_TOOL_RECEIPT="+JSON.stringify(receipt));}});\n`, { flag: "wx" });
      const portHolder = createServer(); await new Promise<void>(done => portHolder.listen(0, "127.0.0.1", done)); const evePort = (portHolder.address() as { port: number }).port; await new Promise<void>((done, reject) => portHolder.close(error => error ? reject(error) : done()));
      const environment = safeEveEnvironment();
      Object.assign(environment, { PORT: String(evePort), EVE_VERIFICATION_TRANSPORT_FIXTURE: "1", EVE_VERIFICATION_NEGATIVE_CASE: proof.negativeCase, EVE_VERIFICATION_FIXTURE_TOOL_INPUT_JSON: JSON.stringify({ action: "submit", host: "report", intent: "verify_report", ...request }), EVE_VERIFICATION_FIXTURE_OPERATION_ID: expectedOperationId, KNOWLEDGE_API_BASE_URL: baseUrl, KNOWLEDGE_API_TOKEN: token, EVE_VERIFICATION_SIGNING_PRIVATE_KEY_PEM: evePrivateKeyPem, EVE_VERIFICATION_GRANTS_JSON: JSON.stringify({ schemaVersion: "eve-verification-grants.v1", grants: [{ grantId: eveAuthority.grantId, tenantId, principal: actor, missionId, workItemId, attemptId, operationId: expectedOperationId, idempotencyKey: hostIdempotencyKey, capabilityVersion: context.capabilityVersion, host: "report", requestDigest: digestCanonicalJson(request), runtimeAttestation: { issuer: eveAuthority.issuer, keyId: eveKeyId, agentDeploymentId: verifierDeploymentId }, lifecycle: { allowRead: true, allowCancellation: true, maxPollAttempts: 20, pollIntervalMs: 5_000 } }] }) });
      const executable = process.execPath, eveCli = resolve(fixtureRoot, "node_modules", "eve", "bin", "eve.js");
      for (const args of [[eveCli, "build"], [eveCli, "eval", "native-eve-negative", "--strict", "--json", "--skip-report"]] as const) {
        const result = await runEveCommand(executable, args, environment, fixtureRoot, Math.min(remainingDeadlineMs(), 120_000));
        const failure = result.exitCode === 0 ? undefined : { stdoutTail: publicCommandTail(result.stdout), stderrTail: publicCommandTail(result.stderr) };
        commandReceipts.push({ command: `eve ${args.slice(1).join(" ")}`, exitCode: result.exitCode, stdoutSha256: createHash("sha256").update(result.stdout).digest("hex"), stderrSha256: createHash("sha256").update(result.stderr).digest("hex"), ...(failure ? { failureDiagnostic: failure } : {}) });
        assert.equal(result.exitCode, 0, `EVE_NEGATIVE_${args[1].toUpperCase()}_EXIT_CODE`);
        if (args[1] === "build") {
          const raw = await readFile(resolve(fixtureRoot, ".eve", "agent-summary.json"), "utf8");
          assert.ok(Buffer.byteLength(raw, "utf8") <= 64_000, "EVE_NEGATIVE_AGENT_SUMMARY_TOO_LARGE");
          const summary = JSON.parse(raw) as { tools?: unknown; skills?: unknown; connections?: unknown };
          const tools = Array.isArray(summary.tools) ? summary.tools : summary.tools === undefined ? [] : [summary.tools];
          assert.deepEqual(tools.map(value => (value as { name?: unknown }).name), ["verify_evidence_bundle"], "EVE_NEGATIVE_AGENT_SUMMARY_TOOLS");
          assert.ok(summary.skills === null || (Array.isArray(summary.skills) && summary.skills.length === 0), "EVE_NEGATIVE_AGENT_SUMMARY_SKILLS");
          assert.ok(summary.connections === null || (Array.isArray(summary.connections) && summary.connections.length === 0), "EVE_NEGATIVE_AGENT_SUMMARY_CONNECTIONS");
          effectiveAgentSummary = JSON.parse(raw) as Record<string, unknown>;
        } else eveToolReceipt = parseEveToolReceipt(result.stdout, expectedOperationId, proof.negativeCase === "same_deployment" ? "failed" : "succeeded");
      }
    } finally {
      if (fixtureCreated) { const safe = resolve(fixtureRoot); assert.equal(dirname(safe), resolve(dirname(eveRoot)), "EVE_NEGATIVE_FIXTURE_PARENT_INVALID"); assert.match(safe.split(/[\\/]/).at(-1) ?? "", /^\.verification-eve-negative-controls-[0-9a-f-]{36}$/u, "EVE_NEGATIVE_FIXTURE_PATH_INVALID"); await rm(safe, { recursive: true, force: true }); }
    }
    const results = [{ kind: "report" as const, operationId: expectedOperationId, requestDigest: digestCanonicalJson(request), eveRuntime: eveRuntimeLabel, commandReceipts }];
    const eveAttestation = await database.transaction(tenantId, async client => {
      const [bindings, invocations] = await Promise.all([
        client.query<{ issuer: string; original_key_id: string; original_jti: string; original_external_execution: unknown }>("select issuer,original_key_id,original_jti,original_external_execution from knowledge_service.eve_operation_binding where tenant_id=$1 and operation_id=$2", [tenantId, expectedOperationId]),
        client.query<{ issuer: string; key_id: string; jti: string; invocation_kind: string; envelope: unknown; envelope_sha256: string; observed_external_execution: unknown }>("select issuer,key_id,jti,invocation_kind,envelope,envelope_sha256,observed_external_execution from knowledge_service.eve_operation_invocation where tenant_id=$1 and operation_id=$2 order by accepted_at", [tenantId, expectedOperationId]),
      ]);
      assert.equal(bindings.rows.length, 1, "EVE_NEGATIVE_BINDING_REQUIRED");
      assert.equal(invocations.rows.length, 1, "EVE_NEGATIVE_INVOCATION_REQUIRED");
      const binding = bindings.rows[0]!, invocation = invocations.rows[0]!;
      assert.equal(binding.issuer, eveAuthority.issuer, "EVE_NEGATIVE_BINDING_ISSUER");
      assert.equal(binding.original_key_id, eveKeyId, "EVE_NEGATIVE_BINDING_KEY");
      assert.equal(invocation.issuer, eveAuthority.issuer, "EVE_NEGATIVE_INVOCATION_ISSUER");
      assert.equal(invocation.key_id, eveKeyId, "EVE_NEGATIVE_INVOCATION_KEY");
      assert.equal(invocation.jti, binding.original_jti, "EVE_NEGATIVE_INVOCATION_JTI");
      assert.equal(invocation.invocation_kind, "original", "EVE_NEGATIVE_INVOCATION_KIND");
      assert.match(invocation.envelope_sha256, /^[0-9a-f]{64}$/u, "EVE_NEGATIVE_INVOCATION_ENVELOPE_DIGEST");
      assert.equal((binding.original_external_execution as { runId?: unknown }).runId, (invocation.observed_external_execution as { runId?: unknown }).runId, "EVE_NEGATIVE_EXTERNAL_EXECUTION_BINDING");
      return { binding, invocations: [invocation] };
    });
    const typedTerminals = proof.negativeCase === "same_deployment"
      ? [await database.transaction(tenantId, async client => {
          const [steps, receipts, runs] = await Promise.all([
            client.query<{ id: string; status: string; attempt_count: number }>("select id,status,attempt_count from knowledge_service.operation_step where tenant_id=$1 and operation_id=$2", [tenantId, expectedOperationId]),
            client.query<{ body: { errorClass?: unknown; retryable?: unknown } }>("select body from knowledge_service.receipt where tenant_id=$1 and operation_id=$2 and receipt_kind='failure'", [tenantId, expectedOperationId]),
            client.query<{ count: string }>("select count(*)::text as count from evidence.verification_run where tenant_id=$1 and operation_id=$2", [tenantId, expectedOperationId]),
          ]);
          const operation = await database.getOperationRecord(tenantId, expectedOperationId);
          assert.ok(operation, "EVE_NEGATIVE_OPERATION_REQUIRED");
          assert.equal(operation.status, "failed", "EVE_NEGATIVE_SAME_DEPLOYMENT_OPERATION_FAILED");
          assert.equal(operation.ownershipMode, "eve", "EVE_NEGATIVE_SAME_DEPLOYMENT_EVE_OWNERSHIP");
          assert.equal(operation.externalRunId, (eveAttestation.binding.original_external_execution as { runId?: unknown }).runId, "EVE_NEGATIVE_SAME_DEPLOYMENT_EVE_RUN");
          assert.equal(steps.rows.length, 1, "EVE_NEGATIVE_SAME_DEPLOYMENT_ONE_STEP");
          assert.equal(steps.rows[0]?.status, "failed", "EVE_NEGATIVE_SAME_DEPLOYMENT_STEP_FAILED");
          assert.equal(steps.rows[0]?.attempt_count, 1, "EVE_NEGATIVE_SAME_DEPLOYMENT_ONE_LEASE");
          assert.equal(receipts.rows.length, 1, "EVE_NEGATIVE_SAME_DEPLOYMENT_ONE_FAILURE_RECEIPT");
          assert.equal(receipts.rows[0]?.body?.errorClass, "PRODUCER_VERIFIER_INDEPENDENT", "EVE_NEGATIVE_SAME_DEPLOYMENT_FAILURE_CODE");
          assert.equal(receipts.rows[0]?.body?.retryable, false, "EVE_NEGATIVE_SAME_DEPLOYMENT_FAILURE_NONRETRYABLE");
          assert.equal(Number(runs.rows[0]?.count ?? 0), 0, "EVE_NEGATIVE_SAME_DEPLOYMENT_NO_VERIFICATION_RUN");
          assert.equal(eveToolReceipt?.failureCode, "INVALID_STATE_TRANSITION", "EVE_NEGATIVE_SAME_DEPLOYMENT_TOOL_FAILURE");
          return { kind: "report" as const, nonAdmission: { operationId: operation.id, status: operation.status, ownershipMode: operation.ownershipMode, externalRunId: operation.externalRunId, step: steps.rows[0], failureCode: receipts.rows[0]?.body?.errorClass, verificationRunCount: Number(runs.rows[0]?.count ?? 0) } };
        })]
      : await Promise.all(plans.map(async plan => {
          const direct = await claimsReportReads.getReport({ tenantId, operationId: plan.expectedOperationId, actor: plan.context.actor });
          const response = await fetch(`${baseUrl}/v1/verification/reports/${plan.expectedOperationId}`, { headers: { authorization: `Bearer ${token}`, "x-tenant-id":tenantId } });
          assert.equal(response.status, 200, "EVE_NEGATIVE_TYPED_TERMINAL_HTTP_STATUS");
          const http = await response.json(); assert.equal(canonicalizeJson(http), canonicalizeJson(direct), "EVE_NEGATIVE_TYPED_TERMINAL_HTTP_DRIFT");
          assert.equal(direct.operationId, plan.expectedOperationId, "EVE_NEGATIVE_TYPED_TERMINAL_OPERATION_ID");
          assert.equal(direct.tenantId, tenantId, "EVE_NEGATIVE_TYPED_TERMINAL_TENANT");
          assert.equal(direct.requestDigest, digestCanonicalJson(plan.request), "EVE_NEGATIVE_TYPED_TERMINAL_REQUEST_DIGEST");
          const operation = await database.getOperationRecord(tenantId, plan.expectedOperationId); assert.ok(operation, "EVE_NEGATIVE_TYPED_TERMINAL_OPERATION_REQUIRED");
          assert.equal(operation.ownershipMode, "eve", "EVE_NEGATIVE_TYPED_TERMINAL_EVE_OWNERSHIP");
          assert.equal(operation.externalRunId, (eveAttestation.binding.original_external_execution as { runId?: unknown }).runId, "EVE_NEGATIVE_TYPED_TERMINAL_EVE_RUN_REQUIRED");
          assert.equal(direct.output.deterministic.status, "failed", "EVE_NEGATIVE_DETERMINISTIC_FAILURE_REQUIRED");
          assert.ok(direct.output.deterministic.failedCheckCodes.includes("LOCATOR_UNIQUE"), "EVE_NEGATIVE_FAILURE_CODE_REQUIRED");
          assert.ok(["review", "fail", "abstain"].includes(direct.sealedRun.policyOutcome), "EVE_NEGATIVE_TYPED_TERMINAL_POLICY_OUTCOME");
          assert.equal(eveToolReceipt?.disposition, direct.sealedRun.policyOutcome, "EVE_NEGATIVE_TOOL_DISPOSITION_DRIFT");
          assert.equal(canonicalizeJson(eveToolReceipt?.sealedRun), canonicalizeJson({ runId: direct.sealedRun.runId, manifestArtifact: direct.sealedRun.manifestArtifact }), "EVE_NEGATIVE_TOOL_SEALED_RUN_DRIFT");
          return { kind: plan.kind, resource: direct, operation: { operationId: operation.id, ownershipMode: operation.ownershipMode, externalRunId: operation.externalRunId, status: operation.status }, resultArtifact: direct.resultArtifact, sealedRun: direct.sealedRun };
        }));
    const providerCustody = await database.transaction(tenantId, async client => {
      const [attempts, observations, captures] = await Promise.all([
        client.query<{ count: string }>("select count(*)::text as count from orchestration.verification_provider_attempt where tenant_id=$1 and operation_id=$2", [tenantId, expectedOperationId]),
        client.query<{ count: string }>("select count(*)::text as count from orchestration.verification_semantic_response_observation where tenant_id=$1 and operation_id=$2", [tenantId, expectedOperationId]),
        client.query<{ count: string }>("select count(*)::text as count from orchestration.verification_provider_response_capture where tenant_id=$1 and operation_id=$2", [tenantId, expectedOperationId]),
      ]);
      const value={operationId:expectedOperationId,providerAttempts:Number(attempts.rows[0]?.count??0),observations:Number(observations.rows[0]?.count??0),responseCaptures:Number(captures.rows[0]?.count??0)};
      assert.deepEqual(value,{operationId:expectedOperationId,providerAttempts:0,observations:0,responseCaptures:0},"EVE_NEGATIVE_NO_SEMANTIC_DISPATCH");
      assert.equal(rejectedExternalFetches, 0, "EVE_NEGATIVE_NO_EXTERNAL_FETCH_ATTEMPT");
      return [value];
    });
    const retainedArtifacts = await database.transaction(tenantId, async client => (await client.query("select to_jsonb(a) as artifact,to_jsonb(m) as metadata from orchestration.artifact a join orchestration.verification_artifact_metadata m on m.tenant_id=a.tenant_id and m.artifact_id=a.id where a.tenant_id=$1 and a.producer_attempt_id=any($2::uuid[])",[tenantId,[producerAttemptId,...plans.map(plan=>plan.context.attemptId)]])).rows);
    phase = "receipt"; await writeFile(outputPath, JSON.stringify({ schemaVersion: "verification-eve-negative-controls-proof.v1", namespace, tenantId, producer: { agentId: cursor.producerAgentId, runId: cursor.producerRunId, reportSha256: `sha256:${createHash("sha256").update(cursor.reportMarkdown, "utf8").digest("hex")}` }, ...(benchmarkCase ? { offlineFixtureBinding: { datasetManifestDigest: provider.authority.datasetManifestDigest, caseId: benchmarkCase.caseId, caseDigest: benchmarkCase.caseDigest, inputManifestArtifactId: benchmarkCase.inputManifestArtifactId, sourceProcessingGrant: "D-013 exact public assertion/fragment equality; D-014 completion cohort" } } : {}), proofDatabase: proof.database, startupJournal: startupPath, operations: results, eve: { modelMode: "mock_model_tool_invocation_only", publicKeyPem: evePublicKeyPem, effectiveAgentSummary: effectiveAgentSummary ?? null, toolReceipt: eveToolReceipt ?? null }, eveAttestation, typedTerminals, retainedArtifacts, providerCustody, providerTransportTrap: { rejectedExternalFetches, allowedHosts: ["localhost", "127.0.0.1"] }, publicKeyPem, checks: { eve_authored_tool_completed_report_verification: true, effective_eve_agent_has_only_verify_evidence_bundle_and_no_declared_skills_or_connections: true, compact_final_eve_tool_result_retained: true, terminal_policy_outcome_and_compact_disposition_match: proof.negativeCase === "corrupted_locator", deterministic_failure_code_exact_for_negative_case: true, same_deployment_preseal_nonadmission_one_lease_no_verification_run: proof.negativeCase === "same_deployment", signed_typed_terminal_reads_and_http_routes_match: proof.negativeCase === "corrupted_locator", no_preexisting_runnable_steps_before_worker: true, provider_transport_nonloopback_trapped_before_worker_creation: true, native_provider_attempt_observation_capture_recorded_zero: true }, limitations: ["Local-only disposable database; no Mission Control or Temporal is used or claimed", "Eve mock model invokes the authored verification tool", "The production worker semantic runtime is configured but all non-loopback fetches are trapped before worker creation; no Gateway credential or paid provider call is used", "No parser execution", "No human annotation or policy admission", "Content-addressed Storage is shared persistent local CAS; wrapper cleanup drops only the disposable proof database and retains no secret content in this receipt"], sourceSha256: createHash("sha256").update(await readFile(new URL(import.meta.url))).digest("hex") }, null, 2) + "\n", { flag: "wx" });
    process.stdout.write(`${JSON.stringify({ output: outputPath })}\n`);
  } catch (error) {
    const diagnostic = await failureDiagnostic(error).catch(() => ({ errorClass: error instanceof Error ? error.name : "unknown", errorCode: "FAILURE_DIAGNOSTIC_UNAVAILABLE", operations: [] }));
    await writeFile(failurePath, JSON.stringify({ schemaVersion: "verification-eve-negative-controls-failure.v2", namespace, phase, proofDatabase: proof.database, createdOperationIds, ...diagnostic }, null, 2) + "\n", { flag: "wx" }).catch(() => undefined);
    await writeFile(failurePath.replace(/\.json$/u, ".log"), `phase=${phase} errorClass=${diagnostic.errorClass} errorCode=${diagnostic.errorCode} operations=${createdOperationIds.join(",")}\n`, { flag: "wx" }).catch(() => undefined);
    process.stdout.write(`${JSON.stringify({ output: failurePath, failed: true })}\n`);
    throw error;
  }
  finally { if (worker) await worker.stop("eve-negative-proof"); if (server) await server.close(); if (trappedFetch) globalThis.fetch = trappedFetch; await database.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main().catch(error => { process.stderr.write(`${JSON.stringify({ event: "verification.semantic_mission_proof.failed", error: error instanceof Error ? error.message : "unknown" })}\n`); process.exitCode = 1; });





