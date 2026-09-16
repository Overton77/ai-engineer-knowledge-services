import { z } from "zod";
import { ArtifactLedger, sha256Hex } from "@aiengineer/knowledge-db-read";
import { ReportService, ReportStructureSchema, renderReport, type ReportStructure, type RenderedAssertion, type ReportPackageRead } from "@aiengineer/knowledge-ingestion";
import { assertSignedReportSourceDependencies, type TenantPostgres } from "@aiengineer/knowledge-persistence";
import { canonicalizeJson } from "@aiengineer/knowledge-verification";
import { domainError } from "@aiengineer/knowledge-schema-workspace";
import type { VerificationExecutor } from "../executor.js";
import { loadSealedReportEvidence, type ReportEvidenceClaim, type SealedReportEvidence } from "./evidence-oracle.js";

const Digest = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const Artifact = z.strictObject({artifactId:z.uuid(),digest:Digest});
export const ReportAssessmentRequirementsSchema = z.strictObject({
  schemaVersion:z.literal("research-report-requirements.v1"),tenantId:z.uuid(),reportVersionId:z.uuid(),
  originalQuestions:z.array(z.strictObject({key:z.string().min(1),question:z.string().min(1),requiredAssertionKeys:z.array(z.string().min(1)).max(4096)})).min(1).max(512),
  structuralSpans:z.array(z.strictObject({start:z.int().nonnegative(),end:z.int().positive(),text:z.string().min(1).max(4000),role:z.enum(["report_title","section_heading","table_header","table_label","caption_prefix"])})).max(2048),
  requiredAssertions:z.array(z.strictObject({key:z.string().min(1),proposition:z.string().min(1),kind:z.enum(["reported","observed","derived","interpretation","recommendation","illustrative"]),qualifiers:z.array(z.string()).default([])})).max(4096),
}).superRefine((value,context) => {
  for (const values of [value.originalQuestions,value.requiredAssertions]) if (new Set(values.map(item=>item.key)).size!==values.length) context.addIssue({code:"custom",message:"Duplicate required identity"});
  const assertionKeys=new Set(value.requiredAssertions.map(item=>item.key));
  for(const question of value.originalQuestions) if(new Set(question.requiredAssertionKeys).size!==question.requiredAssertionKeys.length || question.requiredAssertionKeys.some(key=>!assertionKeys.has(key))) context.addIssue({code:"custom",message:"Invalid question assertion census"});
});
export type ReportAssessmentRequirements = z.infer<typeof ReportAssessmentRequirementsSchema>;
export const ReportAssessmentAuthorityPinSchema = z.strictObject({
  requirements:Artifact,runs:z.array(z.strictObject({runId:z.string().min(1),manifestDigest:Digest,auditArtifact:Artifact})).max(256),
}).superRefine((value,context) => {if (new Set(value.runs.map(run=>run.runId)).size!==value.runs.length) context.addIssue({code:"custom",message:"Duplicate allowed run"});});
export type ReportAssessmentAuthorityPin = z.infer<typeof ReportAssessmentAuthorityPinSchema>;
export interface ReportAssessmentAuthority {
  forReport(input:{tenantId:string;revisionId:string}):Promise<ReportAssessmentAuthorityPin|undefined>;
}
export interface ReportAssessmentConfig {
  readonly db:TenantPostgres;readonly reports:ReportService;readonly artifacts:ArtifactLedger;readonly verification:VerificationExecutor;
  readonly tenantId:string;readonly policyVersion:string;readonly policyDigest:string;readonly authority:ReportAssessmentAuthority;
}
const same = (left:unknown,right:unknown) => canonicalizeJson(left)===canonicalizeJson(right);
const identity = (runId:string,claimId:string) => JSON.stringify([runId,claimId]);
export function rejectedAssertionText(claim:ReportEvidenceClaim):string {
  return `Verification rejected “${claim.assertion.proposition}” (${claim.verdict}; policy ${claim.policyOutcome}).`;
}

type RenderedReport = ReturnType<typeof renderReport>;
type EvidenceRuns = ReadonlyMap<string, SealedReportEvidence>;
type StructuralSpan = ReportAssessmentRequirements["structuralSpans"][number];
type StoredArtifact = Awaited<ReturnType<ArtifactLedger["get"]>>;
interface FinalPackage {
  report: ReportStructure;
  structure: StoredArtifact;
  markdown: StoredArtifact;
  manifest: StoredArtifact;
}
const sorted = (values: unknown[]) => values.map(value => canonicalizeJson(value)).sort();

