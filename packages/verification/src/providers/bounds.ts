import {
  canonicalizeJson,
  digestCanonicalJson,
} from "../deterministic/index.js";
import {
  admitExtractionSchema,
  validateExtractionCandidate,
  type AdmittedExtractionSchema,
} from "../extraction/index.js";

export type JsonObject = Readonly<Record<string, unknown>>;
export type JsonSchema = Readonly<Record<string, unknown>>;
export interface ProviderArtifactSink {
  assertExternalProcessingAdmission(input: {
    readonly providerId: string;
    readonly modality: "text" | "image" | "audio";
  }): Promise<void>;
  persistBeforeDispatch(input: {
    readonly requestDigest: `sha256:${string}`;
    readonly requestBytes: Uint8Array;
  }): Promise<void>;
  /** A missing precontext means the response had no admitted provider precontext. */
  persistAfterResponse(input: {
    readonly requestDigest: `sha256:${string}`;
    readonly rawResponseBytes: Uint8Array;
    readonly precontextBytes?: Uint8Array;
    /** Actual HTTP status when an adapter observed an HTTP response. */ readonly httpStatus?: number;
  }): Promise<void>;
}

const encoder = new TextEncoder();

export class ProviderFailure extends Error {
  constructor(
    readonly code:
      | "PROVIDER_CANCELLED"
      | "PROVIDER_DEADLINE_EXCEEDED"
      | "PROVIDER_NETWORK_FAILURE"
      | "PROVIDER_HTTP_FAILURE"
      | "PROVIDER_RESPONSE_TOO_LARGE"
      | "PROVIDER_RESPONSE_INVALID"
      | "PROVIDER_RESPONSE_SCHEMA_INVALID"
      | "PROVIDER_CONFIGURATION_INVALID"
      | "PROVIDER_UNSUPPORTED_TASK"
      | "PROVIDER_INPUT_POLICY_REJECTED"
      | "PROVIDER_ARTIFACT_PERSISTENCE_FAILURE",
    readonly retryable: boolean,
  ) {
    super(code);
  }
}

export function providerDigest(value: unknown): `sha256:${string}` {
  return digestCanonicalJson(value);
}

export function boundedJsonBytes(
  value: unknown,
  maximumBytes: number,
): Uint8Array {
  preflightJson(value, {
    maximumNodes: 2_048,
    maximumDepth: 16,
    maximumCollection: 512,
    maximumStringBytes: maximumBytes,
  });
  const bytes = encoder.encode(canonicalizeJson(value));
  if (bytes.byteLength > maximumBytes)
    throw new ProviderFailure("PROVIDER_INPUT_POLICY_REJECTED", false);
  return bytes;
}

