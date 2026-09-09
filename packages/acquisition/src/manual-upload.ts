import { isAbsolute, normalize, posix } from "node:path";
import { sha256Digest } from "@aiengineer/knowledge-domain";
import { digestBytes, type ArtifactStore } from "@aiengineer/knowledge-runtime";
import type { AcquisitionAdapter, AcquisitionPlan, AcquisitionRequest, AcquisitionResult, AcquisitionVerification, AdmittedAcquisitionPlan, ManualUploadAttestation, SupportDecision } from "./types.js";

export interface ManualUploadRecord { uploadId: string; relativePath: string; mediaType: string; bytes: Uint8Array; declaredDigest?: string; attestation: ManualUploadAttestation }
export interface ManualUploadSource { get(uploadId: string): Promise<ManualUploadRecord | undefined> }
export interface ManualUploadPolicy { maximumBytes: number; maximumPathLength: number; allowedMediaTypes?: readonly string[] }

export function normalizeUploadPath(path: string, maximumLength: number): string {
  if (!path || path.length > maximumLength || path.includes("\0") || isAbsolute(path) || /^[a-zA-Z]:/.test(path)) throw new Error("UPLOAD_PATH_DENIED");
  const portable = path.replaceAll("\\", "/"); const canonical = posix.normalize(portable);
  if (canonical === ".." || canonical.startsWith("../") || portable.split("/").includes("..") || normalize(path).startsWith(`..${posix.sep}`)) throw new Error("UPLOAD_PATH_TRAVERSAL");
  return canonical;
}

export class BoundedManualUploadAdapter implements AcquisitionAdapter {
  readonly adapterKey = "manual-upload"; readonly version = "1.0.0";
  constructor(private readonly artifacts: ArtifactStore, private readonly source: ManualUploadSource, private readonly policy: ManualUploadPolicy) {}
  supports(request: AcquisitionRequest): SupportDecision { return request.target.kind === "upload" ? { supported: true, reason: "bounded manual upload" } : { supported: false, reason: "upload target required" }; }
  async plan(request: AcquisitionRequest): Promise<AcquisitionPlan> { if (request.target.kind !== "upload") throw new Error("UNSUPPORTED_TARGET"); if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(request.target.uploadId)) throw new Error("UPLOAD_ID_INVALID"); return { adapterKey: this.adapterKey, adapterVersion: this.version, request, normalizedTarget: `upload:${request.target.uploadId}`, policyDigest: sha256Digest({ maximumBytes: this.policy.maximumBytes, maximumPathLength: this.policy.maximumPathLength, allowedMediaTypes: [...(this.policy.allowedMediaTypes ?? [])] }) }; }
  async execute(plan: AdmittedAcquisitionPlan): Promise<AcquisitionResult> {
    if (plan.request.target.kind !== "upload") throw new Error("UNSUPPORTED_TARGET"); const record = await this.source.get(plan.request.target.uploadId);
    if (!record || record.uploadId !== plan.request.target.uploadId) throw new Error("UPLOAD_NOT_FOUND"); const path = normalizeUploadPath(record.relativePath, this.policy.maximumPathLength);
    if (record.bytes.byteLength > Math.min(plan.request.maximumBytes, this.policy.maximumBytes)) throw new Error("BYTE_LIMIT_EXCEEDED");
    if (this.policy.allowedMediaTypes && !this.policy.allowedMediaTypes.includes(record.mediaType)) throw new Error("MEDIA_TYPE_DENIED"); const digest = digestBytes(record.bytes);
    if (record.declaredDigest && record.declaredDigest !== digest) throw new Error("UPLOAD_DIGEST_MISMATCH"); const attestation = await this.verifyAttestation(record.attestation);
    if (!attestation.accepted || record.attestation.uploadId !== record.uploadId || record.attestation.origin !== plan.request.target.declaredOrigin) throw new Error("UPLOAD_ATTESTATION_INVALID");
    const artifact = await this.artifacts.put({ tenantId: plan.request.tenantId, mediaType: record.mediaType, bytes: record.bytes });
    return { plan, artifacts: [artifact], contentDigests: [artifact.digest], observations: [{ key: "path", value: path }, { key: "origin", value: record.attestation.origin }, { key: "acquired_at", value: record.attestation.acquiredAt }], discoveredCanonicalIdentifiers: [plan.normalizedTarget], captureMethod: `${this.adapterKey}@${this.version}`, retryAdvice: "none", costMicros: 0, errors: [] };
  }
  async verify(result: AcquisitionResult): Promise<AcquisitionVerification> { const findings = result.artifacts.length === 1 && result.artifacts[0]?.digest === result.contentDigests[0] ? [] : ["artifact_digest_mismatch"]; return { accepted: findings.length === 0, checks: ["bounded_content", "safe_relative_path", "attestation", "digest"], findings }; }
  async verifyAttestation(value: ManualUploadAttestation): Promise<AcquisitionVerification> { const findings: string[] = []; if (!value.uploadId || !value.origin || !value.method || !value.accessAndRightsContext) findings.push("attestation_incomplete"); if (!Number.isFinite(Date.parse(value.acquiredAt))) findings.push("acquired_at_invalid"); if (value.automaticFailureReason) findings.push("automatic_failure_reported"); return { accepted: findings.length === 0, checks: ["origin", "method", "rights_context", "timestamp"], findings }; }
}
