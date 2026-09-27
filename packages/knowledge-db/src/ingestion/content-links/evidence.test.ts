import { describe, expect, it, vi } from "vitest";
import { sha256Digest } from "@aiengineer/knowledge-domain";
import type { TenantSqlClient } from "@aiengineer/knowledge-persistence";
import type { AuthoritativeClaim } from "../evidence-admission.js";
import { authenticateCanonicalContentEvidence, contentEvidenceAssessmentDigest, type SealedContentClaim } from "./evidence.js";
import type { ContentLinkEvidenceReference } from "./types.js";

const id = (value: number): string => `00000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;
const digest = (value: string): string => sha256Digest(value);
type Row = Record<string, unknown>;

function fixture() {
  const tenantId = id(1), policyDigest = digest("policy"), text = "🧪 Cafe\u0301 is preview only.";
  const edge: NonNullable<AuthoritativeClaim["provenance"]>["evidence"][number] = {
    source: { sourceId: "source", kind: "web_page", canonicalUri: "https://synthetic.invalid/source", logicalIdentity: "source" },
    capture: { captureId: "capture", capturedAt: "2026-09-14T00:00:00.000Z", captureMethod: "https_get", captureMethodVersion: "v1", artifactId: id(10), digest: digest(text), mediaType: "text/plain", byteLength: new TextEncoder().encode(text).byteLength },
    fragmentId: "fragment", representationArtifactId: id(11), selector: { kind: "text_quote", exact: text }, selectedContentDigest: digest(text), selectedSizeBytes: new TextEncoder().encode(text).byteLength,
    occurrenceCount: 1, selectorDigest: digest("selector"), normalization: "exact", resolverVersion: "selector.v1", role: "supports", authority: { authority: "primary" }, parserLineageArtifactIds: [],
  };
  const claim: AuthoritativeClaim = { statement: text, claimType: "capability", qualifiers: ["preview only"], value: "preview", entityBindings: [{ role: "subject", canonicalId: id(12) }], verdict: "directly_supported", manifestDigest: digest("manifest"), policyVersion: "policy.v1", downstreamUse: ["knowledge_ingestion:claim.materialize"],
    provenance: { tenantId, auditArtifactId: id(13), policyArtifactId: id(14), policyDigest, decisionArtifactId: id(15), decisionDigest: digest("decision"), outcome: "pass",
      run: { runId: id(2), producerAttemptId: id(16), producerDeploymentId: "producer", verifierAttemptId: id(17), verifierDeploymentId: "verifier", bundleArtifactId: id(18), resultArtifactId: id(19), auditDigest: digest("audit"), startedAt: "2026-09-14T00:00:00.000Z", completedAt: "2026-09-14T00:00:01.000Z" },
      assessment: { properties: { qualifiersPreserved: true }, supportingFragmentIds: ["fragment"], contradictingFragmentIds: [], unsupportedFacets: [], reasonCodes: ["DIRECT_SUPPORT"], inputsDigest: digest("inputs"), outputSchemaDigest: digest("output") }, evidence: [edge] } };
  const provenance = claim.provenance!;
  const rows: Record<string, Row> = {
    claim: { id: id(3), tenant_id: tenantId, producer_attempt_id: provenance.run.producerAttemptId, claim_type: claim.claimType, statement: text, status: "verified", structured: { verification: { runId: id(2), claimId: "capability", manifestDigest: claim.manifestDigest, qualifiers: claim.qualifiers, value: claim.value, admission: structuredClone(provenance) } } },
    link: { id: id(4), tenant_id: tenantId, claim_id: id(3), locator_id: id(6), role: "supports", authority_assessment: structuredClone(edge.authority) },
    assessment: { id: id(5), tenant_id: tenantId, claim_evidence_link_id: id(4), run_id: id(2), verdict: claim.verdict, replay_signature_match: true, authority_assessment: structuredClone(edge.authority), properties: structuredClone(provenance.assessment.properties), public_rationale: "DIRECT_SUPPORT" },
    locator: { id: id(6), tenant_id: tenantId, capture_id: id(7), resolution_state: "resolved", representation_artifact_id: edge.representationArtifactId, selected_content_sha256: edge.selectedContentDigest.slice(7), selector_sha256: edge.selectorDigest.slice(7), selector: structuredClone(edge.selector), selected_size_bytes: edge.selectedSizeBytes, occurrence_count: 1, normalization_policy: edge.normalization, resolution_version: edge.resolverVersion, media_type: edge.capture.mediaType, extraction_params: { representationArtifactId: edge.representationArtifactId, parserLineageArtifactIds: [] } },
    capture: { id: id(7), tenant_id: tenantId, source_id: id(8), artifact_id: edge.capture.artifactId, content_sha256: edge.capture.digest.slice(7), captured_at: edge.capture.capturedAt, capture_method: "http", capture_method_version: "v1", media_type: "text/plain", request_url: edge.source.canonicalUri, context: { captureMethod: "https_get" } },
    source: { id: id(8), tenant_id: tenantId, canonical_url: edge.source.canonicalUri, source_class: "web_page" },
    run: { id: id(2), tenant_id: tenantId, run_manifest_artifact_id: provenance.auditArtifactId, manifest_sha256: provenance.run.auditDigest.slice(7), policy_artifact_sha256: policyDigest.slice(7), policy_artifact_id: provenance.policyArtifactId, status: "succeeded", producer_attempt_id: provenance.run.producerAttemptId, verifier_attempt_id: provenance.run.verifierAttemptId, bundle_artifact_id: provenance.run.bundleArtifactId, deterministic_result_artifact_id: provenance.run.resultArtifactId, policy_version: claim.policyVersion, started_at: provenance.run.startedAt, ended_at: provenance.run.completedAt },
  };
  const reference: ContentLinkEvidenceReference = { claimId: id(3), claimKey: "capability", claimDigest: digest("assertion"), runId: id(2), manifest: { id: id(13), digest: provenance.run.auditDigest }, assessment: { id: id(5), digest: "" }, locatorId: id(6), captureId: id(7), role: "supports" };
  reference.assessment.digest = contentEvidenceAssessmentDigest({ tenantId, assessmentId: reference.assessment.id, claimId: reference.claimId, runId: reference.runId, locatorId: reference.locatorId, captureId: reference.captureId, role: reference.role, verdict: String(rows.assessment!.verdict), authority: rows.assessment!.authority_assessment, replaySignatureMatch: true, properties: rows.assessment!.properties, publicRationale: "DIRECT_SUPPORT" });
  const query = vi.fn(async () => ({ rows: [rows] }));
  const sealed: SealedContentClaim = { claim, assertionDigest: reference.claimDigest, selectedText: new Map([[edge.fragmentId, text]]) };
  const loadClaim = vi.fn(async () => sealed);
  const context = { client: { query } as unknown as TenantSqlClient, tenantId, policyDigest, reference, loadClaim };
  return { context, rows, sealed, query, loadClaim, edge };
}

type Fixture = ReturnType<typeof fixture>;
const stored = (f: Fixture): Row => (f.rows.claim!.structured as { verification: Row }).verification;
const authenticate = (f: Fixture) => authenticateCanonicalContentEvidence(f.context);

describe("offline canonical content evidence reconciliation", () => {
  it("preserves exact Unicode selected bytes, qualification and authenticated bindings", async () => {
    const f = fixture();
    await expect(authenticate(f)).resolves.toMatchObject({ eligible: true, statement: f.sealed.claim.statement, value: "preview", selectedText: f.sealed.claim.statement, selectedContentDigest: digest(f.sealed.claim.statement), qualifiers: ["preview only"], entityBindings: f.sealed.claim.entityBindings, policyDigest: f.context.policyDigest });
    expect(f.loadClaim).toHaveBeenCalledWith({ runId: id(2), claimKey: "capability", manifestDigest: digest("manifest") });
    const [sql, parameters] = f.query.mock.calls[0] as unknown as [string, unknown[]];
    expect(parameters).toEqual([id(1), id(3), id(5), id(2), id(6), id(7), "supports"]);
    for (const join of ["l.tenant_id=c.tenant_id", "a.tenant_id=l.tenant_id", "loc.tenant_id=l.tenant_id", "cap.tenant_id=loc.tenant_id", "r.tenant_id=a.tenant_id", "src.tenant_id=cap.tenant_id", "src.id=cap.source_id"]) expect(sql).toContain(join);
  });
  it("rejects absent canonical joins before consulting sealed authority", async () => {
    const f = fixture(); f.query.mockResolvedValue({ rows: [] });
    await expect(authenticate(f)).rejects.toMatchObject({ code: "CONTENT_CANONICAL_EVIDENCE_MISSING" });
    expect(f.loadClaim).not.toHaveBeenCalled();
  });
  it.each([
    ["unresolved locator", (f: Fixture) => { f.rows.locator!.resolution_state = "ambiguous"; }, "CONTENT_CANONICAL_EVIDENCE_MISSING"],
    ["missing stored admission", (f: Fixture) => { delete stored(f).manifestDigest; }, "CONTENT_CLAIM_ADMISSION_MISSING"],
    ["claim statement", (f: Fixture) => { f.rows.claim!.statement = "Changed"; }, "CONTENT_CLAIM_ADMISSION_MISMATCH"],
    ["claim type", (f: Fixture) => { f.rows.claim!.claim_type = "measurement"; }, "CONTENT_CLAIM_ADMISSION_MISMATCH"],
    ["claim producer", (f: Fixture) => { f.rows.claim!.producer_attempt_id = id(99); }, "CONTENT_CLAIM_ADMISSION_MISMATCH"],
    ["claim digest", (f: Fixture) => { f.context.reference.claimDigest = digest("wrong"); }, "CONTENT_CLAIM_ADMISSION_MISMATCH"],
    ["claim key", (f: Fixture) => { stored(f).claimId = "different"; }, "CONTENT_CLAIM_ADMISSION_MISMATCH"],
    ["claim run", (f: Fixture) => { stored(f).runId = id(99); }, "CONTENT_CLAIM_ADMISSION_MISMATCH"],
    ["qualifier drop", (f: Fixture) => { stored(f).qualifiers = []; }, "CONTENT_CLAIM_ADMISSION_MISMATCH"],
    ["value", (f: Fixture) => { stored(f).value = "unlimited"; }, "CONTENT_CLAIM_ADMISSION_MISMATCH"],
    ["stored provenance", (f: Fixture) => { stored(f).admission = {}; }, "CONTENT_CLAIM_ADMISSION_MISMATCH"],
    ["tenant authority", (f: Fixture) => { f.context.tenantId = id(99); }, "CONTENT_CLAIM_ADMISSION_MISMATCH"],
    ["policy pin", (f: Fixture) => { f.context.policyDigest = digest("other policy"); }, "CONTENT_CLAIM_ADMISSION_MISMATCH"],
    ["retracted claim", (f: Fixture) => { f.rows.claim!.status = "retracted"; }, "CONTENT_CLAIM_ADMISSION_MISMATCH"],
    ["manifest artifact", (f: Fixture) => { f.context.reference.manifest.id = id(99); }, "CONTENT_RUN_BINDING_MISMATCH"],
    ["manifest digest", (f: Fixture) => { f.context.reference.manifest.digest = digest("other"); }, "CONTENT_RUN_BINDING_MISMATCH"],
    ["run manifest", (f: Fixture) => { f.rows.run!.run_manifest_artifact_id = id(99); }, "CONTENT_RUN_BINDING_MISMATCH"],
    ["run status", (f: Fixture) => { f.rows.run!.status = "failed"; }, "CONTENT_RUN_BINDING_MISMATCH"],
    ["capture bytes", (f: Fixture) => { f.rows.capture!.content_sha256 = digest("other").slice(7); }, "CONTENT_LOCATOR_BINDING_MISMATCH"],
    ["capture artifact", (f: Fixture) => { f.rows.capture!.artifact_id = id(99); }, "CONTENT_LOCATOR_BINDING_MISMATCH"],
    ["representation", (f: Fixture) => { f.rows.locator!.representation_artifact_id = id(99); }, "CONTENT_LOCATOR_BINDING_MISMATCH"],
    ["selected digest", (f: Fixture) => { f.rows.locator!.selected_content_sha256 = digest("other").slice(7); }, "CONTENT_LOCATOR_BINDING_MISMATCH"],
    ["selector", (f: Fixture) => { f.rows.locator!.selector = { kind: "other" }; }, "CONTENT_LOCATOR_BINDING_MISMATCH"],
    ["selector digest", (f: Fixture) => { f.rows.locator!.selector_sha256 = digest("other").slice(7); }, "CONTENT_LOCATOR_BINDING_MISMATCH"],
    ["ambiguous sealed edge", (f: Fixture) => { Object.assign(f.sealed.claim.provenance!, { evidence: [f.edge, f.edge] }); stored(f).admission = structuredClone(f.sealed.claim.provenance); }, "CONTENT_LOCATOR_BINDING_MISMATCH"],
    ["assessment verdict", (f: Fixture) => { f.rows.assessment!.verdict = "unsupported"; }, "CONTENT_ASSESSMENT_ADMISSION_MISMATCH"],
    ["assessment replay", (f: Fixture) => { f.rows.assessment!.replay_signature_match = false; }, "CONTENT_ASSESSMENT_ADMISSION_MISMATCH"],
    ["assessment authority", (f: Fixture) => { f.rows.assessment!.authority_assessment = {}; }, "CONTENT_ASSESSMENT_ADMISSION_MISMATCH"],
    ["assessment properties", (f: Fixture) => { f.rows.assessment!.properties = {}; }, "CONTENT_ASSESSMENT_ADMISSION_MISMATCH"],
    ["assessment rationale", (f: Fixture) => { f.rows.assessment!.public_rationale = "different"; }, "CONTENT_ASSESSMENT_ADMISSION_MISMATCH"],
    ["assessment digest", (f: Fixture) => { f.context.reference.assessment.digest = digest("wrong"); }, "CONTENT_ASSESSMENT_DIGEST_MISMATCH"],
    ["missing selected bytes", (f: Fixture) => { f.sealed.selectedText = new Map(); }, "CONTENT_SELECTED_BYTES_MISSING"],
  ] as const)("rejects %s drift", async (_label, mutate, code) => {
    const f = fixture(); mutate(f); await expect(authenticate(f)).rejects.toMatchObject({ code });
  });
  it("propagates rejected sealed artifact/selector validation", async () => {
    const f = fixture(); f.loadClaim.mockRejectedValue(new Error("SEALED_BYTES_INVALID"));
    await expect(authenticate(f)).rejects.toThrow("SEALED_BYTES_INVALID");
  });
});

describe("canonical provenance drift rejection", () => {
  it.each([
    ["capture acquisition time", "capture", "captured_at", "2026-09-15T00:00:00Z"],
    ["capture method", "capture", "capture_method", "manual"],
    ["capture method version", "capture", "capture_method_version", "other"],
    ["original method alias", "capture", "context", { captureMethod: "https_acquire" }],
    ["missing original method alias", "capture", "context", {}],
    ["capture media type", "capture", "media_type", "application/pdf"],
    ["source URI", "source", "canonical_url", "https://other.invalid/"],
    ["run producer", "run", "producer_attempt_id", id(99)],
    ["run verifier", "run", "verifier_attempt_id", id(99)],
    ["run policy artifact", "run", "policy_artifact_id", id(99)],
    ["run policy version", "run", "policy_version", "other"],
    ["run bundle", "run", "bundle_artifact_id", id(99)],
    ["run result", "run", "deterministic_result_artifact_id", id(99)],
    ["run completion time", "run", "ended_at", "2026-09-15T00:00:00Z"],
    ["run start time", "run", "started_at", "2026-09-13T00:00:00Z"],
    ["invalid run timestamp", "run", "started_at", "not-a-date"],
    ["invalid capture timestamp", "capture", "captured_at", "not-a-date"],
    ["locator occurrence count", "locator", "occurrence_count", 9],
    ["locator byte length", "locator", "selected_size_bytes", 999],
    ["locator normalization", "locator", "normalization_policy", "different"],
    ["locator resolver", "locator", "resolution_version", "different"],
    ["locator parser lineage", "locator", "extraction_params", { parserLineageArtifactIds: [id(99)] }],
    ["locator media type", "locator", "media_type", "application/pdf"],
    ["evidence link authority", "link", "authority_assessment", { authority: "untrusted" }],
  ])("rejects %s drift", async (_label, table, column, value) => {
    const f = fixture(); f.rows[String(table)]![String(column)] = value;
    await expect(authenticate(f)).rejects.toMatchObject({ code: table === "run" ? "CONTENT_RUN_BINDING_MISMATCH" : "CONTENT_LOCATOR_BINDING_MISMATCH" });
  });
  it("accepts equivalent timestamp offsets and database numeric encodings", async () => {
    const f = fixture();
    f.rows.capture!.captured_at = "2026-09-13T20:00:00-04:00";
    f.rows.run!.started_at = "2026-09-14T00:00:00+00:00";
    f.rows.run!.ended_at = "2026-09-13T20:00:01-04:00";
    f.rows.locator!.selected_size_bytes = String(f.edge.selectedSizeBytes);
    f.rows.locator!.occurrence_count = "1";
    await expect(authenticate(f)).resolves.toMatchObject({ eligible: true });
  });
  it("supports a canonical method without an alias context", async () => {
    const f = fixture();
    Object.assign(f.edge.capture, { captureMethod: "http" });
    f.rows.capture!.context = {};
    stored(f).admission = structuredClone(f.sealed.claim.provenance);
    await expect(authenticate(f)).resolves.toMatchObject({ eligible: true });
  });
  it.each(["capture", "run"])("rejects sub-millisecond %s drift", async table => {
    const f = fixture();
    f.rows[table]![table === "capture" ? "captured_at" : "started_at"] = "2026-09-14T00:00:00.000001Z";
    await expect(authenticate(f)).rejects.toMatchObject({ code: table === "run" ? "CONTENT_RUN_BINDING_MISMATCH" : "CONTENT_LOCATOR_BINDING_MISMATCH" });
  });
  it("preserves exact fractional instants across timezone offsets", async () => {
    const f = fixture();
    Object.assign(f.edge.capture, { capturedAt: "2026-09-14T00:00:00.123456789Z" });
    Object.assign(f.sealed.claim.provenance!.run, { startedAt: "2026-09-14T00:00:00.123456789Z", completedAt: "2026-09-14T00:00:01.123456789Z" });
    stored(f).admission = structuredClone(f.sealed.claim.provenance);
    f.rows.capture!.captured_at = "2026-09-13T20:00:00.123456789-04:00";
    f.rows.run!.started_at = "2026-09-14T05:30:00.123456789+05:30";
    f.rows.run!.ended_at = "2026-09-14T00:00:01.123456789+00:00";
    await expect(authenticate(f)).resolves.toMatchObject({ eligible: true });
    f.rows.capture!.captured_at = "2026-09-13T20:00:00.123456788-04:00";
    await expect(authenticate(f)).rejects.toMatchObject({ code: "CONTENT_LOCATOR_BINDING_MISMATCH" });
  });
});
