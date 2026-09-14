import { ArtifactLedger, sha256Hex, type ArtifactRecord } from "@aiengineer/knowledge-db-read";
import type { TenantPostgres, TenantSqlClient } from "@aiengineer/knowledge-persistence";
import { domainError } from "@aiengineer/knowledge-schema-workspace";
import { ReportStructureSchema, renderReport, type ReportStructure } from "./structure.js";
import { writeReportProjections } from "./projections.js";

export const REPORT_BUCKET = "research-reports";
export interface ReportServiceConfig { readonly db: TenantPostgres; readonly artifacts: ArtifactLedger }
export interface RegisterReportInput { readonly tenantId: string; readonly report: unknown }
export interface ReportRegistration {
  readonly reportId: string; readonly reportVersionId: string; readonly duplicate?: boolean;
  readonly registration: "sealed" | "storage_pending"; readonly admission: "not_evaluated";
  readonly artifacts?: { structure: ArtifactRecord; markdown: ArtifactRecord; manifest: ArtifactRecord };
  readonly assertionCount?: number;
}
type ReportRow = Record<string, unknown>;
export interface ReportPackageRead {
  readonly revision: ReportRow; readonly sections: ReportRow[]; readonly questions: ReportRow[];
  readonly assertions: ReportRow[]; readonly claimBindings: ReportRow[]; readonly dependencies: ReportRow[];
  readonly questionSections: ReportRow[]; readonly ingestionLinks: ReportRow[];
  readonly assessments: ReportRow[];
  readonly artifacts: ReportRow[]; readonly seal: ReportRow | null; readonly admission: "not_evaluated";
}

/** Registers immutable research, without asserting semantic verification or publication admission. */
export class ReportService {
  constructor(private readonly config: ReportServiceConfig) {}

  async register(input: RegisterReportInput): Promise<ReportRegistration> {
    const report = ReportStructureSchema.parse(input.report);
    const rendered = renderReport(report);
    return this.config.db.transaction({ tenantId: input.tenantId, role: "executor_service" }, async (client) => {
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`${input.tenantId}/report/${report.reportId}`]);
      const previous = await client.query<{ sha256: string; sealed: boolean }>(`select a.sha256,exists(select 1 from research.report_package_seal where report_version_id=v.id) sealed
        from research.report_version v join orchestration.artifact a on a.id=v.json_artifact_id where v.id=$1`, [report.revisionId]);
      if (previous.rows[0]) {
        if (previous.rows[0].sha256 !== sha256Hex(JSON.stringify(report))) throw domainError("REPORT_REVISION_CONFLICT", "Revision ID already binds different report bytes");
        const sealed = previous.rows[0].sealed || await sealAvailablePackage(client, report.revisionId);
        return { reportId: report.reportId, reportVersionId: report.revisionId, duplicate: true, registration: sealed ? "sealed" : "storage_pending", admission: "not_evaluated" };
      }
      await verifyReferences(client, report);
      const structure = await this.config.artifacts.putWith(client, { tenantId: input.tenantId, artifactType: "research_report_structure", text: JSON.stringify(report), mediaType: "application/json" });
      const markdown = await this.config.artifacts.putWith(client, { tenantId: input.tenantId, artifactType: "knowledge_report_markdown", text: rendered.markdown });
      const manifest = await this.config.artifacts.putWith(client, { tenantId: input.tenantId, artifactType: "research_report_manifest", value: {
        schemaVersion: "research-report-manifest.v1", reportId: report.reportId, revisionId: report.revisionId,
        structure, markdown, inputs: report.inputArtifacts,
        evidenceManifests: report.sections.flatMap((section) => section.blocks.flatMap((block) => block.assertions.flatMap((assertion) => assertion.claims.map((claim) => claim.evidenceManifest)))),
        admission: "not_evaluated",
      } });
      for (const artifact of [structure, markdown, manifest]) if (artifact.bucket !== REPORT_BUCKET) throw domainError("REPORT_BUCKET_MISMATCH", "Report artifacts must use research-reports");
      await insertPackage(client, { report, structure, markdown });
      for (const [role, artifact] of [["structure", structure], ["markdown", markdown], ["manifest", manifest]] as const) await client.query("insert into research.report_artifact(report_version_id,artifact_id,role) values($1,$2,$3)", [report.revisionId, artifact.artifactId, role]);
      for (const artifact of report.inputArtifacts) await client.query("insert into research.report_artifact(report_version_id,artifact_id,role) values($1,$2,'input') on conflict do nothing", [report.revisionId, artifact.artifactId]);
      await writeReportProjections(client, { report, markdownArtifactId: markdown.artifactId, assertions: rendered.assertions });
      const available = await sealAvailablePackage(client, report.revisionId);
      return { reportId: report.reportId, reportVersionId: report.revisionId, registration: available ? "sealed" : "storage_pending", admission: "not_evaluated", artifacts: { structure, markdown, manifest }, assertionCount: rendered.assertions.length };
    });
  }

  async get(input: { tenantId: string; reportVersionId: string }): Promise<ReportPackageRead> {
    return this.config.db.transaction({ tenantId: input.tenantId, role: "pipeline_agent", readOnly: true }, async (client) => {
      const revision = (await client.query("select * from research.report_package where report_version_id=$1", [input.reportVersionId])).rows[0];
      if (!revision) throw domainError("REPORT_NOT_FOUND", "Report revision is not available for this tenant");
      const artifacts = await client.query(`select r.role,a.id artifact_id,a.sha256,a.storage_bucket,a.object_path,a.storage_state,a.media_type,a.size_bytes
        from research.report_artifact r join orchestration.artifact a on a.id=r.artifact_id where r.report_version_id=$1 order by r.role,a.id`, [input.reportVersionId]);
      const sections = await client.query("select * from research.report_section_version where report_version_id=$1 order by ordinal", [input.reportVersionId]);
      const questions = await client.query("select * from research.report_question where report_version_id=$1 order by question_key", [input.reportVersionId]);
      const assertions = await client.query("select * from research.report_assertion where report_version_id=$1 order by start_utf16,id", [input.reportVersionId]);
      const claimBindings = await client.query("select * from research.report_assertion_claim where report_version_id=$1 order by assertion_id,run_id,claim_key,role", [input.reportVersionId]);
      const dependencies = await client.query("select * from research.report_section_dependency where report_version_id=$1 order by section_id,required_version_id,required_section_id", [input.reportVersionId]);
      const questionSections = await client.query("select * from research.report_question_section where report_version_id=$1 order by question_key,section_id", [input.reportVersionId]);
      const ingestionLinks = await client.query("select * from research.report_ingestion_link where report_version_id=$1 order by created_at,id", [input.reportVersionId]);
      const assessments = await client.query("select * from research.report_assessment where report_version_id=$1 order by created_at,id", [input.reportVersionId]);
      const seal = await client.query("select * from research.report_package_seal where report_version_id=$1", [input.reportVersionId]);
      return { revision, sections: sections.rows, questions: questions.rows, assertions: assertions.rows, claimBindings: claimBindings.rows, dependencies: dependencies.rows, questionSections: questionSections.rows, ingestionLinks: ingestionLinks.rows, assessments: assessments.rows, artifacts: artifacts.rows, seal: seal.rows[0] ?? null, admission: "not_evaluated" };
    });
  }
}

