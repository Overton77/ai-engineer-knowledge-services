import {
  OperationContextSchema,
  UuidSchema,
  VerificationArtifactHandleSchema,
  type OperationContext,
  type VerificationArtifactHandle,
} from "@aiengineer/knowledge-contracts";
import type { VerificationMetricRuntimePrincipalPort } from "@aiengineer/knowledge-application";
import { digestCanonicalJson, type RuntimePrincipalBinding } from "@aiengineer/knowledge-verification";
import type { PostgresCanonicalRepository, TenantSqlClient } from "./postgres.js";

type MetricRuntimePrincipalDatabase = Pick<PostgresCanonicalRepository, "transaction">;

interface PrincipalRow extends Record<string, unknown> {
  readonly artifact_id: string;
  readonly artifact_tenant_id: string;
  readonly artifact_sha256: string;
  readonly artifact_mission_id: string | null;
  readonly producer_attempt_id: string;
  readonly producer_work_item_id: string;
  readonly producer_mission_id: string;
  readonly producer_deployment_id: string | null;
  readonly verifier_attempt_id: string;
  readonly verifier_work_item_id: string;
  readonly verifier_mission_id: string;
  readonly verifier_deployment_id: string | null;
}

function nonEmptyDatabaseText(value: string | null, code: string): string {
  if (!value || value.trim().length === 0) throw new Error(code);
  return value;
}

function databaseUuid(value: string, code: string): string {
  if (!UuidSchema.safeParse(value).success) throw new Error(code);
  return value;
}

function requireRuntimeContext(context: OperationContext): Required<Pick<OperationContext, "missionId" | "workItemId">> {
  if (!context.missionId || !context.workItemId) throw new Error("VERIFICATION_METRIC_CONTEXT_OWNERSHIP_REQUIRED");
  return { missionId: context.missionId, workItemId: context.workItemId };
}

/**
 * Derives metric runtime principals from tenant-scoped durable ownership rows.
 * Observations artifact metadata supplies the producer; the authenticated
 * operation context supplies the verifier. Serialized bundle identities are
 * deliberately absent from this port.
 */
export class PostgresVerificationMetricRuntimePrincipals implements VerificationMetricRuntimePrincipalPort {
  constructor(private readonly database: MetricRuntimePrincipalDatabase) {}

