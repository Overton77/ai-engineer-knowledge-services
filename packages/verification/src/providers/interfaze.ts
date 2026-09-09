import {
  admitOutputSchema,
  boundedJsonBytes,
  boundedResponseBytes,
  parseBoundedResponseJson,
  type JsonObject,
  type ProviderArtifactSink,
  ProviderFailure,
  providerDigest,
  requestSignal,
  requireActive,
  validateOutputAgainstSchema,
} from "./bounds.js";
import type { AdmittedExtractionSchema } from "../extraction/index.js";
import { createHash } from "node:crypto";

export const INTERFAZE_ENDPOINT =
  "https://api.interfaze.ai/v1/chat/completions";
export const INTERFAZE_MODEL = "interfaze-beta";
export type InterfazeTask =
  | "ocr"
  | "object_detection"
  | "scraper"
  | "speech_to_text"
  | "translate";
const taskNames = new Set<InterfazeTask>([
  "ocr",
  "object_detection",
  "scraper",
  "speech_to_text",
  "translate",
]);
const precontextAliases: Readonly<Record<InterfazeTask, readonly string[]>> =
  Object.freeze({
    ocr: ["ocr"],
    object_detection: ["object_detection"],
    scraper: ["scraper", "ai_scraper"],
    speech_to_text: ["speech_to_text", "stt"],
    translate: ["translate"],
  });
const boundedExtractionPrecontextNames = Object.freeze([
  ...new Set(Object.values(precontextAliases).flat()),
]);

export interface InterfazeCallRecord {
  readonly requestDigest: `sha256:${string}`;
  readonly rawResponseDigest: `sha256:${string}`;
  readonly precontextDigest: `sha256:${string}`;
  readonly providerResponseId?: string;
  readonly observedModel?: string;
  readonly latencyMs: number;
  readonly usage: {
    readonly promptTokens?: number;
    readonly completionTokens?: number;
    readonly totalTokens?: number;
    readonly costMicros?: number;
  };
  readonly vcache: boolean;
}
export interface InterfazeExtractionResult {
  readonly output: JsonObject;
  readonly precontext: readonly {
    readonly name: string;
    readonly resultDigest: `sha256:${string}`;
  }[];
  readonly call: InterfazeCallRecord;
}
type Completion = {
  readonly id?: unknown;
  readonly model?: unknown;
  readonly choices?: unknown;
  readonly precontext?: unknown;
  readonly usage?: unknown;
  readonly vcache?: unknown;
};

function usage(value: unknown): InterfazeCallRecord["usage"] {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return {};
  const input = value as Record<string, unknown>;
  const whole = (name: string): number | undefined =>
    Number.isSafeInteger(input[name]) && (input[name] as number) >= 0
      ? (input[name] as number)
      : undefined;
  const dollars =
    typeof input.cost === "number" &&
    Number.isFinite(input.cost) &&
    input.cost >= 0
      ? Math.ceil(input.cost * 1_000_000)
      : undefined;
  const promptTokens = whole("prompt_tokens"),
    completionTokens = whole("completion_tokens"),
    totalTokens = whole("total_tokens");
  return {
    ...(promptTokens === undefined ? {} : { promptTokens }),
    ...(completionTokens === undefined ? {} : { completionTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
    ...(dollars === undefined ? {} : { costMicros: dollars }),
  };
}
function completionPayload(value: unknown): Completion {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new ProviderFailure("PROVIDER_RESPONSE_INVALID", false);
  return value as Completion;
}
function messageContent(payload: Completion): string {
  const choices = payload.choices;
  if (
    !Array.isArray(choices) ||
    choices.length !== 1 ||
    choices[0] === null ||
    typeof choices[0] !== "object"
  )
    throw new ProviderFailure("PROVIDER_RESPONSE_INVALID", false);
  const message = (choices[0] as { message?: unknown }).message;
  if (
    message === null ||
    typeof message !== "object" ||
    Array.isArray(message) ||
    typeof (message as { content?: unknown }).content !== "string"
  )
    throw new ProviderFailure("PROVIDER_RESPONSE_INVALID", false);
  return (message as { content: string }).content;
}
function precontext(
  value: unknown,
  allowedNames: readonly string[],
): readonly { readonly name: string; readonly result: unknown }[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 32)
    throw new ProviderFailure("PROVIDER_RESPONSE_INVALID", false);
  return Object.freeze(
    value.map((entry) => {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry))
        throw new ProviderFailure("PROVIDER_RESPONSE_INVALID", false);
      const item = entry as { name?: unknown; result?: unknown };
      if (
        typeof item.name !== "string" ||
        item.name.length > 64 ||
        !allowedNames.includes(item.name) ||
        !Object.hasOwn(item, "result")
      )
        throw new ProviderFailure("PROVIDER_RESPONSE_INVALID", false);
      return Object.freeze({ name: item.name, result: item.result });
    }),
  );
}
function admittedDataUri(value: string, task?: InterfazeTask): boolean {
  const match =
    /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]*={0,2})$/u.exec(value);
  if (!match || match[2]!.length > 128_000) return false;
  const mediaType = match[1]!;
  const allowed =
    task === "ocr" || task === "object_detection"
      ? ["image/png", "image/jpeg"]
      : task === "speech_to_text"
        ? ["audio/wav", "audio/mpeg"]
        : task === "translate"
          ? ["text/plain"]
          : task === "scraper"
            ? ["text/plain"]
            : ["image/png", "image/jpeg", "text/plain"];
  return allowed.includes(mediaType);
}

