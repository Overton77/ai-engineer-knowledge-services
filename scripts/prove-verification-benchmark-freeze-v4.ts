import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { deterministicUuid } from "../packages/runtime/dist/index.js";
import { diffVerificationBenchmarkDatasets, freezeVerificationBenchmarkDataset, verificationBenchmarkDigest } from "../packages/evaluation/dist/index.js";

type Json = Record<string, any>;
type Digest = `sha256:${string}`;
const root = resolve(import.meta.dirname, "..");
const priorDirectory = resolve(root, "catalog/verification-benchmarks/diagnostics-companies-pilot-v3");
const output = resolve(root, "catalog/verification-benchmarks/diagnostics-companies-pilot-v4");
const tenantId = "6d057f43-6aaf-48d9-b3ba-374169abb989";
const sourcePreparationDigest = "sha256:50a3552cffc639a78d7789865be929baefd64d2342431e2de958e669c21f163e" as const;
const proposalDigest = "sha256:ae9bce06f634715b7a6f8ff278839347433e7f4889cac6f9b25fa1bcd49823c8" as const;
const fragmentCandidateDigest = "sha256:d1781f1c5b32dff5fff3a27251c9072386f1673e98d4fb9210090fc4ef6b9831" as const;
const hash = (bytes: string | Uint8Array): Digest => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const stable = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const artifactBytes = (value: unknown) => new TextEncoder().encode(stable(value));
const handle = (bytes: Uint8Array, mediaType: string) => {
  const digest = hash(bytes);
  return { artifactId: deterministicUuid("artifact", `${tenantId}:${digest}`), tenantId, digest, mediaType, byteLength: bytes.byteLength };
};
const writeImmutable = async (name: string, bytes: Uint8Array) => {
  const path = resolve(output, name);
  await mkdir(resolve(path, ".."), { recursive: true });
  try { const prior = await readFile(path); if (!prior.equals(bytes)) throw new Error(`IMMUTABLE_OUTPUT_CONFLICT:${name}`); }
  catch (error: any) { if (error?.code !== "ENOENT") throw error; await writeFile(path, bytes, { flag: "wx" }); }
  return { name: name.replaceAll("\\", "/"), digest: hash(bytes), bytes: bytes.byteLength };
};
const writeJson = (name: string, value: unknown) => writeImmutable(name, artifactBytes(value));

const priorDataset = JSON.parse(await readFile(resolve(priorDirectory, "dataset.json"), "utf8")) as Json;
const priorGrant = JSON.parse(await readFile(resolve(priorDirectory, "derived-input-grant.json"), "utf8")) as Json;
if (priorDataset.manifestDigest !== "sha256:b625b311493f8c366ef43bf4047bf61f38d510fe7f3c340f50bca42de737dfe6" || priorGrant.grantDigest !== "sha256:8c1530d5f856796ce71c21a71d592716fd2972fa53d4843235d7208798236639") throw new Error("V4_PREDECESSOR_SEAL_MISMATCH");
let sealedAt: string;
try { sealedAt = String((JSON.parse(await readFile(resolve(output, "dataset.json"), "utf8")) as Json).sealedAt); }
catch (error: any) { if (error?.code !== "ENOENT") throw error; sealedAt = new Date().toISOString(); }
const artifacts: Json[] = [];
const cases = priorDataset.cases.map((priorCase: Json) => {
  const caseInput = {
    schemaVersion: "verification-benchmark-case-input.v1",
    sourceDatasetManifestDigest: priorDataset.manifestDigest,
    sourceCaseDigest: priorCase.caseDigest,
    caseId: priorCase.caseId,
    assertion: priorCase.assertion,
    evidence: priorCase.evidence.map((item: Json) => ({ fragmentId: item.fragmentId, captureId: item.captureId, sourceKey: item.sourceKey, sourceClass: item.sourceClass, projectionArtifactId: item.projectionArtifactId, projectionDigest: item.projectionDigest, transformationArtifactId: item.transformationArtifactId, selector: item.selector, selectedContentDigest: item.selectedContentDigest, excerpt: item.excerpt, rights: item.rights, originalProviderUploadAuthorized: item.providerUploadAuthorized })),
    intendedUse: "immutable_case_input; provider transmission requires a separately authenticated derived-input grant",
  };
  const inputBytes = artifactBytes(caseInput), inputHandle = handle(inputBytes, "application/vnd.aiengineer.verification-benchmark-case-input+json");
  const expectation = {
    schemaVersion: "verification-benchmark-engineering-expectation.v1",
    sourceDatasetManifestDigest: priorDataset.manifestDigest,
    sourceCaseDigest: priorCase.caseDigest,
    caseId: priorCase.caseId,
    provenance: "agent_reviewed_engineering_expectation",
    humanAnnotationCount: 0,
    expertAdjudicated: false,
    humanGoldScoringEligible: false,
    legacyGoldArtifactColumnSemantics: "engineering expectation artifact only; does not establish human-gold eligibility",
    expectation: priorCase.expectation,
  };
  const expectationBytes = artifactBytes(expectation), expectationHandle = handle(expectationBytes, "application/vnd.aiengineer.verification-benchmark-engineering-expectation+json");
  artifacts.push({ caseId: priorCase.caseId, role: "case_input", file: `artifacts/case-input/${priorCase.caseId}.json`, handle: inputHandle }, { caseId: priorCase.caseId, role: "engineering_expectation", file: `artifacts/engineering-expectation/${priorCase.caseId}.json`, handle: expectationHandle });
  return { ...priorCase, inputManifestArtifactId: inputHandle.artifactId, goldArtifactId: expectationHandle.artifactId, humanGoldScoringEligible: false, adjudicationId: null, caseDigest: undefined };
}).map(({ caseDigest: _caseDigest, ...item }: Json) => item);

