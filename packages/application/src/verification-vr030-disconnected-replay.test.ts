import type { VerificationArtifactHandle, VerificationPolicyDefinition, VerificationRecordedPolicyInputs, VerificationRunManifest } from "@aiengineer/knowledge-contracts";
import { canonicalizeJson, digestCanonicalJson, sealAuditBundle, sha256Digest, verificationManifestDigest, verifyDeterministicBundle, type DeterministicVerificationInput, type RuntimePrincipalBinding, type VerificationAuditBundle } from "@aiengineer/knowledge-verification";
import { describe, expect, it } from "vitest";
import { admitExtractionSchema, projectionSelectorResolver, verifyExtractionFields, type DeterministicSelectorResolver } from "@aiengineer/knowledge-verification";
import { ObservationPeriodSchema } from "@aiengineer/knowledge-contracts";
import { replayVerificationAudit } from "./verification-replay.js";

/**
 * Disconnected VR-030 replay proof.  It intentionally covers the two retained
 * retained selector, scalar-comparison, calculation, and period fixtures.
 * The audit-bundle replay path natively represents selectors, calculations, and
 * metric periods; scalar extraction comparisons are re-resolved from the same
 * immutable full-handle bytes by the supported extraction verifier.
 */
const fixtureUrl = new URL("../../verification/src/deterministic/testing/prototype-parity.fixture.js", import.meta.url).href;
const tenantId = "11111111-1111-4111-8111-111111111111";
const createdAt = "2026-09-08T00:00:00.000Z";
const encoder = new TextEncoder();

type Prototype = {
  prototypeClaimInput(): DeterministicVerificationInput;
  prototypeMetricInput(): DeterministicVerificationInput;
  runtimePrincipals: RuntimePrincipalBinding;
};

type Stored = { registration: VerificationArtifactHandle; bytes: Uint8Array };

function handle(artifactId: string, bytes: Uint8Array): VerificationArtifactHandle {
  const digest = sha256Digest(bytes);
  return {
    artifactId, tenantId, digest, mediaType: "application/json", byteLength: bytes.byteLength,
    objectKey: `${tenantId}/${digest.slice(7, 9)}/${digest.slice(7)}`,
    createdAt, producerActivityId: "vr030-proof", producerVersion: "v1",
    encryptionClass: "managed", retentionClass: "audit", dataClassification: "restricted", parentArtifactIds: [],
  };
}

