import { describe, expect, it } from "vitest";
import { InMemoryArtifactStore } from "@aiengineer/knowledge-runtime";
import { ConversionRouter, DeterministicTextConversionProvider, HttpDoclingServeClient, HttpUnstructuredTransformClient, convertTextToNodes, createDoclingServeClientFromEnvironment, type ConversionOutput, type DocumentConversionProvider } from "./index.js";
describe("deterministic conversion", () => {
  it("produces stable heading and code nodes", () => { const text = "# Heading\n\nParagraph.\n\n```ts\nconst x = 1;\n```"; expect(convertTextToNodes(text, "text/markdown", "rep")).toEqual(convertTextToNodes(text, "text/markdown", "rep")); expect(convertTextToNodes(text, "text/markdown", "rep").nodes.map((n) => n.kind)).toEqual(["document", "heading", "paragraph", "code_block"]); });
  it("preserves transcript timestamps and seals all outputs", async () => { const store = new InMemoryArtifactStore(); const bytes = new TextEncoder().encode("WEBVTT\n\n00:01.000 --> 00:03.000\nHarrison: Reliability matters."); const sourceArtifact = await store.put({ tenantId: "tenant", mediaType: "text/vtt", bytes }); const provider = new DeterministicTextConversionProvider(store); const output = await provider.convert({ tenantId: "tenant", sourceArtifact, profile: { profileKey: "transcript", version: "1", mediaType: "text/vtt", managedProcessingAllowed: false } }); expect(output.nodes[1]?.locator.startTimeMs).toBe(1000); expect(output.nodes[1]?.locator.speaker).toBe("Harrison"); expect(output.fidelity.grade).toBe("high"); expect(await store.get("tenant", output.providerNativeArtifact.digest)).toBeDefined(); });
  it("records a deterministic, redacted fallback route after managed outage", async () => { const store = new InMemoryArtifactStore(); const sourceArtifact = await store.put({ tenantId: "tenant", mediaType: "application/pdf", bytes: new TextEncoder().encode("bounded fixture") }); const request = { tenantId: "tenant", sourceArtifact, profile: { profileKey: "pdf", version: "1", mediaType: "application/pdf", managedProcessingAllowed: true } }; const unavailable: DocumentConversionProvider = { providerKey: "managed", version: "1", supports: () => true, convert: async () => { throw new Error("PROVIDER_UNAVAILABLE:secret-must-not-escape"); } }; const fallbackOutput = { requestDigest: "sha256:" + "1".repeat(64), providerKey: "local", providerVersion: "1" } as ConversionOutput; const local: DocumentConversionProvider = { providerKey: "local", version: "1", supports: () => true, convert: async () => fallbackOutput }; const router = new ConversionRouter({ providerKey: "native", version: "1", supports: () => false, convert: async () => { throw new Error("unused"); } }, unavailable, local); const first = await router.convertWithReceipt(request); const second = await router.convertWithReceipt(request); expect(first.receipt).toEqual(second.receipt); expect(first.receipt.fallbackUsed).toBe(true); expect(first.receipt.attempts[0]).toMatchObject({ providerKey: "managed", outcome: "failed", failureClass: "provider_unavailable" }); expect(JSON.stringify(first.receipt)).not.toContain("secret-must-not-escape"); });
  it("configures Unstructured on-demand auth without placing keys in URLs or errors", async () => { const calls: { url: string; init?: RequestInit }[] = []; const client = new HttpUnstructuredTransformClient({ baseUrl: "https://platform.unstructuredapp.io/api/v1", apiKey: "test-secret", templateId: "template", maximumResultBytes: 100 }, async (url, init) => { calls.push(init === undefined ? { url } : { url, init }); return new Response(JSON.stringify({ id: "job-1" }), { status: 200, headers: { "content-type": "application/json" } }); }); expect(await client.createJob({ artifactDigest: "sha256:" + "a".repeat(64), profileDigest: "sha256:" + "b".repeat(64), bytes: new Uint8Array([1]), mediaType: "text/plain" })).toEqual({ jobId: "job-1" }); expect(calls[0]!.url).not.toContain("test-secret"); expect(new Headers(calls[0]!.init?.headers).get("unstructured-api-key")).toBe("test-secret"); });
  it("calls the bounded Docling Serve v1 multipart API and validates its output", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const responseBody = JSON.stringify({ status: "success", processing_time: 0.1, errors: [], document: { md_content: "# Result", text_content: "Result", json_content: { name: "fixture" } } });
    const client = new HttpDoclingServeClient({ baseUrl: "http://127.0.0.1:5001", apiKey: "docling-secret", maximumResultBytes: 1_000 }, async (url, init) => {
      calls.push(init === undefined ? { url } : { url, init });
      return new Response(responseBody, { status: 200, headers: { "content-type": "application/json" } });
    });
    const output = await client.convert({ bytes: new TextEncoder().encode("fixture"), mediaType: "application/pdf", profileDigest: "sha256:" + "a".repeat(64) });
    expect(output.markdown).toBe("# Result");
    expect(output.plainText).toBe("Result");
    expect(calls[0]?.url).toBe("http://127.0.0.1:5001/v1/convert/file");
    expect(new Headers(calls[0]?.init?.headers).get("x-api-key")).toBe("docling-secret");
    const form = calls[0]?.init?.body as FormData;
    expect(form.getAll("to_formats")).toEqual(["md", "json", "text"]);
    expect(form.get("files")).toBeInstanceOf(File);
    expect(calls[0]?.url).not.toContain("docling-secret");
  });
  it("rejects unsafe Docling URLs and oversized or invalid conversion results", async () => {
    expect(() => new HttpDoclingServeClient({ baseUrl: "http://metadata.internal", maximumResultBytes: 100 })).toThrow("DOCLING_URL_DENIED");
    const oversized = new HttpDoclingServeClient({ baseUrl: "http://localhost:5001", maximumResultBytes: 4 }, async () => new Response("12345", { status: 200 }));
    await expect(oversized.convert({ bytes: new Uint8Array([1]), mediaType: "application/pdf", profileDigest: "sha256:" + "a".repeat(64) })).rejects.toThrow("DOCLING_RESULT_SIZE_LIMIT");
    const failed = new HttpDoclingServeClient({ baseUrl: "http://localhost:5001", maximumResultBytes: 1_000 }, async () => new Response(JSON.stringify({ status: "failure", document: {}, errors: ["bad"] }), { status: 200 }));
    await expect(failed.convert({ bytes: new Uint8Array([1]), mediaType: "application/pdf", profileDigest: "sha256:" + "a".repeat(64) })).rejects.toThrow("DOCLING_CONVERSION_FAILED");
    expect(() => createDoclingServeClientFromEnvironment({ DOCLING_MAXIMUM_RESULT_BYTES: "unbounded" })).toThrow("INVALID_DOCLING_MAXIMUM_RESULT_BYTES");
  });
});
