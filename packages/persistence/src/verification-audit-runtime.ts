import { createNativeSemanticAuditJudgeResolver } from "./verification-semantic-audit-resolver.js";
import {
  VerificationAuditInspectionApplicationService,
  createCapturedSemanticAuditReplay,
  VerificationAuditInspectionGrantCatalog,
  type SemanticJudgeProfileCatalog,
  type VerificationAdmissionService,
  type VerificationClaimsProjectionGrantCatalog,
} from "@aiengineer/knowledge-application";
import { VerificationArtifactHandleSchema, type InspectAuditBundleRequest, type OperationContext, type VerificationAuditInspectionResult } from "@aiengineer/knowledge-contracts";
import { createEd25519Verifier, digestCanonicalJson, projectionSelectorResolver } from "@aiengineer/knowledge-verification";
import { z } from "zod";
import { PostgresVerificationClaimsRuntimePrincipals } from "./verification-claims-principals.js";
import type { PostgresCanonicalRepository } from "./postgres.js";
import type { PostgresVerificationRepository } from "./verification.js";

const keySchema = z.strictObject({
  keyId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u),
  publicKeyPem: z.string().min(64).max(4_096),
});
const keysSchema = z.array(keySchema).min(1).max(32);

export function parseVerificationAuditInspectionPublicKeys(value: string) {
  if (value.length > 131_072) throw new Error("VERIFICATION_AUDIT_INSPECTION_PUBLIC_KEYS_TOO_LARGE");
  let parsed: unknown;
  try { parsed = JSON.parse(value); }
  catch { throw new Error("VERIFICATION_AUDIT_INSPECTION_PUBLIC_KEYS_INVALID"); }
  const keys = keysSchema.parse(parsed);
  const result: Record<string, string> = {};
  for (const item of keys) {
    if (result[item.keyId]) throw new Error("VERIFICATION_AUDIT_INSPECTION_PUBLIC_KEY_DUPLICATE");
    result[item.keyId] = item.publicKeyPem;
  }
  return Object.freeze(result);
}

export interface VerificationAuditInspectionRuntimeDependencies {
  readonly database: PostgresCanonicalRepository;
  readonly repository: PostgresVerificationRepository;
  readonly admission: Pick<VerificationAdmissionService, "hydrateAdmittedProjection">;
  readonly projectionGrants: VerificationClaimsProjectionGrantCatalog;
  readonly auditGrants: VerificationAuditInspectionGrantCatalog;
  readonly trustedPublicKeys: Readonly<Record<string, string>>;
  readonly storageBucket: string;
  readonly maximumInspectionMs?: number;
  readonly semanticProfiles?: SemanticJudgeProfileCatalog;
  readonly resolveSemanticJudges?: (input: Parameters<Parameters<typeof createCapturedSemanticAuditReplay>[0]["resolveJudges"]>[0] & {
    readonly originalOperationId: string;
    readonly signal: AbortSignal;
  }) => ReturnType<Parameters<typeof createCapturedSemanticAuditReplay>[0]["resolveJudges"]>;

  readonly now: () => string;
}

/** Shared native trust composition for audit inspection and adjudication packets. */
export interface VerificationAuditInspectionRuntimeService {
  inspect(request: unknown, context: unknown, signal: AbortSignal): Promise<VerificationAuditInspectionResult>;
}