/** Conservative report fidelity: factual spans reuse verified propositions; rejected claims are explicit outcome disclosures. */
export function assessReportFidelity(report: ReportStructure, requirements: ReportAssessmentRequirements, runs: EvidenceRuns) {
  const problems = checkOriginalQuestions(report, requirements);
  const rendered = renderReport(report);
  problems.push(...checkRequiredAssertions(rendered, requirements));
  const assertions = rendered.assertions.map(item => assessAssertion(item, runs));
  for (const assertion of assertions) problems.push(...assertion.problems.map(problem => `${problem}:${assertion.key}`));
  problems.push(...checkStructuralCoverage(rendered, requirements));
  problems.push(...checkQuestionCoverage(report, requirements, assertions));
  return { problems, assertions, questions: report.questions, admission: problems.length ? "fail" as const : "pass" as const,
    allowedUses: problems.length ? [] : ["source_attributed_report"] };
}

function checkOriginalQuestions(report: ReportStructure, requirements: ReportAssessmentRequirements): string[] {
  const problems: string[] = [];
  for (const required of requirements.originalQuestions) {
    const question = report.questions.find(item => item.key === required.key);
    if (!question || question.question !== required.question || !question.required) problems.push(`ORIGINAL_QUESTION_OMITTED_OR_CHANGED:${required.key}`);
  }
  return problems;
}

function checkRequiredAssertions(rendered: RenderedReport, requirements: ReportAssessmentRequirements): string[] {
  const problems: string[] = [];
  for (const required of requirements.requiredAssertions) {
    const item = rendered.assertions.find(item => item.assertion.key === required.key);
    if (!item || item.proposition !== required.proposition || item.assertion.kind !== required.kind || !same(item.assertion.qualifiers, required.qualifiers)) {
      problems.push(`REQUIRED_ASSERTION_OMITTED_OR_CHANGED:${required.key}`);
    }
  }
  return problems;
}

function checkClaimReferences(assertion: RenderedAssertion["assertion"], runs: EvidenceRuns): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const ref of assertion.claims) {
    const key = identity(ref.runId, ref.claimId) + `:${ref.role}`;
    if (seen.has(key)) issues.push("DUPLICATE_CLAIM_REFERENCE");
    seen.add(key);
    const run = runs.get(ref.runId), claim = run?.reportClaims.get(ref.claimId);
    if (!run || !claim || claim.digest !== ref.digest || !same(run.auditArtifact, ref.evidenceManifest)) issues.push(`CLAIM_REFERENCE_INVALID:${identity(ref.runId, ref.claimId)}`);
  }
  return issues;
}

function assessAssertion(item: RenderedAssertion, runs: EvidenceRuns) {
  const assertion = item.assertion;
  const issues = checkClaimReferences(assertion, runs);
  let disposition = "illustrative", factEligible = false;
  if (assertion.kind !== "illustrative") {
    ({ disposition, factEligible } = assessClaimBasedAssertion(item, runs, issues));
  } else {
    if (assertion.claims.length) issues.push("ILLUSTRATIVE_ASSERTION_HAS_EVIDENCE");
    if (!item.proposition.startsWith("Illustrative example: ")) issues.push("ILLUSTRATIVE_ASSERTION_NOT_LABELED");
  }
  return { key: assertion.key, startUtf16: item.start, endUtf16: item.end, proposition: item.proposition, kind: assertion.kind, qualifiers: assertion.qualifiers,
    derivation: assertion.derivation, claims: assertion.claims, disposition: issues.length ? "failed" : disposition, factEligible: factEligible && issues.length === 0, problems: issues };
}

function assessClaimBasedAssertion(item: RenderedAssertion, runs: EvidenceRuns, issues: string[]) {
  const assertion = item.assertion;
  const primary = assertion.claims.filter(ref => ref.role === "supports" || ref.role === "premise");
  const primaryClaims = primary.map(ref => runs.get(ref.runId)?.reportClaims.get(ref.claimId)).filter((claim): claim is ReportEvidenceClaim => Boolean(claim));
  const rejection = primaryClaims.length === 1 ? primaryClaims[0] : undefined;
  let disposition = "faithful_rejection", factEligible = false;
  if (!isFaithfulRejection(item, rejection)) {
    disposition = "faithful_supported";
    issues.push(...checkSupportedAssertion(item, runs, primaryClaims));
    factEligible = issues.length === 0;
  }
  const qualifiers = [...new Set(primaryClaims.flatMap(claim => claim.assertion.qualifiers))].sort();
  if (!same([...assertion.qualifiers].sort(), qualifiers)) issues.push("QUALIFIERS_NOT_PRESERVED");
  return { disposition, factEligible };
}

