import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PostgresCanonicalRepository } from "@aiengineer/knowledge-persistence";
import { disposableDatabaseUrl } from "../../../../packages/persistence/test/disposable.mjs";
import { canonicalUnadmittedClosure } from "./recovery-host-canonical.js";

const databaseUrl = disposableDatabaseUrl();

describe.skipIf(!databaseUrl)("native recovery dependency authority", () => {
  it("requires every native operation and rejects unknown, wrong-tenant, wrong-kind and direct-intent references", async () => {
    const database = new PostgresCanonicalRepository({ connectionString: databaseUrl! });
    const tenantId = randomUUID(), operationId = randomUUID(), intentId = randomUUID(), otherKind = randomUUID();
    try {
      await database.transaction(tenantId, async client => {
        for (const [id, kind] of [[operationId, "verification_claims"], [otherKind, "fixture_non_verification"]]) {
          await client.query(`insert into knowledge_service.operation
            (id,tenant_id,operation_kind,idempotency_key,correlation_id,actor_identity,request,request_sha256)
            values($1,$2,$3,$4,$1,'recovery-authority-fixture','{}',$5)`, [id, tenantId, kind, id, "a".repeat(64)]);
        }
        await client.query(`insert into orchestration.operation_intent(id,tenant_id,intent_type,payload,idempotency_key)
          values($1,$2,'verify_claim','{}',$3)`, [intentId, tenantId, intentId]);
      });
      const input = { database, tenantId, caseId: "authority-fixture", planDigest: `sha256:${"b".repeat(64)}`, operationIds: [operationId] };
      // A queued fixture operation has no admitted outputs; this is not proof of verification execution.
      expect(await canonicalUnadmittedClosure(input)).toMatchObject({ complete: true, evaluations: [] });
      for (const operationIds of [[randomUUID()], [intentId], [otherKind], [operationId, randomUUID()]]) {
        await expect(canonicalUnadmittedClosure({ ...input, operationIds })).rejects.toThrow("RECOVERY_HOST_OPERATION_AUTHORITY_REQUIRED");
      }
      await expect(canonicalUnadmittedClosure({ ...input, tenantId: randomUUID() })).rejects.toThrow("RECOVERY_HOST_OPERATION_AUTHORITY_REQUIRED");
    } finally { await database.close(); }
  });
});
