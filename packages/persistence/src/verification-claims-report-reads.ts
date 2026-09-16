import {
  OperationContextSchema,
  UuidSchema,
  VerificationArtifactHandleSchema,
  VerificationClaimsArtifactSchema,
  VerificationClaimsOperationResultSchema,
  VerificationClaimsReportPolicyReasonCodeSchema,
  VerificationPolicyDecisionSchema,
  VerificationReportGateArtifactSchema,
  VerificationReportLedgerSchema,
  VerificationReportOperationResultSchema,
  VerifyClaimsRequestSchema,
  VerifyReportRequestSchema,
  type OperationContext,
  type VerificationArtifactHandle,
  type VerificationClaimsOperationResult,
  type VerificationReportOperationResult,
} from "@aiengineer/knowledge-contracts";
import {
  KNOWLEDGE_OPERATION_REQUEST_SCHEMA_VERSION,
  type VerifiedClaimsReportReadPort,
  type VerificationClaimsReportReadState,
} from "@aiengineer/knowledge-application";
import { deepFreeze } from "@aiengineer/knowledge-domain";
import { deterministicUuid } from "@aiengineer/knowledge-runtime";
import {
  canonicalizeJson,
  digestCanonicalJson,
  inspectAuditBundle,
  sha256Digest,
  type AuditBundleSignatureVerifier,
  type TrustedArtifactResolver,
  type VerificationAuditBundle,
} from "@aiengineer/knowledge-verification";
import { z } from "zod";
import type { PostgresCanonicalRepository } from "./postgres.js";
import { assertSignedReportSourceDependencies } from "./report-source-dependencies.js";

type Row = Record<string, unknown>;
type TerminalResult = VerificationClaimsOperationResult | VerificationReportOperationResult;
type Request = z.infer<typeof VerifyClaimsRequestSchema> | z.infer<typeof VerifyReportRequestSchema>;
type SucceededSnapshot = {
  readonly state: "succeeded";
  readonly result: TerminalResult;
  readonly artifactId: string;
  readonly operationKind: "verification_claims" | "verification_report";
  readonly request: Request;
  readonly context: OperationContext;
};
type Snapshot = { readonly state: Exclude<VerificationClaimsReportReadState, "succeeded"> } | SucceededSnapshot;
type SignedArtifacts = { readonly bundle: VerificationArtifactHandle; readonly deterministic: VerificationArtifactHandle; readonly policyDecision?: VerificationArtifactHandle };

const decoder = new TextDecoder("utf-8", { fatal: true });
const same = (left: unknown, right: unknown) => canonicalizeJson(left) === canonicalizeJson(right);
const digestHex = (value: string) => value.startsWith("sha256:") ? value.slice(7) : value;
const databaseUuid = (namespace: string, value: string) => UuidSchema.safeParse(value).success ? value : deterministicUuid(namespace, value);
const exactHandleIn = (handles: readonly VerificationArtifactHandle[], expected: VerificationArtifactHandle) => handles.some(item => same(item, expected));
const uniqueHandles = (handles: readonly VerificationArtifactHandle[]): VerificationArtifactHandle[] => {
  const result = new Map<string, VerificationArtifactHandle>();
  for (const item of handles) {
    const prior = result.get(item.artifactId);
    if (prior && !same(prior, item)) throw new Error("ARTIFACT_IDENTITY_CONFLICT");
    result.set(item.artifactId, item);
  }
  return [...result.values()].sort((left, right) => left.artifactId.localeCompare(right.artifactId));
};

