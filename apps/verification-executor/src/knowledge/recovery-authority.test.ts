import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { recoveryFixture } from "./recovery-test-fixtures.js";
import { RecoveryRunAuthority, RecoveryNativeAuthorizationSchema } from "./recovery-authority.js";
import { VerificationExecutor, loadExecutorConfig } from "../executor.js";
import { digestCanonicalJson } from "@aiengineer/knowledge-verification";

it("requires a separate immutable original requirement-to-assertion mapping before coverage credit", async () => {
  const fixture = await recoveryFixture();
  try {
    const native = { schemaVersion: "verification-recovery-native-authorization.v1", runId: randomUUID(), claimsArtifactDigest: fixture.source.digest,
      batch: fixture.batch, requirementBindings: [{ requirementId: fixture.batch.requirements[0]!.requirementId,
        originalId: fixture.batch.items[0]!.originalId, requirementDigest: digestCanonicalJson(fixture.batch.requirements[0]),
        claimDigest: digestCanonicalJson(fixture.batch.items[0]!.binding.claim) }] };
    expect(RecoveryNativeAuthorizationSchema.parse(native).requirementBindings).toHaveLength(1);
    const { requirementBindings: _, ...withoutBindings } = native;
    expect(RecoveryNativeAuthorizationSchema.parse(withoutBindings).requirementBindings).toEqual([]);
    for (const kind of ["requirement", "claim", "mapping", "duplicate"] as const) {
      const changed = structuredClone(native);
      if (kind === "requirement") changed.batch.requirements[0]!.description = "A different original requirement";
      if (kind === "claim") changed.batch.items[0]!.binding.claim.statement = "A substituted answer";
      if (kind === "mapping") changed.requirementBindings[0]!.originalId = fixture.batch.items[1]!.originalId;
      if (kind === "duplicate") changed.requirementBindings.push(changed.requirementBindings[0]!);
      expect(RecoveryNativeAuthorizationSchema.safeParse(changed).success).toBe(false);
    }
  } finally { await fixture.close(); }
});

it("preserves the entire denominator when host-authenticated execution has no verification evidence", async () => {
  const fixture = await recoveryFixture();
  try {
    fixture.results.clear();
    let injectVerdict = false;
    const authority = new RecoveryRunAuthority({ tenantId: fixture.tenantId, custody: fixture.custody, evidence: fixture.authority,
      pins: { async forRun() { return fixture.authorization; }, async forBatch() { return fixture.authorization; } },
      unavailableObservation: async operationId => ({ operationId, execution: "unknown", family: "execution", earliestStage: "selector",
        signature: "native-terminal:failed", dependencyIds: [], diagnosticArtifacts: [fixture.source],
        ...(injectVerdict ? { semantic: "directly_supported" as const } : {}) }),
    });
    const { batch } = await authority.readInitialBatch({ tenantId: fixture.tenantId, batchId: fixture.batch.batchId });
    expect(batch.questionIds).toEqual(fixture.batch.questionIds);
    expect(batch.items).toHaveLength(4);
    expect(batch.items.every(item => item.observation.execution === "unknown" && !item.observation.runId)).toBe(true);
    injectVerdict = true;
    await expect(authority.readInitialBatch({ tenantId: fixture.tenantId, batchId: fixture.batch.batchId }))
      .rejects.toThrow("RECOVERY_UNAVAILABLE_OBSERVATION_INVALID");
  } finally { await fixture.close(); }
});

it("reads original questions and limits exclusively from host-pinned custody", async () => {
  const fixture = await recoveryFixture();
  try {
    const result = await fixture.authority.readInitialBatch({ tenantId: fixture.tenantId, batchId: fixture.batch.batchId });
    expect(result.batch.questionIds).toEqual(fixture.batch.questionIds);
    expect(result.batch.limits).toEqual(fixture.batch.limits);
    expect(result.batch.items).toHaveLength(4);
    await expect(fixture.authority.readInitialBatch({ tenantId: randomUUID(), batchId: fixture.batch.batchId })).rejects.toThrow("RECOVERY_AUTHORITY_TENANT_DENIED");
    await expect(fixture.authority.readInitialBatch({ tenantId: fixture.tenantId, batchId: "caller-invented" })).rejects.toThrow("BATCH_PIN_NOT_FOUND");
  } finally { await fixture.close(); }
});

it("rejects mismatched result operation, binding, tenant, and revoked authority", async () => {
  for (const kind of ["operation", "binding", "tenant", "revoked"] as const) {
    const fixture = await recoveryFixture();
    try {
      const result = fixture.results.get(fixture.batch.items[0]!.inputDigest)!;
      if (kind === "operation") result.observation.operationId = randomUUID();
      if (kind === "binding") result.binding = { ...result.binding, claim: { statement: "Unverified replacement", qualifiers: [] } };
      if (kind === "tenant") result.tenantId = randomUUID();
      if (kind === "revoked") result.revoked = true;
      await expect(fixture.authority.readInitialBatch({ tenantId: fixture.tenantId, batchId: fixture.batch.batchId })).rejects.toThrow("RECOVERY_RESULT_AUTHORITY_MISMATCH");
    } finally { await fixture.close(); }
  }
});

it("authorizes the exact compiled input before verification and rejects omitted or changed original claims", async () => {
  const fixture = await recoveryFixture();
  try {
    const executor = await VerificationExecutor.create(loadExecutorConfig({ VERIFY_STORE_DIR: fixture.store.rootDir, VERIFY_TENANT_ID: fixture.tenantId, VERIFY_GIT_SHA: "test" }));
    await executor.store.writeCapture({ captureId: "source", sourceId: "source", requestedUrl: "https://example.com", finalUrl: "https://example.com",
      capturedAt: new Date().toISOString(), captureMethod: "fixture", captureMethodVersion: "1", contentArtifact: fixture.source,
      characters: fixture.source.byteLength, sourceKind: "api", logicalIdentity: "source" });
    const { bundle } = await executor.compileClaims(fixture.intent, fixture.runId);
    const batch = structuredClone(fixture.batch);
    for (const item of batch.items) {
      item.binding.evidence[0]!.selector = { kind: "text_quote", quote: "10", normalization: "none" };
      item.inputDigest = digestCanonicalJson(item.binding);
    }
    const artifact = await fixture.custody.register({ tenantId: fixture.tenantId, kind: "batch", identity: "exact-host-pin",
      value: { schemaVersion: "verification-recovery-run-authorization.v1", runId: fixture.runId, claimsIntentDigest: digestCanonicalJson(fixture.intent), batch }, parentArtifactIds: [fixture.source.artifactId] });
    const authority = new RecoveryRunAuthority({ tenantId: fixture.tenantId, custody: fixture.custody,
      pins: { async forRun() { return artifact; }, async forBatch() { return artifact; } }, evidence: fixture.authority });
    expect(await authority.authorizeRun({ runId: fixture.runId, intent: fixture.intent, bundle })).toMatchObject({ batchId: batch.batchId, caseId: batch.caseId });
    await expect(authority.authorizeRun({ runId: fixture.runId, intent: { ...fixture.intent, claims: fixture.intent.claims.slice(1) }, bundle })).rejects.toThrow("RECOVERY_RUN_AUTHORIZATION_MISMATCH");
    const changed = structuredClone(bundle);
    changed.assertions[0]!.proposition = "A different question";
    await expect(authority.authorizeRun({ runId: fixture.runId, intent: fixture.intent, bundle: changed })).rejects.toThrow("RECOVERY_ORIGINAL_INPUT_MISMATCH");
  } finally { await fixture.close(); }
});
