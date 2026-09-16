import { canonicalJson } from "@aiengineer/knowledge-db-read";
import { sha256Digest } from "@aiengineer/knowledge-domain";
import type { TenantSqlClient } from "@aiengineer/knowledge-persistence";
import { domainError } from "@aiengineer/knowledge-schema-workspace";
import type { AuthoritativeClaim } from "../evidence-admission.js";
import { canonicalCaptureMethod } from "../provenance.js";
import type { AuthenticatedContentEvidence, ContentLinkEvidenceReference } from "./types.js";

type Row = Record<string, unknown>;
interface CanonicalEvidence {
  claim: Row; link: Row; assessment: Row; locator: Row; capture: Row; source: Row; run: Row;
}
export interface SealedContentClaim {
  claim: AuthoritativeClaim;
  assertionDigest: string;
  selectedText: ReadonlyMap<string, string>;
}
interface EvidenceContext {
  client: TenantSqlClient;
  tenantId: string;
  policyDigest: string;
  reference: ContentLinkEvidenceReference;
  loadClaim(input: { runId: string; claimKey: string; manifestDigest: string }): Promise<SealedContentClaim>;
}

/** Stable assessment projection excludes database timestamps and generated defaults. */
export function contentEvidenceAssessmentDigest(value: {
  tenantId: string; assessmentId: string; claimId: string; runId: string;
  locatorId: string; captureId: string; role: string; verdict: string;
  authority: unknown; replaySignatureMatch: boolean; properties: unknown; publicRationale: string | null;
}): string {
  return sha256Digest(canonicalJson({ schemaVersion: "content-link-assessment-binding.v1", ...value }));
}

/** Reconciles sealed admission with the exact same-tenant canonical evidence rows. */
export async function authenticateCanonicalContentEvidence(context: EvidenceContext): Promise<AuthenticatedContentEvidence> {
  const rows = await readCanonicalEvidence(context);
  const stored = object(object(rows.claim.structured).verification);
  if (typeof stored.manifestDigest !== "string") deny("CONTENT_CLAIM_ADMISSION_MISSING");
  const sealed = await context.loadClaim({ runId: context.reference.runId, claimKey: context.reference.claimKey,
    manifestDigest: stored.manifestDigest });
  const claim = sealed.claim;
  const provenance = claim.provenance;
  if (!provenance || provenance.tenantId !== context.tenantId || provenance.policyDigest !== context.policyDigest
    || sealed.assertionDigest !== context.reference.claimDigest || claim.statement !== rows.claim.statement
    || claim.claimType !== rows.claim.claim_type || !equal(claim.qualifiers, stored.qualifiers)
    || !equal(claim.value ?? null, stored.value ?? null) || !equal(provenance, stored.admission)
    || rows.claim.producer_attempt_id !== provenance.run.producerAttemptId
    || stored.runId !== context.reference.runId || stored.claimId !== context.reference.claimKey
    || ["rejected", "retracted", "superseded"].includes(String(rows.claim.status))) deny("CONTENT_CLAIM_ADMISSION_MISMATCH");
  verifyRun(context, rows.run, claim);
  const edges = provenance.evidence.filter(edge => edge.role === context.reference.role && matchesCanonicalEdge(rows, edge));
  if (edges.length !== 1) deny("CONTENT_LOCATOR_BINDING_MISMATCH");
  const edge = edges[0]!;
  const expectedVerdict = edge.role === "supports" && provenance.assessment.supportingFragmentIds.includes(edge.fragmentId)
    ? claim.verdict === "literal_extraction_verified" ? "derived_verified" : claim.verdict : "context_only";
  if (rows.assessment.verdict !== expectedVerdict || rows.assessment.replay_signature_match !== true
    || !equal(rows.assessment.authority_assessment, edge.authority) || !equal(rows.assessment.properties, provenance.assessment.properties)
    || rows.assessment.public_rationale !== provenance.assessment.reasonCodes.join("; ")) deny("CONTENT_ASSESSMENT_ADMISSION_MISMATCH");
  if (assessmentDigest(context, rows) !== context.reference.assessment.digest) deny("CONTENT_ASSESSMENT_DIGEST_MISMATCH");
  const selectedText = sealed.selectedText.get(edge.fragmentId);
  if (selectedText === undefined) deny("CONTENT_SELECTED_BYTES_MISSING");
  return { reference: context.reference, statement: claim.statement, ...(claim.value !== undefined ? { value: claim.value } : {}), qualifiers: claim.qualifiers,
    entityBindings: claim.entityBindings, downstreamUse: claim.downstreamUse, verdict: claim.verdict,
    policyOutcome: provenance.outcome, policyDigest: provenance.policyDigest, eligible: true,
    selectedText, selectedContentDigest: edge.selectedContentDigest, representationArtifactId: edge.representationArtifactId,
    captureArtifactId: edge.capture.artifactId };
}

