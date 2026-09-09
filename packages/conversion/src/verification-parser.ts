import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { sha256Digest } from "@aiengineer/knowledge-domain";

export interface VerificationParserRequest {
  readonly kind: "html" | "pdf";
  readonly bytes: Uint8Array;
  readonly parentDigest: `sha256:${string}`;
  readonly signal?: AbortSignal;
}
export interface VerificationParserOutput {
  readonly parserVersion: "verification-native-parser.v1";
  readonly parentDigest: `sha256:${string}`;
  /** Still requires strict projection admission and registered parent lineage. */
  readonly projections: readonly unknown[];
  readonly residuals: readonly unknown[];
  readonly nativeOutput: Uint8Array;
  readonly nativeOutputDigest: `sha256:${string}`;
  readonly imageDigest: `sha256:${string}`;
  readonly transformationSignature: `sha256:${string}`;
}

export const VERIFICATION_PARSER_LIMITS = Object.freeze({ inputBytes: 8_000_000, outputBytes: 4_000_000, timeoutMs: 45_000, memoryBytes: 536_870_912, cpuSeconds: 15, cpus: 1, temporaryBytes: 67_108_864, pages: 40, pids: 32 });
const byteDigest = (bytes: Uint8Array): `sha256:${string}` => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

/** Trusted deployment configuration only: image must be an immutable local image ID. */
export class SandboxedVerificationParser {
  constructor(private readonly imageDigest: `sha256:${string}`, private readonly dockerExecutable = "docker") {
    if (!/^sha256:[a-f0-9]{64}$/.test(imageDigest)) throw new Error("PARSER_IMAGE_DIGEST_REQUIRED");
  }

  async parse(request: VerificationParserRequest): Promise<VerificationParserOutput> {
    if (!(["html", "pdf"] as const).includes(request.kind) || request.bytes.byteLength === 0 || request.bytes.byteLength > VERIFICATION_PARSER_LIMITS.inputBytes) throw new Error("PARSER_INPUT_LIMIT_OR_TYPE");
    if (request.parentDigest !== byteDigest(request.bytes)) throw new Error("PARSER_PARENT_DIGEST_MISMATCH");
    if (request.signal?.aborted) throw new Error("PARSER_CANCELLED");
    const name = `verification-parser-${randomUUID()}`;
    const deadline = Date.now() + VERIFICATION_PARSER_LIMITS.timeoutMs;
    const remaining = () => {
      const milliseconds = deadline - Date.now();
      if (milliseconds <= 0) throw new Error("PARSER_TIMEOUT");
      return milliseconds;
    };
    let containerCreated = false;
    try {
      await this.command(["create", "--name", name, "--interactive", "--network", "none", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", "--pids-limit", "32", "--memory", "512m", "--memory-swap", "512m", "--cpus", "1", "--ulimit", "nofile=64:64", "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=64m", this.imageDigest], undefined, remaining(), request.signal, 4096);
      containerCreated = true;
      const input = Buffer.from(JSON.stringify({ kind: request.kind, contentBase64: Buffer.from(request.bytes).toString("base64"), parentDigest: request.parentDigest }));
      const nativeOutput = await this.command(["start", "--attach", "--interactive", name], input, remaining(), request.signal, VERIFICATION_PARSER_LIMITS.outputBytes);
      // docker start --attach does not consistently forward the container exit status.
      const state = new TextDecoder().decode(await this.command(["inspect", "--format", "{{.State.ExitCode}}", name], undefined, remaining(), request.signal, 1024)).trim();
      if (state !== "0") throw new Error("PARSER_INPUT_OR_RESOURCE_FAILURE");
      let parsed: unknown;
      try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(nativeOutput)); } catch { throw new Error("PARSER_INVALID_OUTPUT"); }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("PARSER_INVALID_OUTPUT");
      const value = parsed as Record<string, unknown>;
      if (Object.keys(value).some((key) => !["parserVersion", "parentDigest", "projections", "residuals"].includes(key)) || value.parserVersion !== "verification-native-parser.v1" || value.parentDigest !== request.parentDigest || !Array.isArray(value.projections) || value.projections.length < 1 || value.projections.length > 2 || !Array.isArray(value.residuals) || value.residuals.length > 1000) throw new Error("PARSER_INVALID_OUTPUT");
      return { parserVersion: value.parserVersion, parentDigest: request.parentDigest, projections: value.projections, residuals: value.residuals, nativeOutput, nativeOutputDigest: byteDigest(nativeOutput), imageDigest: this.imageDigest, transformationSignature: sha256Digest({ parserVersion: value.parserVersion, imageDigest: this.imageDigest, limits: { ...VERIFICATION_PARSER_LIMITS }, kind: request.kind }) };
    } finally {
      // An interrupted create may still have made the uniquely named container,
      // so always attempt cleanup. Only mask the parse outcome when creation was
      // confirmed and that mandatory cleanup failed.
      await this.command(["rm", "--force", name], undefined, 10_000, undefined, 4096).catch(() => {
        if (containerCreated) throw new Error("PARSER_SANDBOX_CLEANUP_FAILED");
      });
    }
  }

  private command(args: readonly string[], input: Uint8Array | undefined, timeoutMs: number, signal: AbortSignal | undefined, maximumOutput: number): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(new Error("PARSER_CANCELLED")); return; }
      const child = spawn(this.dockerExecutable, [...args], { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      const chunks: Buffer[] = [];
      let size = 0;
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        if (error) { child.kill(); reject(error); } else resolve(Buffer.concat(chunks));
      };
      const abort = () => finish(new Error("PARSER_CANCELLED"));
      const timer = setTimeout(() => finish(new Error("PARSER_TIMEOUT")), timeoutMs);
      signal?.addEventListener("abort", abort, { once: true });
      child.on("error", () => finish(new Error("PARSER_RUNTIME_UNAVAILABLE")));
      child.stdout.on("data", (chunk: Buffer) => { size += chunk.length; if (size > maximumOutput) finish(new Error("PARSER_OUTPUT_LIMIT")); else chunks.push(chunk); });
      // Raw parser stderr may contain document text; drain without logging it.
      child.stderr.resume();
      child.stdin.on("error", () => { /* EPIPE is classified from process exit. */ });
      child.on("close", (code) => finish(code === 0 ? undefined : new Error("PARSER_INPUT_OR_RESOURCE_FAILURE")));
      child.stdin.end(input);
      if (signal?.aborted) abort();
    });
  }
}
