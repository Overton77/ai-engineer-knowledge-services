import { readFile, writeFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { mediaTypeForFilename } from "./capture.js";
import { loadExecutorConfig, VerificationExecutor } from "./executor.js";
import { createVerificationMcpServer } from "./mcp.js";
import { RemoteExecutor, RemoteExecutorError } from "./remote.js";
import { createKnowledgeFromEnv, describeRunning, startExecutorServer } from "./serve.js";

export * from "./executor.js";
export * from "./intents.js";
export * from "./store.js";
export { createVerificationMcpServer, registerKnowledgeTools } from "./mcp.js";
export { createHttpServer } from "./http.js";
export { RemoteExecutor, RemoteExecutorError } from "./remote.js";
export { SUPPORTED_MEDIA_TYPES, mediaTypeForFilename } from "./capture.js";
export { startExecutorServer, createKnowledgeFromEnv } from "./serve.js";
export { knowledgeOperations } from "./knowledge/operations.js";
export { createKnowledgeServices, loadKnowledgeConfig, KNOWLEDGE_EXECUTOR_VERSION } from "./knowledge/context.js";
export { defineOperation, OperationRegistry } from "./operations/define.js";

const HELP = `knowledge-verify — deterministic verification executor over agent-written intent files

Usage: knowledge-verify <command> [options]

Modes
  local   (default)            run against the filesystem store in VERIFY_STORE_DIR
  remote  VERIFY_EXECUTOR_URL  forward every command to a running \`knowledge-verify serve\`
                               (or pass --remote <url>; --token / VERIFY_EXECUTOR_TOKEN for bearer auth)

Serving
  serve [--port 4310] [--host 127.0.0.1]     HTTP: /mcp (Streamable HTTP MCP), /artifacts, /captures, /runs/:id, /health,
                                             /knowledge/:operation (schema_*, db_*, ingest_*, artifact_get when POSTGRES_URL is set)
  mcp-stdio                                  MCP over stdio (for local agent harnesses)
  health                                     remote: GET /health; local: store info
  (the sibling \`knowledge\` binary drives the schema / db / ingest operations; \`knowledge help\`)

Capture (evidence enters the system only here)
  capture <url> --run <runId> --capture-id <id> [--method auto|firecrawl|https_get]
                                             html → markdown; pdf/docx/xlsx/pptx/csv/… behind a URL → parsed to markdown
  capture-file <path> --run <runId> --capture-id <id> [--source-uri <uri>] [--media-type <type>]
                                             a document you already hold (pdf, docx, doc, odt, rtf, xlsx, xls, pptx, ppt, epub,
                                             csv, html, md, txt, json); the executor converts it, never the agent
  media-types                                every capturable content type and how it is converted
  captures                                   list captures in the store

Inspect / locate (read-only)
  read <captureId> [--offset N] [--length N]
  search <captureId> <query> [--limit N]
  locate <captureId> <quote>                 exit 0 only when status=resolved (exactly one occurrence)

Artifacts
  register <file> --label <label> --run <runId> [--media-type <type>]
  artifact <artifactId|sha256:...> [--as text|json|handle]

Verification chain (all keyed by --run <runId>; run them in this order)
  verify-claims <intent.json> --run <runId>              exit 0 only when status=passed
  verify-extraction <intent.json> --run <runId>          exit 0 only when valid=true
  judge --run <runId> [--model <id>] [--cross-family <id>] [--assertions id1,id2]
                                                         exit 0 only when every assessed verdict is admitted
  policy --run <runId> [--policy <policy.json>]          exit 0 only when outcome is pass|pass_with_warnings
  seal --run <runId>                                     exit 0 only when inspection.valid=true
  check-report <intent.json> --run <runId>               exit 0 only when ok=true
  status --run <runId>                                   chain state + ordered step receipts

Output
  Every command prints exactly one JSON document to stdout.
  --out <file>   also write that JSON to <file> and print a compact summary instead (keeps agent context small)

Exit codes
  0  command succeeded and its quality gate passed (see per-command notes above)
  1  command succeeded but the quality gate did not pass — read the JSON, fix the intent/quote, re-run
  2  usage, network, auth, or executor error (JSON with "error" on stderr)

Environment
  VERIFY_EXECUTOR_URL  VERIFY_EXECUTOR_TOKEN                      remote mode
  VERIFY_STORE_DIR (default .verification-store)  VERIFY_TENANT_ID   VERIFY_PRODUCER_DEPLOYMENT_ID
  VERIFY_VERIFIER_DEPLOYMENT_ID   VERIFY_PRINCIPAL_SALT   VERIFY_JUDGE_MODEL   VERIFY_CROSS_FAMILY_JUDGE_MODEL
  AI_GATEWAY_API_KEY (judge)   FIRECRAWL_API_KEY (capture + document parsing)`;

interface Parsed { command: string; positionals: string[]; flags: Record<string, string | true> }

function parseArgs(argv: string[]): Parsed {
  const [command = "help", ...rest] = argv;
  const positionals: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let index = 0; index < rest.length; index += 1) {
    const item = rest[index]!;
    if (item.startsWith("--")) {
      const key = item.slice(2);
      const next = rest[index + 1];
      if (next !== undefined && !next.startsWith("--")) { flags[key] = next; index += 1; } else flags[key] = true;
    } else positionals.push(item);
  }
  return { command, positionals, flags };
}

