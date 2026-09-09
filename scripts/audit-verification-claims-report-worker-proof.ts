import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  VerificationClaimsOperationResultSchema,
  VerificationReportOperationResultSchema,
  type OperationContext,
  type VerificationArtifactHandle,
} from "@aiengineer/knowledge-contracts";
import {
  VerificationAdmissionService,
  VerificationAuditInspectionApplicationService,
} from "@aiengineer/knowledge-application";
import { VERIFICATION_PARSER_LIMITS } from "@aiengineer/knowledge-conversion";
import {
  PostgresCanonicalRepository,
  PostgresVerificationClaimsRuntimePrincipals,
  PostgresVerificationRepository,
} from "@aiengineer/knowledge-persistence";
import { SupabaseArtifactStore } from "@aiengineer/knowledge-runtime";
import {
  createEd25519Verifier,
  digestCanonicalJson,
  projectionSelectorResolver,
} from "@aiengineer/knowledge-verification";

const proofPath = resolve(process.argv[2] ?? "../internal/verification-claims-report-worker-22c6b3e4-b5d6-4d34-923b-4846e37fdfaa.json");
const proof = JSON.parse(await readFile(proofPath, "utf8")) as {
  namespace: string;
  tenantId: string;
  missionId: string;
  publicKeyPem: string;
  projection: {
    captureId: string;
    projectionArtifact: VerificationArtifactHandle;
    transformationArtifact: VerificationArtifactHandle;
  };
  results: {
    claimsRecovery: { operationId: string; runId: string; resultArtifact: VerificationArtifactHandle; manifestArtifact: VerificationArtifactHandle };
    reportRecovery: { operationId: string; runId: string; resultArtifact: VerificationArtifactHandle; manifestArtifact: VerificationArtifactHandle };
  };
};
const fixture = JSON.parse(await readFile(resolve("../internal/verification-frozen-source-registry-7a74a7a8-0dc4-4591-8bb1-5781ebddef42.json"), "utf8")) as {
  records: readonly { captureId: string; projections: readonly [{ sourceArtifact: VerificationArtifactHandle; projectionArtifact: VerificationArtifactHandle; transformationArtifact: VerificationArtifactHandle; parserVersion: string; imageDigest: `sha256:${string}` }] }[];
};
const registeredProjection = fixture.records.find((item) => item.captureId === proof.projection.captureId)?.projections[0];
assert.ok(registeredProjection);
assert.equal(digestCanonicalJson(registeredProjection.projectionArtifact), digestCanonicalJson(proof.projection.projectionArtifact));
assert.equal(digestCanonicalJson(registeredProjection.transformationArtifact), digestCanonicalJson(proof.projection.transformationArtifact));

const { loadVerifiedLocalDevelopmentConfig } = await import("../../internal/verification-local-direct-config.mjs") as {
  loadVerifiedLocalDevelopmentConfig(): Promise<{ DB_URL: string; API_URL: string; SECRET_KEY: string }>;
};
const local = await loadVerifiedLocalDevelopmentConfig();
for (const [value, port] of [[local.DB_URL, "54322"], [local.API_URL, "54321"]] as const) {
  const url = new URL(value);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.port !== port) throw new Error("LOCAL_ONLY_AUDIT_REQUIRED");
}

