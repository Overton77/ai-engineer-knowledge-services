import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  VerificationAdmissionService,
  VerificationMetricApplicationService,
  VerificationMetricProfileCatalog,
  VerificationOperationApplicationService,
  VerificationSealPolicyCatalog,
  type VerificationSealPolicyGrant,
  replayVerificationMetricAudit,
  replayVerificationAudit,
} from "@aiengineer/knowledge-application";
import { SandboxedVerificationParser, VERIFICATION_PARSER_LIMITS } from "@aiengineer/knowledge-conversion";
import { PostgresCanonicalRepository, PostgresKnowledgeOperationService, PostgresVerificationMetricRuntimePrincipals, PostgresVerificationRepository } from "@aiengineer/knowledge-persistence";
import { SupabaseArtifactStore } from "@aiengineer/knowledge-runtime";
import { canonicalizeJson, projectionSelectorResolver, sha256Digest, type VerificationArtifactHandle } from "@aiengineer/knowledge-verification";
import { CanonicalActivityRegistry } from "../apps/worker/src/activity-registry.js";
import { CanonicalDurableKnowledgeWorker } from "../apps/worker/src/canonical-worker.js";
import { verificationMetricActivityHandler } from "../apps/worker/src/verification-metric-activity.js";
import { createVerificationMetricAuditSealer } from "../apps/worker/src/verification-metric-sealer.js";
import { proveMetricRuntime } from "./verification-metric-runtime-proof.js";
import { proveMetricSealCrash } from "./verification-seal-crash-proof.js";

const connectionString = process.env.POSTGRES_URL?.trim();
const projectUrl = process.env.SUPABASE_URL?.trim();
const serviceRoleKey = process.env.SUPABASE_SECRET_KEY?.trim();
if (!connectionString || !projectUrl || !serviceRoleKey) throw new Error("LOCAL_METRIC_PROOF_CONFIGURATION_REQUIRED");
const databaseTarget = new URL(connectionString), storageTarget = new URL(projectUrl);
const loopback = (url: URL) => url.hostname === "localhost" || url.hostname === "127.0.0.1";
if (!loopback(databaseTarget) || databaseTarget.port !== "54322" || !loopback(storageTarget) || storageTarget.port !== "54321") {
  throw new Error("LOCAL_METRIC_PROOF_REFUSED_NONLOCAL_TARGET");
}

const imageDigest = "sha256:1669a3f9674b2e0a70ba1c8686c1cb3647492b8268bdfa7a9a4452fb0530fb37" as const;
const namespace = `verification-metric-service-${randomUUID()}`;
const tenantId = randomUUID(), missionId = randomUUID(), workItemId = randomUUID();
const producerAttemptId = randomUUID(), verifierAttemptId = randomUUID(), sameDeploymentAttemptId = randomUUID();
const sourceId = randomUUID(), bucket = "ai-engineer-cloud-bucket";
const now = () => new Date().toISOString();
const createdAt = now();
const checks: Record<string, boolean> = {};
let sealingEvidence: {operationId:string;runId:string;manifestDigest:string;policyOutcome:string}|undefined;
let sealingPolicyGrant:VerificationSealPolicyGrant|undefined;
let sealingService:ReturnType<typeof createVerificationMetricAuditSealer>|undefined;
let failedSealingEvidence:{operationId:string;runId:string;manifestDigest:string;policyOutcome:string}|undefined;
let nativeReplayEvidence:{profileArtifactId:string;deterministicResultDigest:string;policyDecisionDigest:string;replayedArtifactIds:readonly string[]}|undefined;
let sealCrashEvidence:Awaited<ReturnType<typeof proveMetricSealCrash>>|undefined;
const database = new PostgresCanonicalRepository({ connectionString, localOnly: true, connectionTimeoutMs: 3_000 });
const repository = new PostgresVerificationRepository(database, new SupabaseArtifactStore({ projectUrl, serviceRoleKey, bucket, maximumBytes: 8_000_000 }), {
  async authorize(input) { if (input.tenantId !== tenantId) throw new Error("METRIC_PROOF_TENANT_DENIED"); },
});
const admission = new VerificationAdmissionService(repository, new SandboxedVerificationParser(imageDigest), {
  parserVersion: "verification-native-parser.v1", imageDigest, limits: VERIFICATION_PARSER_LIMITS,
}, { storageBucket: bucket, producerVersion: "verification-metric-proof.v1", encryptionClass: "supabase-managed", retentionClass: "verification-audit", now });