async function sealAvailablePackage(client: TenantSqlClient, reportVersionId: string): Promise<boolean> {
  const artifacts = (await client.query<{ artifact_id: string; role: string; storage_state: string }>(`select r.artifact_id,r.role,a.storage_state from research.report_artifact r
    join orchestration.artifact a on a.id=r.artifact_id where r.report_version_id=$1`, [reportVersionId])).rows;
  if (artifacts.some((artifact) => artifact.storage_state !== "available")) return false;
  const manifest = artifacts.find((artifact) => artifact.role === "manifest");
  if (!manifest) throw domainError("REPORT_MANIFEST_MISSING", "Registered package has no manifest");
  await client.query("insert into research.report_package_seal(report_version_id,manifest_artifact_id) values($1,$2)", [reportVersionId, manifest.artifact_id]);
  return true;
}

async function verifyReferences(client: TenantSqlClient, report: ReportStructure): Promise<void> {
  const references = [...report.inputArtifacts, ...report.sections.flatMap((section) => section.blocks.flatMap((block) => block.assertions.flatMap((assertion) => assertion.claims.map((claim) => claim.evidenceManifest))))];
  for (const reference of references) {
    const row = (await client.query<{ sha256: string; storage_state: string }>("select sha256,storage_state from orchestration.artifact where id=$1", [reference.artifactId])).rows[0];
    if (!row || row.sha256 !== reference.digest.slice(7) || row.storage_state !== "available") throw domainError("REPORT_INPUT_UNAVAILABLE", "Input or evidence manifest is missing, changed or unavailable", { artifactId: reference.artifactId });
  }
}

async function insertPackage(client: TenantSqlClient, input: { report: ReportStructure; structure: ArtifactRecord; markdown: ArtifactRecord }): Promise<void> {
  const { report } = input;
  await client.query("insert into research.report(id,slug,title,report_type,purpose) values($1,$2,$3,$4,$5) on conflict(id) do nothing", [report.reportId, report.slug, report.title, report.reportType, report.purpose]);
  await client.query("insert into research.report_version(id,report_id,version,markdown_artifact_id,json_artifact_id) values($1,$2,$3,$4,$5)", [report.revisionId, report.reportId, report.version, input.markdown.artifactId, input.structure.artifactId]);
  await client.query(`insert into research.report_package(report_version_id,report_id,authoring_mode,title,scope,as_of,producer_attempt_id,producer_identity,producer_version,predecessor_version_id)
    values($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10)`, [report.revisionId, report.reportId, report.authoringMode, report.title, JSON.stringify(report.scope), report.asOf, report.producer.attemptId ?? null, report.producer.identity, report.producer.version, report.predecessorVersionId ?? null]);
}
