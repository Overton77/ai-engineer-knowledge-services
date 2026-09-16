import { z } from "zod";
import {
  VerificationRecoveryBatchSchema, VerificationRecoveryVerifiedResultSchema,
  VerificationRecoveryObservationSchema,
  type VerificationArtifactHandle, type VerificationBundle, type VerificationRecoveryBatch,
} from "@aiengineer/knowledge-contracts";
import type { DurableRecoveryCustody, DurableRecoveryEvidenceAuthority } from "@aiengineer/knowledge-application";
import { canonicalizeJson, digestCanonicalJson } from "@aiengineer/knowledge-verification";
import type { ClaimsIntent } from "../intents.js";

export const RecoveryRunAuthorizationSchema = z.strictObject({
  schemaVersion: z.literal("verification-recovery-run-authorization.v1"),
  runId: z.string().min(1).max(180),
  claimsIntentDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  batch: VerificationRecoveryBatchSchema,
});
export type RecoveryRunAuthorization = z.infer<typeof RecoveryRunAuthorizationSchema>;
export const RecoveryNativeAuthorizationSchema = z.strictObject({
  schemaVersion: z.literal("verification-recovery-native-authorization.v1"),
  runId: z.uuid(), claimsArtifactDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  batch: VerificationRecoveryBatchSchema,
  requirementBindings: z.array(z.strictObject({ requirementId: z.string().min(1).max(256), originalId: z.string().min(1).max(256),
    requirementDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/), claimDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/) })).max(4096).default([]),
}).superRefine((value, context) => {
  const seen = new Set<string>();
  for (const binding of value.requirementBindings) {
    const requirement = value.batch.requirements.find(item => item.requirementId === binding.requirementId);
    const original = value.batch.items.find(item => item.originalId === binding.originalId);
    if (seen.has(binding.requirementId) || !requirement || !original || !original.questionIds.includes(requirement.questionId)
      || digestCanonicalJson(requirement) !== binding.requirementDigest || digestCanonicalJson(original.binding.claim) !== binding.claimDigest) {
      context.addIssue({ code: "custom", message: "RECOVERY_REQUIREMENT_ASSERTION_BINDING" });
    }
    seen.add(binding.requirementId);
  }
});
const AuthorizationSchema = z.union([RecoveryRunAuthorizationSchema, RecoveryNativeAuthorizationSchema]);

/** These lookups are host configuration, never public tool parameters or uploaded verdicts. */
export interface RecoveryAuthorizationPins {
  forRun(runId: string): Promise<VerificationArtifactHandle>;
  forBatch(batchId: string): Promise<VerificationArtifactHandle>;
}

export class RecoveryRunAuthority implements DurableRecoveryEvidenceAuthority {
  constructor(private readonly dependencies: {
    tenantId: string; pins: RecoveryAuthorizationPins; custody: DurableRecoveryCustody;
    evidence: Pick<DurableRecoveryEvidenceAuthority, "now" | "readResult"> & Partial<Pick<DurableRecoveryEvidenceAuthority, "readProbe" | "readInvalidation" | "authorizeResume">>;
    unavailableObservation?: (operationId: string) => Promise<VerificationRecoveryBatch["items"][number]["observation"] | undefined>;
  }) {}

  now = () => this.dependencies.evidence.now();
  readResult: DurableRecoveryEvidenceAuthority["readResult"] = request => this.dependencies.evidence.readResult(request);
  readProbe: DurableRecoveryEvidenceAuthority["readProbe"] = request => {
    if (!this.dependencies.evidence.readProbe) throw new Error("RECOVERY_PROBE_READER_NOT_CONFIGURED");
    return this.dependencies.evidence.readProbe(request);
  };
  readInvalidation: DurableRecoveryEvidenceAuthority["readInvalidation"] = request => {
    if (!this.dependencies.evidence.readInvalidation) throw new Error("RECOVERY_INVALIDATION_READER_NOT_CONFIGURED");
    return this.dependencies.evidence.readInvalidation(request);
  };
  authorizeResume: DurableRecoveryEvidenceAuthority["authorizeResume"] = request => {
    if (!this.dependencies.evidence.authorizeResume) throw new Error("RECOVERY_RESUME_AUTHORITY_NOT_CONFIGURED");
    return this.dependencies.evidence.authorizeResume(request);
  };

