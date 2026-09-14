import { execSync } from "node:child_process";
import { beginExecutorStateMutation } from "./checkpoint-state-fence.js";
import type {
  Assertion,
  DeterministicVerificationResult,
  SemanticAssessmentRecord,
  VerificationArtifactHandle,
  VerificationBundle,
  VerificationPolicyDecision,
  VerificationPolicyDefinition,
  VerificationRecordedPolicyInputs,
  VerificationRunManifest,
  VerificationSourceAssessment,
} from "@aiengineer/knowledge-contracts";
import { evaluateVerificationPolicy } from "@aiengineer/knowledge-policy";
import {
  admitExtractionSchema,
  assessSourceAuthority,
  authorizeSemanticCase,
  canonicalizeJson,
  digestCanonicalJson,
  GatewaySemanticJudgeAdapter,
  gatewaySemanticConfigurationDigest,
  gatewaySemanticOutputSchemaDigest,
  gatewaySemanticPromptDigest,
  inspectAuditBundle,
  isLiteralExtractionAssertion,
  sealAuditBundle,
  sha256Digest,
  verificationManifestDigest,
  verifyAssertionSemantics,
  verifyDeterministicBundle,
  verifyExtractionFields,
  verifyReportWide,
  type MechanicallySelectedFragment,
  type ProviderArtifactSink,
  type ReportAssertionAssessment,
  type RuntimePrincipalBinding,
  type SemanticJudgeAdapter,
  type VerificationAuditBundle,
} from "@aiengineer/knowledge-verification";
import { captureFile, captureSource, SUPPORTED_MEDIA_TYPES, type CaptureFileInput, type CaptureInput, type CaptureOutcome } from "./capture.js";
import {
  ClaimsIntentSchema,
  ExtractionIntentSchema,
  PolicyDefinitionInputSchema,
  ReportIntentSchema,
  type ClaimsIntent,
  type ExtractionIntent,
  type PolicyDefinitionInput,
  type ReportIntent,
} from "./intents.js";
import { countOccurrences, loadCaptureContent, locateQuote, searchContent } from "./locate.js";
import { deterministicUuid, encoder, FilesystemStore, type CaptureRecord, type RunState, type StepReceipt } from "./store.js";

export const EXECUTOR_VERSION = "knowledge-verification-executor.v1";
const ACTIVITY = "verification-executor";
type JudgeModel = "openai/gpt-5.6-terra" | "openai/gpt-5.6-luna" | "anthropic/claude-haiku-4.5";
const judgeModels = new Set<string>(["openai/gpt-5.6-terra", "openai/gpt-5.6-luna", "anthropic/claude-haiku-4.5"]);

export interface ExecutorConfig {
  readonly storeDir: string;
  readonly tenantId: string;
  readonly producerDeploymentId: string;
  readonly verifierDeploymentId: string;
  readonly principalSalt: string;
  readonly judgeModel: JudgeModel;
  readonly crossFamilyJudgeModel?: JudgeModel;
  readonly aiGatewayApiKey?: string;
  readonly gitSha: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}

