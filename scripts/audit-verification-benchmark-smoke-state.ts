import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PostgresCanonicalRepository } from "@aiengineer/knowledge-persistence";
import { canonicalizeJson } from "@aiengineer/knowledge-verification";

const required = (name: string) => { const value = process.env[name]?.trim(); if (!value) throw new Error(`BENCHMARK_AUDIT_${name}_MISSING`); return value; };
const budget = JSON.parse(await (await import("node:fs/promises")).readFile(resolve("../internal/verification-provider-pilot-budget.json"), "utf8")) as { tenantId: string; budgetId: string };
const postgresUrl = required("POSTGRES_URL");
if (new URL(postgresUrl).port !== "54322") throw new Error("BENCHMARK_AUDIT_REFUSED_NONLOCAL_DATABASE");
const database = new PostgresCanonicalRepository({ connectionString: postgresUrl, localOnly: true, connectionTimeoutMs: 3_000 });
const rows = await database.transaction(budget.tenantId, async (client) => (await client.query<Record<string, unknown>>(`
  select m.id mission_id,m.slug,a.id orchestration_attempt_id,
    coalesce(v.state::text,'not_reserved') provider_state,
    v.provider_id,v.model,v.request_sha256,
    count(ar.id)::int artifact_count,
    count(ar.id) filter(where ar.artifact_type='verification_provider_request')::int request_artifact_count,
    count(ar.id) filter(where ar.artifact_type='verification_provider_raw_response')::int raw_response_artifact_count,
    count(ar.id) filter(where ar.artifact_type='verification_provider_response_envelope')::int response_envelope_artifact_count
  from orchestration.mission m
  join orchestration.work_item w on w.tenant_id=m.tenant_id and w.mission_id=m.id
  join orchestration.attempt a on a.tenant_id=w.tenant_id and a.work_item_id=w.id
  left join orchestration.verification_provider_attempt v on v.tenant_id=a.tenant_id and v.id=a.id
  left join orchestration.artifact ar on ar.tenant_id=a.tenant_id and ar.producer_attempt_id=a.id
  where m.tenant_id=$1 and m.slug like 'ws07-smoke-%'
  group by m.id,m.slug,a.id,v.state,v.provider_id,v.model,v.request_sha256
  order by m.created_at desc,a.started_at,a.id`, [budget.tenantId])).rows);
const budgetRow = await database.transaction(budget.tenantId, async (client) => (await client.query<Record<string, unknown>>("select id,ceiling_cost_micros,reserved_cost_micros,settled_cost_micros from orchestration.verification_provider_budget where tenant_id=$1 and id=$2", [budget.tenantId, budget.budgetId])).rows[0]);
await database.close();
const proofId = randomUUID(), receipt = { schemaVersion: "verification-benchmark-smoke-state-audit.v1", proofId, createdAt: new Date().toISOString(), tenantId: budget.tenantId, rows, budget: budgetRow ?? null };
const body = `${canonicalizeJson(receipt)}\n`, path = resolve("../internal", `verification-benchmark-smoke-state-audit-${proofId}.json`);
await writeFile(path, body, { flag: "wx" });
process.stdout.write(`${JSON.stringify({ path, sha256: createHash("sha256").update(body).digest("hex"), rows, budget: budgetRow ?? null }, null, 2)}\n`);