async function deployment(attemptId: string): Promise<string> {
  return database.transaction(tenantId, async (client) => {
    const row = (await client.query<{ agent_deployment_id: string }>("select agent_deployment_id from orchestration.attempt where tenant_id=$1 and id=$2", [tenantId, attemptId])).rows[0];
    if (!row?.agent_deployment_id) throw new Error("METRIC_PROOF_ATTEMPT_NOT_BOUND");
    return row.agent_deployment_id;
  });
}

const register = (value: unknown, artifactType: string, mediaType = "application/json") => repository.registerContentAddressedArtifact({
  tenantId, bytes: new TextEncoder().encode(typeof value === "string" ? value : canonicalizeJson(value)), mediaType, createdAt,
  producerActivityId: "verification-metric-proof", producerVersion: "1", encryptionClass: "supabase-managed", retentionClass: "verification-audit",
  dataClassification: "restricted", artifactType, bucketClass: "ledger", storageBucket: bucket, producerAttemptId, missionId,
});

function context(attemptId = verifierAttemptId) {
  return {
    tenantId, missionId, workItemId, attemptId, operationId: randomUUID(), correlationId: randomUUID(),
    actor: { kind: "service" as const, id: attemptId, serviceIdentity: "knowledge_worker" as const }, capabilityVersion: "verification-metric-proof.v1",
    idempotencyKey: `${namespace}:${randomUUID()}`, reason: "guarded local metric verification proof", contractVersion: "v1" as const,
  };
}

function metricBundle(input: {
  readonly observationsArtifact?: VerificationArtifactHandle;
  readonly projection: VerificationArtifactHandle;
  readonly capture: VerificationArtifactHandle;
  readonly captureId: string;
  readonly producerDeploymentId: string;
  readonly verifierDeploymentId: string;
  readonly verifierAttemptId: string;
  readonly value: "42" | "43";
}) {
  const edge = (id: string, selector: { domPath: string }, literal: string) => ({
    evidenceId: id, fragment: { fragmentId: `${id}-fragment`, captureId: input.captureId, representationArtifactId: input.projection.artifactId,
      selector: { kind: "html" as const, domPath: selector.domPath } }, role: "supports" as const, origin: "declared" as const,
    expectedSelectedContentDigest: sha256Digest(literal), authority: { authority: "primary" as const, independence: "independent" as const, directness: "direct" as const, freshness: "current" as const, applicability: "direct" as const },
    parserLineageArtifactIds: [],
  });
  const valueEdge = edge("metric-value", { domPath: "1/0" }, "42");
  const unitEdge = edge("metric-unit", { domPath: "1/1" }, "widgets");
  const identityEdge = edge("metric-identity", { domPath: "1/2" }, "Widget X");
  return {
    verificationContractVersion: "verification.v1" as const, bundleId: randomUUID(), policyVersion: "metric-proof-policy.v1",
    producer: { deploymentId: input.producerDeploymentId, attemptId: producerAttemptId, capabilityVersion: "metric-producer.v1" },
    verifier: { deploymentId: input.verifierDeploymentId, attemptId: input.verifierAttemptId, capabilityVersion: "metric-verifier.v1" },
    sources: [{ sourceId, kind: "web_page" as const, canonicalUri: "https://example.test/metric-proof", logicalIdentity: namespace }],
    captures: [{ captureId: input.captureId, sourceId, capturedAt: createdAt, captureMethod: "registered_artifact", captureMethodVersion: "1", contentArtifact: input.capture, canonicalProjectionArtifact: input.projection }],
    assertions: [], lineage: [], metricObservations: [{
      observationId: `metric-${input.value}`, entity: { kind: "product" as const, canonicalId: "product:widget-x", label: "Widget X", aliases: [] }, artifactLevel: "product",
      provider: "fixture-html", providerNativeField: "html.metric", metricDefinition: "published widget count", metricDefinitionVersion: "1", rawValue: Number(input.value), canonicalValue: input.value,
      unit: { symbol: "widgets", dimension: "count", scaleToCanonical: "1" }, period: { timezone: "UTC", semantics: "point" as const }, aggregation: "identity", deduplication: "publisher_native",
      caveats: [], observedAt: createdAt, comparabilityGroup: "widget:count", evidence: [valueEdge, unitEdge, identityEdge],
      evidenceBindings: [
        { evidenceId: valueEdge.evidenceId, facet: "value" as const, expectedLiteral: input.value, comparison: "decimal" as const },
        { evidenceId: unitEdge.evidenceId, facet: "unit" as const, expectedLiteral: "widgets", comparison: "exact_text" as const },
        { evidenceId: identityEdge.evidenceId, facet: "identity" as const, expectedLiteral: "Widget X", comparison: "exact_text" as const },
      ],
    }],
  };
}

