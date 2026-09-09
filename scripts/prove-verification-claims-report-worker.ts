import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  VerificationClaimsOperationResultSchema,
  VerificationClaimsArtifactSchema,
  VerificationReportLedgerSchema,
  VerificationReportOperationResultSchema,
  type OperationContext,
  type VerificationArtifactHandle,
  type VerificationBundle,
  type VerificationPolicyDefinition,
} from "@aiengineer/knowledge-contracts";
import {
  PostgresCanonicalRepository,
  PostgresKnowledgeOperationService,
  PostgresVerificationClaimsRuntimePrincipals,
  PostgresVerificationRepository,
  type LeasedStep,
} from "@aiengineer/knowledge-persistence";
import { SupabaseArtifactStore } from "@aiengineer/knowledge-runtime";
import {
  VerificationAdmissionService,
  VerificationClaimsApplicationService,
  VerificationClaimsProjectionGrantCatalog,
  VerificationSealPolicyCatalog,
  replayVerificationAudit,
} from "@aiengineer/knowledge-application";
import { VERIFICATION_PARSER_LIMITS } from "@aiengineer/knowledge-conversion";
import {
  canonicalizeJson,
  createEd25519Signer,
  createEd25519Verifier,
  digestCanonicalJson,
  inspectAuditBundle,
  projectionSelectorResolver,
  sha256Digest,
  type VerificationAuditBundle,
} from "@aiengineer/knowledge-verification";
import { CanonicalActivityRegistry, createCanonicalActivityExecutor } from "../apps/worker/src/activity-registry.js";
import { CanonicalDurableKnowledgeWorker } from "../apps/worker/src/canonical-worker.js";
import { verificationClaimsActivityHandler } from "../apps/worker/src/verification-claims-activity.js";
import { createVerificationClaimsAuditSealer } from "../apps/worker/src/verification-claims-sealer.js";

const { loadVerifiedLocalDevelopmentConfig } = await import("../../internal/verification-local-direct-config.mjs") as {
  loadVerifiedLocalDevelopmentConfig(): Promise<{ DB_URL: string; API_URL: string; SECRET_KEY: string }>;
};
const local = await loadVerifiedLocalDevelopmentConfig();

type FixtureRecord = {
  readonly sourceKey: string;
  readonly captureId: string;
  readonly projections: readonly [{
    readonly sourceArtifact: VerificationArtifactHandle;
    readonly projectionArtifact: VerificationArtifactHandle;
    readonly transformationArtifact: VerificationArtifactHandle;
    readonly parserVersion: string;
    readonly imageDigest: `sha256:${string}`;
  }];
};
type FixtureRegistry = { readonly tenantId: string; readonly records: readonly FixtureRecord[] };
type PreparedOperation = {
  readonly kind: "verification_claims" | "verification_report";
  readonly context: OperationContext;
  readonly request: { readonly verificationContractVersion: "verification.v1"; readonly captureIds: readonly string[]; readonly assertions?: { artifactId: string; digest: `sha256:${string}` }; readonly report?: { artifactId: string; digest: `sha256:${string}` }; readonly claimLedger?: { artifactId: string; digest: `sha256:${string}` } };
  readonly assertionsArtifact: VerificationArtifactHandle;
};

const fixtureName = "verification-frozen-source-registry-7a74a7a8-0dc4-4591-8bb1-5781ebddef42.json";
const fixture = JSON.parse(await readFile(resolve("../internal", fixtureName), "utf8")) as FixtureRegistry;
const selected = fixture.records.find((item) => item.sourceKey === "gl-comparison");
assert.ok(selected);
const projectionAdmission = selected.projections[0];
assert.ok(projectionAdmission);
const namespace = randomUUID();
const missionId = randomUUID();
const plannedOperationIds = Object.freeze({
  claimsRecovery: randomUUID(),
  reportRecovery: randomUUID(),
  expiryReclaim: randomUUID(),
  cancellation: randomUUID(),
});
const startupJournal = resolve("../internal", `verification-claims-report-worker-startup-${namespace}.json`);
let startupJournalWritten = false;
const tenantId = fixture.tenantId;
const bucket = "ai-engineer-cloud-bucket";
const producerDeploymentId = `claims-proof-producer-${namespace}`;
const verifierDeploymentId = `claims-proof-verifier-${namespace}`;
const policyVersion = `claims-proof-policy-${namespace}`;
const checks: Record<string, boolean> = {};
const operationIds: string[] = [];

