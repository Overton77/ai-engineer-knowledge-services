/** Loopback-only configured claims/report submission parity proof. No worker, parser, or provider is started. */
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PostgresCanonicalRepository, PostgresKnowledgeOperationService } from "@aiengineer/knowledge-persistence";
import { KnowledgeClient } from "@aiengineer/knowledge-client";
import { AcceptedOperationSchema, OperationContextSchema } from "@aiengineer/knowledge-contracts";
import { buildServer } from "../apps/api/src/server.js";
import { createVerificationOwnershipResolver } from "../apps/api/src/verification-ownership.js";
import { dispatchCliCommand, resolveCommand } from "../apps/cli/src/commands.js";
import { createVerificationMcpToolExecutor } from "../apps/mcp/src/index.js";
import { digestCanonicalJson } from "@aiengineer/knowledge-verification";

for (const [value, port] of [[process.env.POSTGRES_URL, "54322"], [process.env.SUPABASE_URL, "54321"]] as const) {
  const url = new URL(value); if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== port || url.search || url.hash) throw new Error("LOCAL_ONLY_PROOF_REQUIRED");
}
const fixtureName = "verification-claims-report-worker-6649ef0a-3f32-4360-9ee3-7e9fdd11f8e1.json";
const fixture = JSON.parse(await readFile(resolve("../internal", fixtureName), "utf8")) as { tenantId: string; results: { claimsRecovery: { operationId: string }; reportRecovery: { operationId: string } } };
const namespace = randomUUID(), tenantId = fixture.tenantId, actor = { kind: "service" as const, id: randomUUID(), serviceIdentity: "inspection_agent" as const }, deniedActor = { kind: "service" as const, id: randomUUID(), serviceIdentity: "inspection_agent" as const };
const database = new PostgresCanonicalRepository({ connectionString: process.env.POSTGRES_URL!, localOnly: true });
const sourceOperations = await Promise.all([fixture.results.claimsRecovery.operationId, fixture.results.reportRecovery.operationId].map(async operationId => {
  const operation = await database.getOperation(tenantId, operationId); assert.ok(operation);
  const ownership = (await database.transaction(tenantId, c => c.query<{ attempt_id: string; mission_id: string; work_item_id: string; agent_deployment_id: string; request: { input: { request: Record<string, unknown> } } }>("select o.attempt_id,o.mission_id,o.work_item_id,a.agent_deployment_id,o.request from knowledge_service.operation o join orchestration.attempt a on a.tenant_id=o.tenant_id and a.id=o.attempt_id where o.tenant_id=$1 and o.id=$2", [tenantId, operationId]))).rows[0]; assert.ok(ownership);
  return { operation, ownership, request: ownership.request.input.request };
}));
const admittedRequestDigests = new Set(sourceOperations.map(item => digestCanonicalJson(item.request)));
const requiredArtifacts = [...new Map(sourceOperations.flatMap(item => Object.values(item.request).filter((value): value is { artifactId: string; digest: `sha256:${string}` } => value !== null && typeof value === "object" && "artifactId" in value && "digest" in value)).map(item => [item.artifactId, item])).values()];
const registered = (await database.transaction(tenantId, c => c.query<{ id: string; sha256: string }>("select id,sha256 from orchestration.artifact where tenant_id=$1 and id=any($2::uuid[])", [tenantId, requiredArtifacts.map(item => item.artifactId)]))).rows;
assert.equal(registered.length, requiredArtifacts.length); for (const artifact of requiredArtifacts) assert.ok(registered.some(row => row.id === artifact.artifactId && `sha256:${row.sha256}` === artifact.digest));
const grants = JSON.stringify([{ tenantId, actor, missionId: sourceOperations[0]!.ownership.mission_id, agentDeploymentId: sourceOperations[0]!.ownership.agent_deployment_id, capabilityVersion: "verification.v1" }]);
const identity = { actor, grants: [{ tenantId, roles: ["knowledge_operator" as const], scopes: [] }] };
const isAdmitted = (candidate: string, request: Record<string, unknown>) => candidate === tenantId && admittedRequestDigests.has(digestCanonicalJson(request)) && requiredArtifacts.every(artifact => registered.some(row => row.id === artifact.artifactId && `sha256:${row.sha256}` === artifact.digest));
const service = new PostgresKnowledgeOperationService(database, { admittedOperationKinds: ["verification_claims", "verification_report"] });
const server = buildServer({ resolveIdentity: token => token === "valid" ? identity : token === "denied" ? { ...identity, actor: deniedActor } : undefined, verificationOperationService: service, resolveVerificationContext: createVerificationOwnershipResolver(database, grants), isClaimsRequestAdmitted: isAdmitted });
const operations: string[] = [], checks: Record<string, boolean> = {};
const startupJournal = resolve("../internal", `verification-claims-report-transports-startup-${namespace}.json`), failureReceipt = resolve("../internal", `verification-claims-report-transports-failure-${namespace}.json`);
await writeFile(startupJournal, JSON.stringify({ schemaVersion: "verification-claims-report-transports-startup.v1", namespace, tenantId, intendedMutationScope: "isolated queued claims/report transport operations", parserDispatches: 0, providerDispatches: 0 }, null, 2) + "\n", { flag: "wx" });
try {
  const origin = await server.listen({ host: "127.0.0.1", port: 0 });
  const client = new KnowledgeClient({ baseUrl: origin, getAccessToken: () => "valid" });
  const mcp = createVerificationMcpToolExecutor({ operationService: service, apiOrigin: origin, identity, apiClient: client });
  for (const [index, source] of sourceOperations.entries()) {
    const useCase = index === 0 ? "verifyClaims" : "verifyReport";
    const context = OperationContextSchema.parse({ tenantId, operationId: randomUUID(), attemptId: source.ownership.attempt_id, workItemId: source.ownership.work_item_id, missionId: source.ownership.mission_id, actor, correlationId: namespace, idempotencyKey: `${useCase}-${namespace}`, capabilityVersion: "verification.v1", reason: "Loopback claims/report transport proof", contractVersion: "v1" });
    const accepted = useCase === "verifyClaims" ? await client.verifyClaims(source.request as never, context) : await client.verifyReport(source.request as never, context);
    operations.push(accepted.operationId); const retried = useCase === "verifyClaims" ? await client.verifyClaims(source.request as never, context) : await client.verifyReport(source.request as never, context); assert.equal(retried.operationId, accepted.operationId);
    const cli = AcceptedOperationSchema.parse(await dispatchCliCommand(client, resolveCommand("verify", useCase === "verifyClaims" ? "citations" : "report")!, source.request, { ...context, idempotencyKey: `cli-${useCase}-${namespace}` })); operations.push(cli.operationId);
    const mcpResult = await mcp(useCase === "verifyClaims" ? "knowledge_verify_claims" : "knowledge_verify_report", { context: { tenantId, correlationId: namespace, idempotencyKey: `mcp-${useCase}-${namespace}`, attemptId: source.ownership.attempt_id, workItemId: source.ownership.work_item_id, missionId: source.ownership.mission_id }, request: source.request });
    assert.ok("structuredContent" in mcpResult); operations.push(AcceptedOperationSchema.parse(mcpResult.structuredContent).operationId);
    await assert.rejects(useCase === "verifyClaims" ? new KnowledgeClient({ baseUrl: origin, getAccessToken: () => "denied" }).verifyClaims(source.request as never, context) : new KnowledgeClient({ baseUrl: origin, getAccessToken: () => "denied" }).verifyReport(source.request as never, context));
    await assert.rejects(useCase === "verifyClaims" ? client.verifyClaims(source.request as never, { ...context, tenantId: randomUUID() }) : client.verifyReport(source.request as never, { ...context, tenantId: randomUUID() }));
    const changed = { ...source.request, captureIds: [...(source.request.captureIds as string[]), `changed-${namespace}`] };
    await assert.rejects(useCase === "verifyClaims" ? client.verifyClaims(changed as never, context) : client.verifyReport(changed as never, context));
    checks[`${useCase}_http_client_cli_mcp_submission_and_idempotency`] = true;
  }
  for (const operationId of operations) { const operation = await database.getOperation(tenantId, operationId); assert.ok(operation); assert.equal(operation.status, "queued"); assert.ok(["verification_claims", "verification_report"].includes(operation.operationKind)); }
  checks.authorized_operations_queued_without_worker_provider_or_parser = true;
  for (const operationId of operations) { await database.cancelOperation(tenantId, operationId, { actorIdentity: namespace, correlationId: namespace }); assert.equal((await database.getOperation(tenantId, operationId))?.status, "cancelled"); }
  checks.all_proof_operations_cancelled_before_success_receipt = true;
  const sourceFiles = await Promise.all(["apps/api/src/server.ts", "apps/api/src/verification-ownership.ts", "packages/client-typescript/src/client.ts", "apps/cli/src/commands.ts", "apps/mcp/src/index.ts", "scripts/prove-verification-claims-report-transports.ts"].map(async path => ({ path, sha256: createHash("sha256").update(await readFile(path)).digest("hex") })));
  const output = resolve("../internal", `verification-claims-report-transports-${namespace}.json`);
  await writeFile(output, JSON.stringify({ schemaVersion: "verification-claims-report-transports-proof.v1", createdAt: new Date().toISOString(), namespace, fixtureName, tenantId, checks, startupJournal, admittedThenCancelledOperationIds: operations, sourceFiles, parserDispatches: 0, providerDispatches: 0, limitations: ["Configured loopback HTTP/client and in-process CLI/MCP adapters submit retained registered inputs", "Claims/report expose no public typed terminal-receipt/result read route, so cross-transport terminal-result parity is unsupported and not asserted", "Queued proof operations are cancelled and verified before this receipt; no worker, parser, provider, or remote service is started"] }, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ output, checks }));
} catch (error) { await writeFile(failureReceipt, JSON.stringify({ schemaVersion: "verification-claims-report-transports-failure.v1", namespace, startupJournal, failure: error instanceof Error ? error.message : "UNKNOWN", operationIds: operations }, null, 2) + "\n", { flag: "wx" }); throw error;
} finally { await server.close(); for (const operationId of operations) { const operation = await database.getOperation(tenantId, operationId); if (operation && operation.status === "queued") await database.cancelOperation(tenantId, operationId, { actorIdentity: namespace, correlationId: namespace }); } await database.close(); }
