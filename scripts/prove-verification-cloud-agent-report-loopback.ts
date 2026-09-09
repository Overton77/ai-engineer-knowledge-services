import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type AgentReportAssertionInput } from "./verification-agent-report-fixture.js";
import { startVerificationCloudAgentReportHost } from "./start-verification-cloud-agent-report-host.js";

async function main() {
  const reportPath = process.env.VERIFICATION_CLOUD_AGENT_REPORT_PATH?.trim();
  const temporalApiKey = process.env.TEMPORAL_API_KEY?.trim() || process.env.TEMPORAL_CLOUD_API_KEY?.trim();
  const producerAgentId = process.env.VERIFICATION_CLOUD_AGENT_ID?.trim(), producerRunId = process.env.VERIFICATION_CLOUD_RUN_ID?.trim();
  assert.ok(reportPath && resolve(reportPath) === reportPath && temporalApiKey && producerAgentId && producerRunId, "CLOUD_AGENT_REPORT_LOOPBACK_INPUT_REQUIRED");
  const report = JSON.parse(await readFile(reportPath, "utf8")) as { reportMarkdown: string; assertion: AgentReportAssertionInput };
  const host = await startVerificationCloudAgentReportHost({ ...report, producerAgentId, producerRunId, temporalApiKey });
  const fixtureBearer = `cursor-cloud-fixture-${randomUUID()}-${randomUUID()}`;
  const bridgeModule = await import(pathToFileURL(resolve("../ai-engineer-mission-control/scripts/verification-loopback-fixture-bridge.mjs")).href) as {
    createVerificationFixtureBridge(input: unknown): { listen(): Promise<string>; close(): Promise<void> } };
  const bridge = bridgeModule.createVerificationFixtureBridge({ upstreamBaseUrl: host.baseUrl, fixtureBearer, upstreamBearer: host.upstreamBearer,
    fixture: host.fixture, expiresAtMs: Date.now() + 10 * 60_000, timeoutMs: 5_000, bodyTimeoutMs: 5_000, maxConnections: 2 });
  let bridgeBaseUrl: string | undefined;
  try {
    bridgeBaseUrl = await bridge.listen();
    const headers = { authorization: `Bearer ${fixtureBearer}`, "content-type": "application/json" };
    const offRoute = await fetch(`${bridgeBaseUrl}/v1e`, { method: "POST", headers, body: host.launchBody, signal: AbortSignal.timeout(10_000) });
    assert.equal(offRoute.status, 404, "CLOUD_AGENT_REPORT_OFF_ROUTE_ACCEPTED");
    const accepted = await fetch(`${bridgeBaseUrl}/v1/verification/executions`, { method: "POST", headers, body: host.launchBody, signal: AbortSignal.timeout(10_000) });
    assert.equal(accepted.status, 202, "CLOUD_AGENT_REPORT_LAUNCH_REJECTED");
    let status: Record<string, unknown> = {};
    for (let attempt = 0; attempt < 90; attempt += 1) {
      const response = await fetch(`${bridgeBaseUrl}/v1/verification/executions/${host.fixture.workflowId}`, { headers: { authorization: `Bearer ${fixtureBearer}` }, signal: AbortSignal.timeout(10_000) });
      assert.equal(response.status, 200, "CLOUD_AGENT_REPORT_READ_REJECTED");
      status = await response.json() as Record<string, unknown>;
      if (status.state === "completed" || status.state === "failed" || status.state === "cancelled") break;
      await new Promise(resolveWait => setTimeout(resolveWait, 1_000));
    }
    assert.equal(status.state, "completed", "CLOUD_AGENT_REPORT_NOT_COMPLETED");
    assert.equal(status.disposition, "review_required", "CLOUD_AGENT_REPORT_REVIEW_REQUIRED");
    assert.equal(status.operationId, host.operationId, "CLOUD_AGENT_REPORT_OPERATION_DRIFT");
    const terminal = await host.readTerminal();
    assert.equal(terminal.output.mode, "deterministic_only", "CLOUD_AGENT_REPORT_DETERMINISTIC_ONLY");
    assert.deepEqual(terminal.output.deterministic.reviewReasons, ["REPORT_CITATION_SEMANTICS_UNASSESSED"]);
    const receiptPath = resolve("../internal", `verification-cloud-agent-report-loopback-${host.namespace}.json`);
    await writeFile(receiptPath, JSON.stringify({ schemaVersion: "verification-cloud-agent-report-loopback.v1", producer: host.producer,
      reportSha256: `sha256:${createHash("sha256").update(report.reportMarkdown).digest("hex")}`, temporalNamespace: "verification-cph-20260908.ih0e7",
      workflowId: host.fixture.workflowId, taskQueue: host.taskQueue, operationId: host.operationId, launchBytes: Buffer.byteLength(host.launchBody), status,
      typedTerminal: { useCase: terminal.useCase, requestDigest: terminal.requestDigest, resultArtifact: terminal.resultArtifact, sealedRun: terminal.sealedRun, output: terminal.output },
      checks: { exactFrozenBridgeLaunch: true, productionMissionControlApi: true, productionTemporalCloudWorker: true, cloudWorkflowCompleted: true,
        localKnowledgeServicesHttp: true, exactOperationScopedWorker: true, signedTypedTerminal: true, agentReportBytesRetained: true, noHumanLabelInvented: true },
      limitations: ["Loopback bridge exercised locally because no authenticated public tunnel endpoint was available", "Citation semantics were deliberately unassessed"],
      createdAt: new Date().toISOString() }, null, 2) + "\n", { flag: "wx" });
    process.stdout.write(JSON.stringify({ event: "verification.cloud_agent_report_loopback.completed", receiptPath, workflowId: host.fixture.workflowId, operationId: host.operationId }) + "\n");
  } finally { await bridge.close(); await host.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch(error => { process.stderr.write(JSON.stringify({ event: "verification.cloud_agent_report_loopback.failed", error: error instanceof Error ? error.message : "unknown" }) + "\n"); process.exitCode = 1; });
}