  async authorizeRun(input: { runId: string; intent: ClaimsIntent; bundle: VerificationBundle }) {
    const artifact = await this.dependencies.pins.forRun(input.runId);
    const authorized = await this.readAuthorization(artifact);
    if (authorized.schemaVersion !== "verification-recovery-run-authorization.v1"
      || authorized.runId !== input.runId || authorized.claimsIntentDigest !== digestCanonicalJson(input.intent)) {
      throw new Error("RECOVERY_RUN_AUTHORIZATION_MISMATCH");
    }
    return this.authorizeBundle(input, authorized, artifact);
  }

  async authorizeNativeRun(input: { runId: string; claimsArtifact: VerificationArtifactHandle; bundle: VerificationBundle }) {
    const artifact = await this.dependencies.pins.forRun(input.runId);
    const authorized = await this.readAuthorization(artifact);
    if (authorized.schemaVersion !== "verification-recovery-native-authorization.v1" || authorized.runId !== input.runId
      || authorized.claimsArtifactDigest !== input.claimsArtifact.digest || input.claimsArtifact.tenantId !== this.dependencies.tenantId) {
      throw new Error("RECOVERY_RUN_AUTHORIZATION_MISMATCH");
    }
    await this.dependencies.custody.read({ tenantId: this.dependencies.tenantId, artifact: input.claimsArtifact });
    return this.authorizeBundle(input, authorized, artifact);
  }

  private async authorizeBundle(input: { runId: string; bundle: VerificationBundle },
    authorized: z.infer<typeof AuthorizationSchema>, artifact: VerificationArtifactHandle) {
    const batch = authorized.batch;
    const batchPin = await this.dependencies.pins.forBatch(batch.batchId);
    if (batchPin.artifactId !== artifact.artifactId || batchPin.digest !== artifact.digest) throw new Error("RECOVERY_BATCH_AUTHORIZATION_MISMATCH");
    if (batch.items.length !== input.bundle.assertions.length) throw new Error("RECOVERY_ORIGINAL_MEMBERSHIP_MISMATCH");
    for (const item of batch.items) {
      const assertions = input.bundle.assertions.filter(assertion => assertion.assertionId === item.originalId);
      if (assertions.length !== 1) throw new Error("RECOVERY_ORIGINAL_MEMBERSHIP_MISMATCH");
      const assertion = assertions[0]!;
      const evidence = assertion.evidence.map(edge => {
        const capture = input.bundle.captures.find(row => row.captureId === edge.fragment.captureId);
        if (!capture || capture.contentArtifact.artifactId !== edge.fragment.representationArtifactId) throw new Error("RECOVERY_CAPTURE_BINDING_MISMATCH");
        return { representationDigest: capture.contentArtifact.digest, selector: edge.fragment.selector };
      });
      const expected = {
        claim: { statement: assertion.proposition, qualifiers: assertion.qualifiers, ...(assertion.value !== undefined ? { value: assertion.value } : {}) },
        evidence,
        captures: [...new Set(evidence.map(row => row.representationDigest))].sort(),
      };
      const actual = { claim: item.binding.claim,
        evidence: item.binding.evidence.map(({ representationDigest, selector }) => ({ representationDigest, selector })),
        captures: [...item.binding.captureDigests].sort() };
      if (canonicalizeJson(expected) !== canonicalizeJson(actual) || item.inputDigest !== digestCanonicalJson(item.binding)) {
        throw new Error("RECOVERY_ORIGINAL_INPUT_MISMATCH");
      }
      if (item.observation.runId !== input.runId || item.observation.execution !== "pending"
        || item.usedRounds !== 0 || item.attemptedInputDigests.length || item.attemptedRepairDigests.length) {
        throw new Error("RECOVERY_INITIAL_STATE_MUST_PRECEDE_VERIFICATION");
      }
    }
    return { batchId: batch.batchId, caseId: batch.caseId, authorityArtifact: artifact };
  }

