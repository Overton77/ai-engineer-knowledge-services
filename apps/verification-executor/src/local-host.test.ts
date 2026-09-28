import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHost, type LocalServiceConfig } from "@aiengineer/knowledge-host";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executorLocalVerification } from "./local-services.js";

// The local profile over the executor's file store. Every network or database connection is trapped:
// fetch and raw sockets (which Postgres and HTTP clients use) reject, and ambient provider and database
// credentials are present so that only explicit host configuration can admit a provider.
const encoder = new TextEncoder();
const run = "local-host-run";
const quote = "Panel A has 42 samples.";
const source = "Panel A has 42 samples.\nPanel B has 42 samples.\nCurrency: USD 12.00\nUnit: kg\n";

let directory: string;
let fetchSpy: ReturnType<typeof vi.spyOn>;
let socketSpy: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "ks-local-host-"));
  fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("NETWORK_NOT_ALLOWED"));
  socketSpy = vi.spyOn(net.Socket.prototype, "connect").mockImplementation(() => { throw new Error("SOCKET_NOT_ALLOWED"); });
  vi.stubEnv("FIRECRAWL_API_KEY", "ambient-firecrawl-key");
  vi.stubEnv("AI_GATEWAY_API_KEY", "ambient-gateway-key");
  vi.stubEnv("POSTGRES_URL", "postgres://ambient:secret@127.0.0.1:54322/knowledge");
});
afterEach(async () => {
  fetchSpy.mockRestore();
  socketSpy.mockRestore();
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

const localHost = (options: { readonly providers?: LocalServiceConfig["providers"] } = {}) => createHost({
  profile: "local",
  storeDir: join(directory, "store"),
  identity: { gitSha: "local-host-test" },
  ...options,
  verification: executorLocalVerification,
});

describe("local host profile over the executor file store", () => {
  it("constructs nothing and touches no store, network or database until an admitted operation runs", async () => {
    const host = await localHost();
    expect(existsSync(host.storeDir)).toBe(false);
    await expect(host.verify.captureFile({ bytes: new Uint8Array([37, 80, 68, 70]), filename: "paper.pdf", runId: run })).rejects.toMatchObject({
      code: "CAPABILITY_NOT_ADMITTED", operation: "verify_capture_file", requirement: "document-conversion",
    });
    await expect(host.verify.captureSource({ url: "https://example.test/source.html", runId: run })).rejects.toMatchObject({
      code: "CAPABILITY_NOT_ADMITTED", operation: "verify_capture_source", requirement: "capture-provider",
    });
    await expect(host.verify.judgeSemantics({ runId: run })).rejects.toMatchObject({
      code: "CAPABILITY_NOT_ADMITTED", operation: "verify_judge_semantics", requirement: "semantic-provider",
    });
    expect(existsSync(host.storeDir)).toBe(false);
    await host.close();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(socketSpy).not.toHaveBeenCalled();
  });

  it("runs register, capture-file, read/search/locate, claims, extraction, report, policy, seal and status offline", async () => {
    const host = await localHost();
    const { verify } = host;
    const captured = await verify.captureFile({ bytes: encoder.encode(source), filename: "source.txt", captureId: "panel", runId: run });
    expect(captured).toMatchObject({ captureId: "panel", captureMethod: "file_text", reused: false });
    expect(existsSync(host.storeDir)).toBe(true);
    await expect(verify.captureFile({ bytes: new Uint8Array([37, 80, 68, 70]), filename: "paper.bin", mediaType: "application/pdf", runId: run }))
      .rejects.toMatchObject({ code: "CAPABILITY_NOT_ADMITTED", operation: "verify_capture_file", requirement: "document-conversion" });

    expect((await verify.supportedMediaTypes()).some((type) => type.mediaType === "text/markdown")).toBe(true);
    expect((await verify.listCaptures()).map((capture) => capture.captureId)).toEqual(["panel"]);
    expect(await verify.readCapture({ captureId: "panel", offset: 0, length: 7, runId: run })).toMatchObject({ captureId: "panel" });
    expect(await verify.searchCapture({ captureId: "panel", query: "samples", runId: run })).toBeTruthy();
    expect(await verify.locateQuote({ captureId: "panel", quote: "42 samples", runId: run })).toMatchObject({ status: "ambiguous" });
    expect(await verify.locateQuote({ captureId: "panel", quote, runId: run })).toMatchObject({ status: "resolved" });
    const registered = await verify.registerArtifact({ bytes: encoder.encode("{\"note\":\"local\"}"), mediaType: "application/json", label: "note", runId: run });

    const claims = await verify.verifyClaims({ runId: run, intent: {
      schemaVersion: "verification-claims-intent.v1", intentId: "panel-count",
      claims: [{ claimId: "panel-count", proposition: quote, evidence: [{ captureId: "panel", quote }] }],
    } });
    expect(claims).toMatchObject({ status: "passed" });
    const extraction = await verify.verifyExtraction({ runId: run, intent: {
      schemaVersion: "verification-extraction-intent.v1", intentId: "panel-fields",
      schema: { schemaId: "panel", schemaVersion: "1", jsonSchema: {
        type: "object", description: "Synthetic panel fields", additionalProperties: false, required: ["currency", "unit"],
        properties: { currency: { type: "string", description: "currency", maxLength: 100 }, unit: { type: "string", description: "unit", maxLength: 100 } },
      } },
      candidate: { currency: "USD 12.00", unit: "kg" },
      fields: [
        { path: "/currency", comparison: "currency", quote: "USD 12.00", allowedValues: ["USD"], captureId: "panel" },
        { path: "/unit", comparison: "unit", quote: "kg", allowedValues: ["kg"], captureId: "panel" },
      ],
    } });
    expect(extraction).toMatchObject({ valid: true });
    const report = await verify.checkReport({ runId: run, intent: {
      schemaVersion: "verification-report-intent.v1", intentId: "panel-report", claimsRunId: run,
      reportText: `${quote}\n`, assertions: [{ exactText: quote, claimIds: ["panel-count"] }],
    } });
    expect(report).toHaveProperty("ok");
    // Without a semantic provider the policy decision stays held.
    const policy = await verify.evaluatePolicy({ runId: run });
    expect(["review", "abstain"]).toContain(policy.outcome);
    const sealed = await verify.sealRun({ runId: run });
    expect(sealed.inspection.valid).toBe(true);

    const status = await verify.runStatus({ runId: run });
    expect(status.steps.map((step) => step.operation)).toEqual(expect.arrayContaining([
      "capture_file", "locate_quote", "register_artifact", "verify_claims", "verify_extraction", "check_report", "evaluate_policy", "seal_run",
    ]));
    expect(status.steps.every((step) => step.operation !== "judge_semantics" && step.operation !== "capture_source")).toBe(true);
    expect(await verify.artifact({ artifactId: registered.artifactId, as: "json" })).toMatchObject({ content: { note: "local" } });

    await host.close();
    await host.close();
    await expect(verify.runStatus({ runId: run })).rejects.toThrow("HOST_CLOSED:local");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(socketSpy).not.toHaveBeenCalled();
  });

  it("admits online capture and semantic judging only with explicit provider configuration", async () => {
    const host = await localHost({ providers: { capture: {}, semantic: { aiGatewayApiKey: "explicit-test-key" } } });
    expect(host.capabilities).toMatchObject({ onlineCapture: true, documentConversion: false, semanticJudging: true, database: false });
    // Admitted: the request reaches the provider boundary, where the trap stops it; no provider is called.
    // `auto` would use Firecrawl if the ambient key leaked in; the explicit capture provider has no key.
    await expect(host.verify.captureSource({ url: "https://example.test/source.md", runId: run })).rejects.toThrow("NETWORK_NOT_ALLOWED");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]![0])).toBe("https://example.test/source.md");
    await host.verify.captureFile({ bytes: encoder.encode(source), filename: "source.txt", captureId: "panel", runId: run });
    await host.verify.verifyClaims({ runId: run, intent: {
      schemaVersion: "verification-claims-intent.v1", intentId: "panel-count",
      claims: [{ claimId: "panel-count", proposition: quote, evidence: [{ captureId: "panel", quote }] }],
    } });
    await expect(host.verify.judgeSemantics({ runId: run })).rejects.toMatchObject({ code: "PROVIDER_NETWORK_FAILURE" });
    expect(fetchSpy.mock.calls.map((call: unknown[]) => new URL(String(call[0])).host)).toEqual(["example.test", "ai-gateway.vercel.sh"]);
    const authorization = JSON.stringify(fetchSpy.mock.calls[1]![1]);
    expect(authorization).toContain("explicit-test-key");
    expect(authorization).not.toContain("ambient-gateway-key");
    await host.close();
    expect(socketSpy).not.toHaveBeenCalled();
  });
});
