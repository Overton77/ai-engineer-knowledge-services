import { randomUUID } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { canonicalizeJson, providerDigest, sha256Digest, GatewaySemanticJudgeAdapter, GatewayStructuredExtractionProvider, InterfazeStructuredExtractionProvider, gatewaySemanticConfigurationDigest, gatewaySemanticOutputSchemaDigest, gatewaySemanticPromptDigest, ProviderFailure } from "@aiengineer/knowledge-verification";
import { AccountedVerificationProviderSink, VerificationProviderArtifactComposer } from "@aiengineer/knowledge-application";
import { PostgresCanonicalRepository, PostgresVerificationProviderAccounting, PostgresVerificationRepository } from "@aiengineer/knowledge-persistence";
import { SupabaseArtifactStore } from "@aiengineer/knowledge-runtime";

type PilotBudget = { readonly schemaVersion: "verification-provider-pilot-budget.v1"; readonly tenantId: string; readonly budgetId: string; readonly budgetKey: string; readonly ceilingCostMicros: number; readonly currency: "USD"; readonly immutable: string; };
type Usage = { readonly costMicros?: number; readonly promptTokens?: number; readonly completionTokens?: number; readonly totalTokens?: number };
type ReceiptCall = { readonly name: string; readonly provider: string; readonly model: string; readonly status: "succeeded" | "failed" | "unavailable"; readonly requestDigest?: string; readonly rawResponseDigest?: string; readonly requestArtifactId?: string; readonly rawResponseArtifactId?: string; readonly responseEnvelopeArtifactId?: string; readonly providerResponseId?: string; readonly observedModel?: string; readonly usage: Usage; readonly accountingState?: string; readonly estimatedCostMicros?: number; readonly actualCostMicros?: number; readonly outputMatchesExpected?: boolean; readonly errorCode?: string; };

const root = resolve("..");
const fixtureDirectory = resolve(root, "internal", "verification-provider-fixtures", "20260906");
const budgetPointerPath = resolve(root, "internal", "verification-provider-pilot-budget.json");
const receiptPath = resolve(root, "internal", `verification-provider-live-conformance-${randomUUID()}.json`);
const bytes = (value: string) => new TextEncoder().encode(value);
async function refuseAfterResetIncident(): Promise<void> {
  try {
    await access(resolve(root, "internal", "verification-local-reset-incident-22ed52a4-680f-4e6a-a70c-9f164278b9ac.json"));
  } catch (error: any) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  throw new Error("LEGACY_PROVIDER_LIVE_ENTRYPOINT_RETIRED_USE_REVIEWED_SUCCESSOR_WORKFLOW");
}

function localEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`LOCAL_PROVIDER_PROOF_${name}_MISSING`);
  return value;
}