const str = (value: string | true | undefined): string | undefined => (typeof value === "string" ? value : undefined);
const num = (value: string | true | undefined): number | undefined => (typeof value === "string" ? Number(value) : undefined);
const need = (value: string | undefined, name: string): string => { if (!value) throw new UsageError(`${name} is required`); return value; };

class UsageError extends Error { override name = "UsageError"; }
class QualityGateError extends Error { override name = "QualityGateError"; constructor(readonly payload: unknown, readonly reason: string) { super(reason); } }

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

function artifactMediaTypeFor(path: string, override?: string): string {
  if (override) return override;
  const ext = extname(path).toLowerCase();
  return ext === ".json" ? "application/json" : ext === ".md" ? "text/markdown; charset=utf-8" : ext === ".txt" ? "text/plain; charset=utf-8" : "application/octet-stream";
}

// ---- backends -------------------------------------------------------------------------------

interface Backend {
  readonly mode: "local" | "remote";
  call(operation: string, args: Record<string, unknown>): Promise<unknown>;
  registerBytes(input: { bytes: Uint8Array; mediaType: string; label?: string; runId?: string }): Promise<unknown>;
  captureBytes(input: { bytes: Uint8Array; filename: string; mediaType?: string; sourceUri?: string; captureId?: string; runId?: string }): Promise<unknown>;
  status(runId: string): Promise<unknown>;
  artifact(id: string, as: "text" | "json" | "handle" | undefined): Promise<unknown>;
  health(): Promise<unknown>;
  listCaptures(): Promise<unknown>;
  mediaTypes(): Promise<unknown>;
}

function localBackend(executor: VerificationExecutor): Backend {
  const table: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
    verify_capture_source: (args) => executor.captureSource(args as never),
    verify_read_capture: (args) => executor.readCapture(args as never),
    verify_search_capture: (args) => executor.searchCapture(args as never),
    verify_locate_quote: (args) => executor.locateQuote(args as never),
    verify_claims: (args) => executor.verifyClaims(args as never),
    verify_extraction: (args) => executor.verifyExtraction(args as never),
    verify_judge_semantics: (args) => executor.judgeSemantics(args as never),
    verify_evaluate_policy: (args) => executor.evaluatePolicy(args as never),
    verify_seal_run: (args) => executor.sealRun(args as never),
    verify_check_report: (args) => executor.checkReport(args as never),
  };
  return {
    mode: "local",
    call: (operation, args) => { const fn = table[operation]; if (!fn) throw new UsageError(`unknown operation ${operation}`); return fn(args); },
    registerBytes: (input) => executor.registerArtifact(input),
    captureBytes: (input) => executor.captureFile(input),
    status: (runId) => executor.runStatus({ runId }),
    artifact: (id, as) => executor.artifact({ ...(id.startsWith("sha256:") ? { digest: id } : { artifactId: id }), ...(as ? { as } : {}) }),
    health: async () => ({ status: "ok", mode: "local", store: executor.store.rootDir, tenantId: executor.store.tenantId }),
    listCaptures: () => executor.listCaptures(),
    mediaTypes: async () => executor.supportedMediaTypes(),
  };
}

function remoteBackend(remote: RemoteExecutor): Backend {
  return {
    mode: "remote",
    call: (operation, args) => remote.tool(operation, args),
    registerBytes: (input) => remote.registerBytes(input),
    captureBytes: (input) => remote.captureBytes(input),
    status: (runId) => remote.runStatus(runId),
    artifact: (id, as) => remote.artifact(id, as ?? "json"),
    health: () => remote.health(),
    listCaptures: () => remote.listCaptures(),
    mediaTypes: () => remote.mediaTypes(),
  };
}

// ---- quality gates ------------------------------------------------------------------------

