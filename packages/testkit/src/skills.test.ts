import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

async function repositoryRoot() {
  let cursor = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 8; depth += 1) {
    try {
      await readFile(join(cursor, "skills", "manifest.json"), "utf8");
      return cursor;
    } catch {
      cursor = resolve(cursor, "..");
    }
  }
  throw new Error("Could not locate the versioned skill catalog");
}

describe("versioned knowledge skills", () => {
  it("ships the ten bounded v1 procedures", async () => {
    const root = await repositoryRoot();
    const manifest = JSON.parse(await readFile(join(root, "skills", "manifest.json"), "utf8")) as {
      contractVersion: string;
      skills: Array<{ id: string; version: string; path: string }>;
    };
    expect(manifest.contractVersion).toBe("v1");
    expect(manifest.skills.map(({ id, version }) => ({ id, version }))).toEqual([
      { id: "schema-explore", version: "1.1.0" },
      { id: "knowledge-db", version: "1.1.0" },
      { id: "knowledge-ingest", version: "1.1.0" },
      { id: "knowledge-acquisition-and-vetting", version: "1.1.0" },
      { id: "knowledge-preparation-and-promotion", version: "1.1.0" },
      { id: "knowledge-retrieval-and-evidence", version: "1.1.0" },
      { id: "knowledge-evaluation", version: "1.1.0" },
      { id: "knowledge-verification", version: "1.1.0" },
      { id: "knowledge-verification-recovery", version: "1.0.0" },
      { id: "vector-store-management", version: "1.1.0" },
    ]);
    for (const skill of manifest.skills) {
      const markdown = await readFile(join(root, "skills", skill.path), "utf8");
      // Verification-family skills bind verification.v1. Platform knowledge skills bind
      // knowledge-service/v1. Executor schema/read/ingest procedures have no YAML contract field.
      const verificationFamily =
        skill.id === "knowledge-verification" || skill.id === "knowledge-verification-recovery";
      const executorKnowledgeSkill =
        skill.id === "schema-explore" || skill.id === "knowledge-db" || skill.id === "knowledge-ingest";
      if (verificationFamily) {
        expect(markdown).toContain('contract: "verification.v1"');
      } else if (!executorKnowledgeSkill) {
        expect(markdown).toContain('contract: "knowledge-service/v1"');
      }
      expect(markdown).toMatch(/never|Never/);
      expect(markdown).not.toMatch(/direct (?:database|canonical|vector) write is allowed/i);
    }
  });
});