async function sealed(input: DeterministicVerificationInput, kind: "claim" | "metric", selectorResolvers?: readonly DeterministicSelectorResolver[]) {
  const deterministicResult = verifyDeterministicBundle(input, selectorResolvers ? { selectorResolvers } : undefined);
  const source = input.bundle.captures[0]!.contentArtifact;
  const policy: VerificationPolicyDefinition = {
    schemaVersion: "verification-policy.v1", policyVersion: input.bundle.policyVersion,
    definitionId: `vr030-${kind}`, criticalDownstreamUses: [], requireCrossFamilyForRisk: [],
    requireIndependentAuthorityForScopes: [], mixedEvidenceOutcome: "review", unknownCriticalOutcome: "review",
    authorityWithheldOutcome: "review", reviewAvailable: true,
  };
  const policyBytes = encoder.encode(canonicalizeJson(policy));
  const policyArtifact = handle("55555555-5555-4555-8555-555555555555", policyBytes);
  const recorded: VerificationRecordedPolicyInputs = {
    schemaVersion: "verification-policy-inputs.v1", policyVersion: policy.policyVersion, runId: `vr030-${kind}-run`, recordedAt: createdAt,
    deterministicResult,
    assertions: input.bundle.assertions.map((assertion) => ({
      assertionId: assertion.assertionId, riskClass: assertion.riskClass, downstreamUse: [...assertion.downstreamUse],
      claimScope: "descriptive_fact", semantic: {
        assertionId: assertion.assertionId, verdict: "pending_semantic_review", disposition: "review", evidenceSupport: "not_assessed",
        worldCorrectness: "not_assessed", attributionFaithfulness: "not_assessed", sourceAuthority: "not_assessed", provenanceIntegrity: "satisfied",
        judgeIdentities: [], supportingFragmentIds: [], contradictingFragmentIds: [], unsupportedFacets: [], reasonCodes: [], crossFamilySecondJudge: false, rawProviderConfidences: [],
      }, authorityStatus: "unknown", independentCorroboration: false, conflictPresent: false, criticalFactsKnown: true,
    })),
    metrics: input.bundle.metricObservations.map((metric) => ({ observationId: metric.observationId, riskClass: "low", downstreamUse: ["internal_research"], criticalFactsKnown: true, conflictPresent: false })),
    sourceAssessments: [],
  };
  const recordedBytes = encoder.encode(canonicalizeJson(recorded));
  const recordedArtifact = handle("66666666-6666-4666-8666-666666666666", recordedBytes);
  const { replayVerificationPolicy } = await import("@aiengineer/knowledge-policy");
  const decision = replayVerificationPolicy({ policyVersion: policy.policyVersion, policyBytes, recordedPolicyInputsBytes: recordedBytes }).decision;
  const manifest: VerificationRunManifest = {
    verificationContractVersion: "verification.v1", manifestId: `vr030-${kind}-manifest`, runId: recorded.runId,
    versions: { policy: policy.policyVersion, schema: "verification.v1", normalizer: "RFC8785.v1" },
    code: { gitSha: "vr030-disconnected", dirty: false }, runtime: { platform: "test", deploymentId: input.bundle.verifier.deploymentId },
    inputArtifacts: [...input.bundle.captures.flatMap((capture) => [capture.contentArtifact, ...(capture.canonicalProjectionArtifact ? [capture.canonicalProjectionArtifact] : [])]), policyArtifact, recordedArtifact], outputArtifacts: [], stages: [{ name: "verify", status: "succeeded", startedAt: createdAt, endedAt: createdAt }],
    calls: [], toolPolicy: [], networkPolicy: "disabled", deterministicResult, judgments: [], policyOutcome: decision.outcome,
    resultDigest: digestCanonicalJson(deterministicResult), lineage: input.bundle.captures.flatMap((capture) => capture.canonicalProjectionArtifact ? [{ edgeId: `vr030-${capture.captureId}`, fromArtifactId: capture.canonicalProjectionArtifact.artifactId, toArtifactId: capture.contentArtifact.artifactId, relation: "generated", activityId: "vr030-projection", activityVersion: "v1" }] : []), canonicalization: { algorithm: "RFC8785", implementationVersion: "knowledge-verification.v1", manifestDigest: sha256Digest("") },
    startedAt: createdAt, completedAt: createdAt,
  };
  manifest.canonicalization.manifestDigest = verificationManifestDigest(manifest);
  const audit = await sealAuditBundle({ tenantId, verificationBundle: input.bundle, manifest,
    policyBinding: { policyVersion: policy.policyVersion, policyArtifact, recordedPolicyInputsArtifact: recordedArtifact }, recordedPolicyInputsBytes: recordedBytes, policyDecision: decision });
  const values = new Map<string, Stored>();
  for (const capture of input.bundle.captures) for (const artifact of [capture.contentArtifact, ...(capture.canonicalProjectionArtifact ? [capture.canonicalProjectionArtifact] : [])]) {
    const material = input.artifacts.find((item) => item.artifactId === artifact.artifactId);
    if (!material) throw new Error("VR030_CAPTURE_MATERIAL_MISSING");
    values.set(artifact.artifactId, { registration: artifact, bytes: typeof material.content === "string" ? encoder.encode(material.content) : material.content.slice() });
  }
  values.set(policyArtifact.artifactId, { registration: policyArtifact, bytes: policyBytes });
  values.set(recordedArtifact.artifactId, { registration: recordedArtifact, bytes: recordedBytes });
  return { audit, values, runtimePrincipals: input.runtimePrincipals, source, policyArtifact, recordedArtifact, selectorResolvers };
}

