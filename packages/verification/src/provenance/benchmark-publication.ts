import { VerificationBenchmarkPublicationManifestSchema, type VerificationBenchmarkPublicationManifest } from "@aiengineer/knowledge-contracts";
import { deepFreeze } from "@aiengineer/knowledge-domain";
import { canonicalizeJson, digestCanonicalJson } from "../deterministic/index.js";
import type { AuditBundleSigner, AuditBundleSignatureVerifier } from "./model.js";

type Body = Omit<VerificationBenchmarkPublicationManifest, "seal">;

/** Signature and payload digest both exclude the detached seal. */
function signable(manifest: VerificationBenchmarkPublicationManifest): Body {
  const { seal: _seal, ...body } = manifest;
  return body;
}

export async function sealVerificationBenchmarkPublication(body: Body, signer?: AuditBundleSigner): Promise<VerificationBenchmarkPublicationManifest> {
  // Parsing snapshots all caller-owned objects before an asynchronous signer.
  const parsed = VerificationBenchmarkPublicationManifestSchema.parse({ ...body, seal: { payloadDigest: `sha256:${"0".repeat(64)}` } });
  const payload = signable(parsed), bytes = new TextEncoder().encode(canonicalizeJson(payload));
  const seal: VerificationBenchmarkPublicationManifest["seal"] = { payloadDigest: digestCanonicalJson(payload) };
  if (signer) seal.signature = { algorithm: signer.algorithm, keyId: signer.keyId, signatureBase64: await signer.sign(bytes) };
  return deepFreeze(VerificationBenchmarkPublicationManifestSchema.parse({ ...payload, seal }));
}

/** Digest integrity does not imply source quality or a trusted signing identity. */
export async function verifyVerificationBenchmarkPublication(value: unknown, options: { readonly verifier?: AuditBundleSignatureVerifier; readonly requireSignature?: boolean } = {}): Promise<{
  readonly manifest: VerificationBenchmarkPublicationManifest;
  readonly signatureStatus: "unsigned" | "verified";
}> {
  const manifest = VerificationBenchmarkPublicationManifestSchema.parse(value), payload = signable(manifest);
  if (digestCanonicalJson(payload) !== manifest.seal.payloadDigest) throw new Error("BENCHMARK_PUBLICATION_DIGEST_MISMATCH");
  const signature = manifest.seal.signature;
  if (!signature) {
    if (options.requireSignature) throw new Error("BENCHMARK_PUBLICATION_SIGNATURE_REQUIRED");
    return deepFreeze({ manifest, signatureStatus: "unsigned" as const });
  }
  if (!options.verifier) throw new Error("BENCHMARK_PUBLICATION_SIGNATURE_VERIFIER_REQUIRED");
  if (Buffer.from(signature.signatureBase64, "base64").toString("base64") !== signature.signatureBase64
    || !await options.verifier.verify({ keyId: signature.keyId, payload: new TextEncoder().encode(canonicalizeJson(payload)), signatureBase64: signature.signatureBase64 })) {
    throw new Error("BENCHMARK_PUBLICATION_SIGNATURE_INVALID");
  }
  return deepFreeze({ manifest, signatureStatus: "verified" as const });
}
