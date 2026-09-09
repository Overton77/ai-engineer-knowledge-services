import {
  VerificationAdjudicationRequestApplicationService,
} from "@aiengineer/knowledge-application";
import { sha256Digest } from "@aiengineer/knowledge-verification";
import {
  createVerificationAuditInspectionService,
  type VerificationAuditInspectionRuntimeDependencies,
} from "./verification-audit-runtime.js";

export interface VerificationAdjudicationRuntimeDependencies extends VerificationAuditInspectionRuntimeDependencies {
  /** Server configuration only; the public request cannot choose reviewer roles or quorum. */
  readonly reviewRequirements: unknown;
}

async function bounded<T>(signal: AbortSignal, action: () => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  let abort: (() => void) | undefined;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
  });
  try { return await Promise.race([action(), cancelled]); }
  finally { if (abort) signal.removeEventListener("abort", abort); }
}

export function createVerificationAdjudicationRequestService(dependencies: VerificationAdjudicationRuntimeDependencies) {
  const auditService = createVerificationAuditInspectionService(dependencies);
  return new VerificationAdjudicationRequestApplicationService({
    async inspectAndResolve({ request, context, signal }) {
      const deadline = AbortSignal.any([signal, AbortSignal.timeout(dependencies.maximumInspectionMs ?? 30_000)]);
      const inspection = await bounded(deadline, () => auditService.inspect({
        verificationContractVersion: request.verificationContractVersion,
        auditBundle: request.evidencePacket,
      }, context, deadline));
      const resolver = dependencies.repository.createTrustedArtifactResolver();
      await bounded(deadline, () => resolver.authorizeArtifact({
        tenantId: context.tenantId, artifactId: request.evidencePacket.artifactId, purpose: "verification_replay",
      }));
      const hydrated = await bounded(deadline, () => resolver.hydrateRegisteredArtifact({
        tenantId: context.tenantId, artifactId: request.evidencePacket.artifactId,
      }));
      if (hydrated.registration.byteLength !== hydrated.bytes.byteLength
        || sha256Digest(hydrated.bytes) !== request.evidencePacket.digest) {
        throw new Error("VERIFICATION_ADJUDICATION_RUN_BINDING_MISMATCH");
      }
      const auditBundle = await bounded(deadline, () => dependencies.repository.loadAuditBundle(context.tenantId, inspection.run.runId));
      // Application preparation repeats exact canonical digest, tenant, run,
      // artifact closure and target membership against the inspected content.
      return { inspection, auditBundle, manifestArtifact: hydrated.registration };
    },
  }, dependencies.reviewRequirements);
}
