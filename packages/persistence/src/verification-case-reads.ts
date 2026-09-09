import { UuidSchema, VerificationCaseSummaryResourceSchema, VerificationEvidenceResourceSchema } from "@aiengineer/knowledge-contracts";
import type { VerificationAuditBundle } from "@aiengineer/knowledge-verification";
import type { PostgresCanonicalRepository, TenantSqlClient } from "./postgres.js";

type Row = Record<string, unknown>;
const iso = (value: unknown) => value instanceof Date ? value.toISOString() : String(value);
const artifact = (row: Row, prefix: string) => ({ artifactId: row[`${prefix}_id`], digest: `sha256:${String(row[`${prefix}_sha256`])}`, mediaType: row[`${prefix}_media_type`], sizeBytes: Number(row[`${prefix}_size_bytes`]) });
const caseColumns = `c.id,c.tenant_id,c.verification_run_id,c.case_key,c.created_at,
 c.input_artifact_id as input_id,c.input_sha256,i.media_type as input_media_type,i.size_bytes as input_size_bytes,
 c.result_artifact_id as result_id,c.result_sha256,r.media_type as result_media_type,r.size_bytes as result_size_bytes`;
const caseJoins = `left join orchestration.artifact i on i.tenant_id=c.tenant_id and i.id=c.input_artifact_id and i.sha256=c.input_sha256 and i.storage_state='available'
 left join orchestration.artifact r on r.tenant_id=c.tenant_id and r.id=c.result_artifact_id and r.sha256=c.result_sha256 and r.storage_state='available'`;
const evidenceColumns = `e.id,e.tenant_id,e.case_run_id,e.evidence_key,e.ordinal,e.created_at,c.verification_run_id,
 e.artifact_id,e.artifact_sha256,a.media_type as artifact_media_type,a.size_bytes as artifact_size_bytes`;
const evidenceJoins = `join evidence.verification_case_run c on c.tenant_id=e.tenant_id and c.id=e.case_run_id
 left join orchestration.artifact a on a.tenant_id=e.tenant_id and a.id=e.artifact_id and a.sha256=e.artifact_sha256 and a.storage_state='available'`;

function caseSummary(row: Row) {
  return VerificationCaseSummaryResourceSchema.parse({ verificationContractVersion: "verification.v1", tenantId: row.tenant_id, runId: row.verification_run_id, caseRunId: row.id, caseKey: row.case_key, inputArtifact: artifact(row, "input"), resultArtifact: artifact(row, "result"), createdAt: iso(row.created_at) });
}
function evidenceResource(row: Row) {
  return VerificationEvidenceResourceSchema.parse({ verificationContractVersion: "verification.v1", tenantId: row.tenant_id, runId: row.verification_run_id, caseRunId: row.case_run_id, evidenceId: row.id, evidenceKey: row.evidence_key, ordinal: row.ordinal, kind: "artifact", artifact: artifact(row, "artifact"), createdAt: iso(row.created_at) });
}

/** SQL projections only. The application must authorize and validate the sealed parent. */
export class PostgresVerificationCaseReads {
  constructor(private readonly database: PostgresCanonicalRepository, private readonly audits: { loadAuditBundle(tenantId: string, runId: string): Promise<VerificationAuditBundle> }) {}

  loadAuditBundle(tenantId: string, runId: string): Promise<VerificationAuditBundle> {
    return this.audits.loadAuditBundle(UuidSchema.parse(tenantId), UuidSchema.parse(runId));
  }

  async listVerificationRunCases(input: { tenantId: string; runId: string; pageSize: number; cursor?: string }) {
    UuidSchema.parse(input.tenantId); UuidSchema.parse(input.runId);
    if (input.cursor !== undefined) UuidSchema.parse(input.cursor);
    if (!Number.isInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > 100) throw new Error("VERIFICATION_CASE_PAGE_INVALID");
    return this.database.transaction(input.tenantId, async (client) => {
      const rows = (await client.query<Row>(`select ${caseColumns} from evidence.verification_case_run c ${caseJoins}
        where c.tenant_id=$1 and c.verification_run_id=$2 and ($3::uuid is null or c.id>$3::uuid) order by c.id limit $4`, [input.tenantId, input.runId, input.cursor ?? null, input.pageSize + 1])).rows;
      const cases = rows.slice(0, input.pageSize).map(caseSummary);
      return { verificationContractVersion: "verification.v1" as const, tenantId: input.tenantId, runId: input.runId, cases,
        ...(rows.length > input.pageSize ? { nextCursor: cases.at(-1)!.caseRunId } : {}) };
    });
  }

  async getVerificationCase(input: { tenantId: string; caseRunId: string }) {
    UuidSchema.parse(input.tenantId); UuidSchema.parse(input.caseRunId);
    return this.database.transaction(input.tenantId, async (client) => {
      const row = (await client.query<Row>(`select ${caseColumns} from evidence.verification_case_run c ${caseJoins} where c.tenant_id=$1 and c.id=$2`, [input.tenantId, input.caseRunId])).rows[0];
      if (row === undefined) return undefined;
      return { ...caseSummary(row), evidence: await this.#evidence(client, input) };
    });
  }

  async getVerificationEvidence(input: { tenantId: string; evidenceId: string }) {
    UuidSchema.parse(input.tenantId); UuidSchema.parse(input.evidenceId);
    return this.database.transaction(input.tenantId, async (client) => {
      const row = (await client.query<Row>(`select ${evidenceColumns} from evidence.verification_case_evidence e ${evidenceJoins} where e.tenant_id=$1 and e.id=$2`, [input.tenantId, input.evidenceId])).rows[0];
      return row === undefined ? undefined : evidenceResource(row);
    });
  }

  async #evidence(client: TenantSqlClient, input: { tenantId: string; caseRunId: string }) {
    const rows = (await client.query<Row>(`select ${evidenceColumns} from evidence.verification_case_evidence e ${evidenceJoins} where e.tenant_id=$1 and e.case_run_id=$2 order by e.ordinal limit 257`, [input.tenantId, input.caseRunId])).rows;
    if (rows.length > 256) throw new Error("VERIFICATION_CASE_EVIDENCE_BOUND_EXCEEDED");
    return rows.map(evidenceResource);
  }
}
