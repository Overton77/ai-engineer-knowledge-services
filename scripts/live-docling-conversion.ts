import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DoclingServeProvider, createDoclingServeClientFromEnvironment } from "@aiengineer/knowledge-conversion";
import { sha256Digest } from "@aiengineer/knowledge-domain";
import { InMemoryArtifactStore } from "@aiengineer/knowledge-runtime";

const TENANT_ID = "00000000-0000-7000-8000-000000000001";
const DOCLING_IMAGE = "ghcr.io/docling-project/docling-serve@sha256:f8b324448e7c9e66083049727aaa90e3e65e88f0d7796624597a29d04183198b";
const fixture = `# Durable agent state

An activity records its result and immutable receipt before queue acknowledgement.

| Failure | Recovery |
| --- | --- |
| Expired lease | Reclaim with a new fencing token |

\`\`\`ts
await worker.reconcile(operationId);
\`\`\`
`;

const artifacts = new InMemoryArtifactStore();
const sourceArtifact = await artifacts.put({
  tenantId: TENANT_ID,
  mediaType: "text/markdown",
  bytes: new TextEncoder().encode(fixture),
});
const provider = new DoclingServeProvider(
  DOCLING_IMAGE,
  createDoclingServeClientFromEnvironment(),
  artifacts,
);
const startedAt = new Date().toISOString();
const output = await provider.convert({
  tenantId: TENANT_ID,
  sourceArtifact,
  profile: {
    profileKey: "live-docling-markdown-v1",
    version: "1.0.0",
    mediaType: "text/markdown",
    managedProcessingAllowed: false,
  },
});
const core = {
  schemaVersion: "knowledge-live-docling-receipt/v1",
  generatedAt: new Date().toISOString(),
  startedAt,
  nonCanonical: true,
  tenantId: TENANT_ID,
  provider: { key: output.providerKey, version: output.providerVersion, image: DOCLING_IMAGE },
  endpoint: process.env.DOCLING_BASE_URL?.trim() || "http://127.0.0.1:5001",
  input: { mediaType: "text/markdown", artifactDigest: sourceArtifact.digest, sizeBytes: sourceArtifact.byteLength },
  output: {
    requestDigest: output.requestDigest,
    profileDigest: output.profileDigest,
    receiptDigest: output.receiptDigest,
    providerNativeDigest: output.providerNativeArtifact.digest,
    markdownDigest: output.markdownArtifact.digest,
    plainTextDigest: output.plainTextArtifact.digest,
    nodeCount: output.nodes.length,
    nodeKinds: [...new Set(output.nodes.map((node) => node.kind))].sort(),
    metrics: output.metrics,
    fidelity: output.fidelity.grade,
  },
};
const receipt = { ...core, receiptDigest: sha256Digest(core) };
const catalog = resolve("catalog");
await mkdir(catalog, { recursive: true });
await writeFile(resolve(catalog, "live-docling-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(receipt)}\n`);