async function createMetricInput(input: {
  readonly captureId: string;
  readonly sourceArtifact: VerificationArtifactHandle;
  readonly projection: { readonly projectionArtifact: VerificationArtifactHandle; readonly transformationArtifact: VerificationArtifactHandle };
  readonly producerDeploymentId: string;
  readonly verifierDeploymentId: string;
  readonly verifierAttemptId?: string;
  readonly value: "42" | "43";
  readonly projectionAdmission?: readonly { captureId: string; projectionArtifactId: string; transformationArtifactId: string }[];
}) {
  const bundle = metricBundle({ projection: input.projection.projectionArtifact, capture: input.sourceArtifact, captureId: input.captureId,
    producerDeploymentId: input.producerDeploymentId, verifierDeploymentId: input.verifierDeploymentId, verifierAttemptId: input.verifierAttemptId ?? verifierAttemptId, value: input.value });
  const observationsArtifact = await register(bundle, "verification_bundle");
  const profile = {
    schemaVersion: "verification-metric-profile.v1" as const, profileId: `profile-${input.value}-${randomUUID()}`,
    observations: { artifactId: observationsArtifact.artifactId, digest: observationsArtifact.digest }, captureIds: [input.captureId],
    projectionAdmissions: input.projectionAdmission ?? [{ captureId: input.captureId, projectionArtifactId: input.projection.projectionArtifact.artifactId, transformationArtifactId: input.projection.transformationArtifact.artifactId }],
  };
  const profileArtifact = await register(profile, "verification_bundle");
  return {
    request: { verificationContractVersion: "verification.v1" as const, captureIds: [input.captureId], observations: { artifactId: observationsArtifact.artifactId, digest: observationsArtifact.digest } },
    catalog: new VerificationMetricProfileCatalog([{ profileArtifact: { artifactId: profileArtifact.artifactId, digest: profileArtifact.digest }, observations: { artifactId: observationsArtifact.artifactId, digest: observationsArtifact.digest } }]),
    observationsArtifact, profileArtifact,
  };
}

async function runMetricOperation(input: {
  readonly service: VerificationMetricApplicationService;
  readonly request: ReturnType<typeof context> extends never ? never : { verificationContractVersion: "verification.v1"; captureIds: string[]; observations: { artifactId: string; digest: string } };
  readonly attemptId?: string;
  readonly sealer?: Pick<ReturnType<typeof createVerificationMetricAuditSealer>,"seal">;
}) {
  const operations = new PostgresKnowledgeOperationService(database, { admittedOperationKinds: ["verification_metric"] });
  const application = new VerificationOperationApplicationService(operations, "http://localhost");
  const operationContext = context(input.attemptId);
  const accepted = await application.submitVerifyMetricObservation(input.request, operationContext);
  const handler = verificationMetricActivityHandler({ service: input.service, repository, operations: database, storageBucket: bucket, now, ...(input.sealer?{sealer:input.sealer}:{}) });
  const registry = new CanonicalActivityRegistry([handler]);
  const worker = new CanonicalDurableKnowledgeWorker(`${namespace}-worker-${accepted.operationId}`, tenantId, database, async (claim) => {
    const operation = await database.getOperationRecord(tenantId, claim.operationId);
    assert.ok(operation, "METRIC_PROOF_OPERATION_MISSING");
    return registry.execute(operation, claim);
  }, 30_000, registry.operationKinds());
  const result = await worker.runOperationOnce(accepted.operationId);
  assert.ok(result, "METRIC_PROOF_WORKER_DID_NOT_CLAIM");
  assert.equal(result.operation?.status, "succeeded");
  return { accepted, operationContext, body: result.receipt.body as { output: { sealedRun?:{runId:string;manifestDigest:string;policyOutcome:string};result: { valid: boolean; deterministicResult: { summary: { failedCheckCodes: string[] } } } }; resultArtifact: VerificationArtifactHandle } };
}

