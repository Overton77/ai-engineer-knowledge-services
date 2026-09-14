import { randomUUID } from "node:crypto";
import { ArtifactLedger, sha256Hex } from "@aiengineer/knowledge-db-read";
import { TenantPostgres } from "@aiengineer/knowledge-persistence";
import { InMemoryArtifactStore } from "@aiengineer/knowledge-runtime";
import { afterAll, describe, expect, it } from "vitest";
import { REPORT_BUCKET, ReportService } from "./service.js";
import { ReportStructureSchema } from "./structure.js";
import { IngestionIntentSchema } from "../intent.js";
import type { IngestionReceipt } from "../receipt.js";
import { linkReportIngestion } from "./ingestion-links.js";
import { reportFixture } from "./test-fixtures.js";

const databaseUrl = process.env.REPORT_TEST_DATABASE_URL;
if (databaseUrl && (!new URL(databaseUrl).pathname.startsWith("/disposable_") || !["localhost", "127.0.0.1"].includes(new URL(databaseUrl).hostname))) throw new Error("REPORT_TEST_DATABASE_MUST_BE_DISPOSABLE_LOCAL");

describe.skipIf(!databaseUrl)("report registration on isolated PostgreSQL", () => {
  const db = new TenantPostgres({ connectionString: databaseUrl ?? "postgresql://unused", maximumPoolSize: 2 });
  const store = new InMemoryArtifactStore();
  const artifacts = new ArtifactLedger({ db, store, bucket: REPORT_BUCKET, uploaded: true, executorVersion: "report-test/1" });
  const reports = new ReportService({ db, artifacts });
  const tenantId = "00000000-0000-7000-8000-000000000001";
  const freshReport = () => ({ ...reportFixture(), reportId: randomUUID(), revisionId: randomUUID(), slug: `report-${randomUUID()}` });
  afterAll(() => db.close());

  it("registers, seals, reads and replays exact revisions without implying admission", async () => {
    const report = freshReport();
    expect(await reports.register({ tenantId, report })).toMatchObject({ registration: "sealed", admission: "not_evaluated", assertionCount: 1 });
    expect(await reports.register({ tenantId, report })).toMatchObject({ registration: "sealed", duplicate: true });
    const result = await reports.get({ tenantId, reportVersionId: report.revisionId });
    expect(result.seal).not.toBeNull();
    const markdownId = String(result.artifacts.find((artifact) => artifact.role === "markdown")!.artifact_id);
    const markdown = await artifacts.get(tenantId, markdownId);
    const assertion = await db.transaction({ tenantId, role: "pipeline_agent", readOnly: true }, async (client) => (await client.query<{ proposition: string; start_utf16: number; end_utf16: number }>("select proposition,start_utf16,end_utf16 from research.report_assertion where report_version_id=$1", [report.revisionId])).rows[0]!);
    expect(markdown.text!.slice(assertion.start_utf16, assertion.end_utf16)).toBe(assertion.proposition);
    await expect(reports.register({ tenantId, report: { ...report, title: "Changed" } })).rejects.toThrow(/different report bytes/);
    await expect(reports.get({ tenantId: "00000000-0000-7000-8000-000000000002", reportVersionId: report.revisionId })).rejects.toThrow(/not available/);
  });
  it("supports subsequent post-research assembly and stable section identity", async () => {
    const first = freshReport();
    await reports.register({ tenantId, report: first });
    const second = { ...first, revisionId: randomUUID(), version: 2, predecessorVersionId: first.revisionId, authoringMode: "post_research" };
    expect(await reports.register({ tenantId, report: second })).toMatchObject({ registration: "sealed" });
    const count = await db.transaction({ tenantId, role: "pipeline_agent", readOnly: true }, async (client) => (await client.query<{ count: string }>("select count(distinct section_id) from research.report_section_version where report_id=$1", [first.reportId])).rows[0]!.count);
    expect(count).toBe("1");
  });
  it("rolls back registration when upload readback fails", async () => {
    const failedStore = { put: store.put.bind(store), get: async () => undefined };
    const service = new ReportService({ db, artifacts: new ArtifactLedger({ db, store: failedStore, bucket: REPORT_BUCKET, uploaded: true, executorVersion: "test" }) });
    const report = freshReport();
    await expect(service.register({ tenantId, report })).rejects.toThrow(/could not be verified/);
    await expect(reports.get({ tenantId, reportVersionId: report.revisionId })).rejects.toThrow(/not available/);
  });
  it("registers under a non-default tenant and rejects cross-tenant reads", async () => {
    const otherTenant = randomUUID();
    const report = freshReport();
    expect(await reports.register({ tenantId: otherTenant, report })).toMatchObject({ registration: "sealed" });
    const result = await reports.get({ tenantId: otherTenant, reportVersionId: report.revisionId });
    expect(result.revision.tenant_id).toBe(otherTenant);
    await expect(reports.get({ tenantId, reportVersionId: report.revisionId })).rejects.toThrow(/not available/);
  });
  it("retains equal claim keys from separate runs and rejects mismatched manifest digests", async () => {
    const report = ReportStructureSchema.parse(freshReport());
    const evidence = await artifacts.put({ tenantId, artifactType: "research_report_verification", value: { run: randomUUID() } });
    const assertion = report.sections[0]!.blocks[0]!.assertions[0]!;
    assertion.kind = "reported";
    assertion.claims = ["run-a", "run-b"].map((runId) => ({ runId, claimId: "shared-key", digest: `sha256:${"a".repeat(64)}`, evidenceManifest: { artifactId: evidence.artifactId, digest: evidence.digest }, role: "supports" }));
    await reports.register({ tenantId, report });
    const result = await reports.get({ tenantId, reportVersionId: report.revisionId });
    expect(result.claimBindings.map((binding) => [binding.run_id, binding.claim_key])).toEqual([["run-a", "shared-key"], ["run-b", "shared-key"]]);
    const changed = { ...report, reportId: randomUUID(), revisionId: randomUUID(), slug: `report-${randomUUID()}` };
    assertion.claims[0]!.evidenceManifest.digest = `sha256:${"f".repeat(64)}`;
    await expect(reports.register({ tenantId, report: changed })).rejects.toThrow(/missing, changed or unavailable/);
    await expect(reports.get({ tenantId, reportVersionId: changed.revisionId })).rejects.toThrow(/not available/);
  });
  it("seals a pending revision on retry only after artifact readback and availability confirmation", async () => {
    const pending = new ReportService({ db, artifacts: new ArtifactLedger({ db, store, bucket: REPORT_BUCKET, uploaded: false, executorVersion: "report-test/1" }) });
    const report = { ...freshReport(), title: `Pending ${randomUUID()}` };
    const registered = await pending.register({ tenantId, report });
    expect(registered.registration).toBe("storage_pending");
    expect(await pending.register({ tenantId, report })).toMatchObject({ registration: "storage_pending", duplicate: true });
    for (const artifact of Object.values(registered.artifacts!)) {
      const bytes = await store.get(tenantId, artifact.digest);
      expect(bytes).toBeDefined();
      expect(`sha256:${sha256Hex(bytes!)}`).toBe(artifact.digest);
    }
    await db.transaction({ tenantId, role: "control_plane" }, (client) => client.query(`update orchestration.artifact set storage_state='available',available_at=now()
      where id in (select artifact_id from research.report_artifact where report_version_id=$1) and storage_state='pending'`, [report.revisionId]));
    expect(await pending.register({ tenantId, report })).toMatchObject({ registration: "sealed", duplicate: true });
    expect((await reports.get({ tenantId, reportVersionId: report.revisionId })).seal).not.toBeNull();
  });
  it("appends an ingestion receipt binding to a sealed report and reads it with assertion identity", async () => {
    const report = freshReport();
    await reports.register({ tenantId, report });
    const operationIntentId = randomUUID();
    const receiptId = randomUUID();
    const intent = IngestionIntentSchema.parse({ schemaVersion: "knowledge-ingestion-intent.v1", intentId: "report-link", context: { tenantId }, proposals: [{ kind: "candidate.stage", proposalId: "p1", entityKind: "product", displayName: "Review candidate", reason: "needs_human", reportBinding: { reportVersionId: report.revisionId, assertionKey: "a1" } }] });
    const digest = `sha256:${"a".repeat(64)}` as const;
    const receipt: IngestionReceipt = {
      schemaVersion: "knowledge-ingestion-receipt.v1", receiptId, operationIntentId,
      intentRef: { intentId: intent.intentId, intentDigest: digest, idempotencyKey: digest }, planRef: { planId: "report-link-plan" }, outcome: "partial",
      knowledgeBatch: null, head: { before: 0, after: 0, rebased: false }, proposals: [{ proposalId: "p1", outcome: "held", reason: "Needs human review" }],
      subjects: [], claims: [], affectedRefs: [], duplicateOf: null, priorReceiptsForIntentId: [], failure: null,
      storage: { storageState: "none" }, verify: null, executedAt: new Date().toISOString(), executorVersion: "report-test/1",
    };
    await db.transaction({ tenantId, role: "executor_service" }, async (client) => {
      await client.query("insert into orchestration.operation_intent(id,tenant_id,intent_type,payload,idempotency_key) values($1,$2,'knowledge_ingestion',$3::jsonb,$4)", [operationIntentId, tenantId, JSON.stringify(intent), randomUUID()]);
      await client.query("insert into orchestration.operation_receipt(id,intent_id,executor_version,outcome) values($1,$2,'report-test/1','partial')", [receiptId, operationIntentId]);
      await linkReportIngestion(client, { intent, receipt });
    });
    const result = await reports.get({ tenantId, reportVersionId: report.revisionId });
    expect(result.ingestionLinks).toHaveLength(1);
    expect(result.ingestionLinks[0]).toMatchObject({ intent_id: operationIntentId, receipt_id: receiptId, assertion_id: result.assertions[0]!.id, proposal_id: "p1", outcome: "held" });
    expect(result.seal).not.toBeNull();
  });

});