async function localProviderKeys(): Promise<{ readonly gateway: string; readonly interfaze: string }> {
  const source = await readFile(resolve(".env"), "utf8");
  const value = (name: string) => {
    const line = source.split(/\r?\n/u).find((candidate) => new RegExp(`^${name}=`).test(candidate));
    if (!line) return undefined;
    const raw = line.slice(name.length + 1).trim();
    return raw.replace(/^(['"])(.*)\1$/u, "$2") || undefined;
  };
  const gateway = value("AI_GATEWAY_API_KEY");
  const interfaze = value("INTERFAZE_API_KEY");
  if (!gateway || !interfaze) throw new Error("LOCAL_PROVIDER_KEYS_UNAVAILABLE");
  return { gateway, interfaze };
}

class AccountedArtifactSink {
  readonly #composer: VerificationProviderArtifactComposer;
  readonly #accounting: PostgresVerificationProviderAccounting;
  readonly #budget: PilotBudget;
  readonly #attemptId: string;
  readonly #providerId: string;
  readonly #model: string;
  readonly #estimatedCostMicros?: number;
  #claimed = false;
  #requestDigest?: `sha256:${string}`;

  constructor(input: { readonly composer: VerificationProviderArtifactComposer; readonly accounting: PostgresVerificationProviderAccounting; readonly budget: PilotBudget; readonly attemptId: string; readonly providerId: string; readonly model: string; readonly estimatedCostMicros?: number }) {
    this.#composer = input.composer; this.#accounting = input.accounting; this.#budget = input.budget; this.#attemptId = input.attemptId;
    this.#providerId = input.providerId; this.#model = input.model; this.#estimatedCostMicros = input.estimatedCostMicros;
  }
  async assertExternalProcessingAdmission(input: { readonly providerId: string; readonly modality: "text" | "image" | "audio" }): Promise<void> {
    await this.#composer.assertExternalProcessingAdmission(input);
  }
  async persistBeforeDispatch(input: { readonly requestDigest: `sha256:${string}`; readonly requestBytes: Uint8Array }): Promise<void> {
    await this.#composer.persistBeforeDispatch(input);
    const request = this.#composer.requestArtifact(input.requestDigest);
    if (!request) throw new Error("LIVE_PROVIDER_REQUEST_ARTIFACT_MISSING");
    await this.#accounting.reserve({ tenantId: this.#budget.tenantId, budgetId: this.#budget.budgetId, budgetKey: this.#budget.budgetKey, ceilingCostMicros: this.#budget.ceilingCostMicros, attemptId: this.#attemptId, requestDigest: input.requestDigest, attemptOrdinal: 0, providerId: this.#providerId, model: this.#model, reservationCostMicros: 1_000_000, ...(this.#estimatedCostMicros === undefined ? {} : { estimatedCostMicros: this.#estimatedCostMicros }), requestArtifactId: request.artifactId });
    const claim = await this.#accounting.claimDispatch({ tenantId: this.#budget.tenantId, attemptId: this.#attemptId, dispatchFence: randomUUID() });
    if (!claim.claimed) throw new Error("LIVE_PROVIDER_DISPATCH_NOT_CLAIMED");
    this.#claimed = true; this.#requestDigest = input.requestDigest;
  }
  async persistAfterResponse(input: { readonly requestDigest: `sha256:${string}`; readonly rawResponseBytes: Uint8Array; readonly precontextBytes?: Uint8Array }): Promise<void> {
    await this.#composer.persistAfterResponse(input);
  }
  requestDigest(): string | undefined { return this.#requestDigest; }
  requestArtifactId(): string | undefined { return this.#requestDigest ? this.#composer.requestArtifact(this.#requestDigest)?.artifactId : undefined; }
  rawArtifactId(): string | undefined { return this.#requestDigest ? this.#composer.rawResponseArtifact(this.#requestDigest)?.artifactId : undefined; }
  rawResponseDigest(): string | undefined { return this.#requestDigest ? this.#composer.rawResponseArtifact(this.#requestDigest)?.digest : undefined; }
  responseEnvelopeArtifactId(): string | undefined { return this.#requestDigest ? this.#composer.responseEnvelopeArtifact(this.#requestDigest)?.artifactId : undefined; }
  async settleOrRetain(usage: Usage): Promise<{ readonly state: string; readonly actualCostMicros?: number }> {
    if (!this.#claimed) return { state: "not_dispatched" };
    const responseEvidenceArtifactId = this.responseEnvelopeArtifactId();
    if (usage.costMicros !== undefined && responseEvidenceArtifactId) {
      const settled = await this.#accounting.settle({ tenantId: this.#budget.tenantId, attemptId: this.#attemptId, actualCostMicros: usage.costMicros, responseArtifactId: responseEvidenceArtifactId });
      return { state: settled.attempt.state, actualCostMicros: usage.costMicros };
    }
    const uncertain = await this.#accounting.markUncertain({ tenantId: this.#budget.tenantId, attemptId: this.#attemptId, ...(responseEvidenceArtifactId ? { responseArtifactId: responseEvidenceArtifactId } : {}) });
    return { state: uncertain.state };
  }
}

async function main(): Promise<void> {
  const [schemaText, expectedText, fixtureText, imageBytes, budgetText, keys] = await Promise.all([
    readFile(resolve(fixtureDirectory, "schema.json"), "utf8"), readFile(resolve(fixtureDirectory, "expected.json"), "utf8"), readFile(resolve(fixtureDirectory, "synthetic-record.txt"), "utf8"), readFile(resolve(fixtureDirectory, "synthetic-record.png")), readFile(budgetPointerPath, "utf8"), localProviderKeys(),
  ]);
  const schema = JSON.parse(schemaText) as unknown;
  const fixtureDefinition = JSON.parse(expectedText) as { expected: Record<string, unknown>; image: { sha256: string } };
  const expected = fixtureDefinition.expected;
  const imageDigest = sha256Digest(imageBytes);
  if (imageDigest !== `sha256:${fixtureDefinition.image.sha256}`) throw new Error("SYNTHETIC_IMAGE_DIGEST_MISMATCH");
  const budget = JSON.parse(budgetText) as PilotBudget;
  if (budget.schemaVersion !== "verification-provider-pilot-budget.v1" || budget.currency !== "USD" || budget.ceilingCostMicros !== 20_000_000) throw new Error("PILOT_BUDGET_POINTER_INVALID");
  const postgresUrl = localEnvironment("POSTGRES_URL");
  const supabaseUrl = localEnvironment("SUPABASE_URL");
  const supabaseSecret = localEnvironment("SUPABASE_SECRET_KEY");
  if (new URL(postgresUrl).port !== "54322" || new URL(supabaseUrl).port !== "54321") throw new Error("LOCAL_PROVIDER_PROOF_REFUSED_REMOTE_TARGET");
  const database = new PostgresCanonicalRepository({ connectionString: postgresUrl, localOnly: true, connectionTimeoutMs: 3_000 });
  const repository = new PostgresVerificationRepository(database, new SupabaseArtifactStore({ projectUrl: supabaseUrl, serviceRoleKey: supabaseSecret, bucket: "ai-engineer-cloud-bucket", maximumBytes: 4_194_304 }), { async authorize(input) { if (input.tenantId !== budget.tenantId) throw new Error("LIVE_PROVIDER_ARTIFACT_TENANT_DENIED"); } });
  const accounting = new PostgresVerificationProviderAccounting(database);
  const missionId = randomUUID(), workItemId = randomUUID();
  const attempts = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const createdAt = new Date().toISOString();
  await database.transaction(budget.tenantId, async (client) => {
    await client.query("insert into orchestration.mission(id,tenant_id,slug,goal) values($1,$2,$3,$4)", [missionId, budget.tenantId, `ws06-live-${receiptPath.slice(-36, -5)}`, "Bounded WS-06 synthetic provider conformance"]);
    await client.query("insert into orchestration.work_item(id,tenant_id,mission_id,kind,spec,max_attempts) values($1,$2,$3,'verify_claims',$4::jsonb,4)", [workItemId, budget.tenantId, missionId, JSON.stringify({ fixture: "synthetic-record-001", budgetPointer: budgetPointerPath })]);
    for (const [index, attemptId] of attempts.entries()) await client.query("insert into orchestration.attempt(id,tenant_id,work_item_id,attempt_no,agent_deployment_id,started_at) values($1,$2,$3,$4,$5,$6)", [attemptId, budget.tenantId, workItemId, index + 1, "verification-provider-live-conformance", createdAt]);
  });

  const createSink = async (index: number, provider: "gateway" | "interfaze", modalities: readonly ("text" | "image" | "audio")[], providerId: string, model: string, inputBytes: Uint8Array, mediaType: string, estimatedCostMicros?: number) => {
    const composer = new VerificationProviderArtifactComposer(repository, { tenantId: budget.tenantId, storageBucket: "ai-engineer-cloud-bucket", producerActivityId: "verification-provider-live-conformance", producerVersion: "ws06.v1", encryptionClass: "supabase-managed", retentionClass: "verification-audit", now: () => new Date().toISOString(), producerAttemptId: attempts[index]!, missionId, externalProcessingGrant: { providerId: provider, dataClassification: "synthetic", modalities, ...(provider === "interfaze" ? { zdrPolicy: "required" as const } : {}) } });
    await composer.registerInput(inputBytes, mediaType);
    return new AccountedVerificationProviderSink(composer, accounting, budget, { attemptId: attempts[index]!, providerId, model, reservationCostMicros: 1_000_000, ...(estimatedCostMicros === undefined ? {} : { estimatedCostMicros }) });
  };

  const calls: ReceiptCall[] = [];
  const checkpoint = async () => {
    const path = resolve(root, "internal", `verification-provider-live-checkpoint-${randomUUID()}.json`);
    await writeFile(path, JSON.stringify({ schemaVersion: "verification-provider-live-checkpoint.v1", finalReceiptPath: receiptPath, calls }), { encoding: "utf8", flag: "wx" });
  };
  const run = async (input: { readonly name: string; readonly provider: string; readonly model: string; readonly sink: AccountedVerificationProviderSink; readonly execute: () => Promise<{ readonly requestDigest?: string; readonly rawResponseDigest?: string; readonly providerResponseId?: string; readonly observedModel?: string; readonly usage: Usage; readonly output?: Record<string, unknown>; readonly compareToFixture?: boolean }> }) => {
    try {
      const result = await input.execute();
      const accountingResult = await input.sink.settleOrRetain(result.usage);
      calls.push({ name: input.name, provider: input.provider, model: input.model, status: "succeeded", requestDigest: result.requestDigest ?? input.sink.requestDigest(), rawResponseDigest: result.rawResponseDigest ?? input.sink.rawResponseDigest(), requestArtifactId: input.sink.requestArtifactId(), rawResponseArtifactId: input.sink.rawArtifactId(), responseEnvelopeArtifactId: input.sink.responseEnvelopeArtifactId(), providerResponseId: result.providerResponseId, observedModel: result.observedModel, usage: result.usage, accountingState: accountingResult.state, ...(accountingResult.actualCostMicros === undefined ? {} : { actualCostMicros: accountingResult.actualCostMicros }), ...(result.compareToFixture ? { outputMatchesExpected: canonicalizeJson(result.output) === canonicalizeJson(expected) } : {}) });
      await checkpoint();
    } catch (error) {
      const accountingResult = await input.sink.settleOrRetain({}).catch(() => ({ state: "accounting_reconciliation_failed" }));
      const failure = error instanceof ProviderFailure ? error.code : "LOCAL_PROVIDER_COMPOSITION_FAILURE";
      calls.push({ name: input.name, provider: input.provider, model: input.model, status: failure === "LOCAL_PROVIDER_COMPOSITION_FAILURE" && !input.sink.requestArtifactId() ? "unavailable" : "failed", requestArtifactId: input.sink.requestArtifactId(), rawResponseArtifactId: input.sink.rawArtifactId(), responseEnvelopeArtifactId: input.sink.responseEnvelopeArtifactId(), usage: {}, accountingState: accountingResult.state, errorCode: failure });
      await checkpoint();
    }
  };

  const extractSink = await createSink(0, "gateway", ["text"], "gateway-extraction.v1", "openai/gpt-5.6-luna", bytes(fixtureText), "text/plain", 20_000);
  const gatewayExtractor = new GatewayStructuredExtractionProvider({ apiKey: keys.gateway, artifactSink: extractSink });
  await run({ name: "gateway_structured_text", provider: "vercel-ai-gateway", model: "openai/gpt-5.6-luna", sink: extractSink, execute: async () => ({ ...await gatewayExtractor.extract({ prompt: `Extract the requested fields from this synthetic record only:\n${fixtureText}`, schemaName: "synthetic_record", schema, execution: { deadlineEpochMs: Date.now() + 45_000 } }), compareToFixture: true }) });

  const judgeInput = { rubricVersion: "evidence-only.v1", assertionId: "synthetic-record-001", proposition: "Example Labs reports 21 systems.", qualifiers: [], entityBindings: [], fragments: [{ fragmentId: "synthetic-record-fragment", exactText: "Systems: 21" }] };
  const judgeSink = await createSink(1, "gateway", ["text"], "gateway-semantic-judge.v1", "anthropic/claude-haiku-4.5", bytes(canonicalizeJson(judgeInput)), "application/json", 20_000);
  const judge = new GatewaySemanticJudgeAdapter({ apiKey: keys.gateway, model: "anthropic/claude-haiku-4.5", identity: { deploymentId: "gateway-haiku-ws06", provider: "vercel-ai-gateway", family: "anthropic", model: "anthropic/claude-haiku-4.5", capability: "llm_evidence_rubric", graderVersion: "evidence-only.v1", promptDigest: gatewaySemanticPromptDigest, outputSchemaDigest: gatewaySemanticOutputSchemaDigest, configurationDigest: gatewaySemanticConfigurationDigest("anthropic/claude-haiku-4.5") }, artifactSink: judgeSink });
  await run({ name: "gateway_cross_family_semantic", provider: "vercel-ai-gateway", model: "anthropic/claude-haiku-4.5", sink: judgeSink, execute: async () => { await judge.judge(judgeInput, { deadlineEpochMs: Date.now() + 45_000 }); return { usage: {} }; } });

  const interfazeTextSink = await createSink(2, "interfaze", ["text"], "interfaze-structured-extraction.v1", "interfaze-beta", bytes(fixtureText), "text/plain");
  const interfaze = new InterfazeStructuredExtractionProvider({ apiKey: keys.interfaze, artifactSink: interfazeTextSink });
  await run({ name: "interfaze_strict_text", provider: "interfaze", model: "interfaze-beta", sink: interfazeTextSink, execute: async () => { const result = await interfaze.extract({ prompt: `Extract the requested fields from this synthetic record only:\n${fixtureText}`, schemaName: "synthetic_record", schema, execution: { deadlineEpochMs: Date.now() + 45_000 } }); return { output: result.output as Record<string, unknown>, requestDigest: result.call.requestDigest, rawResponseDigest: result.call.rawResponseDigest, providerResponseId: result.call.providerResponseId, observedModel: result.call.observedModel, usage: result.call.usage, compareToFixture: true }; } });

  const interfazeImageSink = await createSink(3, "interfaze", ["image"], "interfaze-ocr.v1", "interfaze-beta", imageBytes, "image/png");
  const interfazeOcr = new InterfazeStructuredExtractionProvider({ apiKey: keys.interfaze, artifactSink: interfazeImageSink });
  const imageUri = `data:image/png;base64,${imageBytes.toString("base64")}`;
  await run({ name: "interfaze_fixed_ocr", provider: "interfaze", model: "interfaze-beta", sink: interfazeImageSink, execute: async () => { const result = await interfazeOcr.runTask({ task: "ocr", prompt: "Read this synthetic image exactly. Return the provider fixed task result.", inputData: { filename: "synthetic-record.png", dataUri: imageUri }, execution: { deadlineEpochMs: Date.now() + 45_000 } }); return { output: result.output as Record<string, unknown>, requestDigest: result.call.requestDigest, rawResponseDigest: result.call.rawResponseDigest, providerResponseId: result.call.providerResponseId, observedModel: result.call.observedModel, usage: result.call.usage }; } });

  const receipt = Object.freeze({ schemaVersion: "verification-provider-live-conformance.v1", receiptPath, createdAt, budget: { budgetId: budget.budgetId, tenantId: budget.tenantId, budgetKey: budget.budgetKey, ceilingCostMicros: budget.ceilingCostMicros }, fixture: { caseId: "synthetic-record-001", textDigest: sha256Digest(bytes(fixtureText)), imageDigest, classifiedAs: "synthetic" }, providerPolicy: { externalProcessingAdmission: "registered synthetic input plus sink-bound grant", interfazeZdrRequested: true, noRawOutputsInReceipt: true }, calls });
  await writeFile(receiptPath, JSON.stringify(receipt), { encoding: "utf8", flag: "wx" });
  await database.close();
  console.log(JSON.stringify({ receipt: receiptPath, calls: calls.map((call) => ({ name: call.name, status: call.status, accountingState: call.accountingState, errorCode: call.errorCode })) }));
}

await refuseAfterResetIncident();
await main();
