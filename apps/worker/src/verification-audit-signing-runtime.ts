import { createEd25519Signer } from "@aiengineer/knowledge-verification";

/** Optional server-owned signer for configured metric and claims/report audits. */
export function createConfiguredVerificationAuditSigner(environment: Readonly<Record<string, string | undefined>>) {
  const keyId = environment.VERIFICATION_AUDIT_SIGNING_KEY_ID?.trim();
  const privateKey = environment.VERIFICATION_AUDIT_SIGNING_PRIVATE_KEY_PEM?.trim();
  if (!keyId && !privateKey) return undefined;
  if (!keyId || !privateKey) throw new Error("VERIFICATION_AUDIT_SIGNING_CONFIGURATION_INCOMPLETE");
  if (keyId.length > 160 || privateKey.length > 16_384) throw new Error("VERIFICATION_AUDIT_SIGNING_CONFIGURATION_TOO_LARGE");
  try { return createEd25519Signer(privateKey, keyId); }
  catch { throw new Error("VERIFICATION_AUDIT_SIGNING_KEY_INVALID"); }
}