function isFaithfulRejection(item: RenderedAssertion, rejection: ReportEvidenceClaim | undefined): boolean {
  return Boolean(rejection && !rejection.eligible && ["fail", "review", "abstain"].includes(rejection.policyOutcome)
    && item.proposition === rejectedAssertionText(rejection)
    && same(item.assertion.derivation, { kind: "verification_outcome", runId: rejection.runId, claimId: rejection.claimId, verdict: rejection.verdict, policyOutcome: rejection.policyOutcome }));
}

function checkSupportedAssertion(item: RenderedAssertion, runs: EvidenceRuns, primaryClaims: ReportEvidenceClaim[]): string[] {
  const issues: string[] = [];
  const assertion = item.assertion;
  if (!primaryClaims.length || primaryClaims.some(claim => !claim.eligible)) issues.push("UNSUPPORTED_FACTUAL_ASSERTION");
  const supports = assertion.claims.filter(ref => ref.role === "supports").map(ref => runs.get(ref.runId)?.reportClaims.get(ref.claimId));
  if (!supports.some(claim => claim?.eligible && claim.assertion.proposition === item.proposition && claim.assertion.downstreamUse.includes("source_attributed_report"))) issues.push("FINAL_SPAN_NOT_AUTHORIZED");
  if (["derived", "interpretation", "recommendation"].includes(assertion.kind)) {
    const premises = assertion.claims.filter(ref => ref.role === "premise").map(ref => ({ runId: ref.runId, claimId: ref.claimId, digest: ref.digest }));
    if (!premises.length || !same(assertion.derivation.premises, premises)) issues.push("DERIVATION_PREMISES_MISSING");
  }
  return issues;
}

function structuralRoleMatches(markdown: string, span: StructuralSpan): boolean {
  const lineStart = markdown.lastIndexOf("\n", span.start - 1) + 1;
  const lineEnd = markdown.indexOf("\n", span.end);
  const fullLine = span.start === lineStart && (lineEnd === -1 ? span.end === markdown.length : span.end === lineEnd);
  const after = markdown.slice(span.end + 1).split("\n", 1)[0] ?? "";
  switch (span.role) {
    case "report_title": return span.start === 0 && fullLine && /^# [^\r\n]+$/.test(span.text);
    case "section_heading": return fullLine && /^## [^\r\n]+$/.test(span.text);
    case "table_header": return fullLine && /^\|[^\r\n]+\|$/.test(span.text) && /^\|[\s:|\-]+\|$/.test(after);
    case "table_label": return markdown[lineStart] === "|" && markdown[span.start - 1] === "|" && markdown[span.end] === "|" && !/[|\r\n]/.test(span.text);
    case "caption_prefix": return span.start === lineStart && /^Figure [0-9]+: $/.test(span.text);
  }
}