  async readInitialBatch(input: { tenantId: string; batchId: string }) {
    this.requireTenant(input.tenantId);
    const authorityArtifact = await this.dependencies.pins.forBatch(input.batchId);
    const authorized = await this.readAuthorization(authorityArtifact);
    const batch = structuredClone(authorized.batch);
    if (batch.batchId !== input.batchId) throw new Error("RECOVERY_BATCH_AUTHORIZATION_MISMATCH");
    for (const item of batch.items) {
      const found = await this.readResult({ tenantId: input.tenantId, inputDigest: item.inputDigest, operationId: item.observation.operationId, originalId: item.originalId });
      if (!found) {
        const unavailable = await this.dependencies.unavailableObservation?.(item.observation.operationId);
        if (unavailable) {
          const observation = VerificationRecoveryObservationSchema.parse(unavailable);
          if (observation.operationId !== item.observation.operationId || !["unknown", "cancelled"].includes(observation.execution)
            || observation.family !== "execution" || observation.runId || observation.mechanical || observation.semantic || observation.policy) {
            throw new Error("RECOVERY_UNAVAILABLE_OBSERVATION_INVALID");
          }
          for (const artifact of observation.diagnosticArtifacts) await this.dependencies.custody.read({ tenantId: input.tenantId, artifact });
          item.observation = observation;
        }
        continue;
      }
      const result = VerificationRecoveryVerifiedResultSchema.parse(found);
      if (result.tenantId !== input.tenantId || result.inputDigest !== item.inputDigest
        || result.observation.operationId !== item.observation.operationId || result.observation.runId !== authorized.runId
        || canonicalizeJson(result.binding) !== canonicalizeJson(item.binding) || result.revoked) {
        throw new Error("RECOVERY_RESULT_AUTHORITY_MISMATCH");
      }
      for (const artifact of result.observation.diagnosticArtifacts) await this.dependencies.custody.read({ tenantId: input.tenantId, artifact });
      item.observation = result.observation;
    }
    if (batch.items.every(item => ["completed", "cancelled"].includes(item.observation.execution))) {
      const timestamps = batch.items.flatMap(item => item.observation.diagnosticArtifacts.map(artifact => artifact.createdAt));
      batch.closedAt = timestamps.sort().at(-1) ?? batch.capturedAt;
    }
    return { batch: VerificationRecoveryBatchSchema.parse(batch), authorityArtifact };
  }

  async authorizedBatch(runId: string): Promise<{ batch: VerificationRecoveryBatch; authorityArtifact: VerificationArtifactHandle }> {
    const authorityArtifact = await this.dependencies.pins.forRun(runId);
    const authorized = await this.readAuthorization(authorityArtifact);
    if (authorized.runId !== runId) throw new Error("RECOVERY_RUN_AUTHORIZATION_MISMATCH");
    return { batch: authorized.batch, authorityArtifact };
  }

  async notification(input: { runId: string; decisionArtifact: VerificationArtifactHandle; notificationId: string }) {
    const authorized = await this.authorizedBatch(input.runId);
    await this.dependencies.custody.read({ tenantId: this.dependencies.tenantId, artifact: input.decisionArtifact });
    return this.dependencies.custody.register({ tenantId: this.dependencies.tenantId, kind: "notification", identity: input.notificationId,
      value: { schemaVersion: "verification-recovery-notification.v1", runId: input.runId, batchId: authorized.batch.batchId,
        authorityArtifactId: authorized.authorityArtifact.artifactId, decisionArtifact: input.decisionArtifact },
      parentArtifactIds: [authorized.authorityArtifact.artifactId, input.decisionArtifact.artifactId] });
  }

  private requireTenant(tenantId: string): void {
    if (tenantId !== this.dependencies.tenantId) throw new Error("RECOVERY_AUTHORITY_TENANT_DENIED");
  }

  private async readAuthorization(artifact: VerificationArtifactHandle): Promise<z.infer<typeof AuthorizationSchema>> {
    this.requireTenant(artifact.tenantId);
    const value = AuthorizationSchema.parse(await this.dependencies.custody.read({ tenantId: this.dependencies.tenantId, artifact }));
    this.requireTenant(value.batch.tenantId);
    return value;
  }
}
