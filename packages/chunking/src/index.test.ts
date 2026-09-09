import { describe, expect, it } from "vitest";
import { convertStructuralDocument } from "@aiengineer/knowledge-documents";
import { ChunkProfileRegistry, chunkDocument, defaultChunkProfileRegistry, reconstructChunk, tokenize } from "./index.js";

const id = (digit: number) => `00000000-0000-4000-8000-${String(digit).padStart(12, "0")}`;
const document = convertStructuralDocument({ tenantId: id(1), representationId: id(2), createdAt: "2026-09-03T12:00:00Z", blocks: [
  { localKey: "h", ordinal: 0, kind: "heading", text: "Chunking" },
  { localKey: "p", parentKey: "h", ordinal: 0, kind: "paragraph", text: "Chunks preserve evidence. Claims remain atomic." },
  { localKey: "footer-1", ordinal: 1, kind: "paragraph", role: "boilerplate", text: "Terms" },
  { localKey: "duplicate", ordinal: 2, kind: "paragraph", text: "Chunks preserve evidence. Claims remain atomic." },
] });

describe("chunking", () => {
  it("registers all admitted strategies and selects by space", () => {
    expect(defaultChunkProfileRegistry.list().map(({ strategy }) => strategy)).toEqual(["transcripts", "headings", "claims", "entities", "tools", "code", "tables"]);
    expect(defaultChunkProfileRegistry.forSpace("engineering_claims").length).toBe(2);
    expect(() => new ChunkProfileRegistry([defaultChunkProfileRegistry.get("atomic-claims-v1"), defaultChunkProfileRegistry.get("atomic-claims-v1")])).toThrow(/already registered/);
  });

  it("creates deterministic atomic, reconstructable chunks and removes boilerplate", () => {
    const profile = defaultChunkProfileRegistry.get("atomic-claims-v1");
    const result = chunkDocument(document.nodes, profile);
    expect(result.chunks.map(({ sourceText }) => sourceText)).toEqual(["Chunking", "Chunks preserve evidence.", "Claims remain atomic."]);
    expect(result.omittedNodeIds).toHaveLength(2);
    expect(result.qa.valid).toBe(true);
    expect(result.chunks.every((chunk) => reconstructChunk(chunk, document.nodes) === chunk.sourceText)).toBe(true);
    expect(chunkDocument(document.nodes, profile).outputDigest).toBe(result.outputDigest);
    expect(tokenize("TypeScript: v5.6")).toEqual(["TypeScript", ":", "v5", ".", "6"]);
  });
});
