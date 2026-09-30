// Offline companies demo and its report renderer. Quarantined diagnostics built on the product benchmark.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  VerificationArtifactHandle,
  VerificationBenchmarkCase,
  VerificationBenchmarkCaseResult,
  VerificationSource,
  VerificationSourceCapture,
} from "@aiengineer/knowledge-contracts";
import { VERIFICATION_PARSER_LIMITS, type VerificationParserOutput } from "@aiengineer/knowledge-preparation";
import {
  compareVerificationBenchmarkExperiment,
  runVerificationBenchmark,
  summarizeVerificationBenchmark,
  verificationBenchmarkDigest,
  type VerificationBenchmarkRun,
} from "@aiengineer/knowledge-evaluation";
import {
  admitExtractionSchema,
  projectionSelectorResolver,
  verifyExtractionFields,
} from "@aiengineer/knowledge-verification";
import {
  VerificationAdmissionService,
  type VerificationAdmissionRepositoryPort,
} from "../verification/admission/verification-admission.js";
import {
  type Digest,
  bytesDigest,
  encode,
  normalize,
  numbers,
} from "../verification/benchmark/verification-benchmark-shared.js";
import {
  FileVerificationBenchmarkCheckpointStore,
  diagnosticsBenchmarkArms,
} from "../verification/benchmark/verification-benchmark.js";
import { executeDiagnosticsCompanyFieldPlan } from "./verification-diagnostics-company-fields.js";
import { renderDiagnosticsCompanyFields } from "./verification-diagnostics-field-view.js";
import { composeDiagnosticsPolicyReplay } from "./verification-diagnostics-policy-composition.js";
import { buildDiagnosticsMutationReport } from "./verification-diagnostics-mutation-report.js";
import { buildDiagnosticsOfflineLedgers } from "./verification-diagnostics-offline-ledgers.js";
import { verifyDiagnosticsOfflineClaimsReportClosure } from "./verification-diagnostics-offline-claims-report.js";
import {
  runDiagnosticsEngineeringMutations,
  type DiagnosticsEngineeringMutation,
} from "./verification-diagnostics-engineering-mutations.js";
import {
  buildDiagnosticsReportCoverage,
  auditDiagnosticsReportCoverage,
  type DiagnosticsReportBlockInput,
  type DiagnosticsReportEvidenceResolution,
} from "./verification-diagnostics-report-coverage.js";
import { replayDiagnosticsSemanticFixture } from "./verification-diagnostics-semantic-replay.js";
import {
  loadDiagnosticsGeneratedReportSemanticFixture,
  replayDiagnosticsGeneratedReportSemanticFixture,
} from "./verification-diagnostics-generated-report-semantic-fixture.js";
import { prepareDiagnosticsReportSemanticReplayComposition } from "./verification-diagnostics-report-semantic-composition.js";
import {
  verifyDiagnosticsAdversarialProjection,
  type DiagnosticsAdversarialObservation,
} from "./verification-diagnostics-adversarial.js";
import { evaluateDiagnosticsFullDemoQualityGate } from "./verification-diagnostics-quality-gates.js";
import {
  loadDiagnosticsOfflineCatalog,
  type DiagnosticsOfflineCatalogName,
} from "./verification-diagnostics-offline-catalog.js";

