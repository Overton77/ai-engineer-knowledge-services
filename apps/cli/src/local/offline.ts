import { readFile, writeFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import {
  createLocalHost,
  HostCapabilityNotAdmittedError,
  type LocalIdentity,
  type LocalOperation,
  type LocalProviders,
} from "@aiengineer/knowledge-host/local";
// Unit 5C decision: until 5D3 folds the intent pipeline into application use cases, `ks` reaches the executor's
// file-backed services only through this one transitional package export (the 5B seam). 5D3 removes both.
import { executorLocalVerification } from "@aiengineer/knowledge-verification-executor/local-verification";
import { EXIT, KsUsageError, type KsIo } from "../io.js";

type Flags = Readonly<Record<string, string | true>>;
type Host = Awaited<ReturnType<typeof openLocalHost>>;

/** Local-profile configuration: flag first, then its KNOWLEDGE_LOCAL_* variable. No VERIFY_* name is read. */
const STORE = { flag: "store", env: "KNOWLEDGE_LOCAL_STORE_DIR", fallback: ".knowledge-store" } as const;
const PROVIDERS = { flag: "providers", env: "KNOWLEDGE_LOCAL_PROVIDERS" } as const;
const IDENTITY = {
  tenantId: { flag: "tenant-id", env: "KNOWLEDGE_LOCAL_TENANT_ID" },
  producerDeploymentId: { flag: "producer-deployment-id", env: "KNOWLEDGE_LOCAL_PRODUCER_DEPLOYMENT_ID" },
  verifierDeploymentId: { flag: "verifier-deployment-id", env: "KNOWLEDGE_LOCAL_VERIFIER_DEPLOYMENT_ID" },
  producerAttemptId: { flag: "producer-attempt-id", env: "KNOWLEDGE_LOCAL_PRODUCER_ATTEMPT_ID" },
  verifierAttemptId: { flag: "verifier-attempt-id", env: "KNOWLEDGE_LOCAL_VERIFIER_ATTEMPT_ID" },
  principalSalt: { flag: "principal-salt", env: "KNOWLEDGE_LOCAL_PRINCIPAL_SALT" },
  gitSha: { flag: "git-sha", env: "KNOWLEDGE_LOCAL_GIT_SHA" },
} as const satisfies Record<keyof LocalIdentity, { readonly flag: string; readonly env: string }>;
/** Provider credentials come only from the environment (never argv), and only for providers named in --providers. */
const PROVIDER_SECRETS = {
  firecrawlApiKey: "KNOWLEDGE_LOCAL_FIRECRAWL_API_KEY",
  aiGatewayApiKey: "KNOWLEDGE_LOCAL_AI_GATEWAY_API_KEY",
  judgeModel: "KNOWLEDGE_LOCAL_JUDGE_MODEL",
  crossFamilyJudgeModel: "KNOWLEDGE_LOCAL_CROSS_FAMILY_JUDGE_MODEL",
} as const;
export const LOCAL_PROFILE_FLAGS: readonly string[] = [
  STORE.flag,
  PROVIDERS.flag,
  ...Object.values(IDENTITY).map((item) => item.flag),
];

const text = (value: string | true | undefined) =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
const setting = (flags: Flags, env: KsIo["env"], flag: string, name: string) => text(flags[flag]) ?? text(env[name]);

/** The explicit `providers` and `identity` for host's local profile, from flags and KNOWLEDGE_LOCAL_* variables. */
export function localProfileOptions(flags: Flags, env: KsIo["env"]) {
  const identity: Record<string, string> = {};
  for (const [key, { flag, env: name }] of Object.entries(IDENTITY)) {
    const value = setting(flags, env, flag, name);
    if (value !== undefined) identity[key] = value;
  }
  const named = (setting(flags, env, PROVIDERS.flag, PROVIDERS.env) ?? "none")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const unknown = named.filter((item) => !["capture", "semantic", "none"].includes(item));
  if (unknown.length > 0)
    throw new KsUsageError(`unknown provider ${unknown.join(", ")} (use capture, semantic or none)`);
  if (named.includes("none") && named.length > 1)
    throw new KsUsageError("--providers none cannot be combined with a provider");
  const providers: { capture?: LocalProviders["capture"]; semantic?: LocalProviders["semantic"] } = {};
  if (named.includes("capture")) {
    const firecrawlApiKey = text(env[PROVIDER_SECRETS.firecrawlApiKey]);
    providers.capture = firecrawlApiKey ? { firecrawlApiKey } : {};
  }
  if (named.includes("semantic")) {
    const aiGatewayApiKey = text(env[PROVIDER_SECRETS.aiGatewayApiKey]);
    if (!aiGatewayApiKey) throw new KsUsageError(`--providers semantic requires ${PROVIDER_SECRETS.aiGatewayApiKey}`);
    const judgeModel = text(env[PROVIDER_SECRETS.judgeModel]),
      crossFamilyJudgeModel = text(env[PROVIDER_SECRETS.crossFamilyJudgeModel]);
    providers.semantic = {
      aiGatewayApiKey,
      ...(judgeModel ? { judgeModel } : {}),
      ...(crossFamilyJudgeModel ? { crossFamilyJudgeModel } : {}),
    };
  }
  return {
    storeDir: setting(flags, env, STORE.flag, STORE.env) ?? STORE.fallback,
    identity: identity as LocalIdentity,
    providers: providers as LocalProviders,
  };
}

function openLocalHost(flags: Flags, env: KsIo["env"]) {
  return createLocalHost({
    profile: "local",
    ...localProfileOptions(flags, env),
    verification: executorLocalVerification,
  });
}

// ---- commands ------------------------------------------------------------------------------------------------

interface Parsed {
  readonly positionals: readonly string[];
  readonly flags: Flags;
}
/** Options that take no value; every other option requires one. */
const SWITCHES: readonly string[] = ["human"];
function parse(argv: readonly string[], allowed: readonly string[]): Parsed {
  const positionals: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]!;
    if (!item.startsWith("--")) {
      positionals.push(item);
      continue;
    }
    const key = item.slice(2);
    if (!allowed.includes(key)) throw new KsUsageError(`unknown option --${key}`);
    if (Object.hasOwn(flags, key)) throw new KsUsageError(`duplicate option --${key}`);
    if (SWITCHES.includes(key)) {
      flags[key] = true;
      continue;
    }
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--") || next.trim() === "")
      throw new KsUsageError(`--${key} requires a value`);
    flags[key] = next;
    index += 1;
  }
  return { positionals, flags };
}