export function loadExecutorConfig(env: Readonly<Record<string, string | undefined>> = process.env): ExecutorConfig {
  const judge = env.VERIFY_JUDGE_MODEL?.trim() || "openai/gpt-5.6-terra";
  const cross = env.VERIFY_CROSS_FAMILY_JUDGE_MODEL?.trim();
  if (!judgeModels.has(judge)) throw new Error(`VERIFY_JUDGE_MODEL_UNSUPPORTED:${judge}`);
  if (cross && !judgeModels.has(cross)) throw new Error(`VERIFY_CROSS_FAMILY_JUDGE_MODEL_UNSUPPORTED:${cross}`);
  let gitSha = env.VERIFY_GIT_SHA?.trim() ?? "";
  if (!gitSha) {
    try { gitSha = execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { gitSha = "unknown"; }
  }
  return {
    storeDir: env.VERIFY_STORE_DIR?.trim() || ".verification-store",
    tenantId: env.VERIFY_TENANT_ID?.trim() || deterministicUuid("tenant", "verification-executor-local"),
    producerDeploymentId: env.VERIFY_PRODUCER_DEPLOYMENT_ID?.trim() || "eve-research-producer",
    verifierDeploymentId: env.VERIFY_VERIFIER_DEPLOYMENT_ID?.trim() || "knowledge-verification-executor",
    principalSalt: env.VERIFY_PRINCIPAL_SALT?.trim() || "local-development-salt",
    judgeModel: judge as JudgeModel,
    ...(cross ? { crossFamilyJudgeModel: cross as JudgeModel } : {}),
    ...(env.AI_GATEWAY_API_KEY ? { aiGatewayApiKey: env.AI_GATEWAY_API_KEY } : {}),
    gitSha,
    env,
  };
}

const fail = (code: string): never => { throw new Error(code); };
const hostOf = (url: string): string => { try { return new URL(url).host || "unknown-host"; } catch { return "unknown-host"; } };

function claimScope(claimType: Assertion["claimType"]): VerificationRecordedPolicyInputs["assertions"][number]["claimScope"] {
  if (claimType === "causal") return "causal";
  if (claimType === "comparative") return "comparative_superiority";
  if (claimType === "methodological") return "method_validation";
  return "descriptive_fact";
}

function pendingSemantic(assertionId: string, failed: boolean): SemanticAssessmentRecord {
  return {
    assertionId,
    verdict: failed ? "unverifiable" : "pending_semantic_review",
    disposition: failed ? "fail" : "review",
    evidenceSupport: "not_assessed", worldCorrectness: "not_assessed", attributionFaithfulness: "not_assessed",
    sourceAuthority: "not_assessed", provenanceIntegrity: "not_assessed",
    judgeIdentities: [], supportingFragmentIds: [], contradictingFragmentIds: [],
    unsupportedFacets: ["semantic_support", "source_authority"],
    reasonCodes: [failed ? "MECHANICAL_FAILURE" : "DETERMINISTIC_ONLY"],
    crossFamilySecondJudge: false, rawProviderConfidences: [],
  };
}

function compactChecks(checks: readonly { code: string; status: string; detail?: string }[]) {
  return checks.filter((item) => item.status !== "passed").map((item) => ({ code: item.code, status: item.status, ...(item.detail ? { detail: item.detail } : {}) }));
}

export class VerificationExecutor {
  readonly store: FilesystemStore;
  readonly config: ExecutorConfig;

  private constructor(store: FilesystemStore, config: ExecutorConfig) {
    this.store = store;
    this.config = config;
  }

  static async create(config: ExecutorConfig = loadExecutorConfig()): Promise<VerificationExecutor> {
    const store = new FilesystemStore(config.storeDir, config.tenantId);
    await store.init();
    return new VerificationExecutor(store, config);
  }

  // ---- step receipts -----------------------------------------------------------

  private async step<T>(runId: string | undefined, operation: string, input: unknown, fn: () => Promise<T>, summarize: (output: T) => unknown = (output) => output): Promise<T> {
    const releaseState = beginExecutorStateMutation(this.store, runId);
    const startedAt = new Date().toISOString();
    try {
      const output = await fn();
      if (runId) await this.store.appendStep({ runId, operation, startedAt, completedAt: new Date().toISOString(), status: "succeeded", input, output: summarize(output) });
      return output;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (runId) await this.store.appendStep({ runId, operation, startedAt, completedAt: new Date().toISOString(), status: "failed", input, output: null, error: message });
      throw error;
    } finally {
      releaseState();
    }
  }

  private principals(producerDeploymentId: string): RuntimePrincipalBinding {
    return {
      basis: "runtime_principal_binding",
      producerDeploymentId,
      verifierDeploymentId: this.config.verifierDeploymentId,
      producerPrincipalDigest: sha256Digest(`producer:${producerDeploymentId}:${this.config.principalSalt}`),
      verifierPrincipalDigest: sha256Digest(`verifier:${this.config.verifierDeploymentId}:${this.config.principalSalt}`),
    };
  }

  // ---- capture / locate ----------------------------------------------------------

  private async recordCapture(outcome: CaptureOutcome, runId: string | undefined) {
    if (runId) {
      const state = await this.store.readRun(runId);
      state.captureIds = [...new Set([...(state.captureIds ?? []), outcome.record.captureId])];
      await this.store.writeRun(state);
    }
    return {
      captureId: outcome.record.captureId,
      sourceId: outcome.record.sourceId,
      requestedUrl: outcome.record.requestedUrl,
      finalUrl: outcome.record.finalUrl,
      title: outcome.record.title,
      capturedAt: outcome.record.capturedAt,
      captureMethod: outcome.record.captureMethod,
      sourceKind: outcome.record.sourceKind,
      characters: outcome.record.characters,
      contentArtifact: { artifactId: outcome.record.contentArtifact.artifactId, digest: outcome.record.contentArtifact.digest, byteLength: outcome.record.contentArtifact.byteLength },
      ...(outcome.record.originalArtifact ? { originalArtifact: { artifactId: outcome.record.originalArtifact.artifactId, digest: outcome.record.originalArtifact.digest, byteLength: outcome.record.originalArtifact.byteLength, mediaType: outcome.record.originalArtifact.mediaType } } : {}),
      reused: outcome.reused,
      preview: outcome.content.slice(0, 1200),
    };
  }

  async captureSource(input: CaptureInput) {
    return this.step(input.runId, "capture_source", { url: input.url, method: input.method ?? "auto", captureId: input.captureId }, async () =>
      this.recordCapture(await captureSource(this.store, input, this.config.env), input.runId));
  }

  /** Capture bytes the caller already holds (sandbox file, upload). Text conversion happens here, never in the agent. */
  async captureFile(input: CaptureFileInput) {
    return this.step(input.runId, "capture_file", { filename: input.filename, mediaType: input.mediaType, sourceUri: input.sourceUri, captureId: input.captureId, byteLength: input.bytes.byteLength }, async () =>
      this.recordCapture(await captureFile(this.store, input, this.config.env), input.runId));
  }

  supportedMediaTypes() {
    return Object.entries(SUPPORTED_MEDIA_TYPES).map(([mediaType, spec]) => ({ mediaType, kind: spec.kind, extensions: spec.extensions, conversion: spec.kind === "text" ? "utf-8 decode" : spec.kind === "html" ? "tag strip (executor)" : "firecrawl /v2/parse → markdown" }));
  }

  async listCaptures() {
    const records = await this.store.listCaptures();
    return records.map((record) => ({ captureId: record.captureId, url: record.finalUrl, title: record.title, characters: record.characters, capturedAt: record.capturedAt, digest: record.contentArtifact.digest }));
  }

  async readCapture(input: { captureId: string; offset?: number; length?: number; runId?: string }) {
    const { record, content } = await loadCaptureContent(this.store, input.captureId);
    const offset = Math.max(0, input.offset ?? 0);
    const length = Math.min(Math.max(1, input.length ?? 6000), 20_000);
    return { captureId: record.captureId, offset, length: Math.min(length, Math.max(0, content.length - offset)), totalCharacters: content.length, text: content.slice(offset, offset + length), hasMore: offset + length < content.length };
  }

  async searchCapture(input: { captureId: string; query: string; limit?: number; runId?: string }) {
    return this.step(input.runId, "search_capture", input, async () => {
      const { record, content } = await loadCaptureContent(this.store, input.captureId);
      const hits = searchContent(content, input.query, input.limit ?? 8);
      return { captureId: record.captureId, query: input.query, hits: hits.map((hit) => ({ ...hit, occurrenceCount: countOccurrences(content, hit.exact) })) };
    }, (output) => ({ captureId: output.captureId, query: output.query, hitCount: output.hits.length }));
  }

  async locateQuote(input: { captureId: string; quote: string; runId?: string }) {
    return this.step(input.runId, "locate_quote", { captureId: input.captureId, quote: input.quote }, async () => {
      const { record, content } = await loadCaptureContent(this.store, input.captureId);
      return locateQuote(record, content, input.quote);
    }, (output) => ({ captureId: output.captureId, quote: output.quote, status: output.status, occurrenceCount: output.occurrenceCount, selectedContentDigest: output.selectedContentDigest }));
  }

  // ---- artifact registration -------------------------------------------------------

  async registerArtifact(input: { bytes: Uint8Array; mediaType: string; label?: string; runId?: string; dataClassification?: "public" | "internal" | "confidential" | "restricted" }) {
    return this.step(input.runId, "register_artifact", { mediaType: input.mediaType, label: input.label, byteLength: input.bytes.byteLength }, async () => {
      const handle = await this.store.put({
        bytes: input.bytes,
        mediaType: input.mediaType,
        producerActivityId: `${ACTIVITY}:register${input.label ? `:${input.label}` : ""}`,
        producerVersion: EXECUTOR_VERSION,
        ...(input.dataClassification ? { dataClassification: input.dataClassification } : {}),
      });
      return { artifactId: handle.artifactId, digest: handle.digest, byteLength: handle.byteLength, mediaType: handle.mediaType, objectKey: handle.objectKey };
    });
  }

  private async loadIntent<T>(schema: { parse(value: unknown): T }, input: { intent?: unknown; intentArtifactId?: string }, label: string): Promise<{ intent: T; handle: VerificationArtifactHandle }> {
    if (input.intentArtifactId) {
      const handle = await this.store.resolveHandle({ artifactId: input.intentArtifactId });
      return { intent: schema.parse(await this.store.json(handle)), handle };
    }
    if (input.intent === undefined) throw new Error(`${label}_INTENT_REQUIRED`);
    const intent = schema.parse(input.intent);
    const { handle } = await this.store.putJson(intent, { mediaType: `application/vnd.aiengineer.${label.toLowerCase()}-intent+json`, producerActivityId: `${ACTIVITY}:register:${label.toLowerCase()}-intent`, producerVersion: EXECUTOR_VERSION });
    return { intent, handle };
  }

  // ---- claims ------------------------------------------------------------------------

  async compileClaims(intent: ClaimsIntent, runId: string): Promise<{ bundle: VerificationBundle; captures: Map<string, CaptureRecord>; contents: Map<string, string> }> {
    const captureIds = [...new Set(intent.claims.flatMap((claim) => claim.evidence.map((edge) => edge.captureId)))];
    const captures = new Map<string, CaptureRecord>();
    const contents = new Map<string, string>();
    for (const captureId of captureIds) {
      const loaded = await loadCaptureContent(this.store, captureId);
      captures.set(captureId, loaded.record);
      contents.set(captureId, loaded.content);
    }
    const producer = intent.producer ?? { deploymentId: this.config.producerDeploymentId, attemptId: runId, capabilityVersion: "claims-intent.v1" };
    const assertions: Assertion[] = intent.claims.map((claim) => ({
      assertionId: claim.claimId,
      kind: "claim",
      claimType: claim.claimType,
      ...(claim.value !== undefined ? { value: claim.value } : {}),
      proposition: claim.proposition,
      producer,
      qualifiers: claim.qualifiers,
      entityBindings: claim.entityBindings,
      derivation: "direct",
      evidence: claim.evidence.map((edge, index) => {
        const record = captures.get(edge.captureId)!;
        return {
          evidenceId: `${claim.claimId}:e${index}`,
          fragment: {
            fragmentId: `${claim.claimId}:f${index}`,
            captureId: record.captureId,
            representationArtifactId: record.contentArtifact.artifactId,
            selector: { kind: "text_quote" as const, quote: edge.quote, normalization: "none" as const },
          },
          role: edge.role,
          origin: "declared" as const,
          expectedSelectedContentDigest: sha256Digest(edge.quote),
          authority: edge.authority,
          parserLineageArtifactIds: [],
        };
      }),
      intent: {
        intentId: `${claim.claimId}:intent`,
        operation: "verify_claim_support",
        subject: claim.proposition.slice(0, 200),
        expectedResult: "Every quote resolves uniquely on the captured bytes and supports the proposition.",
        method: "text_quote selectors resolved against immutable capture artifacts",
        acceptanceCriteria: ["quote resolves exactly once", "selected content digest matches"],
        abstainWhen: ["quote missing or ambiguous"],
      },
      riskClass: claim.riskClass,
      downstreamUse: claim.downstreamUse,
      atomic: true,
    }));
    const sourcesById = new Map<string, VerificationBundle["sources"][number]>();
    for (const record of captures.values()) {
      sourcesById.set(record.sourceId, { sourceId: record.sourceId, kind: record.sourceKind, canonicalUri: record.finalUrl, logicalIdentity: record.logicalIdentity });
    }
    const bundle: VerificationBundle = {
      verificationContractVersion: "verification.v1",
      bundleId: `bundle-${intent.intentId}`,
      policyVersion: intent.policyVersion,
      producer,
      verifier: { deploymentId: this.config.verifierDeploymentId, attemptId: runId, capabilityVersion: EXECUTOR_VERSION },
      sources: [...sourcesById.values()],
      captures: [...captures.values()].map((record) => ({
        captureId: record.captureId,
        sourceId: record.sourceId,
        capturedAt: record.capturedAt,
        captureMethod: record.captureMethod,
        captureMethodVersion: record.captureMethodVersion,
        contentArtifact: record.contentArtifact,
      })),
      assertions,
      metricObservations: [],
      lineage: [],
    };
    return { bundle, captures, contents };
  }

  async verifyClaims(input: { runId: string; intent?: unknown; intentArtifactId?: string }) {
    return this.step(input.runId, "verify_claims", { intentArtifactId: input.intentArtifactId, inline: input.intent !== undefined }, async () => {
      const { intent, handle: intentArtifact } = await this.loadIntent(ClaimsIntentSchema, input, "CLAIMS");
      const { bundle, captures, contents } = await this.compileClaims(intent, input.runId);
      const artifacts = [...captures.values()].map((record) => ({ artifactId: record.contentArtifact.artifactId, content: contents.get(record.captureId)! }));
      const result = verifyDeterministicBundle({ bundle, artifacts, runtimePrincipals: this.principals(bundle.producer.deploymentId) });
      const now = new Date().toISOString();
      const bundleArtifact = (await this.store.putJson(bundle, {
        mediaType: "application/vnd.aiengineer.verification-bundle+json", producerActivityId: `${ACTIVITY}:compile_claims`, producerVersion: EXECUTOR_VERSION, createdAt: now,
        parentArtifactIds: [intentArtifact.artifactId, ...[...captures.values()].map((record) => record.contentArtifact.artifactId)],
        transformation: { kind: "claims_intent_compile.v1", intentDigest: intentArtifact.digest, runId: input.runId },
      })).handle;
      const resultArtifact = (await this.store.putJson(result, {
        mediaType: "application/vnd.aiengineer.deterministic-verification-result+json", producerActivityId: `${ACTIVITY}:verify_claims`, producerVersion: EXECUTOR_VERSION, createdAt: now,
        parentArtifactIds: [bundleArtifact.artifactId], transformation: { kind: "deterministic_verification.v1", bundleDigest: bundleArtifact.digest },
      })).handle;
      const state = await this.store.readRun(input.runId);
      state.intentArtifactId = intentArtifact.artifactId;
      state.bundleArtifactId = bundleArtifact.artifactId;
      state.resultArtifactId = resultArtifact.artifactId;
      delete state.semanticArtifactId; delete state.providerArtifactIds; delete state.policyInputsArtifactId; delete state.decisionArtifactId; delete state.auditArtifactId;
      state.captureIds = [...new Set([...(state.captureIds ?? []), ...captures.keys()])];
      await this.store.writeRun(state);
      return {
        runId: input.runId,
        intentArtifactId: intentArtifact.artifactId,
        bundleArtifactId: bundleArtifact.artifactId,
        resultArtifactId: resultArtifact.artifactId,
        status: result.status,
        semanticEligibility: result.semanticEligibility,
        deploymentSeparation: result.deploymentSeparation.status,
        summary: result.summary,
        captureChecks: compactChecks(result.captureChecks),
        assertions: result.assertions.map((item) => ({
          assertionId: item.assertionId,
          status: item.status,
          semanticEligibility: item.semanticEligibility,
          verdict: item.verdict,
          evidence: item.evidence.map((edge) => ({ evidenceId: edge.evidenceId, status: edge.status, resolution: edge.resolution.status, occurrenceCount: edge.resolution.occurrenceCount, failedChecks: compactChecks(edge.checks) })),
          failedChecks: compactChecks(item.checks),
        })),
      };
    }, (output) => ({ runId: output.runId, status: output.status, summary: output.summary, resultArtifactId: output.resultArtifactId, assertions: output.assertions.map((item) => ({ assertionId: item.assertionId, status: item.status })) }));
  }

  // ---- extraction -------------------------------------------------------------------

  async verifyExtraction(input: { runId?: string; intent?: unknown; intentArtifactId?: string }) {
    return this.step(input.runId, "verify_extraction", { intentArtifactId: input.intentArtifactId, inline: input.intent !== undefined }, async () => {
      const { intent, handle: intentArtifact } = await this.loadIntent(ExtractionIntentSchema, input, "EXTRACTION");
      const admission = admitExtractionSchema({ schemaId: intent.schema.schemaId, schemaVersion: intent.schema.schemaVersion, schema: intent.schema.jsonSchema });
      if (!admission.admitted || !admission.schema) {
        return { runId: input.runId, intentArtifactId: intentArtifact.artifactId, schemaAdmitted: false, schemaChecks: admission.checks, valid: false, candidateValid: false, checks: [] };
      }
      const captureIds = [...new Set(intent.fields.map((field) => field.captureId))];
      const representations = [];
      for (const captureId of captureIds) {
        const { record, content } = await loadCaptureContent(this.store, captureId);
        representations.push({ captureId, artifactId: record.contentArtifact.artifactId, digest: record.contentArtifact.digest as `sha256:${string}`, content: encoder.encode(content), record });
      }
      const byCapture = new Map(representations.map((item) => [item.captureId, item]));
      const outcome = verifyExtractionFields({
        schema: admission.schema,
        candidate: intent.candidate,
        fields: intent.fields.map((field) => ({ path: field.path, comparison: field.comparison })),
        evidence: intent.fields.map((field) => {
          const rep = byCapture.get(field.captureId)!;
          return { path: field.path, captureId: field.captureId, representationArtifactId: rep.artifactId, representationDigest: rep.digest, selector: { kind: "text_quote" as const, quote: field.quote, normalization: "none" as const }, expectedSelectedContentDigest: sha256Digest(field.quote) };
        }),
        representations: representations.map(({ captureId, artifactId, digest, content }) => ({ captureId, artifactId, digest, content })),
      });
      const resultArtifact = (await this.store.putJson({ schemaVersion: "verification-extraction-result.v1", intentDigest: intentArtifact.digest, schemaDigest: admission.schema.schemaDigest, result: outcome }, {
        mediaType: "application/vnd.aiengineer.verification-extraction-result+json", producerActivityId: `${ACTIVITY}:verify_extraction`, producerVersion: EXECUTOR_VERSION,
        parentArtifactIds: [intentArtifact.artifactId, ...representations.map((item) => item.artifactId)], transformation: { kind: "extraction_field_verification.v1", intentDigest: intentArtifact.digest },
      })).handle;
      if (input.runId) {
        const state = await this.store.readRun(input.runId);
        state.extractionResultArtifactIds = [...(state.extractionResultArtifactIds ?? []), resultArtifact.artifactId];
        await this.store.writeRun(state);
      }
      return {
        runId: input.runId,
        intentArtifactId: intentArtifact.artifactId,
        resultArtifactId: resultArtifact.artifactId,
        schemaAdmitted: true,
        schemaDigest: admission.schema.schemaDigest,
        valid: outcome.valid,
        candidateValid: outcome.candidateValid,
        checks: outcome.checks.map((check) => ({ code: check.code, path: check.path, status: check.status, detail: check.detail })),
        failedPaths: [...new Set(outcome.checks.filter((check) => check.status === "failed").map((check) => check.path))],
      };
    }, (output) => ({ valid: output.valid, candidateValid: output.candidateValid, schemaAdmitted: output.schemaAdmitted, failedPaths: "failedPaths" in output ? output.failedPaths : [] }));
  }

  // ---- semantic judge ------------------------------------------------------------------

  private async loadRunChain(runId: string): Promise<{ state: RunState; bundle: VerificationBundle; result: DeterministicVerificationResult; bundleArtifact: VerificationArtifactHandle; resultArtifact: VerificationArtifactHandle; intentArtifact: VerificationArtifactHandle }> {
    const state = await this.store.readRun(runId);
    const { bundleArtifactId, resultArtifactId, intentArtifactId } = state;
    if (!bundleArtifactId || !resultArtifactId || !intentArtifactId) return fail(`RUN_HAS_NO_CLAIMS_VERIFICATION:${runId}`);
    const bundleArtifact = await this.store.resolveHandle({ artifactId: bundleArtifactId });
    const resultArtifact = await this.store.resolveHandle({ artifactId: resultArtifactId });
    const intentArtifact = await this.store.resolveHandle({ artifactId: intentArtifactId });
    return { state, bundle: await this.store.json<VerificationBundle>(bundleArtifact), result: await this.store.json<DeterministicVerificationResult>(resultArtifact), bundleArtifact, resultArtifact, intentArtifact };
  }

  private providerSink(collected: VerificationArtifactHandle[]): ProviderArtifactSink {
    const store = this.store;
    return {
      async assertExternalProcessingAdmission() { /* public captured web content only */ },
      async persistBeforeDispatch(input) {
        collected.push(await store.put({ bytes: input.requestBytes, mediaType: "application/vnd.aiengineer.provider-request+json", producerActivityId: `${ACTIVITY}:judge_request`, producerVersion: EXECUTOR_VERSION, dataClassification: "internal" }));
      },
      async persistAfterResponse(input) {
        collected.push(await store.put({ bytes: input.rawResponseBytes, mediaType: "application/vnd.aiengineer.provider-response+json", producerActivityId: `${ACTIVITY}:judge_response`, producerVersion: EXECUTOR_VERSION, dataClassification: "internal" }));
      },
    };
  }

  private judgeAdapter(model: JudgeModel, sink: ProviderArtifactSink, role: "primary" | "cross_family"): SemanticJudgeAdapter {
    const apiKey = this.config.aiGatewayApiKey ?? fail("AI_GATEWAY_API_KEY_REQUIRED");
    const family = model.split("/")[0]!;
    return new GatewaySemanticJudgeAdapter({
      apiKey,
      model,
      identity: {
        deploymentId: `${this.config.verifierDeploymentId}:judge:${role}:${model.replace(/[^a-z0-9.-]/gi, "-")}`,
        provider: "vercel-ai-gateway",
        family,
        model,
        capability: "llm_evidence_rubric",
        graderVersion: "evidence-only.v1",
        promptDigest: gatewaySemanticPromptDigest,
        outputSchemaDigest: gatewaySemanticOutputSchemaDigest,
        configurationDigest: gatewaySemanticConfigurationDigest(model),
      },
      artifactSink: sink,
    });
  }

  async judgeSemantics(input: { runId: string; assertionIds?: string[]; model?: string; crossFamilyModel?: string }) {
    return this.step(input.runId, "judge_semantics", { assertionIds: input.assertionIds, model: input.model ?? this.config.judgeModel }, async () => {
      const { state, bundle, result, resultArtifact } = await this.loadRunChain(input.runId);
      if (result.status !== "passed" || !result.semanticEligibility) fail(`RUN_NOT_SEMANTICALLY_ELIGIBLE:${result.status}`);
      const model = (input.model ?? this.config.judgeModel) as JudgeModel;
      if (!judgeModels.has(model)) fail(`JUDGE_MODEL_UNSUPPORTED:${model}`);
      const cross = (input.crossFamilyModel ?? this.config.crossFamilyJudgeModel) as JudgeModel | undefined;
      const providerArtifacts: VerificationArtifactHandle[] = [];
      const sink = this.providerSink(providerArtifacts);
      const adapters = { primary: this.judgeAdapter(model, sink, "primary"), ...(cross && cross.split("/")[0] !== model.split("/")[0] ? { crossFamily: this.judgeAdapter(cross, sink, "cross_family") } : {}) };
      const wanted = new Set(input.assertionIds ?? bundle.assertions.map((item) => item.assertionId));
      const contentCache = new Map<string, string>();
      const assessments: SemanticAssessmentRecord[] = [];
      const skipped: { assertionId: string; reason: string }[] = [];
      for (const assertion of bundle.assertions) {
        if (!wanted.has(assertion.assertionId)) continue;
        const mechanical = result.assertions.find((item) => item.assertionId === assertion.assertionId);
        if (!mechanical || mechanical.status !== "passed" || !mechanical.semanticEligibility) { skipped.push({ assertionId: assertion.assertionId, reason: "not_mechanically_eligible" }); continue; }
        const fragments: MechanicallySelectedFragment[] = [];
        for (const edge of assertion.evidence) {
          const evidenceResult = mechanical.evidence.find((item) => item.evidenceId === edge.evidenceId);
          if (!evidenceResult || evidenceResult.status !== "passed" || evidenceResult.resolution.status !== "resolved") continue;
          if (edge.fragment.selector.kind !== "text_quote") continue;
          if (!contentCache.has(edge.fragment.captureId)) contentCache.set(edge.fragment.captureId, (await loadCaptureContent(this.store, edge.fragment.captureId)).content);
          fragments.push({ evidenceId: edge.evidenceId, fragmentId: edge.fragment.fragmentId, exactText: edge.fragment.selector.quote, selectedContentDigest: sha256Digest(edge.fragment.selector.quote) });
        }
        if (fragments.length === 0) { skipped.push({ assertionId: assertion.assertionId, reason: "no_resolved_text_quote_fragments" }); continue; }
        authorizeSemanticCase(bundle, result, assertion.assertionId, fragments);
        const assessment = await verifyAssertionSemantics({ bundle, deterministicResult: result, assertionId: assertion.assertionId, selectedFragments: fragments, adapters });
        assessments.push(assessment);
      }
      const semanticArtifact = (await this.store.putJson({ schemaVersion: "verification-semantic-assessments.v1", runId: input.runId, model, crossFamilyModel: adapters.crossFamily ? cross : undefined, assessments, skipped }, {
        mediaType: "application/vnd.aiengineer.verification-semantic-assessments+json", producerActivityId: `${ACTIVITY}:judge_semantics`, producerVersion: EXECUTOR_VERSION,
        parentArtifactIds: [resultArtifact.artifactId], transformation: { kind: "semantic_judge.v1", model, resultDigest: resultArtifact.digest, providerArtifactDigests: providerArtifacts.map((item) => item.digest) },
      })).handle;
      state.semanticArtifactId = semanticArtifact.artifactId;
      state.providerArtifactIds = [...new Set(providerArtifacts.map((item) => item.artifactId))];
      delete state.policyInputsArtifactId; delete state.decisionArtifactId; delete state.auditArtifactId;
      await this.store.writeRun(state);
      return {
        runId: input.runId,
        model,
        crossFamilyModel: adapters.crossFamily ? cross : undefined,
        semanticArtifactId: semanticArtifact.artifactId,
        providerDispatches: providerArtifacts.filter((item) => item.mediaType.includes("provider-request")).length,
        assessed: assessments.map((item) => ({ assertionId: item.assertionId, verdict: item.verdict, disposition: item.disposition, evidenceSupport: item.evidenceSupport, reasonCodes: item.reasonCodes, unsupportedFacets: item.unsupportedFacets, crossFamilySecondJudge: item.crossFamilySecondJudge })),
        skipped,
      };
    }, (output) => ({ runId: output.runId, model: output.model, assessed: output.assessed.map((item) => ({ assertionId: item.assertionId, verdict: item.verdict, disposition: item.disposition })), skipped: output.skipped }));
  }

  // ---- policy ---------------------------------------------------------------------------

  private sourceAssessments(bundle: VerificationBundle): VerificationSourceAssessment[] {
    const captureToSource = new Map(bundle.captures.map((capture) => [capture.captureId, bundle.sources.find((source) => source.sourceId === capture.sourceId)!]));
    return bundle.assertions.flatMap((assertion) => assertion.evidence.map((edge) => {
      const source = captureToSource.get(edge.fragment.captureId);
      const host = hostOf(source?.canonicalUri ?? "");
      return {
        assessmentId: `${assertion.assertionId}:${edge.fragment.fragmentId}:authority`,
        assertionId: assertion.assertionId,
        fragmentId: edge.fragment.fragmentId,
        sourceFamilyId: host,
        sourceOrganizationId: host,
        vector: edge.authority,
        claimScope: claimScope(assertion.claimType),
        evidenceScope: edge.authority.independence === "self_reported" || edge.authority.independence === "same_organization" ? "company_statement" as const : "unknown" as const,
        publicationRelation: "not_publication" as const,
        jurisdictionKnown: false,
        licenseKnown: false,
        freshnessKnown: edge.authority.freshness !== "unknown",
      };
    }));
  }

  async evaluatePolicy(input: { runId: string; policy?: unknown }) {
    return this.step(input.runId, "evaluate_policy", { policy: input.policy }, async () => {
      const { state, bundle, result, resultArtifact } = await this.loadRunChain(input.runId);
      const policyInput: PolicyDefinitionInput = PolicyDefinitionInputSchema.parse({ policyVersion: bundle.policyVersion, ...(typeof input.policy === "object" && input.policy ? input.policy : {}) });
      if (policyInput.policyVersion !== bundle.policyVersion) fail(`POLICY_VERSION_MISMATCH:${policyInput.policyVersion}!=${bundle.policyVersion}`);
      const definition: VerificationPolicyDefinition = { schemaVersion: "verification-policy.v1", definitionId: `policy-${policyInput.policyVersion}`, ...policyInput };
      const policyArtifact = (await this.store.putJson(definition, { mediaType: "application/vnd.aiengineer.verification-policy+json", producerActivityId: `${ACTIVITY}:policy_definition`, producerVersion: EXECUTOR_VERSION })).handle;
      const semantic = new Map<string, SemanticAssessmentRecord>();
      let semanticArtifact: VerificationArtifactHandle | undefined;
      if (state.semanticArtifactId) {
        semanticArtifact = await this.store.resolveHandle({ artifactId: state.semanticArtifactId });
        const stored = await this.store.json<{ assessments: SemanticAssessmentRecord[] }>(semanticArtifact);
        for (const item of stored.assessments) semantic.set(item.assertionId, item);
      }
      const sourceAssessments = this.sourceAssessments(bundle);
      const recorded: VerificationRecordedPolicyInputs = {
        schemaVersion: "verification-policy-inputs.v1",
        policyVersion: definition.policyVersion,
        runId: input.runId,
        recordedAt: new Date().toISOString(),
        deterministicResult: result,
        assertions: bundle.assertions.map((assertion) => {
          const mechanical = result.assertions.find((item) => item.assertionId === assertion.assertionId);
          const items = sourceAssessments.filter((item) => item.assertionId === assertion.assertionId);
          const authority = assessSourceAuthority(assertion.assertionId, items);
          const knownVectors = items.length > 0 && items.every((item) => Object.values(item.vector).every((value) => value !== "unknown"));
          return {
            assertionId: assertion.assertionId,
            ...(isLiteralExtractionAssertion(assertion) ? { literalExtraction: true as const } : {}),
            riskClass: assertion.riskClass,
            downstreamUse: [...assertion.downstreamUse],
            claimScope: claimScope(assertion.claimType),
            semantic: semantic.get(assertion.assertionId) ?? pendingSemantic(assertion.assertionId, !mechanical || mechanical.status !== "passed" || !mechanical.semanticEligibility),
            authorityStatus: authority.status,
            independentCorroboration: authority.independentCorroboration,
            conflictPresent: authority.conflictPresent,
            criticalFactsKnown: knownVectors,
          };
        }),
        metrics: [],
        sourceAssessments,
      };
      const decision: VerificationPolicyDecision = evaluateVerificationPolicy(definition, recorded);
      const { handle: policyInputsArtifact } = await this.store.putJson(recorded, {
        mediaType: "application/vnd.aiengineer.verification-policy-inputs+json", producerActivityId: `${ACTIVITY}:policy_inputs`, producerVersion: EXECUTOR_VERSION,
        parentArtifactIds: [resultArtifact.artifactId, ...(semanticArtifact ? [semanticArtifact.artifactId] : [])], transformation: { kind: "policy_inputs.v1", runId: input.runId, resultDigest: resultArtifact.digest, semanticDigest: semanticArtifact?.digest },
      });
      const decisionArtifact = (await this.store.putJson(decision, {
        mediaType: "application/vnd.aiengineer.verification-policy-decision+json", producerActivityId: `${ACTIVITY}:evaluate_policy`, producerVersion: EXECUTOR_VERSION,
        parentArtifactIds: [resultArtifact.artifactId, policyArtifact.artifactId, policyInputsArtifact.artifactId], transformation: { kind: "policy_decision.v1", runId: input.runId, policyInputsDigest: policyInputsArtifact.digest },
      })).handle;
      state.policyArtifactId = policyArtifact.artifactId;
      state.policyInputsArtifactId = policyInputsArtifact.artifactId;
      state.decisionArtifactId = decisionArtifact.artifactId;
      delete state.auditArtifactId;
      await this.store.writeRun(state);
      return {
        runId: input.runId,
        policyVersion: definition.policyVersion,
        policyArtifactId: policyArtifact.artifactId,
        policyInputsArtifactId: policyInputsArtifact.artifactId,
        decisionArtifactId: decisionArtifact.artifactId,
        outcome: decision.outcome,
        reasonCodes: decision.reasonCodes,
        assertionOutcomes: decision.assertionOutcomes,
        semanticCoverage: { judged: semantic.size, total: bundle.assertions.length },
      };
    }, (output) => ({ runId: output.runId, outcome: output.outcome, reasonCodes: output.reasonCodes, semanticCoverage: output.semanticCoverage }));
  }

  // ---- seal -----------------------------------------------------------------------------

  async sealRun(input: { runId: string }) {
    return this.step(input.runId, "seal_run", {}, async () => {
      const { state, bundle, result, bundleArtifact, resultArtifact, intentArtifact } = await this.loadRunChain(input.runId);
      const { policyArtifactId, policyInputsArtifactId, decisionArtifactId } = state;
      if (!policyArtifactId || !policyInputsArtifactId || !decisionArtifactId) return fail("RUN_HAS_NO_POLICY_DECISION");
      const policyArtifact = await this.store.resolveHandle({ artifactId: policyArtifactId });
      const policyInputsArtifact = await this.store.resolveHandle({ artifactId: policyInputsArtifactId });
      const decisionArtifact = await this.store.resolveHandle({ artifactId: decisionArtifactId });
      const decision = await this.store.json<VerificationPolicyDecision>(decisionArtifact);
      const policyInputsBytes = await this.store.bytes(policyInputsArtifact);
      const semanticArtifact = state.semanticArtifactId ? await this.store.resolveHandle({ artifactId: state.semanticArtifactId }) : undefined;
      const providerArtifacts: VerificationArtifactHandle[] = [];
      for (const id of state.providerArtifactIds ?? []) providerArtifacts.push(await this.store.resolveHandle({ artifactId: id }));
      const captureArtifacts = bundle.captures.map((capture) => capture.contentArtifact);
      const startedAt = state.createdAt;
      const completedAt = new Date().toISOString();
      const unique = (handles: VerificationArtifactHandle[]) => [...new Map(handles.map((item) => [item.artifactId, item])).values()].sort((a, b) => a.artifactId.localeCompare(b.artifactId));
      const inputArtifacts = unique([intentArtifact, ...captureArtifacts, policyArtifact, ...(semanticArtifact ? [semanticArtifact] : []), ...providerArtifacts, policyInputsArtifact]);
      const outputArtifacts = unique([bundleArtifact, resultArtifact, decisionArtifact]);
      const lineage = [...inputArtifacts, ...outputArtifacts].flatMap((artifact) => artifact.parentArtifactIds.map((parentId, ordinal) => ({
        edgeId: deterministicUuid("executor-lineage", `${artifact.artifactId}:${parentId}:${ordinal}`),
        fromArtifactId: artifact.artifactId,
        toArtifactId: parentId,
        relation: "generated" as const,
        activityId: artifact.producerActivityId,
        activityVersion: artifact.producerVersion,
      })));
      const manifest: VerificationRunManifest = {
        verificationContractVersion: "verification.v1",
        manifestId: deterministicUuid("executor-manifest", input.runId),
        runId: input.runId,
        versions: { policy: bundle.policyVersion, schema: "verification.v1", normalizer: "knowledge-verification.v1", ...(semanticArtifact ? { grader: "evidence-only.v1" } : {}) },
        code: { gitSha: this.config.gitSha, dirty: false },
        runtime: { platform: `node-${process.version}`, deploymentId: this.config.verifierDeploymentId },
        inputArtifacts,
        outputArtifacts,
        stages: [{ name: "verify_claims_judge_policy_seal", status: "succeeded", startedAt, endedAt: completedAt }],
        calls: [],
        toolPolicy: ["no_tools", "no_search", "no_gui"],
        networkPolicy: "allowlisted",
        deterministicResult: result,
        judgments: [],
        policyOutcome: decision.outcome,
        resultDigest: resultArtifact.digest,
        lineage,
        canonicalization: { algorithm: "RFC8785", implementationVersion: "knowledge-verification.v1", manifestDigest: sha256Digest("") },
        startedAt,
        completedAt,
      };
      manifest.canonicalization.manifestDigest = verificationManifestDigest(manifest);
      const audit: VerificationAuditBundle = await sealAuditBundle({
        tenantId: this.store.tenantId,
        verificationBundle: bundle,
        manifest,
        policyBinding: { policyVersion: bundle.policyVersion, policyArtifact, recordedPolicyInputsArtifact: policyInputsArtifact },
        recordedPolicyInputsBytes: policyInputsBytes,
        policyDecision: decision,
      });
      const inspection = await inspectAuditBundle(audit);
      const auditArtifact = (await this.store.putJson(audit, {
        mediaType: "application/vnd.aiengineer.verification-audit-bundle+json", producerActivityId: `${ACTIVITY}:seal_run`, producerVersion: EXECUTOR_VERSION,
        parentArtifactIds: [...inputArtifacts, ...outputArtifacts].map((item) => item.artifactId), transformation: { kind: "audit_bundle_seal.v1", manifestDigest: manifest.canonicalization.manifestDigest },
      })).handle;
      state.auditArtifactId = auditArtifact.artifactId;
      await this.store.writeRun(state);
      return {
        runId: input.runId,
        auditArtifactId: auditArtifact.artifactId,
        auditObjectKey: auditArtifact.objectKey,
        manifestDigest: manifest.canonicalization.manifestDigest,
        payloadDigest: audit.seal.payloadDigest,
        deterministicResultDigest: audit.deterministicResultDigest,
        policyDecisionDigest: audit.policyDecisionDigest,
        policyOutcome: decision.outcome,
        inspection,
        inputArtifacts: inputArtifacts.length,
        outputArtifacts: outputArtifacts.length,
        lineageEdges: lineage.length,
        signed: audit.seal.signatureAlgorithm !== undefined,
      };
    });
  }

  // ---- report ---------------------------------------------------------------------------

  async checkReport(input: { runId?: string; intent?: unknown; intentArtifactId?: string }) {
    return this.step(input.runId, "check_report", { intentArtifactId: input.intentArtifactId, inline: input.intent !== undefined }, async () => {
      const { intent, handle: intentArtifact } = await this.loadIntent(ReportIntentSchema, input, "REPORT");
      const chain = await this.loadRunChain(intent.claimsRunId);
      const reportHandle = intent.reportArtifactId
        ? await this.store.resolveHandle({ artifactId: intent.reportArtifactId })
        : (await this.store.put({ bytes: encoder.encode(intent.reportText!), mediaType: "text/markdown; charset=utf-8", producerActivityId: `${ACTIVITY}:register:report`, producerVersion: EXECUTOR_VERSION }));
      const report = await this.store.text(reportHandle);
      const semantic = new Map<string, SemanticAssessmentRecord>();
      if (chain.state.semanticArtifactId) {
        const stored = await this.store.json<{ assessments: SemanticAssessmentRecord[] }>(await this.store.resolveHandle({ artifactId: chain.state.semanticArtifactId }));
        for (const item of stored.assessments) semantic.set(item.assertionId, item);
      }
      const decision = chain.state.decisionArtifactId ? await this.store.json<VerificationPolicyDecision>(await this.store.resolveHandle({ artifactId: chain.state.decisionArtifactId })) : undefined;
      const captureToSource = new Map(chain.bundle.captures.map((capture) => [capture.captureId, chain.bundle.sources.find((source) => source.sourceId === capture.sourceId)!]));
      const problems: string[] = [];
      const assertions: ReportAssertionAssessment[] = [];
      let cursor = 0;
      intent.assertions.forEach((item, index) => {
        let start = report.indexOf(item.exactText, cursor);
        if (start === -1) start = report.indexOf(item.exactText);
        if (start === -1) { problems.push(`REPORT_TEXT_NOT_FOUND:${index}:${item.exactText.slice(0, 60)}`); return; }
        cursor = start + item.exactText.length;
        const citations = item.claimIds.map((claimId) => {
          const assertion = chain.bundle.assertions.find((candidate) => candidate.assertionId === claimId);
          const mechanical = chain.result.assertions.find((candidate) => candidate.assertionId === claimId);
          if (!assertion || !mechanical) { problems.push(`UNKNOWN_CLAIM_ID:${claimId}`); }
          const edge = assertion?.evidence[0];
          const source = edge ? captureToSource.get(edge.fragment.captureId) : undefined;
          const semanticRecord = semantic.get(claimId);
          return {
            citationId: `r${index}:${claimId}`,
            fragmentId: edge?.fragment.fragmentId ?? `missing:${claimId}`,
            pointerStatus: !assertion || !mechanical ? "missing" as const : mechanical.status === "passed" ? "valid" as const : "malformed" as const,
            semanticVerdict: semanticRecord?.verdict ?? mechanical?.verdict ?? "unverifiable",
            sourceFamilyId: hostOf(source?.canonicalUri ?? ""),
            sourceIndependence: edge ? (edge.authority.independence === "independent" ? "independent" as const : edge.authority.independence === "unknown" ? "unknown" as const : "not_independent" as const) : "unknown" as const,
          };
        });
        assertions.push({
          assertionId: `report-assertion-${index + 1}`,
          exactText: item.exactText,
          start,
          end: start + item.exactText.length,
          citationRequired: true,
          claimWeight: item.claimWeight,
          severity: item.severity,
          citations,
          requiredQualifiers: item.requiredQualifiers,
        });
      });
      const summary = assertions.length > 0 ? verifyReportWide(report, assertions) : undefined;
      const citedClaimIds = new Set(intent.assertions.flatMap((item) => item.claimIds));
      const uncitedVerifiedClaims = chain.bundle.assertions.map((item) => item.assertionId).filter((id) => !citedClaimIds.has(id));
      const perAssertionOutcome = new Map((decision?.assertionOutcomes ?? []).map((item) => [item.assertionId, item.outcome]));
      const citationsOnFailedClaims = [...citedClaimIds].filter((id) => { const outcome = perAssertionOutcome.get(id); return outcome === "fail" || outcome === "abstain"; });
      const citationsUnderReview = [...citedClaimIds].filter((id) => perAssertionOutcome.get(id) === "review");
      const resultArtifact = (await this.store.putJson({ schemaVersion: "verification-report-check.v1", claimsRunId: intent.claimsRunId, reportDigest: reportHandle.digest, summary, problems, assertions, uncitedVerifiedClaims, citationsOnFailedClaims, citationsUnderReview }, {
        mediaType: "application/vnd.aiengineer.verification-report-check+json", producerActivityId: `${ACTIVITY}:check_report`, producerVersion: EXECUTOR_VERSION,
        parentArtifactIds: [intentArtifact.artifactId, reportHandle.artifactId, chain.resultArtifact.artifactId], transformation: { kind: "report_check.v1", reportDigest: reportHandle.digest, resultDigest: chain.resultArtifact.digest },
      })).handle;
      if (input.runId) {
        const state = await this.store.readRun(input.runId);
        state.reportCheckArtifactIds = [...(state.reportCheckArtifactIds ?? []), resultArtifact.artifactId];
        await this.store.writeRun(state);
      }
      return {
        runId: input.runId,
        claimsRunId: intent.claimsRunId,
        reportArtifactId: reportHandle.artifactId,
        reportDigest: reportHandle.digest,
        resultArtifactId: resultArtifact.artifactId,
        reportAssertions: assertions.length,
        summary,
        problems,
        uncitedVerifiedClaims,
        citationsOnFailedClaims,
        citationsUnderReview,
        policyOutcome: decision?.outcome,
        ok: problems.length === 0 && citationsOnFailedClaims.length === 0 && (summary ? summary.pointerFailures.length === 0 && summary.misplacedCitationIds.length === 0 && summary.unsupportedHighSeverityAssertionIds.length === 0 : false),
      };
    }, (output) => ({ ok: output.ok, problems: output.problems, reportAssertions: output.reportAssertions, citationCorrectness: output.summary?.citationCorrectness, completeness: output.summary?.claimWeightedCitationCompleteness }));
  }

  // ---- status ---------------------------------------------------------------------------

  async runStatus(input: { runId: string }): Promise<{ state: RunState; steps: StepReceipt[]; storeDir: string }> {
    return { state: await this.store.readRun(input.runId), steps: await this.store.listSteps(input.runId), storeDir: this.store.rootDir };
  }

  async artifact(input: { artifactId?: string; digest?: string; as?: "text" | "json" | "handle" }) {
    const handle = await this.store.resolveHandle(input);
    if (input.as === "handle") return { handle };
    const text = await this.store.text(handle);
    return { handle, content: input.as === "json" ? JSON.parse(text) : text };
  }
}

export { canonicalizeJson, digestCanonicalJson };
export type { ClaimsIntent, ExtractionIntent, ReportIntent };
