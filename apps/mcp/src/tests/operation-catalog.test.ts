import { describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  operationStepsByKind,
  productionAdmittedOperationKinds,
  verificationOwnedOperationKinds,
} from "@aiengineer/knowledge-application";
import type { OperationKind } from "@aiengineer/knowledge-contracts";
import { createHost } from "@aiengineer/knowledge-host";
import { PostgresKnowledgeOperationService, type PostgresCanonicalRepository } from "@aiengineer/knowledge-persistence";
import { buildServer } from "../../../api/src/server.js";
import { CLI_COMMANDS, dispatchCliCommand, resolveCommand, type CliCommand } from "../../../cli/src/commands.js";
import { knowledgeOperations } from "../../../verification-executor/src/knowledge/operations.js";
import { createVerificationMcpServer } from "../../../verification-executor/src/mcp.js";
import { MCP_TOOL_CATALOG, VERIFICATION_MCP_TOOL_NAMES } from "../catalog.js";
import { createKnowledgeMcpServer, createMcpToolExecutor } from "../index.js";
import {
  declaredApiRequests,
  localProfileState,
  operationCatalog,
  transportState,
  type Binding,
} from "./operation-catalog.js";
import { CORRELATION, id, operationContext, owner, resolveIdentity, tenant, tokens } from "./parity-rows.js";
import { verificationMutationInventory } from "./verification-inventory.js";

type Transport = "api" | "mcp" | "cli";
const transports: readonly Transport[] = ["api", "mcp", "cli"];
const bound = (binding: Binding) => ("on" in binding ? binding.on : "failsClosed" in binding ? binding.failsClosed : []);

async function registeredApiRoutes() {
  const routes = new Set<string>();
  const server = buildServer({
    observeRoute(method, path) {
      const normalized = method.toUpperCase();
      if (normalized !== "HEAD" && normalized !== "OPTIONS") routes.add(`${normalized} ${path}`);
    },
  });
  await server.ready();
  await server.close();
  return routes;
}

async function toolNames(server: { connect(transport: InMemoryTransport): Promise<void>; close(): Promise<void> }) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "operation-catalog", version: "0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const names = new Set((await client.listTools()).tools.map((tool) => tool.name));
  await client.close();
  await server.close();
  return names;
}

const cliCommands = new Map<string, CliCommand>(
  Object.entries(CLI_COMMANDS).flatMap(([group, actions]) =>
    Object.entries(actions).map(([action, command]) => [`${group} ${action}`, command as CliCommand] as const)),
);

/** Server-profile admission computed from the production catalogs, for rows that submit a durable kind. */
const admissionOf = (kind: OperationKind) =>
  (productionAdmittedOperationKinds as readonly string[]).includes(kind) ? "admitted"
    : (verificationOwnedOperationKinds as readonly string[]).includes(kind) ? "gated" : "declared";

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, (character) => `\\${character}`);
/** Matches a Fastify route pattern (escaped `::`, `:param` and `:param(regex)`) against a concrete path. */
const routeMatches = (pattern: string, path: string) => {
  const source = pattern
    .split(/(::|:[A-Za-z]+(?:\([^)]*\))?)/u)
    .map((token) => {
      if (token === "::") return ":";
      const parameter = /^:[A-Za-z]+(?:\(\^?(.*?)\$?\))?$/u.exec(token);
      if (parameter) return parameter[1] === undefined ? "[^/]+" : `(?:${parameter[1]})`;
      return escapeRegExp(token);
    })
    .join("");
  return new RegExp(`^${source}$`, "u").test(path);
};

