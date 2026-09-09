import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import {
  VerificationBundleSchema,
  VerificationArtifactHandleSchema,
  VerificationRunManifestSchema,
  type VerificationRunManifest,
} from "@aiengineer/knowledge-contracts";
import { canonicalizeJson, digestCanonicalJson, sha256Digest } from "../deterministic/index.js";
import type {
  AuditBundleInspection,
  AuditBundleSignatureVerifier,
  AuditBundleSigner,
  DetachedAuditSeal,
  VerificationAuditBundle,
  VerificationPolicyBinding,
} from "./model.js";
import { validateRecordedPolicyInputsArtifact } from "./policy-inputs.js";

const normalizeFieldName = (value: string) => value.replace(/[^a-z0-9]/gi, "").toLowerCase();
const privateFieldNames = new Set([
  "secret", "password", "apikey", "authorization", "cookie", "setcookie",
  "credential", "credentials", "accesstoken", "refreshtoken", "bearertoken",
  "privatereasoning", "chainofthought", "hiddenreasoning",
]);
const publicTokenDiagnosticNames = new Set([
  "inputtokens", "outputtokens", "prompttokens", "completiontokens", "totaltokens",
  "cachedinputtokens", "reasoningtokens", "tokencount", "tokenusage",
]);

function isPrivateFieldName(key: string): boolean {
  const normalized = normalizeFieldName(key);
  if (publicTokenDiagnosticNames.has(normalized)) return false;
  return privateFieldNames.has(normalized)
    || normalized.endsWith("secret")
    || normalized.endsWith("password")
    || normalized.endsWith("credential")
    || normalized.endsWith("credentials")
    || normalized.endsWith("apikey")
    || normalized.endsWith("token")
    || normalized.endsWith("privatereasoning")
    || normalized.endsWith("chainofthought")
    || normalized.endsWith("hiddenreasoning");
}

function assertPublicValue(value: unknown, path = "$", seen = new Set<object>()): void {
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) throw new Error(`PUBLIC_MANIFEST_CYCLE:${path}`);
  seen.add(value);
  if (Array.isArray(value)) value.forEach((item, index) => assertPublicValue(item, `${path}[${index}]`, seen));
  else for (const [key, item] of Object.entries(value)) {
    if (isPrivateFieldName(key)) throw new Error(`PUBLIC_MANIFEST_PRIVATE_FIELD:${path}.${key}`);
    assertPublicValue(item, `${path}.${key}`, seen);
  }
  seen.delete(value);
}

/**
 * The manifest digest and detached signature reference this projection. The
 * projection deliberately excludes both fields, preventing a circular digest.
 */
export function verificationManifestSignablePayload(manifest: VerificationRunManifest): unknown {
  const { signatureArtifactId: _signatureArtifactId, canonicalization, ...body } = manifest;
  const { manifestDigest: _manifestDigest, ...canonicalizationDescriptor } = canonicalization;
  return { ...body, canonicalization: canonicalizationDescriptor };
}

export function verificationManifestDigest(manifest: VerificationRunManifest): `sha256:${string}` {
  return digestCanonicalJson(verificationManifestSignablePayload(manifest));
}

export function auditBundleSignablePayload(bundle: Omit<VerificationAuditBundle, "seal"> | VerificationAuditBundle): unknown {
  const { seal: _seal, ...payload } = bundle as VerificationAuditBundle;
  return payload;
}