const claimsInputSchema = z.strictObject({
  schemaVersion: z.literal("verification-service-request.v1"),
  useCase: z.literal("verifyClaims"),
  request: VerifyClaimsRequestSchema,
});
const reportInputSchema = z.strictObject({
  schemaVersion: z.literal("verification-service-request.v1"),
  useCase: z.literal("verifyReport"),
  request: VerifyReportRequestSchema,
});
const durableSchema = z.union([
  z.strictObject({ schemaVersion: z.literal(KNOWLEDGE_OPERATION_REQUEST_SCHEMA_VERSION), kind: z.literal("verification_claims"), input: claimsInputSchema, expectedVersions: z.record(z.string(), z.string().min(1)), authenticatedContext: OperationContextSchema }),
  z.strictObject({ schemaVersion: z.literal(KNOWLEDGE_OPERATION_REQUEST_SCHEMA_VERSION), kind: z.literal("verification_report"), input: reportInputSchema, expectedVersions: z.record(z.string(), z.string().min(1)), authenticatedContext: OperationContextSchema }),
]);
const stepSchema = z.union([
  z.strictObject({ schemaVersion: z.literal(KNOWLEDGE_OPERATION_REQUEST_SCHEMA_VERSION), kind: z.literal("verification_claims"), operationInput: claimsInputSchema, expectedVersions: z.record(z.string(), z.string().min(1)), context: OperationContextSchema, step: z.strictObject({ name: z.literal("verify_claims_and_register"), ordinal: z.literal(0) }) }),
  z.strictObject({ schemaVersion: z.literal(KNOWLEDGE_OPERATION_REQUEST_SCHEMA_VERSION), kind: z.literal("verification_report"), operationInput: reportInputSchema, expectedVersions: z.record(z.string(), z.string().min(1)), context: OperationContextSchema, step: z.strictObject({ name: z.literal("verify_report_and_register"), ordinal: z.literal(0) }) }),
]);

/** Parses only an already signature-verified, registered policy-decision artifact. */
export function parseSignedPolicyDecision(input: { readonly bytes: Uint8Array; readonly handle: VerificationArtifactHandle; readonly policyDecisionDigest: string; readonly runId: string; readonly policyVersion: string; readonly outcome: string }): { readonly outcome: "pass" | "pass_with_warnings" | "review" | "abstain" | "fail"; readonly reasonCodes: readonly string[] } {
  const raw = decoder.decode(input.bytes);
  const decision = VerificationPolicyDecisionSchema.parse(JSON.parse(raw));
  if (canonicalizeJson(decision) !== raw || input.handle.digest !== input.policyDecisionDigest
    || decision.runId !== input.runId || decision.policyVersion !== input.policyVersion
    || decision.outcome !== input.outcome || decision.overrideApplied !== false
    || decision.reasonCodes.some(code => !VerificationClaimsReportPolicyReasonCodeSchema.safeParse(code).success)) throw new Error("SIGNED_POLICY_DECISION_BINDING");
  return { outcome: decision.outcome, reasonCodes: [...decision.reasonCodes] };
}

export class ClaimsReportReadError extends Error {
  constructor(readonly code: "INVALID" | "NOT_FOUND" | "INTEGRITY", cause?: unknown) {
    super(`VERIFICATION_CLAIMS_REPORT_READ_${code}`, cause === undefined ? undefined : { cause });
  }
}

/** Authenticates native run ownership, signed custody, and terminal fencing before public projection. */
export class PostgresClaimsReportReadRepository implements VerifiedClaimsReportReadPort {
  constructor(
    private readonly database: Pick<PostgresCanonicalRepository, "transaction">,
    private readonly createResolver: () => TrustedArtifactResolver,
    private readonly signatureVerifier: AuditBundleSignatureVerifier,
  ) {}