describe("operation catalog parity", async () => {
  const apiRoutes = await registeredApiRoutes();
  const mcpTools = await toolNames(createKnowledgeMcpServer({
    operationService: {} as never,
    apiOrigin: "https://knowledge.example",
    identity: { actor: owner, grants: [] },
  }));
  // Without knowledge services the executor MCP server registers only its verify_* tools.
  const executorVerifyTools = await toolNames(createVerificationMcpServer({} as never));
  const registered: Record<Transport, ReadonlySet<string>> = { api: apiRoutes, mcp: mcpTools, cli: new Set(cliCommands.keys()) };
  const platform = operationCatalog.filter((operation) => operation.admission !== "executor");

  it("lists each operation once with a reason for every exclusion", () => {
    const ids = operationCatalog.map((operation) => operation.id);
    expect(ids.filter((name, index) => ids.indexOf(name) !== index)).toEqual([]);
    for (const operation of operationCatalog)
      for (const transport of transports) {
        const binding = operation[transport];
        if ("excluded" in binding) expect(binding.excluded.trim().length, `${operation.id} ${transport}`).toBeGreaterThan(10);
        else expect(bound(binding).length, `${operation.id} ${transport}`).toBeGreaterThan(0);
      }
  });

  it("names what every gated operation requires", () => {
    for (const operation of platform)
      if (operation.admission === "gated") expect(operation.requires?.trim().length, operation.id).toBeGreaterThan(10);
      else if (operation.admission !== "admitted") expect(operation.requires, operation.id).toBeUndefined();
  });

  it("derives each operation's state per profile and transport", async () => {
    const states = (profile: "server" | "local", transport: Transport) =>
      operationCatalog.reduce<Record<string, number>>((counts, operation) => {
        const state = transportState(operation, profile, transport);
        return { ...counts, [state]: (counts[state] ?? 0) + 1 };
      }, {});
    for (const transport of transports) expect(states("local", transport)).toEqual({ "server only": 98, "executor only": 58 });
    expect(states("server", "api")).toEqual({ executable: 47, "executable when composed": 34, "declared (fails closed)": 9, excluded: 8, "executor only": 58 });
    expect(states("server", "mcp")).toEqual({ executable: 28, "executable when composed": 30, "declared (fails closed)": 8, excluded: 32, "executor only": 58 });
    expect(states("server", "cli")).toEqual({ executable: 31, "executable when composed": 30, "declared (fails closed)": 10, excluded: 27, "executor only": 58 });
  });

  it("reports each operation's local host state as the local host admits it", async () => {
    const counts = operationCatalog.reduce<Record<string, number>>((total, operation) => {
      const state = localProfileState(operation);
      return { ...total, [state]: (total[state] ?? 0) + 1 };
    }, {});
    expect(counts).toEqual({ "server only": 140, offline: 14, "capture provider": 1, "semantic provider": 1 });
    const verification = { captureMediaKind: () => "text" as const, create: (() => { throw new Error("NOT_CONSTRUCTED"); }) as never };
    const bare = await createHost({ profile: "local", storeDir: "never-created-store", verification });
    const configured = await createHost({ profile: "local", storeDir: "never-created-store", verification,
      providers: { capture: {}, semantic: { aiGatewayApiKey: "explicit" } } });
    for (const operation of operationCatalog) {
      const name = operation.executor?.mcp ?? operation.id;
      const state = localProfileState(operation);
      expect(bare.admits(name), operation.id).toBe(state === "offline");
      expect(configured.admits(name), operation.id).toBe(state !== "server only");
      if (state !== "server only") expect(operation.admission, operation.id).toBe("executor");
    }
    await Promise.all([bare.close(), configured.close()]);
  });

  it("covers every declared durable kind and derives its admission from the production catalogs", () => {
    for (const kind of Object.keys(operationStepsByKind) as OperationKind[]) {
      const rows = platform.filter((operation) => operation.kind === kind);
      expect(rows.length, kind).toBeGreaterThan(0);
      for (const row of rows) expect(row.admission, row.id).toBe(admissionOf(kind));
    }
  });

  it("binds only registered surfaces and leaves no registered surface unclassified", () => {
    for (const transport of transports) {
      const catalogued = new Set(platform.flatMap((operation) => bound(operation[transport])));
      for (const name of catalogued) expect(registered[transport].has(name), `${transport}: ${name}`).toBe(true);
      expect([...registered[transport]].filter((name) => !catalogued.has(name)), transport).toEqual([]);
    }
  });

  it("never makes a declared operation executable because of parity", () => {
    for (const operation of operationCatalog) {
      if (operation.admission === "declared")
        for (const transport of transports) expect("on" in operation[transport], `${operation.id} ${transport}`).toBe(false);
      else
        for (const transport of transports) expect("failsClosed" in operation[transport], `${operation.id} ${transport}`).toBe(false);
    }
  });

  it("agrees with the MCP catalog and CLI command table on each operation's kind", () => {
    for (const operation of platform.filter((row) => row.kind && row.effect === "mutation")) {
      for (const tool of bound(operation.mcp))
        if (tool in MCP_TOOL_CATALOG) expect(MCP_TOOL_CATALOG[tool as keyof typeof MCP_TOOL_CATALOG], `${operation.id} ${tool}`).toBe(operation.kind);
        else expect(VERIFICATION_MCP_TOOL_NAMES, `${operation.id} ${tool}`).toContain(tool);
      for (const name of bound(operation.cli)) {
        const command = cliCommands.get(name)!;
        if ("failsClosed" in operation.cli) expect(command.mode, name).toBe("unsupported");
        else if (command.mode === "submit") expect(command.kind, name).toBe(operation.kind);
        else if (command.mode === "retrieval") expect(operation.kind, name).toBe("retrieval_run");
        else expect(command.mode, name).toBe("verification_mutation");
      }
    }
    for (const operation of platform)
      if ("failsClosed" in operation.cli) for (const name of operation.cli.failsClosed) expect(cliCommands.get(name)?.mode, name).toBe("unsupported");
  });

  it("matches the verification mutation inventory used by the surface admission tests", () => {
    for (const entry of verificationMutationInventory) {
      const row = platform.find((operation) => operation.kind === entry.kind)!;
      expect(row, entry.kind).toBeDefined();
      expect(bound(row.mcp)).toContain(entry.tool);
      expect(bound(row.cli)).toContain(entry.cli.join(" "));
      expect(bound(row.api).some((route) => route.startsWith("POST ") && routeMatches(route.slice(5), entry.path)), entry.path).toBe(true);
      expect(cliCommands.get(entry.cli.join(" "))).toMatchObject({ mode: "verification_mutation", useCase: entry.useCase });
    }
    const decision = platform.find((operation) => operation.kind === "verification_adjudication_decision")!;
    expect(bound(decision.mcp)).toEqual(["knowledge_record_adjudication_decision"]);
    expect(cliCommands.get(bound(decision.cli)[0]!)).toMatchObject({ mode: "verification_mutation", useCase: "recordAdjudicationDecision" });
    // Decision recording is reviewer-bound with opt-in admission; api-mcp-parity.test.ts covers it
    // instead of the surface inventory.
    const inventoried = new Set<string>(verificationMutationInventory.map((entry) => entry.kind));
    expect(platform.filter((operation) => operation.group === "verify" && operation.kind && !inventoried.has(operation.kind))
      .map((operation) => operation.kind)).toEqual(["verification_adjudication_decision"]);
  });

  it("inventories the executor registry and tools for the Unit 5 fold", () => {
    const executorRows = operationCatalog.filter((operation) => operation.admission === "executor");
    const registry = knowledgeOperations.list().map((operation) => [operation.name, operation.cli.command.join(" ")]);
    expect(executorRows.filter((row) => row.executor?.cli).map((row) => [row.executor!.mcp, row.executor!.cli]).sort())
      .toEqual(registry.sort());
    expect(executorRows.filter((row) => !row.executor?.cli).map((row) => row.executor!.mcp).sort()).toEqual([...executorVerifyTools].sort());
    for (const row of executorRows) for (const transport of transports) expect("excluded" in row[transport], `${row.id} ${transport}`).toBe(true);
    for (const row of executorRows.filter((operation) => operation.id.startsWith("executor.ingest_")))
      expect("excluded" in row.api && row.api.excluded).toMatch(/receipt semantics/u);
  });

  describe("declared operations fail closed on every bound transport", () => {
    const declared = platform.filter((operation) => operation.admission === "declared");

    it.each(declared.filter((operation) => operation.kind && "failsClosed" in operation.api))(
      "$id API route answers CAPABILITY_NOT_ADMITTED before persistence", async (operation) => {
        const createOperation = vi.fn();
        const server = buildServer({
          resolveIdentity,
          operationService: new PostgresKnowledgeOperationService({ createOperation } as unknown as PostgresCanonicalRepository),
        });
        try {
          const url = declaredApiRequests[operation.kind!]!.replace("{id}", id(60));
          expect(bound(operation.api).some((route) => routeMatches(route.slice(5), url))).toBe(true);
          const response = await server.inject({
            method: "POST",
            url,
            headers: { authorization: `Bearer ${tokens.owner}`, "x-tenant-id": tenant, "x-correlation-id": CORRELATION },
            payload: { context: operationContext(tenant, owner), input: {}, expectedVersions: { api: "v1" } },
          });
          expect(response.statusCode, response.body).toBe(503);
          expect(response.json()).toMatchObject({ code: "CAPABILITY_NOT_ADMITTED" });
          expect(createOperation).not.toHaveBeenCalled();
        } finally {
          await server.close();
        }
      });

    it.each(declared.filter((operation) => "failsClosed" in operation.mcp))(
      "$id MCP tool answers CAPABILITY_NOT_ADMITTED without submitting", async (operation) => {
        const submit = vi.fn();
        const execute = createMcpToolExecutor({
          operationService: { submit } as never,
          apiOrigin: "https://knowledge.example",
          identity: resolveIdentity(tokens.owner)!,
        });
        for (const tool of bound(operation.mcp)) {
          const kind = MCP_TOOL_CATALOG[tool as keyof typeof MCP_TOOL_CATALOG];
          const result = await execute(tool as keyof typeof MCP_TOOL_CATALOG, kind, {
            context: operationContext(tenant, owner), input: { vectorStoreId: id(60) }, expectedVersions: { mcp: "v1" },
          });
          expect(result).toMatchObject({ isError: true, content: [{ text: JSON.stringify({ code: "CAPABILITY_NOT_ADMITTED" }) }] });
        }
        expect(submit).not.toHaveBeenCalled();
      });

    it.each(declared.filter((operation) => "failsClosed" in operation.cli))(
      "$id CLI command refuses before any client call", async (operation) => {
        const client = new Proxy({}, { get: () => vi.fn(() => { throw new Error("CLIENT_CALLED"); }) });
        for (const name of bound(operation.cli)) {
          const [group, action] = name.split(" ");
          await expect(dispatchCliCommand(client as never, resolveCommand(group!, action!)!, {}, operationContext(tenant, owner)))
            .rejects.toThrow(/^CAPABILITY_NOT_ADMITTED:/u);
        }
      });
  });
});
