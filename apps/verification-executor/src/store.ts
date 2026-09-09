import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { VerificationArtifactHandle } from "@aiengineer/knowledge-contracts";
import { canonicalizeJson, sha256Digest } from "@aiengineer/knowledge-verification";

/**
 * Content-addressed filesystem store.
 *
 * Layout under `rootDir`:
 *   artifacts/<hex>              raw bytes (hex = sha256 of the bytes)
 *   artifacts/<hex>.handle.json  the VerificationArtifactHandle registered for those bytes
 *   captures/<captureId>.json    capture records (source + content handle)
 *   runs/<runId>/state.json      chain state for one claims-verification run
 *   runs/<runId>/steps.jsonl     append-only step receipts (one JSON object per line)
 *   runs/<runId>/steps/NNN-<op>.json  the same receipts, one file per step, for humans
 *
 * Puts are idempotent (same bytes -> same handle). Gets recompute the digest and
 * refuse to return bytes that do not match the address.
 */

export const encoder = new TextEncoder();
export const decoder = new TextDecoder("utf-8", { fatal: true });

export function deterministicUuid(namespace: string, value: string): string {
  const hex = createHash("sha256").update(`${namespace}\0${value}`).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}

export function shortId(value: string, length = 12): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

export interface RegisterArtifactInput {
  readonly bytes: Uint8Array;
  readonly mediaType: string;
  readonly producerActivityId: string;
  readonly producerVersion: string;
  readonly dataClassification?: "public" | "internal" | "confidential" | "restricted";
  readonly parentArtifactIds?: readonly string[];
  /** Any JSON value describing how the bytes were derived from the parents. Required when parents exist. */
  readonly transformation?: unknown;
  readonly createdAt?: string;
}

export interface StepReceipt {
  readonly runId: string;
  readonly sequence: number;
  readonly operation: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly status: "succeeded" | "failed";
  readonly input: unknown;
  readonly output: unknown;
  readonly error?: string;
}

export interface RunState {
  runId: string;
  createdAt: string;
  updatedAt: string;
  intentArtifactId?: string;
  bundleArtifactId?: string;
  resultArtifactId?: string;
  semanticArtifactId?: string;
  providerArtifactIds?: string[];
  policyArtifactId?: string;
  policyInputsArtifactId?: string;
  decisionArtifactId?: string;
  auditArtifactId?: string;
  extractionResultArtifactIds?: string[];
  reportCheckArtifactIds?: string[];
  captureIds?: string[];
}

export class FilesystemStore {
  readonly rootDir: string;
  readonly tenantId: string;

  constructor(rootDir: string, tenantId: string) {
    this.rootDir = resolve(rootDir);
    this.tenantId = tenantId;
  }

  async init(): Promise<void> {
    await Promise.all(["artifacts", "captures", "runs"].map((dir) => mkdir(join(this.rootDir, dir), { recursive: true })));
  }

  // ---- artifacts -----------------------------------------------------------

  artifactIdFor(digest: `sha256:${string}`): string {
    return deterministicUuid("artifact", `${this.tenantId}:${digest}`);
  }

  async put(input: RegisterArtifactInput): Promise<VerificationArtifactHandle> {
    const digest = sha256Digest(input.bytes);
    const hex = digest.slice("sha256:".length);
    const parents = [...(input.parentArtifactIds ?? [])].sort();
    if (parents.length > 0 && input.transformation === undefined) throw new Error("ARTIFACT_TRANSFORMATION_REQUIRED_FOR_PARENTS");
    const existing = await this.handleByDigest(digest);
    if (existing) return existing;
    const handle: VerificationArtifactHandle = {
      artifactId: this.artifactIdFor(digest),
      tenantId: this.tenantId,
      digest,
      mediaType: input.mediaType,
      byteLength: input.bytes.byteLength,
      objectKey: `artifacts/${hex}`,
      createdAt: input.createdAt ?? new Date().toISOString(),
      producerActivityId: input.producerActivityId,
      producerVersion: input.producerVersion,
      encryptionClass: "filesystem-plain",
      retentionClass: "experiment",
      dataClassification: input.dataClassification ?? "public",
      parentArtifactIds: parents,
      ...(input.transformation !== undefined ? { transformationSignature: sha256Digest(canonicalizeJson(stripUndefined(input.transformation))) } : {}),
    };
    await mkdir(join(this.rootDir, "artifacts"), { recursive: true });
    await writeFile(join(this.rootDir, handle.objectKey), input.bytes);
    await writeFile(join(this.rootDir, `${handle.objectKey}.handle.json`), JSON.stringify(handle, null, 2));
    return handle;
  }

  async putJson(value: unknown, input: Omit<RegisterArtifactInput, "bytes">): Promise<{ handle: VerificationArtifactHandle; bytes: Uint8Array }> {
    const bytes = encoder.encode(canonicalizeJson(stripUndefined(value)));
    return { handle: await this.put({ ...input, bytes }), bytes };
  }

  async handleByDigest(digest: `sha256:${string}`): Promise<VerificationArtifactHandle | undefined> {
    const path = join(this.rootDir, "artifacts", `${digest.slice("sha256:".length)}.handle.json`);
    if (!existsSync(path)) return undefined;
    return JSON.parse(await readFile(path, "utf8")) as VerificationArtifactHandle;
  }

