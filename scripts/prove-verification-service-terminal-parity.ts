import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { VerificationAdmissionService, VerificationOperationApplicationService, VerificationServiceCatalog } from "@aiengineer/knowledge-application";
import { SandboxedVerificationParser, VERIFICATION_PARSER_LIMITS } from "@aiengineer/knowledge-conversion";
import { PostgresCanonicalRepository, PostgresKnowledgeOperationService, PostgresVerificationRepository } from "@aiengineer/knowledge-persistence";
import { SupabaseArtifactStore } from "@aiengineer/knowledge-runtime";
import { canonicalizeJson } from "@aiengineer/knowledge-verification";
import {VerificationExtractionFieldEvidenceResultSchema} from "@aiengineer/knowledge-contracts";
import { buildServer } from "../apps/api/src/server.js";
import { createVerificationOwnershipResolver } from "../apps/api/src/verification-ownership.js";
import { dispatchCliCommand, resolveCommand } from "../apps/cli/src/commands.js";
import { createVerificationMcpToolExecutor } from "../apps/mcp/src/index.js";
import { CanonicalActivityRegistry } from "../apps/worker/src/activity-registry.js";
import { CanonicalDurableKnowledgeWorker } from "../apps/worker/src/canonical-worker.js";
import { createVerificationOperationExecutor, verificationActivityHandlers } from "../apps/worker/src/verification-activities.js";
import { KnowledgeClient } from "../packages/client-typescript/src/client.js";