function resolver(values: Map<string, Stored>, mutate?: (artifactId: string, bytes: Uint8Array) => Uint8Array) {
  const authorized = new Set<string>();
  return {
    async authorizeArtifact({ artifactId }: { artifactId: string }) { authorized.add(artifactId); },
    async hydrateRegisteredArtifact({ artifactId }: { artifactId: string }) {
      if (!authorized.delete(artifactId)) throw new Error("VR030_UNAUTHORIZED_HYDRATE");
      const stored = values.get(artifactId);
      if (!stored) throw new Error("VR030_MISSING_ARTIFACT");
      return { registration: structuredClone(stored.registration), bytes: (mutate ? mutate(artifactId, stored.bytes.slice()) : stored.bytes.slice()) };
    },
  };
}

async function expectReject(audit: VerificationAuditBundle, values: Map<string, Stored>, principals: RuntimePrincipalBinding, mutate: (artifactId: string, bytes: Uint8Array) => Uint8Array) {
  await expect(replayVerificationAudit(audit, { artifactResolver: resolver(values, mutate), runtimePrincipals: principals })).rejects.toThrow();
}

describe("VR-030 disconnected sealed-bundle replay", () => {
  it("replays retained claim-selector and metric-calculation bundles using actual immutable policy evaluation", async () => {
    const prototype = await import(fixtureUrl) as Prototype;
    for (const [kind, input] of [["claim", prototype.prototypeClaimInput()], ["metric", prototype.prototypeMetricInput()]] as const) {
      const value = await sealed(input, kind);
      const replay = await replayVerificationAudit(value.audit, { artifactResolver: resolver(value.values), runtimePrincipals: value.runtimePrincipals });
      expect(replay.deterministicResultDigest).toBe(value.audit.deterministicResultDigest);
      expect(replay.policyOutcome).toBe(value.audit.manifest.policyOutcome);
      expect(replay.replayedArtifactIds).toEqual(expect.arrayContaining([value.source.artifactId, value.policyArtifact.artifactId, value.recordedArtifact.artifactId]));
    }
  });

  it("rejects changed source bytes, selector binding, calculation input, and policy bytes before accepting a replay", async () => {
    const prototype = await import(fixtureUrl) as Prototype;
    const claim = await sealed(prototype.prototypeClaimInput(), "claim");
    await expectReject(claim.audit, claim.values, claim.runtimePrincipals, (id, bytes) => id === claim.source.artifactId ? encoder.encode("changed source bytes") : bytes);

    const changedSelector = structuredClone(claim.audit);
    changedSelector.verificationBundle.assertions[0]!.evidence[0]!.fragment.selector = { kind: "text_quote", quote: "different selected text", normalization: "none" };
    await expect(replayVerificationAudit(changedSelector, { artifactResolver: resolver(claim.values), runtimePrincipals: claim.runtimePrincipals })).rejects.toThrow(/AUDIT_BUNDLE_INVALID|DETERMINISTIC_REPLAY_DRIFT/);

    const metric = await sealed(prototype.prototypeMetricInput(), "metric");
    await expectReject(metric.audit, metric.values, metric.runtimePrincipals, (id, bytes) => id === metric.source.artifactId ? encoder.encode(String(new TextDecoder().decode(bytes)).replace("\"total\":25", "\"total\":26")) : bytes);
    await expectReject(metric.audit, metric.values, metric.runtimePrincipals, (id, bytes) => id === metric.policyArtifact.artifactId ? encoder.encode(canonicalizeJson({ schemaVersion: "verification-policy.v1", policyVersion: metric.audit.policyBinding.policyVersion, definitionId: "tampered", criticalDownstreamUses: [], requireCrossFamilyForRisk: [], requireIndependentAuthorityForScopes: [], mixedEvidenceOutcome: "review", unknownCriticalOutcome: "review", authorityWithheldOutcome: "review", reviewAvailable: true })) : bytes);
  });
});
function makeOperationMetric(prototype: Prototype, operation: "identity" | "sum" | "difference" | "product" | "ratio" | "percent_change") {
  const input = structuredClone(prototype.prototypeMetricInput()) as DeterministicVerificationInput & { artifacts: Array<{ artifactId: string; content: string | Uint8Array }> };
  const values = operation === "identity" ? { left: "6", right: "4", result: "6", operands: [{ observationId: "npm-downloads-day-1", value: "6" }] }
    : operation === "sum" ? { left: "6", right: "4", result: "10", operands: [{ observationId: "npm-downloads-day-1", value: "6" }, { observationId: "npm-downloads-day-2", value: "4" }] }
      : operation === "difference" ? { left: "6", right: "4", result: "2", operands: [{ observationId: "npm-downloads-day-1", value: "6" }, { observationId: "npm-downloads-day-2", value: "4" }] }
        : operation === "product" ? { left: "6", right: "4", result: "24", operands: [{ observationId: "npm-downloads-day-1", value: "6" }, { observationId: "npm-downloads-day-2", value: "4" }] }
          : operation === "ratio" ? { left: "6", right: "4", result: "1.5", operands: [{ observationId: "npm-downloads-day-1", value: "6" }, { observationId: "npm-downloads-day-2", value: "4" }] }
            : { left: "6", right: "4", result: "50", operands: [{ observationId: "npm-downloads-day-2", value: "4" }, { observationId: "npm-downloads-day-1", value: "6" }] };
  const source = JSON.parse(String(input.artifacts[0]!.content)) as Record<string, unknown>;
  source.day1 = Number(values.left); source.day2 = Number(values.right); source.total = Number(values.result);
  const sourceBytes = encoder.encode(JSON.stringify(source));
  input.artifacts[0]!.content = new TextDecoder().decode(sourceBytes);
  const capture = input.bundle.captures[0]!.contentArtifact;
  capture.digest = sha256Digest(sourceBytes); capture.byteLength = sourceBytes.byteLength;
  const metrics = input.bundle.metricObservations;
  const bind = (metricIndex: number, value: string, evidenceId: string) => {
    const metric = metrics[metricIndex]!;
    metric.rawValue = Number(value); metric.canonicalValue = value;
    metric.evidence.find((edge) => edge.evidenceId === evidenceId)!.expectedSelectedContentDigest = sha256Digest(value);
    metric.evidenceBindings.find((binding) => binding.facet === "value")!.expectedLiteral = value;
  };
  bind(0, values.left, "value-day1"); bind(1, values.right, "value-day2"); bind(2, values.result, "value-total");
  metrics[2]!.calculation = { operation, operands: values.operands, expectedResult: values.result, rounding: { mode: "none", decimalPlaces: operation === "ratio" ? 1 : 0 }, tolerance: "0", operationVersion: "decimal.v1" };
  return input;
}