function checkStructuralCoverage(rendered: RenderedReport, requirements: ReportAssessmentRequirements): string[] {
  const problems: string[] = [];
  const covered = rendered.markdown.split("");
  for (const item of rendered.assertions) covered.fill(" ", item.start, item.end);
  for (const span of requirements.structuralSpans) {
    const roleValid = structuralRoleMatches(rendered.markdown, span);
    if (span.end <= span.start || span.end > rendered.markdown.length || rendered.markdown.slice(span.start, span.end) !== span.text || !roleValid
      || rendered.assertions.some(item => item.start < span.end && item.end > span.start)) problems.push("STRUCTURAL_SPAN_BINDING_INVALID");
    else covered.fill(" ", span.start, span.end);
  }
  if (covered.join("").replace(/[\s#|*_<>()\[\]`~:.,;!?'"=+\-]/g, "").length) problems.push("UNBOUND_REPORT_TEXT");
  return problems;
}

function checkQuestionCoverage(report: ReportStructure, requirements: ReportAssessmentRequirements, assertions: ReturnType<typeof assessAssertion>[]): string[] {
  const problems: string[] = [];
  for (const required of requirements.originalQuestions) {
    const question = report.questions.find(item => item.key === required.key);
    if (!question || !["answered", "partial", "conflicting"].includes(question.coverage)) continue;
    const sectionAssertions = new Set(report.sections.filter(section => question.sectionKeys.includes(section.key)).flatMap(section => section.blocks.flatMap(block => block.assertions.map(assertion => assertion.key))));
    const satisfied = required.requiredAssertionKeys.filter(key => sectionAssertions.has(key) && assertions.some(assertion => assertion.key === key && ["faithful_supported", "faithful_rejection"].includes(assertion.disposition)));
    if (!required.requiredAssertionKeys.length || (question.coverage !== "partial" ? satisfied.length !== required.requiredAssertionKeys.length : satisfied.length === 0)) problems.push(`QUESTION_ASSERTION_COVERAGE_INVALID:${required.key}`);
  }
  return problems;
}

function assertManifestBinding(reportVersionId: string, finalPackage: FinalPackage): void {
  const { report, structure, markdown, manifest } = finalPackage;
  const body = z.object({ reportId: z.uuid(), revisionId: z.uuid(), structure: z.object({ artifactId: z.uuid(), digest: Digest }), markdown: z.object({ artifactId: z.uuid(), digest: Digest }) }).parse(manifest.json);
  if (body.reportId !== report.reportId || body.revisionId !== reportVersionId
    || !same(body.structure, { artifactId: structure.record.artifactId, digest: structure.record.digest })
    || !same(body.markdown, { artifactId: markdown.record.artifactId, digest: markdown.record.digest })) throw domainError("REPORT_MANIFEST_BINDING_INVALID", "Registered manifest does not bind final structure and Markdown");
}

function assertAssertionProjections(packageRead: ReportPackageRead, final: RenderedReport, markdownArtifactId: string): void {
  if (packageRead.assertions.length !== final.assertions.length || final.assertions.some(item => {
    const rows = packageRead.assertions.filter(row => row.assertion_key === item.assertion.key);
    const row = rows[0];
    return rows.length !== 1 || !row || row.proposition !== item.proposition || Number(row.start_utf16) !== item.start || Number(row.end_utf16) !== item.end
      || row.artifact_id !== markdownArtifactId || row.statement_kind !== item.assertion.kind || !same(row.qualifiers, item.assertion.qualifiers) || !same(row.derivation, item.assertion.derivation);
  })) throw domainError("REPORT_PROJECTION_BINDING_INVALID", "Registered assertion projections differ from final bytes");
}

function assertClaimProjections(packageRead: ReportPackageRead, final: RenderedReport): void {
  const expected = final.assertions.flatMap(item => item.assertion.claims.map(ref => ({ assertionKey: item.assertion.key, runId: ref.runId, claimId: ref.claimId, digest: ref.digest, canonicalClaimId: ref.canonicalClaimId ?? null, manifestId: ref.evidenceManifest.artifactId, role: ref.role })));
  const actual = packageRead.claimBindings.map(row => ({ assertionKey: packageRead.assertions.find(item => item.id === row.assertion_id)?.assertion_key, runId: row.run_id, claimId: row.claim_key, digest: `sha256:${row.claim_digest}`, canonicalClaimId: row.claim_id, manifestId: row.evidence_manifest_artifact_id, role: row.role }));
  if (!same(sorted(expected), sorted(actual))) throw domainError("REPORT_PROJECTION_BINDING_INVALID", "Registered claim bindings differ from report source");
}

function assertQuestionProjections(packageRead: ReportPackageRead, report: ReportStructure): void {
  const expected = report.questions.map(question => ({ key: question.key, question: question.question, required: question.required, coverage: question.coverage, explanation: question.explanation, evidenceNeeded: question.evidenceNeeded ?? null }));
  const actual = packageRead.questions.map(row => ({ key: row.question_key, question: row.question, required: row.required, coverage: row.coverage, explanation: row.explanation, evidenceNeeded: row.resolution_evidence_needed }));
  if (!same(sorted(expected), sorted(actual))) throw domainError("REPORT_PROJECTION_BINDING_INVALID", "Registered question coverage differs from report source");
  const expectedSections = report.questions.flatMap(question => question.sectionKeys.map(key => ({ question: question.key, section: report.sections.findIndex(section => section.key === key) })));
  const actualSections = packageRead.questionSections.map(row => ({ question: row.question_key, section: Number(packageRead.sections.find(section => section.section_id === row.section_id)?.ordinal) }));
  if (!same(sorted(expectedSections), sorted(actualSections))) throw domainError("REPORT_PROJECTION_BINDING_INVALID", "Registered question section links differ from report source");
}

function createAssessmentResult(config: ReportAssessmentConfig, reportVersionId: string, finalPackage: FinalPackage, pin: ReportAssessmentAuthorityPin, fidelity: ReturnType<typeof assessReportFidelity>) {
  const { structure, markdown, manifest } = finalPackage;
  return { schemaVersion: "research-report-assessment.v1", tenantId: config.tenantId, reportVersionId, evaluator: "report-final-byte-fidelity.v1",
    finalMarkdown: { artifactId: markdown.record.artifactId, digest: markdown.record.digest }, structure: { artifactId: structure.record.artifactId, digest: structure.record.digest },
    manifest: { artifactId: manifest.record.artifactId, digest: manifest.record.digest }, authority: pin, policy: { version: config.policyVersion, digest: config.policyDigest },
    ...fidelity };
}

/** Host-pinned denominators and authenticated runs are independent of author-provided report content. */
export class ReportAssessmentService {
  constructor(private readonly config: ReportAssessmentConfig) {}

  async assess(input: { reportVersionId: string }) {
    const reportVersionId = z.uuid().parse(input.reportVersionId);
    const { pin, requirements } = await this.loadPinnedRequirements(reportVersionId);
    const finalPackage = await this.loadFinalPackage(reportVersionId);
    const runs = await this.loadEvidence(pin);
    await this.assertCanonicalReferences(finalPackage.report, runs);
    await this.assertCurrentSources(finalPackage.report, runs);
    const fidelity = assessReportFidelity(finalPackage.report, requirements, runs);
    return this.persistResult(createAssessmentResult(this.config, reportVersionId, finalPackage, pin, fidelity));
  }

  private async loadPinnedRequirements(reportVersionId: string) {
    const { tenantId } = this.config;
    const authority = await this.config.authority.forReport({ tenantId, revisionId: reportVersionId });
    if (!authority) throw domainError("REPORT_ASSESSMENT_AUTHORITY_REQUIRED", "Report assessment requires a host-pinned original denominator and evidence runs");
    const pin = ReportAssessmentAuthorityPinSchema.parse(authority);
    const required = await this.config.artifacts.get(tenantId, pin.requirements.artifactId);
    if (required.record.digest !== pin.requirements.digest || required.record.storageState !== "available") throw domainError("REPORT_REQUIREMENTS_BINDING_INVALID", "Original requirements artifact is unavailable or changed");
    const requirements = ReportAssessmentRequirementsSchema.parse(required.json);
    if (requirements.tenantId !== tenantId || requirements.reportVersionId !== reportVersionId) throw domainError("REPORT_REQUIREMENTS_SCOPE_MISMATCH", "Requirements belong to another tenant or revision");
    return { pin, requirements };
  }

  private async assertCurrentSources(report: ReportStructure, runs: EvidenceRuns) {
    const sources = new Map<string, { artifactId: string; digest: string }>();
    for (const reference of report.sections.flatMap(section => section.blocks.flatMap(block => block.assertions.flatMap(assertion => assertion.claims)))) {
      if (!['supports', 'premise'].includes(reference.role)) continue;
      const run = runs.get(reference.runId), claim = run?.reportClaims.get(reference.claimId);
      if (!run || !claim) continue; // Fidelity assessment records missing run-qualified claims as rejection.
      for (const edge of claim.assertion.evidence) {
        const artifact = run.sourceArtifacts.find(source => source.artifactId === edge.fragment.representationArtifactId);
        if (!artifact) throw domainError("REPORT_SOURCE_BINDING_REQUIRED", "Report source must bind the authenticated native input");
        sources.set(artifact.artifactId, artifact);
      }
    }
    await this.config.db.transaction({ tenantId: this.config.tenantId, role: "executor_service", readOnly: true }, client =>
      assertSignedReportSourceDependencies(client, this.config.tenantId, [...sources.values()]));
  }

  private async loadFinalPackage(reportVersionId: string): Promise<FinalPackage> {
    const packageRead = await this.config.reports.get({ tenantId: this.config.tenantId, reportVersionId });
    if (!packageRead.seal) throw domainError("REPORT_ASSESSMENT_REQUIRES_SEAL", "Report package must be registered and sealed");
    const [structure, markdown, manifest] = await Promise.all([
      this.loadPackageArtifact(packageRead, "structure"), this.loadPackageArtifact(packageRead, "markdown"), this.loadPackageArtifact(packageRead, "manifest"),
    ]);
    const report = ReportStructureSchema.parse(structure.json);
    const final = renderReport(report);
    if (report.revisionId !== reportVersionId || markdown.text !== final.markdown || markdown.record.digest !== `sha256:${sha256Hex(final.markdown)}`) throw domainError("REPORT_FINAL_BYTES_MISMATCH", "Final registered Markdown differs from the immutable assertion structure");
    const finalPackage = { report, structure, markdown, manifest };
    assertManifestBinding(reportVersionId, finalPackage);
    assertAssertionProjections(packageRead, final, markdown.record.artifactId);
    assertClaimProjections(packageRead, final);
    assertQuestionProjections(packageRead, report);
    return finalPackage;
  }

  private async loadPackageArtifact(packageRead: ReportPackageRead, role: string): Promise<StoredArtifact> {
    const bindings = packageRead.artifacts.filter(item => item.role === role);
    if (bindings.length !== 1) throw domainError("REPORT_ARTIFACT_BINDING_INVALID", "Report role must bind exactly one artifact");
    const artifact = await this.config.artifacts.get(this.config.tenantId, String(bindings[0]!.artifact_id));
    if (artifact.record.storageState !== "available" || artifact.record.digest !== `sha256:${bindings[0]!.sha256}`) throw domainError("REPORT_ARTIFACT_BINDING_INVALID", "Final report artifact is unavailable or changed");
    return artifact;
  }

  private async loadEvidence(pin: ReportAssessmentAuthorityPin): Promise<EvidenceRuns> {
    const { tenantId, policyVersion, policyDigest, verification } = this.config;
    const runs = new Map<string, SealedReportEvidence>();
    for (const run of pin.runs) {
      const evidence = await loadSealedReportEvidence(verification, { tenantId, runId: run.runId, manifestDigest: run.manifestDigest, policyVersion, policyDigest });
      if (!same(evidence.auditArtifact, run.auditArtifact)) throw domainError("REPORT_RUN_BINDING_INVALID", "Host evidence manifest differs from the authenticated run");
      runs.set(run.runId, evidence);
    }
    return runs;
  }

  private async assertCanonicalReferences(report: ReportStructure, runs: EvidenceRuns): Promise<void> {
    const { tenantId } = this.config;
    await this.config.db.transaction({ tenantId, role: "pipeline_agent", readOnly: true }, async client => {
      for (const reference of report.sections.flatMap(section => section.blocks.flatMap(block => block.assertions.flatMap(assertion => assertion.claims)))) {
        if (!reference.canonicalClaimId) continue;
        const row = (await client.query<{ statement: string; structured: { verification?: { runId?: string; claimId?: string; manifestDigest?: string } } }>("select statement,structured from evidence.claim where tenant_id=$1 and id=$2", [tenantId, reference.canonicalClaimId])).rows[0];
        const claim = runs.get(reference.runId)?.reportClaims.get(reference.claimId), binding = row?.structured.verification;
        if (!claim || !row || row.statement !== claim.assertion.proposition || binding?.runId !== reference.runId || binding.claimId !== reference.claimId || binding.manifestDigest !== runs.get(reference.runId)?.manifestDigest) throw domainError("REPORT_CANONICAL_CLAIM_MISMATCH", "Optional canonical claim must match its exact run-qualified assertion");
      }
    });
  }

  private async persistResult(result: ReturnType<typeof createAssessmentResult>) {
    const { tenantId, reportVersionId, finalMarkdown } = result;
    return this.config.db.transaction({ tenantId, role: "executor_service" }, async client => {
      const stored = await this.config.artifacts.putWith(client, { tenantId, artifactType: "research_report_verification", text: JSON.stringify(result), mediaType: "application/json" });
      if (stored.storageState !== "available") throw domainError("REPORT_ASSESSMENT_RESULT_UNAVAILABLE", "Assessment requires durable result custody");
      await client.query(`insert into research.report_assessment(tenant_id,report_version_id,report_artifact_id,report_digest,result_artifact_id)
        values($1,$2,$3,$4,$5) on conflict(tenant_id,report_version_id,result_artifact_id) do nothing`, [tenantId, reportVersionId, finalMarkdown.artifactId, finalMarkdown.digest.slice(7), stored.artifactId]);
      const row = (await client.query<{ id: string }>("select id from research.report_assessment where tenant_id=$1 and report_version_id=$2 and result_artifact_id=$3", [tenantId, reportVersionId, stored.artifactId])).rows[0]!;
      return { ...result, assessmentId: row.id, resultArtifact: { artifactId: stored.artifactId, digest: stored.digest } };
    });
  }
}
