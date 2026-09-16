import { z } from "zod";
import { ReportStructureSchema, renderReport, type ReportStructure } from "@aiengineer/knowledge-ingestion";
import { canonicalizeJson, inspectAuditBundle, type VerificationAuditBundle } from "@aiengineer/knowledge-verification";
import {
  ReportAssessmentRequirementsSchema,
  type ReportAssessmentAuthority,
  type ReportAssessmentAuthorityPin,
  type ReportAssessmentConfig,
  type ReportAssessmentRequirements,
} from "./knowledge/report-assessment.js";
import { loadSealedReportEvidence } from "./knowledge/evidence-oracle.js";

const OriginalQuestions = z.array(z.strictObject({ key: z.string().min(1), question: z.string().min(1) })).min(1).max(512);
const same = (left: unknown, right: unknown) => canonicalizeJson(left) === canonicalizeJson(right);
const deny = (code: string): never => { throw new Error(`ROOT_REPORT_${code}`); };

export const ROOT_REPORT_FORMAT = Object.freeze({ title: "T14 research report", headings: ["Findings", "Limitations", "Verification outcomes"] as const });

/** Derives a closed assertion census, never an admission verdict, from final registered bytes. */
export function deriveRootReportRequirements(input: {
  tenantId: string;
  report: unknown;
  originalQuestions: readonly { key: string; question: string }[];
}): { report: ReportStructure; requirements: ReportAssessmentRequirements } {
  const report = ReportStructureSchema.parse(input.report);
  const original = OriginalQuestions.parse(input.originalQuestions);
  if (new Set(original.map(question => question.key)).size !== original.length) deny("ORIGINAL_QUESTION_DUPLICATE");
  if (report.questions.length !== original.length || original.some(question => !report.questions.some(actual => actual.key === question.key && actual.question === question.question && actual.required))) deny("ORIGINAL_QUESTION_CHANGED");
  if (report.title !== ROOT_REPORT_FORMAT.title || report.sections.some(section => !(ROOT_REPORT_FORMAT.headings as readonly string[]).includes(section.heading))) deny("STRUCTURAL_LABEL_NOT_AUTHORIZED");
  const rendered = renderReport(report);
  if (!rendered.assertions.length || rendered.assertions.some(item => item.assertion.kind === "illustrative")) deny("FACTUAL_ASSERTION_CENSUS_REQUIRED");
  const requiredAssertions = rendered.assertions.map(({ assertion, proposition }) => ({
    key: assertion.key, proposition, kind: assertion.kind, qualifiers: [...assertion.qualifiers],
  }));
  const originalQuestions = original.map(question => {
    const actual = report.questions.find(item => item.key === question.key)!;
    const requiredAssertionKeys = rendered.assertions.filter(item => actual.sectionKeys.includes(item.sectionKey)).map(item => item.assertion.key);
    if (!requiredAssertionKeys.length) deny("QUESTION_WITHOUT_BOUND_ASSERTIONS");
    return { ...question, requiredAssertionKeys };
  });
  if (requiredAssertions.some(assertion => !originalQuestions.some(question => question.requiredAssertionKeys.includes(assertion.key)))) deny("ASSERTION_OUTSIDE_QUESTION_SCOPE");
  const title = `# ${report.title}`;
  const structuralSpans: ReportAssessmentRequirements["structuralSpans"] = [{ start: 0, end: title.length, text: title, role: "report_title" }];
  let offset = title.length + 2;
  for (const section of report.sections) {
    const heading = `## ${section.heading}`;
    structuralSpans.push({ start: offset, end: offset + heading.length, text: heading, role: "section_heading" });
    offset += heading.length + 2;
    for (const block of section.blocks) offset += block.markdown.length + 2;
  }
  // Only known-neutral renderer headings are exempt. Tables/captions/free prose must be bound.
  const uncovered = rendered.markdown.split("");
  for (const item of rendered.assertions) uncovered.fill(" ", item.start, item.end);
  for (const span of structuralSpans) uncovered.fill(" ", span.start, span.end);
  if (uncovered.join("").replace(/[\s#|*_<>()\[\]`~:.,;!?'"=+\-]/g, "").length) deny("UNBOUND_REPORT_TEXT");
  return { report, requirements: ReportAssessmentRequirementsSchema.parse({ schemaVersion: "research-report-requirements.v1", tenantId: input.tenantId,
    reportVersionId: report.revisionId, originalQuestions, structuralSpans, requiredAssertions }) };
}

/** Trusted startup hook. The producer cannot supply requirements, allowed runs, policy or pins. */
export function createRootReportAuthority(input: Omit<ReportAssessmentConfig, "authority"> & {
  readonly originalQuestions: readonly { key: string; question: string }[];
  readonly allowedRunIds: () => readonly string[];
}): ReportAssessmentAuthority {
  const originalQuestions = structuredClone(OriginalQuestions.parse(input.originalQuestions));
  const pins = new Map<string, ReportAssessmentAuthorityPin>();
  return { async forReport({ tenantId, revisionId }) {
    if (tenantId !== input.tenantId || input.verification.store.tenantId !== tenantId) deny("TENANT_MISMATCH");
    z.uuid().parse(revisionId);
    const known = pins.get(revisionId);
    if (known) return structuredClone(known);
    const stored = await input.reports.get({ tenantId, reportVersionId: revisionId });
    if (!stored.seal) deny("SEALED_REGISTERED_REPORT_REQUIRED");
    const structures = stored.artifacts.filter(artifact => artifact.role === "structure");
    if (structures.length !== 1) deny("STRUCTURE_BINDING");
    const structure = await input.artifacts.get(tenantId, String(structures[0]!.artifact_id));
    if (structure.record.storageState !== "available" || structure.record.digest !== `sha256:${structures[0]!.sha256}`) deny("STRUCTURE_CUSTODY");
    const { report, requirements } = deriveRootReportRequirements({ tenantId, report: structure.json, originalQuestions });
    if (report.revisionId !== revisionId) deny("REVISION_MISMATCH");
    const references = report.sections.flatMap(section => section.blocks.flatMap(block => block.assertions.flatMap(assertion => assertion.claims)));
    const runIds = [...new Set(references.map(reference => reference.runId))].sort();
    const allowedRuns = new Set(input.allowedRunIds());
    if (!runIds.length || runIds.some(runId => !allowedRuns.has(runId))) deny("RUN_NOT_HOST_AUTHORIZED");
    const runs: ReportAssessmentAuthorityPin["runs"] = [];
    for (const runId of runIds) {
      const { state } = await input.verification.runStatus({ runId });
      if (!state.auditArtifactId) deny("SEALED_EVIDENCE_REQUIRED");
      const auditHandle = await input.verification.store.resolveHandle({ artifactId: state.auditArtifactId });
      const audit = await input.verification.store.json<VerificationAuditBundle>(auditHandle);
      const inspected = await inspectAuditBundle(audit);
      const evidence = await loadSealedReportEvidence(input.verification, { tenantId, runId, manifestDigest: inspected.manifestDigest,
        policyVersion: input.policyVersion, policyDigest: input.policyDigest });
      for (const reference of references.filter(item => item.runId === runId)) {
        const claim = evidence.reportClaims.get(reference.claimId);
        if (!claim || claim.digest !== reference.digest || !same(evidence.auditArtifact, reference.evidenceManifest)) deny("CLAIM_REFERENCE_BINDING");
      }
      runs.push({ runId, manifestDigest: evidence.manifestDigest, auditArtifact: evidence.auditArtifact });
    }
    const requirementsArtifact = await input.artifacts.put({ tenantId, artifactType: "research_report_verification", mediaType: "application/json", text: canonicalizeJson(requirements) });
    if (requirementsArtifact.storageState !== "available") deny("REQUIREMENTS_CUSTODY");
    const pin: ReportAssessmentAuthorityPin = { requirements: { artifactId: requirementsArtifact.artifactId, digest: requirementsArtifact.digest }, runs };
    pins.set(revisionId, structuredClone(pin));
    return pin;
  } };
}
