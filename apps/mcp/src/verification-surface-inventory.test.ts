import { describe, expect, it } from "vitest";
import { KnowledgeIntegrationService } from "@aiengineer/knowledge-application";
import { KnowledgeClient } from "../../../packages/client-typescript/src/client.js";
import { dispatchCliCommand, resolveCommand } from "../../cli/src/commands.js";
import { createVerificationMcpToolExecutor } from "./index.js";
import { buildServer } from "../../api/src/server.js";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const tenant = id(1), actor = { kind: "service" as const, id: id(2), serviceIdentity: "mission_control_client" as const };
const identity = { actor, grants: [{ tenantId: tenant, roles: ["knowledge_operator" as const], scopes: [] }] };
const version = { verificationContractVersion: "verification.v1" as const };
const ref = { artifactId: id(3), digest: `sha256:${"a".repeat(64)}` };
const captures = { captureIds: [id(4)] };
// Public inventory is independent of the adapters' switch statements. A new public
// operation must be represented here before it can claim cross-surface parity.
const inventory = [
  { useCase: "captureSource", kind: "verification_capture", step: "register_and_admit", cli: ["benchmark", "capture"], tool: "knowledge_capture_source", path: "/v1/verification/captures", request: { source: { mode: "register", sourceKind: "web_page", sourceId: id(5), contentArtifact: ref }, requestedProjectionKinds: ["html_dom"] } },
  { useCase: "parseArtifact", kind: "verification_parse_artifact", step: "parse_and_admit", cli: ["artifact", "parse"], tool: "knowledge_parse_artifact", path: "/v1/verification/artifacts:parse", request: { captureId: id(4), sourceArtifact: { ...ref, tenantId: tenant, mediaType: "text/html", byteLength: 4, objectKey: "tenant/object", createdAt: "2026-09-08T00:00:00.000Z", producerActivityId: "capture", producerVersion: "v1", encryptionClass: "managed", retentionClass: "audit", dataClassification: "restricted", parentArtifactIds: [] } } },
  { useCase: "extractStructuredData", kind: "verification_structured_extraction", step: "extract_and_register", cli: ["extraction", "run"], tool: "knowledge_extract_structured_data", path: "/v1/verification/extractions", request: { captureId: id(4), representation: ref, extractionSchema: ref, extractionProfile: "registered_default" } },
  { useCase: "verifyExtraction", kind: "verification_extraction", step: "verify_and_register", cli: ["verify", "extract"], tool: "knowledge_verify_extraction", path: "/v1/verification/extractions:verify", request: { ...captures, extractionSchema: ref, extractionOutput: ref } },
  { useCase: "verifyClaims", kind: "verification_claims", step: "verify_claims_and_register", cli: ["verify", "citations"], tool: "knowledge_verify_claims", path: "/v1/verification/claims:verify", request: { ...captures, assertions: ref } },
  { useCase: "verifyReport", kind: "verification_report", step: "verify_report_and_register", cli: ["verify", "report"], tool: "knowledge_verify_report", path: "/v1/verification/reports:verify", request: { ...captures, report: ref, claimLedger: ref } },
  { useCase: "verifyMetricObservation", kind: "verification_metric", step: "verify_metric_and_register", cli: ["verify", "metric"], tool: "knowledge_verify_metric", path: "/v1/verification/metrics:verify", request: { ...captures, observations: ref } },
  { useCase: "runBenchmark", kind: "verification_benchmark", step: "replay_recorded_and_register", cli: ["benchmark", "run"], tool: "knowledge_run_benchmark", path: "/v1/verification/benchmarks:run", request: { dataset: ref, experimentDefinition: ref, executionMode: "offline_recorded" } },
  { useCase: "compareBenchmarkRuns", kind: "verification_benchmark_compare", step: "compare_registered_and_publish", cli: ["benchmark", "compare"], tool: "knowledge_compare_benchmark_runs", path: "/v1/verification/benchmarks:compare", request: { baselineRunId: id(6), candidateRunId: id(7), comparisonProfile: "paired_default" } },
  { useCase: "replayRun", kind: "verification_replay", step: "hydrate_and_recompute", cli: ["bundle", "replay"], tool: "knowledge_replay_run", path: `/v1/verification/runs/${id(6)}:replay`, request: { runId: id(6), replayMode: "deterministic_only" } },
  { useCase: "requestAdjudication", kind: "verification_adjudication", step: "request_adjudication_and_register", cli: ["adjudication", "request"], tool: "knowledge_request_adjudication", path: "/v1/verification/adjudications:request", request: { target: { kind: "evidence", evidenceId: id(8) }, reason: "ambiguous_evidence", evidencePacket: ref } },
  { useCase: "inspectAuditBundle", kind: "verification_audit_bundle", step: "inspect_audit_bundle_and_register", cli: ["bundle", "inspect"], tool: "knowledge_inspect_audit_bundle", path: "/v1/verification/audit-bundles:inspect", request: { auditBundle: ref } },
] as const;