  async handleById(artifactId: string): Promise<VerificationArtifactHandle | undefined> {
    const dir = join(this.rootDir, "artifacts");
    if (!existsSync(dir)) return undefined;
    for (const name of await readdir(dir)) {
      if (!name.endsWith(".handle.json")) continue;
      const handle = JSON.parse(await readFile(join(dir, name), "utf8")) as VerificationArtifactHandle;
      if (handle.artifactId === artifactId) return handle;
    }
    return undefined;
  }

  async resolveHandle(ref: { artifactId?: string; digest?: string }): Promise<VerificationArtifactHandle> {
    const handle = ref.digest
      ? await this.handleByDigest(ref.digest as `sha256:${string}`)
      : ref.artifactId
        ? await this.handleById(ref.artifactId)
        : undefined;
    if (!handle) throw new Error(`ARTIFACT_NOT_FOUND:${ref.artifactId ?? ref.digest ?? "?"}`);
    return handle;
  }

  async bytes(handle: VerificationArtifactHandle): Promise<Uint8Array> {
    const raw = new Uint8Array(await readFile(join(this.rootDir, handle.objectKey)));
    if (sha256Digest(raw) !== handle.digest) throw new Error(`ARTIFACT_DIGEST_MISMATCH:${handle.artifactId}`);
    if (raw.byteLength !== handle.byteLength) throw new Error(`ARTIFACT_LENGTH_MISMATCH:${handle.artifactId}`);
    return raw;
  }

  async text(handle: VerificationArtifactHandle): Promise<string> {
    return decoder.decode(await this.bytes(handle));
  }

  async json<T = unknown>(handle: VerificationArtifactHandle): Promise<T> {
    return JSON.parse(await this.text(handle)) as T;
  }

  // ---- captures ------------------------------------------------------------

  async writeCapture(record: CaptureRecord): Promise<void> {
    await mkdir(join(this.rootDir, "captures"), { recursive: true });
    await writeFile(join(this.rootDir, "captures", `${safeName(record.captureId)}.json`), JSON.stringify(record, null, 2));
  }

  async readCapture(captureId: string): Promise<CaptureRecord> {
    const path = join(this.rootDir, "captures", `${safeName(captureId)}.json`);
    if (!existsSync(path)) throw new Error(`CAPTURE_NOT_FOUND:${captureId}`);
    return JSON.parse(await readFile(path, "utf8")) as CaptureRecord;
  }

  async listCaptures(): Promise<CaptureRecord[]> {
    const dir = join(this.rootDir, "captures");
    if (!existsSync(dir)) return [];
    const records: CaptureRecord[] = [];
    for (const name of await readdir(dir)) if (name.endsWith(".json")) records.push(JSON.parse(await readFile(join(dir, name), "utf8")) as CaptureRecord);
    return records.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  }

  // ---- runs ----------------------------------------------------------------

  runDir(runId: string): string {
    return join(this.rootDir, "runs", safeName(runId));
  }

  async readRun(runId: string): Promise<RunState> {
    const path = join(this.runDir(runId), "state.json");
    if (!existsSync(path)) {
      const now = new Date().toISOString();
      return { runId, createdAt: now, updatedAt: now };
    }
    return JSON.parse(await readFile(path, "utf8")) as RunState;
  }

  async writeRun(state: RunState): Promise<void> {
    await mkdir(this.runDir(state.runId), { recursive: true });
    state.updatedAt = new Date().toISOString();
    await writeFile(join(this.runDir(state.runId), "state.json"), JSON.stringify(state, null, 2));
  }

  async appendStep(step: Omit<StepReceipt, "sequence">): Promise<StepReceipt> {
    const dir = join(this.runDir(step.runId), "steps");
    await mkdir(dir, { recursive: true });
    const existing = (await readdir(dir)).filter((name) => name.endsWith(".json")).length;
    const receipt: StepReceipt = { ...step, sequence: existing + 1 };
    const name = `${String(receipt.sequence).padStart(3, "0")}-${safeName(step.operation)}.json`;
    await writeFile(join(dir, name), JSON.stringify(receipt, null, 2));
    await writeFile(join(this.runDir(step.runId), "steps.jsonl"), `${JSON.stringify(receipt)}\n`, { flag: "a" });
    return receipt;
  }

  async listSteps(runId: string): Promise<StepReceipt[]> {
    const path = join(this.runDir(runId), "steps.jsonl");
    if (!existsSync(path)) return [];
    return (await readFile(path, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line) as StepReceipt);
  }
}

export interface CaptureRecord {
  readonly captureId: string;
  readonly sourceId: string;
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly title?: string;
  readonly capturedAt: string;
  readonly captureMethod: string;
  readonly captureMethodVersion: string;
  readonly contentArtifact: VerificationArtifactHandle;
  /** Original bytes when the text representation was derived from a binary document (pdf, docx, …) or raw html. */
  readonly originalArtifact?: VerificationArtifactHandle;
  readonly characters: number;
  readonly sourceKind: "web_page" | "pdf" | "api" | "repository" | "other";
  readonly logicalIdentity: string;
}

/** JSON round-trip drops `undefined` members, which RFC 8785 canonicalization refuses to encode. */
export function stripUndefined<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 180);
}