for (const [value, port] of [[local.DB_URL, "54322"], [local.API_URL, "54321"]] as const) {
  const url = new URL(value ?? "invalid:");
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.port !== port) throw new Error("LOCAL_ONLY_PROOF_REQUIRED");
}

const database = new PostgresCanonicalRepository({ connectionString: local.DB_URL, localOnly: true });
try {
const repository = new PostgresVerificationRepository(
  database,
  new SupabaseArtifactStore({ projectUrl: local.API_URL, serviceRoleKey: local.SECRET_KEY, bucket, maximumBytes: 32_000_000 }),
  { async authorize(input) {
    assert.equal(input.tenantId, tenantId);
    assert.ok(["verification_admission", "verification_replay", "policy_replay"].includes(input.purpose));
  } },
);

const registered = await repository.getRegisteredCapture({ tenantId, captureId: selected.captureId });
assert.deepEqual(registered.capture.contentArtifact, projectionAdmission.sourceArtifact);
const parser = { async parse(): Promise<never> { throw new Error("PARSER_FORBIDDEN_IN_CLAIMS_PROOF"); } };
const admission = new VerificationAdmissionService(repository, parser, {
  parserVersion: projectionAdmission.parserVersion,
  imageDigest: projectionAdmission.imageDigest,
  limits: VERIFICATION_PARSER_LIMITS,
}, {
  storageBucket: bucket,
  producerVersion: "verification-admission.v1",
  encryptionClass: "supabase-managed",
  retentionClass: "verification-audit",
  now: () => new Date().toISOString(),
});
const admitted = await admission.hydrateAdmittedProjection({
  tenantId,
  captureId: selected.captureId,
  expectedSourceArtifact: { artifactId: projectionAdmission.sourceArtifact.artifactId, digest: projectionAdmission.sourceArtifact.digest as `sha256:${string}` },
  transformationArtifactId: projectionAdmission.transformationArtifact.artifactId,
  projectionArtifactId: projectionAdmission.projectionArtifact.artifactId,
});
assert.deepEqual(admitted.receipt.projectionArtifact, projectionAdmission.projectionArtifact);
checks.genuine_native_projection_rehydrated = true;

const selector = { kind: "html" as const, domPath: "1/5/2/0/0/1/0/0" };
const selectedEvidence = projectionSelectorResolver.resolve({
  captureId: selected.captureId,
  representationArtifactId: admitted.receipt.projectionArtifact.artifactId,
  representationDigest: admitted.receipt.projectionArtifact.digest as `sha256:${string}`,
  selector,
  content: admitted.content,
});
assert.equal(selectedEvidence.resolution.status, "resolved");
const evidenceText = new TextDecoder("utf-8", { fatal: true }).decode(selectedEvidence.selectedContent);
assert.equal(evidenceText, "Best Biological Age Test: SystemAge vs. Function Health & TruDiagnostic Comparison");
checks.genuine_projection_selector_replayed = true;

const producerWorkItemId = randomUUID();
const producerAttemptId = randomUUID();
const createdAt = new Date().toISOString();
await writeFile(startupJournal, JSON.stringify({
  schemaVersion: "verification-claims-report-worker-startup.v1",
  namespace,
  tenantId,
  missionId,
  fixtureName,
  operationIds: plannedOperationIds,
  createdAt,
  intendedMutationScope: "isolated local claims/report worker proof fixtures",
}, null, 2) + "\n", { flag: "wx" });
startupJournalWritten = true;
await database.transaction(tenantId, async (client) => {
  await client.query("insert into orchestration.mission(id,tenant_id,slug,goal) values($1,$2,$3,$4)", [missionId, tenantId, `claims-report-proof-${namespace}`, "Native claims/report lease, replay and signed custody proof"]);
  await client.query("insert into orchestration.work_item(id,tenant_id,mission_id,kind,spec) values($1,$2,$3,'verify_extraction',$4::jsonb)", [producerWorkItemId, tenantId, missionId, JSON.stringify({ namespace, role: "claims_report_producer" })]);
  await client.query("insert into orchestration.attempt(id,tenant_id,work_item_id,attempt_no,agent_deployment_id,started_at) values($1,$2,$3,1,$4,$5)", [producerAttemptId, tenantId, producerWorkItemId, producerDeploymentId, createdAt]);
});

const register = async (input: {
  value: unknown; artifactType: string; mediaType?: string; parents?: readonly string[]; label: string;
}): Promise<VerificationArtifactHandle> => {
  const bytes = typeof input.value === "string" ? new TextEncoder().encode(input.value) : new TextEncoder().encode(canonicalizeJson(input.value));
  const parents = [...(input.parents ?? [])];
  return repository.registerContentAddressedArtifact({
    tenantId,
    producerAttemptId,
    missionId,
    artifactType: input.artifactType,
    bytes,
    createdAt: new Date().toISOString(),
    parentArtifactIds: parents,
    ...(parents.length ? { transformationSignature: digestCanonicalJson({ namespace, label: input.label, parents }) } : {}),
    producerActivityId: "verification-claims-report-native-proof",
    producerVersion: "v1",
    mediaType: input.mediaType ?? "application/json",
    encryptionClass: "supabase-managed",
    retentionClass: "verification-audit",
    dataClassification: "restricted",
    bucketClass: "ledger",
    storageBucket: bucket,
  });
};

const policy: VerificationPolicyDefinition = {
  schemaVersion: "verification-policy.v1",
  policyVersion,
  definitionId: `claims-report-proof-${namespace}`,
  criticalDownstreamUses: [],
  requireCrossFamilyForRisk: [],
  requireIndependentAuthorityForScopes: [],
  mixedEvidenceOutcome: "review",
  unknownCriticalOutcome: "review",
  authorityWithheldOutcome: "review",
  reviewAvailable: true,
};
const policyArtifact = await register({ value: policy, artifactType: "verification_policy", label: "policy" });
const projectionGrants: Array<{
  tenantId: string;
  assertions: { artifactId: string; digest: string };
  admissions: Array<{ captureId: string; projectionArtifactId: string; transformationArtifactId: string }>;
}> = [];

async function createVerifierOwnership(label: string) {
  const workItemId = randomUUID();
  const attemptId = randomUUID();
  await database.transaction(tenantId, async (client) => {
    await client.query("insert into orchestration.work_item(id,tenant_id,mission_id,kind,spec) values($1,$2,$3,'verify_extraction',$4::jsonb)", [workItemId, tenantId, missionId, JSON.stringify({ namespace, role: "claims_report_verifier", label })]);
    await client.query("insert into orchestration.attempt(id,tenant_id,work_item_id,attempt_no,agent_deployment_id,started_at) values($1,$2,$3,1,$4,$5)", [attemptId, tenantId, workItemId, verifierDeploymentId, new Date().toISOString()]);
  });
  return { workItemId, attemptId };
}

async function prepareOperation(kind: "verification_claims" | "verification_report", label: string, operationId: string): Promise<PreparedOperation> {
  operationIds.push(operationId);
  const ownership = await createVerifierOwnership(label);
  const actorId = randomUUID();
  const context: OperationContext = {
    contractVersion: "v1",
    tenantId,
    operationId,
    attemptId: ownership.attemptId,
    missionId,
    workItemId: ownership.workItemId,
    correlationId: randomUUID(),
    actor: { kind: "service", id: actorId, serviceIdentity: "knowledge_worker" },
    capabilityVersion: "verification.v1",
    idempotencyKey: `${namespace}:${label}`,
    reason: "Native claims/report worker custody proof",
  };
  const assertionId = randomUUID();
  const evidenceId = randomUUID();
  const fragmentId = randomUUID();
  const intentId = randomUUID();
  const projectedCapture = { ...registered.capture, canonicalProjectionArtifact: admitted.receipt.projectionArtifact };
  const reportText = kind === "verification_report" ? `# Native claims/report proof ${namespace} ${label}\n\n${evidenceText}\n` : undefined;
  const reportAssertionStart = reportText?.indexOf(evidenceText);
  const reportArtifact = reportText === undefined ? undefined : await register({
    value: reportText,
    artifactType: "report_markdown",
    mediaType: "text/markdown",
    parents: [admitted.receipt.projectionArtifact.artifactId],
    label: `${label}:report`,
  });
  const assertion = {
    assertionId,
    kind: kind === "verification_report" ? "report_assertion" as const : "claim" as const,
    claimType: "comparative" as const,
    proposition: evidenceText,
    producer: { deploymentId: producerDeploymentId, attemptId: producerAttemptId, capabilityVersion: "verification-claims-proof.v1" },
    ...(reportArtifact ? { outputArtifactId: reportArtifact.artifactId, outputRange: { start: reportAssertionStart!, end: reportAssertionStart! + evidenceText.length } } : {}),
    qualifiers: [],
    entityBindings: [],
    derivation: "direct" as const,
    evidence: [{
      evidenceId,
      fragment: { fragmentId, captureId: selected.captureId, representationArtifactId: admitted.receipt.projectionArtifact.artifactId, selector },
      role: "supports" as const,
      origin: "declared" as const,
      expectedSelectedContentDigest: sha256Digest(selectedEvidence.selectedContent),
      authority: { authority: "primary" as const, independence: "interested_party" as const, directness: "direct" as const, freshness: "current" as const, applicability: "direct" as const },
      parserLineageArtifactIds: [admitted.receipt.transformationArtifact.artifactId],
    }],
    intent: { intentId, operation: kind === "verification_report" ? "verify_report_coverage" as const : "verify_claim_support" as const, subject: assertionId, expectedResult: "The registered projection resolves the exact selected text.", method: "Replay the native projection selector and compare its digest.", acceptanceCriteria: ["native projection envelope is admitted", "selector resolves exactly"], abstainWhen: ["projection custody is unavailable"] },
    riskClass: "medium" as const,
    downstreamUse: ["semantic_verification"],
    atomic: true,
  };
  const bundle: VerificationBundle = {
    verificationContractVersion: "verification.v1",
    bundleId: randomUUID(),
    policyVersion,
    producer: assertion.producer,
    verifier: { deploymentId: verifierDeploymentId, attemptId: ownership.attemptId, capabilityVersion: "verification.v1" },
    sources: [registered.source],
    captures: [projectedCapture],
    assertions: [assertion],
    metricObservations: [],
    lineage: [],
  };
  let assertionsArtifact: VerificationArtifactHandle;
  let request: PreparedOperation["request"];
  if (kind === "verification_claims") {
    const claims = VerificationClaimsArtifactSchema.parse({ schemaVersion: "verification-claims-artifact.v1", bundle });
    assertionsArtifact = await register({ value: claims, artifactType: "verification_claims_artifact", parents: [admitted.receipt.transformationArtifact.artifactId], label: `${label}:claims` });
    request = { verificationContractVersion: "verification.v1", captureIds: [selected.captureId], assertions: { artifactId: assertionsArtifact.artifactId, digest: assertionsArtifact.digest as `sha256:${string}` } };
  } else {
    assert.ok(reportArtifact && reportText);
    assert.notEqual(reportAssertionStart, undefined);
    const ledger = VerificationReportLedgerSchema.parse({
      schemaVersion: "verification-report-ledger.v1",
      reportArtifact,
      bundle,
      assertions: [{ assertion, exactText: evidenceText, start: reportAssertionStart, end: reportAssertionStart + evidenceText.length, citationRequired: true, claimWeight: 1, severity: "medium", citations: [{ citationId: randomUUID(), evidenceId }], requiredQualifiers: ["independently confirmed"] }],
    });
    assertionsArtifact = await register({ value: ledger, artifactType: "verification_report_ledger", parents: [reportArtifact.artifactId, admitted.receipt.transformationArtifact.artifactId], label: `${label}:ledger` });
    request = { verificationContractVersion: "verification.v1", captureIds: [selected.captureId], report: { artifactId: reportArtifact.artifactId, digest: reportArtifact.digest as `sha256:${string}` }, claimLedger: { artifactId: assertionsArtifact.artifactId, digest: assertionsArtifact.digest as `sha256:${string}` } };
  }
  await repository.recordAssertion({ tenantId, assertion, producerAttemptId });
  projectionGrants.push({ tenantId, assertions: { artifactId: assertionsArtifact.artifactId, digest: assertionsArtifact.digest }, admissions: [{ captureId: selected.captureId, projectionArtifactId: admitted.receipt.projectionArtifact.artifactId, transformationArtifactId: admitted.receipt.transformationArtifact.artifactId }] });
  return { kind, context, request, assertionsArtifact };
}

const claimsRecovery = await prepareOperation("verification_claims", "claims-recovery", plannedOperationIds.claimsRecovery);
const reportRecovery = await prepareOperation("verification_report", "report-recovery", plannedOperationIds.reportRecovery);
const expiryReclaim = await prepareOperation("verification_claims", "claims-expiry-reclaim", plannedOperationIds.expiryReclaim);
const cancellation = await prepareOperation("verification_claims", "claims-cancellation", plannedOperationIds.cancellation);

const keys = generateKeyPairSync("ed25519");
const keyId = `claims-report-proof-${namespace}`;
const privateKeyPem = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicKeyPem = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const signer = createEd25519Signer(privateKeyPem, keyId);
const verifier = createEd25519Verifier({ [keyId]: publicKeyPem });
const claimsService = new VerificationClaimsApplicationService({
  artifactResolver: repository.createTrustedArtifactResolver(),
  captures: repository,
  runtimePrincipals: new PostgresVerificationClaimsRuntimePrincipals(database),
  projectionGrants: new VerificationClaimsProjectionGrantCatalog(projectionGrants),
  nativeProjectionAdmission: admission,
  selectorResolvers: [projectionSelectorResolver],
});
const sealer = createVerificationClaimsAuditSealer({
  repository,
  policyCatalog: new VerificationSealPolicyCatalog([{ tenantId, policyVersion, policyArtifact: { artifactId: policyArtifact.artifactId, digest: policyArtifact.digest } }]),
  storageBucket: bucket,
  runtime: { code: { gitSha: "uncommitted-native-proof", dirty: true, normalizerVersion: "RFC8785.v1" }, platform: "node24-windows", deploymentId: verifierDeploymentId },
  signer,
  now: () => new Date().toISOString(),
});
const dependencies = { service: claimsService, repository, operations: database, storageBucket: bucket, now: () => new Date().toISOString(), sealer };
const registry = new CanonicalActivityRegistry([
  verificationClaimsActivityHandler(dependencies, "verification_claims"),
  verificationClaimsActivityHandler(dependencies, "verification_report"),
]);
assert.deepEqual([...registry.activities()].sort(), ["verification_claims:verify_claims_and_register", "verification_report:verify_report_and_register"]);
const executor = createCanonicalActivityExecutor(database, registry);
const operationService = new PostgresKnowledgeOperationService(database, { admittedOperationKinds: registry.operationKinds() });

async function submit(prepared: PreparedOperation) {
  const useCase = prepared.kind === "verification_claims" ? "verifyClaims" : "verifyReport";
  await operationService.submit(prepared.kind, {
    context: prepared.context,
    input: { schemaVersion: "verification-service-request.v1", useCase, request: prepared.request },
    expectedVersions: { verification: "verification.v1", service: "verification-service-request.v1" },
  }, "http://localhost");
}
for (const prepared of [claimsRecovery, reportRecovery, expiryReclaim, cancellation]) await submit(prepared);

async function hydrate(handle: VerificationArtifactHandle) {
  const resolver = repository.createTrustedArtifactResolver();
  await resolver.authorizeArtifact({ tenantId, artifactId: handle.artifactId, purpose: "verification_replay" });
  return resolver.hydrateRegisteredArtifact({ tenantId, artifactId: handle.artifactId });
}

async function assertSignedTerminal(result: Awaited<ReturnType<CanonicalDurableKnowledgeWorker["runOperationOnce"]>>, prepared: PreparedOperation) {
  assert.ok(result);
  assert.equal(result.operation?.status, "succeeded");
  const receiptBody = result.receipt.body as Record<string, unknown>;
  const { eventId: _eventId, fencingToken: _fencingToken, ...terminalValue } = receiptBody;
  const terminal = prepared.kind === "verification_claims"
    ? VerificationClaimsOperationResultSchema.parse(terminalValue)
    : VerificationReportOperationResultSchema.parse(terminalValue);
  const resultHydrated = await hydrate(terminal.resultArtifact);
  const { resultArtifact: _self, ...registeredBody } = terminal;
  assert.equal(new TextDecoder().decode(resultHydrated.bytes), canonicalizeJson(registeredBody));
  const manifestHydrated = await hydrate(terminal.output.sealedRun.manifestArtifact);
  const audit = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestHydrated.bytes)) as VerificationAuditBundle;
  const inspection = await inspectAuditBundle(audit, verifier);
  assert.equal(inspection.valid, true);
  assert.equal(inspection.signatureStatus, "verified");
  assert.equal(inspection.manifestDigest, terminal.output.sealedRun.manifestDigest);
  const replayIdentity = await new PostgresVerificationClaimsRuntimePrincipals(database).bind({
    context: prepared.context,
    assertionsArtifact: terminal.output.verified.assertionsArtifact,
    captureIds: prepared.request.captureIds,
  });
  const admittedProjectionBinding = digestCanonicalJson({
    captureId: admitted.receipt.captureId,
    sourceArtifact: admitted.receipt.sourceArtifact,
    projectionArtifact: admitted.receipt.projectionArtifact,
  });
  const replay = await replayVerificationAudit(audit, {
    artifactResolver: repository.createTrustedArtifactResolver(),
    runtimePrincipals: replayIdentity.runtimePrincipals,
    signatureVerifier: verifier,
    selectorResolvers: [projectionSelectorResolver],
    isProjectionLineageAdmitted: (binding) => digestCanonicalJson(binding) === admittedProjectionBinding,
  });
  assert.equal(replay.deterministicResultDigest, audit.deterministicResultDigest);
  assert.equal(replay.policyOutcome, terminal.output.sealedRun.policyOutcome);
  checks[prepared.kind === "verification_report" ? "report_canonical_gate_and_policy_replay_exact" : "claims_canonical_and_policy_replay_exact"] = true;
  const loaded = await repository.loadAuditBundle(tenantId, terminal.output.sealedRun.runId);
  assert.equal(canonicalizeJson(loaded), canonicalizeJson(audit));
  const run = await database.transaction(tenantId, async (client) => (await client.query<Record<string, unknown>>(
    "select producer_attempt_id,verifier_attempt_id,status from evidence.verification_run where tenant_id=$1 and id=$2",
    [tenantId, terminal.output.sealedRun.runId],
  )).rows[0]);
  assert.ok(run);
  assert.equal(run.producer_attempt_id, producerAttemptId);
  assert.notEqual(run.producer_attempt_id, run.verifier_attempt_id);
  assert.ok(["review", "failed"].includes(String(run.status)));
  return { terminal, audit, fencingToken: Number(receiptBody.fencingToken) };
}

