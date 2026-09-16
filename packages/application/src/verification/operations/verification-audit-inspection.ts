import {
  InspectAuditBundleRequestSchema,
  OperationContextSchema,
  VerificationAuditInspectionResultSchema,
  VerificationArtifactHandleSchema,
  type InspectAuditBundleRequest,
  type OperationContext,
  type VerificationAuditInspectionResult,
  type VerificationArtifactHandle,
  type VerificationArtifactReference,
} from "@aiengineer/knowledge-contracts";
import { deepFreeze } from "@aiengineer/knowledge-domain";
import {
  canonicalizeJson,
  digestCanonicalJson,
  inspectAuditBundle,
  sha256Digest,
  type AuditBundleInspection,
  type AuditBundleSignatureVerifier,
  type DeterministicSelectorResolver,
  type DeterministicVerificationOptions,
  type RuntimePrincipalBinding,
  type VerificationSemanticReplayPort,
  type TrustedArtifactResolver,
  type VerificationAuditBundle,
} from "@aiengineer/knowledge-verification";
import { replayVerificationAudit } from "./verification-replay.js";

export { VerificationAuditInspectionResultSchema } from "@aiengineer/knowledge-contracts";
export type { VerificationAuditInspectionResult } from "@aiengineer/knowledge-contracts";

export interface VerificationAuditInspectionReplayTrustPort {
  /** Resolve runtime identity and native projection trust from server-owned configuration/state. */
  resolve(input: {
    readonly context: OperationContext;
    readonly auditArtifact: VerificationArtifactHandle;
    readonly auditBundle: VerificationAuditBundle;
    /** Combined caller-cancellation and service-deadline signal. */
    readonly signal: AbortSignal;
  }): Promise<{
    readonly runtimePrincipals: RuntimePrincipalBinding;
    readonly semanticReplay?: VerificationSemanticReplayPort;
    readonly selectorResolvers?: readonly DeterministicSelectorResolver[];
    readonly isProjectionLineageAdmitted?: DeterministicVerificationOptions["isProjectionLineageAdmitted"];
  }>;
}

export interface VerificationAuditInspectionArtifactResolver {
  authorizeArtifact(input: Parameters<TrustedArtifactResolver["authorizeArtifact"]>[0] & {
    readonly signal: AbortSignal;
  }): Promise<void>;
  hydrateRegisteredArtifact(input: Parameters<TrustedArtifactResolver["hydrateRegisteredArtifact"]>[0] & {
    readonly signal: AbortSignal;
  }): Promise<Awaited<ReturnType<TrustedArtifactResolver["hydrateRegisteredArtifact"]>>>;
}

export interface VerificationAuditInspectionDependencies {
  readonly artifactResolver: VerificationAuditInspectionArtifactResolver;
  /** Constructed from server-owned public keys. Requests never supply keys or signature policy. */
  readonly signatureVerifier: AuditBundleSignatureVerifier;
  readonly replayTrust: VerificationAuditInspectionReplayTrustPort;
  readonly maximumAuditBytes?: number;
  /** Bounds the complete inspection. Resolver adapters must also bound their underlying I/O. */
  readonly maximumInspectionMs?: number;
}

export type VerificationAuditInspectionErrorCode =
  | "VERIFICATION_AUDIT_INSPECTION_INVALID_REQUEST"
  | "VERIFICATION_AUDIT_INSPECTION_UNSUPPORTED_VERSION"
  | "VERIFICATION_AUDIT_INSPECTION_ARTIFACT_INTEGRITY_FAILURE"
  | "VERIFICATION_AUDIT_INSPECTION_BUNDLE_CORRUPT"
  | "VERIFICATION_AUDIT_INSPECTION_SIGNATURE_UNTRUSTED"
  | "VERIFICATION_AUDIT_INSPECTION_REPLAY_FAILURE"
  | "VERIFICATION_AUDIT_INSPECTION_CANCELLED"
  | "VERIFICATION_AUDIT_INSPECTION_TIMEOUT";

