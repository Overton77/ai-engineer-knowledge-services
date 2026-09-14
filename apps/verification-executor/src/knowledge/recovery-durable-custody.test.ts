import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { VerificationArtifactHandle } from "@aiengineer/knowledge-contracts";
import { sha256Digest } from "@aiengineer/knowledge-verification";
import { FilesystemStore } from "../store.js";
import type { ArtifactCustody } from "../store-custody.js";
import { createDurableRecoveryCustody } from "./recovery-durable-custody.js";

it("verifies the exact identity of every remote ancestor, including binary diagnostics", async () => {
  const tenantId = randomUUID();
  function artifact(content: string, mediaType: string, parents: string[] = []) {
    const bytes = new TextEncoder().encode(content), digest = sha256Digest(bytes);
    const handle: VerificationArtifactHandle = { tenantId, artifactId: randomUUID(), digest, byteLength: bytes.byteLength,
      objectKey: `artifacts/${digest.slice(7)}`, mediaType, createdAt: new Date().toISOString(),
      producerActivityId: "custody-proof", producerVersion: "v1", encryptionClass: "filesystem-plain",
      retentionClass: "experiment", dataClassification: "internal", parentArtifactIds: parents };
    return { handle, bytes };
  }
  const parent = artifact("binary diagnostic", "application/octet-stream");
  const root = artifact('{"case":"proof"}', "application/json", [parent.handle.artifactId]);
  let aliasParent = false;
  const custody: ArtifactCustody = {
    async lookup() { throw new Error("unused"); }, async register() { throw new Error("unused"); },
    async resolve(id) {
      if (id === root.handle.artifactId) return root;
      if (id === parent.handle.artifactId) return { ...parent, handle: aliasParent ? { ...parent.handle, artifactId: randomUUID() } : parent.handle };
      return undefined;
    },
  };
  const reader = createDurableRecoveryCustody(new FilesystemStore(join(tmpdir(), `unused-recovery-reader-${randomUUID()}`), tenantId), custody);
  expect(await reader.read({ tenantId, artifact: root.handle })).toEqual({ case: "proof" });
  expect(await reader.read({ tenantId, artifact: parent.handle })).toEqual(parent.bytes);
  aliasParent = true;
  await expect(reader.read({ tenantId, artifact: root.handle })).rejects.toThrow("RESOLVER_IDENTITY_MISMATCH");
});