function assertLineage(bundle: VerificationAuditBundle): void {
  const handles = [
    ...bundle.manifest.inputArtifacts,
    ...bundle.manifest.outputArtifacts,
    bundle.policyBinding.policyArtifact,
    bundle.policyBinding.recordedPolicyInputsArtifact,
    ...bundle.verificationBundle.captures.flatMap((capture) => [capture.contentArtifact, ...(capture.canonicalProjectionArtifact ? [capture.canonicalProjectionArtifact] : [])]),
  ];
  const byId = new Map<string, typeof handles[number]>();
  for (const handle of handles) {
    const existing = byId.get(handle.artifactId);
    if (existing && digestCanonicalJson(existing) !== digestCanonicalJson(handle)) throw new Error("ARTIFACT_IDENTITY_COLLISION");
    byId.set(handle.artifactId, handle);
    if (handle.tenantId !== bundle.tenantId) throw new Error(`ARTIFACT_TENANT_MISMATCH:${handle.artifactId}`);
  }
  for (const handle of handles) {
    for (const parentId of handle.parentArtifactIds) {
      if (!byId.has(parentId)) throw new Error(`LINEAGE_PARENT_MISSING:${handle.artifactId}:${parentId}`);
      if (!handle.transformationSignature) throw new Error(`LINEAGE_TRANSFORMATION_SIGNATURE_MISSING:${handle.artifactId}`);
      if (!bundle.manifest.lineage.some((edge) => edge.fromArtifactId === handle.artifactId && edge.toArtifactId === parentId
        && ["derived_from","generated","quoted_from"].includes(edge.relation))) {
        throw new Error(`LINEAGE_EDGE_MISSING:${handle.artifactId}:${parentId}`);
      }
    }
  }
  for (const edge of bundle.manifest.lineage) {
    if (!byId.has(edge.fromArtifactId) || !byId.has(edge.toArtifactId)) throw new Error(`LINEAGE_ENDPOINT_MISSING:${edge.edgeId}`);
    if (["derived_from","generated","quoted_from"].includes(edge.relation)
      && !byId.get(edge.fromArtifactId)!.parentArtifactIds.includes(edge.toArtifactId)) {
      throw new Error(`LINEAGE_PARENT_DECLARATION_MISSING:${edge.edgeId}`);
    }
  }
  const children = new Map<string, string[]>();
  for (const handle of handles) for (const parentId of handle.parentArtifactIds) {
    children.set(handle.artifactId, [...(children.get(handle.artifactId) ?? []), parentId]);
  }
  for (const edge of bundle.manifest.lineage) children.set(edge.fromArtifactId, [...(children.get(edge.fromArtifactId) ?? []), edge.toArtifactId]);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error("LINEAGE_CYCLE");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const child of children.get(id) ?? []) visit(child);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of byId.keys()) visit(id);
}

function assertExactKeys(value: object, expected: readonly string[], code: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) throw new Error(code);
}

function assertAuditEnvelope(bundle: VerificationAuditBundle): void {
  assertExactKeys(bundle, ["verificationContractVersion","tenantId","verificationBundle","manifest","policyBinding","deterministicResultDigest","policyDecisionDigest","seal"], "AUDIT_BUNDLE_FIELDS_INVALID");
  assertExactKeys(bundle.policyBinding, ["policyVersion","policyArtifact","recordedPolicyInputsArtifact"], "POLICY_BINDING_FIELDS_INVALID");
  const sealKeys = ["payloadDigest", ...(bundle.seal.signatureAlgorithm === undefined ? [] : ["signatureAlgorithm"]), ...(bundle.seal.keyId === undefined ? [] : ["keyId"]), ...(bundle.seal.signatureBase64 === undefined ? [] : ["signatureBase64"])];
  assertExactKeys(bundle.seal, sealKeys, "AUDIT_SEAL_FIELDS_INVALID");
  if (bundle.verificationContractVersion !== "verification.v1") throw new Error("AUDIT_BUNDLE_VERSION_INVALID");
  if (!/^sha256:[a-f0-9]{64}$/.test(bundle.deterministicResultDigest) || !/^sha256:[a-f0-9]{64}$/.test(bundle.policyDecisionDigest) || !/^sha256:[a-f0-9]{64}$/.test(bundle.seal.payloadDigest)) throw new Error("AUDIT_BUNDLE_DIGEST_INVALID");
  if (bundle.verificationBundle.policyVersion !== bundle.policyBinding.policyVersion || bundle.manifest.versions.policy !== bundle.policyBinding.policyVersion) throw new Error("POLICY_VERSION_BINDING_MISMATCH");
  if (![...bundle.manifest.inputArtifacts, ...bundle.manifest.outputArtifacts].some((artifact) => digestCanonicalJson(artifact) === digestCanonicalJson(bundle.policyBinding.policyArtifact))) throw new Error("POLICY_ARTIFACT_NOT_IN_MANIFEST");
  if (![...bundle.manifest.inputArtifacts, ...bundle.manifest.outputArtifacts].some((artifact) => digestCanonicalJson(artifact) === digestCanonicalJson(bundle.policyBinding.recordedPolicyInputsArtifact))) throw new Error("POLICY_INPUTS_ARTIFACT_NOT_IN_MANIFEST");
  if (bundle.policyBinding.policyArtifact.artifactId === bundle.policyBinding.recordedPolicyInputsArtifact.artifactId) throw new Error("POLICY_ARTIFACT_ROLES_NOT_DISTINCT");
}