const { loadVerifiedLocalDevelopmentConfig } = await import("../../internal/verification-local-direct-config.mjs") as { loadVerifiedLocalDevelopmentConfig(): Promise<{ DB_URL: string; API_URL: string; SECRET_KEY: string }> };
const local = await loadVerifiedLocalDevelopmentConfig();
const database = new PostgresCanonicalRepository({ connectionString: local.DB_URL, localOnly: true });
const tenantId = "571b6244-57f9-4951-86e9-0abb4b37d9bd";
const retainedOperationId = "a8fc9889-82bc-5d27-ab00-86c6a7dbd47f";
const missionId = "e72c225b-ec57-4e31-bc1a-5d1d58a9ff1d", workItemId = "a4fe43dd-909a-4150-9a58-9b94ab5f93ed", attemptId = "343113d2-8cae-4ba3-9099-f127c93c66a1";
const bucket = "ai-engineer-cloud-bucket", imageDigest = "sha256:1669a3f9674b2e0a70ba1c8686c1cb3647492b8268bdfa7a9a4452fb0530fb37" as const;
const now = () => new Date().toISOString(), namespace = `verification-service-terminal-parity-${randomUUID()}`;
const actor = { kind: "service" as const, id: attemptId, serviceIdentity: "knowledge_worker" as const };
const repository = new PostgresVerificationRepository(database, new SupabaseArtifactStore({ projectUrl: local.API_URL, serviceRoleKey: local.SECRET_KEY, bucket, maximumBytes: 8_000_000 }), { async authorize(input) { if (input.tenantId !== tenantId) throw new Error("TENANT_DENIED"); } });
const config = { storageBucket: bucket, producerVersion: "verification-service.v1", encryptionClass: "supabase-managed", retentionClass: "verification-audit", now };
const admission = new VerificationAdmissionService(repository, new SandboxedVerificationParser(imageDigest), { parserVersion: "verification-native-parser.v1", imageDigest, limits: VERIFICATION_PARSER_LIMITS }, config);
const operations = new PostgresKnowledgeOperationService(database, { admittedOperationKinds: ["verification_extraction", "verification_replay"] });
const application = new VerificationOperationApplicationService(operations, "http://127.0.0.1");
const register = (value: unknown, artifactType: string) => repository.registerContentAddressedArtifact({ tenantId, bytes: new TextEncoder().encode(canonicalizeJson(value)), mediaType: "application/json", createdAt: now(), producerActivityId: "service-terminal-parity", producerVersion: "1", encryptionClass: "supabase-managed", retentionClass: "verification-audit", dataClassification: "restricted", artifactType, bucketClass: "ledger", storageBucket: bucket, producerAttemptId: attemptId, missionId });
function payload(receipt: any) { const { eventId, fencingToken, resultArtifact, ...result } = receipt.body; return { result, resultArtifact }; }
async function execute(operationId: string, catalog: VerificationServiceCatalog) {
  const executor = createVerificationOperationExecutor({ operations: database, repository, admission, catalog, config });
  const registry = new CanonicalActivityRegistry(verificationActivityHandlers(executor));
  const worker = new CanonicalDurableKnowledgeWorker(namespace, tenantId, database, async claim => { const operation = await database.getOperationRecord(tenantId, claim.operationId); assert.ok(operation); return registry.execute(operation, claim); }, 30_000, registry.operationKinds());
  const terminal = await worker.runOperationOnce(operationId); assert.ok(terminal); assert.equal(terminal.operation?.status, "succeeded"); return terminal.receipt as any;
}
try {
  const retained = await database.getOperationRecord(tenantId, retainedOperationId); assert.ok(retained); assert.equal(retained.operationKind, "verification_parse_artifact");
  const deployment = await database.transaction(tenantId, async client => {
    const row = (await client.query<{ agent_deployment_id: string }>("select agent_deployment_id from orchestration.attempt where tenant_id=$1 and id=$2", [tenantId, attemptId])).rows[0];
    assert.ok(row); return row.agent_deployment_id;
  });
  const retainedInput: any = retained.request, retainedRequest = retainedInput.input?.request ?? retainedInput.request;
  if (!retainedRequest) throw new Error(`RETAINED_PARSE_REQUEST_MISSING:${JSON.stringify(retainedInput)}`);
  const retainedReceipt: any = (await database.listReceipts(tenantId, retainedOperationId)).find(item => item.outcome === "succeeded"); assert.ok(retainedReceipt);
  const parsed = retainedReceipt.body as any, captureId = retainedRequest.captureId, sourceArtifact = retainedRequest.sourceArtifact, projection = parsed.output.projections[0];
  assert.ok(captureId && sourceArtifact && projection?.projectionArtifact && projection?.transformationArtifact, "RETAINED_PARSE_BINDING_REQUIRED");
  const profile = { schemaVersion: "verification-extraction-profile.v1", sourceArtifact: { artifactId: sourceArtifact.artifactId, digest: sourceArtifact.digest }, extractionSchema: { schemaId: "service-terminal-parity", schemaVersion: "1", schema: { type: "object", description: "Service terminal parity fixture.", properties: { value: { type: "string", description: "Exact retained text.", maxLength: 128 } }, required: ["value"], additionalProperties: false } }, fields: [{ path: "/value", comparison: "exact" }], evidence: [{ path: "/value", captureId, projectionArtifactId: projection.projectionArtifact.artifactId, transformationArtifactId: projection.transformationArtifact.artifactId, selector: { kind: "html", domPath: "1/0" } }], normalizations: [], duplicates: [], totals: [] };
  const profileArtifact = await register(profile, "verification_bundle"), candidate = await register({ value: "Exact parse terminal parity" }, "evaluation_case_input");
  const catalog = new VerificationServiceCatalog({ captureGrants: [], extractionProfileArtifacts: [{ artifactId: profileArtifact.artifactId, digest: profileArtifact.digest }] });
  const verifyRequest = { verificationContractVersion: "verification.v1" as const, captureIds: [captureId], extractionSchema: { artifactId: profileArtifact.artifactId, digest: profileArtifact.digest }, extractionOutput: { artifactId: candidate.artifactId, digest: candidate.digest } };
  const token = `service-terminal-parity-${randomUUID()}`;
  const grants = JSON.stringify([{ tenantId, actor, missionId, agentDeploymentId: deployment, capabilityVersion: "verification-service.v1" }]);
  const api = buildServer({ verificationOperationService: operations, resolveIdentity: value => value === token ? { actor, grants: [{ tenantId, roles: ["knowledge_operator" as const], scopes: [] }] } : undefined, resolveVerificationContext: createVerificationOwnershipResolver(database, grants) });
  try {
    const baseUrl = await api.listen({ host: "127.0.0.1", port: 0 });
    const context = { tenantId, missionId, workItemId, attemptId, correlationId: `${namespace}:verify`, idempotencyKey: `${namespace}:verify-same-idempotency` };
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json", "x-tenant-id": tenantId, "x-correlation-id": context.correlationId, "idempotency-key": context.idempotencyKey, "x-verification-mission-id": missionId, "x-verification-work-item-id": workItemId, "x-verification-attempt-id": attemptId };
    const raw = await fetch(`${baseUrl}/v1/verification/extractions:verify`, { method: "POST", headers, body: JSON.stringify(verifyRequest) }); assert.equal(raw.status, 202); const http = await raw.json() as any;
    const client = new KnowledgeClient({ baseUrl, getAccessToken: () => token });
    const typed = await client.verifyExtraction(verifyRequest, context);
    const cli = await dispatchCliCommand(client, resolveCommand("verify", "extract")!, verifyRequest, context) as any;
    const mcp = await createVerificationMcpToolExecutor({ operationService: operations, apiOrigin: baseUrl, identity: { actor, grants: [{ tenantId, roles: ["knowledge_operator" as const], scopes: [] }] }, apiClient: client })("knowledge_verify_extraction", { context, request: verifyRequest }) as any;
    for (const accepted of [typed, cli, mcp.structuredContent]) assert.equal(accepted.operationId, http.operationId);
    const verified = await execute(http.operationId, catalog); const verifiedPayload = payload(verified); assert.equal(verifiedPayload.result.output.result.valid, true, JSON.stringify(verifiedPayload.result));
    const fieldEvidence=VerificationExtractionFieldEvidenceResultSchema.parse(verifiedPayload.result.output.result);
    assert.equal(fieldEvidence.acceptedLeaves.length,1);
    const leaf=fieldEvidence.acceptedLeaves[0]!;
    assert.equal(leaf.path,"/value");assert.equal(leaf.value,"Exact parse terminal parity");assert.equal(leaf.rawValue,leaf.value);
    assert.deepEqual(leaf.derivation,{kind:"direct",comparison:"exact"});
    assert.equal(leaf.source.captureId,captureId);assert.equal(leaf.source.representationArtifactId,projection.projectionArtifact.artifactId);
    assert.deepEqual(leaf.lineage.sourceArtifact,{artifactId:sourceArtifact.artifactId,digest:sourceArtifact.digest});
    assert.deepEqual(leaf.lineage.projectionArtifact,{artifactId:projection.projectionArtifact.artifactId,digest:projection.projectionArtifact.digest});
    for(const artifact of [leaf.lineage.sourceArtifact,leaf.lineage.nativeOutputArtifact,leaf.lineage.transformationArtifact,leaf.lineage.projectionArtifact]){
      assert.ok(verifiedPayload.result.boundArtifacts.some((bound:any)=>bound.artifactId===artifact.artifactId&&bound.digest===artifact.digest),"LEAF_LINEAGE_PARENT_NOT_BOUND");
    }
    const resolver = repository.createTrustedArtifactResolver(); await resolver.authorizeArtifact({ tenantId, artifactId: verifiedPayload.resultArtifact.artifactId, purpose: "verification_replay" }); const verifiedBytes = await resolver.hydrateRegisteredArtifact({ tenantId, artifactId: verifiedPayload.resultArtifact.artifactId }); assert.equal(new TextDecoder().decode(verifiedBytes.bytes), canonicalizeJson(verifiedPayload.result));
    const replayRequest = { verificationContractVersion: "verification.v1" as const, runId: http.operationId, replayMode: "deterministic_only" as const }, replayContext = { ...context, correlationId: `${namespace}:replay`, idempotencyKey: `${namespace}:replay-same-idempotency` };
    const replayHeaders = { ...headers, "x-correlation-id": replayContext.correlationId, "idempotency-key": replayContext.idempotencyKey };
    const replayRaw = await fetch(`${baseUrl}/v1/verification/runs/${http.operationId}:replay`, { method: "POST", headers: replayHeaders, body: JSON.stringify(replayRequest) }); assert.equal(replayRaw.status, 202); const replayHttp = await replayRaw.json() as any;
    const replayTyped = await client.replayVerificationRun(replayRequest, replayContext);
    const replayCli = await dispatchCliCommand(client, resolveCommand("bundle", "replay")!, replayRequest, replayContext) as any;
    const replayMcp = await createVerificationMcpToolExecutor({ operationService: operations, apiOrigin: baseUrl, identity: { actor, grants: [{ tenantId, roles: ["knowledge_operator" as const], scopes: [] }] }, apiClient: client })("knowledge_replay_run", { context: replayContext, request: replayRequest }) as any;
    for (const accepted of [replayTyped, replayCli, replayMcp.structuredContent]) assert.equal(accepted.operationId, replayHttp.operationId);
    const replayed = await execute(replayHttp.operationId, catalog); const replayPayload = payload(replayed); assert.equal(replayPayload.result.output.replayMatched, true, JSON.stringify(replayPayload.result));
    assert.deepEqual(replayPayload.result.output.result,fieldEvidence,"LEAF_EVIDENCE_REPLAY_DRIFT");
    await resolver.authorizeArtifact({ tenantId, artifactId: replayPayload.resultArtifact.artifactId, purpose: "verification_replay" }); const replayBytes = await resolver.hydrateRegisteredArtifact({ tenantId, artifactId: replayPayload.resultArtifact.artifactId }); assert.equal(new TextDecoder().decode(replayBytes.bytes), canonicalizeJson(replayPayload.result));
    assert.equal((await database.listReceipts(tenantId, http.operationId)).filter(item => item.outcome === "succeeded").length, 1); assert.equal((await database.listReceipts(tenantId, replayHttp.operationId)).filter(item => item.outcome === "succeeded").length, 1);
    const sourceHashes = Object.fromEntries(await Promise.all(["scripts/prove-verification-service-terminal-parity.ts", "apps/api/src/server.ts", "packages/client-typescript/src/client.ts", "apps/cli/src/commands.ts", "apps/mcp/src/index.ts", "apps/worker/src/verification-activities.ts", "packages/application/src/verification/operations/verification-service.ts"].map(async file => [file, createHash("sha256").update(await readFile(file)).digest("hex")])));
    const output = resolve("..", "internal", `${namespace}.json`);
    await writeFile(resolve("..","internal",`${namespace}.leaf-evidence.json`),JSON.stringify({schemaVersion:"verification-native-leaf-evidence-proof.v1",capturedAt:now(),tenantId,verifyOperationId:http.operationId,replayOperationId:replayHttp.operationId,resultArtifact:verifiedPayload.resultArtifact,fieldEvidence,replayedExactly:true,allLineageArtifactsBound:true,providerCalls:0,parserCalls:0,sourceHashes},null,2)+"\n",{flag:"wx"});
    await writeFile(output, JSON.stringify({ schemaVersion: "verification-service-terminal-parity-proof.v1", capturedAt: now(), namespace, scope: { retainedParseOperationId: retainedOperationId, tenantId, missionId, workItemId, attemptId, providerCalls: 0, parserCalls: 0, remoteWrites: 0 }, operations: { verifyExtraction: http.operationId, replayRun: replayHttp.operationId }, checks: { verifyExtractionSameDurableOperationAcrossHttpClientCliMcp: true, verifyExtractionActualWorkerSucceeded: true, verifyExtractionCanonicalResultBytesExact: true, replayRunSameDurableOperationAcrossHttpClientCliMcp: true, replayRunActualWorkerSucceeded: true, replayRunCanonicalResultBytesExact: true, oneSuccessReceiptPerOperation: true }, terminal: { verifyExtraction: { receiptId: verified.id, resultArtifact: verifiedPayload.resultArtifact }, replayRun: { receiptId: replayed.id, resultArtifact: replayPayload.resultArtifact } }, sourceHashes }, null, 2) + "\n", { flag: "wx" });
    console.log(JSON.stringify({ output, verifyOperationId: http.operationId, replayOperationId: replayHttp.operationId }));
  } finally { await api.close(); }
} finally { await database.close(); }
