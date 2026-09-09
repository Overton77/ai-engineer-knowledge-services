import type { DoclingServeClient, UnstructuredTransformClient } from "./providers.js";
export type ConversionFetch = (url: string, init?: RequestInit) => Promise<Response>;
export interface UnstructuredHttpConfig { baseUrl: string; apiKey: string; templateId: string; jobPath?: string; maximumResultBytes: number }
export interface DoclingServeHttpConfig {
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly convertPath?: string;
  readonly maximumResultBytes: number;
  readonly requestTimeoutMs?: number;
  readonly doOcr?: boolean;
}
function safeBaseUrl(value: string) { const url = new URL(value); if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(url.hostname))) throw new Error("UNSTRUCTURED_URL_DENIED"); return url.href.replace(/\/$/, ""); }
function safeDoclingBaseUrl(value: string) { const url = new URL(value); if (url.username || url.password || url.search || url.hash) throw new Error("DOCLING_URL_DENIED"); if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(url.hostname))) throw new Error("DOCLING_URL_DENIED"); return url.href.replace(/\/$/, ""); }
async function safeJson(response: Response): Promise<Record<string, unknown>> { if (!response.ok) throw new Error(`UNSTRUCTURED_HTTP_${response.status}`); const value: unknown = await response.json(); if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("UNSTRUCTURED_INVALID_OUTPUT"); return value as Record<string, unknown>; }
async function readBounded(response: Response, maximumBytes: number, errorCode: string): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) throw new Error(errorCode);
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumBytes) {
        await reader.cancel(errorCode).catch(() => undefined);
        throw new Error(errorCode);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
export class HttpUnstructuredTransformClient implements UnstructuredTransformClient {
  readonly #baseUrl: string; constructor(private readonly config: UnstructuredHttpConfig, private readonly fetcher: ConversionFetch = fetch) { this.#baseUrl = safeBaseUrl(config.baseUrl); if (!config.apiKey.trim()) throw new Error("UNSTRUCTURED_CREDENTIAL_REQUIRED"); }
  #headers(extra?: Record<string, string>) { const headers = new Headers(extra); headers.set("unstructured-api-key", this.config.apiKey); headers.set("accept", "application/json"); return headers; }
  async createJob(input: { artifactDigest: string; profileDigest: string; bytes: Uint8Array; mediaType: string }) { const form = new FormData(); form.set("request_data", JSON.stringify({ template_id: this.config.templateId, metadata: { artifact_digest: input.artifactDigest, profile_digest: input.profileDigest } })); const body = Uint8Array.from(input.bytes).buffer; form.append("input_files", new Blob([body], { type: input.mediaType }), `sealed-${input.artifactDigest.slice(7, 19)}.bin`); const response = await this.fetcher(`${this.#baseUrl}${this.config.jobPath ?? "/jobs/"}`, { method: "POST", headers: this.#headers(), body: form }); const value = await safeJson(response); const jobId = value.id ?? value.job_id; if (typeof jobId !== "string" || !jobId) throw new Error("UNSTRUCTURED_INVALID_JOB_ID"); return { jobId }; }
  async getJob(jobId: string) { if (!/^[a-zA-Z0-9-]+$/.test(jobId)) throw new Error("UNSTRUCTURED_INVALID_JOB_ID"); const value = await safeJson(await this.fetcher(`${this.#baseUrl}/jobs/${encodeURIComponent(jobId)}`, { headers: this.#headers() })); const status = String(value.status ?? "").toUpperCase(); const state = status === "COMPLETED" ? "succeeded" : status === "FAILED" || status === "STOPPED" ? "failed" : status === "IN_PROGRESS" ? "running" : "queued"; return { state, ...(state === "failed" ? { error: "provider_reported_failure" } : {}) } as const; }
  async downloadResult(jobId: string) { if (!/^[a-zA-Z0-9-]+$/.test(jobId)) throw new Error("UNSTRUCTURED_INVALID_JOB_ID"); const response = await this.fetcher(`${this.#baseUrl}/jobs/${encodeURIComponent(jobId)}/download`, { headers: this.#headers() }); if (!response.ok) throw new Error(`UNSTRUCTURED_DOWNLOAD_HTTP_${response.status}`); const length = Number(response.headers.get("content-length")); if (Number.isFinite(length) && length > this.config.maximumResultBytes) throw new Error("UNSTRUCTURED_RESULT_SIZE_LIMIT"); const bytes = new Uint8Array(await response.arrayBuffer()); if (bytes.byteLength > this.config.maximumResultBytes) throw new Error("UNSTRUCTURED_RESULT_SIZE_LIMIT"); const text = new TextDecoder().decode(bytes); let parsed: unknown; try { parsed = JSON.parse(text); } catch { parsed = undefined; } const markdown = parsed && typeof parsed === "object" && typeof (parsed as Record<string, unknown>).markdown === "string" ? (parsed as Record<string, string>).markdown! : text; const plainText = parsed && typeof parsed === "object" && typeof (parsed as Record<string, unknown>).text === "string" ? (parsed as Record<string, string>).text! : markdown; return { native: bytes, markdown, plainText }; }
}

/** Bounded client for Docling Serve's stable synchronous multipart v1 API. */
export class HttpDoclingServeClient implements DoclingServeClient {
  readonly #baseUrl: string;

  constructor(
    private readonly config: DoclingServeHttpConfig,
    private readonly fetcher: ConversionFetch = fetch,
  ) {
    this.#baseUrl = safeDoclingBaseUrl(config.baseUrl);
    if (!Number.isSafeInteger(config.maximumResultBytes) || config.maximumResultBytes < 1) throw new Error("DOCLING_INVALID_RESULT_LIMIT");
    if (config.requestTimeoutMs !== undefined && (!Number.isSafeInteger(config.requestTimeoutMs) || config.requestTimeoutMs < 1)) throw new Error("DOCLING_INVALID_TIMEOUT");
    if (config.convertPath !== undefined && !/^\/[a-zA-Z0-9/_-]+$/.test(config.convertPath)) throw new Error("DOCLING_INVALID_CONVERT_PATH");
  }

  async convert(input: { bytes: Uint8Array; mediaType: string; profileDigest: string }) {
    const form = new FormData();
    const suffixByMediaType: Readonly<Record<string, string>> = {
      "application/pdf": "pdf", "text/html": "html", "text/markdown": "md",
      "text/plain": "txt", "text/vtt": "vtt", "application/json": "json",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
    };
    const suffix = suffixByMediaType[input.mediaType] ?? "bin";
    form.append("files", new Blob([Uint8Array.from(input.bytes).buffer], { type: input.mediaType }), `sealed-${input.profileDigest.slice(7, 19)}.${suffix}`);
    form.append("to_formats", "md");
    form.append("to_formats", "json");
    form.append("to_formats", "text");
    form.append("image_export_mode", "placeholder");
    form.append("do_ocr", String(this.config.doOcr ?? true));
    form.append("abort_on_error", "true");

    const headers = new Headers({ accept: "application/json" });
    if (this.config.apiKey?.trim()) headers.set("x-api-key", this.config.apiKey);
    const response = await this.fetcher(`${this.#baseUrl}${this.config.convertPath ?? "/v1/convert/file"}`, {
      method: "POST",
      headers,
      body: form,
      ...(this.config.requestTimeoutMs === undefined ? {} : { signal: AbortSignal.timeout(this.config.requestTimeoutMs) }),
    });
    if (!response.ok) throw new Error(`DOCLING_HTTP_${response.status}`);
    const native = await readBounded(response, this.config.maximumResultBytes, "DOCLING_RESULT_SIZE_LIMIT");
    let value: unknown;
    try { value = JSON.parse(new TextDecoder().decode(native)); }
    catch { throw new Error("DOCLING_INVALID_OUTPUT"); }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("DOCLING_INVALID_OUTPUT");
    const result = value as Record<string, unknown>;
    const status = String(result.status ?? "");
    if (status !== "success" && status !== "partial_success") throw new Error("DOCLING_CONVERSION_FAILED");
    const document = result.document;
    if (!document || typeof document !== "object" || Array.isArray(document)) throw new Error("DOCLING_INVALID_OUTPUT");
    const output = document as Record<string, unknown>;
    const markdown = typeof output.md_content === "string" ? output.md_content : "";
    const plainText = typeof output.text_content === "string" ? output.text_content : markdown;
    if (!markdown.trim() && !plainText.trim()) throw new Error("DOCLING_EMPTY_OUTPUT");
    if (output.json_content === undefined) throw new Error("DOCLING_INVALID_OUTPUT");
    const jobId = typeof result.task_id === "string" && result.task_id ? result.task_id : undefined;
    return { native, markdown: markdown || plainText, plainText: plainText || markdown, ...(jobId ? { jobId } : {}) };
  }
}

export type DoclingServeEnvironment = Readonly<Record<string, string | undefined>>;

function positiveEnvironmentInteger(environment: DoclingServeEnvironment, name: string, fallback: number): number {
  const raw = environment[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`INVALID_${name}`);
  return value;
}

/** Constructs the Docling client without exposing resolved configuration outside the provider boundary. */
export function createDoclingServeClientFromEnvironment(
  environment: DoclingServeEnvironment = process.env,
  fetcher: ConversionFetch = fetch,
): HttpDoclingServeClient {
  return new HttpDoclingServeClient({
    baseUrl: environment.DOCLING_BASE_URL?.trim() || "http://127.0.0.1:5001",
    ...(environment.DOCLING_API_KEY?.trim() ? { apiKey: environment.DOCLING_API_KEY.trim() } : {}),
    maximumResultBytes: positiveEnvironmentInteger(environment, "DOCLING_MAXIMUM_RESULT_BYTES", 67_108_864),
    requestTimeoutMs: positiveEnvironmentInteger(environment, "DOCLING_REQUEST_TIMEOUT_MS", 300_000),
  }, fetcher);
}
