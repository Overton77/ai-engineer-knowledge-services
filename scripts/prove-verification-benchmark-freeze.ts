import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { freezeVerificationBenchmarkDataset, verificationBenchmarkDigest } from "../packages/evaluation/dist/index.js";

type Json = Record<string, any>;
const root = resolve(import.meta.dirname, "..");
const preparation = resolve(root, "../internal/verification-offline-source-preparation-9093b465-16c2-4cc1-b7f4-728d3958b0ed");
const output = resolve(root, "catalog/verification-benchmarks/diagnostics-companies-pilot-v3");
const priorOutput = resolve(root, "catalog/verification-benchmarks/diagnostics-companies-pilot-v2");
let createdAt: string;
try { createdAt = (JSON.parse(await readFile(resolve(output, "dataset.json"), "utf8")) as Json).createdAt; } catch (error: any) { if (error?.code !== "ENOENT") throw error; createdAt = new Date().toISOString(); }
const sourcePreparationDigest = "sha256:50a3552cffc639a78d7789865be929baefd64d2342431e2de958e669c21f163e" as const;
const expectedProposalDigest = "sha256:ae9bce06f634715b7a6f8ff278839347433e7f4889cac6f9b25fa1bcd49823c8" as const;
const expectedCandidatesDigest = "sha256:d1781f1c5b32dff5fff3a27251c9072386f1673e98d4fb9210090fc4ef6b9831" as const;
const hash = (bytes: string | Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const;
const uuid = (material: unknown) => { const hex = createHash("sha256").update(JSON.stringify(material)).digest("hex").slice(0, 32).split(""); hex[12] = "5"; hex[16] = ((Number.parseInt(hex[16]!, 16) & 3) | 8).toString(16); return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`; };
const json = async (path: string) => JSON.parse(await readFile(path, "utf8")) as Json;
const stable = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const writeImmutable = async (name: string, value: unknown) => {
  const path = resolve(output, name), bytes = stable(value);
  try { const prior = await readFile(path, "utf8"); if (prior !== bytes) throw new Error(`IMMUTABLE_OUTPUT_CONFLICT:${name}`); }
  catch (error: any) { if (error?.code !== "ENOENT") throw error; await writeFile(path, bytes, { flag: "wx" }); }
  return { name, digest: hash(bytes), bytes: Buffer.byteLength(bytes) };
};
const label = (item: Json) => {
  const literal = item.variant === "literal_source_summary";
  const publication = item.sourceKey.startsWith("paper-");
  const interested = item.sourceKey === "gl-comparison";
  if (literal) return {
    label: interested ? "promotional_only" : "supported_by_source",
    expectedPolicy: interested ? "review" : publication ? "pass_with_warnings" : "pass_with_warnings",
    expectedLocatorValid: true, support: "full", authority: publication ? "sufficient" : "interested_party_only",
    worldCorrectness: "not_established",
    rationale: interested ? "The exact interested-party source supports only that the company made the promotional statement; it does not independently establish the superlative." : publication ? "The captured publication directly supports this bounded method or study statement; commercial applicability remains separate." : "The captured first-party fragment directly supports the bounded company-as-source statement; real-world correctness remains unestablished.",
  };
  // Absence is not contradiction: medical/product extrapolations and claims of
  // population accuracy, disease detection, or comparative superiority are
  // unsupported unless the selected fragment explicitly denies them.
  const partial = new Set(["missing_start_event_qualifier"]);
  const contradiction = new Set(["count_or_timeline_swap", "sample_type_swap", "count_swap", "algorithm_count_swap", "algorithm_definition_swap", "cross_page_count_laundering", "conflict_erasure", "negation_removal", "safety_qualifier_reversal", "warranty_overextension", "study_design_swap"]);
  return {
    label: partial.has(item.variant) ? "partially_supported" : contradiction.has(item.variant) ? "contradicted" : "unsupported",
    expectedPolicy: partial.has(item.variant) ? "review" : "fail", expectedLocatorValid: true,
    support: partial.has(item.variant) ? "partial" : contradiction.has(item.variant) ? "contradicted" : "none",
    authority: publication ? "insufficient" : "interested_party_only", worldCorrectness: "unknown",
    rationale: `Engineering expectation for ${item.variant}; human annotation and expert adjudication remain pending.`,
  };
};

const proposalBytes = await readFile(resolve(preparation, "pilot-case-proposal.json"));
const candidateBytes = await readFile(resolve(preparation, "fragment-candidates.json"));
if (hash(proposalBytes) !== expectedProposalDigest || hash(candidateBytes) !== expectedCandidatesDigest) throw new Error("PREPARATION_DIGEST_MISMATCH");
const proposal = JSON.parse(proposalBytes.toString("utf8")) as Json;
const candidates = JSON.parse(candidateBytes.toString("utf8")) as Json;
const registry = await json(resolve(preparation, "source-registry.json"));
const candidateById = new Map<string, Json>(candidates.rows.map((item: Json) => [item.candidateId, item]));
const sourceByKey = new Map<string, Json>(registry.records.map((item: Json) => [item.sourceKey, item]));
const seenSource = new Set<string>();
const atomicLiteral: Record<string, string> = {
  "tru-turnaround-about": "Results are available within 2–4 weeks from the date the lab receives the sample.",
  "tru-turnaround-product": "The personalized TruAge report is stated to be ready within 3–4 weeks after the lab receives the sample.",
  "tru-sample": "The test uses a finger-stick blood collection.",
  "tru-sites": "The test is stated to analyze 1,000,000+ DNA methylation sites.",
  "tru-biomarkers": "The page states that the test reports 75+ biomarkers.",
  "tru-symphony": "The SymphonyAge™ algorithm reveals the age of 11 organ systems key for longevity.",
  "tru-omic": "OMICmAge is described as a multi-omic-informed methylation clock.",
  "tru-pace": "DunedinPACE is described as tracking how fast the body is aging.",
  "gl-systems": "The SystemAge page states that 460 epigenetic biomarkers are mapped across 21 body systems.",
  "gl-historical-wording": "The page states that the SystemAge report includes 19 critical systems.",
  "gl-same-page-footer": "The same-page footer states 21 organs and systems.",
  "gl-triplicate": "Triplicate testing from a single user sample is stated to show near-perfect agreement across runs.",
  "gl-repeatability": "The same sample is stated to produce consistent results across repeated runs.",
  "gl-no-diagnosis": "Generation Lab states that the report does not constitute diagnosis.",
  "gl-consultation": "The report states that pre-clinical recommendations should not be acted upon without first consulting a qualified healthcare provider.",
  "gl-informational": "Generation Lab states that the report is for informational purposes only.",
  "pace-definition": "The paper introduces DunedinPACE as a DNA-methylation biomarker of Pace of Aging.",
  "pace-cohort": "The DunedinPACE model used within-individual decline in 19 indicators across four time points over two decades in the 1972–1973 Dunedin birth cohort.",
  "noise-method": "The paper describes a noise barometer as a measurement of biological age.",
  "gl-interested-comparison": "Generation Lab's comparison page calls SystemAge the most advanced and comprehensive aging-speed test in preventive healthcare.",
};
const cases = proposal.cases.map((item: Json) => {
  const candidate = candidateById.get(item.candidateId); if (!candidate || candidate.selectedContentDigest !== item.selectedContentDigest) throw new Error(`FRAGMENT_BINDING_INVALID:${item.caseId}`);
  const assertion = item.variant === "literal_source_summary" ? atomicLiteral[item.seedId] : item.proposedAssertion; if (typeof assertion !== "string" || !assertion.trim()) throw new Error(`ASSERTION_MISSING:${item.caseId}`);
  const source = sourceByKey.get(item.sourceKey); if (!source) throw new Error(`SOURCE_MISSING:${item.caseId}`);
  const provenanceCluster = item.sourceKey.startsWith("paper-pace") ? "study:dunedinpace-1972-1973" : item.sourceKey.startsWith("paper-noise") ? "study:noise-barometer-multidataset" : item.sourceKey.startsWith("tru-") ? "company:trudiagnostic" : "company:generation-lab";
  const firstForSource = !seenSource.has(provenanceCluster); seenSource.add(provenanceCluster);
  return {
    schemaVersion: "verification-benchmark.v1" as const, caseId: item.caseId, partition: "development" as const,
    inputManifestArtifactId: uuid({ kind: "derived-input-grant", caseId: item.caseId, selectedContentDigest: item.selectedContentDigest }), goldArtifactId: null,
    modality: "html" as const, sourceFamily: provenanceCluster, entityFamily: provenanceCluster, reportCluster: provenanceCluster, pairCluster: item.pairCluster,
    tags: [item.family, item.variant, source.sourceClass, "provider_grant_d013", ...(item.variant === "literal_source_summary" ? ["literal"] : ["adversarial"])],
    adversarialTransforms: item.variant === "literal_source_summary" ? [] : [item.variant], assertion,
    evidence: [{ fragmentId: item.candidateId, captureId: item.captureId, sourceKey: item.sourceKey, sourceClass: candidate.sourceClass, projectionArtifactId: item.projectionArtifactId, projectionDigest: item.projectionDigest, transformationArtifactId: item.transformationArtifactId, selector: item.selector, selectedContentDigest: item.selectedContentDigest, excerpt: candidate.exactText, rights: candidate.rights, providerUploadAuthorized: false }],
    expectation: { ...label(item), labelStatus: "engineering_expectation" as const },
    independentObservation: firstForSource && item.variant === "literal_source_summary", humanGoldScoringEligible: false, adjudicationId: null,
  };
});
const first = cases[0]!;
cases.push({ ...first, caseId: "tru-corrupted-locator", inputManifestArtifactId: uuid({ kind: "offline-mechanical", caseId: "tru-corrupted-locator" }), pairCluster: "tru-corrupted-locator", tags: ["locator", "offline_mechanical"], adversarialTransforms: ["corrupted_dom_path"], assertion: first.assertion, evidence: [{ ...first.evidence[0]!, selector: { kind: "html" as const, domPath: `${(first.evidence[0]!.selector as { domPath: string }).domPath}/999999` } }], expectation: { label: "locator_error" as const, labelStatus: "engineering_expectation" as const, expectedPolicy: "abstain" as const, expectedLocatorValid: false, support: "not_applicable" as const, authority: "not_applicable" as const, worldCorrectness: "not_applicable" as const, rationale: "The modified DOM path must fail closed before semantic evaluation." }, independentObservation: false, humanGoldScoringEligible: false, adjudicationId: null });
const pdf = sourceByKey.get("tru-sample-report")!;
cases.push({ schemaVersion: "verification-benchmark.v1" as const, caseId: "tru-pdf-graph-text-abstention", partition: "development" as const, inputManifestArtifactId: pdf.projections[0].projectionArtifact.artifactId, goldArtifactId: null, modality: "pdf" as const, sourceFamily: "company:trudiagnostic", entityFamily: "company:trudiagnostic", reportCluster: "company:trudiagnostic", pairCluster: "tru-pdf-graph-text-abstention", tags: ["pdf", "graph", "offline_mechanical"], adversarialTransforms: [], assertion: "Return the exact plotted graph value when no admitted text or geometry selector identifies it.", evidence: [], expectation: { label: "abstain" as const, labelStatus: "engineering_expectation" as const, expectedPolicy: "abstain" as const, expectedLocatorValid: false, support: "not_applicable" as const, authority: "not_applicable" as const, worldCorrectness: "not_applicable" as const, rationale: "A graph-only value without an admitted selector must abstain." }, independentObservation: false, humanGoldScoringEligible: false, adjudicationId: null });
const footer = cases.find((item: Json) => item.caseId === "gl-same-page-footer-source")!;
cases.push({ ...footer, caseId: "gl-same-page-superlative-source", inputManifestArtifactId: uuid({ kind: "supplemental", caseId: "gl-same-page-superlative-source" }), pairCluster: "gl-same-page-superlative", tags: ["authority", "promotional", "supplemental_review"], adversarialTransforms: [], assertion: "The same-page footer calls the product the world's most accurate epigenetic test.", expectation: { label: "promotional_only" as const, labelStatus: "engineering_expectation" as const, expectedPolicy: "review" as const, expectedLocatorValid: true, support: "full" as const, authority: "interested_party_only" as const, worldCorrectness: "not_established" as const, rationale: "The first-party page supports that the company made the superlative, not that the superlative is independently true." }, independentObservation: false, humanGoldScoringEligible: false, adjudicationId: null });
const guidelines = {
  schemaVersion: "verification-benchmark-annotation-guidelines.v1", scope: "Assertion-level source support, authority, world correctness and policy are labeled separately.",
  instructions: ["Preserve entity, number, date, unit, population, study, workflow-start, diagnosis and commercial-applicability qualifiers.", "supported_by_source means source entailment only; it does not establish world truth.", "First-party promotional superlatives and medical or causal claims require appropriate independent authority.", "Annotators work independently and blinded to other annotations; an expert adjudicates after two human annotations."],
};
const annotationGuidelinesDigest = verificationBenchmarkDigest(guidelines);
const priorDataset = await json(resolve(priorOutput, "dataset.json"));
const dataset = freezeVerificationBenchmarkDataset({ schemaVersion: "verification-benchmark.v1", verificationContractVersion: "verification.v1", datasetId: "diagnostics-companies", version: 3, stage: "pilot", frozen: true, supersedesManifestDigest: priorDataset.manifestDigest, sourcePreparationDigest, labelProvenance: "engineering_expectations", annotationGuidelinesDigest, adjudicationArtifactDigest: null, cases, createdAt, sealedAt: createdAt });
const grant = {
  schemaVersion: "verification-benchmark-derived-input-grant.v1", datasetManifestDigest: dataset.manifestDigest, approvalReference: { decisionId: "D-013", decisionLogPath: "docs/workspaces/verification-module/DECISIONS.md", status: "accepted" }, approvedAt: createdAt,
  constraints: { textOnly: true, oneAssertionPerCase: true, oneExactFragmentPerCase: true, maximumCombinedCaseUtf16Characters: 2000, maximumSerializedRequestUtf8Bytes: 10000, maximumOutputTokens: 900, fullPageOrPdfUpload: false, tools: false, search: false, redirects: false, concurrency: 1, automaticQualityRetries: 0 },
  providers: [{ provider: "vercel-ai-gateway", model: "openai/gpt-5.6-luna", reservationCostMicros: 5000 }, { provider: "vercel-ai-gateway", model: "anthropic/claude-haiku-4.5", reservationCostMicros: 20000 }, { provider: "interfaze", model: "interfaze-beta", reservationCostMicros: 50000, actualBillingState: "unknown_retain_reservation" }],
  pricingSnapshot: { capturedAt: "2026-09-05", luna: { inputUsdPerMillionTokens: 0.2, outputUsdPerMillionTokens: 1.2 }, haiku: { inputUsdPerMillionTokens: 1, cacheWriteInputUsdPerMillionTokens: 1.25, outputUsdPerMillionTokens: 5 }, interfaze: { inputUsdPerMillionTokens: 1.5, outputUsdPerMillionTokens: 3.5, useForActualSettlement: false } },
  authorizedDerivedInputs: dataset.cases.filter((item) => item.tags.includes("provider_grant_d013")).map((item) => ({ inputManifestArtifactId: item.inputManifestArtifactId, caseId: item.caseId, captureId: item.evidence[0]!.captureId, sourceKey: item.evidence[0]!.sourceKey, sourceClass: item.evidence[0]!.sourceClass, selectedContentDigest: item.evidence[0]!.selectedContentDigest, assertionDigest: hash(item.assertion), combinedCaseUtf16Characters: item.assertion.length + item.evidence[0]!.excerpt.length, qualifierMetadata: [], authorized: true })),
};
for (const item of dataset.cases.filter((candidate) => candidate.tags.includes("provider_grant_d013"))) { const evidence = item.evidence[0]!; const providerInput = { assertion: item.assertion, fragment: evidence.excerpt, sourceClass: evidence.sourceClass, qualifierMetadata: [] }; const encoded = Buffer.from(JSON.stringify(providerInput)); if (item.assertion.length + evidence.excerpt.length > 2000 || encoded.byteLength > 10_000) throw new Error(`PROVIDER_INPUT_GRANT_LIMIT:${item.caseId}`); }
const annotations = { schemaVersion: "verification-benchmark-annotation-queue.v1", datasetManifestDigest: dataset.manifestDigest, humanGoldScoringEligible: false, requiredActions: dataset.cases.map((item) => ({ caseId: item.caseId, humanAnnotation1: null, humanAnnotation2: null, expertAdjudication: null, status: "awaiting_human_annotations" })) };
const sourceLedger = { schemaVersion: "verification-benchmark-source-ledger.v1", sourcePreparationDigest, sources: registry.records.map((item: Json) => ({ sourceKey: item.sourceKey, url: item.url, sourceClass: item.sourceClass, captureId: item.captureId, sourceArtifactDigest: item.sourceArtifact.digest, originalCapturedAt: item.originalCapturedAt, rights: item.rights, goldStatus: item.goldStatus })) };
const armConfig = { schemaVersion: "verification-benchmark-experiment.v1", hypothesis: "Evidence-closed cascade and consensus strategies improve engineering-expectation agreement while preserving abstention and provenance.", primaryOutcome: "engineering_expectation_agreement (human-gold quality inference prohibited)", datasetManifestDigest: dataset.manifestDigest, seed: 207197, replicas: 1, cachePolicy: "exact_request_only_with_cross_arm_attribution", providerRetryPolicy: "none", clusterUnit: "source_family", arms: ["baseline", "interfaze", "cascade", "consensus_abstention"], promotionEligible: false };
// A source-bound, unlabeled candidate pool makes Benchmark v1 tooling executable without inventing 150 human labels.
const grouped = new Map<string, Json[]>();
for (const row of candidates.rows as Json[]) if (row.exactText.length >= 40 && row.exactText.length <= 1800) { const key = `${row.sourceKey}:${row.selectedContentDigest}`; if (![...grouped.values()].flat().some((prior) => `${prior.sourceKey}:${prior.selectedContentDigest}` === key)) (grouped.get(row.sourceKey) ?? (grouped.set(row.sourceKey, []), grouped.get(row.sourceKey)!)).push(row); }
const sourceKeys = [...grouped.keys()].sort(), pool: Json[] = []; let ordinal = 0;
while (pool.length < 180 && sourceKeys.some((key) => (grouped.get(key)?.length ?? 0) > ordinal)) { for (const key of sourceKeys) { const row = grouped.get(key)?.[ordinal]; if (row && pool.length < 180) pool.push(row); } ordinal++; }
if (pool.length < 150) throw new Error(`BENCHMARK_V1_CANDIDATE_POOL_TOO_SMALL:${pool.length}`);
const candidatePool = { schemaVersion: "verification-benchmark-v1-candidate-pool.v1", status: "unlabeled_unfrozen_candidates", sourcePreparationDigest, count: pool.length, independentObservationCount: 0, limitation: "Rows are unique source-bound fragment candidates, not independent cases or gold labels. Case atomization, split assignment, two human annotations, expert adjudication and sealing remain pending.", candidates: pool.map((row, index) => ({ candidateId: `benchmark-v1-candidate-${String(index + 1).padStart(3, "0")}`, fragmentId: row.candidateId, sourceKey: row.sourceKey, sourceClass: row.sourceClass, captureId: row.captureId, projectionArtifactId: row.projectionArtifactId, projectionDigest: row.projectionDigest, selector: row.selector, selectedContentDigest: row.selectedContentDigest, labelStatus: "annotation_pending", independentObservation: false })) };

await mkdir(output, { recursive: true });
const written = [];
written.push(await writeImmutable("annotation-guidelines.json", guidelines));
written.push(await writeImmutable("dataset.json", dataset));
written.push(await writeImmutable("derived-input-grant.json", { ...grant, grantDigest: verificationBenchmarkDigest(grant) }));
written.push(await writeImmutable("annotation-queue.json", annotations));
written.push(await writeImmutable("source-ledger.json", sourceLedger));
written.push(await writeImmutable("experiment.json", { ...armConfig, experimentDefinitionDigest: verificationBenchmarkDigest(armConfig) }));
written.push(await writeImmutable("benchmark-v1-candidate-pool.json", candidatePool));
const manifest = { schemaVersion: "verification-benchmark-catalog-manifest.v1", datasetManifestDigest: dataset.manifestDigest, sourcePreparationDigest, proposalDigest: expectedProposalDigest, fragmentCandidateDigest: expectedCandidatesDigest, files: written };
const manifestFile = await writeImmutable("manifest.json", { ...manifest, manifestDigest: verificationBenchmarkDigest(manifest) });
process.stdout.write(`${JSON.stringify({ datasetManifestDigest: dataset.manifestDigest, derivedInputGrantDigest: verificationBenchmarkDigest(grant), catalogManifestDigest: manifestFile.digest, caseCount: dataset.cases.length, sourceFamilies: new Set(dataset.cases.map((item) => item.sourceFamily)).size, benchmarkV1CandidateCount: pool.length }, null, 2)}\n`);
