import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { VerificationExecutor } from "./executor.js";
import { ClaimsIntentSchema, ExtractionIntentSchema, ReportIntentSchema, PolicyDefinitionInputSchema } from "./intents.js";

/**
 * One MCP tool per executor step. Every tool is stateless from the client's
 * point of view; chain state lives in the filesystem store under `runId`.
 */

const runId = z.string().min(1).max(200).describe("Agent-chosen run id. Every mutation is logged as a step receipt under this id.");
const captureId = z.string().min(1).max(255);

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

function ok(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function error(err: unknown): ToolResult {
  const message = err instanceof Error ? err.message : String(err);
  const issues = typeof err === "object" && err && "issues" in err ? (err as { issues: unknown }).issues : undefined;
  return { content: [{ type: "text", text: JSON.stringify({ error: message, ...(issues ? { issues } : {}) }, null, 2) }], isError: true };
}

const guard = <T>(fn: () => Promise<T>) => fn().then(ok).catch(error);

export function createVerificationMcpServer(executor: VerificationExecutor): McpServer {
  const server = new McpServer({ name: "knowledge-verification-executor", version: "0.1.0" });

  server.registerTool(
    "verify_capture_source",
    {
      title: "Capture a source",
      description: "Fetch a URL (Firecrawl when configured, otherwise HTTPS GET), store the captured text as an immutable content-addressed artifact, and return a captureId plus a preview. Quotes used in intents must be exact substrings of this captured text.",
      inputSchema: { url: z.string().url(), runId: runId.optional(), captureId: captureId.optional().describe("Optional stable id; defaults to a digest-derived id."), method: z.enum(["auto", "firecrawl", "https_get"]).optional() },
    },
    async (input) => guard(() => executor.captureSource(input)),
  );

  server.registerTool(
    "verify_capture_file",
    {
      title: "Capture a document you already hold",
      description: "Capture bytes instead of a URL: markdown/text/json inline as `text`, or any supported document (pdf, docx, doc, odt, rtf, xlsx, xls, pptx, ppt, epub, csv, html) as `base64`. The executor converts the document to markdown itself (Firecrawl parse) and stores the original bytes beside the text, so the capture is trustworthy evidence. Sandbox files are normally pushed through the HTTP POST /captures route instead of inlining base64.",
      inputSchema: {
        filename: z.string().min(1).max(255).describe("File name with extension; drives media-type detection."),
        text: z.string().min(1).max(4_000_000).optional().describe("UTF-8 content for text-like files."),
        base64: z.string().min(1).max(70_000_000).optional().describe("Base64 bytes for binary documents."),
        mediaType: z.string().min(1).max(120).optional(),
        sourceUri: z.string().min(1).max(2000).optional().describe("Where the bytes came from (URL, bucket key, sandbox path)."),
        captureId: captureId.optional(),
        runId: runId.optional(),
      },
    },
    async (input) => guard(async () => {
      if (!input.text && !input.base64) throw new Error("TEXT_OR_BASE64_REQUIRED");
      const bytes = input.base64 ? new Uint8Array(Buffer.from(input.base64, "base64")) : new TextEncoder().encode(input.text!);
      return executor.captureFile({ bytes, filename: input.filename, ...(input.mediaType ? { mediaType: input.mediaType } : {}), ...(input.sourceUri ? { sourceUri: input.sourceUri } : {}), ...(input.captureId ? { captureId: input.captureId } : {}), ...(input.runId ? { runId: input.runId } : {}) });
    }),
  );

  server.registerTool(
    "verify_supported_media_types",
    { title: "Supported capture media types", description: "List every content type the executor can capture and how each is converted to the text representation quotes are selected from.", inputSchema: {} },
    async () => guard(async () => executor.supportedMediaTypes()),
  );

  server.registerTool(
    "verify_list_captures",
    { title: "List captures", description: "List every capture in the store with its digest and size.", inputSchema: {} },
    async () => guard(() => executor.listCaptures()),
  );

  server.registerTool(
    "verify_read_capture",
    {
      title: "Read captured text",
      description: "Read a window of the exact captured text (default 6000 chars, max 20000). Use this to inspect the source before choosing quotes.",
      inputSchema: { captureId, offset: z.number().int().nonnegative().optional(), length: z.number().int().positive().max(20_000).optional(), runId: runId.optional() },
    },
    async (input) => guard(() => executor.readCapture(input)),
  );

  server.registerTool(
    "verify_search_capture",
    {
      title: "Search captured text",
      description: "Find where a phrase (or the words of a phrase) occurs in a capture. Returns exact substrings with context and their occurrence counts so you can build a unique quote.",
      inputSchema: { captureId, query: z.string().min(1).max(400), limit: z.number().int().positive().max(25).optional(), runId: runId.optional() },
    },
    async (input) => guard(() => executor.searchCapture(input)),
  );

  server.registerTool(
    "verify_locate_quote",
    {
      title: "Locate a quote",
      description: "Resolve a candidate quote as a text_quote selector on the captured bytes. status=resolved means it occurs exactly once and is safe to put in an intent; ambiguous/not_found include suggestions.",
      inputSchema: { captureId, quote: z.string().min(1).max(4000), runId: runId.optional() },
    },
    async (input) => guard(() => executor.locateQuote(input)),
  );

  server.registerTool(
    "verify_register_artifact",
    {
      title: "Register an artifact",
      description: "Store text (an intent file, a report, notes) as a content-addressed artifact and get back its artifactId/digest. Sandbox files are normally pushed via the HTTP /artifacts route instead.",
      inputSchema: { text: z.string().min(1).max(2_000_000), mediaType: z.string().min(1).max(120).default("application/json"), label: z.string().max(80).optional(), runId: runId.optional() },
    },
    async (input) => guard(() => executor.registerArtifact({ bytes: new TextEncoder().encode(input.text), mediaType: input.mediaType, ...(input.label ? { label: input.label } : {}), ...(input.runId ? { runId: input.runId } : {}) })),
  );

  server.registerTool(
    "verify_claims",
    {
      title: "Verify claims intent (mechanical stage)",
      description: "Compile a verification-claims-intent.v1 file into a VerificationBundle and run the deterministic verifier: capture integrity, selector resolution (each quote must occur exactly once), digest binding, and producer/verifier separation. Pass the intent inline or by intentArtifactId.",
      inputSchema: { runId, intentArtifactId: z.string().optional(), intent: ClaimsIntentSchema.optional() },
    },
    async (input) => guard(() => executor.verifyClaims(input)),
  );

  server.registerTool(
    "verify_extraction",
    {
      title: "Verify extraction intent",
      description: "Admit a bounded JSON schema, validate the candidate object against it, and check that every declared field is bound to a unique quote on the captured bytes with the declared comparison.",
      inputSchema: { runId: runId.optional(), intentArtifactId: z.string().optional(), intent: ExtractionIntentSchema.optional() },
    },
    async (input) => guard(() => executor.verifyExtraction(input)),
  );

  server.registerTool(
    "verify_judge_semantics",
    {
      title: "Semantic judge (evidence-only)",
      description: "For each mechanically passed assertion in the run, send only the mechanically selected fragments plus the proposition to a blinded judge model (default openai/gpt-5.6-terra via AI Gateway). Records verdicts and stores request/response bytes.",
      inputSchema: { runId, assertionIds: z.array(z.string()).optional(), model: z.enum(["openai/gpt-5.6-terra", "openai/gpt-5.6-luna", "anthropic/claude-haiku-4.5"]).optional(), crossFamilyModel: z.enum(["openai/gpt-5.6-terra", "openai/gpt-5.6-luna", "anthropic/claude-haiku-4.5"]).optional() },
    },
    async (input) => guard(() => executor.judgeSemantics(input)),
  );

  server.registerTool(
    "verify_evaluate_policy",
    {
      title: "Evaluate verification policy",
      description: "Compose recorded policy inputs (mechanical result + semantic assessments + source authority derived from declared authority vectors) and evaluate the policy. Outcome is one of pass, pass_with_warnings, review, abstain, fail. Assertions without a semantic assessment are recorded as pending review.",
      inputSchema: { runId, policy: PolicyDefinitionInputSchema.partial().optional() },
    },
    async (input) => guard(() => executor.evaluatePolicy(input)),
  );

  server.registerTool(
    "verify_seal_run",
    {
      title: "Seal audit bundle",
      description: "Build the run manifest (inputs, outputs, lineage) and seal an audit bundle binding bundle, deterministic result, policy inputs and decision. Returns manifest/payload digests and an inspection result.",
      inputSchema: { runId },
    },
    async (input) => guard(() => executor.sealRun(input)),
  );

  server.registerTool(
    "verify_check_report",
    {
      title: "Check report citations",
      description: "Given a report and a verification-report-intent.v1 mapping report sentences to claimIds, check every cited claim exists, mechanically passed, and (if judged) was semantically supported. Reports uncited verified claims and citations that rest on failed claims.",
      inputSchema: { runId: runId.optional(), intentArtifactId: z.string().optional(), intent: ReportIntentSchema.optional() },
    },
    async (input) => guard(() => executor.checkReport(input)),
  );

  server.registerTool(
    "verify_run_status",
    { title: "Run status", description: "Return the run's chain state (artifact ids for intent, bundle, result, semantic, policy, decision, audit) and every step receipt recorded so far.", inputSchema: { runId } },
    async (input) => guard(() => executor.runStatus(input)),
  );

  server.registerTool(
    "verify_get_artifact",
    { title: "Get artifact", description: "Fetch a stored artifact by artifactId or digest (as text, json or just the handle).", inputSchema: { artifactId: z.string().optional(), digest: z.string().optional(), as: z.enum(["text", "json", "handle"]).optional() } },
    async (input) => guard(() => executor.artifact(input)),
  );

  return server;
}
