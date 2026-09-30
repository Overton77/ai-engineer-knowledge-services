import type { LocalServiceConfig, LocalVerificationSeam, LocalVerificationServices } from "@aiengineer/knowledge-host";
import { captureFileMediaKind, type CaptureFileInput, type CaptureInput } from "./capture.js";
import { loadExecutorConfig, VerificationExecutor } from "./executor.js";

type Input<M extends keyof VerificationExecutor> = VerificationExecutor[M] extends (input: infer I) => unknown
  ? I
  : never;

/** Executor configuration from the host's local config only; ambient provider credentials never reach it. */
function executorEnvironment({
  storeDir,
  identity,
  providers,
}: LocalServiceConfig): Readonly<Record<string, string | undefined>> {
  return {
    VERIFY_STORE_DIR: storeDir,
    VERIFY_TENANT_ID: identity.tenantId,
    VERIFY_PRODUCER_DEPLOYMENT_ID: identity.producerDeploymentId,
    VERIFY_VERIFIER_DEPLOYMENT_ID: identity.verifierDeploymentId,
    VERIFY_PRODUCER_ATTEMPT_ID: identity.producerAttemptId,
    VERIFY_VERIFIER_ATTEMPT_ID: identity.verifierAttemptId,
    VERIFY_PRINCIPAL_SALT: identity.principalSalt,
    VERIFY_GIT_SHA: identity.gitSha,
    VERIFY_JUDGE_MODEL: providers.semantic?.judgeModel,
    VERIFY_CROSS_FAMILY_JUDGE_MODEL: providers.semantic?.crossFamilyJudgeModel,
    AI_GATEWAY_API_KEY: providers.semantic?.aiGatewayApiKey,
    FIRECRAWL_API_KEY: providers.capture?.firecrawlApiKey,
  };
}

/**
 * Binds the executor over the host's store directory, identity and explicitly configured providers.
 * Without `identity.gitSha` the executor records `git rev-parse HEAD` (a local subprocess), as its CLI does.
 */
async function createExecutorLocalServices(config: LocalServiceConfig) {
  const executor = await VerificationExecutor.create(loadExecutorConfig(executorEnvironment(config)));
  return {
    supportedMediaTypes: () => executor.supportedMediaTypes(),
    captureFile: (input: CaptureFileInput) => executor.captureFile(input),
    captureSource: (input: CaptureInput) => executor.captureSource(input),
    listCaptures: () => executor.listCaptures(),
    readCapture: (input: Input<"readCapture">) => executor.readCapture(input),
    searchCapture: (input: Input<"searchCapture">) => executor.searchCapture(input),
    locateQuote: (input: Input<"locateQuote">) => executor.locateQuote(input),
    registerArtifact: (input: Input<"registerArtifact">) => executor.registerArtifact(input),
    verifyClaims: (input: Input<"verifyClaims">) => executor.verifyClaims(input),
    verifyExtraction: (input: Input<"verifyExtraction">) => executor.verifyExtraction(input),
    judgeSemantics: (input: Input<"judgeSemantics">) => executor.judgeSemantics(input),
    evaluatePolicy: (input: Input<"evaluatePolicy">) => executor.evaluatePolicy(input),
    sealRun: (input: Input<"sealRun">) => executor.sealRun(input),
    checkReport: (input: Input<"checkReport">) => executor.checkReport(input),
    runStatus: (input: Input<"runStatus">) => executor.runStatus(input),
    artifact: (input: Input<"artifact">) => executor.artifact(input),
  } satisfies LocalVerificationServices;
}

/**
 * Unit 5D3 seam: the executor's file-backed intent pipeline for `createHost({ profile: "local" })`, until
 * the pipeline becomes application use cases. Host admits each operation, including document conversion
 * through the same media-type resolution captureFile applies, before constructing or calling it.
 */
export const executorLocalVerification = {
  captureMediaKind: captureFileMediaKind,
  create: createExecutorLocalServices,
} satisfies LocalVerificationSeam<Awaited<ReturnType<typeof createExecutorLocalServices>>>;