export function preflightJson(
  value: unknown,
  limits: {
    readonly maximumNodes: number;
    readonly maximumDepth: number;
    readonly maximumCollection: number;
    readonly maximumStringBytes: number;
  },
): void {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  const seen = new Set<object>();
  let nodes = 0;
  let strings = 0;
  while (stack.length) {
    const current = stack.pop()!;
    nodes += 1;
    if (nodes > limits.maximumNodes || current.depth > limits.maximumDepth)
      throw new ProviderFailure("PROVIDER_RESPONSE_INVALID", false);
    if (typeof current.value === "string") {
      strings += encoder.encode(current.value).byteLength;
      if (strings > limits.maximumStringBytes)
        throw new ProviderFailure("PROVIDER_RESPONSE_TOO_LARGE", false);
      continue;
    }
    if (current.value === null || typeof current.value === "boolean") continue;
    if (typeof current.value === "number") {
      if (!Number.isFinite(current.value))
        throw new ProviderFailure("PROVIDER_RESPONSE_INVALID", false);
      continue;
    }
    if (typeof current.value !== "object" || seen.has(current.value))
      throw new ProviderFailure("PROVIDER_RESPONSE_INVALID", false);
    seen.add(current.value);
    if (Array.isArray(current.value)) {
      if (current.value.length > limits.maximumCollection)
        throw new ProviderFailure("PROVIDER_RESPONSE_INVALID", false);
      for (const child of current.value)
        stack.push({ value: child, depth: current.depth + 1 });
    } else {
      const entries = Object.entries(current.value);
      if (entries.length > limits.maximumCollection)
        throw new ProviderFailure("PROVIDER_RESPONSE_INVALID", false);
      for (const [key, child] of entries) {
        strings += encoder.encode(key).byteLength;
        if (strings > limits.maximumStringBytes)
          throw new ProviderFailure("PROVIDER_RESPONSE_TOO_LARGE", false);
        stack.push({ value: child, depth: current.depth + 1 });
      }
    }
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

/** Reuses the reviewed extraction schema gate; provider adapters never maintain a second grammar. */
export function admitOutputSchema(
  schema: unknown,
  schemaId = "provider_output",
  schemaVersion = "v1",
): AdmittedExtractionSchema {
  preflightJson(schema, {
    maximumNodes: 2_048,
    maximumDepth: 16,
    maximumCollection: 512,
    maximumStringBytes: 65_536,
  });
  const admission = admitExtractionSchema({
    schemaId,
    schemaVersion,
    schema,
    limits: {
      maxSchemaBytes: 32_768,
      maxDepth: 8,
      maxProperties: 128,
      maxEnumValues: 64,
      maxCandidateBytes: 64_000,
    },
  });
  if (!admission.admitted || !admission.schema)
    throw new ProviderFailure("PROVIDER_CONFIGURATION_INVALID", false);
  return admission.schema;
}

export function validateOutputAgainstSchema(
  schema: AdmittedExtractionSchema,
  value: unknown,
): void {
  const result = validateExtractionCandidate(schema, value);
  if (!result.valid)
    throw new ProviderFailure("PROVIDER_RESPONSE_SCHEMA_INVALID", false);
}

export async function boundedResponseBytes(
  response: Response,
  maximumBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (!response.body)
    throw new ProviderFailure("PROVIDER_RESPONSE_INVALID", false);
  const reader = response.body.getReader();
  const pieces: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > maximumBytes) {
        await reader.cancel();
        throw new ProviderFailure("PROVIDER_RESPONSE_TOO_LARGE", false);
      }
      pieces.push(part.value);
    }
  } catch (error) {
    if (signal?.aborted)
      throw new ProviderFailure("PROVIDER_DEADLINE_EXCEEDED", false);
    if (error instanceof ProviderFailure) throw error;
    throw new ProviderFailure("PROVIDER_NETWORK_FAILURE", true);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const piece of pieces) {
    bytes.set(piece, offset);
    offset += piece.byteLength;
  }
  return bytes;
}

export function parseBoundedResponseJson(
  bytes: Uint8Array,
  maximumBytes: number,
): unknown {
  try {
    const value: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    preflightJson(value, {
      maximumNodes: 4_096,
      maximumDepth: 20,
      maximumCollection: 512,
      maximumStringBytes: maximumBytes,
    });
    return value;
  } catch (error) {
    if (error instanceof ProviderFailure) throw error;
    throw new ProviderFailure("PROVIDER_RESPONSE_INVALID", false);
  }
}

export async function boundedResponseJson(
  response: Response,
  maximumBytes: number,
): Promise<{ readonly value: unknown; readonly bytes: Uint8Array }> {
  const bytes = await boundedResponseBytes(response, maximumBytes);
  return Object.freeze({
    value: parseBoundedResponseJson(bytes, maximumBytes),
    bytes,
  });
}

export function requestSignal(execution: {
  readonly signal?: AbortSignal;
  readonly deadlineEpochMs?: number;
}): { readonly signal: AbortSignal; readonly release: () => void } {
  if (execution.signal?.aborted)
    throw new ProviderFailure("PROVIDER_CANCELLED", false);
  const remaining =
    execution.deadlineEpochMs === undefined
      ? 60_000
      : execution.deadlineEpochMs - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0)
    throw new ProviderFailure("PROVIDER_DEADLINE_EXCEEDED", false);
  const timeout = AbortSignal.timeout(Math.min(remaining, 60_000));
  const signal = execution.signal
    ? AbortSignal.any([execution.signal, timeout])
    : timeout;
  return { signal, release: () => undefined };
}

export function requireActive(
  signal: AbortSignal,
  execution: { readonly signal?: AbortSignal },
): void {
  if (!signal.aborted) return;
  throw new ProviderFailure(
    execution.signal?.aborted
      ? "PROVIDER_CANCELLED"
      : "PROVIDER_DEADLINE_EXCEEDED",
    false,
  );
}
