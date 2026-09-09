import { ActorSchema, UuidSchema } from "@aiengineer/knowledge-contracts";
import { VerificationAdjudicationDecisionError, type VerificationAdjudicationDecisionPreparationPort, type VerificationAdjudicationReadService } from "@aiengineer/knowledge-application";
import { z } from "zod";
import type { PostgresCanonicalRepository } from "./postgres.js";

const scopeSchema = z.strictObject({tenantId: UuidSchema, subjectId: UuidSchema, actor: ActorSchema});
const roleSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const syntheticGrantSchema = z.strictObject({tenantId: UuidSchema, actorId: UuidSchema, role: roleSchema});
type SyntheticGrant = z.infer<typeof syntheticGrantSchema>;

/** Server configuration is an exact tenant/actor allowlist, empty by default.
 * Human authority is read only from canonical grants. No request supplies roles. */
export class PostgresVerificationAdjudicationDecisionPreparation implements VerificationAdjudicationDecisionPreparationPort {
  readonly #syntheticGrants: readonly SyntheticGrant[];
  constructor(
    private readonly database: Pick<PostgresCanonicalRepository, "transaction">,
    private readonly reader: Pick<VerificationAdjudicationReadService, "getPendingSubject">,
    syntheticGrants: readonly SyntheticGrant[] = [],
  ) {
    this.#syntheticGrants = z.array(syntheticGrantSchema).parse(syntheticGrants);
  }

  async authorizeReviewer(input: Parameters<VerificationAdjudicationDecisionPreparationPort["authorizeReviewer"]>[0]) {
    const scope = scopeSchema.parse(input);
    if (scope.actor.kind === "model") return undefined;
    if (scope.actor.kind === "service") {
      if (scope.actor.serviceIdentity !== "human_reviewer") return undefined;
      const matches = this.#syntheticGrants.filter(grant => grant.tenantId === scope.tenantId && grant.actorId === scope.actor.id);
      if (matches.length !== 1) return undefined;
      return {provenance: "synthetic_engineering" as const, role: matches[0]!.role};
    }
    return this.database.transaction(scope.tenantId, async client => {
      const result = await client.query(`select g.id, g.reviewer_role, g.expires_at
        from evidence.verification_adjudication_reviewer_grant g
        join evidence.verification_adjudication_subject s on s.tenant_id=g.tenant_id and s.id=g.subject_id
        where g.tenant_id=$1 and g.subject_id=$2 and g.reviewer_actor_id=$3
        and (g.expires_at is null or g.expires_at>clock_timestamp())
        and g.reviewer_role=any(s.eligible_reviewer_roles)
        order by g.id`, [scope.tenantId, scope.subjectId, scope.actor.id]);
      const row = result.rows[0];
      if (!row) return undefined;
      return {provenance: "human_origin" as const, grantId: UuidSchema.parse(row.id), role: roleSchema.parse(row.reviewer_role),
        ...(row.expires_at == null ? {} : {expiresAt: z.iso.datetime().parse(row.expires_at instanceof Date ? row.expires_at.toISOString() : row.expires_at)})};
    });
  }

  async loadVerifiedSubject(input: Parameters<VerificationAdjudicationDecisionPreparationPort["loadVerifiedSubject"]>[0]) {
    const scope = scopeSchema.parse(input);
    const operationId = await this.database.transaction(scope.tenantId, async client => {
      const result = await client.query("select request_operation_id from evidence.verification_adjudication_subject where tenant_id=$1 and id=$2", [scope.tenantId, scope.subjectId]);
      if (result.rows.length !== 1) throw new VerificationAdjudicationDecisionError("BINDING");
      return UuidSchema.parse(result.rows[0]!.request_operation_id);
    });
    const subject = await this.reader.getPendingSubject({tenantId: scope.tenantId, operationId});
    if (subject.tenantId !== scope.tenantId || subject.operationId !== operationId || subject.output.subjectId !== scope.subjectId) throw new VerificationAdjudicationDecisionError("BINDING");
    return subject;
  }
}