const annotationGuidelines = JSON.parse(await readFile(resolve(priorDirectory, "annotation-guidelines.json"), "utf8"));
const dataset = freezeVerificationBenchmarkDataset({
  schemaVersion: "verification-benchmark.v1",
  verificationContractVersion: "verification.v1",
  datasetId: priorDataset.datasetId,
  version: 4,
  stage: "pilot",
  frozen: true,
  supersedesManifestDigest: priorDataset.manifestDigest,
  sourcePreparationDigest,
  labelProvenance: "engineering_expectations",
  annotationGuidelinesDigest: verificationBenchmarkDigest(annotationGuidelines),
  adjudicationArtifactDigest: null,
  cases,
  createdAt: sealedAt,
  sealedAt,
});
const diff = {
  ...diffVerificationBenchmarkDatasets(priorDataset as any, dataset),
  changePurpose: "Replace logical input identifiers with content-addressed case-input artifacts and bind legacy gold_artifact_id vocabulary to explicit non-human engineering-expectation artifacts.",
  providerVisibleContentChanged: false,
  expectationSemanticsChanged: false,
  humanGoldScoringEligibleCount: 0,
  artifactChanges: artifacts.map((item) => ({ caseId: item.caseId, role: item.role, artifactId: item.handle.artifactId, digest: item.handle.digest, byteLength: item.handle.byteLength })),
};
const priorAuthorization = new Map(priorGrant.authorizedDerivedInputs.map((item: Json) => [item.caseId, item]));
const grantMaterial = {
  schemaVersion: "verification-benchmark-derived-input-grant.v2",
  datasetManifestDigest: dataset.manifestDigest,
  sourceDatasetManifestDigest: priorDataset.manifestDigest,
  sourceGrantDigest: priorGrant.grantDigest,
  approvalReference: priorGrant.approvalReference,
  approvedAt: sealedAt,
  constraints: priorGrant.constraints,
  providers: priorGrant.providers,
  pricingSnapshot: priorGrant.pricingSnapshot,
  authorizedDerivedInputs: dataset.cases.filter((item: Json) => priorAuthorization.has(item.caseId)).map((item: Json) => {
    const prior = priorAuthorization.get(item.caseId)! as Json, artifact = artifacts.find((candidate) => candidate.caseId === item.caseId && candidate.role === "case_input")!;
    const evidence = item.evidence[0]!;
    if (item.assertion !== priorDataset.cases.find((candidate: Json) => candidate.caseId === item.caseId)!.assertion || evidence.excerpt !== priorDataset.cases.find((candidate: Json) => candidate.caseId === item.caseId)!.evidence[0]!.excerpt) throw new Error(`V4_PROVIDER_CONTENT_CHANGED:${item.caseId}`);
    return { inputManifestArtifactId: item.inputManifestArtifactId, inputManifestDigest: artifact.handle.digest, caseId: item.caseId, caseDigest: item.caseDigest, captureId: evidence.captureId, sourceKey: evidence.sourceKey, sourceClass: evidence.sourceClass, selectedContentDigest: evidence.selectedContentDigest, assertionDigest: hash(item.assertion), providerVisibleContentDigest: verificationBenchmarkDigest({ assertion: item.assertion, fragment: evidence.excerpt, sourceClass: evidence.sourceClass, qualifierMetadata: prior.qualifierMetadata }), combinedCaseUtf16Characters: item.assertion.length + evidence.excerpt.length, qualifierMetadata: prior.qualifierMetadata, authorized: true };
  }),
};
const grant = { ...grantMaterial, grantDigest: verificationBenchmarkDigest(grantMaterial) };
if (grant.authorizedDerivedInputs.length !== 40 || grant.authorizedDerivedInputs.some((item: Json) => item.combinedCaseUtf16Characters > 2_000)) throw new Error("V4_GRANT_SCOPE_INVALID");
const annotationQueue = { schemaVersion: "verification-benchmark-annotation-queue.v1", datasetManifestDigest: dataset.manifestDigest, humanGoldScoringEligible: false, requiredActions: dataset.cases.map((item: Json) => ({ caseId: item.caseId, humanAnnotation1: null, humanAnnotation2: null, expertAdjudication: null, status: "awaiting_human_annotations" })) };
const experimentMaterial = { schemaVersion: "diagnostics-benchmark-experiment.v2", datasetManifestDigest: dataset.manifestDigest, status: "sealed_pending_live_review", pilotRepetitions: 1, networkPolicy: "allow_listed_providers", cachePolicy: "exact_request_only_with_cross_arm_attribution", providerRetryPolicy: "none", clusterUnit: "source_family", arms: ["luna-baseline", "interfaze", "interfaze-haiku-cascade", "luna-interfaze-haiku-consensus-abstention"], auxiliaryControl: "deterministic-mechanics-only", smokeCaseDisposition: { caseId: "tru-turnaround-product-mutated", datasetVersion: 3, status: "protocol_only_excluded_from_v4_live_dispatch" }, promotionEligible: false, budgetCarryForward: { originalCeilingCostMicros: 20_000_000, preResetLiabilityCostMicros: 2_071_833, successorCeilingCostMicros: 17_928_167, successorBudgetId: "5890d523-561b-55db-a724-890d642885d9", successorBudgetKey: "ws07-pilot-recovery-20260905" } };
const experiment = { ...experimentMaterial, experimentDefinitionDigest: verificationBenchmarkDigest(experimentMaterial) };
const registry = { schemaVersion: "verification-benchmark-case-artifact-registry.v1", tenantId, sourceDatasetManifestDigest: priorDataset.manifestDigest, datasetManifestDigest: dataset.manifestDigest, humanGoldScoringEligible: false, artifacts };

