import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createHost,
  type LocalHostOptions,
  type LocalVerificationSeam,
  type LocalVerificationServices,
} from "../index.js";
import { localVerificationOperations, type LocalOperation } from "../local/capabilities.js";

// Every local operation, by the service method it calls, with a recorded call instead of an implementation.
function stubServices(calls: string[]) {
  const record =
    (method: string) =>
    async (...args: unknown[]) => {
      calls.push(method);
      return { method, args };
    };
  return Object.fromEntries(
    Object.values(localVerificationOperations).map(({ method }) => [method, record(method)]),
  ) as unknown as LocalVerificationServices;
}
const captureMediaKind = ({ filename }: { readonly filename: string }) =>
  filename.endsWith(".pdf") ? ("document" as const) : ("text" as const);

const operations = Object.keys(localVerificationOperations) as LocalOperation[];
const invoke = (
  host: Awaited<ReturnType<typeof createHost<LocalVerificationServices>>>,
  operation: LocalOperation,
  input: unknown = {},
) => (host.verify[localVerificationOperations[operation].method] as (value: unknown) => Promise<unknown>)(input);

let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("NETWORK_NOT_ALLOWED"));
});
afterEach(() => {
  fetchSpy.mockRestore();
  vi.unstubAllEnvs();
});

type Create = LocalVerificationSeam<LocalVerificationServices>["create"];
function local(
  { create, ...overrides }: Partial<LocalHostOptions> & { readonly create?: Create } = {},
  calls: string[] = [],
) {
  const factory = vi.fn<Create>(create ?? (() => stubServices(calls)));
  return {
    factory,
    options: {
      profile: "local" as const,
      storeDir: "local-store",
      verification: { captureMediaKind, create: factory },
      ...overrides,
    },
  };
}

describe("local host construction", () => {
  it("constructs nothing until the first operation, then constructs once for concurrent callers", async () => {
    const calls: string[] = [];
    const { factory, options } = local({}, calls);
    const host = await createHost(options);
    expect(factory).not.toHaveBeenCalled();
    await Promise.all([
      invoke(host, "verify_list_captures"),
      invoke(host, "verify_run_status", { runId: "r" }),
      invoke(host, "verify_claims"),
    ]);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(calls.sort()).toEqual(["listCaptures", "runStatus", "verifyClaims"]);
    await host.close();
  });

  it("hands the services an absolute store directory and only the explicitly configured providers", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "ambient-firecrawl");
    vi.stubEnv("AI_GATEWAY_API_KEY", "ambient-gateway");
    const { factory, options } = local({ identity: { tenantId: "tenant" } });
    const host = await createHost(options);
    await invoke(host, "verify_list_captures");
    const [config] = factory.mock.calls[0]!;
    expect(config.storeDir).toBe(host.storeDir);
    expect(config.storeDir).toMatch(/local-store$/u);
    expect(config.providers).toEqual({});
    expect(config.identity).toEqual({ tenantId: "tenant" });
    expect(host.capabilities).toEqual({
      onlineCapture: false,
      documentConversion: false,
      semanticJudging: false,
      database: false,
    });
    await host.close();
  });

  it("rejects incomplete configuration before constructing anything", async () => {
    await expect(createHost(local({ storeDir: " " }).options)).rejects.toThrow("HOST_LOCAL_STORE_DIR_REQUIRED");
    await expect(createHost(local({ verification: undefined as never }).options)).rejects.toThrow(
      "HOST_LOCAL_VERIFICATION_SERVICES_REQUIRED",
    );
    await expect(createHost(local({ providers: { semantic: { aiGatewayApiKey: "" } } }).options)).rejects.toThrow(
      "HOST_LOCAL_SEMANTIC_PROVIDER_KEY_REQUIRED",
    );
    await expect(createHost(local({ providers: { capture: { firecrawlApiKey: " " } } }).options)).rejects.toThrow(
      "HOST_LOCAL_CAPTURE_PROVIDER_KEY_INVALID",
    );
  });
});

