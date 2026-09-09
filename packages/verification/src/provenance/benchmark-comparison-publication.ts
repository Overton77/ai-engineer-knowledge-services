import {VerificationBenchmarkComparisonPublicationSchema,type VerificationBenchmarkComparisonPublication} from "@aiengineer/knowledge-contracts";
import {deepFreeze} from "@aiengineer/knowledge-domain";
import {canonicalizeJson,digestCanonicalJson} from "../deterministic/index.js";
import type {AuditBundleSigner,AuditBundleSignatureVerifier} from "./model.js";

type Body=Omit<VerificationBenchmarkComparisonPublication,"seal">;
function signable(manifest:VerificationBenchmarkComparisonPublication):Body{const {seal:_seal,...body}=manifest;return body;}
export async function sealVerificationBenchmarkComparisonPublication(body:Body,signer:AuditBundleSigner):Promise<VerificationBenchmarkComparisonPublication>{
  const parsed=VerificationBenchmarkComparisonPublicationSchema.parse({...body,seal:{payloadDigest:`sha256:${"0".repeat(64)}`}});
  const payload=deepFreeze(signable(parsed)),bytes=new TextEncoder().encode(canonicalizeJson(payload));
  const seal={payloadDigest:digestCanonicalJson(payload),signature:{algorithm:signer.algorithm,keyId:signer.keyId,signatureBase64:await signer.sign(bytes)}};
  return deepFreeze(VerificationBenchmarkComparisonPublicationSchema.parse({...payload,seal}));
}
export async function verifyVerificationBenchmarkComparisonPublication(value:unknown,verifier:AuditBundleSignatureVerifier):Promise<{readonly manifest:VerificationBenchmarkComparisonPublication;readonly signatureStatus:"verified"}>{
  const manifest=deepFreeze(VerificationBenchmarkComparisonPublicationSchema.parse(value)),payload=signable(manifest);
  if(digestCanonicalJson(payload)!==manifest.seal.payloadDigest)throw new Error("BENCHMARK_COMPARISON_PUBLICATION_DIGEST_MISMATCH");
  const signature=manifest.seal.signature;if(!signature)throw new Error("BENCHMARK_COMPARISON_PUBLICATION_SIGNATURE_REQUIRED");
  if(Buffer.from(signature.signatureBase64,"base64").toString("base64")!==signature.signatureBase64||!await verifier.verify({keyId:signature.keyId,payload:new TextEncoder().encode(canonicalizeJson(payload)),signatureBase64:signature.signatureBase64}))throw new Error("BENCHMARK_COMPARISON_PUBLICATION_SIGNATURE_INVALID");
  return deepFreeze({manifest,signatureStatus:"verified" as const});
}