export class InterfazeStructuredExtractionProvider {
  readonly #apiKey: string;
  readonly #fetch: typeof fetch;
  readonly #artifactSink: ProviderArtifactSink;
  constructor(config: {
    readonly apiKey: string;
    readonly artifactSink: ProviderArtifactSink;
    readonly fetch?: typeof fetch;
  }) {
    if (!config.apiKey || !config.artifactSink)
      throw new ProviderFailure("PROVIDER_CONFIGURATION_INVALID", false);
    this.#apiKey = config.apiKey;
    this.#fetch = config.fetch ?? fetch;
    this.#artifactSink = config.artifactSink;
  }
  async extract(input: {
    readonly prompt: string;
    readonly schemaName: string;
    readonly schema: unknown;
    readonly inputData?: {
      readonly filename: string;
      readonly dataUri: string;
    };
    readonly execution: {
      readonly signal?: AbortSignal;
      readonly deadlineEpochMs?: number;
    };
  }): Promise<InterfazeExtractionResult> {
    if (
      !input.prompt ||
      input.prompt.length > 24_000 ||
      !/^[A-Za-z][A-Za-z0-9_]{0,80}$/.test(input.schemaName) ||
      (input.inputData &&
        (!/^[A-Za-z0-9._-]{1,120}$/.test(input.inputData.filename) ||
          !admittedDataUri(input.inputData.dataUri)))
    )
      throw new ProviderFailure("PROVIDER_INPUT_POLICY_REJECTED", false);
    const schema = admitOutputSchema(input.schema, input.schemaName, "v1");
    const content = input.inputData
      ? [
          { type: "text", text: input.prompt },
          {
            type: "file",
            file: {
              filename: input.inputData.filename,
              file_data: input.inputData.dataUri,
            },
          },
        ]
      : input.prompt;
    const requestBody = {
      model: INTERFAZE_MODEL,
      temperature: 0,
      max_tokens: 900,
      messages: [{ role: "user", content }],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: input.schemaName,
          strict: true,
          schema: schema.canonicalSchema,
        },
      },
    };
    return this.#dispatch(
      requestBody,
      schema,
      input.execution,
      input.inputData?.dataUri.startsWith("data:image/") ? "image" : "text",
      boundedExtractionPrecontextNames,
    );
  }
  async runTask(input: {
    readonly task: InterfazeTask;
    readonly prompt: string;
    readonly inputData: { readonly filename: string; readonly dataUri: string };
    readonly execution: {
      readonly signal?: AbortSignal;
      readonly deadlineEpochMs?: number;
    };
  }): Promise<InterfazeExtractionResult> {
    if (
      !taskNames.has(input.task) ||
      !input.prompt ||
      input.prompt.length > 8_000 ||
      !/^[A-Za-z0-9._-]{1,120}$/.test(input.inputData.filename) ||
      !admittedDataUri(input.inputData.dataUri, input.task)
    )
      throw new ProviderFailure("PROVIDER_UNSUPPORTED_TASK", false);
    const requestBody = {
      model: INTERFAZE_MODEL,
      temperature: 0,
      max_tokens: 900,
      messages: [
        { role: "system", content: `<task>${input.task}</task>` },
        {
          role: "user",
          content: [
            { type: "text", text: input.prompt },
            {
              type: "file",
              file: {
                filename: input.inputData.filename,
                file_data: input.inputData.dataUri,
              },
            },
          ],
        },
      ],
      // Fixed tasks define their own output shape; other HTTP clients must
      // request an empty schema (Interfaze Run Tasks documentation).
      response_format: {
        type: "json_schema",
        json_schema: { name: "task_output", schema: {} },
      },
    };
    const modality =
      input.task === "ocr" || input.task === "object_detection"
        ? "image"
        : input.task === "speech_to_text"
          ? "audio"
          : "text";
    const result = await this.#dispatch(
      requestBody,
      undefined,
      input.execution,
      modality,
      precontextAliases[input.task],
    );
    if (
      typeof result.output.name !== "string" ||
      !precontextAliases[input.task].includes(result.output.name) ||
      !Object.hasOwn(result.output, "result") ||
      Object.keys(result.output).length !== 2 ||
      result.precontext.some(
        (entry) => !precontextAliases[input.task].includes(entry.name),
      )
    )
      throw new ProviderFailure("PROVIDER_RESPONSE_INVALID", false);
    return result;
  }
  async #dispatch(
    requestBody: JsonObject,
    schema: AdmittedExtractionSchema | undefined,
    execution: {
      readonly signal?: AbortSignal;
      readonly deadlineEpochMs?: number;
    },
    modality: "text" | "image" | "audio",
    allowedPrecontextNames: readonly string[],
  ): Promise<InterfazeExtractionResult> {
    const bytes = boundedJsonBytes(requestBody, 160_000);
    const requestDigest = providerDigest(requestBody);
    const active = requestSignal(execution);
    const started = Date.now();
    try {
      try {
        await this.#artifactSink.assertExternalProcessingAdmission({
          providerId: "interfaze",
          modality,
        });
        requireActive(active.signal, execution);
        await this.#artifactSink.persistBeforeDispatch({
          requestDigest,
          requestBytes: bytes,
        });
        requireActive(active.signal, execution);
      } catch (error) {
        throw error instanceof ProviderFailure
          ? error
          : new ProviderFailure("PROVIDER_ARTIFACT_PERSISTENCE_FAILURE", false);
      }
      const response = await this.#fetch(INTERFAZE_ENDPOINT, {
        method: "POST",
        redirect: "error",
        headers: {
          authorization: `Bearer ${this.#apiKey}`,
          "content-type": "application/json",
          "x-interfaze-zdr": "true",
        },
        body: bytes,
        signal: active.signal,
      });
      const responseBytes = await boundedResponseBytes(
        response,
        160_000,
        active.signal,
      );
      try {
        await this.#artifactSink.persistAfterResponse({
          requestDigest,
          rawResponseBytes: responseBytes,
          httpStatus: response.status,
        });
        requireActive(active.signal, execution);
      } catch (error) {
        throw error instanceof ProviderFailure
          ? error
          : new ProviderFailure("PROVIDER_ARTIFACT_PERSISTENCE_FAILURE", false);
      }
      if (!response.ok)
        throw new ProviderFailure(
          "PROVIDER_HTTP_FAILURE",
          response.status === 408 ||
            response.status === 429 ||
            response.status >= 500,
        );
      const raw = {
        bytes: responseBytes,
        value: parseBoundedResponseJson(responseBytes, 160_000),
      };
      const payload = completionPayload(raw.value);
      if (payload.model !== undefined && payload.model !== INTERFAZE_MODEL)
        throw new ProviderFailure("PROVIDER_RESPONSE_INVALID", false);
      const content = messageContent(payload);
      let output: unknown;
      try {
        output = JSON.parse(content);
      } catch {
        throw new ProviderFailure("PROVIDER_RESPONSE_INVALID", false);
      }
      if (schema) validateOutputAgainstSchema(schema, output);
      else if (
        output === null ||
        typeof output !== "object" ||
        Array.isArray(output)
      )
        throw new ProviderFailure("PROVIDER_RESPONSE_INVALID", false);
      const context = precontext(payload.precontext, allowedPrecontextNames);
      const contextBytes = boundedJsonBytes(context, 64_000);
      if (context.length) {
        try {
          await this.#artifactSink.persistAfterResponse({
            requestDigest,
            rawResponseBytes: raw.bytes,
            precontextBytes: contextBytes,
            httpStatus: response.status,
          });
          requireActive(active.signal, execution);
        } catch (error) {
          throw error instanceof ProviderFailure
            ? error
            : new ProviderFailure(
                "PROVIDER_ARTIFACT_PERSISTENCE_FAILURE",
                false,
              );
        }
      }
      return Object.freeze({
        output: output as JsonObject,
        precontext: context.map((entry) =>
          Object.freeze({
            name: entry.name,
            resultDigest: `sha256:${createHash("sha256")
              .update(
                entry.result === undefined
                  ? "undefined"
                  : JSON.stringify(entry.result),
              )
              .digest("hex")}` as `sha256:${string}`,
          }),
        ),
        call: Object.freeze({
          requestDigest,
          rawResponseDigest:
            `sha256:${createHash("sha256").update(raw.bytes).digest("hex")}` as `sha256:${string}`,
          precontextDigest: providerDigest(context),
          ...(typeof payload.id === "string" && payload.id.length <= 256
            ? { providerResponseId: payload.id }
            : {}),
          ...(typeof payload.model === "string" && payload.model.length <= 256
            ? { observedModel: payload.model }
            : {}),
          latencyMs: Date.now() - started,
          usage: usage(payload.usage),
          vcache: payload.vcache === true,
        }),
      });
    } catch (error) {
      if (active.signal.aborted)
        throw new ProviderFailure(
          execution.signal?.aborted
            ? "PROVIDER_CANCELLED"
            : "PROVIDER_DEADLINE_EXCEEDED",
          false,
        );
      if (error instanceof ProviderFailure) throw error;
      throw new ProviderFailure("PROVIDER_NETWORK_FAILURE", true);
    } finally {
      active.release();
    }
  }
}

export const interfazeConfigurationDigest = providerDigest({
  endpoint: INTERFAZE_ENDPOINT,
  model: INTERFAZE_MODEL,
  zdrHeader: true,
  allowedTasks: [...taskNames].sort(),
  precontextAliases,
});