const need = (value: string | undefined, name: string): string => {
  if (!value) throw new KsUsageError(`${name} is required`);
  return value;
};
const number = (flags: Flags, name: string): number | undefined => {
  const value = text(flags[name]);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new KsUsageError(`--${name} must be a non-negative integer`);
  return parsed;
};
const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, "utf8"));
const runOf = (flags: Flags) => (text(flags.run) ? { runId: text(flags.run)! } : {});
function artifactMediaType(path: string, override: string | undefined): string {
  if (override) return override;
  const extension = extname(path).toLowerCase();
  return extension === ".json"
    ? "application/json"
    : extension === ".md"
      ? "text/markdown; charset=utf-8"
      : extension === ".txt"
        ? "text/plain; charset=utf-8"
        : "application/octet-stream";
}

const ADMITTED_VERDICTS = new Set(["directly_supported", "supported_with_qualification"]);
type Output = Record<string, unknown>;

interface LocalCommand {
  readonly flags: readonly string[];
  readonly run: (host: Host, input: Parsed) => Promise<unknown>;
  /** A reason when the command succeeded but its quality gate did not pass (exit 1). */
  readonly gate?: (output: Output) => string | undefined;
}

const LOCAL_COMMANDS: Readonly<Record<LocalOperation, LocalCommand>> = {
  verify_supported_media_types: { flags: [], run: (host) => host.verify.supportedMediaTypes() },
  verify_capture_source: {
    flags: ["run", "capture-id", "method"],
    run: (host, { positionals: [url], flags }) =>
      host.verify.captureSource({
        url: need(url, "url"),
        ...runOf(flags),
        ...(text(flags["capture-id"]) ? { captureId: text(flags["capture-id"])! } : {}),
        ...(text(flags.method) ? { method: text(flags.method) as never } : {}),
      }),
  },
  verify_capture_file: {
    flags: ["run", "capture-id", "source-uri", "media-type"],
    run: async (host, { positionals: [path], flags }) => {
      const file = need(path, "file path");
      return host.verify.captureFile({
        bytes: new Uint8Array(await readFile(file)),
        filename: basename(file),
        ...runOf(flags),
        ...(text(flags["media-type"]) ? { mediaType: text(flags["media-type"])! } : {}),
        ...(text(flags["source-uri"]) ? { sourceUri: text(flags["source-uri"])! } : {}),
        ...(text(flags["capture-id"]) ? { captureId: text(flags["capture-id"])! } : {}),
      });
    },
  },
  verify_list_captures: { flags: [], run: (host) => host.verify.listCaptures() },
  verify_read_capture: {
    flags: ["run", "offset", "length"],
    run: (host, { positionals: [captureId], flags }) =>
      host.verify.readCapture({
        captureId: need(captureId, "captureId"),
        ...runOf(flags),
        ...(number(flags, "offset") !== undefined ? { offset: number(flags, "offset")! } : {}),
        ...(number(flags, "length") !== undefined ? { length: number(flags, "length")! } : {}),
      }),
  },
  verify_search_capture: {
    flags: ["run", "limit"],
    run: (host, { positionals: [captureId, ...query], flags }) =>
      host.verify.searchCapture({
        captureId: need(captureId, "captureId"),
        query: need(query.join(" "), "query"),
        ...runOf(flags),
        ...(number(flags, "limit") !== undefined ? { limit: number(flags, "limit")! } : {}),
      }),
  },
  verify_locate_quote: {
    flags: ["run"],
    run: (host, { positionals: [captureId, ...quote], flags }) =>
      host.verify.locateQuote({
        captureId: need(captureId, "captureId"),
        quote: need(quote.join(" "), "quote"),
        ...runOf(flags),
      }),
    gate: (output) =>
      output.status === "resolved"
        ? undefined
        : `locate status=${String(output.status)} occurrenceCount=${String(output.occurrenceCount)}`,
  },
  verify_register_artifact: {
    flags: ["run", "label", "media-type"],
    run: async (host, { positionals: [path], flags }) => {
      const file = need(path, "file");
      return host.verify.registerArtifact({
        bytes: new Uint8Array(await readFile(file)),
        mediaType: artifactMediaType(file, text(flags["media-type"])),
        ...runOf(flags),
        ...(text(flags.label) ? { label: text(flags.label)! } : {}),
      });
    },
  },
  verify_get_artifact: {
    flags: ["as"],
    run: (host, { positionals: [id], flags }) => {
      const reference = need(id, "artifactId");
      const as = text(flags.as);
      if (as !== undefined && !["text", "json", "handle"].includes(as))
        throw new KsUsageError("--as must be text, json or handle");
      return host.verify.artifact({
        ...(reference.startsWith("sha256:") ? { digest: reference } : { artifactId: reference }),
        ...(as ? { as: as as "text" } : {}),
      });
    },
  },
  verify_claims: {
    flags: ["run"],
    run: async (host, { positionals: [path], flags }) =>
      host.verify.verifyClaims({
        runId: need(text(flags.run), "--run"),
        intent: (await readJson(need(path, "intent file"))) as never,
      }),
    gate: (output) => (output.status === "passed" ? undefined : `mechanical status=${String(output.status)}`),
  },
  verify_extraction: {
    flags: ["run"],
    run: async (host, { positionals: [path], flags }) =>
      host.verify.verifyExtraction({ ...runOf(flags), intent: (await readJson(need(path, "intent file"))) as never }),
    gate: (output) =>
      output.valid === true
        ? undefined
        : `extraction valid=${String(output.valid)} failedPaths=${JSON.stringify(output.failedPaths ?? [])}`,
  },
  verify_judge_semantics: {
    flags: ["run", "model", "cross-family", "assertions"],
    run: (host, { flags }) =>
      host.verify.judgeSemantics({
        runId: need(text(flags.run), "--run"),
        ...(text(flags.model) ? { model: text(flags.model)! } : {}),
        ...(text(flags["cross-family"]) ? { crossFamilyModel: text(flags["cross-family"])! } : {}),
        ...(text(flags.assertions)
          ? {
              assertionIds: text(flags.assertions)!
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean),
            }
          : {}),
      }),
    gate: (output) => {
      const assessed = Array.isArray(output.assessed)
        ? (output.assessed as { assertionId: string; verdict: string }[])
        : [];
      const rejected = assessed.filter((item) => !ADMITTED_VERDICTS.has(item.verdict));
      return rejected.length === 0
        ? undefined
        : `judge rejected ${rejected.length}/${assessed.length}: ${rejected.map((item) => `${item.assertionId}=${item.verdict}`).join(", ")}`;
    },
  },
  verify_evaluate_policy: {
    flags: ["run", "policy"],
    run: async (host, { flags }) =>
      host.verify.evaluatePolicy({
        runId: need(text(flags.run), "--run"),
        ...(text(flags.policy) ? { policy: (await readJson(text(flags.policy)!)) as never } : {}),
      }),
    gate: (output) =>
      output.outcome === "pass" || output.outcome === "pass_with_warnings"
        ? undefined
        : `policy outcome=${String(output.outcome)} reasons=${JSON.stringify(output.reasonCodes ?? [])}`,
  },
  verify_seal_run: {
    flags: ["run"],
    run: (host, { flags }) => host.verify.sealRun({ runId: need(text(flags.run), "--run") }),
    gate: (output) =>
      (output.inspection as { valid?: boolean } | undefined)?.valid === true
        ? undefined
        : "audit bundle inspection invalid",
  },
  verify_check_report: {
    flags: ["run"],
    run: async (host, { positionals: [path], flags }) =>
      host.verify.checkReport({ ...runOf(flags), intent: (await readJson(need(path, "intent file"))) as never }),
    gate: (output) =>
      output.ok === true
        ? undefined
        : `report check ok=false problems=${JSON.stringify(output.problems ?? [])} citationsOnFailedClaims=${JSON.stringify(output.citationsOnFailedClaims ?? [])}`,
  },
  verify_run_status: {
    flags: ["run"],
    run: (host, { flags }) => host.verify.runStatus({ runId: need(text(flags.run), "--run") }),
  },
};

