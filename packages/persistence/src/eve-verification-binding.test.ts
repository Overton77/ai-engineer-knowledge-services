import { describe, expect, it } from "vitest";
import type { EveRuntimeAttestationEnvelope } from "@aiengineer/knowledge-contracts";
import type { PostgresCanonicalRepository } from "./postgres.js";
import { resolveEveVerificationBinding } from "./eve-verification-binding.js";

const ids = {
  tenant: "11111111-1111-4111-8111-111111111111", mission: "22222222-2222-4222-8222-222222222222",
  work: "33333333-3333-4333-8333-333333333333", attempt: "44444444-4444-4444-8444-444444444444",
  operation: "55555555-5555-4555-8555-555555555555", actor: "66666666-6666-4666-8666-666666666666",
  jti: "77777777-7777-4777-8777-777777777777",
};
const signature = `${"A".repeat(86)}==`;
function envelope(override: Partial<EveRuntimeAttestationEnvelope["payload"]> = {}): EveRuntimeAttestationEnvelope {
  return { signatureBase64: signature, payload: {
    schemaVersion: "eve-runtime-attestation.v1", issuer: "eve.local", keyId: "test-key", jti: ids.jti,
    issuedAt: 1_780_000_000, expiresAt: 1_780_000_120, audience: "knowledge-services:verification", grantId: "test-grant",
    tenantId: ids.tenant, principal: { kind: "service", id: ids.actor, serviceIdentity: "knowledge_api" },
    missionId: ids.mission, workItemId: ids.work, attemptId: ids.attempt, operationId: ids.operation,
    agentDeploymentId: "eve-deployment", capabilityVersion: "eve.v1", useCase: "verifyClaims",
    requestDigest: `sha256:${"a".repeat(64)}`, idempotencyKey: "eve-test-key",
    externalExecution: { runtime: "eve", sessionId: "session-a", turnId: "turn-a", runId: "session-a:turn-a", rootRunId: "root-a", toolCallId: "tool-a" },
    ...override,
  } };
}

function bridgeFixture() {
  let binding: Record<string, unknown> | undefined;
  const invocations = new Map<string, { operation_id: string; envelope_sha256: string }>();
  const query = async <T>(sql: string, values: unknown[] = []): Promise<{ rows: T[]; rowCount: number }> => {
    if (sql.includes("from orchestration.attempt")) return { rows: [{ id: ids.attempt }] as T[], rowCount: 1 };
    if (sql.includes("from knowledge_service.eve_operation_binding")) return { rows: binding ? [binding as T] : [], rowCount: binding ? 1 : 0 };
    if (sql.includes("insert into knowledge_service.eve_operation_binding")) {
      binding = { tenant_id: values[0], operation_id: values[1], idempotency_key: values[2], grant_id: values[3], use_case: values[4], request_sha256: values[5], actor_identity: values[6], mission_id: values[7], work_item_id: values[8], attempt_id: values[9], agent_deployment_id: values[10], capability_version: values[11], original_external_execution: JSON.parse(String(values[12])), issuer: values[13] };
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("from knowledge_service.eve_operation_invocation")) {
      const row = invocations.get(`${values[0]}:${values[1]}`); return { rows: row ? [row as T] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.includes("insert into knowledge_service.eve_operation_invocation")) {
      invocations.set(`${values[2]}:${values[4]}`, { operation_id: String(values[1]), envelope_sha256: String(values[7]) }); return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  };
  return { invocations, database: { transaction: async (_tenant: string, work: (client: { query: typeof query }) => Promise<unknown>) => work({ query }) } as unknown as PostgresCanonicalRepository };
}

describe("resolveEveVerificationBinding", () => {
  it("freezes the first execution while appending a newly signed JTI retry with the same lineage", async () => {
    const fixture = bridgeFixture();
    const first = await resolveEveVerificationBinding(fixture.database, envelope());
    const retry = envelope({ jti: "88888888-8888-4888-8888-888888888888" });
    await expect(resolveEveVerificationBinding(fixture.database, retry)).resolves.toEqual(first);
    expect(fixture.invocations.size).toBe(2);
  });

  it("rejects a changed payload reusing an issuer/JTI and binds service identity into the immutable actor", async () => {
    const fixture = bridgeFixture();
    await resolveEveVerificationBinding(fixture.database, envelope());
    await expect(resolveEveVerificationBinding(fixture.database, envelope({ externalExecution: { runtime: "eve", sessionId: "session-a", turnId: "turn-a", runId: "session-a:turn-a", rootRunId: "changed-root", toolCallId: "tool-a" } })))
      .rejects.toThrow("EVE_VERIFICATION_JTI_COLLISION");
    await expect(resolveEveVerificationBinding(fixture.database, envelope({ principal: { kind: "service", id: ids.actor, serviceIdentity: "knowledge_worker" } })))
      .rejects.toThrow("EVE_VERIFICATION_BINDING_CONFLICT");
  });
});