describe("complete verification mutation admission inventory", () => {
  it.each(inventory)("$useCase preserves HTTP/CLI/MCP input and worker lease identity", async entry => {
    const operations = new KnowledgeIntegrationService();
    const context = { tenantId: tenant, correlationId: `inventory-${entry.useCase}`, idempotencyKey: `inventory-${entry.useCase}`, operationId: id(10), attemptId: id(11), actor, capabilityVersion: "verification-service.v1", reason: "cross-surface admission fixture", contractVersion: "v1" as const };
    const api = buildServer({ verificationOperationService: operations, resolveIdentity: () => identity, resolveVerificationContext: () => context, isParseArtifactRequestAdmitted: () => true, isStructuredExtractionRequestAdmitted: () => true, isBenchmarkRequestAdmitted: () => true, isBenchmarkComparisonRequestAdmitted: () => true, isClaimsRequestAdmitted: () => true, isAuditInspectionRequestAdmitted: () => true, isAdjudicationRequestAdmitted: () => true });
    const request = { ...version, ...entry.request };
    const headers = { authorization: "Bearer synthetic-inventory", "x-tenant-id": tenant, "x-correlation-id": context.correlationId, "idempotency-key": context.idempotencyKey };
    const transport: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      expect(url.origin).toBe("https://knowledge.example");
      const response = await api.inject({ method: (init?.method ?? "GET") as "POST", url: url.pathname, headers: Object.fromEntries(new Headers(init?.headers)), payload: init?.body as string });
      return new Response(response.body, { status: response.statusCode, headers: { "content-type": "application/json" } });
    };
    const client = new KnowledgeClient({ baseUrl: "https://knowledge.example", getAccessToken: () => "synthetic-inventory", fetch: transport });
    try {
      const direct = await api.inject({ method: "POST", url: entry.path, headers, payload: request });
      expect(direct.statusCode, direct.body).toBe(202);
      const cli = await dispatchCliCommand(client, resolveCommand(entry.cli[0], entry.cli[1])!, request, context);
      const execute = createVerificationMcpToolExecutor({ operationService: operations, apiOrigin: "https://knowledge.example", identity, apiClient: client });
      const mcp = await execute(entry.tool, { context: { tenantId: tenant, correlationId: context.correlationId, idempotencyKey: context.idempotencyKey }, request });
      expect("structuredContent" in mcp).toBe(true);
      for (const accepted of [direct.json(), cli, "structuredContent" in mcp ? mcp.structuredContent : undefined]) expect(accepted).toMatchObject({ operationId: context.operationId, state: "queued" });
      expect(operations.list(tenant)).toHaveLength(1);
      expect(operations.input(context.operationId, tenant)).toEqual({ schemaVersion: "verification-service-request.v1", useCase: entry.useCase, request });
      const claim = operations.claimOperation(context.operationId, "fixture-worker");
      expect(claim?.operation).toMatchObject({ kind: entry.kind, context });
      expect(claim?.step).toMatchObject({ name: entry.step });
      // This is admission/lease parity. It deliberately does not synthesize a
      // worker terminal or claim execution of the twelve verification algorithms.
    } finally { await api.close(); }
  });
});
