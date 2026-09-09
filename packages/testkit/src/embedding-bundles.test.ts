import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EMBEDDING_BUNDLE_VIDEO_IDS, importEmbeddingBundleFixtures, loadEmbeddingBundles, validateEmbeddingBundle } from "./embedding-bundles.js";
describe("embedding bundle fixtures", () => {
  it("loads and validates all three actual versioned bundles deterministically", async () => { const first = await loadEmbeddingBundles(); const second = await loadEmbeddingBundles(); expect(first.map((item) => item.bundle.video_id)).toEqual(EMBEDDING_BUNDLE_VIDEO_IDS); expect(first.map((item) => item.digest)).toEqual(second.map((item) => item.digest)); expect(first.reduce((sum, item) => sum + item.bundle.engineering_claims.length, 0)).toBe(41); expect(first.every((item) => item.bundle.store_class === "internal_exploratory")).toBe(true); });
  it("rejects promotion-class and schema drift", () => { expect(() => validateEmbeddingBundle({ schema_version: "bad" })).toThrow("Unsupported"); });
  it("imports exact files with a deterministic provenance manifest", async () => { const first = await mkdtemp(join(tmpdir(), "knowledge-bundles-a-")); const second = await mkdtemp(join(tmpdir(), "knowledge-bundles-b-")); try { const a = await importEmbeddingBundleFixtures(first); const b = await importEmbeddingBundleFixtures(second); expect(a).toEqual(b); expect((await loadEmbeddingBundles(first)).map((item) => item.digest)).toEqual(a.bundles.map((item) => item.digest)); } finally { await rm(first, { recursive: true, force: true }); await rm(second, { recursive: true, force: true }); } });
});