const escapeHtml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const reportFragmentAnchor = (caseId: string) => {
  if (!/^[a-z0-9-]+$/u.test(caseId)) throw new Error("DIAGNOSTICS_REPORT_CASE_ID_INVALID");
  return `fragment-${caseId}`;
};
/** Escapes report content before replacing only catalog-owned citation labels with local anchors. */
export const renderDiagnosticsOfflineReport = (
  markdown: string,
  citations: readonly { readonly label: string; readonly caseId: string }[],
) => {
  let body = escapeHtml(markdown);
  for (const citation of citations) {
    const anchor = reportFragmentAnchor(citation.caseId),
      label = escapeHtml(citation.label);
    body = body.replaceAll(label, `<a href="evidence-appendix.html#${anchor}">${label}</a>`);
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Verification report</title><style>body{font:16px system-ui;max-width:1000px;margin:2rem auto;padding:0 1rem;line-height:1.5}pre{white-space:pre-wrap;background:#f4f4f4;padding:1rem}a{color:#0645ad}</style></head><body><pre>${body}</pre><p><a href="evidence-appendix.html#run-manifest">Open offline evidence appendix</a> · <a href="source-ledger.json">Source snapshot ledger</a> · <a href="company-fields.html">Named company fields</a> · <a href="report-coverage.json">Assertion coverage audit</a></p></body></html>\n`;
};
const words = (value: string) =>
  new Set(
    normalize(value)
      .toLocaleLowerCase("en-US")
      .match(/[a-z0-9]+/gu) ?? [],
  );
const inputOnlyBaseline = (testCase: VerificationBenchmarkCase, locatorValid: boolean, selectedText: string) => {
  if (!locatorValid)
    return {
      schemaValid: true,
      locatorValid: false,
      fieldMechanics: false,
      support: "not_applicable" as const,
      authority: "not_applicable" as const,
      worldCorrectness: "not_applicable" as const,
      policy: "abstain" as const,
      confidence: null,
      confidenceCalibrated: false,
      failureClass: "none" as const,
      callAttributions: [],
    };
  const claim = normalize(testCase.assertion),
    evidence = normalize(selectedText),
    exact = testCase.assertion === selectedText,
    normalized = claim === evidence;
  const claimNumbers = numbers(claim),
    evidenceNumbers = numbers(evidence),
    numberConflict = claimNumbers.some((item) => !evidenceNumbers.includes(item));
  const claimNegation = /\b(?:not|no|never|without)\b/iu.test(claim),
    evidenceNegation = /\b(?:not|no|never|without)\b/iu.test(evidence);
  const evidenceWords = words(evidence),
    claimWords = [...words(claim)],
    overlap = claimWords.length ? claimWords.filter((word) => evidenceWords.has(word)).length / claimWords.length : 0;
  const support = normalized
    ? ("full" as const)
    : numberConflict || claimNegation !== evidenceNegation
      ? ("contradicted" as const)
      : overlap >= 0.7
        ? ("partial" as const)
        : ("none" as const);
  const sourceClass = testCase.evidence[0]!.sourceClass,
    authority = sourceClass === "publication" ? ("sufficient" as const) : ("interested_party_only" as const);
  const promotionalOrMedical = /\b(?:most|only|clinical|diagnos|disease|prevent|treat|accurate|superior)\w*/iu.test(
    claim,
  );
  const policy =
    support === "full"
      ? authority === "interested_party_only" && promotionalOrMedical
        ? ("review" as const)
        : ("pass_with_warnings" as const)
      : support === "partial"
        ? ("review" as const)
        : ("fail" as const);
  return {
    schemaValid: true,
    locatorValid: true,
    fieldMechanics: exact || normalized,
    support,
    authority,
    worldCorrectness: support === "full" ? ("not_established" as const) : ("unknown" as const),
    policy,
    confidence: null,
    confidenceCalibrated: false,
    failureClass: "none" as const,
    callAttributions: [],
  };
};

export interface DiagnosticsDemoResult {
  readonly outputDirectory: string;
  readonly run: VerificationBenchmarkRun;
  readonly fileManifestDigest: Digest;
  readonly qualityGate: ReturnType<typeof evaluateDiagnosticsFullDemoQualityGate>;
  readonly semanticReplay?: Awaited<ReturnType<typeof replayDiagnosticsSemanticFixture>>;
  readonly generatedReportSemanticReplay?: Awaited<ReturnType<typeof replayDiagnosticsGeneratedReportSemanticFixture>>;
  readonly files: readonly { readonly name: string; readonly digest: Digest; readonly bytes: number }[];
}
export async function runDiagnosticsCompaniesDemo(input: {
  readonly catalogDirectory: string;
  readonly catalogName?: DiagnosticsOfflineCatalogName;
  readonly semanticFixture?: { readonly directory: string; readonly expectedFixtureDigest: Digest };
  readonly generatedReportSemanticFixture?: { readonly directory: string; readonly expectedFixtureDigest: Digest };
  readonly sourcePreparationDirectory: string;
  readonly outputDirectory: string;
  readonly runId: string;
  readonly now: () => string;
}): Promise<DiagnosticsDemoResult> {
  const { dataset } = await loadDiagnosticsOfflineCatalog(
    input.catalogName ?? "diagnostics-companies-pilot-v3",
    input.catalogDirectory,
  );
  const semanticReplay = input.semanticFixture
    ? await replayDiagnosticsSemanticFixture({ ...input.semanticFixture, catalogDirectory: input.catalogDirectory })
    : undefined;
  const generatedReportFixture = input.generatedReportSemanticFixture
    ? await loadDiagnosticsGeneratedReportSemanticFixture(input.generatedReportSemanticFixture)
    : undefined;
  const sourceLedger = JSON.parse(await readFile(resolve(input.catalogDirectory, "source-ledger.json"), "utf8"));
  const preparationManifestBytes = await readFile(resolve(input.sourcePreparationDirectory, "manifest.json"));
  if (bytesDigest(preparationManifestBytes) !== dataset.sourcePreparationDigest)
    throw new Error("DIAGNOSTICS_SOURCE_PREPARATION_DIGEST_MISMATCH");
  const preparationManifest = JSON.parse(preparationManifestBytes.toString("utf8")) as {
    artifacts: { file: string; handle: VerificationArtifactHandle }[];
    captures: { sourceKey: string; source: VerificationSource; capture: VerificationSourceCapture }[];
  };
  const artifactById = new Map(preparationManifest.artifacts.map((item) => [item.handle.artifactId, item]));
  if (artifactById.size !== preparationManifest.artifacts.length)
    throw new Error("DIAGNOSTICS_SOURCE_PREPARATION_DUPLICATE_ARTIFACT");
  const captureById = new Map(preparationManifest.captures.map((item) => [item.capture.captureId, item]));
  const repository: VerificationAdmissionRepositoryPort = {
    createTrustedArtifactResolver: () => ({
      authorizeArtifact: async ({ tenantId, artifactId }) => {
        const item = artifactById.get(artifactId);
        if (!item || item.handle.tenantId !== tenantId) throw new Error("DIAGNOSTICS_PREPARED_ARTIFACT_NOT_AUTHORIZED");
      },
      hydrateRegisteredArtifact: async ({ tenantId, artifactId }) => {
        const item = artifactById.get(artifactId);
        if (!item || item.handle.tenantId !== tenantId) throw new Error("DIAGNOSTICS_PREPARED_ARTIFACT_MISSING");
        const bytes = await readFile(resolve(input.sourcePreparationDirectory, item.file));
        if (bytes.byteLength !== item.handle.byteLength || bytesDigest(bytes) !== item.handle.digest)
          throw new Error("DIAGNOSTICS_PREPARED_ARTIFACT_DIGEST_MISMATCH");
        return { registration: item.handle, bytes };
      },
    }),
    getRegisteredCapture: async ({ tenantId, captureId }) => {
      const item = captureById.get(captureId);
      if (!item || item.capture.contentArtifact.tenantId !== tenantId || item.capture.captureId !== captureId)
        throw new Error("DIAGNOSTICS_PREPARED_CAPTURE_MISSING");
      return { source: item.source, capture: item.capture };
    },
    registerContentAddressedArtifact: async () => {
      throw new Error("DIAGNOSTICS_OFFLINE_PREPARATION_READ_ONLY");
    },
  };
  const admission = new VerificationAdmissionService(
    repository,
    {
      parse: async (): Promise<VerificationParserOutput> => {
        throw new Error("DIAGNOSTICS_OFFLINE_PARSER_DISABLED");
      },
    },
    {
      parserVersion: "verification-native-parser.v1",
      imageDigest: "sha256:1669a3f9674b2e0a70ba1c8686c1cb3647492b8268bdfa7a9a4452fb0530fb37",
      limits: VERIFICATION_PARSER_LIMITS,
    },
    {
      storageBucket: "offline-read-only",
      producerVersion: "verification-admission.v1",
      encryptionClass: "supabase-managed",
      retentionClass: "verification-audit",
      now: input.now,
    },
  );
  const resolutions = new Map<
    string,
    { locatorValid: boolean; selectedText: string; selectedContentDigest?: string }
  >();
  const adversarialObservations: DiagnosticsAdversarialObservation[] = [];
  const engineeringMutationInputs: DiagnosticsEngineeringMutation[] = [];
  const extractionMechanics = new Map<string, Awaited<ReturnType<VerificationAdmissionService["verifyExtraction"]>>>();
  const extractionReplay = new Map<string, { executionDigest: string; replayDigest: string; matched: true }>();
  const exactExtractionMechanics = new Map<string, ReturnType<typeof verifyExtractionFields>>();
  const statementSchema = admitExtractionSchema({
    schemaId: "diagnostics_source_statement",
    schemaVersion: "1",
    schema: {
      type: "object",
      description: "One selector-bound source statement.",
      properties: { statement: { type: "string", description: "Exact selected source statement.", maxLength: 2_000 } },
      required: ["statement"],
      additionalProperties: false,
    },
  }).schema;
  if (!statementSchema) throw new Error("DIAGNOSTICS_STATEMENT_SCHEMA_NOT_ADMITTED");
  for (const testCase of dataset.cases) {
    if (testCase.evidence.length === 0) {
      resolutions.set(testCase.caseId, { locatorValid: false, selectedText: "" });
      continue;
    }
    const evidence = testCase.evidence[0]!,
      capture = captureById.get(evidence.captureId);
    if (!capture) throw new Error(`DIAGNOSTICS_CAPTURE_BINDING_MISMATCH:${testCase.caseId}`);
    const hydrated = await admission.hydrateAdmittedProjection({
      tenantId: capture.capture.contentArtifact.tenantId,
      captureId: evidence.captureId,
      expectedSourceArtifact: {
        artifactId: capture.capture.contentArtifact.artifactId,
        digest: capture.capture.contentArtifact.digest as Digest,
      },
      transformationArtifactId: evidence.transformationArtifactId,
      projectionArtifactId: evidence.projectionArtifactId,
    });
    if (hydrated.receipt.projectionArtifact.digest !== evidence.projectionDigest)
      throw new Error(`DIAGNOSTICS_PROJECTION_BINDING_MISMATCH:${testCase.caseId}`);
    const content = hydrated.content;
    const resolved = projectionSelectorResolver.resolve({
      captureId: evidence.captureId,
      representationArtifactId: evidence.projectionArtifactId,
      representationDigest: evidence.projectionDigest,
      selector: evidence.selector,
      content,
    });
    const selectedText = new TextDecoder("utf8", { fatal: true }).decode(resolved.selectedContent);
    const locatorValid =
      resolved.resolution.status === "resolved" &&
      resolved.resolution.selectedContentDigest === evidence.selectedContentDigest &&
      bytesDigest(selectedText) === evidence.selectedContentDigest;
    if (locatorValid)
      adversarialObservations.push(
        verifyDiagnosticsAdversarialProjection({ testCase, receipt: hydrated.receipt, content: hydrated.content }),
      );
    const mutationPlans: readonly {
      caseId: string;
      family: DiagnosticsEngineeringMutation["family"];
      original: string;
      replacement: string;
    }[] = [
      {
        caseId: "gl-no-diagnosis-source",
        family: "names",
        original: "Generation Lab",
        replacement: "Invented Laboratory",
      },
      {
        caseId: "gl-triplicate-source",
        family: "biomarkers",
        original: "CpG biomarkers",
        replacement: "protein biomarkers",
      },
      { caseId: "tru-sites-source", family: "institutions", original: "Harvard", replacement: "Invented University" },
      {
        caseId: "pace-definition-source",
        family: "citations",
        original: "DunedinPACE",
        replacement: "Corrupted citation binding",
      },
    ];
    for (const plan of mutationPlans)
      if (locatorValid && plan.caseId === testCase.caseId)
        engineeringMutationInputs.push({
          ...plan,
          projection: { testCase, receipt: hydrated.receipt, content: hydrated.content },
        });
    resolutions.set(testCase.caseId, {
      locatorValid,
      selectedText,
      ...(resolved.resolution.selectedContentDigest === undefined
        ? {}
        : { selectedContentDigest: resolved.resolution.selectedContentDigest }),
    });
    exactExtractionMechanics.set(
      testCase.caseId,
      verifyExtractionFields({
        schema: statementSchema,
        candidate: { statement: selectedText },
        fields: [{ path: "/statement", comparison: "exact" }],
        evidence: [
          {
            path: "/statement",
            captureId: evidence.captureId,
            representationArtifactId: evidence.projectionArtifactId,
            representationDigest: hydrated.receipt.projectionArtifact.digest as Digest,
            selector: evidence.selector,
            expectedSelectedContentDigest: evidence.selectedContentDigest as Digest,
          },
        ],
        representations: [
          {
            captureId: evidence.captureId,
            artifactId: evidence.projectionArtifactId,
            digest: hydrated.receipt.projectionArtifact.digest as Digest,
            content,
          },
        ],
        selectorResolvers: [projectionSelectorResolver],
      }),
    );
    // The projection above has already passed the same native admission used by
    // verifyExtraction. Reuse those authenticated bytes for its core field verifier.
    extractionMechanics.set(
      testCase.caseId,
      verifyExtractionFields({
        schema: statementSchema,
        candidate: { statement: selectedText },
        fields: [{ path: "/statement", comparison: "normalized_text", normalizationId: "source-whitespace" }],
        normalizations: [{ id: "source-whitespace", operation: "ascii_whitespace_collapsed" }],
        evidence: [
          {
            path: "/statement",
            captureId: evidence.captureId,
            representationArtifactId: evidence.projectionArtifactId,
            representationDigest: hydrated.receipt.projectionArtifact.digest as Digest,
            selector: evidence.selector,
            expectedSelectedContentDigest: evidence.selectedContentDigest as Digest,
          },
        ],
        representations: [
          {
            captureId: evidence.captureId,
            artifactId: evidence.projectionArtifactId,
            digest: hydrated.receipt.projectionArtifact.digest as Digest,
            content,
          },
        ],
        selectorResolvers: [projectionSelectorResolver],
      }),
    );
    const replayArtifact = artifactById.get(evidence.projectionArtifactId);
    if (!replayArtifact) throw new Error("DIAGNOSTICS_EXTRACTION_REPLAY_ARTIFACT_REQUIRED");
    const replayBytes = await readFile(resolve(input.sourcePreparationDirectory, replayArtifact.file));
    if (
      replayBytes.byteLength !== replayArtifact.handle.byteLength ||
      bytesDigest(replayBytes) !== replayArtifact.handle.digest
    )
      throw new Error("DIAGNOSTICS_EXTRACTION_REPLAY_ARTIFACT_INTEGRITY");
    const exactReplayed = verifyExtractionFields({
      schema: statementSchema,
      candidate: { statement: selectedText },
      fields: [{ path: "/statement", comparison: "exact" }],
      evidence: [
        {
          path: "/statement",
          captureId: evidence.captureId,
          representationArtifactId: evidence.projectionArtifactId,
          representationDigest: hydrated.receipt.projectionArtifact.digest as Digest,
          selector: evidence.selector,
          expectedSelectedContentDigest: evidence.selectedContentDigest as Digest,
        },
      ],
      representations: [
        {
          captureId: evidence.captureId,
          artifactId: evidence.projectionArtifactId,
          digest: hydrated.receipt.projectionArtifact.digest as Digest,
          content: replayBytes,
        },
      ],
      selectorResolvers: [projectionSelectorResolver],
    });
    const normalizedReplayed = verifyExtractionFields({
      schema: statementSchema,
      candidate: { statement: selectedText },
      fields: [{ path: "/statement", comparison: "normalized_text", normalizationId: "source-whitespace" }],
      normalizations: [{ id: "source-whitespace", operation: "ascii_whitespace_collapsed" }],
      evidence: [
        {
          path: "/statement",
          captureId: evidence.captureId,
          representationArtifactId: evidence.projectionArtifactId,
          representationDigest: hydrated.receipt.projectionArtifact.digest as Digest,
          selector: evidence.selector,
          expectedSelectedContentDigest: evidence.selectedContentDigest as Digest,
        },
      ],
      representations: [
        {
          captureId: evidence.captureId,
          artifactId: evidence.projectionArtifactId,
          digest: hydrated.receipt.projectionArtifact.digest as Digest,
          content: replayBytes,
        },
      ],
      selectorResolvers: [projectionSelectorResolver],
    });
    const executionDigest = verificationBenchmarkDigest({
      exact: exactExtractionMechanics.get(testCase.caseId),
      normalized: extractionMechanics.get(testCase.caseId),
    });
    const replayDigest = verificationBenchmarkDigest({ exact: exactReplayed, normalized: normalizedReplayed });
    if (executionDigest !== replayDigest) throw new Error("DIAGNOSTICS_EXTRACTION_REPLAY_MISMATCH");
    extractionReplay.set(testCase.caseId, { executionDigest, replayDigest, matched: true });
  }
  const executeCompanyFields = async () =>
    Promise.all(
      (["tru-diagnostic", "generation-lab"] as const).map((companyId) => {
        const tenantId = preparationManifest.captures[0]?.capture.contentArtifact.tenantId;
        if (!tenantId) throw new Error("DIAGNOSTICS_COMPANY_TENANT_MISSING");
        return executeDiagnosticsCompanyFieldPlan({
          tenantId,
          companyId,
          dataset,
          captures: preparationManifest.captures,
          admission,
        });
      }),
    );
  const companyExecutions = await executeCompanyFields();
  const companyExecutionDigest = verificationBenchmarkDigest(companyExecutions);
  const companyReplayDigest = verificationBenchmarkDigest(await executeCompanyFields());
  if (companyExecutionDigest !== companyReplayDigest) throw new Error("DIAGNOSTICS_COMPANY_FIELDS_REPLAY_DRIFT");
  const companyFields = {
    schemaVersion: "diagnostics-company-fields.v1",
    datasetManifestDigest: dataset.manifestDigest,
    companies: companyExecutions,
    executionDigest: companyExecutionDigest,
    replayDigest: companyReplayDigest,
    replayMatched: true,
    externalRequests: 0,
    humanGoldScoringEligible: false,
  };
  const policyReplay = semanticReplay
    ? composeDiagnosticsPolicyReplay({
        replay: semanticReplay.results,
        runIdPrefix: input.runId,
        recordedAt: input.now(),
      })
    : undefined;
  const publicationCase = semanticReplay?.results.find((item) => item.caseId === "pace-definition-source");
  const publicationReadiness = publicationCase
    ? composeDiagnosticsPolicyReplay({
        replay: [publicationCase],
        runIdPrefix: `${input.runId}:publication`,
        recordedAt: input.now(),
        purpose: "publication_eligibility",
      })
    : undefined;
  await mkdir(input.outputDirectory, { recursive: true });
  const arms = diagnosticsBenchmarkArms().map((arm) =>
    arm.strategy === "baseline"
      ? {
          ...arm,
          name: "Offline lexical mechanics baseline",
          extractorProfile: "none-offline",
          judgeProfile: "lexical-mechanics.v1",
          configurationDigest: verificationBenchmarkDigest({
            armId: arm.armId,
            strategy: arm.strategy,
            extractorProfile: "none-offline",
            judgeProfile: "lexical-mechanics.v1",
            networkPolicy: "offline",
          }),
        }
      : arm,
  );
  const experiment = {
    datasetManifestDigest: dataset.manifestDigest,
    arms,
    networkPolicy: "offline",
    providerDispatches: 0,
    labelBoundary: "engineering_expectations_only",
  };
  const run = await runVerificationBenchmark({
    runId: input.runId,
    dataset,
    experimentDefinitionDigest: verificationBenchmarkDigest(experiment),
    arms,
    repetitions: 1,
    randomSeed: 207197,
    networkPolicy: "offline",
    checkpoints: new FileVerificationBenchmarkCheckpointStore(resolve(input.outputDirectory, "checkpoints")),
    now: input.now,
    execute: async ({ arm, testCase }) => {
      const resolution = resolutions.get(testCase.caseId)!;
      if (arm.strategy === "baseline")
        return inputOnlyBaseline(testCase, resolution.locatorValid, resolution.selectedText);
      return {
        schemaValid: false,
        locatorValid: resolution.locatorValid,
        fieldMechanics: false,
        support: "not_applicable",
        authority: "not_applicable",
        worldCorrectness: "unknown",
        policy: "abstain",
        confidence: null,
        confidenceCalibrated: false,
        failureClass: "provider",
        callAttributions: [],
      };
    },
  });
  const mutationReport = buildDiagnosticsMutationReport({ dataset, run, observations: adversarialObservations });
  const engineeringMutations = runDiagnosticsEngineeringMutations(engineeringMutationInputs);
  const metrics = summarizeVerificationBenchmark(dataset, run);
  const comparisonFamily = compareVerificationBenchmarkExperiment(dataset, run, "baseline", {
    seed: 207197,
    resamples: 2_000,
  });
  const comparisons = comparisonFamily.comparisons;
  const resultByArmCase = new Map(run.results.map((item) => [`${item.armId}:${item.caseId}`, item]));
  const claimLedger = dataset.cases.map((testCase) => ({
    caseId: testCase.caseId,
    assertion: testCase.assertion,
    assertionKind: testCase.tags.includes("literal") ? "source_statement" : "adversarial_claim",
    fragmentPaths: testCase.evidence.map((item) => ({
      fragmentId: item.fragmentId,
      captureId: item.captureId,
      selector: item.selector,
      selectedContentDigest: item.selectedContentDigest,
    })),
    expectation: testCase.expectation,
    armResults: arms.map((arm) => resultByArmCase.get(`${arm.armId}:${testCase.caseId}`)),
    humanGoldScoringEligible: false,
  }));
  const derivedFields = (caseId: string, text: string) => {
    const normalized = normalize(text),
      output: {
        field: string;
        value: string | number | boolean | null;
        derivation: string;
        status: "exact" | "normalized" | "failed";
      }[] = [];
    const range = /(\d)\s*[–-]\s*(\d)\s+weeks/iu.exec(normalized);
    if (caseId.startsWith("tru-turnaround")) {
      output.push(
        {
          field: "turnaround_min_weeks",
          value: range ? Number(range[1]) : null,
          derivation: "bounded regex from selector-verified statement",
          status: range ? "exact" : "failed",
        },
        {
          field: "turnaround_max_weeks",
          value: range ? Number(range[2]) : null,
          derivation: "bounded regex from selector-verified statement",
          status: range ? "exact" : "failed",
        },
        {
          field: "turnaround_start_event",
          value: /lab receives (?:the |your )?sample/iu.test(normalized) ? "lab_receives_sample" : null,
          derivation: "closed phrase map from selector-verified statement",
          status: /lab receives (?:the |your )?sample/iu.test(normalized) ? "normalized" : "failed",
        },
      );
    }
    if (caseId === "tru-sample-source")
      output.push({
        field: "sample_collection_type",
        value: /finger[- ]stick blood/iu.test(normalized) ? "finger_stick_blood" : null,
        derivation: "closed phrase map from selector-verified statement",
        status: /finger[- ]stick blood/iu.test(normalized) ? "normalized" : "failed",
      });
    for (const [id, field, pattern] of [
      ["tru-sites-source", "dna_methylation_site_lower_bound", /1,000,000\+/u],
      ["tru-biomarkers-source", "biomarker_lower_bound", /75\+/u],
    ] as const)
      if (caseId === id)
        output.push(
          {
            field,
            value: pattern.test(normalized) ? Number(normalized.match(pattern)![0].replace(/[, +]/gu, "")) : null,
            derivation: "literal plus-bound parser from selector-verified statement",
            status: pattern.test(normalized) ? "exact" : "failed",
          },
          {
            field: `${field}_inclusive_or_more`,
            value: pattern.test(normalized),
            derivation: "literal plus marker retained",
            status: pattern.test(normalized) ? "exact" : "failed",
          },
        );
    if (caseId === "tru-symphony-source")
      output.push(
        {
          field: "algorithm_name",
          value: /SymphonyAge™/u.test(normalized) ? "SymphonyAge™" : null,
          derivation: "case-sensitive token from selector-verified statement",
          status: /SymphonyAge™/u.test(normalized) ? "exact" : "failed",
        },
        {
          field: "organ_system_count",
          value: /11 organ systems/iu.test(normalized) ? 11 : null,
          derivation: "bounded count parser from selector-verified statement",
          status: /11 organ systems/iu.test(normalized) ? "exact" : "failed",
        },
      );
    return output;
  };
  const fieldLedger = dataset.cases.flatMap((testCase) =>
    testCase.evidence.map((item) => ({
      caseId: testCase.caseId,
      field: "source_statement",
      valueDigest: bytesDigest(resolutions.get(testCase.caseId)?.selectedText ?? ""),
      captureId: item.captureId,
      projectionArtifactId: item.projectionArtifactId,
      transformationArtifactId: item.transformationArtifactId,
      selector: item.selector,
      selectedContentDigest: item.selectedContentDigest,
      resolution: resolutions.get(testCase.caseId),
      extractionMechanics: extractionMechanics.get(testCase.caseId),
      exactExtractionMechanics: exactExtractionMechanics.get(testCase.caseId),
      replay: extractionReplay.get(testCase.caseId),
      derivedFields: derivedFields(testCase.caseId, resolutions.get(testCase.caseId)?.selectedText ?? ""),
      armMechanics: arms.map((arm) => ({
        armId: arm.armId,
        locatorValid: resultByArmCase.get(`${arm.armId}:${testCase.caseId}`)?.locatorValid,
        fieldMechanics: resultByArmCase.get(`${arm.armId}:${testCase.caseId}`)?.fieldMechanics,
      })),
    })),
  );
  const write = async (name: string, content: string | unknown) => {
    const body = typeof content === "string" ? content : encode(content);
    const path = resolve(input.outputDirectory, name);
    await writeFile(path, body, { flag: "wx" });
    return { name, digest: bytesDigest(body), bytes: Buffer.byteLength(body) };
  };
  const cite = (id: string) => {
    const item = dataset.cases.find((candidate) => candidate.caseId === id);
    if (!item) return `[case:${id}; unavailable:not included in this frozen dataset]`;
    const evidence = item.evidence[0];
    return evidence
      ? `[case:${id}; capture:${evidence.captureId}; fragment:${evidence.fragmentId}]`
      : `[case:${id}; fragment:unavailable]`;
  };
  const citations = dataset.cases.map((item) => ({ caseId: item.caseId, label: cite(item.caseId) }));
  const observedValue = <T extends keyof VerificationBenchmarkCaseResult>(id: string, key: T) => {
    const observed = resultByArmCase.get(`baseline:${id}`);
    return observed ? String(observed[key]) : "not included in this frozen dataset";
  };
  const reportResolutions = new Map<string, readonly DiagnosticsReportEvidenceResolution[]>(
    dataset.cases.map((testCase) => {
      const evidence = testCase.evidence[0],
        resolution = resolutions.get(testCase.caseId);
      return [
        testCase.caseId,
        evidence
          ? [
              {
                caseId: testCase.caseId,
                fragmentId: evidence.fragmentId,
                locatorValid: resolution?.locatorValid === true,
                ...(resolution?.selectedText === undefined ? {} : { selectedText: resolution.selectedText }),
                ...(resolution?.selectedContentDigest === undefined
                  ? {}
                  : { selectedContentDigest: resolution.selectedContentDigest as Digest }),
              },
            ]
          : [],
      ];
    }),
  );
  const heading = (
    headingId: Extract<DiagnosticsReportBlockInput, { kind: "heading" }>["headingId"],
  ): DiagnosticsReportBlockInput => ({ kind: "heading", headingId });
  const notice = (
    noticeId: Extract<DiagnosticsReportBlockInput, { kind: "notice" }>["noticeId"],
  ): DiagnosticsReportBlockInput => ({ kind: "notice", noticeId });
  const assertions = (...caseIds: string[]): DiagnosticsReportBlockInput[] =>
    caseIds.map((caseId) => ({ kind: "assertion", caseId }));
  const report = (reportId: string, blocks: readonly DiagnosticsReportBlockInput[]) => {
    const args = {
      reportId,
      datasetManifestDigest: dataset.manifestDigest as Digest,
      runManifestDigest: run.manifestDigest as Digest,
      dataset,
      resolutions: reportResolutions,
      blocks,
      appendixAnchor: "evidence-appendix.html#run-manifest",
      runManifestTarget: "run-ledger.json",
    };
    return auditDiagnosticsReportCoverage(args, buildDiagnosticsReportCoverage(args));
  };
  const intro = [
    heading("snapshot"),
    notice("frozen_snapshot"),
    notice("engineering_expectations_only"),
    notice("semantic_support_not_implied"),
    notice("informational_only"),
  ];
  const truReport = report("trudiagnostic-research-report", [
    heading("company_trudiagnostic"),
    ...intro,
    heading("product"),
    ...assertions("tru-sample-source"),
    heading("algorithms"),
    ...assertions("tru-symphony-source", "tru-omic-source", "tru-pace-source"),
    heading("biomarkers"),
    ...assertions("tru-sites-source", "tru-biomarkers-source"),
    heading("conflicts"),
    ...assertions("tru-turnaround-about-source", "tru-turnaround-product-source"),
    heading("science"),
    notice("applicability_unverified"),
    ...assertions("pace-definition-source", "pace-cohort-source", "noise-method-source"),
    heading("limitations"),
    notice("semantic_support_not_implied"),
    heading("unanswered"),
    notice("review_gated"),
  ]);
  const glReport = report("generation-lab-research-report", [
    heading("company_generation_lab"),
    ...intro,
    heading("product"),
    ...assertions("gl-systems-source"),
    heading("method"),
    ...assertions("gl-triplicate-source", "gl-repeatability-source"),
    heading("conflicts"),
    ...assertions("gl-historical-wording-source", "gl-same-page-footer-source"),
    heading("limitations"),
    ...assertions(
      "gl-no-diagnosis-source",
      "gl-consultation-source",
      "gl-informational-source",
      "gl-interested-comparison-source",
    ),
    heading("science"),
    notice("applicability_unverified"),
    heading("unanswered"),
    notice("review_gated"),
  ]);
  const comparisonReport = report("diagnostics-comparison-report", [
    heading("comparison"),
    ...intro,
    notice("comparison_scope"),
    heading("conflicts"),
    ...assertions(
      "tru-turnaround-about-source",
      "tru-turnaround-product-source",
      "gl-historical-wording-source",
      "gl-same-page-footer-source",
    ),
    heading("method"),
    ...assertions("gl-triplicate-source", "gl-repeatability-source"),
    heading("science"),
    notice("applicability_unverified"),
    ...assertions("pace-definition-source", "pace-cohort-source"),
    heading("limitations"),
    ...assertions("gl-interested-comparison-source"),
  ]);
  const reportCoverage = {
    schemaVersion: "diagnostics-mini-report-coverage.v1",
    datasetManifestDigest: dataset.manifestDigest,
    runManifestDigest: run.manifestDigest,
    reports: [truReport, glReport, comparisonReport],
    semanticVerificationComplete: false,
    humanGoldScoringEligible: false,
  };
  const retainedArtifacts = await Promise.all(
    preparationManifest.artifacts.map(async (item) => {
      const resolver = repository.createTrustedArtifactResolver();
      await resolver.authorizeArtifact({
        tenantId: item.handle.tenantId,
        artifactId: item.handle.artifactId,
        purpose: "verification_admission",
      });
      return resolver.hydrateRegisteredArtifact({ tenantId: item.handle.tenantId, artifactId: item.handle.artifactId });
    }),
  );
  const nativeLedgers = buildDiagnosticsOfflineLedgers({
    dataset,
    reports: reportCoverage.reports,
    captures: preparationManifest.captures,
    artifacts: retainedArtifacts,
  });
  const nativeVerification = await verifyDiagnosticsOfflineClaimsReportClosure({
    context: nativeLedgers.context,
    claims: nativeLedgers.claims,
    reports: nativeLedgers.reports,
    createDependencies: () => nativeLedgers.createDependencies(admission),
  });
  const generatedReportSemanticReplay = generatedReportFixture
    ? await replayDiagnosticsGeneratedReportSemanticFixture({
        fixture: generatedReportFixture,
        prepared: await prepareDiagnosticsReportSemanticReplayComposition({
          dataset,
          judgeIdentity: generatedReportFixture.judgeIdentity,
          sourceRunManifestDigest: generatedReportFixture.sourceRunManifestDigest,
          sourceLedger,
          captures: preparationManifest.captures,
          reports: reportCoverage.reports,
          nativeLedgers,
          nativeVerification,
          admission,
        }),
      })
    : undefined;
  const observedSemantic = (caseId: string) => {
    const record = semanticReplay?.results.find((item) => item.caseId === caseId);
    return record
      ? `${record.assessment.verdict}; disposition ${record.assessment.disposition}`
      : "unavailable: no captured semantic assessment";
  };
  const corruptedLocatorExample = adversarialObservations.find(
    (item) => item.caseId === "tru-sample-source",
  )?.corruptedLocator;
  const audit = `# Verification audit

Dataset: ${dataset.manifestDigest}

Run: ${run.manifestDigest}

Mode: offline deterministic replay from registered projection bytes; provider dispatches: 0. Provider arms record explicit unavailable failures. All score comparisons use engineering expectations and are ineligible for human-gold quality, calibration, clinical, or population claims.

## Observed paths

- Native exact field mechanics ${exactExtractionMechanics.get("tru-sample-source")?.valid ?? "unavailable"}; normalized field mechanics ${extractionMechanics.get("tru-sample-source")?.valid ?? "unavailable"}: ${cite("tru-sample-source")}
- Captured precise-citation entailment: ${observedSemantic("pace-definition-source")}: ${cite("pace-definition-source")}
- Captured missing-qualifier assessment: ${observedSemantic("tru-turnaround-product-mutated")}: ${cite("tru-turnaround-product-mutated")}
- Captured same-page conflict mutation: ${observedSemantic("gl-same-page-footer-mutated")}: ${cite("gl-same-page-footer-mutated")}
- Lexical promotional baseline: authority ${observedValue("gl-interested-comparison-source", "authority")}, policy ${observedValue("gl-interested-comparison-source", "policy")}; independent authority is not established by this baseline: ${cite("gl-interested-comparison-source")}
- Captured publication-overextension entailment: ${observedSemantic("pace-definition-mutated")}; commercial product applicability remains unassessed: ${cite("pace-definition-mutated")}
- Executed corrupted locator: ${corruptedLocatorExample?.evaluated ? (corruptedLocatorExample.valid ? "unexpectedly accepted" : `rejected (${corruptedLocatorExample.failedCheckCodes.join(", ")})`) : "unavailable"}; exact corrupted selector retained in adversarial-checks.json: ${cite("tru-sample-source")}
- Captured adversarial negation: ${observedSemantic("gl-no-diagnosis-mutated")}: ${cite("gl-no-diagnosis-mutated")}
- Publication eligibility: ${publicationReadiness?.cases[0]?.decision.outcome ?? "unavailable"}; ${publicationReadiness?.cases[0]?.decision.reasonCodes.join(", ") ?? "no retained semantic case"}. This is a separate policy eligibility check, not publication or a changed semantic verdict: ${cite("pace-definition-source")}
- Graph-without-selector pilot case ${observedValue("tru-pdf-graph-text-abstention", "policy")}: ${cite("tru-pdf-graph-text-abstention")}

## Metrics

\`\`\`json
${JSON.stringify(metrics, null, 2)}
\`\`\`
`;
  const appendixEntries = dataset.cases.map((testCase) => {
    const evidence = testCase.evidence[0],
      resolution = resolutions.get(testCase.caseId),
      baseline = resultByArmCase.get(`baseline:${testCase.caseId}`)!;
    return {
      caseId: testCase.caseId,
      assertion: testCase.assertion,
      semanticAssessment: semanticReplay?.results.find((item) => item.caseId === testCase.caseId)?.assessment ?? null,
      reportDiagnostics:
        generatedReportSemanticReplay?.results.filter((item) => item.assertionId === testCase.caseId) ?? [],
      verdict: { support: baseline.support, policy: baseline.policy, locatorValid: baseline.locatorValid },
      evidence: evidence
        ? {
            captureId: evidence.captureId,
            fragmentId: evidence.fragmentId,
            projectionArtifactId: evidence.projectionArtifactId,
            projectionDigest: evidence.projectionDigest,
            transformationArtifactId: evidence.transformationArtifactId,
            selector: evidence.selector,
            selectedContentDigest: evidence.selectedContentDigest,
          }
        : undefined,
      resolution: !evidence
        ? { status: "unavailable" as const, reason: "no_fragment_declared" as const }
        : resolution?.locatorValid === true
          ? { status: "resolved" as const, selectedText: resolution.selectedText }
          : { status: "unavailable" as const, reason: "selector_or_digest_mismatch" as const },
    };
  });
  const appendixHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Offline evidence appendix</title><style>body{font:16px system-ui;max-width:1000px;margin:2rem auto;padding:0 1rem;line-height:1.5}article{border-top:1px solid #ccc;padding:1rem 0}pre{white-space:pre-wrap;background:#f4f4f4;padding:1rem}</style></head><body><h1>Offline evidence appendix</h1><section id="run-manifest"><h2>Run manifest</h2><p>Run manifest digest: ${escapeHtml(run.manifestDigest)}</p><p><a href="run-ledger.json">Open run ledger JSON</a> · <a href="verification-audit.html">Back to verification audit</a></p></section>${appendixEntries.map((entry) => `<article id="${reportFragmentAnchor(entry.caseId)}"><h2>Case ${escapeHtml(entry.caseId)}</h2><dl><dt>Offline baseline result</dt><dd>support: ${escapeHtml(entry.verdict.support)}; policy: ${escapeHtml(entry.verdict.policy)}; locator valid: ${String(entry.verdict.locatorValid)}</dd>${entry.evidence ? `<dt>Capture</dt><dd>${escapeHtml(entry.evidence.captureId)}</dd><dt>Fragment</dt><dd>${escapeHtml(entry.evidence.fragmentId)}</dd><dt>Projection</dt><dd>${escapeHtml(entry.evidence.projectionArtifactId)}</dd><dt>Projection digest</dt><dd>${escapeHtml(entry.evidence.projectionDigest)}</dd><dt>Transformation</dt><dd>${escapeHtml(entry.evidence.transformationArtifactId)}</dd><dt>Selector</dt><dd><code>${escapeHtml(JSON.stringify(entry.evidence.selector))}</code></dd><dt>Selected content digest</dt><dd>${escapeHtml(entry.evidence.selectedContentDigest)}</dd>` : `<dt>Fragment</dt><dd>Unavailable: no fragment declared for this case.</dd>`}</dl>${entry.semanticAssessment ? `<h3>Recorded semantic assessment</h3><p>Verdict: ${escapeHtml(entry.semanticAssessment.verdict)}; disposition: ${escapeHtml(entry.semanticAssessment.disposition)}. <a href="semantic-replay.json">Open recorded assessment and fixture binding</a></p>` : ""}${entry.reportDiagnostics.length ? `<h3>Captured report assertion diagnostics</h3><ul>${entry.reportDiagnostics.map((item) => `<li>${escapeHtml(item.reportId)}: ${escapeHtml(item.assessment.verdict)}. Diagnostic only; report consistency failures remain enforced.</li>`).join("")}</ul><p><a href="report-semantic-replay.json">Open report assessments and original run binding</a></p>` : ""}${entry.resolution.status === "resolved" ? `<h3>Resolved selected fragment</h3><pre>${escapeHtml(entry.resolution.selectedText)}</pre>` : `<p>Selected fragment unavailable: ${escapeHtml(entry.resolution.reason)}.</p>`}<p><a href="#run-manifest">Back to run manifest</a> · <a href="verification-audit.html">Back to verification audit</a></p></article>`).join("")}</body></html>\n`;
  const selectorMismatches = dataset.cases
    .filter((item) => resolutions.get(item.caseId)?.locatorValid !== item.expectation.expectedLocatorValid)
    .map((item) => item.caseId);
  const observedConflictGroups = nativeVerification.reports.find(
    (item) => item.reportId === "diagnostics-comparison-report",
  )!.reportWide.consistencyMismatchGroups;
  const conflictsMeasured = [
    ["tru-turnaround-about-source", "tru-turnaround-product-source"],
    ["gl-historical-wording-source", "gl-same-page-footer-source"],
  ].every((pair) => observedConflictGroups.some((group) => pair.every((caseId) => group.includes(caseId))));
  const qualityGate = evaluateDiagnosticsFullDemoQualityGate({
    datasetManifestDigest: dataset.manifestDigest,
    runManifestDigest: run.manifestDigest,
    observations: [
      {
        gateId: "catalog_preparation_integrity",
        outcome: "passed",
        evidence: [dataset.manifestDigest, dataset.sourcePreparationDigest],
      },
      {
        gateId: "selector_resolution",
        outcome: selectorMismatches.length ? "failed" : "passed",
        evidence: [
          `${dataset.cases.length} actual selector outcomes compared with frozen engineering expectations`,
          `${selectorMismatches.length} mismatches; complete outcomes in field-ledger.json`,
        ],
      },
      {
        gateId: "extraction_verification",
        outcome: "unavailable",
        evidence: [
          "company-fields.json",
          `${extractionMechanics.size} source-statement extraction checks retained in field-ledger.json`,
        ],
        reason:
          "Bounded named fields now execute and replay through canonical extraction; complete structured-field and required provider-arm coverage remain unavailable.",
      },
      {
        gateId: "count_timeline_conflicts_visible",
        outcome: conflictsMeasured ? "passed" : "failed",
        evidence: [
          "native-verification.json",
          "claim-ledger.json",
          "trudiagnostic-research-report.md",
          "generation-lab-research-report.md",
        ],
        reason:
          "The native report consistency verifier compares both retained turnaround ranges and system counts; source wording remains separately visible.",
      },
      {
        gateId: "authority_and_applicability_boundaries",
        outcome: "unavailable",
        evidence: policyReplay ? ["policy-replay.json"] : ["run-ledger.json"],
        reason:
          "Conservative native policy withholding is recorded when retained semantic evidence exists; authoritative independent validation and publication applicability remain unestablished.",
      },
      {
        gateId: "adversarial_mutations",
        outcome:
          mutationReport.pairs.some((pair) =>
            pair.arms.some((arm) => Object.values(arm.comparison).includes("monotonicity_violation")),
          ) ||
          adversarialObservations.some(
            (item) =>
              !item.exactSource.valid ||
              item.selectedDigestTamper.valid ||
              (item.corruptedLocator.evaluated && item.corruptedLocator.valid),
          )
            ? "failed"
            : "unavailable",
        evidence: [`${adversarialObservations.length} real deterministic mutation records in adversarial-checks.json`],
        reason:
          "Actual paired lexical outcomes are retained in mutation-report.json; missing named families and unavailable semantic/provider comparisons prevent full mutation acceptance.",
      },
      {
        gateId: "report_generation_and_citations",
        outcome: "unavailable",
        evidence: ["report-coverage.json", "verification-audit.md"],
        reason:
          "Native claim/report verification and report-wide mechanical gates execute; full semantic verification and semantic citation correctness remain unavailable.",
      },
      {
        gateId: "deterministic_replay",
        outcome: "passed",
        evidence: [
          "field-ledger.json",
          "native-verification.json",
          ...(semanticReplay ? [semanticReplay.fixtureDigest] : []),
        ],
        reason:
          "Fresh source reads reproduce exact/normalized field outputs; fresh native services reproduce capture/selector checks, report-wide mechanical policy gates, and exact report/ledger handles. Unexecuted semantic/provider stages remain unavailable in their own gates.",
      },
      {
        gateId: "verdict_fragment_navigation",
        outcome: "unavailable",
        evidence: ["evidence-appendix.html"],
        reason:
          "Available captured claim/report verdicts link to local fragments; missing assessments prevent full required semantic coverage.",
      },
      {
        gateId: "offline_artifact_set",
        outcome: "passed",
        evidence: [
          "manifest.json",
          "Every required report and ledger file is re-read and hash/length checked before this result can be returned.",
        ],
      },
      {
        gateId: "provider_arm_execution",
        outcome: "unavailable",
        evidence: [
          `${run.results.filter((item) => item.failureClass === "provider").length} unavailable arm/case results in run-ledger.json`,
        ],
        reason: "Retained claim and report semantic assessments do not supply the required four paired provider arms.",
      },
      {
        gateId: "semantic_claim_report_coverage",
        outcome: "unavailable",
        evidence: [
          `${semanticReplay?.results.length ?? 0} retained claim assessments; ${generatedReportSemanticReplay?.results.length ?? 0} diagnostic report assertion replays; full report admission and quality acceptance incomplete`,
        ],
        reason: "Required claim/report verification coverage is incomplete.",
      },
      {
        gateId: "live_refresh_immutable_diff",
        outcome: "unavailable",
        evidence: [dataset.manifestDigest],
        reason:
          "Capture and immutable proposal diff are available; complete source coverage, fresh selector preparation, and a reviewed frozen successor remain unavailable.",
      },
    ],
  });
  const gateAudit = `\n## Full demonstration quality gate\n\nOutcome: ${qualityGate.outcome}; exit code: ${qualityGate.exitCode}. Reports are retained for inspection. No policy admission or human-label authority is changed.\n\n${qualityGate.gates.map((item) => `- ${item.gateId}: ${item.outcome}${item.reason ? ` — ${item.reason}` : ""}`).join("\n")}\n\n## Executed deterministic mutations\n\n${adversarialObservations.map((item) => `- ${item.caseId}: exact source ${item.exactSource.valid ? "accepted" : "rejected"}; corrupted locator ${item.corruptedLocator.evaluated ? (item.corruptedLocator.valid ? "unexpectedly accepted" : "rejected") : "unavailable"}; selected-digest tamper ${item.selectedDigestTamper.valid ? "unexpectedly accepted" : "rejected"}. ${cite(item.caseId)}`).join("\n")}\n\nAssertion-text equality is a mechanical check, not a semantic contradiction or qualifier judgment. See adversarial-checks.json for actual failed check codes and unsupported semantic paths.\n`;
  const pairedMutationAudit = `\n## Paired adversarial observations\n\n${mutationReport.counts.pairs} frozen original/mutated pairs across ${mutationReport.counts.arms} arms. The baseline is an offline lexical mechanics check; provider failures remain not measurable. Missing required claim-mutation families: ${mutationReport.missingFamilies.join(", ") || "none"}. Citation corruption mechanics are reported separately from semantic citation swaps.\n\n${mutationReport.pairs
    .map((pair) => {
      const result = pair.arms.find((arm) => arm.armId === "baseline")!;
      return `- ${pair.pairCluster}: support ${result.original.support} → ${result.mutated.support} (${result.comparison.support}); policy ${result.original.policy} → ${result.mutated.policy} (${result.comparison.policy}). ${cite(pair.original.caseId)} ${cite(pair.mutated.caseId)}`;
    })
    .join(
      "\n",
    )}\n\nUnpaired clusters: ${mutationReport.unpairedClusters.length}. Missing deterministic observations: ${mutationReport.missingObservationCaseIds.length}. Full per-arm results and immutable input references are retained in mutation-report.json; these observations do not establish semantic correctness or human-gold quality.\n`;
  const semanticPairResults = semanticReplay
    ? mutationReport.pairs.map((pair) => ({
        pairCluster: pair.pairCluster,
        originalCaseId: pair.original.caseId,
        mutatedCaseId: pair.mutated.caseId,
        original: semanticReplay.results.find((result) => result.caseId === pair.original.caseId)?.assessment ?? null,
        mutated: semanticReplay.results.find((result) => result.caseId === pair.mutated.caseId)?.assessment ?? null,
      }))
    : [];
  const nativeAudit = `\n## Native offline claim/report verification\n\nExecuted ${nativeVerification.claims.length} claim requests and ${nativeVerification.reports.length} generated reports through the production verifier. Fresh-service replay reproduced their deterministic outputs and exact report/ledger handles. See native-verification.json and native-ledger-artifacts.json. No semantic verdict or canonical database registration is implied.\n\nDerived named field/citation mutations: ${engineeringMutations.records.length} actual records in engineering-mutations.json; these are mechanical checks only.\n`;
  const reportSemanticAudit = generatedReportSemanticReplay
    ? `\n## Captured report assertion diagnostics\n\nReplayed ${generatedReportSemanticReplay.results.length} Luna assessments against the exact report and ledger handles. Original capture run: ${generatedReportSemanticReplay.sourceRunManifestDigest}. Current demo run: ${run.manifestDigest}. Fixture: ${generatedReportSemanticReplay.fixtureDigest}. Zero external requests. These are diagnostic assertion assessments: report-wide consistency failures remain enforced, with no human-gold or report admission promotion.\n\n${generatedReportSemanticReplay.results.map((item) => `- ${item.reportId} / ${item.assertionId}: ${item.assessment.verdict}. ${cite(item.assertionId)}`).join("\n")}\n`
    : "";
  const companyFieldAudit = `\n## Named company fields\n\n${companyExecutions.map((item) => `- ${item.plan.companyId}: ${item.plan.slots.reduce((total, slot) => total + slot.leaves.length, 0)} exact verified leaves across ${item.plan.slots.filter((slot) => slot.status === "available").length} populated field categories; ${item.plan.slots.filter((slot) => slot.status === "unavailable").length} categories explicitly unavailable.`).join("\n")}\n\nInspect company-fields.html or company-fields.json for as-stated values, normalized ranges/counts, units, qualifiers, source context, exact locators and conflict membership. A fresh execution reproduces the field-plan digest. This bounded deterministic extraction is not the full provider/gold field benchmark.\n`;
  const policyAudit = policyReplay
    ? `\n## Native policy execution and replay\n\n${policyReplay.cases.length} original authenticated claim assessments evaluated under ${policyReplay.policy.policyVersion}. This is a newly recorded conservative engineering policy, not historical approval or human gold. Original assertion identities are preserved. Independent corroboration and publication applicability remain unestablished. Exact policy and recorded-input bytes are retained in policy-replay.json.\n\n${policyReplay.cases.map((item) => `- ${item.caseId}: ${item.decision.outcome}; scope ${item.claimScope}; authority ${item.sourceAssessmentStatus.status}; independent corroboration ${item.sourceAssessmentStatus.independentCorroboration}; ${item.decision.reasonCodes.join(", ") || "no additional reasons"}. ${cite(item.caseId)}`).join("\n")}\n`
    : "";
  const auditWithReplay =
    audit +
    gateAudit +
    pairedMutationAudit +
    nativeAudit +
    reportSemanticAudit +
    companyFieldAudit +
    policyAudit +
    (semanticReplay
      ? `
## Captured semantic replay

Separately sealed fixture: ${semanticReplay.fixtureDigest}. Zero new provider calls. These recorded evidence-only assessments supplement the mechanics demonstration; the four-arm provider comparison remains unavailable.

Recorded assessments: ${semanticReplay.results.length} of ${dataset.cases.length} catalog cases. Cases without a replayable assessment: ${
          dataset.cases
            .filter((testCase) => !semanticReplay.results.some((result) => result.caseId === testCase.caseId))
            .map((testCase) => testCase.caseId)
            .join(", ") || "none"
        }. Missing assessments are not successful verification results.

${semanticReplay.results.map((item) => `- ${item.caseId}: ${item.assessment.verdict}. ${cite(item.caseId)}`).join("\n")}

### Recorded original/mutated semantic results

${semanticPairResults.map((pair) => `- ${pair.pairCluster}: ${pair.original?.verdict ?? "unavailable"} → ${pair.mutated?.verdict ?? "unavailable"}. ${cite(pair.originalCaseId)} ${cite(pair.mutatedCaseId)}`).join("\n")}

These are recorded verdict pairs, not calibrated accuracy or human-gold scores.
`
      : "");
  const tru = truReport.renderedMarkdown,
    gl = glReport.renderedMarkdown,
    comparison = comparisonReport.renderedMarkdown;
  const files: { name: string; digest: Digest; bytes: number }[] = [];
  files.push(
    await write("company-fields.json", companyFields),
    await write("company-fields.html", renderDiagnosticsCompanyFields(companyExecutions.map((item) => item.plan))),
  );
  if (policyReplay)
    files.push(
      await write("policy-replay.json", { ...policyReplay, publicationReadiness: publicationReadiness ?? null }),
    );
  files.push(
    await write("native-verification.json", nativeVerification),
    await write("native-ledger-artifacts.json", {
      schemaVersion: "diagnostics-offline-ledger-artifacts.v1",
      labelBoundary: "engineering_expectations_only",
      canonicalDatabaseRegistration: false,
      unavailableCaseIds: nativeLedgers.unavailableCaseIds,
      artifacts: nativeLedgers.artifacts
        .filter((item) => !artifactById.has(item.registration.artifactId))
        .map((item) => ({
          registration: item.registration,
          text: new TextDecoder("utf-8", { fatal: true }).decode(item.bytes),
        })),
    }),
  );
  files.push(
    await write("trudiagnostic-research-report.md", tru),
    await write("trudiagnostic-research-report.html", renderDiagnosticsOfflineReport(tru, citations)),
    await write("trudiagnostic-research-report.json", truReport),
  );
  files.push(
    await write("generation-lab-research-report.md", gl),
    await write("generation-lab-research-report.html", renderDiagnosticsOfflineReport(gl, citations)),
    await write("generation-lab-research-report.json", glReport),
  );
  files.push(
    await write("diagnostics-comparison-report.md", comparison),
    await write("diagnostics-comparison-report.html", renderDiagnosticsOfflineReport(comparison, citations)),
    await write("diagnostics-comparison-report.json", comparisonReport),
  );
  files.push(
    await write("verification-audit.md", auditWithReplay),
    await write(
      "verification-audit.html",
      renderDiagnosticsOfflineReport(auditWithReplay, citations).replace(
        "</body>",
        `${policyReplay ? '<p><a href="policy-replay.json">Exact policy execution and replay records</a></p>' : ""}</body>`,
      ),
    ),
    await write("verification-audit.json", {
      datasetManifestDigest: dataset.manifestDigest,
      runManifestDigest: run.manifestDigest,
      metrics,
      comparisonFamily,
      qualityGate,
      mutationReport,
      semanticPairResults,
      semanticReplay: semanticReplay ?? null,
      generatedReportSemanticReplay: generatedReportSemanticReplay ?? null,
      replay: { networkPolicy: "offline", deterministicStagesReplayed: true, providerStagesReplayed: false },
      limitations: [
        "No human gold labels",
        "No calibrated probabilities",
        "No production shadow traffic",
        "Only four source-family provenance clusters",
        "Provider arms are unavailable offline until recorded live outputs exist",
      ],
    }),
  );
  files.push(
    await write("evidence-appendix.html", appendixHtml),
    await write("evidence-appendix.json", {
      datasetManifestDigest: dataset.manifestDigest,
      runManifestDigest: run.manifestDigest,
      entries: appendixEntries,
    }),
  );
  files.push(
    await write("claim-ledger.json", claimLedger),
    await write("field-ledger.json", fieldLedger),
    await write("source-ledger.json", sourceLedger),
    await write("run-ledger.json", run),
    await write("metrics.json", { metrics, comparisons }),
  );
  files.push(
    await write("engineering-mutations.json", engineeringMutations),
    await write("mutation-report.json", mutationReport),
    await write("report-coverage.json", reportCoverage),
    await write("quality-gates.json", qualityGate),
    await write("adversarial-checks.json", {
      datasetManifestDigest: dataset.manifestDigest,
      runManifestDigest: run.manifestDigest,
      observations: adversarialObservations,
    }),
  );
  if (semanticReplay) files.push(await write("semantic-replay.json", semanticReplay));
  if (generatedReportSemanticReplay)
    files.push(
      await write("report-semantic-replay.json", {
        ...generatedReportSemanticReplay,
        currentRunManifestDigest: run.manifestDigest,
        reportAdmissionChanged: false,
      }),
    );
  const bundle = {
    schemaVersion: "diagnostics-verification-bundle.v1",
    datasetManifestDigest: dataset.manifestDigest,
    runManifestDigest: run.manifestDigest,
    files,
    lineage: dataset.cases.flatMap((item) =>
      item.evidence.map((evidence) => ({
        assertionId: item.caseId,
        captureId: evidence.captureId,
        fragmentId: evidence.fragmentId,
        resultIds: arms.map((arm) => `${arm.armId}:${item.caseId}`),
      })),
    ),
    sealedAt: input.now(),
  };
  const bundleFile = await write("verification-bundle.json", {
    ...bundle,
    bundleDigest: verificationBenchmarkDigest(bundle),
  });
  files.push(bundleFile);
  const manifestMaterial = {
    schemaVersion: "diagnostics-demo-output-manifest.v1",
    datasetManifestDigest: dataset.manifestDigest,
    runManifestDigest: run.manifestDigest,
    files,
  };
  const fileManifestDigest = verificationBenchmarkDigest(manifestMaterial),
    manifestFile = await write("manifest.json", { ...manifestMaterial, fileManifestDigest });
  files.push(manifestFile);
  const requiredFiles = [
    "trudiagnostic-research-report",
    "generation-lab-research-report",
    "diagnostics-comparison-report",
    "verification-audit",
  ].flatMap((name) => ["md", "html", "json"].map((extension) => `${name}.${extension}`));
  requiredFiles.push(
    "company-fields.json",
    "company-fields.html",
    "native-verification.json",
    "native-ledger-artifacts.json",
    "engineering-mutations.json",
    "mutation-report.json",
    "report-coverage.json",
    "evidence-appendix.html",
    "evidence-appendix.json",
    "claim-ledger.json",
    "field-ledger.json",
    "source-ledger.json",
    "run-ledger.json",
    "metrics.json",
    "quality-gates.json",
    "adversarial-checks.json",
    "verification-bundle.json",
    "manifest.json",
  );
  if (semanticReplay) requiredFiles.push("semantic-replay.json");
  if (policyReplay) requiredFiles.push("policy-replay.json");
  if (generatedReportSemanticReplay) requiredFiles.push("report-semantic-replay.json");
  if (
    files.length !== requiredFiles.length ||
    new Set(files.map((file) => file.name)).size !== requiredFiles.length ||
    requiredFiles.some((name) => !files.some((file) => file.name === name))
  )
    throw new Error("DIAGNOSTICS_OUTPUT_INVENTORY_INCOMPLETE");
  for (const file of files) {
    const bytes = await readFile(resolve(input.outputDirectory, file.name));
    if (bytes.byteLength !== file.bytes || bytesDigest(bytes) !== file.digest)
      throw new Error("DIAGNOSTICS_OUTPUT_FILE_INTEGRITY_FAILED");
  }
  return {
    outputDirectory: input.outputDirectory,
    run,
    fileManifestDigest,
    files,
    qualityGate,
    ...(semanticReplay ? { semanticReplay } : {}),
    ...(generatedReportSemanticReplay ? { generatedReportSemanticReplay } : {}),
  };
}