const bucket = "ai-engineer-cloud-bucket";
const database = new PostgresCanonicalRepository({ connectionString: local.DB_URL, localOnly: true });
try {
  const repository = new PostgresVerificationRepository(
    database,
    new SupabaseArtifactStore({ projectUrl: local.API_URL, serviceRoleKey: local.SECRET_KEY, bucket, maximumBytes: 32_000_000 }),
    { async authorize(input) {
      assert.equal(input.tenantId, proof.tenantId);
      assert.ok(["verification_admission", "verification_replay", "policy_replay"].includes(input.purpose));
    } },
  );
  const admission = new VerificationAdmissionService(repository, { async parse(): Promise<never> { throw new Error("PARSER_FORBIDDEN_IN_AUDIT"); } }, {
    parserVersion: registeredProjection.parserVersion,
    imageDigest: registeredProjection.imageDigest,
    limits: VERIFICATION_PARSER_LIMITS,
  }, {
    storageBucket: bucket,
    producerVersion: "verification-admission.v1",
    encryptionClass: "supabase-managed",
    retentionClass: "verification-audit",
    now: () => new Date().toISOString(),
  });
  const principals = new PostgresVerificationClaimsRuntimePrincipals(database);
  const signatureVerifier = createEd25519Verifier({ [`claims-report-proof-${proof.namespace}`]: proof.publicKeyPem });

  async function terminalFor(entry: typeof proof.results.claimsRecovery | typeof proof.results.reportRecovery, kind: "claims" | "report") {
    const receipts = await database.listReceipts(proof.tenantId, entry.operationId);
    assert.equal(receipts.length, 1);
    const body = receipts[0]!.body as Record<string, unknown>;
    const { eventId: _eventId, fencingToken: _fencingToken, ...terminal } = body;
    return kind === "claims" ? VerificationClaimsOperationResultSchema.parse(terminal) : VerificationReportOperationResultSchema.parse(terminal);
  }

  const inspections = [];
  for (const [kind, entry] of [["claims", proof.results.claimsRecovery], ["report", proof.results.reportRecovery]] as const) {
    const terminal = await terminalFor(entry, kind);
    const binding = await repository.loadVerificationRunReplayBinding(proof.tenantId, entry.runId);
    assert.ok(binding);
    const context: OperationContext = {
      contractVersion: "v1",
      tenantId: proof.tenantId,
      operationId: binding.operationId,
      missionId: binding.missionId,
      workItemId: binding.workItemId,
      attemptId: binding.verifierAttemptId,
      correlationId: `native-audit-${proof.namespace}-${kind}`,
      actor: { kind: "service", id: randomUUID(), serviceIdentity: "knowledge_worker" },
      capabilityVersion: "verification.v1",
      idempotencyKey: `native-audit-${proof.namespace}-${kind}`,
      reason: "Read-only native signed audit inspection",
    };
    const trustedResolver = repository.createTrustedArtifactResolver();
    const service = new VerificationAuditInspectionApplicationService({
      artifactResolver: {
        async authorizeArtifact(input) { if (input.signal.aborted) throw input.signal.reason; await trustedResolver.authorizeArtifact(input); },
        async hydrateRegisteredArtifact(input) { if (input.signal.aborted) throw input.signal.reason; return trustedResolver.hydrateRegisteredArtifact(input); },
      },
      signatureVerifier,
      replayTrust: { async resolve(input) {
        if (input.signal.aborted || input.auditBundle.manifest.runId !== entry.runId) throw new Error("AUDIT_TRUST_BINDING_MISMATCH");
        const projectedCapture = input.auditBundle.verificationBundle.captures.find((capture) => capture.captureId === proof.projection.captureId);
        assert.ok(projectedCapture?.canonicalProjectionArtifact);
        const admitted = await admission.hydrateAdmittedProjection({
          tenantId: proof.tenantId,
          captureId: projectedCapture.captureId,
          expectedSourceArtifact: { artifactId: projectedCapture.contentArtifact.artifactId, digest: projectedCapture.contentArtifact.digest as `sha256:${string}` },
          transformationArtifactId: registeredProjection.transformationArtifact.artifactId,
          projectionArtifactId: registeredProjection.projectionArtifact.artifactId,
        });
        const identity = await principals.bind({ context, assertionsArtifact: terminal.output.verified.assertionsArtifact, captureIds: [projectedCapture.captureId] });
        const exactAdmission = digestCanonicalJson({ captureId: admitted.receipt.captureId, sourceArtifact: admitted.receipt.sourceArtifact, projectionArtifact: admitted.receipt.projectionArtifact });
        return {
          runtimePrincipals: identity.runtimePrincipals,
          selectorResolvers: [projectionSelectorResolver],
          isProjectionLineageAdmitted: (candidate: { captureId: string; sourceArtifact: VerificationArtifactHandle; projectionArtifact: VerificationArtifactHandle }) => digestCanonicalJson(candidate) === exactAdmission,
        };
      } },
      maximumInspectionMs: 30_000,
    });
    const result = await service.inspect({ verificationContractVersion: "verification.v1", auditBundle: { artifactId: entry.manifestArtifact.artifactId, digest: entry.manifestArtifact.digest } }, context);
    assert.equal(result.run.runId, entry.runId);
    assert.equal(result.run.manifestDigest, terminal.output.sealedRun.manifestDigest);
    assert.equal(result.run.policyOutcome, terminal.output.sealedRun.policyOutcome);
    assert.equal(result.proof.signatureStatus, "verified");
    assert.equal(result.proof.deterministicReplay, "exact");
    assert.equal(result.proof.policyReplay, "exact");
    inspections.push({ kind, operationId: entry.operationId, manifestArtifact: entry.manifestArtifact, result });
  }

  const output = resolve("../internal", `verification-claims-report-audit-inspection-${proof.namespace}.json`);
  const receipt = {
    schemaVersion: "verification-claims-report-audit-inspection-proof.v1",
    sourceProof: { path: proofPath, sha256: createHash("sha256").update(await readFile(proofPath)).digest("hex") },
    inspectedAt: new Date().toISOString(),
    tenantId: proof.tenantId,
    parserDispatches: 0,
    providerDispatches: 0,
    publicTransportEnabled: false,
    inspections,
  };
  await writeFile(output, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ output, sha256: createHash("sha256").update(await readFile(output)).digest("hex"), inspections: inspections.length, parserDispatches: 0, providerDispatches: 0 }));
} finally {
  await database.close();
}
