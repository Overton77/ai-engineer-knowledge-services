import { z } from "zod";
import {
  VerificationRecoveryBindingSchema, type VerificationArtifactHandle, type VerificationRecoveryBinding,
  type VerificationRecoveryItem, type VerificationRecoveryPlan,
} from "@aiengineer/knowledge-contracts";
import type { DurableRecoveryCustody, DurableVerificationRecoveryService, VerificationRecoveryAuthority } from "@aiengineer/knowledge-application";
import { canonicalizeJson, digestCanonicalJson, resolveBuiltInSelector, sha256Digest } from "@aiengineer/knowledge-verification";
import { deterministicUuid } from "../store.js";

const Member = z.strictObject({ originalId: z.string().min(1).max(256), binding: VerificationRecoveryBindingSchema });
export const RecoverySelectorProbeRequestSchema = z.strictObject({
  caseId: z.string().min(1).max(256), dependencyId: z.string().min(1).max(256),
  representatives: z.array(Member).min(1).max(63), controlId: z.string().min(1).max(256).optional(),
});
type Request = z.infer<typeof RecoverySelectorProbeRequestSchema>;
type ProbeRead = Awaited<ReturnType<VerificationRecoveryAuthority["readProbe"]>>;
const Receipt = z.strictObject({
  schemaVersion: z.literal("verification-selector-probe.v1"), tenantId: z.uuid(), caseId: z.string(), recoveryPolicyVersion: z.string(),
  dependencyId: z.string(), originalId: z.string(), inputDigest: z.string(), signature: z.string(),
  operationId: z.uuid(), passed: z.boolean(), calls: z.literal(0), costMicros: z.literal(0),
  binding: VerificationRecoveryBindingSchema, reservationArtifactId: z.uuid(),
  checks: z.array(z.strictObject({ representationDigest: z.string(), selectorDigest: z.string(), status: z.string() })).min(1).max(64),
});
const MAX_PROBE_BYTES = 8_000_000;
const equal = (left: unknown, right: unknown) => canonicalizeJson(left) === canonicalizeJson(right);

/** Provider-free selector probes authorize no fact or coverage; plan admission still reruns each member. */
export class RecoverySelectorProbes {
  constructor(private readonly dependencies: {
    tenantId: string; recovery: DurableVerificationRecoveryService; custody: DurableRecoveryCustody;
    now(): string;
    representation(digest: string): Promise<{ artifact: VerificationArtifactHandle; bytes: Uint8Array }>;
  }) {}

  async run(value: unknown): Promise<VerificationRecoveryPlan["probes"][number]> {
    const request = RecoverySelectorProbeRequestSchema.parse(value);
    const { recovery, tenantId, custody } = this.dependencies;
    const current = await recovery.read(tenantId, request.caseId);
    const batch = current.batch;
    if (current.state !== "ready" || batch.limits.maxProbeRounds !== 1 || !batch.allowedActions.includes("repair")
      || Date.parse(batch.limits.deadline) <= Date.parse(this.dependencies.now())) {
      throw new Error("RECOVERY_PROBE_NOT_AVAILABLE");
    }
    const members = this.selectMembers(request, batch.items);
    const identity = `selector-probe:${digestCanonicalJson({ tenantId, caseId: request.caseId, dependencyId: request.dependencyId })}`;
    const prior = current.revisions.find(row => row.kind === "notification" && row.idempotencyKey === identity);
    const reservation = { schemaVersion: "verification-selector-probe-reservation.v1", request, recoveryPolicyVersion: batch.recoveryPolicyVersion };
    if (prior && !equal(prior.value, reservation)) throw new Error("RECOVERY_PROBE_ROUND_ALREADY_RESERVED");
    const reservationArtifact = await custody.register({ tenantId, kind: "notification", identity, value: reservation,
      parentArtifactIds: [current.initialAuthorityArtifact.artifactId] });
    // Durable immutable reservation precedes even provider-free work. Crash retries repeat the same bytes only.
    await recovery.ingestDrift(tenantId, { caseId: request.caseId, notificationId: identity, artifact: reservationArtifact });
    const receiptArtifacts: VerificationArtifactHandle[] = [];
    for (const member of members) {
      const checked = await this.check(member.binding);
      const payload = Receipt.parse({ schemaVersion: "verification-selector-probe.v1", tenantId, caseId: request.caseId,
        recoveryPolicyVersion: batch.recoveryPolicyVersion, dependencyId: request.dependencyId,
        originalId: member.original.originalId, inputDigest: digestCanonicalJson(member.binding),
        signature: member.original.observation.signature, operationId: deterministicUuid("selector-probe", `${identity}:${member.original.originalId}`),
        passed: checked.checks.every(check => check.status === "resolved"), calls: 0, costMicros: 0,
        binding: member.binding, reservationArtifactId: reservationArtifact.artifactId, checks: checked.checks });
      receiptArtifacts.push(await custody.register({ tenantId, kind: "receipt", identity: `${identity}:${member.original.originalId}`,
        value: payload, parentArtifactIds: [reservationArtifact.artifactId, ...checked.artifactIds] }));
    }
    return { dependencyId: request.dependencyId, representativeIds: request.representatives.map(member => member.originalId),
      ...(request.controlId ? { controlId: request.controlId } : {}), receiptArtifacts };
  }