async function recoveryRun(prepared: PreparedOperation) {
  let stoppedLease: LeasedStep | undefined;
  const interruptedRepository = new Proxy(database, { get(target, property) {
    if (property === "completeStep") return async (_tenant: string, lease: LeasedStep) => { stoppedLease = lease; throw new Error("SIMULATED_POST_RESULT_STOP"); };
    if (property === "failStep") return async () => { throw new Error("SIMULATED_STOP_PREVENTS_CATCH_CLEANUP"); };
    const value = Reflect.get(target, property, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const interrupted = new CanonicalDurableKnowledgeWorker(`${namespace}-interrupted`, tenantId, interruptedRepository, executor, 30_000, registry.operationKinds());
  await assert.rejects(interrupted.runOperationOnce(prepared.context.operationId), /SIMULATED_POST_RESULT_STOP/u);
  assert.ok(stoppedLease);
  assert.equal((await database.getOperation(tenantId, prepared.context.operationId))?.status, "running");
  assert.equal((await database.listReceipts(tenantId, prepared.context.operationId)).length, 0);
  await database.heartbeat(tenantId, stoppedLease, 350);
  await new Promise((resolveWait) => setTimeout(resolveWait, 550));
  const replacement = new CanonicalDurableKnowledgeWorker(`${namespace}-replacement`, tenantId, database, executor, 30_000, registry.operationKinds());
  const result = await replacement.runOperationOnce(prepared.context.operationId);
  const signed = await assertSignedTerminal(result, prepared);
  assert.ok(signed.fencingToken > stoppedLease.fencingToken);
  assert.equal(await replacement.runOperationOnce(prepared.context.operationId), undefined);
  return { operationId: prepared.context.operationId, originalFencingToken: stoppedLease.fencingToken, replacementFencingToken: signed.fencingToken, terminal: signed.terminal, audit: signed.audit };
}

const claimsResult = await recoveryRun(claimsRecovery);
checks.claims_recovered_without_duplicate_terminal_work = true;
const reportResult = await recoveryRun(reportRecovery);
assert.equal(reportResult.terminal.output.sealedRun.policyOutcome, "fail");
assert.equal((reportResult.terminal.output.verified as { coverageScope: string }).coverageScope, "producer_declared_assertions_only");
checks.report_recovered_with_signed_monotonic_gate = true;

const expiredLease = await database.claimOperation(tenantId, expiryReclaim.context.operationId, `${namespace}-expired`, 350);
assert.ok(expiredLease);
await new Promise((resolveWait) => setTimeout(resolveWait, 550));
const expiredBytes = new TextEncoder().encode(canonicalizeJson({ namespace, scenario: "expired-stale-write" }));
await assert.rejects(repository.registerFencedContentAddressedArtifact({ artifact: {
  tenantId, producerAttemptId: expiryReclaim.context.attemptId, missionId, bytes: expiredBytes, mediaType: "application/json", createdAt: new Date().toISOString(),
  producerActivityId: "verification-claims-proof-stale", producerVersion: "v1", encryptionClass: "supabase-managed", retentionClass: "verification-audit",
  dataClassification: "restricted", parentArtifactIds: [], artifactType: "deterministic_verification_result", bucketClass: "ledger", storageBucket: bucket,
}, lease: { stepId: expiredLease.id, leaseToken: expiredLease.leaseToken, fencingToken: expiredLease.fencingToken, holderIdentity: expiredLease.holderIdentity } }), /VERIFICATION_RUN_STALE_LEASE/u);
await assert.rejects(database.completeStep(tenantId, expiredLease, { id: randomUUID(), idempotencyKey: `${namespace}:stale-complete`, receiptKind: "verification_claims.succeeded", executorIdentity: namespace, output: { stale: true } }));
const staleCount = await database.transaction(tenantId, async (client) => Number((await client.query<{ count: number }>("select count(*)::int count from orchestration.artifact where tenant_id=$1 and sha256=$2", [tenantId, sha256Digest(expiredBytes).slice(7)])).rows[0]!.count));
assert.equal(staleCount, 0);
const reclaimedWorker = new CanonicalDurableKnowledgeWorker(`${namespace}-reclaimer`, tenantId, database, executor, 30_000, registry.operationKinds());
const reclaimed = await reclaimedWorker.runOperationOnce(expiryReclaim.context.operationId);
const reclaimedSigned = await assertSignedTerminal(reclaimed, expiryReclaim);
assert.ok(reclaimedSigned.fencingToken > expiredLease.fencingToken);
checks.expired_lease_stale_artifact_and_receipt_denied_then_reclaimed = true;

const cancelledLease = await database.claimOperation(tenantId, cancellation.context.operationId, `${namespace}-cancelled`, 30_000);
assert.ok(cancelledLease);
await database.cancelOperation(tenantId, cancellation.context.operationId, { actorIdentity: namespace, correlationId: randomUUID() });
await assert.rejects(executor(cancelledLease), /VERIFICATION_OPERATION_NOT_ACTIVE/u);
const cancelledBytes = new TextEncoder().encode(canonicalizeJson({ namespace, scenario: "cancelled-stale-write" }));
await assert.rejects(repository.registerFencedContentAddressedArtifact({ artifact: {
  tenantId, producerAttemptId: cancellation.context.attemptId, missionId, bytes: cancelledBytes, mediaType: "application/json", createdAt: new Date().toISOString(),
  producerActivityId: "verification-claims-proof-stale", producerVersion: "v1", encryptionClass: "supabase-managed", retentionClass: "verification-audit",
  dataClassification: "restricted", parentArtifactIds: [], artifactType: "deterministic_verification_result", bucketClass: "ledger", storageBucket: bucket,
}, lease: { stepId: cancelledLease.id, leaseToken: cancelledLease.leaseToken, fencingToken: cancelledLease.fencingToken, holderIdentity: cancelledLease.holderIdentity } }), /VERIFICATION_RUN_STALE_LEASE/u);
await assert.rejects(database.completeStep(tenantId, cancelledLease, { id: randomUUID(), idempotencyKey: `${namespace}:cancelled-complete`, receiptKind: "verification_claims.succeeded", executorIdentity: namespace, output: { stale: true } }));
assert.equal((await database.getOperation(tenantId, cancellation.context.operationId))?.status, "cancelled");
assert.equal((await database.listReceipts(tenantId, cancellation.context.operationId)).length, 0);
checks.cancelled_operation_denied_activity_artifact_and_receipt = true;

const sourcePaths = [
  "packages/application/src/verification-claims.ts",
  "packages/persistence/src/verification.ts",
  "packages/persistence/src/verification-claims-principals.ts",
  "apps/worker/src/verification-claims-activity.ts",
  "apps/worker/src/verification-claims-sealer.ts",
  "scripts/prove-verification-claims-report-worker.ts",
];
const sourceFiles = await Promise.all(sourcePaths.map(async (path) => {
  const bytes = await readFile(path);
  return { path: `KS/${path}`, sha256: createHash("sha256").update(bytes).digest("hex"), byteLength: bytes.byteLength };
}));
const receipt = {
  schemaVersion: "verification-claims-report-worker-proof.v1",
  namespace,
  tenantId,
  missionId,
  fixtureName,
  startupJournal,
  createdAt: new Date().toISOString(),
  providerDispatches: 0,
  parserDispatches: 0,
  projection: { captureId: selected.captureId, projectionArtifact: admitted.receipt.projectionArtifact, transformationArtifact: admitted.receipt.transformationArtifact, selectedContentDigest: selectedEvidence.resolution.selectedContentDigest },
  checks,
  publicKeyPem,
  sourceFiles,
  results: {
    claimsRecovery: { operationId: claimsResult.operationId, originalFencingToken: claimsResult.originalFencingToken, replacementFencingToken: claimsResult.replacementFencingToken, resultArtifact: claimsResult.terminal.resultArtifact, manifestArtifact: claimsResult.terminal.output.sealedRun.manifestArtifact, runId: claimsResult.terminal.output.sealedRun.runId, policyOutcome: claimsResult.terminal.output.sealedRun.policyOutcome },
    reportRecovery: { operationId: reportResult.operationId, originalFencingToken: reportResult.originalFencingToken, replacementFencingToken: reportResult.replacementFencingToken, resultArtifact: reportResult.terminal.resultArtifact, manifestArtifact: reportResult.terminal.output.sealedRun.manifestArtifact, runId: reportResult.terminal.output.sealedRun.runId, policyOutcome: reportResult.terminal.output.sealedRun.policyOutcome, gateDigest: reportResult.audit.manifest.gateDigest },
    expiryReclaim: { operationId: expiryReclaim.context.operationId, originalFencingToken: expiredLease.fencingToken, replacementFencingToken: reclaimedSigned.fencingToken, resultArtifact: reclaimedSigned.terminal.resultArtifact, runId: reclaimedSigned.terminal.output.sealedRun.runId },
    cancellation: { operationId: cancellation.context.operationId, fencingToken: cancelledLease.fencingToken, status: "cancelled" },
  },
  limitations: ["Deterministic mechanical verification only; no semantic admission or human review", "Report coverage remains producer-declared assertions only", "Local development PostgreSQL and Storage proof; no remote environment", "Process interruption is injected after registered terminal work; no OS process kill"],
};
const output = resolve("../internal", `verification-claims-report-worker-${namespace}.json`);
await writeFile(output, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
const outputHash = createHash("sha256").update(await readFile(output)).digest("hex");
console.log(JSON.stringify({ output, sha256: outputHash, checks: Object.keys(checks).length, operations: operationIds.length, parserDispatches: 0, providerDispatches: 0 }));
} catch (error) {
  if (startupJournalWritten) {
    const failure = error instanceof Error ? error : new Error("UNKNOWN_NATIVE_PROOF_FAILURE");
    await writeFile(resolve("../internal", `verification-claims-report-worker-failure-${namespace}.json`), JSON.stringify({
      schemaVersion: "verification-claims-report-worker-failure.v1",
      namespace,
      startupJournal,
      failedAt: new Date().toISOString(),
      errorName: failure.name,
      errorCode: typeof (failure as Error & { code?: unknown }).code === "string" ? (failure as Error & { code: string }).code : "UNCLASSIFIED",
      errorMessage: failure.message,
      createdOperationIds: operationIds,
    }, null, 2) + "\n", { flag: "wx" });
  }
  throw error;
} finally {
  await database.close();
}