/** Safe public failure: the code is stable and no resolver, bundle, or key detail is retained. */
export class VerificationAuditInspectionError extends Error {
  constructor(readonly code: VerificationAuditInspectionErrorCode) {
    super(code);
    this.name = "VerificationAuditInspectionError";
  }
}

const decoder = new TextDecoder("utf-8", { fatal: true });
const expectedVersion = "verification.v1";
function fail(code: VerificationAuditInspectionErrorCode): never {
  throw new VerificationAuditInspectionError(code);
}

function hasUnsupportedVersion(value: unknown): boolean {
  return value !== null && typeof value === "object"
    && typeof (value as { verificationContractVersion?: unknown }).verificationContractVersion === "string"
    && (value as { verificationContractVersion: string }).verificationContractVersion !== expectedVersion;
}

function inspectionFailure(inspection: AuditBundleInspection): VerificationAuditInspectionErrorCode {
  if (inspection.errors.includes("AUDIT_BUNDLE_VERSION_INVALID")) return "VERIFICATION_AUDIT_INSPECTION_UNSUPPORTED_VERSION";
  const signatureErrors = new Set([
    "AUDIT_BUNDLE_SIGNATURE_INVALID",
    "AUDIT_BUNDLE_SIGNATURE_INCOMPLETE",
  ]);
  if (inspection.errors.length > 0 && inspection.errors.every((code) => signatureErrors.has(code))) {
    return "VERIFICATION_AUDIT_INSPECTION_SIGNATURE_UNTRUSTED";
  }
  return "VERIFICATION_AUDIT_INSPECTION_BUNDLE_CORRUPT";
}

class InspectionExecution {
  readonly #controller = new AbortController();
  readonly #callerSignal: AbortSignal | undefined;
  readonly #callerAbort: () => void;
  readonly #timer: ReturnType<typeof setTimeout> | undefined;
  #callerCancelled = false;
  #timedOut = false;

  constructor(maximumInspectionMs: number, callerSignal?: AbortSignal) {
    this.#callerSignal = callerSignal;
    this.#callerAbort = () => {
      this.#callerCancelled = true;
      this.#controller.abort();
    };
    if (callerSignal?.aborted) this.#callerAbort();
    else callerSignal?.addEventListener("abort", this.#callerAbort, { once: true });
    if (!this.#controller.signal.aborted) {
      this.#timer = setTimeout(() => {
        this.#timedOut = true;
        this.#controller.abort();
      }, maximumInspectionMs);
    }
  }

  assertActive(): void {
    if (this.#callerCancelled) fail("VERIFICATION_AUDIT_INSPECTION_CANCELLED");
    if (this.#timedOut) fail("VERIFICATION_AUDIT_INSPECTION_TIMEOUT");
  }

  get signal(): AbortSignal {
    return this.#controller.signal;
  }

  /** Race all native resolver, verifier, trust, and replay awaits against cancellation/deadline. */
  async run<T>(operation: () => T | PromiseLike<T>): Promise<T> {
    this.assertActive();
    let work: Promise<T>;
    try {
      work = Promise.resolve(operation());
    } catch (error) {
      throw error;
    }
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const cleanup = () => this.#controller.signal.removeEventListener("abort", onAbort);
      const finish = (action: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        action();
      };
      const onAbort = () => finish(() => {
        try {
          this.assertActive();
        } catch (error) {
          reject(error);
        }
      });
      this.#controller.signal.addEventListener("abort", onAbort, { once: true });
      if (this.#controller.signal.aborted) onAbort();
      work.then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(error)),
      );
    });
  }

  guardedResolver(resolver: VerificationAuditInspectionArtifactResolver): TrustedArtifactResolver {
    return Object.freeze({
      authorizeArtifact: (input: Parameters<TrustedArtifactResolver["authorizeArtifact"]>[0]) =>
        this.run(() => resolver.authorizeArtifact({ ...input, signal: this.signal })),
      hydrateRegisteredArtifact: (input: Parameters<TrustedArtifactResolver["hydrateRegisteredArtifact"]>[0]) =>
        this.run(() => resolver.hydrateRegisteredArtifact({ ...input, signal: this.signal })),
    });
  }

  close(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#callerSignal?.removeEventListener("abort", this.#callerAbort);
  }
}