/** A compact view of large output, printed when --out writes the full document to a file. */
function summarize(output: unknown): unknown {
  if (!output || typeof output !== "object" || Array.isArray(output)) return output;
  const summary: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(output as Record<string, unknown>)) {
    if (value === null || ["string", "number", "boolean"].includes(typeof value))
      summary[key] =
        typeof value === "string" && value.length > 200 ? `${value.slice(0, 200)}… (${value.length} chars)` : value;
    else if (Array.isArray(value)) summary[key] = `[${value.length} items]`;
    else if (typeof value === "object" && "artifactId" in (value as object)) summary[key] = value;
    else summary[key] = "{…}";
  }
  return summary;
}

/** Runs one local-profile command. Exit 0 on success, 1 when its quality gate fails, 2 otherwise. */
export async function runLocalCommand(
  name: string,
  operation: LocalOperation,
  argv: readonly string[],
  io: KsIo,
): Promise<number> {
  const command = LOCAL_COMMANDS[operation];
  const input = parse(argv, [...command.flags, ...LOCAL_PROFILE_FLAGS, "out", "human"]);
  const host = await openLocalHost(input.flags, io.env);
  try {
    const output = await command.run(host, input);
    const out = text(input.flags.out);
    const pretty = input.flags.human === true;
    if (out) {
      await writeFile(out, `${JSON.stringify(output, null, 2)}\n`, "utf8");
      io.stdout(
        `${JSON.stringify({ ...(summarize(output) as object), writtenTo: out }, null, pretty ? 2 : undefined)}\n`,
      );
    } else io.stdout(`${JSON.stringify(output, null, pretty ? 2 : undefined)}\n`);
    const reason = command.gate?.((output ?? {}) as Output);
    if (!reason) return EXIT.ok;
    io.stderr(`${JSON.stringify({ code: "QUALITY_GATE_FAILED", command: name, reason })}\n`);
    return EXIT.gateFailed;
  } catch (error) {
    if (error instanceof HostCapabilityNotAdmittedError) {
      io.stderr(
        `${JSON.stringify({ code: error.code, command: name, profile: error.profile, operation: error.operation, requirement: error.requirement })}\n`,
      );
      return EXIT.error;
    }
    throw error;
  } finally {
    await host.close();
  }
}