export async function sealAuditBundle(input: {
  readonly tenantId: string;
  readonly verificationBundle: unknown;
  readonly manifest: unknown;
  readonly policyBinding: VerificationPolicyBinding;
  readonly recordedPolicyInputsBytes: Uint8Array;
  readonly policyDecision: unknown;
  readonly signer?: AuditBundleSigner;
}): Promise<VerificationAuditBundle> {
  const verificationBundle = VerificationBundleSchema.parse(input.verificationBundle);
  const manifest = VerificationRunManifestSchema.parse(input.manifest);
  const policyBinding = {
    policyVersion: String(input.policyBinding.policyVersion),
    policyArtifact: VerificationArtifactHandleSchema.parse(input.policyBinding.policyArtifact),
    recordedPolicyInputsArtifact: VerificationArtifactHandleSchema.parse(input.policyBinding.recordedPolicyInputsArtifact),
  };
  assertExactKeys(input.policyBinding, ["policyVersion","policyArtifact","recordedPolicyInputsArtifact"], "POLICY_BINDING_FIELDS_INVALID");
  if (verificationBundle.policyVersion !== policyBinding.policyVersion || manifest.versions.policy !== policyBinding.policyVersion) {
    throw new Error("POLICY_VERSION_BINDING_MISMATCH");
  }
  if (![...manifest.inputArtifacts, ...manifest.outputArtifacts].some((artifact) => digestCanonicalJson(artifact) === digestCanonicalJson(policyBinding.policyArtifact))) {
    throw new Error("POLICY_ARTIFACT_NOT_IN_MANIFEST");
  }
  if (![...manifest.inputArtifacts, ...manifest.outputArtifacts].some((artifact) => digestCanonicalJson(artifact) === digestCanonicalJson(policyBinding.recordedPolicyInputsArtifact))) {
    throw new Error("POLICY_INPUTS_ARTIFACT_NOT_IN_MANIFEST");
  }
  if (policyBinding.policyArtifact.artifactId === policyBinding.recordedPolicyInputsArtifact.artifactId) throw new Error("POLICY_ARTIFACT_ROLES_NOT_DISTINCT");
  if (verificationManifestDigest(manifest) !== manifest.canonicalization.manifestDigest) throw new Error("MANIFEST_DIGEST_MISMATCH");
  validateRecordedPolicyInputsArtifact({
    handle: policyBinding.recordedPolicyInputsArtifact,
    bytes: input.recordedPolicyInputsBytes,
    bundle: verificationBundle,
    deterministicResult: manifest.deterministicResult,
    runId: manifest.runId,
    policyVersion: policyBinding.policyVersion,
  });
  const deterministicResultDigest = digestCanonicalJson(manifest.deterministicResult);
  const policyDecisionDigest = digestCanonicalJson(input.policyDecision);
  const unsigned = {
    verificationContractVersion: "verification.v1" as const,
    tenantId: input.tenantId,
    verificationBundle,
    manifest,
    policyBinding,
    deterministicResultDigest,
    policyDecisionDigest,
  };
  if (verificationBundle.captures.some((capture) => capture.contentArtifact.tenantId !== input.tenantId
    || (capture.canonicalProjectionArtifact !== undefined && capture.canonicalProjectionArtifact.tenantId !== input.tenantId))) {
    throw new Error("CAPTURE_ARTIFACT_TENANT_MISMATCH");
  }
  assertPublicValue(unsigned);
  const candidate = { ...unsigned, seal: { payloadDigest: "sha256:" + "0".repeat(64) } as DetachedAuditSeal };
  assertLineage(candidate);
  const payload = new TextEncoder().encode(canonicalizeJson(auditBundleSignablePayload(unsigned as VerificationAuditBundle)));
  const payloadDigest = sha256Digest(payload);
  const seal: DetachedAuditSeal = input.signer ? {
    payloadDigest,
    signatureAlgorithm: input.signer.algorithm,
    keyId: input.signer.keyId,
    signatureBase64: await input.signer.sign(payload),
  } : { payloadDigest };
  return { ...unsigned, seal };
}