export function createVerificationAuditInspectionService(dependencies: VerificationAuditInspectionRuntimeDependencies): VerificationAuditInspectionRuntimeService {
  const signatureVerifier = createEd25519Verifier(dependencies.trustedPublicKeys);
  const resolveSemanticJudges = dependencies.resolveSemanticJudges ?? (dependencies.semanticProfiles ? createNativeSemanticAuditJudgeResolver({ database: dependencies.database, repository: dependencies.repository, profiles: dependencies.semanticProfiles }) : undefined);
  const principals = new PostgresVerificationClaimsRuntimePrincipals(dependencies.database);

  const inspect: VerificationAuditInspectionRuntimeService["inspect"] = async (requestValue, contextValue, signal) => {
    const request = requestValue as InspectAuditBundleRequest;
    const context = contextValue as OperationContext;
    const auditGrant = dependencies.auditGrants.resolve(context.tenantId, request);
    const resolver = dependencies.repository.createTrustedArtifactResolver();
    return new VerificationAuditInspectionApplicationService({
      artifactResolver: {
        async authorizeArtifact(input) {
          if (input.signal.aborted) throw input.signal.reason;
          await resolver.authorizeArtifact(input);
        },
        async hydrateRegisteredArtifact(input) {
          if (input.signal.aborted) throw input.signal.reason;
          return resolver.hydrateRegisteredArtifact(input);
        },
      },
      signatureVerifier,
      maximumInspectionMs: dependencies.maximumInspectionMs ?? 30_000,
      replayTrust: { async resolve(input) {
        if (input.signal.aborted) throw input.signal.reason;
        const registeredAudit = await dependencies.repository.loadAuditBundle(input.context.tenantId, input.auditBundle.manifest.runId);
        if (digestCanonicalJson(registeredAudit) !== digestCanonicalJson(input.auditBundle)) throw new Error("VERIFICATION_AUDIT_INSPECTION_RUN_BINDING_MISMATCH");
        const binding = await dependencies.repository.loadVerificationRunReplayBinding(input.context.tenantId, input.auditBundle.manifest.runId);
        if (!binding) throw new Error("VERIFICATION_AUDIT_INSPECTION_RUN_BINDING_REQUIRED");
        const producerOperation = await dependencies.database.getOperationRecord(input.context.tenantId, binding.operationId);
        const expectedOperationKind = auditGrant.runKind === "claims" ? "verification_claims" : "verification_report";
        if (!producerOperation || producerOperation.status !== "succeeded" || producerOperation.operationKind !== expectedOperationKind) throw new Error("VERIFICATION_AUDIT_INSPECTION_RUN_KIND_MISMATCH");
        if (input.signal.aborted) throw input.signal.reason;
        const retainedBundle = input.auditBundle.manifest.outputArtifacts.find((artifact) => digestCanonicalJson(artifact) === digestCanonicalJson(binding.bundleArtifact));
        if (!retainedBundle || retainedBundle.parentArtifactIds.length !== 1) throw new Error("VERIFICATION_AUDIT_INSPECTION_ASSERTIONS_BINDING_REQUIRED");
        const assertionsArtifact = input.auditBundle.manifest.inputArtifacts.find((artifact) => artifact.artifactId === retainedBundle.parentArtifactIds[0]);
        if (!assertionsArtifact) throw new Error("VERIFICATION_AUDIT_INSPECTION_ASSERTIONS_BINDING_REQUIRED");
        const historicalContext: OperationContext = {
          ...input.context,
          operationId: binding.operationId,
          missionId: binding.missionId,
          workItemId: binding.workItemId,
          attemptId: binding.verifierAttemptId,
        };
        const identity = await principals.bind({ context: historicalContext, assertionsArtifact, captureIds: input.auditBundle.verificationBundle.captures.map((capture) => capture.captureId) });
        const projectionGrant = dependencies.projectionGrants.resolve(input.context.tenantId, assertionsArtifact);
        const retained = (artifact: unknown) => [...input.auditBundle.manifest.inputArtifacts, ...input.auditBundle.manifest.outputArtifacts].some((item) => digestCanonicalJson(item) === digestCanonicalJson(artifact));
        const admitted = new Set<string>();
        for (const capture of input.auditBundle.verificationBundle.captures) {
          if (!capture.canonicalProjectionArtifact) continue;
          const grant = projectionGrant.admissions.find((candidate) => candidate.captureId === capture.captureId && candidate.projectionArtifactId === capture.canonicalProjectionArtifact!.artifactId);
          if (!grant) throw new Error("VERIFICATION_AUDIT_INSPECTION_PROJECTION_GRANT_REQUIRED");
          const hydrated = await dependencies.admission.hydrateAdmittedProjection({
            tenantId: input.context.tenantId,
            captureId: capture.captureId,
            expectedSourceArtifact: { artifactId: capture.contentArtifact.artifactId, digest: capture.contentArtifact.digest as `sha256:${string}` },
            transformationArtifactId: grant.transformationArtifactId,
            projectionArtifactId: grant.projectionArtifactId,
          });
          const receipt = hydrated.receipt;
          if (receipt.captureId !== capture.captureId
            || digestCanonicalJson(receipt.sourceArtifact) !== digestCanonicalJson(capture.contentArtifact)
            || digestCanonicalJson(receipt.projectionArtifact) !== digestCanonicalJson(capture.canonicalProjectionArtifact)
            || !retained(receipt.transformationArtifact)) {
            throw new Error("VERIFICATION_AUDIT_INSPECTION_PROJECTION_BINDING_MISMATCH");
          }
          admitted.add(digestCanonicalJson({ captureId: receipt.captureId, sourceArtifact: receipt.sourceArtifact, projectionArtifact: receipt.projectionArtifact }));
        }
        return {
          runtimePrincipals: identity.runtimePrincipals,
          ...(resolveSemanticJudges ? { semanticReplay: createCapturedSemanticAuditReplay({
            selectorResolvers: [projectionSelectorResolver],
            resolveJudges: async request => {
              if (input.signal.aborted) throw input.signal.reason;
              return resolveSemanticJudges!({ ...request, originalOperationId: binding.operationId, signal: input.signal });
            },
            createResolver: () => {
              const retainedResolver = dependencies.repository.createTrustedArtifactResolver();
              return {
                async authorizeArtifact(request) { if (input.signal.aborted) throw input.signal.reason; await retainedResolver.authorizeArtifact(request); },
                async hydrateRegisteredArtifact(request) { if (input.signal.aborted) throw input.signal.reason; const result = await retainedResolver.hydrateRegisteredArtifact(request); if (input.signal.aborted) throw input.signal.reason; return result; },
              };
            },
          }) } : {}),
          selectorResolvers: [projectionSelectorResolver],
          isProjectionLineageAdmitted: (candidate: { captureId: string; sourceArtifact: z.infer<typeof VerificationArtifactHandleSchema>; projectionArtifact: z.infer<typeof VerificationArtifactHandleSchema> }) => admitted.has(digestCanonicalJson(candidate)),
        };
      } },
    }).inspect(request, context, signal);
  };

  return { inspect };
}
