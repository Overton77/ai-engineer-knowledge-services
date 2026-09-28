import { describe, expect, expectTypeOf, it } from "vitest";
import type { ContentAdmission, KnowledgeDatabase, KnowledgeRole, KnowledgeSqlClient, KnowledgeTransactionScope } from "@aiengineer/knowledge-db";
import { BOUNDED_ROLES, postgresContentAdmission, type BoundedRole, type TenantPostgres, type TenantSqlClient, type TransactionScope } from "@aiengineer/knowledge-persistence";

// This composition root injects persistence's adapters into knowledge-db's ports (FINAL-REVIEW R1).
// Method parameters are compared bivariantly, so the scope and role unions are pinned exactly here.
describe("knowledge-db ports composed from persistence", () => {
  it("persistence adapters satisfy the ports knowledge-db owns", () => {
    expectTypeOf<TenantPostgres>().toExtend<KnowledgeDatabase>();
    expectTypeOf<TenantSqlClient>().toExtend<KnowledgeSqlClient>();
    expectTypeOf<KnowledgeSqlClient>().toExtend<TenantSqlClient>();
    expectTypeOf(postgresContentAdmission).toExtend<ContentAdmission>();
    expectTypeOf<KnowledgeRole>().toEqualTypeOf<BoundedRole>();
    expectTypeOf<KnowledgeTransactionScope>().toEqualTypeOf<TransactionScope>();
  });

  it("keeps the bounded role set knowledge-db names", () => {
    const roles: readonly KnowledgeRole[] = BOUNDED_ROLES;
    expect(roles).toEqual(["app_reader", "pipeline_agent", "executor_service", "verifier_agent", "control_plane"]);
  });
});