try {
  await database.transaction(tenantId, async (client) => {
    await client.query("insert into orchestration.mission(id,tenant_id,slug,goal) values($1,$2,$3,'Real metric verification proof')", [missionId, tenantId, namespace]);
    await client.query("insert into orchestration.work_item(id,tenant_id,mission_id,kind) values($1,$2,$3,'verify_extraction')", [workItemId, tenantId, missionId]);
    await client.query("insert into orchestration.attempt(id,tenant_id,work_item_id,attempt_no,agent_deployment_id) values($1,$2,$3,1,'metric-producer')", [producerAttemptId, tenantId, workItemId]);
    await client.query("insert into orchestration.attempt(id,tenant_id,work_item_id,attempt_no,agent_deployment_id) values($1,$2,$3,2,'metric-verifier')", [verifierAttemptId, tenantId, workItemId]);
    await client.query("insert into orchestration.attempt(id,tenant_id,work_item_id,attempt_no,agent_deployment_id) values($1,$2,$3,3,'metric-producer')", [sameDeploymentAttemptId, tenantId, workItemId]);
  });
  const [producerDeploymentId, verifierDeploymentId] = await Promise.all([deployment(producerAttemptId), deployment(verifierAttemptId)]);
  assert.notEqual(producerDeploymentId, verifierDeploymentId); checks.sqlBoundProducerVerifierDistinct = true;

  const sourceArtifact = await register("<html><body><p>42</p><p>widgets</p><p>Widget X</p></body></html>", "source_capture", "text/html");
  const captureId = randomUUID();
  await repository.recordCapture({ tenantId, source: { sourceId, kind: "web_page", canonicalUri: "https://example.test/metric-proof", logicalIdentity: namespace },
    capture: { captureId, sourceId, capturedAt: createdAt, captureMethod: "registered_artifact", captureMethodVersion: "1", contentArtifact: sourceArtifact }, producerAttemptId });
  const admitted = await admission.parseAndAdmit({ tenantId, captureId, expectedSourceArtifact: { artifactId: sourceArtifact.artifactId, digest: sourceArtifact.digest }, kind: "html" });
  assert.equal(admitted.length, 1); const projection = admitted[0]!;
  assert.deepEqual(projection.projectionArtifact.parentArtifactIds, []); checks.nativeHtmlProjectionParentless = true;
  const storedCapture = await repository.getRegisteredCapture({ tenantId, captureId });
  assert.equal(storedCapture.capture.canonicalProjectionArtifact, undefined); checks.storedCaptureDoesNotManufactureProjection = true;

  const validInput = await createMetricInput({ captureId, sourceArtifact, projection, producerDeploymentId, verifierDeploymentId, value: "42" });
  const validService = new VerificationMetricApplicationService({ artifactResolver: repository.createTrustedArtifactResolver(), captures: repository, profiles: validInput.catalog,
    runtimePrincipals: new PostgresVerificationMetricRuntimePrincipals(database), nativeProjectionAdmission: admission, selectorResolvers: [projectionSelectorResolver] });
  const trustedMetric = await validService.verify(validInput.request, context());
  assert.equal(trustedMetric.producerAttemptId, producerAttemptId);
  assert.notEqual(trustedMetric.producerAttemptId, verifierAttemptId);
  assert.equal(trustedMetric.admissionState, "mechanical_only");
  checks.sealProducerAttemptDerivedFromRegisteredArtifact = true;
  if(process.env.VERIFICATION_PROVE_METRIC_SEAL==="1"){
    const policyArtifact=await register({schemaVersion:"verification-policy.v1",policyVersion:"metric-proof-policy.v1",definitionId:"metric-sealing-proof",
      criticalDownstreamUses:["publication"],requireCrossFamilyForRisk:["critical"],requireIndependentAuthorityForScopes:["clinical_utility"],
      mixedEvidenceOutcome:"review",unknownCriticalOutcome:"abstain",authorityWithheldOutcome:"review",reviewAvailable:true},"verification_policy");
    sealingPolicyGrant={tenantId,policyVersion:"metric-proof-policy.v1",policyArtifact:{artifactId:policyArtifact.artifactId,digest:policyArtifact.digest}};
    const sealer=createVerificationMetricAuditSealer({repository,storageBucket:bucket,now,
      policyCatalog:new VerificationSealPolicyCatalog([sealingPolicyGrant]),
      runtime:{code:{gitSha:"local-metric-seal-proof",dirty:true,normalizerVersion:"RFC8785.v1"},platform:"local-supabase",deploymentId:verifierDeploymentId}});
    sealingService=sealer;
    const checkedSealer={async seal(input:Parameters<typeof sealer.seal>[0]){
      const first=await sealer.seal(input);
      await assert.rejects(repository.loadAuditBundle(tenantId,first.runId),/VERIFICATION_RUN_OPERATION_NOT_COMPLETED/);
      const repeated=await sealer.seal({...input,startedAt:now()});
      assert.deepEqual(repeated,first);
      checks.workerSealHiddenUntilCanonicalCompletion=true;
      checks.workerSealRecoveredBeforeCompletion=true;
      return first;
    }};
    const sealed=await runMetricOperation({service:validService,request:validInput.request,sealer:checkedSealer});
    assert.ok(sealed.body.output.sealedRun);
    const audit=await repository.loadAuditBundle(tenantId,sealed.body.output.sealedRun.runId);
    assert.equal(audit.manifest.policyOutcome,"abstain");
    assert.equal(sealed.body.output.result.valid,true);
    assert.equal(audit.manifest.canonicalization.manifestDigest,sealed.body.output.sealedRun.manifestDigest);
    assert.ok(audit.manifest.inputArtifacts.some(item=>item.artifactId===projection.transformationArtifact.artifactId&&item.digest===projection.transformationArtifact.digest));
    const manifestIds=new Set([...audit.manifest.inputArtifacts,...audit.manifest.outputArtifacts].map(item=>item.artifactId));
    for(const item of [...audit.manifest.inputArtifacts,...audit.manifest.outputArtifacts])assert.ok(item.parentArtifactIds.every(parent=>manifestIds.has(parent)));
    checks.sealedManifestRetainsNativeTransformationEnvelope=true;
    checks.sealedManifestContainsRegisteredParentClosure=true;
    const replayIdentity=await new PostgresVerificationMetricRuntimePrincipals(database).bind({context:sealed.operationContext,observationsArtifact:validInput.observationsArtifact,captureIds:validInput.request.captureIds});
    await assert.rejects(replayVerificationAudit(audit,{artifactResolver:repository.createTrustedArtifactResolver(),runtimePrincipals:replayIdentity.runtimePrincipals,selectorResolvers:[projectionSelectorResolver]}),/DETERMINISTIC_REPLAY_DRIFT/);
    const nativeReplay=await replayVerificationMetricAudit(audit,{artifactResolver:repository.createTrustedArtifactResolver(),runtimePrincipals:replayIdentity.runtimePrincipals,
      profileArtifactId:validInput.profileArtifact.artifactId,admission:{hydrateAdmittedProjection:admission.hydrateAdmittedProjection.bind(admission)}});
    assert.equal(nativeReplay.deterministicResultDigest,audit.deterministicResultDigest);
    assert.equal(nativeReplay.policyOutcome,audit.manifest.policyOutcome);
    assert.ok(nativeReplay.replayedArtifactIds.includes(projection.transformationArtifact.artifactId));
    assert.ok(nativeReplay.replayedArtifactIds.includes(projection.nativeOutputArtifact.artifactId));
    checks.nativeMetricReplayMatchesRecordedResultAndPolicy=true;
    nativeReplayEvidence={profileArtifactId:validInput.profileArtifact.artifactId,deterministicResultDigest:nativeReplay.deterministicResultDigest,
      policyDecisionDigest:nativeReplay.policyDecisionDigest,replayedArtifactIds:nativeReplay.replayedArtifactIds};
    checks.nativeMetricReplayRequiresAdmissionEvidence=true;
    await assert.rejects(replayVerificationMetricAudit(audit,{artifactResolver:repository.createTrustedArtifactResolver(),runtimePrincipals:replayIdentity.runtimePrincipals,
      profileArtifactId:randomUUID(),admission:{hydrateAdmittedProjection:admission.hydrateAdmittedProjection.bind(admission)}}),/PROFILE_NOT_RETAINED/);
    checks.nativeMetricReplayRejectsUnretainedProfile=true;
    checks.workerAutomaticallySealsMetricRun=true;
    checks.mechanicalPassDoesNotBecomePolicyPass=true;
    const retry=await sealer.seal({verified:trustedMetric,context:sealed.operationContext,startedAt:now(),
      lease:{stepId:randomUUID(),leaseToken:randomUUID(),fencingToken:1,holderIdentity:"released-proof-retry"}});
    assert.deepEqual(retry,sealed.body.output.sealedRun);
    checks.sealedRetryPreservesManifestAndTiming=true;
    sealingEvidence={operationId:sealed.accepted.operationId,...sealed.body.output.sealedRun};
    if(process.env.VERIFICATION_PROVE_SEAL_CRASH==="1"){
      sealCrashEvidence=await proveMetricSealCrash({database,repository,service:validService,sealer,context:context(),request:validInput.request,
        profileGrant:{profileArtifact:{artifactId:validInput.profileArtifact.artifactId,digest:validInput.profileArtifact.digest},observations:validInput.request.observations},
        policyGrant:sealingPolicyGrant,imageDigest,verifierDeploymentId});
      Object.assign(checks,sealCrashEvidence.checks);
    }
  }
  const valid = await runMetricOperation({ service: validService, request: validInput.request });
  assert.equal(valid.body.output.result.valid, true, JSON.stringify(valid.body.output.result)); checks.durableNativeMetricSucceeded = true;
  const ownership = await database.transaction(tenantId, async (client) => (await client.query<{ producer_attempt_id: string; mission_id: string }>("select producer_attempt_id,mission_id from orchestration.artifact where tenant_id=$1 and id=$2", [tenantId, valid.body.resultArtifact.artifactId])).rows[0]);
  assert.equal(ownership?.producer_attempt_id, verifierAttemptId); assert.equal(ownership?.mission_id, missionId); checks.durableResultOwnershipBound = true;

  const mutatedInput = await createMetricInput({ captureId, sourceArtifact, projection, producerDeploymentId, verifierDeploymentId, value: "43" });
  const mutatedService = new VerificationMetricApplicationService({ artifactResolver: repository.createTrustedArtifactResolver(), captures: repository, profiles: mutatedInput.catalog,
    runtimePrincipals: new PostgresVerificationMetricRuntimePrincipals(database), nativeProjectionAdmission: admission, selectorResolvers: [projectionSelectorResolver] });
  const mutated = await runMetricOperation({ service: mutatedService, request: mutatedInput.request });
  assert.equal(mutated.body.output.result.valid, false); assert.ok(mutated.body.output.result.deterministicResult.summary.failedCheckCodes.includes("METRIC_FACET_SOURCE_BOUND")); checks.mutatedNumericCompletedQualityRejection = true;
  if(sealingService){
    const failedSeal=await runMetricOperation({service:mutatedService,request:mutatedInput.request,sealer:sealingService});
    assert.ok(failedSeal.body.output.sealedRun);
    assert.equal(failedSeal.body.output.result.valid,false);
    const failedAudit=await repository.loadAuditBundle(tenantId,failedSeal.body.output.sealedRun.runId);
    assert.equal(failedAudit.manifest.policyOutcome,"fail");
    checks.mechanicalFailureProducesReadableFailedAudit=true;
    failedSealingEvidence={operationId:failedSeal.accepted.operationId,...failedSeal.body.output.sealedRun};
  }

  const sameInput = await createMetricInput({ captureId, sourceArtifact, projection, producerDeploymentId, verifierDeploymentId: producerDeploymentId, verifierAttemptId: sameDeploymentAttemptId, value: "42" });
  const sameService = new VerificationMetricApplicationService({ artifactResolver: repository.createTrustedArtifactResolver(), captures: repository, profiles: sameInput.catalog,
    runtimePrincipals: new PostgresVerificationMetricRuntimePrincipals(database), nativeProjectionAdmission: admission, selectorResolvers: [projectionSelectorResolver] });
  const same = await runMetricOperation({ service: sameService, request: sameInput.request, attemptId: sameDeploymentAttemptId });
  assert.equal(same.body.output.result.valid, false); assert.ok(same.body.output.result.deterministicResult.summary.failedCheckCodes.includes("PRODUCER_VERIFIER_INDEPENDENT")); checks.sameDeploymentCompletedQualityRejection = true;

  const missingInput = await createMetricInput({ captureId, sourceArtifact, projection, producerDeploymentId, verifierDeploymentId, value: "42", projectionAdmission: [] });
  const missingService = new VerificationMetricApplicationService({ artifactResolver: repository.createTrustedArtifactResolver(), captures: repository, profiles: missingInput.catalog,
    runtimePrincipals: new PostgresVerificationMetricRuntimePrincipals(database), nativeProjectionAdmission: admission, selectorResolvers: [projectionSelectorResolver] });
  await assert.rejects(missingService.verify(missingInput.request, context()), /VERIFICATION_METRIC_PROJECTION_ENVELOPE_GRANT_REQUIRED/); checks.missingEnvelopeFailsClosed = true;
  const wrongInput = await createMetricInput({ captureId, sourceArtifact, projection, producerDeploymentId, verifierDeploymentId, value: "42", projectionAdmission: [{ captureId, projectionArtifactId: projection.projectionArtifact.artifactId, transformationArtifactId: sourceArtifact.artifactId }] });
  const wrongService = new VerificationMetricApplicationService({ artifactResolver: repository.createTrustedArtifactResolver(), captures: repository, profiles: wrongInput.catalog,
    runtimePrincipals: new PostgresVerificationMetricRuntimePrincipals(database), nativeProjectionAdmission: admission, selectorResolvers: [projectionSelectorResolver] });
  await assert.rejects(wrongService.verify(wrongInput.request, context()), /PROJECTION_ENVELOPE|PROJECTION_NATIVE|VERIFICATION_ARTIFACT_JSON_INVALID/); checks.wrongEnvelopeFailsClosed = true;

  Object.assign(checks, await proveMetricRuntime({
    context: context(), request: validInput.request,
    profileGrant: { profileArtifact: { artifactId: validInput.profileArtifact.artifactId, digest: validInput.profileArtifact.digest }, observations: validInput.request.observations },
    verifierDeploymentId, imageDigest, sameDeploymentAttemptId, producerDeploymentId,
    ...(sealingPolicyGrant?{sealingPolicyGrant}:{}),
  }));

  const sourceHashes: Record<string, string> = {};
  for(const file of ["scripts/verification-seal-crash-proof.ts","scripts/verification-seal-crash-child.ts"]){sourceHashes[file]=createHash("sha256").update(await readFile(file)).digest("hex");}
  for(const file of ["apps/worker/src/verification-sealed-replay-activity.ts","apps/worker/src/verification-sealed-replay-runtime.ts","apps/worker/src/verification-metric-sealer.ts","packages/application/src/verification-seal-policy.ts","packages/persistence/src/verification.ts","packages/application/src/verification-replay.ts","packages/verification/src/provenance/replay.ts"]){
    sourceHashes[file]=createHash("sha256").update(await readFile(file)).digest("hex");
  }
  for (const file of ["scripts/prove-verification-metric-service.ts", "scripts/verification-metric-runtime-proof.ts", "packages/application/src/verification-metrics.ts", "packages/persistence/src/verification-metric-principals.ts", "apps/api/src/index.ts", "apps/api/src/server.ts", "apps/worker/src/index.ts", "apps/worker/src/verification-metric-activity.ts", "apps/worker/src/activity-registry.ts", "apps/cli/src/commands.ts", "apps/mcp/src/index.ts", "packages/verification/src/deterministic/engine.ts"]) {
    sourceHashes[file] = createHash("sha256").update(await readFile(file)).digest("hex");
  }
  const receipt = resolve("..", "internal", `${namespace}.json`);
  await writeFile(receipt, JSON.stringify({ capturedAt: now(), tenantId, missionId, producerAttemptId, verifierAttemptId, sameDeploymentAttemptId, imageDigest,
    operations: [valid.accepted.operationId, mutated.accepted.operationId, same.accepted.operationId], ...(sealingEvidence?{sealingEvidence}:{}),...(failedSealingEvidence?{failedSealingEvidence}:{}),...(nativeReplayEvidence?{nativeReplayEvidence}:{}),...(sealCrashEvidence?{sealCrashEvidence}:{}),sourceHashes, checks, providerDispatches: 0, remoteWrites: 0, passed: true }, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ receipt, checks, passed: true }));
} finally {
  await database.close();
}