await mkdir(output, { recursive: true });
const files = [];
for (const item of artifacts) {
  const priorCase = priorDataset.cases.find((candidate: Json) => candidate.caseId === item.caseId)!;
  const value = item.role === "case_input" ? { schemaVersion: "verification-benchmark-case-input.v1", sourceDatasetManifestDigest: priorDataset.manifestDigest, sourceCaseDigest: priorCase.caseDigest, caseId: priorCase.caseId, assertion: priorCase.assertion, evidence: priorCase.evidence.map((evidence: Json) => ({ fragmentId: evidence.fragmentId, captureId: evidence.captureId, sourceKey: evidence.sourceKey, sourceClass: evidence.sourceClass, projectionArtifactId: evidence.projectionArtifactId, projectionDigest: evidence.projectionDigest, transformationArtifactId: evidence.transformationArtifactId, selector: evidence.selector, selectedContentDigest: evidence.selectedContentDigest, excerpt: evidence.excerpt, rights: evidence.rights, originalProviderUploadAuthorized: evidence.providerUploadAuthorized })), intendedUse: "immutable_case_input; provider transmission requires a separately authenticated derived-input grant" } : { schemaVersion: "verification-benchmark-engineering-expectation.v1", sourceDatasetManifestDigest: priorDataset.manifestDigest, sourceCaseDigest: priorCase.caseDigest, caseId: priorCase.caseId, provenance: "agent_reviewed_engineering_expectation", humanAnnotationCount: 0, expertAdjudicated: false, humanGoldScoringEligible: false, legacyGoldArtifactColumnSemantics: "engineering expectation artifact only; does not establish human-gold eligibility", expectation: priorCase.expectation };
  const bytes = artifactBytes(value);
  if (hash(bytes) !== item.handle.digest || bytes.byteLength !== item.handle.byteLength) throw new Error(`V4_ARTIFACT_RECONSTRUCTION_MISMATCH:${item.caseId}:${item.role}`);
  files.push(await writeImmutable(item.file, bytes));
}
files.push(await writeJson("annotation-guidelines.json", annotationGuidelines));
files.push(await writeJson("dataset.json", dataset));
files.push(await writeJson("derived-input-grant.json", grant));
files.push(await writeJson("annotation-queue.json", annotationQueue));
files.push(await writeImmutable("source-ledger.json", await readFile(resolve(priorDirectory, "source-ledger.json"))));
files.push(await writeJson("experiment.json", experiment));
files.push(await writeImmutable("benchmark-v1-candidate-pool.json", await readFile(resolve(priorDirectory, "benchmark-v1-candidate-pool.json"))));
files.push(await writeJson("case-artifact-registry.json", registry));
files.push(await writeJson("v3-to-v4-diff.json", diff));
const catalogMaterial = { schemaVersion: "verification-benchmark-catalog-manifest.v2", datasetManifestDigest: dataset.manifestDigest, sourceDatasetManifestDigest: priorDataset.manifestDigest, sourcePreparationDigest, proposalDigest, fragmentCandidateDigest, derivedInputGrantDigest: grant.grantDigest, caseArtifactRegistryDigest: verificationBenchmarkDigest(registry), files };
const catalogManifest = { ...catalogMaterial, manifestDigest: verificationBenchmarkDigest(catalogMaterial) };
const manifest = await writeJson("manifest.json", catalogManifest);
process.stdout.write(`${JSON.stringify({ output, sealedAt, datasetManifestDigest: dataset.manifestDigest, derivedInputGrantDigest: grant.grantDigest, catalogManifestDigest: catalogManifest.manifestDigest, catalogFileDigest: manifest.digest, caseCount: dataset.cases.length, authorizedCaseCount: grant.authorizedDerivedInputs.length, artifactCount: artifacts.length, humanGoldScoringEligibleCount: 0, providerVisibleContentChanged: false }, null, 2)}\n`);
