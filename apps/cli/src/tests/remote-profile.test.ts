import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { OperationContext } from "@aiengineer/knowledge-contracts";
import { dispatchCliCommand, resolveCommand, type CliKnowledgeClient } from "../commands.js";

// The remote CLI profile of host's capability matrix (packages/host/src/local/capabilities.ts): the CLI
// reaches the service only through KnowledgeClient. It cannot construct host or local persistence, so a
// remote authorization or network failure surfaces and never falls back to local execution.
// 5C adds lazy offline dispatch to `ks`; it replaces the dependency check with one over the module graph
// that `--help` and remote commands load.
const application = join(import.meta.dirname, "../..");
const localExecution = ["@aiengineer/knowledge-host", "@aiengineer/knowledge-persistence", "@aiengineer/knowledge-verification-executor", "pg"];
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const context: OperationContext = {
  tenantId: id(1), operationId: id(2), attemptId: id(3), correlationId: id(4), actor: { kind: "human", id: id(5) },
  capabilityVersion: "v1", idempotencyKey: "key", reason: "test", contractVersion: "v1",
};

describe("remote CLI profile", () => {
  it("depends on and imports no host, local persistence, executor or database driver", () => {
    const manifest = JSON.parse(readFileSync(join(application, "package.json"), "utf8")) as Record<string, Record<string, string> | undefined>;
    expect(Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).filter((name) => localExecution.includes(name))).toEqual([]);
    const sources = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? sources(join(directory, entry.name)) : entry.name.endsWith(".ts") ? [join(directory, entry.name)] : []);
    const importers = sources(join(application, "src")).filter((file) => {
      const text = readFileSync(file, "utf8");
      return localExecution.some((name) => [`"${name}`, `'${name}`, `\`${name}`].some((specifier) => text.includes(specifier)));
    });
    // This file names the packages it forbids.
    expect(importers.filter((file) => !file.endsWith("remote-profile.test.ts"))).toEqual([]);
  });

  it("surfaces remote network and authorization failures without falling back", async () => {
    for (const failure of [new TypeError("fetch failed"), Object.assign(new Error("UNAUTHORIZED"), { status: 401 })]) {
      const client = { getVectorStore: vi.fn().mockRejectedValue(failure) } as unknown as CliKnowledgeClient;
      await expect(dispatchCliCommand(client, resolveCommand("store", "show")!, { vectorStoreId: id(6) }, context)).rejects.toBe(failure);
      expect(client.getVectorStore).toHaveBeenCalledTimes(1);
    }
  });
});