export async function inspectAuditBundle(bundle: VerificationAuditBundle, verifier?: AuditBundleSignatureVerifier): Promise<AuditBundleInspection> {
  const errors: string[] = [];
  let manifestDigest: `sha256:${string}` = "sha256:" + "0".repeat(64) as `sha256:${string}`;
  let payloadDigest: `sha256:${string}` = "sha256:" + "0".repeat(64) as `sha256:${string}`;
  try {
    assertAuditEnvelope(bundle);
    VerificationBundleSchema.parse(bundle.verificationBundle);
    VerificationRunManifestSchema.parse(bundle.manifest);
    assertPublicValue(auditBundleSignablePayload(bundle));
    assertLineage(bundle);
    manifestDigest = verificationManifestDigest(bundle.manifest);
    if (manifestDigest !== bundle.manifest.canonicalization.manifestDigest) errors.push("MANIFEST_DIGEST_MISMATCH");
    if (digestCanonicalJson(bundle.manifest.deterministicResult) !== bundle.deterministicResultDigest) errors.push("DETERMINISTIC_RESULT_DIGEST_MISMATCH");
    const payload = new TextEncoder().encode(canonicalizeJson(auditBundleSignablePayload(bundle)));
    payloadDigest = sha256Digest(payload);
    if (payloadDigest !== bundle.seal.payloadDigest) errors.push("AUDIT_BUNDLE_DIGEST_MISMATCH");
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "INVALID_AUDIT_BUNDLE");
  }
  let signatureStatus: AuditBundleInspection["signatureStatus"] = "unsigned";
  try {
    const seal = bundle !== null && typeof bundle === "object" && bundle.seal !== null && typeof bundle.seal === "object"
      ? bundle.seal
      : undefined;
    if (!seal) {
      signatureStatus = "invalid";
      if (!errors.includes("AUDIT_SEAL_FIELDS_INVALID")) errors.push("AUDIT_SEAL_FIELDS_INVALID");
    } else {
      const signed = seal.signatureAlgorithm === "Ed25519" && seal.keyId && seal.signatureBase64;
      if (signed) {
        if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(seal.signatureBase64!) || Buffer.from(seal.signatureBase64!, "base64").byteLength !== 64) {
          signatureStatus = "invalid";
          errors.push("AUDIT_BUNDLE_SIGNATURE_INVALID");
        } else if (!verifier) signatureStatus = "unverified";
        else {
          const payload = new TextEncoder().encode(canonicalizeJson(auditBundleSignablePayload(bundle)));
          try {
            signatureStatus = await verifier.verify({ keyId: seal.keyId!, payload, signatureBase64: seal.signatureBase64! }) ? "verified" : "invalid";
          } catch {
            signatureStatus = "invalid";
          }
          if (signatureStatus === "invalid") errors.push("AUDIT_BUNDLE_SIGNATURE_INVALID");
        }
      } else if (seal.signatureAlgorithm || seal.keyId || seal.signatureBase64) {
        signatureStatus = "invalid";
        errors.push("AUDIT_BUNDLE_SIGNATURE_INCOMPLETE");
      }
    }
  } catch {
    signatureStatus = "invalid";
    errors.push("AUDIT_BUNDLE_SIGNATURE_INVALID");
  }
  return { valid: errors.length === 0, payloadDigest, manifestDigest, signatureStatus, errors };
}

export function createEd25519Signer(privateKeyPem: string, keyId: string): AuditBundleSigner {
  const key = createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== "ed25519") throw new Error("ED25519_PRIVATE_KEY_REQUIRED");
  return { algorithm: "Ed25519", keyId, async sign(payload) { return sign(null, payload, key).toString("base64"); } };
}

export function createEd25519Verifier(publicKeys: Readonly<Record<string, string>>): AuditBundleSignatureVerifier {
  const keys = new Map(Object.entries(publicKeys).map(([id, pem]) => [id, createPublicKey(pem)]));
  return { async verify(input) {
    const key = keys.get(input.keyId);
    return key?.asymmetricKeyType === "ed25519" && verify(null, input.payload, key, Buffer.from(input.signatureBase64, "base64"));
  } };
}
