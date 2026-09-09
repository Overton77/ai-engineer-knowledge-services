import { randomUUID } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { VerificationBenchmarkCase } from "@aiengineer/knowledge-contracts";
import { AccountedVerificationProviderSink, assertDiagnosticsProviderWireRequest, createDiagnosticsProviderCaseInput, createDiagnosticsProviderJudgeInput, createDiagnosticsProviderPrompt, DIAGNOSTICS_SUPPORT_OUTPUT_SCHEMA, loadDiagnosticsProviderGrant, VerificationProviderArtifactComposer, type DiagnosticsProviderGrantAuthority } from "@aiengineer/knowledge-application";
import { verificationBenchmarkDigest } from "../packages/evaluation/dist/index.js";
import { PostgresCanonicalRepository, PostgresVerificationProviderAccounting, PostgresVerificationRepository } from "@aiengineer/knowledge-persistence";
import { canonicalizeJson, GatewaySemanticJudgeAdapter, GatewayStructuredExtractionProvider, gatewaySemanticConfigurationDigest, gatewaySemanticOutputSchemaDigest, gatewaySemanticPromptDigest, InterfazeStructuredExtractionProvider, type ProviderArtifactSink } from "@aiengineer/knowledge-verification";
import { SupabaseArtifactStore } from "@aiengineer/knowledge-runtime";