function makePeriodMetric(prototype: Prototype, semantics: "point" | "interval" | "cumulative") {
  const input = structuredClone(prototype.prototypeMetricInput()) as DeterministicVerificationInput;
  const metric = input.bundle.metricObservations[2]!;
  if (semantics === "point") {
    metric.period = { timezone: "UTC", semantics: "point" };
    metric.evidence = metric.evidence.filter((edge) => edge.evidenceId !== "period-start-total" && edge.evidenceId !== "period-end-total");
    metric.evidenceBindings = metric.evidenceBindings.filter((binding) => binding.facet !== "period_start" && binding.facet !== "period_end");
  } else if (semantics === "cumulative") {
    metric.period = { end: "2026-08-02T23:59:59.999Z", timezone: "UTC", semantics: "cumulative" };
    metric.evidence = metric.evidence.filter((edge) => edge.evidenceId !== "period-start-total");
    metric.evidenceBindings = metric.evidenceBindings.filter((binding) => binding.facet !== "period_start");
  }
  return input;
}

function extractionReplay(candidate: Record<string, string>, source: Record<string, string>, fields: readonly unknown[], totals: readonly unknown[] = []) {
  const sourceBytes = encoder.encode(JSON.stringify(source));
  const digest = sha256Digest(sourceBytes);
  const admitted = admitExtractionSchema({ schemaId: "vr030-fields", schemaVersion: "v1", schema: {
    type: "object", description: "VR030 deterministic field fixture.",
    properties: Object.fromEntries(Object.keys(candidate).map((key) => [key, { type: "string", description: key, maxLength: 128 }])),
    required: Object.keys(candidate), additionalProperties: false,
  } });
  if (!admitted.admitted || !admitted.schema) throw new Error("VR030_SCHEMA_NOT_ADMITTED");
  return verifyExtractionFields({ schema: admitted.schema, candidate, fields: fields as never,
    evidence: Object.keys(candidate).map((key) => ({ path: `/${key}`, captureId: "capture-vr030", representationArtifactId: "artifact-vr030", representationDigest: digest, selector: { kind: "json_pointer" as const, pointer: `/${key}` } })),
    representations: [{ captureId: "capture-vr030", artifactId: "artifact-vr030", digest, content: sourceBytes }], normalizations: [{ id: "collapsed", operation: "ascii_whitespace_collapsed" }], totals: totals as never });
}

