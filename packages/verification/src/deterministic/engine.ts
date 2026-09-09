import {
  DeterministicVerificationResultSchema,
  VerificationBundleSchema,
  type DeterministicVerificationResult,
  type EvidenceEdge,
  type EvidenceMechanicalResult,
  type MetricMechanicalResult,
  type VerificationBundle,
  type VerificationCheck,
  type VerificationMetricObservation,
  type VerificationArtifactHandle,
} from "@aiengineer/knowledge-contracts";
import { digestCanonicalJson, sha256Digest } from "./canonical.js";
import { compareFractions, formatRoundedDecimal, parseDecimal, replayDecimalOperation, withinTolerance } from "./decimal.js";
import {
  resolveWithAdmittedResolver,
  type DeterministicSelection,
  type DeterministicSelectorResolver,
  type SelectorResolutionRequest,
} from "./selectors.js";

export interface HydratedVerificationArtifact {
  readonly artifactId: string;
  readonly content: Uint8Array | string;
}

export interface RuntimePrincipalBinding {
  readonly basis: "runtime_principal_binding";
  readonly producerDeploymentId: string;
  readonly verifierDeploymentId: string;
  readonly producerPrincipalDigest: `sha256:${string}`;
  readonly verifierPrincipalDigest: `sha256:${string}`;
}

export interface DeterministicVerificationInput {
  readonly bundle: VerificationBundle;
  readonly artifacts: readonly HydratedVerificationArtifact[];
  readonly runtimePrincipals: RuntimePrincipalBinding;
}

export interface DeterministicVerificationOptions {
  readonly selectorResolvers?: readonly DeterministicSelectorResolver[];
  /** Trusted application port backed by hydrated capture-specific transformation
   * envelopes. Never construct from serialized caller assertions. Byte identity
   * remains independently checked by this engine. */
  readonly isProjectionLineageAdmitted?: (binding: {
    readonly captureId: string;
    readonly sourceArtifact: VerificationArtifactHandle;
    readonly projectionArtifact: VerificationArtifactHandle;
  }) => boolean;
}

type Status = "passed" | "failed" | "review_required";
type EvidenceResult = {
  readonly contract: EvidenceMechanicalResult;
  readonly selection?: DeterministicSelection;
};

const bytes = (value: string | Uint8Array): Uint8Array => typeof value === "string" ? new TextEncoder().encode(value) : value;
const check = (code: string, status: Status, severity: "hard" | "review", detail: string, targetId?: string): VerificationCheck => ({
  code, status, deterministic: true, severity, detail, ...(targetId === undefined ? {} : { targetId }),
});
const combineStatus = (checks: readonly VerificationCheck[]): Status => checks.some((item) => item.status === "failed" && item.severity === "hard")
  ? "failed"
  : checks.some((item) => item.status === "review_required" || item.status === "failed") ? "review_required" : "passed";

function unresolvedEvidence(edge: EvidenceEdge, code: string, detail: string): EvidenceResult {
  const fragment = edge.fragment;
  return {
    contract: {
      evidenceId: edge.evidenceId,
      status: "failed",
      resolution: {
        captureId: fragment.captureId,
        representationArtifactId: fragment.representationArtifactId,
        representationDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        selectorDigest: digestCanonicalJson(fragment.selector),
        selectorKind: fragment.selector.kind,
        status: "invalid",
        occurrenceCount: 0,
        resolvedRanges: [],
        normalization: "none",
        resolverVersion: "verification-core.v1",
      },
      checks: [check(code, "failed", "hard", detail, edge.evidenceId)],
    },
  };
}