type Budget = { tenantId: string; budgetId: string; budgetKey: string; ceilingCostMicros: number };
const root = resolve("..");
const catalog = resolve("catalog/verification-benchmarks/diagnostics-companies-pilot-v3");
const proofId = randomUUID(), receiptPath = resolve(root, "internal", `verification-benchmark-live-smoke-${proofId}.json`);
const bytes = (value: unknown) => new TextEncoder().encode(typeof value === "string" ? value : canonicalizeJson(value));
async function refuseAfterResetIncident(): Promise<void> {
  try {
    await access(resolve(root, "internal", "verification-local-reset-incident-22ed52a4-680f-4e6a-a70c-9f164278b9ac.json"));
  } catch (error: any) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  throw new Error("LEGACY_BENCHMARK_SMOKE_ENTRYPOINT_RETIRED_USE_REVIEWED_SUCCESSOR_WORKFLOW");
}
const required = (name: string) => { const value = process.env[name]?.trim(); if (!value) throw new Error(`BENCHMARK_SMOKE_${name}_MISSING`); return value; };
async function providerKeys() {
  const source = await readFile(resolve(".env"), "utf8");
  const get = (name: string) => source.split(/\r?\n/u).find((line) => line.startsWith(`${name}=`))?.slice(name.length + 1).trim().replace(/^(['"])(.*)\1$/u, "$2");
  const gateway = get("AI_GATEWAY_API_KEY"), interfaze = get("INTERFAZE_API_KEY"); if (!gateway || !interfaze) throw new Error("BENCHMARK_SMOKE_PROVIDER_KEYS_UNAVAILABLE"); return { gateway, interfaze };
}
class GuardedSink implements ProviderArtifactSink {
  constructor(readonly inner: AccountedVerificationProviderSink, readonly testCase: VerificationBenchmarkCase, readonly authority: DiagnosticsProviderGrantAuthority, readonly policy: { readonly provider: "gateway" | "interfaze"; readonly model: "openai/gpt-5.6-luna" | "anthropic/claude-haiku-4.5" | "interfaze-beta" }) {}
  assertExternalProcessingAdmission(input: { providerId: string; modality: "text" | "image" | "audio" }) { return this.inner.assertExternalProcessingAdmission(input); }
  persistBeforeDispatch(input: { requestDigest: `sha256:${string}`; requestBytes: Uint8Array }) { assertDiagnosticsProviderWireRequest(this.testCase, this.authority, input.requestBytes, this.policy); return this.inner.persistBeforeDispatch(input); }
  persistAfterResponse(input: { requestDigest: `sha256:${string}`; rawResponseBytes: Uint8Array; precontextBytes?: Uint8Array }) { return this.inner.persistAfterResponse(input); }
}
const outputSchema = DIAGNOSTICS_SUPPORT_OUTPUT_SCHEMA;

async function main() {
  const [{ dataset, authority }, grantDocument, budget, keys] = await Promise.all([
    loadDiagnosticsProviderGrant(catalog),
    readFile(resolve(catalog, "derived-input-grant.json"), "utf8").then((text) => JSON.parse(text) as Record<string, any>),
    readFile(resolve(root, "internal/verification-provider-pilot-budget.json"), "utf8").then((text) => JSON.parse(text) as Budget), providerKeys(),
  ]);
  const testCase = dataset.cases.find((item) => item.caseId === "tru-turnaround-product-mutated"); if (!testCase) throw new Error("BENCHMARK_SMOKE_CASE_MISSING");
  const content = createDiagnosticsProviderCaseInput(testCase, authority), postgresUrl = required("POSTGRES_URL"), supabaseUrl = required("SUPABASE_URL"), supabaseSecret = required("SUPABASE_SECRET_KEY");
  if (new URL(postgresUrl).port !== "54322" || new URL(supabaseUrl).port !== "54321") throw new Error("BENCHMARK_SMOKE_REFUSED_NONLOCAL_PERSISTENCE");
  const database = new PostgresCanonicalRepository({ connectionString: postgresUrl, localOnly: true, connectionTimeoutMs: 3_000 });
  const repository = new PostgresVerificationRepository(database, new SupabaseArtifactStore({ projectUrl: supabaseUrl, serviceRoleKey: supabaseSecret, bucket: "ai-engineer-cloud-bucket", maximumBytes: 4_194_304 }), { async authorize(input) { if (input.tenantId !== budget.tenantId) throw new Error("BENCHMARK_SMOKE_TENANT_DENIED"); } });
  const accounting = new PostgresVerificationProviderAccounting(database), missionId = randomUUID(), workItemId = randomUUID(), attemptIds = [randomUUID(), randomUUID(), randomUUID()], createdAt = new Date().toISOString();
  await database.transaction(budget.tenantId, async (client) => {
    await client.query("insert into orchestration.mission(id,tenant_id,slug,goal) values($1,$2,$3,$4)", [missionId, budget.tenantId, `ws07-smoke-${proofId}`, "Bounded D-013 one-case benchmark smoke"]);
    await client.query("insert into orchestration.work_item(id,tenant_id,mission_id,kind,spec,max_attempts) values($1,$2,$3,'verify_claims',$4::jsonb,3)", [workItemId, budget.tenantId, missionId, JSON.stringify({ datasetManifestDigest: dataset.manifestDigest, caseId: testCase.caseId, grantDigest: grantDocument.grantDigest })]);
    for (const [index, attemptId] of attemptIds.entries()) await client.query("insert into orchestration.attempt(id,tenant_id,work_item_id,attempt_no,agent_deployment_id,started_at) values($1,$2,$3,$4,$5,$6)", [attemptId, budget.tenantId, workItemId, index + 1, "verification-benchmark-live-smoke", createdAt]);
  });
  const createSink = async (index: number, providerId: "gateway" | "interfaze", model: "openai/gpt-5.6-luna" | "anthropic/claude-haiku-4.5" | "interfaze-beta", reservationCostMicros: number) => {
    const composer = new VerificationProviderArtifactComposer(repository, { tenantId: budget.tenantId, storageBucket: "ai-engineer-cloud-bucket", producerActivityId: "verification-benchmark-live-smoke", producerVersion: "ws07.v1", encryptionClass: "supabase-managed", retentionClass: "verification-audit", now: () => new Date().toISOString(), producerAttemptId: attemptIds[index]!, missionId, externalProcessingGrant: { providerId, dataClassification: "public", modalities: ["text"], ...(providerId === "interfaze" ? { zdrPolicy: "required" as const } : {}) } });
    const transmission = { schemaVersion: "verification-benchmark-transmission.v1", decision: "D-013", datasetManifestDigest: dataset.manifestDigest, grantDigest: grantDocument.grantDigest, caseId: testCase.caseId, captureId: testCase.evidence[0]!.captureId, sourceKey: testCase.evidence[0]!.sourceKey, sourceClass: testCase.evidence[0]!.sourceClass, selectedContentDigest: testCase.evidence[0]!.selectedContentDigest, assertionDigest: verificationBenchmarkDigest(testCase.assertion), providerId, model, contentKeys: Object.keys(content), labelsExcluded: true, createdAt };
    const manifestArtifact = await composer.registerInput(bytes(transmission), "application/vnd.aiengineer.verification-benchmark-transmission+json");
    const contentArtifact = await composer.registerInput(bytes(content), "application/vnd.aiengineer.verification-benchmark-provider-input+json");
    const inner = new AccountedVerificationProviderSink(composer, accounting, budget, { attemptId: attemptIds[index]!, providerId: `${providerId}-benchmark.v1`, model, reservationCostMicros, estimatedCostMicros: reservationCostMicros });
    return { sink: new GuardedSink(inner, testCase, authority, { provider: providerId, model }), inner, manifestArtifactId: manifestArtifact.artifactId, contentArtifactId: contentArtifact.artifactId };
  };
  const records: any[] = [];
  const execute = async (name: string, configured: Awaited<ReturnType<typeof createSink>>, operation: () => Promise<any>) => {
    let succeeded = false;
    try { const result = await operation(), settlement = await configured.inner.settleOrRetain(result.usage ?? {}); records.push({ name, status: "succeeded", transmissionManifestArtifactId: configured.manifestArtifactId, providerInputArtifactId: configured.contentArtifactId, requestDigest: configured.inner.requestDigest(), requestArtifactId: configured.inner.requestArtifactId(), rawResponseArtifactId: configured.inner.rawArtifactId(), responseEnvelopeArtifactId: configured.inner.responseEnvelopeArtifactId(), rawResponseDigest: configured.inner.rawResponseDigest(), outputDigest: verificationBenchmarkDigest(result.output), usage: result.usage ?? {}, settlement }); succeeded = true; }
    catch (error) { const settlement = await configured.inner.settleOrRetain({}).catch(() => ({ state: "accounting_reconciliation_failed" })); const optional = { requestArtifactId: configured.inner.requestArtifactId(), rawResponseArtifactId: configured.inner.rawArtifactId(), responseEnvelopeArtifactId: configured.inner.responseEnvelopeArtifactId() }; records.push({ name, status: "failed", transmissionManifestArtifactId: configured.manifestArtifactId, providerInputArtifactId: configured.contentArtifactId, ...Object.fromEntries(Object.entries(optional).filter(([, value]) => value !== undefined)), errorCode: error instanceof Error ? error.message : "UNKNOWN", settlement }); }
    await writeFile(resolve(root, "internal", `verification-benchmark-live-smoke-checkpoint-${randomUUID()}.json`), canonicalizeJson({ schemaVersion: "verification-benchmark-live-smoke-checkpoint.v1", receiptPath, datasetManifestDigest: dataset.manifestDigest, caseId: testCase.caseId, records }), { flag: "wx" });
    return succeeded;
  };
  const prompt = createDiagnosticsProviderPrompt(testCase, authority);
  await writeFile(resolve(root, "internal", `verification-benchmark-live-smoke-stage-${proofId}-started.json`), canonicalizeJson({ schemaVersion: "verification-benchmark-live-smoke-stage.v1", proofId, stage: "started_before_provider_setup", datasetManifestDigest: dataset.manifestDigest, grantDigest: authority.grantDigest, providerDispatches: 0, createdAt }), { flag: "wx" });
  const luna = await createSink(0, "gateway", "openai/gpt-5.6-luna", 5_000), lunaProvider = new GatewayStructuredExtractionProvider({ apiKey: keys.gateway, artifactSink: luna.sink });
  let proceed = await execute("gateway-luna", luna, async () => lunaProvider.extract({ prompt, schemaName: "benchmark_support", schema: outputSchema, execution: { deadlineEpochMs: Date.now() + 45_000 } }));
  const judgeInput = createDiagnosticsProviderJudgeInput(testCase, authority);
  if (proceed) {
    const haiku = await createSink(1, "gateway", "anthropic/claude-haiku-4.5", 20_000);
    const judge = new GatewaySemanticJudgeAdapter({ apiKey: keys.gateway, model: "anthropic/claude-haiku-4.5", identity: { deploymentId: "gateway-haiku-ws07-smoke", provider: "vercel-ai-gateway", family: "anthropic", model: "anthropic/claude-haiku-4.5", capability: "llm_evidence_rubric", graderVersion: "evidence-only.v1", promptDigest: gatewaySemanticPromptDigest, outputSchemaDigest: gatewaySemanticOutputSchemaDigest, configurationDigest: gatewaySemanticConfigurationDigest("anthropic/claude-haiku-4.5") }, artifactSink: haiku.sink });
    proceed = await execute("gateway-haiku", haiku, async () => ({ output: await judge.judge(judgeInput, { deadlineEpochMs: Date.now() + 45_000 }), usage: {} }));
  }
  if (proceed) {
    const interfaze = await createSink(2, "interfaze", "interfaze-beta", 50_000), interfazeProvider = new InterfazeStructuredExtractionProvider({ apiKey: keys.interfaze, artifactSink: interfaze.sink });
    await execute("interfaze", interfaze, async () => interfazeProvider.extract({ prompt, schemaName: "benchmark_support", schema: outputSchema, execution: { deadlineEpochMs: Date.now() + 45_000 } }));
  }
  const receipt = { schemaVersion: "verification-benchmark-live-smoke.v1", proofId, createdAt, datasetManifestDigest: dataset.manifestDigest, grantDigest: grantDocument.grantDigest, caseId: testCase.caseId, missionId, workItemId, records, limitations: ["Single case smoke", "Engineering expectation only", "Interfaze estimated price is not actual billing evidence", "No retries"] };
  await writeFile(receiptPath, canonicalizeJson(receipt), { flag: "wx" }); await database.close();
  process.stdout.write(`${JSON.stringify({ receiptPath, receiptDigest: verificationBenchmarkDigest(receipt), statuses: records.map(({ name, status, settlement }) => ({ name, status, settlement: settlement.state })) }, null, 2)}\n`);
}
await refuseAfterResetIncident();
await main();