async function safely<T>(
  execution: InspectionExecution,
  code: VerificationAuditInspectionErrorCode,
  operation: () => T | PromiseLike<T>,
): Promise<T> {
  try {
    return await execution.run(operation);
  } catch (error) {
    if (error instanceof VerificationAuditInspectionError) throw error;
    return fail(code);
  }
}

/** High-assurance inspection over one exact registered sealed audit artifact. */
export class VerificationAuditInspectionApplicationService {
  readonly #maximumAuditBytes: number;
  readonly #maximumInspectionMs: number;

  constructor(private readonly dependencies: VerificationAuditInspectionDependencies) {
    const maximum = dependencies.maximumAuditBytes ?? 16_000_000;
    if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 64_000_000) throw new Error("VERIFICATION_AUDIT_INSPECTION_LIMIT_INVALID");
    const maximumInspectionMs = dependencies.maximumInspectionMs ?? 30_000;
    if (!Number.isSafeInteger(maximumInspectionMs) || maximumInspectionMs < 1 || maximumInspectionMs > 120_000) {
      throw new Error("VERIFICATION_AUDIT_INSPECTION_DEADLINE_INVALID");
    }
    this.#maximumAuditBytes = maximum;
    this.#maximumInspectionMs = maximumInspectionMs;
  }

  async inspect(requestValue: unknown, contextValue: unknown, signal?: AbortSignal): Promise<VerificationAuditInspectionResult> {
    const execution = new InspectionExecution(this.#maximumInspectionMs, signal);
    try {
      execution.assertActive();
      if (hasUnsupportedVersion(requestValue)) fail("VERIFICATION_AUDIT_INSPECTION_UNSUPPORTED_VERSION");
      const requestResult = InspectAuditBundleRequestSchema.safeParse(requestValue);
      const contextResult = OperationContextSchema.safeParse(contextValue);
      if (!requestResult.success || !contextResult.success) fail("VERIFICATION_AUDIT_INSPECTION_INVALID_REQUEST");
      const request: InspectAuditBundleRequest = requestResult.data;
      const context = contextResult.data;

      await safely(execution, "VERIFICATION_AUDIT_INSPECTION_ARTIFACT_INTEGRITY_FAILURE", () =>
        this.dependencies.artifactResolver.authorizeArtifact({
          tenantId: context.tenantId,
          artifactId: request.auditBundle.artifactId,
          purpose: "verification_replay",
          signal: execution.signal,
        }));
      const hydrated = await safely(execution, "VERIFICATION_AUDIT_INSPECTION_ARTIFACT_INTEGRITY_FAILURE", () =>
        this.dependencies.artifactResolver.hydrateRegisteredArtifact({
          tenantId: context.tenantId,
          artifactId: request.auditBundle.artifactId,
          signal: execution.signal,
        }));
      const artifactResult = VerificationArtifactHandleSchema.safeParse(hydrated.registration);
      if (!artifactResult.success) fail("VERIFICATION_AUDIT_INSPECTION_ARTIFACT_INTEGRITY_FAILURE");
      const artifact = artifactResult.data;
      if (artifact.tenantId !== context.tenantId || artifact.artifactId !== request.auditBundle.artifactId
        || artifact.digest !== request.auditBundle.digest || artifact.byteLength !== hydrated.bytes.byteLength
        || artifact.byteLength > this.#maximumAuditBytes || sha256Digest(hydrated.bytes) !== artifact.digest
        || artifact.mediaType !== "application/vnd.aiengineer.verification-run-manifest+json") {
        fail("VERIFICATION_AUDIT_INSPECTION_ARTIFACT_INTEGRITY_FAILURE");
      }

      let parsed: unknown;
      try {
        const raw = decoder.decode(hydrated.bytes);
        parsed = JSON.parse(raw) as unknown;
        if (canonicalizeJson(parsed) !== raw) fail("VERIFICATION_AUDIT_INSPECTION_BUNDLE_CORRUPT");
      } catch (error) {
        if (error instanceof VerificationAuditInspectionError) throw error;
        return fail("VERIFICATION_AUDIT_INSPECTION_BUNDLE_CORRUPT");
      }
      if (hasUnsupportedVersion(parsed)) fail("VERIFICATION_AUDIT_INSPECTION_UNSUPPORTED_VERSION");
      const audit = parsed as VerificationAuditBundle;
      const inspection = await safely(execution, "VERIFICATION_AUDIT_INSPECTION_BUNDLE_CORRUPT", () =>
        inspectAuditBundle(audit, this.dependencies.signatureVerifier));
      if (!inspection.valid) fail(inspectionFailure(inspection));
      if (inspection.signatureStatus !== "verified") fail("VERIFICATION_AUDIT_INSPECTION_SIGNATURE_UNTRUSTED");
      if (audit.tenantId !== context.tenantId) fail("VERIFICATION_AUDIT_INSPECTION_BUNDLE_CORRUPT");
      const expectedParents = [...new Set([
        ...audit.manifest.inputArtifacts,
        ...audit.manifest.outputArtifacts,
      ].map((item) => item.artifactId))].sort();
      if (!artifact.transformationSignature || artifact.createdAt !== audit.manifest.completedAt
        || digestCanonicalJson([...artifact.parentArtifactIds].sort()) !== digestCanonicalJson(expectedParents)) {
        fail("VERIFICATION_AUDIT_INSPECTION_ARTIFACT_INTEGRITY_FAILURE");
      }

      const trust = await safely(execution, "VERIFICATION_AUDIT_INSPECTION_REPLAY_FAILURE", () =>
        this.dependencies.replayTrust.resolve({ context, auditArtifact: artifact, auditBundle: audit, signal: execution.signal }));
      const replay = await safely(execution, "VERIFICATION_AUDIT_INSPECTION_REPLAY_FAILURE", () =>
        replayVerificationAudit(audit, {
          artifactResolver: execution.guardedResolver(this.dependencies.artifactResolver),
          runtimePrincipals: trust.runtimePrincipals,
          ...(trust.semanticReplay ? { semanticReplay: trust.semanticReplay } : {}),
          signatureVerifier: this.dependencies.signatureVerifier,
          ...(trust.selectorResolvers ? { selectorResolvers: trust.selectorResolvers } : {}),
          ...(trust.isProjectionLineageAdmitted ? { isProjectionLineageAdmitted: trust.isProjectionLineageAdmitted } : {}),
        }));
      if (!replay.inspection.valid || replay.inspection.signatureStatus !== "verified"
        || replay.deterministicResultDigest !== audit.deterministicResultDigest
        || replay.policyDecisionDigest !== audit.policyDecisionDigest
        || replay.policyOutcome !== audit.manifest.policyOutcome) {
        fail("VERIFICATION_AUDIT_INSPECTION_REPLAY_FAILURE");
      }

      const reference: VerificationArtifactReference = {
        artifactId: artifact.artifactId,
        digest: artifact.digest as `sha256:${string}`,
        mediaType: artifact.mediaType,
        sizeBytes: artifact.byteLength,
      };
      return deepFreeze(VerificationAuditInspectionResultSchema.parse({
        schemaVersion: "verification-audit-inspection.v1",
        verificationContractVersion: "verification.v1",
        auditArtifact: reference,
        run: {
          runId: audit.manifest.runId,
          manifestId: audit.manifest.manifestId,
          manifestDigest: replay.inspection.manifestDigest,
          deterministicResultDigest: replay.deterministicResultDigest,
          policyDecisionDigest: replay.policyDecisionDigest,
          policyOutcome: replay.policyOutcome,
          startedAt: audit.manifest.startedAt,
          completedAt: audit.manifest.completedAt,
        },
        proof: {
          payloadDigest: replay.inspection.payloadDigest,
          signatureStatus: "verified",
          deterministicReplay: "exact",
          policyReplay: "exact",
          replayedArtifactCount: replay.replayedArtifactIds.length,
          inputArtifactCount: audit.manifest.inputArtifacts.length,
          outputArtifactCount: audit.manifest.outputArtifacts.length,
        },
      }));
    } finally {
      execution.close();
    }
  }
}
