import { uuidv7 } from "@aiengineer/knowledge-db-read";
import type { TenantSqlClient } from "@aiengineer/knowledge-persistence";
import type { RenderedAssertion, ReportStructure } from "./structure.js";

interface ProjectionInput {
  readonly report: ReportStructure;
  readonly markdownArtifactId: string;
  readonly assertions: readonly RenderedAssertion[];
}

export async function writeReportProjections(client: TenantSqlClient, input: ProjectionInput): Promise<void> {
  const { report } = input;
  const sections = new Map<string, string>();
  for (const [ordinal, section] of report.sections.entries()) {
    const existing = await client.query<{ id: string }>("select id from research.report_section where report_id=$1 and section_key=$2", [report.reportId, section.key]);
    const sectionId = existing.rows[0]?.id ?? uuidv7();
    if (!existing.rows.length) await client.query("insert into research.report_section(id,report_id,section_key) values($1,$2,$3)", [sectionId, report.reportId, section.key]);
    sections.set(section.key, sectionId);
    await client.query(`insert into research.report_section_version(report_id,report_version_id,section_id,ordinal,heading,section_kind,question,conclusion,context,content_pointer)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`, [report.reportId, report.revisionId, sectionId, ordinal, section.heading, section.kind, section.question ?? null, section.conclusion ?? null, JSON.stringify(section.context), `/sections/${ordinal}`]);
  }
  for (const section of report.sections) for (const dependency of section.dependencies) await client.query(`insert into research.report_section_dependency(report_version_id,section_id,required_version_id,required_section_id,relation) values($1,$2,$3,$4,$5)`, [report.revisionId, sections.get(section.key), dependency.reportVersionId, dependency.sectionId, dependency.relation]);
  for (const rendered of input.assertions) {
    const assertionId = uuidv7();
    const assertion = rendered.assertion;
    await client.query(`insert into research.report_assertion(id,report_version_id,section_id,assertion_key,statement_kind,proposition,artifact_id,start_utf16,end_utf16,block_pointer,qualifiers,derivation)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb)`, [assertionId, report.revisionId, sections.get(rendered.sectionKey), assertion.key, assertion.kind, rendered.proposition, input.markdownArtifactId, rendered.start, rendered.end, rendered.blockPointer, JSON.stringify(assertion.qualifiers), JSON.stringify(assertion.derivation)]);
    for (const claim of assertion.claims) await client.query(`insert into research.report_assertion_claim(report_version_id,assertion_id,run_id,claim_key,claim_digest,claim_id,evidence_manifest_artifact_id,role)
      values($1,$2,$3,$4,$5,$6,$7,$8)`, [report.revisionId, assertionId, claim.runId, claim.claimId, claim.digest.slice(7), claim.canonicalClaimId ?? null, claim.evidenceManifest.artifactId, claim.role]);
  }
  for (const question of report.questions) {
    await client.query(`insert into research.report_question(report_version_id,question_key,question,required,coverage,explanation,resolution_evidence_needed) values($1,$2,$3,$4,$5,$6,$7)`, [report.revisionId, question.key, question.question, question.required, question.coverage, question.explanation, question.evidenceNeeded ?? null]);
    for (const sectionKey of question.sectionKeys) await client.query("insert into research.report_question_section(report_version_id,question_key,section_id) values($1,$2,$3)", [report.revisionId, question.key, sections.get(sectionKey)]);
  }
}