const ADMITTED_VERDICTS = new Set(["directly_supported", "supported_with_qualification"]);

function qualityGate(command: string, output: unknown): string | undefined {
  const value = (output ?? {}) as Record<string, unknown>;
  switch (command) {
    case "locate": return value.status === "resolved" ? undefined : `locate status=${String(value.status)} occurrenceCount=${String(value.occurrenceCount)}`;
    case "verify-claims": return value.status === "passed" ? undefined : `mechanical status=${String(value.status)}`;
    case "verify-extraction": return value.valid === true ? undefined : `extraction valid=${String(value.valid)} failedPaths=${JSON.stringify(value.failedPaths ?? [])}`;
    case "judge": {
      const assessed = Array.isArray(value.assessed) ? (value.assessed as { assertionId: string; verdict: string }[]) : [];
      const rejected = assessed.filter((item) => !ADMITTED_VERDICTS.has(item.verdict));
      return rejected.length === 0 ? undefined : `judge rejected ${rejected.length}/${assessed.length}: ${rejected.map((item) => `${item.assertionId}=${item.verdict}`).join(", ")}`;
    }
    case "policy": return value.outcome === "pass" || value.outcome === "pass_with_warnings" ? undefined : `policy outcome=${String(value.outcome)} reasons=${JSON.stringify(value.reasonCodes ?? [])}`;
    case "seal": { const inspection = value.inspection as { valid?: boolean } | undefined; return inspection?.valid === true ? undefined : "audit bundle inspection invalid"; }
    case "check-report": return value.ok === true ? undefined : `report check ok=false problems=${JSON.stringify(value.problems ?? [])} citationsOnFailedClaims=${JSON.stringify(value.citationsOnFailedClaims ?? [])}`;
    default: return undefined;
  }
}

function summarize(output: unknown): unknown {
  if (!output || typeof output !== "object" || Array.isArray(output)) return output;
  const summary: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(output as Record<string, unknown>)) {
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) summary[key] = typeof value === "string" && value.length > 200 ? `${value.slice(0, 200)}… (${value.length} chars)` : value;
    else if (Array.isArray(value)) summary[key] = `[${value.length} items]`;
    else if (typeof value === "object" && "artifactId" in (value as object)) summary[key] = value;
    else summary[key] = "{…}";
  }
  return summary;
}