  async loadVerifiedClaimsReport(tenantId: string, operationId: string): Promise<{ readonly state: VerificationClaimsReportReadState; readonly result?: unknown; readonly reportGateArtifact?: VerificationArtifactHandle }> {
    if (!UuidSchema.safeParse(tenantId).success || !UuidSchema.safeParse(operationId).success) throw new ClaimsReportReadError("INVALID");
    try {
      const snapshot = await this.#snapshot(tenantId, operationId);
      if (snapshot.state !== "succeeded") return snapshot;
      const resolver = this.createResolver();
      await this.#verifyResultBytes(resolver, tenantId, snapshot);
      const audit = await this.#loadAudit(resolver, tenantId, snapshot.result.output.sealedRun.manifestArtifact);
      const inspection = await inspectAuditBundle(audit, this.signatureVerifier);
      if (!inspection.valid || inspection.signatureStatus !== "verified") throw new Error("MANIFEST_SIGNATURE_INVALID");
      const signed = this.#verifyAuditBinding(audit, tenantId, snapshot.result);
      await this.#verifyNativeRun(tenantId, snapshot, audit, signed);
      await this.#verifySignedInputsAndOutput(resolver, tenantId, snapshot, audit, signed.deterministic);
      const policyDecision = await this.#verifyPolicyDecision(resolver, tenantId, snapshot, audit, signed.policyDecision);
      const reportGateArtifact = snapshot.result.useCase === "verifyReport"
        ? await this.#verifyReportGate(resolver, tenantId, snapshot, audit, snapshot.result, signed.deterministic)
        : undefined;
      const after = await this.#snapshot(tenantId, operationId);
      if (!same(after, snapshot)) throw new Error("TERMINAL_DRIFT");
      if (snapshot.result.useCase === "verifyReport") await this.database.transaction(tenantId, client =>
        assertSignedReportSourceDependencies(client, tenantId, snapshot.result.output.verified.sourceArtifacts));
      return deepFreeze({ state: "succeeded" as const, result: snapshot.result, ...(reportGateArtifact ? { reportGateArtifact } : {}), ...(policyDecision ? { policyDecision } : {}) });
    } catch (error) {
      if (error instanceof ClaimsReportReadError) throw error;
      throw new ClaimsReportReadError("INTEGRITY", error);
    }
  }