async function readCanonicalEvidence(context: EvidenceContext): Promise<CanonicalEvidence> {
  const { tenantId, reference } = context;
  const row = (await context.client.query<CanonicalEvidence>(`select to_jsonb(c) claim, to_jsonb(l) link,
    to_jsonb(a) assessment, to_jsonb(loc) locator, to_jsonb(cap) capture, to_jsonb(src) source, to_jsonb(r) run
    from evidence.claim c
    join evidence.claim_evidence_link l on l.tenant_id=c.tenant_id and l.claim_id=c.id
    join evidence.claim_evidence_assessment a on a.tenant_id=l.tenant_id and a.claim_evidence_link_id=l.id
    join evidence.locator loc on loc.tenant_id=l.tenant_id and loc.id=l.locator_id
    join evidence.source_capture cap on cap.tenant_id=loc.tenant_id and cap.id=loc.capture_id
    join evidence.source src on src.tenant_id=cap.tenant_id and src.id=cap.source_id
    join evidence.verification_run r on r.tenant_id=a.tenant_id and r.id=a.run_id
    where c.tenant_id=$1 and c.id=$2 and a.id=$3 and r.id=$4 and loc.id=$5 and cap.id=$6 and l.role=$7`,
  [tenantId, reference.claimId, reference.assessment.id, reference.runId, reference.locatorId, reference.captureId, reference.role])).rows[0];
  if (!row || row.locator.resolution_state !== "resolved") deny("CONTENT_CANONICAL_EVIDENCE_MISSING");
  return row;
}

function verifyRun(context: EvidenceContext, row: Row, claim: AuthoritativeClaim): void {
  const provenance = claim.provenance!;
  const run = provenance.run;
  if (provenance.auditArtifactId !== context.reference.manifest.id || run.auditDigest !== context.reference.manifest.digest
    || row.run_manifest_artifact_id !== provenance.auditArtifactId || row.manifest_sha256 !== run.auditDigest.slice(7)
    || row.policy_artifact_sha256 !== context.policyDigest.slice(7) || row.status !== "succeeded"
    || row.policy_artifact_id !== provenance.policyArtifactId || row.policy_version !== claim.policyVersion
    || row.producer_attempt_id !== run.producerAttemptId || row.verifier_attempt_id !== run.verifierAttemptId
    || row.bundle_artifact_id !== run.bundleArtifactId || row.deterministic_result_artifact_id !== run.resultArtifactId
    || !sameInstant(row.started_at, run.startedAt) || !sameInstant(row.ended_at, run.completedAt)) deny("CONTENT_RUN_BINDING_MISMATCH");
}

function matchesCanonicalEdge(rows: CanonicalEvidence, edge: NonNullable<AuthoritativeClaim["provenance"]>["evidence"][number]): boolean {
  const { capture, locator, source, link } = rows;
  return edge.capture.artifactId === capture.artifact_id && edge.capture.digest.slice(7) === capture.content_sha256
    && sameInstant(capture.captured_at, edge.capture.capturedAt)
    && capture.capture_method === canonicalCaptureMethod(edge.capture.captureMethod)
    && (object(capture.context).captureMethod ?? capture.capture_method) === edge.capture.captureMethod
    && capture.capture_method_version === edge.capture.captureMethodVersion && capture.media_type === edge.capture.mediaType
    && source.canonical_url === edge.source.canonicalUri
    && edge.representationArtifactId === locator.representation_artifact_id
    && edge.selectedContentDigest.slice(7) === locator.selected_content_sha256
    && edge.selectorDigest.slice(7) === locator.selector_sha256 && equal(edge.selector, locator.selector)
    && Number(locator.selected_size_bytes) === edge.selectedSizeBytes && Number(locator.occurrence_count) === edge.occurrenceCount
    && locator.normalization_policy === edge.normalization && locator.resolution_version === edge.resolverVersion
    && locator.media_type === edge.capture.mediaType
    && equal(locator.extraction_params, { representationArtifactId: edge.representationArtifactId, parserLineageArtifactIds: edge.parserLineageArtifactIds })
    && equal(link.authority_assessment, edge.authority);
}

function sameInstant(value: unknown, expected: string): boolean {
  const actual = instantNanoseconds(value);
  return actual !== undefined && actual === instantNanoseconds(expected);
}

function instantNanoseconds(value: unknown): bigint | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return undefined;
  const milliseconds = Date.parse(`${match[1]}${match[3]}`);
  if (!Number.isFinite(milliseconds)) return undefined;
  return BigInt(milliseconds) * 1_000_000n + BigInt((match[2] ?? "").padEnd(9, "0"));
}

function assessmentDigest(context: EvidenceContext, rows: CanonicalEvidence): string {
  return contentEvidenceAssessmentDigest({ tenantId: context.tenantId, assessmentId: context.reference.assessment.id,
    claimId: context.reference.claimId, runId: context.reference.runId, locatorId: context.reference.locatorId,
    captureId: context.reference.captureId, role: context.reference.role, verdict: String(rows.assessment.verdict),
    authority: rows.assessment.authority_assessment, replaySignatureMatch: rows.assessment.replay_signature_match === true,
    properties: rows.assessment.properties, publicRationale: rows.assessment.public_rationale === null ? null : String(rows.assessment.public_rationale) });
}

function object(value: unknown): Row {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}
function equal(left: unknown, right: unknown): boolean { return canonicalJson(left) === canonicalJson(right); }
function deny(code: string): never { throw domainError(code, "Content evidence differs from authenticated canonical admission"); }