  async read(input: { tenantId: string; artifact: VerificationArtifactHandle }): Promise<ProbeRead> {
    if (input.tenantId !== this.dependencies.tenantId || input.artifact.tenantId !== input.tenantId) throw new Error("RECOVERY_PROBE_TENANT_DENIED");
    const receipt = Receipt.parse(await this.dependencies.custody.read(input));
    const current = await this.dependencies.recovery.read(input.tenantId, receipt.caseId);
    const identity = `selector-probe:${digestCanonicalJson({ tenantId: input.tenantId, caseId: receipt.caseId, dependencyId: receipt.dependencyId })}`;
    const reservation = current.revisions.find(row => row.kind === "notification" && row.idempotencyKey === identity);
    const value = reservation?.value as { request?: unknown } | undefined;
    if (!reservation || receipt.tenantId !== input.tenantId || receipt.recoveryPolicyVersion !== current.batch.recoveryPolicyVersion) throw new Error("RECOVERY_PROBE_AUTHORITY_MISMATCH");
    const request = RecoverySelectorProbeRequestSchema.parse(value?.request);
    const member = this.selectMembers(request, current.initialBatch.items).find(item => item.original.originalId === receipt.originalId);
    if (!member || !equal(member.binding, receipt.binding) || receipt.inputDigest !== digestCanonicalJson(receipt.binding)
      || receipt.signature !== member.original.observation.signature
      || receipt.operationId !== deterministicUuid("selector-probe", `${identity}:${receipt.originalId}`)
      || !input.artifact.parentArtifactIds.includes(receipt.reservationArtifactId)) throw new Error("RECOVERY_PROBE_RESULT_MISMATCH");
    const source = await this.dependencies.custody.read({ tenantId: input.tenantId,
      artifact: await this.reservationHandle(current, receipt.reservationArtifactId) });
    if (!equal(source, reservation.value)) throw new Error("RECOVERY_PROBE_RESERVATION_MISMATCH");
    const checked = await this.check(receipt.binding);
    const expected = Receipt.parse({ ...receipt, passed: checked.checks.every(check => check.status === "resolved"), checks: checked.checks });
    if (!equal(expected, receipt)) throw new Error("RECOVERY_PROBE_FORGED_RESULT");
    const expectedArtifact = await this.dependencies.custody.register({ tenantId: input.tenantId, kind: "receipt",
      identity: `${identity}:${receipt.originalId}`, value: expected, parentArtifactIds: [receipt.reservationArtifactId, ...checked.artifactIds] });
    if (!equal(expectedArtifact, input.artifact)) throw new Error("RECOVERY_PROBE_PRODUCER_MISMATCH");
    return { tenantId: receipt.tenantId, caseId: receipt.caseId, recoveryPolicyVersion: receipt.recoveryPolicyVersion,
      dependencyId: receipt.dependencyId, originalId: receipt.originalId, inputDigest: receipt.inputDigest,
      signature: receipt.signature, operationId: receipt.operationId, passed: receipt.passed,
      calls: 0, costMicros: 0, artifactDigest: input.artifact.digest };
  }