export function verifyDeterministicBundle(input: DeterministicVerificationInput, options: DeterministicVerificationOptions = {}): DeterministicVerificationResult {
  const bundle = VerificationBundleSchema.parse(input.bundle);
  const artifactPayloads = new Map(input.artifacts.map((artifact) => [artifact.artifactId, bytes(artifact.content)]));
  const sources = new Set(bundle.sources.map((source) => source.sourceId));
  const captures = new Map(bundle.captures.map((capture) => [capture.captureId, capture]));
  const captureChecks: VerificationCheck[] = [];
  const verifiedArtifacts = new Map<string, Uint8Array>();

  if (sources.size !== bundle.sources.length) captureChecks.push(check("SOURCE_IDS_UNIQUE", "failed", "hard", "Source IDs must be unique."));
  if (artifactPayloads.size !== input.artifacts.length) captureChecks.push(check("ARTIFACT_IDS_UNIQUE", "failed", "hard", "Hydrated artifact IDs must be unique."));
  if (captures.size !== bundle.captures.length) captureChecks.push(check("CAPTURE_IDS_UNIQUE", "failed", "hard", "Capture IDs must be unique."));
  for (const capture of bundle.captures) {
    const artifact = capture.contentArtifact;
    const content = artifactPayloads.get(artifact.artifactId);
    const sourcePresent = sources.has(capture.sourceId);
    captureChecks.push(check("CAPTURE_SOURCE_PRESENT", sourcePresent ? "passed" : "failed", "hard", sourcePresent ? `Capture ${capture.captureId} is bound to source ${capture.sourceId}.` : `Source ${capture.sourceId} is absent.`, capture.captureId));
    if (!content) {
      captureChecks.push(check("CAPTURE_ARTIFACT_PRESENT", "failed", "hard", `Artifact ${artifact.artifactId} is not hydrated.`, capture.captureId));
      continue;
    }
    captureChecks.push(check("CAPTURE_ARTIFACT_PRESENT", "passed", "hard", `Artifact ${artifact.artifactId} is hydrated.`, capture.captureId));
    const digestMatches = sha256Digest(content) === artifact.digest;
    captureChecks.push(check("CAPTURE_DIGEST_MATCH", digestMatches ? "passed" : "failed", "hard", digestMatches ? "Capture bytes match the registered digest." : "Capture bytes differ from the registered digest.", capture.captureId));
    const sizeMatches = artifact.byteLength === undefined || artifact.byteLength === content.byteLength;
    captureChecks.push(check("CAPTURE_BYTE_LENGTH_MATCH", sizeMatches ? "passed" : "failed", "hard", sizeMatches ? "Capture byte length matches." : `Expected ${artifact.byteLength} bytes; hydrated ${content.byteLength}.`, capture.captureId));
    if (digestMatches && sizeMatches) verifiedArtifacts.set(artifact.artifactId, content);
    const projection = capture.canonicalProjectionArtifact;
    if (projection) {
      const projectionContent = artifactPayloads.get(projection.artifactId);
      const projectionDigestMatches = projectionContent !== undefined && sha256Digest(projectionContent) === projection.digest;
      const projectionSizeMatches = projectionContent !== undefined && projectionContent.byteLength === projection.byteLength;
      const directParentBound = projection.parentArtifactIds.includes(artifact.artifactId) && projection.transformationSignature !== undefined;
      const envelopeBound = options.isProjectionLineageAdmitted?.({captureId:capture.captureId,sourceArtifact:artifact,projectionArtifact:projection}) === true;
      const parentBound = directParentBound || envelopeBound;
      captureChecks.push(check("PROJECTION_DIGEST_MATCH", projectionDigestMatches ? "passed" : "failed", "hard", projectionDigestMatches ? "Projection bytes match the registered digest." : "Projection is missing or changed.", capture.captureId));
      captureChecks.push(check("PROJECTION_BYTE_LENGTH_MATCH", projectionSizeMatches ? "passed" : "failed", "hard", projectionSizeMatches ? "Projection byte length matches." : "Projection byte length differs from its registration.", capture.captureId));
      captureChecks.push(check("PROJECTION_LINEAGE_BOUND", parentBound ? "passed" : "failed", "hard", envelopeBound ? "Trusted runtime admission binds the projection to its capture-specific transformation envelope." : directParentBound ? "Projection declares its capture parent and transformation signature." : "Projection lacks capture parent or transformation signature.", capture.captureId));
      if (projectionContent && projectionDigestMatches && projectionSizeMatches && parentBound) verifiedArtifacts.set(projection.artifactId, projectionContent);
    }
  }

  const producerMatches = input.runtimePrincipals.producerDeploymentId === bundle.producer.deploymentId;
  const verifierMatches = input.runtimePrincipals.verifierDeploymentId === bundle.verifier.deploymentId;
  const digestPattern = /^sha256:[a-f0-9]{64}$/;
  const principalDigestsWellFormed = digestPattern.test(input.runtimePrincipals.producerPrincipalDigest) && digestPattern.test(input.runtimePrincipals.verifierPrincipalDigest);
  const principalsAttested = principalDigestsWellFormed && input.runtimePrincipals.producerPrincipalDigest !== input.runtimePrincipals.verifierPrincipalDigest;
  const deploymentsDiffer = input.runtimePrincipals.producerDeploymentId !== input.runtimePrincipals.verifierDeploymentId;
  const separationEstablished = producerMatches && verifierMatches && principalsAttested && deploymentsDiffer;
  captureChecks.push(check("RUNTIME_PRINCIPAL_BINDING_MATCH", producerMatches && verifierMatches ? "passed" : "failed", "hard", "Bundle deployment declarations must match runtime principal bindings."));
  captureChecks.push(check("RUNTIME_PRINCIPAL_DIGESTS_VALID", principalDigestsWellFormed ? "passed" : "failed", "hard", "Runtime principal bindings require canonical SHA-256 digests."));
  captureChecks.push(check("PRODUCER_VERIFIER_INDEPENDENT", separationEstablished ? "passed" : "failed", "hard", separationEstablished ? "Producer and verifier runtime principals are distinct." : "Producer/verifier separation was not established from runtime principal bindings."));

  const verifyEvidence = (edge: EvidenceEdge): EvidenceResult => {
    const capture = captures.get(edge.fragment.captureId);
    if (!capture) return unresolvedEvidence(edge, "CAPTURE_PRESENT", `Capture ${edge.fragment.captureId} is missing.`);
    const handles = [capture.contentArtifact, ...(capture.canonicalProjectionArtifact ? [capture.canonicalProjectionArtifact] : [])];
    const handle = handles.find((artifact) => artifact.artifactId === edge.fragment.representationArtifactId);
    if (!handle) return unresolvedEvidence(edge, "REPRESENTATION_BOUND_TO_CAPTURE", `Artifact ${edge.fragment.representationArtifactId} is not a representation of capture ${capture.captureId}.`);
    const content = verifiedArtifacts.get(handle.artifactId);
    if (!content) return unresolvedEvidence(edge, "REPRESENTATION_ARTIFACT_VERIFIED", `Artifact ${handle.artifactId} did not pass digest and lineage checks.`);
    const request: SelectorResolutionRequest = {
      captureId: capture.captureId,
      representationArtifactId: handle.artifactId,
      representationDigest: handle.digest,
      selector: edge.fragment.selector,
      content,
    };
    const selection = resolveWithAdmittedResolver(request, options.selectorResolvers ?? []);
    if (!selection) return unresolvedEvidence(edge, "SELECTOR_RESOLVER_ADMITTED", `No admitted deterministic resolver handles ${edge.fragment.selector.kind}.`);
    const resolution = selection.resolution;
    const checks: VerificationCheck[] = [
      check("SELECTOR_CAPTURE_BOUND", resolution.captureId === capture.captureId ? "passed" : "failed", "hard", "Selector resolution must bind to the requested capture.", edge.evidenceId),
      check("SELECTOR_REPRESENTATION_BOUND", resolution.representationArtifactId === handle.artifactId && resolution.representationDigest === handle.digest ? "passed" : "failed", "hard", "Selector resolution must bind to verified representation bytes.", edge.evidenceId),
      check("SELECTOR_DEFINITION_BOUND", resolution.selectorDigest === digestCanonicalJson(edge.fragment.selector) ? "passed" : "failed", "hard", "Selector resolution must bind to the canonical selector definition.", edge.evidenceId),
      check("LOCATOR_UNIQUE", resolution.status === "resolved" && resolution.occurrenceCount === 1 ? "passed" : "failed", "hard", `Selector status is ${resolution.status} with ${resolution.occurrenceCount} occurrence(s).`, edge.evidenceId),
      check("SELECTED_CONTENT_DIGEST_REPLAYED", resolution.selectedContentDigest === sha256Digest(selection.selectedContent) ? "passed" : "failed", "hard", "Selected bytes must replay to the resolution digest.", edge.evidenceId),
      check("EXPECTED_SELECTED_CONTENT_DIGEST_MATCH", edge.expectedSelectedContentDigest === undefined || edge.expectedSelectedContentDigest === resolution.selectedContentDigest ? "passed" : "failed", "hard", "Resolved content must match the producer-declared evidence digest when supplied.", edge.evidenceId),
    ];
    if (edge.fragment.selector.kind === "text_quote" && edge.fragment.selector.normalization === "casefold_whitespace_filler_removed") {
      checks.push(check("LOSSY_TEXT_NORMALIZATION", "review_required", "review", "Filler removal and case folding require mechanical review.", edge.evidenceId));
    }
    return { contract: { evidenceId: edge.evidenceId, status: combineStatus(checks), resolution, checks }, selection };
  };

  const assertions = bundle.assertions.map((assertion) => {
    const evidence = assertion.evidence.map(verifyEvidence);
    const checks: VerificationCheck[] = [
      check("ASSERTION_PRODUCER_MATCH", assertion.producer.deploymentId === bundle.producer.deploymentId && assertion.producer.attemptId === bundle.producer.attemptId && assertion.producer.capabilityVersion === bundle.producer.capabilityVersion ? "passed" : "failed", "hard", "Assertion producer must match the bundle producer.", assertion.assertionId),
      check("RUNTIME_PRINCIPAL_BINDING_MATCH", producerMatches && verifierMatches ? "passed" : "failed", "hard", "Declared deployment IDs must match runtime principal bindings.", assertion.assertionId),
      check("PRODUCER_VERIFIER_INDEPENDENT", separationEstablished ? "passed" : "failed", "hard", separationEstablished ? "Producer and verifier runtime principals are distinct." : "Producer/verifier deployment separation was not established from runtime principal bindings.", assertion.assertionId),
      check("ASSERTION_ATOMIC", assertion.atomic ? "passed" : "failed", "hard", assertion.atomic ? "Assertion is atomic." : "Composite assertion requires decomposition.", assertion.assertionId),
      check("EVIDENCE_PRESENT", evidence.length > 0 ? "passed" : "failed", "hard", `${evidence.length} evidence reference(s) supplied.`, assertion.assertionId),
      check("EVIDENCE_MECHANICALLY_VALID", evidence.every((item) => item.contract.status === "passed") ? "passed" : evidence.some((item) => item.contract.status === "failed") ? "failed" : "review_required", "hard", "All evidence must pass deterministic resolution before semantics.", assertion.assertionId),
    ];
    const status = combineStatus([...checks, ...evidence.flatMap((item) => item.contract.checks)]);
    return { assertionId: assertion.assertionId, status, semanticEligibility: status === "passed", verdict: "pending_semantic_review" as const, evidence: evidence.map((item) => item.contract), checks };
  });

  const observations = new Map(bundle.metricObservations.map((metric) => [metric.observationId, metric]));
  if (observations.size !== bundle.metricObservations.length) captureChecks.push(check("OBSERVATION_IDS_UNIQUE", "failed", "hard", "Metric observation IDs must be unique."));
  const visitState = new Map<string, "visiting" | "visited">();
  const visitStack: string[] = [];
  const cyclicObservationIds = new Set<string>();
  const detectCycles = (observationId: string): void => {
    if (visitState.get(observationId) === "visited") return;
    if (visitState.get(observationId) === "visiting") {
      const cycleStart = visitStack.indexOf(observationId);
      for (const id of visitStack.slice(cycleStart)) cyclicObservationIds.add(id);
      return;
    }
    visitState.set(observationId, "visiting");
    visitStack.push(observationId);
    for (const operand of observations.get(observationId)?.calculation?.operands ?? []) if (observations.has(operand.observationId)) detectCycles(operand.observationId);
    visitStack.pop();
    visitState.set(observationId, "visited");
  };
  for (const observationId of observations.keys()) detectCycles(observationId);
  const metricResults = new Map<string, MetricMechanicalResult>();
  const resolveMetric = (observationId: string): MetricMechanicalResult | undefined => {
    const cached = metricResults.get(observationId);
    if (cached) return cached;
    const metric = observations.get(observationId);
    if (!metric) return undefined;
    const result = verifyMetric(metric, verifyEvidence, separationEstablished, observations, resolveMetric, cyclicObservationIds.has(observationId));
    metricResults.set(observationId, result);
    return result;
  };
  const metrics = bundle.metricObservations.map((metric) => resolveMetric(metric.observationId)!);
  const allChecks = [...captureChecks, ...assertions.flatMap((item) => [...item.checks, ...item.evidence.flatMap((edge) => edge.checks)]), ...metrics.flatMap((item) => item.checks)];
  const status = combineStatus(allChecks);
  const semanticEligibility = status === "passed" && assertions.every((item) => item.semanticEligibility) && metrics.every((item) => item.semanticEligibility);
  const failedCheckCodes = [...new Set(allChecks.filter((item) => item.status === "failed").map((item) => item.code))].sort();
  const reviewReasons = [...new Set(allChecks.filter((item) => item.status === "review_required").map((item) => item.detail))].sort();
  return DeterministicVerificationResultSchema.parse({
    verificationContractVersion: "verification.v1",
    status,
    semanticEligibility,
    deploymentSeparation: {
      status: separationEstablished ? "established" : "not_established",
      basis: "runtime_principal_binding",
      producerDeploymentId: input.runtimePrincipals.producerDeploymentId,
      verifierDeploymentId: input.runtimePrincipals.verifierDeploymentId,
    },
    captureChecks,
    assertions,
    metrics,
    summary: {
      capturesTotal: bundle.captures.length,
      capturesPassed: bundle.captures.filter((capture) => verifiedArtifacts.has(capture.contentArtifact.artifactId)).length,
      assertionsTotal: assertions.length,
      assertionsPassed: assertions.filter((item) => item.status === "passed").length,
      metricsTotal: metrics.length,
      metricsPassed: metrics.filter((item) => item.status === "passed").length,
      failedCheckCodes,
      reviewReasons,
    },
  });
}

