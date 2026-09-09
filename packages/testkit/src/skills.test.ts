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
  it("ships the six bounded v1 procedures", async () => {
    const root = await repositoryRoot();
    const manifest = JSON.parse(await readFile(join(root, "skills", "manifest.json"), "utf8")) as {
      contractVersion: string;
      skills: Array<{ id: string; version: string; path: string }>;
    };
    expect(manifest.contractVersion).toBe("v1");
    expect(manifest.skills.map(({ id }) => id)).toEqual([
      "knowledge-acquisition-and-vetting",
      "knowledge-preparation-and-promotion",
      "knowledge-retrieval-and-evidence",
      "knowledge-evaluation",
      "knowledge-verification",
      "vector-store-management",
    ]);
    for (const skill of manifest.skills) {
      expect(skill.version).toBe("1.0.0");
      const markdown = await readFile(join(root, "skills", skill.path), "utf8");
      // The verification skill is bound to the verification contract; every other skill to the knowledge-service contract.
      expect(markdown).toContain(skill.id === "knowledge-verification" ? 'contract: "verification.v1"' : 'contract: "knowledge-service/v1"');
      expect(markdown).toMatch(/never|Never/);
      expect(markdown).not.toMatch(/direct (?:database|canonical|vector) write is allowed/i);
    }
  });
});