// ---- main -----------------------------------------------------------------------------------

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const { command, positionals, flags } = parseArgs(argv);
  if (command === "help" || command === "--help" || command === "-h") { console.log(HELP); return; }

  const remoteUrl = str(flags.remote) ?? process.env.VERIFY_EXECUTOR_URL?.trim();
  const token = str(flags.token) ?? process.env.VERIFY_EXECUTOR_TOKEN?.trim();
  const run = str(flags.run);
  const out = str(flags.out);

  const emit = async (value: unknown) => {
    const text = JSON.stringify(value, null, 2);
    if (out) { await writeFile(out, `${text}\n`, "utf8"); process.stdout.write(`${JSON.stringify({ ...(summarize(value) as object), writtenTo: out }, null, 2)}\n`); }
    else process.stdout.write(`${text}\n`);
  };

  if (command === "mcp-stdio") {
    const executor = await VerificationExecutor.create(loadExecutorConfig());
    await createVerificationMcpServer(executor, await createKnowledgeFromEnv(process.env, executor)).connect(new StdioServerTransport());
    return;
  }
  if (command === "serve") {
    const port = num(flags.port) ?? Number(process.env.VERIFY_PORT ?? 4310);
    const host = str(flags.host) ?? process.env.VERIFY_HOST ?? "127.0.0.1";
    const running = await startExecutorServer({ port, host, ...(token ? { token } : {}) });
    console.error(JSON.stringify(describeRunning(running, token ? "bearer" : "none")));
    await new Promise<void>((resolve) => { process.on("SIGINT", () => void running.close().then(resolve)); process.on("SIGTERM", () => void running.close().then(resolve)); });
    return;
  }

  const backend: Backend = remoteUrl
    ? remoteBackend(new RemoteExecutor({ baseUrl: remoteUrl, ...(token ? { token } : {}) }))
    : localBackend(await VerificationExecutor.create(loadExecutorConfig()));

  const withRun = (args: Record<string, unknown>) => ({ ...args, ...(run ? { runId: run } : {}) });
  let output: unknown;
  switch (command) {
    case "health": output = await backend.health(); break;
    case "media-types": output = await backend.mediaTypes(); break;
    case "captures": output = await backend.listCaptures(); break;
    case "capture": {
      const method = str(flags.method);
      output = await backend.call("verify_capture_source", withRun({ url: need(positionals[0], "url"), ...(str(flags["capture-id"]) ? { captureId: str(flags["capture-id"]) } : {}), ...(method ? { method } : {}) }));
      break;
    }
    case "capture-file": {
      const path = need(positionals[0], "file path");
      const bytes = new Uint8Array(await readFile(path));
      const filename = basename(path);
      const mediaType = str(flags["media-type"]) ?? mediaTypeForFilename(filename);
      output = await backend.captureBytes({ bytes, filename, ...(mediaType ? { mediaType } : {}), ...(str(flags["source-uri"]) ? { sourceUri: str(flags["source-uri"]) } : {}), ...(str(flags["capture-id"]) ? { captureId: str(flags["capture-id"]) } : {}), ...(run ? { runId: run } : {}) });
      break;
    }
    case "read": output = await backend.call("verify_read_capture", withRun({ captureId: need(positionals[0], "captureId"), ...(num(flags.offset) !== undefined ? { offset: num(flags.offset) } : {}), ...(num(flags.length) !== undefined ? { length: num(flags.length) } : {}) })); break;
    case "search": output = await backend.call("verify_search_capture", withRun({ captureId: need(positionals[0], "captureId"), query: need(positionals.slice(1).join(" "), "query"), ...(num(flags.limit) !== undefined ? { limit: num(flags.limit) } : {}) })); break;
    case "locate": output = await backend.call("verify_locate_quote", withRun({ captureId: need(positionals[0], "captureId"), quote: need(positionals.slice(1).join(" "), "quote") })); break;
    case "register": {
      const path = need(positionals[0], "file");
      output = await backend.registerBytes({ bytes: new Uint8Array(await readFile(path)), mediaType: artifactMediaTypeFor(path, str(flags["media-type"])), ...(str(flags.label) ? { label: str(flags.label) } : {}), ...(run ? { runId: run } : {}) });
      break;
    }
    case "artifact": output = await backend.artifact(need(positionals[0], "artifactId"), str(flags.as) as "text" | "json" | "handle" | undefined); break;
    case "verify-claims": output = await backend.call("verify_claims", { runId: need(run, "--run"), intent: await readJson(need(positionals[0], "intent file")) }); break;
    case "verify-extraction": output = await backend.call("verify_extraction", withRun({ intent: await readJson(need(positionals[0], "intent file")) })); break;
    case "judge": output = await backend.call("verify_judge_semantics", { runId: need(run, "--run"), ...(str(flags.model) ? { model: str(flags.model) } : {}), ...(str(flags["cross-family"]) ? { crossFamilyModel: str(flags["cross-family"]) } : {}), ...(str(flags.assertions) ? { assertionIds: str(flags.assertions)!.split(",").map((item) => item.trim()).filter(Boolean) } : {}) }); break;
    case "policy": output = await backend.call("verify_evaluate_policy", { runId: need(run, "--run"), ...(str(flags.policy) ? { policy: await readJson(str(flags.policy)!) } : {}) }); break;
    case "seal": output = await backend.call("verify_seal_run", { runId: need(run, "--run") }); break;
    case "check-report": output = await backend.call("verify_check_report", withRun({ intent: await readJson(need(positionals[0], "intent file")) })); break;
    case "status": output = await backend.status(need(run, "--run")); break;
    default:
      throw new UsageError(`Unknown command: ${command}\n\n${HELP}`);
  }
  await emit(output);
  const gate = qualityGate(command, output);
  if (gate) throw new QualityGateError(output, gate);
}

const invokedDirectly = (() => {
  try {
    const entry = process.argv[1] ?? "";
    return /verification-executor[\\/](dist|src)[\\/]index\.(js|ts)$/.test(entry) || /knowledge-verify(\.cmd|\.js)?$/.test(entry) || /[\\/]knowledge-verify$/.test(entry);
  } catch { return false; }
})();

if (invokedDirectly) {
  main().catch((error: unknown) => {
    if (error instanceof QualityGateError) {
      process.stderr.write(`${JSON.stringify({ qualityGate: "failed", reason: error.reason })}\n`);
      process.exitCode = 1;
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    const issues = typeof error === "object" && error && "issues" in error ? (error as { issues: unknown }).issues : undefined;
    const payload = error instanceof RemoteExecutorError ? error.payload : undefined;
    process.stderr.write(`${JSON.stringify({ error: message, ...(issues ? { issues } : {}), ...(payload !== undefined ? { payload } : {}) }, null, 2)}\n`);
    process.exitCode = 2;
  });
}
