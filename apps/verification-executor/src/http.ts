import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { VerificationExecutor } from "./executor.js";
import { createVerificationMcpServer } from "./mcp.js";

/**
 * Routes
 *   GET  /health
 *   POST /mcp                      Streamable HTTP MCP (stateless; one server per request)
 *   POST /artifacts                raw bytes -> handle (headers: content-type, x-artifact-label, x-run-id)
 *   POST /captures                 document bytes -> capture (headers: content-type, x-filename, x-source-uri, x-capture-id, x-run-id)
 *   GET  /media-types              content types the executor can capture
 *   GET  /artifacts/:artifactId    raw bytes back (digest re-verified on read)
 *   GET  /runs/:runId              chain state + step receipts
 *   GET  /captures                 list captures
 *
 * Optional bearer auth: set VERIFY_EXECUTOR_TOKEN and clients must send `Authorization: Bearer <token>`.
 */

async function readBody(request: IncomingMessage, limit = 16_000_000): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of request) {
    const bytes = chunk as Uint8Array;
    total += bytes.byteLength;
    if (total > limit) throw new Error("BODY_TOO_LARGE");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value, null, 2));
}

export function createHttpServer(executor: VerificationExecutor, options: { token?: string } = {}): Server {
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    try {
      if (request.method === "GET" && url.pathname === "/health") return json(response, 200, { status: "ok", store: executor.store.rootDir, tenantId: executor.store.tenantId });
      if (options.token) {
        const header = request.headers.authorization ?? "";
        if (header !== `Bearer ${options.token}`) return json(response, 401, { error: "UNAUTHORIZED" });
      }
      if (url.pathname === "/mcp") {
        const body = request.method === "POST" ? JSON.parse(Buffer.from(await readBody(request)).toString("utf8") || "null") : undefined;
        const server = createVerificationMcpServer(executor);
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        await server.connect(transport);
        response.on("close", () => { void transport.close(); void server.close(); });
        await transport.handleRequest(request, response, body);
        return;
      }
      if (request.method === "POST" && url.pathname === "/artifacts") {
        const bytes = await readBody(request);
        if (bytes.byteLength === 0) return json(response, 400, { error: "EMPTY_BODY" });
        const label = typeof request.headers["x-artifact-label"] === "string" ? request.headers["x-artifact-label"] : undefined;
        const run = typeof request.headers["x-run-id"] === "string" ? request.headers["x-run-id"] : undefined;
        const mediaType = request.headers["content-type"]?.toString() || "application/octet-stream";
        const result = await executor.registerArtifact({ bytes, mediaType, ...(label ? { label } : {}), ...(run ? { runId: run } : {}) });
        return json(response, 201, result);
      }
      if (request.method === "POST" && url.pathname === "/captures") {
        const bytes = await readBody(request, 60_000_000);
        if (bytes.byteLength === 0) return json(response, 400, { error: "EMPTY_BODY" });
        const header = (name: string): string | undefined => (typeof request.headers[name] === "string" ? decodeURIComponent(request.headers[name] as string) : undefined);
        const filename = header("x-filename");
        if (!filename) return json(response, 400, { error: "X_FILENAME_REQUIRED" });
        const declared = request.headers["content-type"]?.toString();
        const result = await executor.captureFile({
          bytes,
          filename,
          ...(declared && declared !== "application/octet-stream" ? { mediaType: declared } : {}),
          ...(header("x-source-uri") ? { sourceUri: header("x-source-uri")! } : {}),
          ...(header("x-capture-id") ? { captureId: header("x-capture-id")! } : {}),
          ...(header("x-run-id") ? { runId: header("x-run-id")! } : {}),
        });
        return json(response, 201, result);
      }
      if (request.method === "GET" && url.pathname === "/media-types") return json(response, 200, executor.supportedMediaTypes());
      const artifactMatch = /^\/artifacts\/([^/]+)$/.exec(url.pathname);
      if (request.method === "GET" && artifactMatch) {
        const id = decodeURIComponent(artifactMatch[1]!);
        const handle = await executor.store.resolveHandle(id.startsWith("sha256:") ? { digest: id } : { artifactId: id });
        const bytes = await executor.store.bytes(handle);
        response.writeHead(200, { "content-type": handle.mediaType, "x-artifact-id": handle.artifactId, "x-artifact-digest": handle.digest });
        response.end(Buffer.from(bytes));
        return;
      }
      const runMatch = /^\/runs\/([^/]+)$/.exec(url.pathname);
      if (request.method === "GET" && runMatch) return json(response, 200, await executor.runStatus({ runId: decodeURIComponent(runMatch[1]!) }));
      if (request.method === "GET" && url.pathname === "/captures") return json(response, 200, await executor.listCaptures());
      return json(response, 404, { error: "NOT_FOUND" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!response.headersSent) json(response, message.includes("NOT_FOUND") ? 404 : 500, { error: message });
      else response.end();
    }
  });
}