function makeSelectorClaim(prototype: Prototype, selector: any, sourceText: string, projection?: unknown) {
  const input = structuredClone(prototype.prototypeClaimInput()) as DeterministicVerificationInput & { artifacts: Array<{ artifactId: string; content: string | Uint8Array }> };
  const source = input.bundle.captures[0]!.contentArtifact;
  const sourceBytes = encoder.encode(sourceText);
  source.digest = sha256Digest(sourceBytes); source.byteLength = sourceBytes.byteLength;
  input.artifacts[0]!.content = sourceText;
  const evidence = input.bundle.assertions[0]!.evidence[0]!;
  evidence.fragment.selector = selector;
  if (projection !== undefined) {
    const projectionBytes = encoder.encode(canonicalizeJson(projection));
    const projectionArtifact = { ...handle("77777777-7777-4777-8777-777777777777", projectionBytes), mediaType: "application/vnd.aiengineer.verification-canonical-projection+json", parentArtifactIds: [source.artifactId], transformationSignature: sha256Digest("vr030-projection") };
    input.bundle.captures[0]!.canonicalProjectionArtifact = projectionArtifact;
    input.artifacts.push({ artifactId: projectionArtifact.artifactId, content: projectionBytes });
    evidence.fragment.representationArtifactId = projectionArtifact.artifactId;
    const selected = projectionSelectorResolver.resolve({ captureId: input.bundle.captures[0]!.captureId, representationArtifactId: projectionArtifact.artifactId, representationDigest: projectionArtifact.digest, selector, content: projectionBytes });
    if (selected.resolution.status !== "resolved") throw new Error(`VR030_SELECTOR_FIXTURE_UNRESOLVED:${selector.kind}`);
    evidence.expectedSelectedContentDigest = selected.resolution.selectedContentDigest!;
  } else {
    evidence.fragment.representationArtifactId = source.artifactId;
    // Built-in text resolver is the deterministic default; bind its exact source selection.
    const selectedText = selector.kind === "multi_fragment_text" ? ["first", "second"].join(` ${String.fromCodePoint(0x2026)} `) : selector.kind === "character_position" ? sourceText.slice(selector.start, selector.end) : selector.quote;
    evidence.expectedSelectedContentDigest = sha256Digest(selectedText);
  }
  return input;
}