describe("local host admission", () => {
  it("runs offline operations and fails provider operations with CAPABILITY_NOT_ADMITTED before constructing", async () => {
    const calls: string[] = [];
    const { factory, options } = local({}, calls);
    const host = await createHost(options);
    await expect(invoke(host, "verify_capture_source", { url: "https://example.test" })).rejects.toMatchObject({
      code: "CAPABILITY_NOT_ADMITTED",
      profile: "local",
      operation: "verify_capture_source",
      requirement: "capture-provider",
    });
    await expect(invoke(host, "verify_judge_semantics", { runId: "r" })).rejects.toMatchObject({
      code: "CAPABILITY_NOT_ADMITTED",
      operation: "verify_judge_semantics",
      requirement: "semantic-provider",
    });
    expect(factory).not.toHaveBeenCalled();
    for (const operation of operations)
      expect(host.admits(operation), operation).toBe(localVerificationOperations[operation].requires === "none");
    for (const operation of operations.filter((name) => localVerificationOperations[name].requires === "none"))
      await invoke(host, operation, { filename: "notes.md" });
    expect(calls).toHaveLength(14);
    expect(fetchSpy).not.toHaveBeenCalled();
    await host.close();
  });

  it("treats document conversion as a capture-provider call even though capture-file is offline", async () => {
    const calls: string[] = [];
    const { factory, options } = local({}, calls);
    const host = await createHost(options);
    await expect(invoke(host, "verify_capture_file", { filename: "paper.pdf" })).rejects.toMatchObject({
      code: "CAPABILITY_NOT_ADMITTED",
      operation: "verify_capture_file",
      requirement: "document-conversion",
    });
    expect(factory).not.toHaveBeenCalled();
    await invoke(host, "verify_capture_file", { filename: "paper.md" });
    expect(calls).toEqual(["captureFile"]);
    await host.close();

    const admitted: string[] = [];
    const configured = await createHost(
      local({ providers: { capture: { firecrawlApiKey: "explicit" } } }, admitted).options,
    );
    await invoke(configured, "verify_capture_file", { filename: "paper.pdf" });
    expect(admitted).toEqual(["captureFile"]);
    await configured.close();
  });

  it("admits online capture and semantic judging only with explicit provider configuration", async () => {
    const calls: string[] = [];
    const { factory, options } = local(
      { providers: { capture: {}, semantic: { aiGatewayApiKey: "explicit" } } },
      calls,
    );
    const host = await createHost(options);
    expect(host.capabilities).toEqual({
      onlineCapture: true,
      documentConversion: false,
      semanticJudging: true,
      database: false,
    });
    await invoke(host, "verify_capture_source", { url: "https://example.test" });
    await invoke(host, "verify_judge_semantics", { runId: "r" });
    expect(calls).toEqual(["captureSource", "judgeSemantics"]);
    expect(factory.mock.calls[0]![0].providers).toEqual({ capture: {}, semantic: { aiGatewayApiKey: "explicit" } });
    await host.close();
  });

  it("keeps database-backed and platform operations server-only", async () => {
    const host = await createHost(
      local({ providers: { capture: { firecrawlApiKey: "k" }, semantic: { aiGatewayApiKey: "k" } } }).options,
    );
    for (const operation of [
      "db_head",
      "schema_search",
      "ingest_apply",
      "source_import",
      "checkpoint_commit",
      "report_assess",
      "recovery_submit",
      "knowledge_get_verification_run",
    ])
      expect(host.admits(operation), operation).toBe(false);
    expect("dbHead" in host.verify).toBe(false);
    await host.close();
  });
});