  private async reservationHandle(current: Awaited<ReturnType<DurableVerificationRecoveryService["read"]>>, artifactId: string) {
    // ingestDrift wraps the source; its immutable notification parent identifies the reservation artifact.
    const notification = current.revisions.find(row => row.kind === "notification" && row.artifact.parentArtifactIds.includes(artifactId));
    if (!notification) throw new Error("RECOVERY_PROBE_RESERVATION_MISMATCH");
    // Regeneration uses the exact initial authority and payload, yielding the custody-owned identity.
    const request = RecoverySelectorProbeRequestSchema.parse((notification.value as { request: unknown }).request);
    const identity = `selector-probe:${digestCanonicalJson({ tenantId: current.tenantId, caseId: current.caseId, dependencyId: request.dependencyId })}`;
    const handle = await this.dependencies.custody.register({ tenantId: current.tenantId, kind: "notification", identity,
      value: notification.value, parentArtifactIds: [current.initialAuthorityArtifact.artifactId] });
    if (handle.artifactId !== artifactId) throw new Error("RECOVERY_PROBE_RESERVATION_MISMATCH");
    return handle;
  }

  private selectMembers(request: Request, items: VerificationRecoveryItem[]) {
    const group = items.filter(item => item.observation.dependencyIds.includes(request.dependencyId)
      && item.observation.family === "selector" && item.observation.mechanical === "failed");
    const signatures = new Set(group.map(item => item.observation.signature));
    const ids = request.representatives.map(member => member.originalId);
    if (!group.length || new Set(ids).size !== ids.length || ids.some(id => !group.some(item => item.originalId === id))) throw new Error("RECOVERY_PROBE_GROUP_MISMATCH");
    const selected = request.representatives.map(member => ({ original: group.find(item => item.originalId === member.originalId)!, binding: member.binding }));
    if ([...signatures].some(signature => !selected.some(member => member.original.observation.signature === signature))) throw new Error("RECOVERY_PROBE_SIGNATURE_MISSING");
    for (const member of selected) {
      const original = member.original.binding;
      const { evidence: _proposedEvidence, ...proposedScope } = member.binding;
      const { evidence: _originalEvidence, ...originalScope } = original;
      if (!equal(proposedScope, originalScope)
        || member.binding.evidence.length !== original.evidence.length
        || member.binding.evidence.some((edge, index) => edge.representationDigest !== original.evidence[index]!.representationDigest || edge.contextDigest !== original.evidence[index]!.contextDigest)) {
        throw new Error("RECOVERY_SELECTOR_PROBE_SCOPE_UNSUPPORTED");
      }
    }
    const controls = items.filter(item => item.observation.family === "none" && item.observation.mechanical === "passed"
      && ["pass", "pass_with_warnings"].includes(item.observation.policy ?? "") && !item.observation.dependencyIds.includes(request.dependencyId));
    const control = controls.find(item => item.originalId === request.controlId);
    if ((controls.length && !control) || (request.controlId && !control)) throw new Error("RECOVERY_PROBE_CONTROL_REQUIRED");
    return [...selected, ...(control ? [{ original: control, binding: control.binding }] : [])];
  }

  private async check(binding: VerificationRecoveryBinding) {
    const checks: { representationDigest: string; selectorDigest: string; status: string }[] = [];
    const artifactIds: string[] = [];
    let bytesRead = 0;
    for (const edge of binding.evidence) {
      const { artifact, bytes } = await this.dependencies.representation(edge.representationDigest);
      bytesRead += bytes.byteLength;
      if (bytesRead > MAX_PROBE_BYTES) throw new Error("RECOVERY_PROBE_BYTES_EXCEEDED");
      if (artifact.tenantId !== this.dependencies.tenantId || artifact.digest !== edge.representationDigest || sha256Digest(bytes) !== artifact.digest) throw new Error("RECOVERY_PROBE_REPRESENTATION_MISMATCH");
      const result = resolveBuiltInSelector({ captureId: "retained-probe", representationArtifactId: artifact.artifactId,
        representationDigest: artifact.digest, selector: edge.selector, content: bytes });
      if (!result) throw new Error("RECOVERY_SELECTOR_PROBE_SCOPE_UNSUPPORTED");
      checks.push({ representationDigest: artifact.digest, selectorDigest: digestCanonicalJson(edge.selector), status: result.resolution.status });
      artifactIds.push(artifact.artifactId);
    }
    return { checks, artifactIds: [...new Set(artifactIds)].sort() };
  }
}