describe("VR-030 declared-operation breadth", () => {
  it("seals and replays every declared selector kind using canonical retained representations", async () => {
    const prototype = await import(fixtureUrl) as Prototype;
    const selectors: Array<{ name: string; selector: any; sourceText: string; projection?: unknown }> = [
      { name: "text_quote", sourceText: "before exact quote after", selector: { kind: "text_quote", quote: "exact quote", normalization: "none" } },
      { name: "character_position", sourceText: "character", selector: { kind: "character_position", start: 0, end: 4, offsetBasis: "utf16_code_units", normalization: "none" } },
      { name: "multi_fragment_text", sourceText: "first middle second", selector: { kind: "multi_fragment_text", fragments: [{ kind: "text_quote", quote: "first", normalization: "none" }, { kind: "text_quote", quote: "second", normalization: "none" }], joiner: ` ${String.fromCodePoint(0x2026)} ` } },
      { name: "html", sourceText: "raw", projection: { kind: "html_dom", canonicalText: "Native summary", document: { tag: "main", children: [{ tag: "p", id: "summary", text: "Native summary" }] } }, selector: { kind: "html", css: "#summary" } },
      { name: "pdf_text", sourceText: "raw", projection: { kind: "pdf_text", pageCount: 1, pages: [{ physicalPageNumber: 1, text: "Panel value 42", textLayerDigest: sha256Digest("Panel value 42"), widthPoints: 1, heightPoints: 1 }] }, selector: { kind: "pdf_text", page: 1, start: 12, end: 14, offsetBasis: "utf16_code_units", textLayerDigest: sha256Digest("Panel value 42") } },
      { name: "bounding_box", sourceText: "raw", projection: { kind: "geometry", pages: [{ physicalPageNumber: 1, widthPoints: 100, heightPoints: 100, tokens: [{ text: "42", x: 0.1, y: 0.1, width: 0.1, height: 0.1, coordinateSpace: "normalized", order: 0 }] }] }, selector: { kind: "bounding_box", page: 1, coordinateSpace: "normalized", x: 0, y: 0, width: 0.5, height: 0.5 } },
      { name: "table", sourceText: "raw", projection: { kind: "table", tables: [{ tableId: "table-01", cells: [{ row: 0, column: 0, value: "21", headerPath: ["Metric"] }] }] }, selector: { kind: "table", tableId: "table-01", row: 0, column: 0, headerPath: ["Metric"], expectedCellValue: "21" } },
      { name: "media_timecode", sourceText: "raw", projection: { kind: "transcript", durationMs: 1000, segments: [{ segmentId: "s1", startMs: 0, endMs: 1000, text: "first", speaker: "A", channel: "left" }] }, selector: { kind: "media_timecode", startMs: 0, endMs: 1000, speaker: "A", channel: "left" } },
      { name: "repository", sourceText: "raw", projection: { kind: "repository", commit: "a".repeat(40), lineRangeConvention: "zero_based_half_open", files: [{ path: "src/a.ts", content: "line one\nline two" }] }, selector: { kind: "repository", commit: "a".repeat(40), path: "src/a.ts", rangeKind: "lines", start: 0, end: 1 } },
      { name: "dataset", sourceText: "raw", projection: { kind: "dataset", datasetVersionId: "dataset-v1", rows: [{ key: "r1", value: { answer: 42 } }] }, selector: { kind: "dataset", datasetVersionId: "dataset-v1", rowKey: "r1", column: "answer" } },
      { name: "api_record", sourceText: "raw", projection: { kind: "paginated_api", apiVersion: "v1", queryDigest: sha256Digest("query"), pages: [{ pageKey: "p1", records: [{ recordKey: "r1", value: { answer: 42 } }] }] }, selector: { kind: "api_record", pageKey: "p1", recordKey: "r1", fieldPointer: "/answer" } },
    ];
    for (const fixture of selectors) {
      const input = makeSelectorClaim(prototype, fixture.selector, fixture.sourceText, fixture.projection);
      const selectorResolvers = fixture.projection === undefined ? undefined : [projectionSelectorResolver];
      const value = await sealed(input, "claim", selectorResolvers);
      const replay = await replayVerificationAudit(value.audit, { artifactResolver: resolver(value.values), runtimePrincipals: value.runtimePrincipals, ...(selectorResolvers ? { selectorResolvers } : {}) });
      expect(replay.deterministicResult.status, fixture.name).toBe("passed");
    }
  });
  it("replays all eleven declared scalar comparisons from immutable selected bytes", () => {
    const candidate = {
      exact: "fixed", normalized: " A B ", decimal: "0.5", percentage: "12.5%", currency: "USD 12.50", unit: "kg", date: "0001-01-01",
      datetime: "2026-01-01T00:00:00Z", enum: "reported", identifier: `sha256:${"a".repeat(64)}`, checksum: "79927398713",
    };
    const source = { ...candidate, normalized: "A  B", percentage: "12.50%", datetime: "2025-12-31T19:00:00-05:00" };
    const result = extractionReplay(candidate, source, [
      { path: "/exact", comparison: "exact" }, { path: "/normalized", comparison: "normalized_text", normalizationId: "collapsed" }, { path: "/decimal", comparison: "decimal" },
      { path: "/percentage", comparison: "percentage" }, { path: "/currency", comparison: "currency", allowedValues: ["USD"] }, { path: "/unit", comparison: "unit", allowedValues: ["kg"] },
      { path: "/date", comparison: "date" }, { path: "/datetime", comparison: "datetime" }, { path: "/enum", comparison: "enum", allowedValues: ["reported", "estimated"] },
      { path: "/identifier", comparison: "identifier", identifierKind: "sha256" }, { path: "/checksum", comparison: "checksum", checksum: "luhn" },
    ]);
    expect(result.valid).toBe(true);
  });

  it("seals and replays each declared calculation operation and each supported period semantic", async () => {
    const prototype = await import(fixtureUrl) as Prototype;
    for (const operation of ["identity", "sum", "difference", "product", "ratio", "percent_change"] as const) {
      const input = makeOperationMetric(prototype, operation);
      const actual = verifyDeterministicBundle(input); expect(actual.status, operation).toBe("passed");
      const value = await sealed(input, "metric");
      await expect(replayVerificationAudit(value.audit, { artifactResolver: resolver(value.values), runtimePrincipals: value.runtimePrincipals })).resolves.toMatchObject({ policyOutcome: value.audit.manifest.policyOutcome });
    }
    for (const semantics of ["point", "interval", "cumulative"] as const) {
      const input = makePeriodMetric(prototype, semantics);
      expect(ObservationPeriodSchema.safeParse(input.bundle.metricObservations[2]!.period).success, semantics).toBe(true);
      expect(verifyDeterministicBundle(input).status, semantics).toBe("passed");
      const value = await sealed(input, "metric");
      await expect(replayVerificationAudit(value.audit, { artifactResolver: resolver(value.values), runtimePrincipals: value.runtimePrincipals })).resolves.toMatchObject({ policyOutcome: value.audit.manifest.policyOutcome });
    }
  });

  it("coherently rebinds changed calculation bytes and still detects the wrong arithmetic result", async () => {
    const prototype = await import(fixtureUrl) as Prototype;
    const input = makeOperationMetric(prototype, "sum");
    const source = JSON.parse(String(input.artifacts[0]!.content)) as Record<string, unknown>;
    source.total = 999;
    const bytes = encoder.encode(JSON.stringify(source));
    input.artifacts[0]!.content = new TextDecoder().decode(bytes);
    input.bundle.captures[0]!.contentArtifact.digest = sha256Digest(bytes);
    input.bundle.captures[0]!.contentArtifact.byteLength = bytes.byteLength;
    const total = input.bundle.metricObservations[2]!;
    total.rawValue = 999; total.canonicalValue = "999";
    total.evidence.find((edge) => edge.evidenceId === "value-total")!.expectedSelectedContentDigest = sha256Digest("999");
    total.evidenceBindings.find((binding) => binding.facet === "value")!.expectedLiteral = "999";
    const result = verifyDeterministicBundle(input);
    expect(result.status).toBe("failed");
    expect(result.summary.failedCheckCodes).toContain("OBSERVED_VALUE_MATCHES_CALCULATION");
  });
});