function verifyMetric(
  metric: VerificationMetricObservation,
  verifyEvidence: (edge: EvidenceEdge) => EvidenceResult,
  separationEstablished: boolean,
  observations: ReadonlyMap<string, VerificationMetricObservation>,
  resolveMetric: (observationId: string) => MetricMechanicalResult | undefined,
  cyclic: boolean,
): MetricMechanicalResult {
  const evidence = new Map(metric.evidence.map((edge) => [edge.evidenceId, verifyEvidence(edge)]));
  const checks: VerificationCheck[] = [];
  checks.push(check("PRODUCER_VERIFIER_INDEPENDENT", separationEstablished ? "passed" : "failed", "hard", separationEstablished ? "Metric producer and verifier are separated." : "Metric deployment separation is not established.", metric.observationId));
  checks.push(check("ENTITY_ID_EXPLICIT", metric.entity.canonicalId.trim() && metric.entity.label.trim() ? "passed" : "failed", "hard", `Entity is ${metric.entity.kind}:${metric.entity.canonicalId}.`, metric.observationId));
  let canonicalValueValid = true;
  try { parseDecimal(metric.canonicalValue); } catch { canonicalValueValid = false; }
  checks.push(check("CANONICAL_NUMBER_VALID", canonicalValueValid ? "passed" : "failed", "hard", `Canonical value is ${metric.canonicalValue}.`, metric.observationId));
  let unitValid = true;
  try { unitValid = compareFractions(parseDecimal(metric.unit.scaleToCanonical), parseDecimal("0")) > 0; } catch { unitValid = false; }
  checks.push(check("UNIT_EXPLICIT_AND_VALID", unitValid ? "passed" : "failed", "hard", `Unit is ${metric.unit.symbol} (${metric.unit.dimension}).`, metric.observationId));
  const periodValid = metric.period.start === undefined || metric.period.end === undefined || Date.parse(metric.period.start) <= Date.parse(metric.period.end);
  checks.push(check("OBSERVATION_PERIOD_VALID", periodValid ? "passed" : "failed", "hard", periodValid ? "Observation period is ordered." : "Observation period ends before it starts.", metric.observationId));
  checks.push(check("COMPARABILITY_GROUP_PRESENT", metric.comparabilityGroup.trim() ? "passed" : "failed", "hard", `Comparability group is ${metric.comparabilityGroup}.`, metric.observationId));
  for (const binding of metric.evidenceBindings) {
    const evidenceResult = evidence.get(binding.evidenceId);
    const expectedFacetLiteral = binding.facet === "value" ? metric.canonicalValue
      : binding.facet === "unit" ? metric.unit.symbol
      : binding.facet === "identity" ? [metric.entity.canonicalId, metric.entity.label]
      : binding.facet === "period_start" ? metric.period.start
      : metric.period.end;
    const declarationMatches = Array.isArray(expectedFacetLiteral) ? expectedFacetLiteral.includes(binding.expectedLiteral) : expectedFacetLiteral === binding.expectedLiteral;
    checks.push(check("METRIC_BINDING_DECLARATION_MATCH", declarationMatches ? "passed" : "failed", "hard", `${binding.facet} binding must match the canonical observation.`, metric.observationId));
    const selected = evidenceResult?.selection;
    const rawSelected = selected?.selectedValue ?? selected?.selectedText;
    let sourceMatches = false;
    if (rawSelected !== undefined) {
      const selectedLiteral = typeof rawSelected === "string" ? rawSelected.trim() : String(rawSelected);
      if (binding.comparison === "decimal") {
        try { sourceMatches = compareFractions(parseDecimal(selectedLiteral), parseDecimal(binding.expectedLiteral)) === 0; } catch { sourceMatches = false; }
      } else if (binding.comparison === "iso_datetime") {
        sourceMatches = Number.isFinite(Date.parse(selectedLiteral)) && Date.parse(selectedLiteral) === Date.parse(binding.expectedLiteral);
      } else sourceMatches = selectedLiteral === binding.expectedLiteral;
    }
    checks.push(check("METRIC_FACET_SOURCE_BOUND", evidenceResult?.contract.status === "passed" && sourceMatches ? "passed" : "failed", "hard", `${binding.facet} must resolve from verified source bytes to ${binding.expectedLiteral}.`, metric.observationId));
  }
  let replayedValue: string | undefined;
  if (metric.calculation) {
    checks.push(check("CALCULATION_GRAPH_ACYCLIC", cyclic ? "failed" : "passed", "hard", cyclic ? "Calculation dependency graph contains a cycle." : "Calculation dependency graph is acyclic.", metric.observationId));
    for (const operand of metric.calculation.operands) {
      const referenced = observations.get(operand.observationId);
      const referencedResult = cyclic ? undefined : resolveMetric(operand.observationId);
      checks.push(check("CALCULATION_OPERAND_PRESENT", referenced ? "passed" : "failed", "hard", referenced ? `Operand ${operand.observationId} exists.` : `Operand ${operand.observationId} is missing.`, metric.observationId));
      let valueMatches = false;
      if (referenced) {
        try { valueMatches = compareFractions(parseDecimal(operand.value), parseDecimal(referenced.canonicalValue)) === 0; } catch { valueMatches = false; }
      }
      checks.push(check("CALCULATION_OPERAND_VALUE_BOUND", valueMatches ? "passed" : "failed", "hard", referenced ? `Operand ${operand.observationId} must equal its canonical observation value.` : "A missing operand cannot bind a value.", metric.observationId));
      checks.push(check("CALCULATION_OPERAND_VERIFIED", referencedResult?.status === "passed" ? "passed" : "failed", "hard", referencedResult?.status === "passed" ? `Operand ${operand.observationId} passed deterministic verification.` : `Operand ${operand.observationId} is not mechanically eligible.`, metric.observationId));
    }
    try {
      const replayed = replayDecimalOperation(metric.calculation.operation, metric.calculation.operands.map((operand) => operand.value));
      replayedValue = formatRoundedDecimal(replayed, metric.calculation.rounding.decimalPlaces, metric.calculation.rounding.mode);
      const expected = parseDecimal(metric.calculation.expectedResult);
      const tolerance = parseDecimal(metric.calculation.tolerance);
      const replayMatches = withinTolerance(parseDecimal(replayedValue), expected, tolerance);
      const observationMatches = withinTolerance(parseDecimal(metric.canonicalValue), expected, tolerance);
      checks.push(check("CALCULATION_REPLAYS", replayMatches ? "passed" : "failed", "hard", `Replayed result is ${replayedValue}; expected ${metric.calculation.expectedResult}.`, metric.observationId));
      checks.push(check("OBSERVED_VALUE_MATCHES_CALCULATION", observationMatches ? "passed" : "failed", "hard", `Observed value is ${metric.canonicalValue}.`, metric.observationId));
    } catch (error) {
      checks.push(check("CALCULATION_REPLAYS", "failed", "hard", error instanceof Error ? error.message : "Calculation replay failed.", metric.observationId));
    }
  } else checks.push(check("DIRECT_OBSERVATION_DECLARED", "passed", "hard", "Metric is a source-bound direct observation.", metric.observationId));
  const status = combineStatus(checks);
  return { observationId: metric.observationId, status, semanticEligibility: status === "passed", checks, ...(replayedValue === undefined ? {} : { replayedValue }) };
}