describe("local host lifecycle", () => {
  it("closes idempotently, sharing one cleanup, and rejects operations afterwards", async () => {
    let releases = 0;
    const host = await createHost(
      local({
        create: (_config, resources) => {
          resources.own("store", undefined, () => void (releases += 1));
          return stubServices([]);
        },
      }).options,
    );
    await invoke(host, "verify_list_captures");
    const first = host.close();
    expect(host.close()).toBe(first);
    await Promise.all([first, host.close()]);
    expect(releases).toBe(1);
    await expect(invoke(host, "verify_list_captures")).rejects.toThrow("HOST_CLOSED:local");
  });

  it("closes an unstarted host without constructing it", async () => {
    const { factory, options } = local();
    const host = await createHost(options);
    await host.close();
    await expect(invoke(host, "verify_run_status")).rejects.toThrow("HOST_CLOSED:local");
    expect(factory).not.toHaveBeenCalled();
  });

  it("releases what a failed start acquired, surfaces the error and starts again on the next call", async () => {
    const released: string[] = [];
    let attempts = 0;
    const host = await createHost(
      local({
        create: (_config, resources) => {
          attempts += 1;
          resources.own(`store-${attempts}`, undefined, () => void released.push(`store-${attempts}`));
          if (attempts === 1) throw new Error("LOCAL_START_FAILED");
          return stubServices([]);
        },
      }).options,
    );
    await expect(invoke(host, "verify_list_captures")).rejects.toThrow("LOCAL_START_FAILED");
    expect(released).toEqual(["store-1"]);
    await invoke(host, "verify_list_captures");
    await host.close();
    expect(released).toEqual(["store-1", "store-2"]);
  });

  it("waits for an in-flight start, then releases it once", async () => {
    let finish!: () => void;
    const released: string[] = [];
    const host = await createHost(
      local({
        create: async (_config, resources) => {
          resources.own("store", undefined, () => void released.push("store"));
          await new Promise<void>((resolve) => (finish = resolve));
          return stubServices([]);
        },
      }).options,
    );
    const pending = invoke(host, "verify_list_captures");
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    const closing = host.close();
    finish();
    await expect(pending).rejects.toThrow("HOST_CLOSED:local");
    await closing;
    await host.close();
    expect(released).toEqual(["store"]);
  });

  it("waits for running operations before releasing", async () => {
    let finish!: () => void;
    const order: string[] = [];
    const host = await createHost(
      local({
        create: (_config, resources) => {
          resources.own("store", undefined, () => void order.push("released"));
          return {
            ...stubServices([]),
            sealRun: () => new Promise<void>((resolve) => (finish = resolve)).then(() => void order.push("sealed")),
          } as never;
        },
      }).options,
    );
    const sealing = invoke(host, "verify_seal_run", { runId: "r" });
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    const closing = host.close();
    await Promise.resolve();
    expect(order).toEqual([]);
    finish();
    await Promise.all([sealing, closing]);
    expect(order).toEqual(["sealed", "released"]);
  });

  it("surfaces release failures from close", async () => {
    const host = await createHost(
      local({
        create: (_config, resources) => {
          resources.own("store", undefined, () => Promise.reject(new Error("STORE_RELEASE_FAILED")));
          return stubServices([]);
        },
      }).options,
    );
    await invoke(host, "verify_list_captures");
    await expect(host.close()).rejects.toThrow("STORE_RELEASE_FAILED");
  });
});

describe("local profile entry", () => {
  it("composes the same local host as createHost and imports no server composition", async () => {
    const entry = await import("../local/index.js");
    const calls: string[] = [];
    const host = await entry.createLocalHost({
      profile: "local",
      storeDir: "never-created-store",
      verification: { captureMediaKind, create: () => stubServices(calls) },
    });
    await invoke(host, "verify_run_status");
    expect(calls).toEqual(["runStatus"]);
    await host.close();
    // `@aiengineer/knowledge-host/local` is what the ks CLI loads for offline commands: only the local modules and the
    // lifecycle resources, never the server roles, persistence or a database driver.
    const directory = join(import.meta.dirname, "../local");
    const specifiers = readdirSync(directory)
      .filter((name) => name.endsWith(".ts"))
      .flatMap((name) =>
        [...readFileSync(join(directory, name), "utf8").matchAll(/^(?:import|export)[^;]*?from\s+"([^"]+)"/gmu)].map(
          (match) => match[1]!,
        ),
      );
    expect(specifiers).toContain("../lifecycle/resources.js");
    expect(
      specifiers.filter(
        (specifier) =>
          !specifier.startsWith("./") && specifier !== "../lifecycle/resources.js" && !specifier.startsWith("node:"),
      ),
    ).toEqual([]);
  });
});