  async #verifyResultBytes(resolver: TrustedArtifactResolver, tenantId: string, snapshot: SucceededSnapshot): Promise<void> {
    const result = snapshot.result;
    const artifact = result.resultArtifact;
    const parents = result.useCase === "verifyClaims"
      ? [...new Set([result.output.verified.assertionsArtifact.artifactId, result.output.sealedRun.manifestArtifact.artifactId])]
      : [...new Set([result.output.verified.assertionsArtifact.artifactId, result.output.verified.reportArtifact.artifactId, result.output.verified.claimLedgerArtifact.artifactId, result.output.sealedRun.manifestArtifact.artifactId])];
    if (artifact.artifactId !== snapshot.artifactId || artifact.tenantId !== tenantId
      || artifact.mediaType !== "application/vnd.aiengineer.verification-operation-result+json"
      || artifact.producerActivityId !== `verification-service:${result.useCase}` || artifact.producerVersion !== "verification-service.v1"
      || artifact.encryptionClass !== "supabase-managed" || artifact.retentionClass !== "verification-audit" || artifact.dataClassification !== "restricted"
      || !same(artifact.parentArtifactIds, parents)
      || artifact.transformationSignature !== digestCanonicalJson({ operationId: result.operationId, requestDigest: result.requestDigest, parents })) {
      throw new Error("RESULT_ARTIFACT_BINDING");
    }
    const hydrated = await this.#hydrate(resolver, tenantId, artifact);
    const raw = decoder.decode(hydrated.bytes);
    const decoded = JSON.parse(raw) as unknown;
    const { resultArtifact: _omitted, ...storedBody } = result;
    if (canonicalizeJson(decoded) !== raw || !same(decoded, storedBody)) throw new Error("RESULT_BYTES_INVALID");
  }

  async #loadAudit(resolver: TrustedArtifactResolver, tenantId: string, handle: VerificationArtifactHandle): Promise<VerificationAuditBundle> {
    const hydrated = await this.#hydrate(resolver, tenantId, handle);
    const raw = decoder.decode(hydrated.bytes);
    const audit = JSON.parse(raw) as VerificationAuditBundle;
    if (canonicalizeJson(audit) !== raw) throw new Error("MANIFEST_BYTES_INVALID");
    return audit;
  }

  #verifyAuditBinding(audit: VerificationAuditBundle, tenantId: string, result: TerminalResult): SignedArtifacts {
    const sealed = result.output.sealedRun;
    const artifacts = [...audit.manifest.inputArtifacts, ...audit.manifest.outputArtifacts];
    const deterministicCandidates = audit.manifest.outputArtifacts.filter(item => item.digest === audit.manifest.resultDigest);
    const bundleDigest = digestCanonicalJson(audit.verificationBundle);
    const bundleCandidates = audit.manifest.outputArtifacts.filter(item => item.digest === bundleDigest && item.mediaType === "application/vnd.aiengineer.verification-bundle+json");
    const policyDecisionMatches = audit.manifest.outputArtifacts.filter(item => item.digest === audit.policyDecisionDigest);
    const policyDecisionCandidates = policyDecisionMatches.filter(item => item.mediaType === "application/vnd.aiengineer.verification-policy-decision+json");
    if (deterministicCandidates.length !== 1 || bundleCandidates.length !== 1
      || audit.tenantId !== tenantId || audit.manifest.runId !== sealed.runId
      || audit.manifest.canonicalization.manifestDigest !== sealed.manifestDigest
      || audit.manifest.policyOutcome !== sealed.policyOutcome
      || audit.manifest.resultDigest !== digestCanonicalJson(result.output.verified.deterministicResult)
      || audit.deterministicResultDigest !== audit.manifest.resultDigest
      || policyDecisionMatches.length > 1 || (policyDecisionMatches.length === 1 && policyDecisionCandidates.length !== 1)
      || !exactHandleIn(artifacts, audit.policyBinding.policyArtifact)
      || !exactHandleIn(artifacts, audit.policyBinding.recordedPolicyInputsArtifact)) {
      throw new Error("SIGNED_MANIFEST_RESULT_BINDING");
    }
    const expectedParents = result.useCase === "verifyClaims"
      ? [result.output.verified.assertionsArtifact.artifactId, sealed.manifestArtifact.artifactId]
      : [result.output.verified.assertionsArtifact.artifactId, result.output.verified.reportArtifact.artifactId, result.output.verified.claimLedgerArtifact.artifactId, sealed.manifestArtifact.artifactId];
    if (!same([...result.resultArtifact.parentArtifactIds].sort(), [...new Set(expectedParents)].sort())) throw new Error("RESULT_PARENT_BINDING");
    return { bundle: bundleCandidates[0]!, deterministic: deterministicCandidates[0]!, ...(policyDecisionCandidates.length === 1 ? { policyDecision: policyDecisionCandidates[0]! } : {}) };
  }

  async #verifyPolicyDecision(resolver: TrustedArtifactResolver, tenantId: string, snapshot: SucceededSnapshot, audit: VerificationAuditBundle, handle: VerificationArtifactHandle | undefined): Promise<{ readonly outcome: "pass" | "pass_with_warnings" | "review" | "abstain" | "fail"; readonly reasonCodes: readonly string[] } | undefined> {
    if (!handle) return undefined;
    const hydrated = await this.#hydrate(resolver, tenantId, handle);
    return parseSignedPolicyDecision({ bytes: hydrated.bytes, handle, policyDecisionDigest: audit.policyDecisionDigest, runId: snapshot.result.output.sealedRun.runId, policyVersion: audit.policyBinding.policyVersion, outcome: snapshot.result.output.sealedRun.policyOutcome });
  }

  async #verifyNativeRun(tenantId: string, snapshot: SucceededSnapshot, audit: VerificationAuditBundle, signed: SignedArtifacts): Promise<void> {
    const result = snapshot.result;
    const rows = await this.database.transaction(tenantId, async client => (await client.query<Row>(`select id,producer_attempt_id,verifier_attempt_id,policy_version,mission_id,work_item_id,operation_id,contract_version,bundle_artifact_id,deterministic_result_artifact_id,policy_artifact_id,policy_artifact_sha256,run_manifest_artifact_id,manifest_sha256,status from evidence.verification_run where tenant_id=$1 and id=$2`, [tenantId, result.output.sealedRun.runId])).rows);
    if (rows.length !== 1) throw new Error("VERIFICATION_RUN_BINDING");
    const row = rows[0]!;
    const expectedStatus = result.output.sealedRun.policyOutcome === "fail" ? "failed"
      : result.output.sealedRun.policyOutcome === "review" ? "review"
      : result.output.sealedRun.policyOutcome === "abstain" ? "abstained" : "succeeded";
    if (row.id !== result.output.sealedRun.runId || row.operation_id !== result.operationId
      || row.producer_attempt_id !== result.output.verified.producerAttemptId || row.verifier_attempt_id !== snapshot.context.attemptId
      || (row.mission_id ?? undefined) !== snapshot.context.missionId || (row.work_item_id ?? undefined) !== snapshot.context.workItemId
      || row.contract_version !== "verification.v1" || row.policy_version !== audit.policyBinding.policyVersion
      || row.bundle_artifact_id !== signed.bundle.artifactId || row.deterministic_result_artifact_id !== signed.deterministic.artifactId
      || row.policy_artifact_id !== audit.policyBinding.policyArtifact.artifactId || String(row.policy_artifact_sha256) !== digestHex(audit.policyBinding.policyArtifact.digest)
      || row.run_manifest_artifact_id !== result.output.sealedRun.manifestArtifact.artifactId || String(row.manifest_sha256) !== digestHex(result.output.sealedRun.manifestArtifact.digest)
      || row.status !== expectedStatus) throw new Error("VERIFICATION_RUN_BINDING");
  }

  async #verifySignedInputsAndOutput(resolver: TrustedArtifactResolver, tenantId: string, snapshot: SucceededSnapshot, audit: VerificationAuditBundle, deterministicHandle: VerificationArtifactHandle): Promise<void> {
    const result = snapshot.result;
    const deterministic = await this.#hydrate(resolver, tenantId, deterministicHandle);
    const deterministicRaw = decoder.decode(deterministic.bytes);
    const deterministicBody = JSON.parse(deterministicRaw) as unknown;
    if (canonicalizeJson(deterministicBody) !== deterministicRaw || !same(deterministicBody, result.output.verified.deterministicResult)) throw new Error("SIGNED_RESULT_BODY");

    const verified = result.output.verified;
    const expectedSources = uniqueHandles(audit.verificationBundle.captures.flatMap(capture => [capture.contentArtifact, ...(capture.canonicalProjectionArtifact ? [capture.canonicalProjectionArtifact] : [])]));
    const actualSources = uniqueHandles(verified.sourceArtifacts);
    if (!same(actualSources, expectedSources) || actualSources.some(item => !exactHandleIn(audit.manifest.inputArtifacts, item))) throw new Error("SIGNED_SOURCE_SET_BINDING");
    const signedCaptureIds = audit.verificationBundle.captures.map(capture => capture.captureId).sort();
    if (!same([...snapshot.request.captureIds].sort(), signedCaptureIds)) throw new Error("REQUEST_CAPTURE_SET_BINDING");

    if (result.useCase === "verifyClaims") {
      if (!exactHandleIn(audit.manifest.inputArtifacts, verified.assertionsArtifact)) throw new Error("SIGNED_ASSERTIONS_REFERENCE");
      const assertions = await this.#hydrate(resolver, tenantId, verified.assertionsArtifact);
      const claims = VerificationClaimsArtifactSchema.parse(JSON.parse(decoder.decode(assertions.bytes)));
      if (!same(claims.bundle, audit.verificationBundle)) throw new Error("SIGNED_BUNDLE_BINDING");
      return;
    }

    const reportVerified = result.output.verified as VerificationReportOperationResult["output"]["verified"];
    if (!same(reportVerified.assertionsArtifact, reportVerified.claimLedgerArtifact)
      || !exactHandleIn(audit.manifest.inputArtifacts, reportVerified.claimLedgerArtifact)
      || !exactHandleIn(audit.manifest.inputArtifacts, reportVerified.reportArtifact)) throw new Error("SIGNED_REPORT_INPUT_REFERENCE");
    const ledgerHydrated = await this.#hydrate(resolver, tenantId, reportVerified.claimLedgerArtifact);
    const ledger = VerificationReportLedgerSchema.parse(JSON.parse(decoder.decode(ledgerHydrated.bytes)));
    if (!same(ledger.bundle, audit.verificationBundle) || !same(ledger.reportArtifact, reportVerified.reportArtifact)) throw new Error("SIGNED_REPORT_LEDGER_BINDING");
  }

  async #verifyReportGate(resolver: TrustedArtifactResolver, tenantId: string, snapshot: SucceededSnapshot, audit: VerificationAuditBundle, result: VerificationReportOperationResult, deterministic: VerificationArtifactHandle): Promise<VerificationArtifactHandle> {
    const gateDigest = audit.manifest.gateDigest;
    const gateCandidates = gateDigest ? audit.manifest.outputArtifacts.filter(item => item.digest === gateDigest) : [];
    if (gateCandidates.length !== 1) throw new Error("REPORT_GATE_REFERENCE");
    const gate = gateCandidates[0]!;
    const expectedParents = [deterministic.artifactId, result.output.verified.reportArtifact.artifactId, result.output.verified.claimLedgerArtifact.artifactId].sort();
    if (gate.artifactId === deterministic.artifactId || gate.mediaType !== "application/vnd.aiengineer.verification-report-result+json"
      || !same([...gate.parentArtifactIds].sort(), expectedParents)
      || gate.producerActivityId !== "verification-worker:sealClaimsAudit" || gate.producerVersion !== "verification-claims-sealer.v1"
      || gate.encryptionClass !== "supabase-managed" || gate.retentionClass !== "verification-audit" || gate.dataClassification !== "restricted") throw new Error("REPORT_GATE_LINEAGE");
    const metadata = await this.#artifactMetadata(tenantId, gate.artifactId);
    if (metadata.artifactType !== "verification_report_result" || metadata.bucketClass !== "ledger") throw new Error("REPORT_GATE_TYPE");
    const hydrated = await this.#hydrate(resolver, tenantId, gate);
    const raw = decoder.decode(hydrated.bytes);
    const body = VerificationReportGateArtifactSchema.parse(JSON.parse(raw));
    if (canonicalizeJson(body) !== raw || body.deterministicResultDigest !== deterministic.digest || !same(body.reportWide, result.output.verified.reportWide)
      || gate.transformationSignature !== digestCanonicalJson({ kind: "verification_report_wide_gate.v1", resultDigest: deterministic.digest, reportWideDigest: digestCanonicalJson(result.output.verified.reportWide) })
      || snapshot.operationKind !== "verification_report") throw new Error("REPORT_GATE_BODY");
    return gate;
  }

  async #artifactMetadata(tenantId: string, artifactId: string): Promise<{ readonly artifactType: string; readonly bucketClass: string }> {
    return this.database.transaction(tenantId, async client => {
      const rows = (await client.query<Row>("select artifact_type,bucket_class from orchestration.artifact where tenant_id=$1 and id=$2", [tenantId, artifactId])).rows;
      if (rows.length !== 1) throw new Error("ARTIFACT_METADATA");
      return { artifactType: String(rows[0]!.artifact_type), bucketClass: String(rows[0]!.bucket_class) };
    });
  }

  async #hydrate(resolver: TrustedArtifactResolver, tenantId: string, expected: VerificationArtifactHandle): Promise<{ readonly handle: VerificationArtifactHandle; readonly bytes: Uint8Array }> {
    if (expected.tenantId !== tenantId) throw new Error("ARTIFACT_TENANT");
    await resolver.authorizeArtifact({ tenantId, artifactId: expected.artifactId, purpose: "verification_replay" });
    const loaded = await resolver.hydrateRegisteredArtifact({ tenantId, artifactId: expected.artifactId });
    const handle = VerificationArtifactHandleSchema.parse(loaded.registration);
    if (!same(handle, expected) || loaded.bytes.byteLength !== expected.byteLength || sha256Digest(loaded.bytes) !== expected.digest) throw new Error("ARTIFACT_IDENTITY");
    return { handle, bytes: loaded.bytes.slice() };
  }

  async #snapshot(tenantId: string, operationId: string): Promise<Snapshot> {
    return this.database.transaction(tenantId, async client => {
      const rows = (await client.query<Row>(`select o.operation_kind,o.status,o.request,o.request_sha256,o.idempotency_key,o.actor_identity,o.attempt_id,o.mission_id,o.work_item_id,o.correlation_id,o.causation_id,o.ownership_mode,o.external_run_id,s.id step_id,s.status step_status,s.step_key,s.step_kind,s.input,s.input_sha256,r.id receipt_id,r.receipt_kind,r.outcome,r.input_sha256 receipt_input_sha256,r.output_sha256,r.body,a.id artifact_id,a.artifact_type,a.bucket_class,e.id event_id,e.operation_id event_operation_id,e.step_id event_step_id,e.event_kind,e.from_state event_from_state,e.to_state event_to_state,e.guarded_sha256 event_guarded_sha256,e.payload event_payload from knowledge_service.operation o left join knowledge_service.operation_step s on s.tenant_id=o.tenant_id and s.operation_id=o.id left join knowledge_service.receipt r on r.tenant_id=o.tenant_id and r.operation_id=o.id and r.step_id=s.id left join orchestration.artifact a on a.tenant_id=o.tenant_id and a.id=(r.body->'resultArtifact'->>'artifactId')::uuid left join knowledge_service.operation_event e on e.tenant_id=o.tenant_id and e.id=(r.body->>'eventId')::uuid where o.tenant_id=$1 and o.id=$2 and o.operation_kind in ('verification_claims','verification_report')`, [tenantId, operationId])).rows;
      if (rows.length === 0) throw new ClaimsReportReadError("NOT_FOUND");
      if (rows.length !== 1) throw new Error("TERMINAL_COUNT");
      const row = rows[0]!, status = String(row.status);
      if (["queued", "running", "needs_review", "quarantined"].includes(status)) return deepFreeze({ state: "pending" as const });
      if (status === "failed") return deepFreeze({ state: "failed" as const });
      if (status === "cancelled") return deepFreeze({ state: "cancelled" as const });
      if (status !== "succeeded") throw new Error("OPERATION_STATUS");
      const durable = durableSchema.parse(row.request), step = stepSchema.parse(row.input);
      const expectedStep = durable.kind === "verification_claims" ? "verify_claims_and_register" : "verify_report_and_register";
      if (row.operation_kind !== durable.kind || step.kind !== durable.kind || step.step.name !== expectedStep
        || !same(durable.input, step.operationInput) || !same(durable.expectedVersions, step.expectedVersions) || !same(durable.authenticatedContext, step.context)
        || step.context.tenantId !== tenantId || step.context.operationId !== operationId || row.idempotency_key !== step.context.idempotencyKey
        || row.actor_identity !== `${step.context.actor.kind}:${step.context.actor.id}` || row.attempt_id !== step.context.attemptId
        || (row.mission_id ?? undefined) !== step.context.missionId || (row.work_item_id ?? undefined) !== step.context.workItemId
        || row.correlation_id !== databaseUuid("correlation", step.context.correlationId)
        || (row.causation_id ?? undefined) !== (step.context.causationId ? databaseUuid("causation", step.context.causationId) : undefined)
        || row.ownership_mode !== (step.context.externalExecution?.runtime === "eve" ? "eve" : step.context.externalExecution?.runtime === "mission_control" ? "mission_control" : "standalone")
        || (row.external_run_id ?? undefined) !== step.context.externalExecution?.runId
        || digestCanonicalJson(durable) !== `sha256:${String(row.request_sha256)}` || digestCanonicalJson(step) !== `sha256:${String(row.input_sha256)}`
        || row.step_status !== "succeeded" || row.step_key !== expectedStep || row.step_kind !== expectedStep
        || row.receipt_kind !== `${expectedStep}.succeeded` || row.outcome !== "succeeded"
        || !UuidSchema.safeParse(row.step_id).success || !UuidSchema.safeParse(row.receipt_id).success
        || row.receipt_input_sha256 !== row.input_sha256 || row.artifact_type !== "deterministic_verification_result" || row.bucket_class !== "ledger") throw new Error("TERMINAL_BINDING");
      if (!row.body || typeof row.body !== "object" || Array.isArray(row.body)) throw new Error("RECEIPT_BODY");
      const { eventId, fencingToken, ...body } = row.body as Row;
      const result = durable.input.useCase === "verifyClaims" ? VerificationClaimsOperationResultSchema.parse(body) : VerificationReportOperationResultSchema.parse(body);
      if (!UuidSchema.safeParse(eventId).success || !Number.isSafeInteger(fencingToken) || Number(fencingToken) < 1
        || row.event_id !== eventId || row.event_operation_id !== operationId || row.event_step_id !== row.step_id
        || row.event_kind !== "step.succeeded" || row.event_from_state !== "running" || row.event_to_state !== "succeeded"
        || row.event_guarded_sha256 !== row.output_sha256 || !same(row.event_payload, { outputSha256: row.output_sha256, fencingToken: String(fencingToken) })
        || result.operationId !== operationId || result.useCase !== durable.input.useCase || result.requestDigest !== digestCanonicalJson(durable.input.request)
        || result.resultArtifact.artifactId !== row.artifact_id || digestCanonicalJson(result) !== `sha256:${String(row.output_sha256)}`) throw new Error("RECEIPT_BINDING");
      const verified = result.output.verified;
      const handles = [verified.assertionsArtifact, ...verified.sourceArtifacts, ...("reportArtifact" in verified ? [verified.reportArtifact, verified.claimLedgerArtifact] : []), result.output.sealedRun.manifestArtifact, result.resultArtifact];
      if (handles.some(handle => handle.tenantId !== tenantId)) throw new Error("INPUT_TENANT_BINDING");
      if (durable.input.useCase === "verifyClaims" && (verified.assertionsArtifact.artifactId !== durable.input.request.assertions.artifactId || verified.assertionsArtifact.digest !== durable.input.request.assertions.digest)) throw new Error("CLAIMS_INPUT_BINDING");
      if (durable.input.useCase === "verifyReport") {
        const reportVerified = result.output.verified as VerificationReportOperationResult["output"]["verified"];
        if (reportVerified.reportArtifact.artifactId !== durable.input.request.report.artifactId || reportVerified.reportArtifact.digest !== durable.input.request.report.digest
          || reportVerified.claimLedgerArtifact.artifactId !== durable.input.request.claimLedger.artifactId || reportVerified.claimLedgerArtifact.digest !== durable.input.request.claimLedger.digest) throw new Error("REPORT_INPUT_BINDING");
      }
      return deepFreeze({ state: "succeeded" as const, result, artifactId: String(row.artifact_id), operationKind: durable.kind, request: durable.input.request, context: step.context });
    });
  }
}
