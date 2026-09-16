import { authenticateCanonicalContentEvidence, type ContentLinkAuthority } from "@aiengineer/knowledge-ingestion";
import type { VerificationExecutor } from "../executor.js";
import { loadSealedContentClaim } from "./evidence-oracle.js";

/** Host construction binds tenant and policy; request data cannot replace either. */
export function createContentLinkAuthority(options: {
  verification: VerificationExecutor;
  tenantId: string; policyVersion: string; policyDigest: string;
}): ContentLinkAuthority {
  if (options.verification.store.tenantId !== options.tenantId) throw new Error("CONTENT_AUTHORITY_TENANT_MISMATCH");
  return {
    async authenticate(input) {
      if (input.tenantId !== options.tenantId || input.policyDigest !== options.policyDigest) throw new Error("CONTENT_AUTHORITY_PIN_MISMATCH");
      return authenticateCanonicalContentEvidence({ ...input,
          loadClaim: claim => loadSealedContentClaim(options.verification, { ...claim,
            tenantId: options.tenantId, policyVersion: options.policyVersion, policyDigest: options.policyDigest }),
        });
    },
  };
}
