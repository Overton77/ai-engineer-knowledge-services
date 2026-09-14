import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ArtifactLedger } from "../packages/db-read/dist/index.js";
import { TenantPostgres } from "../packages/persistence/dist/index.js";
import { SupabaseArtifactStore } from "../packages/runtime/dist/index.js";
import { REPORT_BUCKET, ReportService } from "../packages/ingestion/dist/index.js";

const projectRef = "wkythqbofmckbuoothhn";
if (!process.argv.includes(`--project-ref=${projectRef}`)) throw new Error("Explicit --project-ref=wkythqbofmckbuoothhn required");
const databaseUrl = process.env.POSTGRES_URL_NON_POOLING;
if (!databaseUrl || !new URL(databaseUrl).username.endsWith(`.${projectRef}`)) throw new Error("Cloud project connection mismatch");
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) throw new Error("Storage server credential required");
const tenantId = "93000000-0000-7000-8000-000000000001";
const db = new TenantPostgres({ connectionString: databaseUrl, maximumPoolSize: 2 });
const store = new SupabaseArtifactStore({ projectUrl: `https://${projectRef}.supabase.co`, serviceRoleKey: key, bucket: REPORT_BUCKET, maximumBytes: 1_000_000 });
const artifacts = new ArtifactLedger({ db, store, bucket: REPORT_BUCKET, uploaded: true, executorVersion: "report-package-proof/1" });
const reports = new ReportService({ db, artifacts });
const report = {
  schemaVersion: "research-report.v1", reportId: "93000000-0000-7000-8000-000000000101", revisionId: "93000000-0000-7000-8000-000000000102", version: 1,
  slug: "report-contract-v1-smoke", title: "Report package storage smoke fixture", reportType: "contract_fixture", purpose: "Validate report custody without admitting research facts",
  authoringMode: "incremental", asOf: "2026-09-13T00:00:00Z", scope: { synthetic: true, eligibleForOfficialKnowledge: false }, producer: { identity: "report-package-proof", version: "1" },
  sections: [{ key: "illustration", heading: "Illustrative text", kind: "finding", blocks: [{ key: "example", markdown: "🧪 Cafe\u0301 example.", assertions: [{ key: "example-span", kind: "illustrative", start: 3, end: 8 }] }] }],
  questions: [{ key: "research-gap", question: "Has this fixture established a real-world research finding?", coverage: "unanswered", explanation: "This is a synthetic storage and contract fixture, not factual research.", sectionKeys: [] }],
};

try {
  const first = await reports.register({ tenantId, report });
  assert.equal(first.registration, "sealed");
  assert.equal(first.admission, "not_evaluated");
  const read = await reports.get({ tenantId, reportVersionId: report.revisionId });
  for (const artifact of read.artifacts) {
    assert.equal(artifact.storage_bucket, REPORT_BUCKET);
    const fetched = await artifacts.get(tenantId, artifact.artifact_id);
    assert.ok(fetched.text || fetched.json);
  }
  const markdown = await artifacts.get(tenantId, read.artifacts.find((artifact) => artifact.role === "markdown").artifact_id);
  assert.ok(markdown.text.includes("Cafe\u0301"));
  const span = await db.transaction({ tenantId, role: "pipeline_agent", readOnly: true }, async (client) => (await client.query("select proposition,start_utf16,end_utf16 from research.report_assertion where report_version_id=$1", [report.revisionId])).rows[0]);
  assert.equal(markdown.text.slice(span.start_utf16, span.end_utf16), span.proposition);
  const structure = read.artifacts.find((artifact) => artifact.role === "structure");
  const secondReport = { ...report, revisionId: "93000000-0000-7000-8000-000000000103", version: 2, predecessorVersionId: report.revisionId, authoringMode: "post_research", inputArtifacts: [{ artifactId: structure.artifact_id, digest: `sha256:${structure.sha256}` }] };
  const second = await reports.register({ tenantId, report: secondReport });
  assert.equal(second.registration, "sealed");
  const duplicate = await reports.register({ tenantId, report: secondReport });
  assert.equal(duplicate.duplicate, true);
  await assert.rejects(reports.get({ tenantId: "93000000-0000-7000-8000-000000000002", reportVersionId: report.revisionId }), /not available/);
  const receipt = { projectRef, tenantId, reportId: report.reportId, revisionIds: [report.revisionId, secondReport.revisionId], bucket: REPORT_BUCKET, checks: { uploadReadback: true, freshArtifactRead: true, exactUtf16Span: true, incremental: true, postResearchFromArtifact: true, duplicateRecovery: true, crossTenantDenied: true }, admission: "not_evaluated", recordedAt: new Date().toISOString() };
  writeFileSync(resolve(import.meta.dirname, "../docs/report-package-smoke.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt, null, 2));
} finally {
  await db.close();
}