  async bind(input: {
    readonly context: OperationContext;
    readonly observationsArtifact: VerificationArtifactHandle;
    readonly captureIds: readonly string[];
  }): Promise<{ readonly runtimePrincipals: RuntimePrincipalBinding; readonly producerAttemptId: string }> {
    const context = OperationContextSchema.parse(input.context);
    const observationsArtifact = VerificationArtifactHandleSchema.parse(input.observationsArtifact);
    const ownership = requireRuntimeContext(context);
    if (observationsArtifact.tenantId !== context.tenantId) throw new Error("VERIFICATION_METRIC_OBSERVATIONS_ARTIFACT_TENANT_MISMATCH");

    const row = await this.database.transaction(context.tenantId, async (client) => this.#readPrincipalRow(client, context, observationsArtifact));
    if (!row) throw new Error("VERIFICATION_METRIC_RUNTIME_BINDING_NOT_FOUND");
    this.#assertRow(row, context, observationsArtifact, ownership);

    const producerAttemptId = databaseUuid(row.producer_attempt_id, "VERIFICATION_METRIC_PRODUCER_OWNERSHIP_MISMATCH");
    const producerDeploymentId = nonEmptyDatabaseText(row.producer_deployment_id, "VERIFICATION_METRIC_PRODUCER_DEPLOYMENT_REQUIRED");
    const verifierDeploymentId = nonEmptyDatabaseText(row.verifier_deployment_id, "VERIFICATION_METRIC_VERIFIER_DEPLOYMENT_REQUIRED");
    return Object.freeze({
      producerAttemptId,
      runtimePrincipals: {
        basis: "runtime_principal_binding" as const,
        producerDeploymentId,
        verifierDeploymentId,
        producerPrincipalDigest: digestCanonicalJson({
          schemaVersion: "verification-metric-runtime-principal.v1",
          role: "producer",
          tenantId: context.tenantId,
          artifactId: observationsArtifact.artifactId,
          attemptId: producerAttemptId,
          workItemId: row.producer_work_item_id,
          missionId: row.producer_mission_id,
          deploymentId: producerDeploymentId,
        }),
        verifierPrincipalDigest: digestCanonicalJson({
          schemaVersion: "verification-metric-runtime-principal.v1",
          role: "verifier",
          tenantId: context.tenantId,
          attemptId: row.verifier_attempt_id,
          workItemId: row.verifier_work_item_id,
          missionId: row.verifier_mission_id,
          deploymentId: verifierDeploymentId,
        }),
      },
    });
  }

  async #readPrincipalRow(client: TenantSqlClient, context: OperationContext, artifact: VerificationArtifactHandle): Promise<PrincipalRow | undefined> {
    return (await client.query<PrincipalRow>(`select
        artifact.id as artifact_id, artifact.tenant_id as artifact_tenant_id,
        artifact.sha256 as artifact_sha256, artifact.mission_id as artifact_mission_id,
        producer.id as producer_attempt_id, producer_work_item.id as producer_work_item_id,
        producer_mission.id as producer_mission_id, producer.agent_deployment_id as producer_deployment_id,
        verifier.id as verifier_attempt_id, verifier_work_item.id as verifier_work_item_id,
        verifier_mission.id as verifier_mission_id, verifier.agent_deployment_id as verifier_deployment_id
      from orchestration.artifact artifact
      join orchestration.attempt producer
        on producer.tenant_id=artifact.tenant_id and producer.id=artifact.producer_attempt_id
      join orchestration.work_item producer_work_item
        on producer_work_item.tenant_id=producer.tenant_id and producer_work_item.id=producer.work_item_id
      join orchestration.mission producer_mission
        on producer_mission.tenant_id=producer_work_item.tenant_id and producer_mission.id=producer_work_item.mission_id
      join orchestration.attempt verifier
        on verifier.tenant_id=artifact.tenant_id and verifier.id=$3
      join orchestration.work_item verifier_work_item
        on verifier_work_item.tenant_id=verifier.tenant_id and verifier_work_item.id=verifier.work_item_id
      join orchestration.mission verifier_mission
        on verifier_mission.tenant_id=verifier_work_item.tenant_id and verifier_mission.id=verifier_work_item.mission_id
      where artifact.tenant_id=$1 and artifact.id=$2 and artifact.storage_state='available'
        and artifact.verification_contract_version='verification.v1'`,
    [context.tenantId, artifact.artifactId, context.attemptId])).rows[0];
  }

  #assertRow(
    row: PrincipalRow,
    context: OperationContext,
    artifact: VerificationArtifactHandle,
    ownership: Required<Pick<OperationContext, "missionId" | "workItemId">>,
  ): void {
    if (row.artifact_id !== artifact.artifactId || row.artifact_tenant_id !== context.tenantId || `sha256:${row.artifact_sha256}` !== artifact.digest) {
      throw new Error("VERIFICATION_METRIC_OBSERVATIONS_ARTIFACT_IDENTITY_MISMATCH");
    }
    if (row.artifact_mission_id !== ownership.missionId
      || row.producer_mission_id !== ownership.missionId
      || row.verifier_mission_id !== ownership.missionId) {
      throw new Error("VERIFICATION_METRIC_MISSION_OWNERSHIP_MISMATCH");
    }
    if (row.verifier_attempt_id !== context.attemptId || row.verifier_work_item_id !== ownership.workItemId) {
      throw new Error("VERIFICATION_METRIC_VERIFIER_OWNERSHIP_MISMATCH");
    }
    if (!row.producer_attempt_id || !row.producer_work_item_id || !row.producer_mission_id) {
      throw new Error("VERIFICATION_METRIC_PRODUCER_OWNERSHIP_MISMATCH");
    }
  }
}
