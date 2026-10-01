import { isAuthorized } from "@aiengineer/knowledge-host";
import { z } from "zod";
import { VERIFICATION_MCP_TOOL_NAMES } from "../catalog.js";
import {
  benchmarkReadSchema,
  comparisonReadSchema,
  createAdjudicationDecisionReadMcpExecutor,
  createAdjudicationReadMcpExecutor,
  createAuditInspectionReadMcpExecutor,
  createBenchmarkComparisonReadMcpExecutor,
  createBenchmarkReadMcpExecutor,
  createClaimsReportReadMcpExecutor,
  createProviderReconciliationMcpExecutor,
  createStructuredExtractionReadMcpExecutor,
  createVerificationMcpToolExecutor,
  createVerificationOperationReadMcpExecutor,
  extractionReadSchema,
  reconciliationApplySchema,
  reconciliationReadSchema,
  verificationOperationReadSchema,
  verificationToolSchemas,
  type KnowledgeMcpServerOptions,
} from "./executors.js";
import { McpReadContextSchema, toolCollector } from "./definition.js";
import { readToolResult, toolError } from "./errors.js";

export function verificationToolDefinitions(options: KnowledgeMcpServerOptions) {
  const { definitions, add } = toolCollector();
  const executeVerification = createVerificationMcpToolExecutor(options);
  const executeBenchmarkRead = createBenchmarkReadMcpExecutor(options);
  for (const name of ["verify_benchmark_show", "verify_benchmark_manifest"] as const)
    add(
      name,
      {
        description:
          "Read a completed, signed benchmark with compact engineering metadata under the caller's tenant read authority.",
        inputSchema: benchmarkReadSchema.shape,
      },
      async (value: unknown) => executeBenchmarkRead(name, value),
    );
  add(
    "verify_reconciliation_apply",
    {
      description:
        "Apply a registered signed accounting decision under configured operator authority; never redispatches.",
      inputSchema: reconciliationApplySchema.shape,
    },
    createProviderReconciliationMcpExecutor(options, "apply"),
  );
  add(
    "verify_reconciliation_show",
    {
      description: "Read an authenticated applied accounting decision.",
      inputSchema: reconciliationReadSchema.shape,
    },
    createProviderReconciliationMcpExecutor(options, "show"),
  );
  add(
    "verify_extraction_show",
    {
      description: "Read compact authenticated extraction custody results; candidates remain unverified.",
      inputSchema: extractionReadSchema.shape,
    },
    createStructuredExtractionReadMcpExecutor(options),
  );
  add(
    "verify_bundle_show",
    {
      description: "Read a compact authenticated audit inspection result and immutable proof reference.",
      inputSchema: extractionReadSchema.shape,
    },
    createAuditInspectionReadMcpExecutor(options),
  );
  add(
    "verify_claims_result",
    {
      description: "Read the compact signed terminal result for an authenticated claims verification operation.",
      inputSchema: extractionReadSchema.shape,
    },
    createClaimsReportReadMcpExecutor(options, "claims"),
  );
  add(
    "verify_report_result",
    {
      description:
        "Read the compact signed terminal result and report-wide gate summary for an authenticated report verification operation.",
      inputSchema: extractionReadSchema.shape,
    },
    createClaimsReportReadMcpExecutor(options, "report"),
  );
  add(
    "verify_adjudication_get",
    {
      description: "Read an authenticated pending adjudication subject and its verified source references.",
      inputSchema: extractionReadSchema.shape,
    },
    createAdjudicationReadMcpExecutor(options),
  );
  add(
    "verify_adjudication_get_decision",
    {
      description: "Read a compact authenticated packet-bound adjudication decision terminal result.",
      inputSchema: extractionReadSchema.shape,
    },
    createAdjudicationDecisionReadMcpExecutor(options),
  );
  add(
    "verify_benchmark_comparison",
    {
      description:
        "Read signed paired engineering statistics and corrected p-values for a completed benchmark comparison.",
      inputSchema: comparisonReadSchema.shape,
    },
    createBenchmarkComparisonReadMcpExecutor(options),
  );
  const caseReadContext = McpReadContextSchema;
  const caseReadTools = [
    {
      name: "verify_cases",
      schema: z.strictObject({
        context: caseReadContext,
        runId: z.uuid(),
        pageSize: z.int().min(1).max(100).optional(),
        cursor: z.uuid().optional(),
      }),
      kind: "list",
    },
    {
      name: "verify_case",
      schema: z.strictObject({ context: caseReadContext, caseRunId: z.uuid() }),
      kind: "case",
    },
    {
      name: "verify_evidence",
      schema: z.strictObject({
        context: caseReadContext,
        evidenceId: z.uuid(),
      }),
      kind: "evidence",
    },
  ] as const;
  for (const tool of caseReadTools) {
    add(
      tool.name,
      {
        description:
          "Read authored verification cases or compact artifact-backed evidence under the caller's tenant read authority.",
        inputSchema: tool.schema.shape,
      },
      async (value: unknown) => {
        const parsed = tool.schema.parse(value);
        if (!isAuthorized(options.identity, parsed.context.tenantId, "knowledge.read")) return toolError("FORBIDDEN");
        const reads = options.verificationReads;
        if (!reads) return toolError("CAPABILITY_NOT_ADMITTED");
        const tenantId = parsed.context.tenantId;
        return "runId" in parsed
          ? readToolResult(
              await reads.runCases({
                tenantId,
                runId: parsed.runId,
                ...(parsed.pageSize === undefined ? {} : { pageSize: parsed.pageSize }),
                ...(parsed.cursor === undefined ? {} : { cursor: parsed.cursor }),
              }),
            )
          : "caseRunId" in parsed
            ? readToolResult(await reads.case({ tenantId, caseRunId: parsed.caseRunId }))
            : readToolResult(await reads.evidence({ tenantId, evidenceId: parsed.evidenceId }));
      },
    );
  }
  const verificationReadSchema = z.strictObject({
    context: McpReadContextSchema,
    runId: z.uuid(),
  });
  for (const name of ["verify_run", "verify_manifest"] as const) {
    add(
      name,
      {
        description: "Read compact metadata from a sealed, tenant-owned verification run.",
        inputSchema: verificationReadSchema.shape,
      },
      async (value: unknown) => {
        const { context, runId } = verificationReadSchema.parse(value);
        if (!isAuthorized(options.identity, context.tenantId, "knowledge.read")) return toolError("FORBIDDEN");
        const reads = options.verificationReads;
        if (!reads) return toolError("CAPABILITY_NOT_ADMITTED");
        const input = { tenantId: context.tenantId, runId };
        return name === "verify_run"
          ? readToolResult(await reads.run(input))
          : readToolResult(await reads.runManifest(input));
      },
    );
  }
  add(
    "verify_status",
    {
      description:
        "Poll the state and receipt ids of a tenant-owned verification operation; read the kind-specific terminal result once state is succeeded.",
      inputSchema: verificationOperationReadSchema.shape,
    },
    createVerificationOperationReadMcpExecutor(options),
  );
  for (const name of VERIFICATION_MCP_TOOL_NAMES)
    add(
      name,
      {
        description: `Bounded ${name} workflow through in-process verification admission.`,
        inputSchema: verificationToolSchemas[name].shape,
      },
      async (value: unknown) => executeVerification(name, value),
    );
  return definitions;
}
