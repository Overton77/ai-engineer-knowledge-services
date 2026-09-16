import { generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { CheckpointApplicationService, VerificationClaimsApplicationService, VerificationSealPolicyCatalog, SemanticJudgeProfileCatalog } from "@aiengineer/knowledge-application";
import { PostgresCanonicalRepository, PostgresVerificationRepository, PostgresClaimsReportReadRepository,
  PostgresVerificationClaimsRuntimePrincipals, PostgresCheckpointStore } from "@aiengineer/knowledge-persistence";
import { SupabaseArtifactStore, deterministicUuid } from "@aiengineer/knowledge-runtime";
import { createEd25519Signer, createEd25519Verifier, digestCanonicalJson, canonicalizeJson,
  gatewaySemanticConfigurationDigest, gatewaySemanticOutputSchemaDigest, gatewaySemanticPromptDigest } from "@aiengineer/knowledge-verification";
import { OperationContextSchema, VerificationRecoveryBatchSchema, type VerificationPolicyDefinition } from "@aiengineer/knowledge-contracts";
import { disposableDatabaseUrl, disposableStorageConfig } from "../../../../packages/persistence/test/disposable.mjs";
import { CanonicalDurableKnowledgeWorker } from "../../../worker/src/canonical-worker.js";
import { CanonicalActivityError } from "../../../worker/src/activity-registry.js";
import { verificationClaimsActivityHandler } from "../../../worker/src/verification-claims-activity.js";
import { createVerificationClaimsAuditSealer } from "../../../worker/src/verification-claims-sealer.js";
import { createVerificationClaimsSemanticStage } from "../../../worker/src/verification-claims-semantic-stage.js";
import { createClaimsSourceAuthorityStage, sourceAuthorityClaimDigest, SourceAuthorityReceiptSchema } from "../../../worker/src/verification-claims-source-authority.js";
import { VerificationExecutor, loadExecutorConfig } from "../executor.js";
import { ClaimsIntentSchema } from "../intents.js";
import { createExecutorCustody } from "../store-custody-postgres.js";
import { EXECUTOR_STORAGE_PROFILE } from "../store-custody-profile.js";
import { createDurableRecoveryCustody } from "./recovery-durable-custody.js";
import { createCheckpointCustody } from "./checkpoints-custody.js";
import { CHECKPOINT_POLICY, CHECKPOINT_PROFILE_PINS } from "./checkpoints-policy.js";
import { CanonicalRecoveryHost } from "./recovery-host.js";

const databaseUrl = disposableDatabaseUrl(), storage = disposableStorageConfig();

describe.skipIf(!databaseUrl || !storage)("native recovery host with canonical claims worker and signed audit", () => {
  it.each([
    { name: "missing independent stage", semanticAuthority: false, noAuditFailure: false },
    { name: "native semantic repair", semanticAuthority: true, noAuditFailure: false },
    { name: "terminal without audit", semanticAuthority: false, noAuditFailure: true },
  ])("preserves original scope: $name", async ({ semanticAuthority, noAuditFailure }) => {
    const tenantId = randomUUID(), missionId = randomUUID(), producerWorkId = randomUUID(), verifierWorkId = randomUUID();
    const producerAttemptId = randomUUID(), verifierAttemptId = randomUUID(), operationId = randomUUID();
    const runId = deterministicUuid("verification-claims-run", operationId);
    const root = await mkdtemp(join(tmpdir(), "ks-recovery-native-"));
    const database = new PostgresCanonicalRepository({ connectionString: databaseUrl! });
    const remote = createExecutorCustody({ databaseUrl: databaseUrl!, tenantId, projectUrl: storage!.projectUrl,
      secretKey: storage!.secretKey, producerAttemptId, missionId });
    let host: CanonicalRecoveryHost | undefined;
    try {
      await database.transaction(tenantId, async client => {
        await client.query("insert into orchestration.mission(id,tenant_id,goal) values($1,$2,'Isolated native recovery authority proof')", [missionId, tenantId]);
        for (const [workId, attemptId, deploymentId] of [[producerWorkId, producerAttemptId, "recovery-native-producer"], [verifierWorkId, verifierAttemptId, "recovery-native-verifier"]]) {
          await client.query("insert into orchestration.work_item(id,tenant_id,mission_id,kind) values($1,$2,$3,'build_vectors')", [workId, tenantId, missionId]);
          await client.query("insert into orchestration.attempt(id,tenant_id,work_item_id,attempt_no,agent_deployment_id) values($1,$2,$3,1,$4)", [attemptId, tenantId, workId, deploymentId]);
        }
      });
      const executor = await VerificationExecutor.create(loadExecutorConfig({ VERIFY_STORE_DIR: root, VERIFY_TENANT_ID: tenantId,
        VERIFY_PRODUCER_ATTEMPT_ID: producerAttemptId, VERIFY_VERIFIER_ATTEMPT_ID: verifierAttemptId,
        VERIFY_PRODUCER_DEPLOYMENT_ID: "recovery-native-producer", VERIFY_VERIFIER_DEPLOYMENT_ID: "recovery-native-verifier", VERIFY_GIT_SHA: "native-proof" }));
      executor.store.attachCustody(remote);
      const native = new PostgresVerificationRepository(database, new SupabaseArtifactStore({ projectUrl: storage!.projectUrl,
        serviceRoleKey: storage!.secretKey, bucket: EXECUTOR_STORAGE_PROFILE.intermediate.bucket,
        maximumBytes: EXECUTOR_STORAGE_PROFILE.maximumArtifactBytes }), { async authorize(request) { if (request.tenantId !== tenantId) throw new Error("TEST_TENANT_DENIED"); } });
      const source = await native.registerContentAddressedArtifact({ tenantId, producerAttemptId, missionId,
        bytes: new TextEncoder().encode('{"metric":10,"fixture":{"source":"independent-test-source","license":"CC0","jurisdiction":"synthetic","authority":"primary","independence":"independent","directness":"direct","freshness":"current","applicability":"direct"}}'), mediaType: "application/json", createdAt: new Date().toISOString(),
        producerActivityId: "native-recovery-fixture-source", producerVersion: "v1", encryptionClass: "supabase-managed", retentionClass: "verification-audit",
        dataClassification: "restricted", parentArtifactIds: [], transformationSignature: digestCanonicalJson("fixture-source"),
        artifactType: "source_capture", bucketClass: "source_captures", storageBucket: EXECUTOR_STORAGE_PROFILE.captures.bucket });
      const captureId = randomUUID(), sourceId = randomUUID(), capturedAt = new Date().toISOString();
      await executor.store.writeCapture({ captureId, sourceId, requestedUrl: "https://example.org/native-recovery", finalUrl: "https://example.org/native-recovery",
        capturedAt, captureMethod: "manual", captureMethodVersion: "fixture.v1", contentArtifact: source,
        characters: source.byteLength, sourceKind: "api", logicalIdentity: sourceId });
      const intent = ClaimsIntentSchema.parse({ schemaVersion: "verification-claims-intent.v1", intentId: randomUUID(), policyVersion: "native-recovery.v1",
        claims: [1, 2, 3, 4].map(index => ({ claimId: `claim-${index}`, proposition: `Metric ${index === 2 ? 1 : index} is 10`, claimType: "other",
          evidence: [{ captureId, quote: "10" }] })) });
      const { bundle } = await executor.compileClaims(intent, runId);
      // ClaimsIntent's convenient quote surface is immaterial to this fixture's actual retained JSON selector.
      bundle.assertions.forEach(assertion => { assertion.evidence[0]!.fragment.selector = { kind: "json_pointer", pointer: "/missing" }; });
      await native.recordCapture({ tenantId, source: bundle.sources[0]!, capture: bundle.captures[0]!, producerAttemptId });
      const claimsArtifact = (await executor.store.putJson({ schemaVersion: "verification-claims-artifact.v1", bundle }, {
        mediaType: "application/json", producerActivityId: "native-recovery-fixture-claims", producerVersion: "v1", parentArtifactIds: [source.artifactId],
        transformation: { kind: "fixture-original-claims", bundleDigest: digestCanonicalJson(bundle) } })).handle;
      const policy: VerificationPolicyDefinition = { schemaVersion: "verification-policy.v1", definitionId: "native-recovery", policyVersion: bundle.policyVersion,
        criticalDownstreamUses: [], requireCrossFamilyForRisk: [], requireIndependentAuthorityForScopes: [], mixedEvidenceOutcome: "review",
        unknownCriticalOutcome: "review", authorityWithheldOutcome: "review", reviewAvailable: true };
      const policyArtifact = (await executor.store.putJson(policy, { mediaType: "application/vnd.aiengineer.verification-policy+json",
        producerActivityId: "native-recovery-fixture-policy", producerVersion: "v1" })).handle;
      const model = "openai/gpt-5.6-luna" as const;
      const identity = { deploymentId: "offline-independent-judge", provider: "vercel-ai-gateway", family: "openai", model,
        capability: "llm_evidence_rubric" as const, graderVersion: "evidence-only.v1", promptDigest: gatewaySemanticPromptDigest,
        outputSchemaDigest: gatewaySemanticOutputSchemaDigest, configurationDigest: gatewaySemanticConfigurationDigest(model) };
      const profile = await native.registerContentAddressedArtifact({ tenantId, producerAttemptId: verifierAttemptId, missionId,
        bytes: new TextEncoder().encode(canonicalizeJson({ schemaVersion: "verification-semantic-judge-profile.v1", identity })),
        mediaType: "application/json", createdAt: new Date().toISOString(), producerActivityId: "offline-semantic-profile", producerVersion: "v1",
        encryptionClass: "supabase-managed", retentionClass: "verification-audit", dataClassification: "restricted", parentArtifactIds: [],
        artifactType: "verification_semantic_judge_profile", bucketClass: "ledger", storageBucket: EXECUTOR_STORAGE_PROFILE.intermediate.bucket });
      const sourceAuthorityReceipt = SourceAuthorityReceiptSchema.parse({ schemaVersion: "verification-source-authority-receipt.v1", tenantId,
        policyDigest: policyArtifact.digest, profileDigest: profile.digest, assertions: bundle.assertions.map(assertion => ({
          assertionId: assertion.assertionId, claimDigest: sourceAuthorityClaimDigest(assertion), sources: assertion.evidence.map(edge => ({
            sourceDigest: digestCanonicalJson(bundle.sources[0]), captureDigest: digestCanonicalJson(bundle.captures[0]), contentArtifact: source,
            assessment: { assessmentId: `${assertion.assertionId}:authority`, assertionId: assertion.assertionId, fragmentId: edge.fragment.fragmentId,
              sourceFamilyId: "independent-test-source", sourceOrganizationId: "independent-test-source",
              vector: { authority: "primary", independence: "independent", directness: "direct", freshness: "current", applicability: "direct" },
              claimScope: "descriptive_fact", evidenceScope: "single_sample_technical", publicationRelation: "not_publication",
              jurisdictionKnown: true, licenseKnown: true, freshnessKnown: true },
            criticalFacts: ["source_identity", "authority", "independence", "directness", "freshness", "applicability", "jurisdiction", "license"]
              .map(kind => ({ kind, finding: "known", explanation: "Independent host established the explicit synthetic fixture metadata.", evidenceArtifact: source })),
          })) })) });
      const sourceAuthorityArtifact = semanticAuthority ? await native.registerContentAddressedArtifact({ tenantId, producerAttemptId: verifierAttemptId, missionId,
        bytes: new TextEncoder().encode(canonicalizeJson(sourceAuthorityReceipt)), mediaType: "application/vnd.aiengineer.verification-source-authority-receipt+json",
        createdAt: new Date().toISOString(), producerActivityId: "independent-host-source-assessment", producerVersion: "v1", encryptionClass: "supabase-managed",
        retentionClass: "verification-audit", dataClassification: "restricted", parentArtifactIds: [source.artifactId, policyArtifact.artifactId, profile.artifactId],
        transformationSignature: digestCanonicalJson({ kind: "independent-source-authority", receipt: sourceAuthorityReceipt }),
        artifactType: "verification_source_authority_receipt", bucketClass: "ledger", storageBucket: EXECUTOR_STORAGE_PROFILE.intermediate.bucket }) : undefined;
      const batch = VerificationRecoveryBatchSchema.parse({ tenantId, callerId: "native-recovery-fixture", batchId: randomUUID(), caseId: randomUUID(),
        parentAttemptId: producerAttemptId, recoveryPolicyVersion: "recovery.v1", capturedAt,
        questionIds: bundle.assertions.map(item => item.assertionId), requirements: bundle.assertions.map(item => ({ questionId: item.assertionId,
          requirementId: `${item.assertionId}-scope`, description: item.proposition })),
        items: bundle.assertions.map(assertion => {
          const binding = { claim: { statement: assertion.proposition, qualifiers: assertion.qualifiers },
            evidence: [{ representationDigest: source.digest, selector: assertion.evidence[0]!.fragment.selector, contextDigest: digestCanonicalJson("same-original-context") }],
            captureDigests: [source.digest], policyDigest: policyArtifact.digest, profileDigest: profile.digest };
          return { originalId: assertion.assertionId, questionIds: [assertion.assertionId], inputDigest: digestCanonicalJson(binding), binding,
            observation: { operationId, runId, execution: "pending", family: "execution", earliestStage: "selector", signature: "pending",
              dependencyIds: [`representation:${source.digest}`], diagnosticArtifacts: [] }, usedRounds: 0, attemptedInputDigests: [], attemptedRepairDigests: [] };
        }), limits: { maxRoundsPerOriginal: 2, maxProbeRounds: 1, remainingCalls: 12, remainingCostMicros: 10000, deadline: "2099-01-01T00:00:00.000Z" },
        allowedActions: ["repair"], probeRounds: [] });
      expect(batch.items[0]!.inputDigest).toBe(batch.items[1]!.inputDigest);
      expect(batch.items[0]!.originalId).not.toBe(batch.items[1]!.originalId);
      const custody = createDurableRecoveryCustody(executor.store, remote);
      const authorizationArtifact = await custody.register({ tenantId, kind: "batch", identity: "native-initial-authority",
        value: { schemaVersion: "verification-recovery-native-authorization.v1", runId, claimsArtifactDigest: claimsArtifact.digest, batch,
          requirementBindings: semanticAuthority ? [{ requirementId: batch.requirements[0]!.requirementId, originalId: "claim-1",
            requirementDigest: digestCanonicalJson(batch.requirements[0]), claimDigest: digestCanonicalJson(batch.items[0]!.binding.claim) }] : [] },
        parentArtifactIds: [claimsArtifact.artifactId, policyArtifact.artifactId] });
      const context = OperationContextSchema.parse({ contractVersion: "v1", tenantId, operationId, missionId, workItemId: verifierWorkId,
        attemptId: verifierAttemptId, correlationId: operationId, actor: { kind: "service", id: randomUUID(), serviceIdentity: "knowledge_worker" },
        capabilityVersion: "verification-service.v1", idempotencyKey: `native-recovery:${operationId}`, reason: "Original authorized verification" });
      const keys = generateKeyPairSync("ed25519"), publicKeyPem = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
      const verifier = createEd25519Verifier({ "native-test": publicKeyPem });
      const checkpoints = new CheckpointApplicationService(new PostgresCheckpointStore(database), createCheckpointCustody(executor.store, remote),
        { async reconcile({ operation }) { return { ...operation, state: "unresolved", artifacts: [] }; } }, CHECKPOINT_POLICY);
      host = new CanonicalRecoveryHost({ tenantId, database, custody: remote, store: executor.store, checkpoints,
        reads: new PostgresClaimsReportReadRepository(database, () => native.createTrustedArtifactResolver(), verifier),
        config: { grants: [{ authorizationArtifact, claimsArtifact, context, checkpointScope: { tenantId, runId: batch.caseId,
          producerAttemptId, sessionId: batch.caseId, sandboxId: batch.caseId, namespace: "notes" } }],
          publicKeys: [{ keyId: "native-test", publicKeyPem }] } });
      await host.submit(runId); await host.submit(runId);
      expect(await host.observe(runId)).toMatchObject({ state: "pending", questionDenominator: 4 });
      const claims = new VerificationClaimsApplicationService({ artifactResolver: native.createTrustedArtifactResolver(), captures: native,
        runtimePrincipals: new PostgresVerificationClaimsRuntimePrincipals(database) });
      let semanticStage: ReturnType<typeof createVerificationClaimsSemanticStage> | undefined;
      const sealer = createVerificationClaimsAuditSealer({ repository: native,
        ...(sourceAuthorityArtifact ? { sourceAuthorityStage: createClaimsSourceAuthorityStage({ database, repository: native,
          pins: [{ tenantId, issuerAttemptId: verifierAttemptId, artifact: sourceAuthorityArtifact }] }) } : {}),
        ...(semanticAuthority ? { semanticStage: { async grade(input: Parameters<NonNullable<typeof semanticStage>["grade"]>[0]) {
          if (!semanticStage) throw new Error("TEST_SEMANTIC_AUTHORITY_REQUIRED");
          return semanticStage.grade(input);
        } } } : {}),
        policyCatalog: new VerificationSealPolicyCatalog([{ tenantId, policyVersion: policy.policyVersion,
          policyArtifact: { artifactId: policyArtifact.artifactId, digest: policyArtifact.digest } }]),
        storageBucket: EXECUTOR_STORAGE_PROFILE.intermediate.bucket,
        runtime: { code: { gitSha: "native-recovery-test", dirty: false, normalizerVersion: "RFC8785.v1" }, platform: "disposable-test", deploymentId: "recovery-native-verifier" },
        signer: createEd25519Signer(keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(), "native-test") });
      const handler = verificationClaimsActivityHandler({ service: claims, repository: native, operations: database,
        storageBucket: EXECUTOR_STORAGE_PROFILE.intermediate.bucket, now: () => new Date().toISOString(), sealer }, "verification_claims");
      const worker = new CanonicalDurableKnowledgeWorker("native-recovery-worker", tenantId, database, async claim => {
        if (noAuditFailure) throw new CanonicalActivityError("TEST_AUTHORIZATION_DENIED", "TEST_AUTHORIZATION_DENIED", false);
        const operation = await database.getOperationRecord(tenantId, claim.operationId);
        if (!operation) throw new Error("TEST_OPERATION_REQUIRED");
        const request = operation.request as { input: unknown; expectedVersions: Record<string, string>; authenticatedContext: typeof context };
        return handler.execute({ operation, claim, activity: { schemaVersion: "knowledge-operation-request/v1", kind: "verification_claims",
          operationInput: request.input as never, expectedVersions: request.expectedVersions, context: request.authenticatedContext,
          step: { name: "verify_claims_and_register", ordinal: 0 } } });
      }, 60000, ["verification_claims"]);
      if (noAuditFailure) await expect(worker.runOperationOnce(operationId)).rejects.toThrow("TEST_AUTHORIZATION_DENIED");
      else await worker.runOperationOnce(operationId);
      if (noAuditFailure) {
        expect((await database.getOperation(tenantId, operationId))?.status).toBe("failed");
        const unavailable = await host.observe(runId);
        expect(unavailable).toMatchObject({ questionDenominator: 4, submitted: 4, counts: { unknown: 4 } });
        expect(await host.observe(runId)).toEqual(unavailable);
        const retained = await host.service.read(tenantId, batch.caseId);
        expect(retained.batch.items.every(item => item.observation.execution === "unknown" && !item.observation.runId)).toBe(true);
        expect(retained.initialBatch.questionIds).toEqual(batch.questionIds);
        return;
      }
      expect((await database.getOperation(tenantId, operationId))?.status).toBe("succeeded");
      const observed = await host.observe(runId);
      expect(observed).toMatchObject({ questionDenominator: 4, submitted: 4, counts: { failed: 4 }, cohortTriage: true });
      expect(await host.observe(runId)).toEqual(observed);
      expect((await host.service.read(tenantId, batch.caseId)).initialBatch.questionIds).toEqual(batch.questionIds);
      expect(await database.listReceipts(tenantId, operationId)).toHaveLength(1);
      const initial = await host.service.read(tenantId, batch.caseId);
      expect(initial.batch.items.every(item => item.observation.family === "selector")).toBe(true);
      const repairedBinding = structuredClone(initial.batch.items[0]!.binding);
      repairedBinding.evidence[0]!.selector = { kind: "json_pointer", pointer: "/metric" };
      const probe = await host.probes.run({ caseId: batch.caseId, dependencyId: `representation:${source.digest}`,
        representatives: [{ originalId: "claim-1", binding: repairedBinding }] });
      const afterProbe = await host.service.read(tenantId, batch.caseId);
      const planned = await host.service.plan(tenantId, { caseId: batch.caseId, expectedRevision: afterProbe.revision,
        actions: initial.batch.items.map((item, index) => ({ originalId: item.originalId,
          route: index === 0 ? "repair" as const : "operator" as const, reason: index === 0 ? "Repair the preserved selector" : "Retain explicit operator work",
          diagnosticArtifactIds: item.observation.diagnosticArtifacts.map(artifact => artifact.artifactId),
          rerunStages: index === 0 ? ["selector", "mechanical", "semantic", "policy", "report"] : [],
          ...(index === 0 ? { newBinding: repairedBinding } : {}) })), probes: [probe], reservation: { calls: 1, costMicros: 100 } });
      const claim = await host.claim({ caseId: batch.caseId, planDigest: planned.activePlanDigest!, leaseMs: 300000 });
      const dispatched = await host.service.execute(tenantId, { claim, originalId: "claim-1", reservation: { calls: 1, costMicros: 100 } });
      expect(await host.service.execute(tenantId, { claim, originalId: "claim-1", reservation: { calls: 1, costMicros: 100 } })).toEqual(dispatched);
      if (semanticAuthority) semanticStage = createVerificationClaimsSemanticStage({ service: claims, database, repository: native,
        profiles: new SemanticJudgeProfileCatalog([{ tenantId, operationId, host: "claims", role: "primary", profileArtifact: profile, identity }]),
        settings: { classification: "synthetic", ceilingCostMicros: 100, reservationCostMicros: 100, deadlineMs: 120000 },
        apiKey: "offline-fixture-no-network", storageBucket: EXECUTOR_STORAGE_PROFILE.intermediate.bucket, now: () => new Date().toISOString(),
        fetch: async () => new Response(JSON.stringify({ model, usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.000012 },
          choices: [{ message: { content: JSON.stringify({ schemaVersion: "verification-semantic-judge.v1", assertionId: "claim-1",
            verdict: "directly_supported", nliLabel: "entailed", supportingFragmentIds: ["claim-1:f0"], contradictingFragmentIds: [],
            unsupportedFacets: [], qualifiersPreserved: true, publicRationale: "Offline fixture independently checks retained numeric value 10." }) } }] })),
      });
      await worker.runOperationOnce(dispatched.operationId!);
      expect((await database.getOperation(tenantId, dispatched.operationId!))?.status).toBe("succeeded");
      if (semanticAuthority) {
        const checkpoint = await checkpoints.commit(tenantId, { idempotencyKey: "recovery-evidence-wait", expectedHead: null,
          manifest: { schemaVersion: "scoped-checkpoint.v1", scope: { tenantId, runId: batch.caseId, producerAttemptId,
            sessionId: batch.caseId, sandboxId: batch.caseId, namespace: "notes" }, parentCheckpointId: null,
            ...CHECKPOINT_PROFILE_PINS, mode: "archive", boundary: "verification", files: [], requiredArtifacts: [source], pendingOperations: [] } });
        const beforeWait = await host.service.read(tenantId, batch.caseId);
        const waiting = await host.service.wait(tenantId, { caseId: batch.caseId, expectedRevision: beforeWait.revision,
          checkpointId: checkpoint.checkpointId, reason: "Await independent evidence reconciliation" });
        await expect(host.service.resume(tenantId, { caseId: batch.caseId, expectedRevision: waiting.revision, authorityArtifact: policyArtifact }))
          .rejects.toThrow("RECOVERY_HOST_NEW_AUTHORITY_REQUIRED");
        const verifiedRepair = await new PostgresClaimsReportReadRepository(database, () => native.createTrustedArtifactResolver(), verifier)
          .loadVerifiedClaimsReport(tenantId, dispatched.operationId!);
        const newManifest = (verifiedRepair.result as { output: { sealedRun: { manifestArtifact: typeof source } } }).output.sealedRun.manifestArtifact;
        const resumed = await host.service.resume(tenantId, { caseId: batch.caseId, expectedRevision: waiting.revision, authorityArtifact: newManifest });
        expect(resumed.state).toBe("active");
        expect(resumed.authorityDigest).toBe(newManifest.digest);
        const reconciled = await host.service.reconcile(tenantId, { caseId: batch.caseId, planDigest: planned.activePlanDigest! });
        expect(reconciled.spent).toEqual({ calls: 1, costMicros: 12 });
        expect(reconciled.latestReceipt).toMatchObject({ questionDenominator: 4, coveredQuestionIdsAfter: ["claim-1"], remainingQuestionIds: batch.questionIds.slice(1) });
      } else await expect(host.service.reconcile(tenantId, { caseId: batch.caseId, planDigest: planned.activePlanDigest! }))
          .rejects.toThrow("VERIFICATION_RECOVERY_INDEPENDENT_REVERIFICATION_REQUIRED");
      const unreconciled = await host.service.read(tenantId, batch.caseId);
      expect(unreconciled.initialBatch.questionIds).toEqual(batch.questionIds);
      expect(unreconciled.batch.items).toHaveLength(4);
      expect(await database.listReceipts(tenantId, dispatched.operationId!)).toHaveLength(1);
    } finally {
      await host?.close(); await remote.close(); await database.close();
      if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("TEST_CLEANUP_PATH_DENIED");
      await rm(root, { recursive: true, force: true });
    }
  }, 300000);
});

