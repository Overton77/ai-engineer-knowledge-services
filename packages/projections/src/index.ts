import {
  DomainProjectionSchema,
  type DomainProjection,
  type PublicKnowledgeDomain,
  type SourceLocator,
  type VectorSpace,
} from "@aiengineer/knowledge-contracts";
import { deepFreeze, sha256Digest } from "@aiengineer/knowledge-domain";
import { deterministicUuid } from "@aiengineer/knowledge-documents";

export interface EvidenceSupport {
  readonly locatorId: string;
  readonly locator: SourceLocator;
  readonly quotedText: string;
}

export interface SupportedAssertion {
  readonly id: string;
  readonly statement: string;
  readonly supportLocatorIds: readonly string[];
}

interface ProjectionInputBase {
  readonly sourceRecordId: string;
  readonly procedureVersionId: string;
  readonly evidence: readonly EvidenceSupport[];
  readonly assertions: readonly SupportedAssertion[];
}

export type ProjectionInput =
  | (ProjectionInputBase & { readonly space: "engineering_claims"; readonly claimClass: string; readonly attribution: string; readonly problem: string; readonly mechanism: string; readonly applicability: readonly string[]; readonly limitations: readonly string[] })
  | (ProjectionInputBase & { readonly space: "tool_capabilities"; readonly toolName: string; readonly capabilities: readonly string[]; readonly constraints: readonly string[]; readonly languages?: readonly string[]; readonly frameworks?: readonly string[]; readonly deploymentModes?: readonly string[] })
  | (ProjectionInputBase & { readonly space: "implementation_examples"; readonly objective: string; readonly language: string; readonly framework?: string; readonly commit: string; readonly path: string; readonly symbol?: string; readonly dependencies?: readonly string[]; readonly codeIdentifiers?: readonly string[] })
  | (ProjectionInputBase & { readonly space: "paper_case_study_knowledge"; readonly title: string; readonly findingClass: string; readonly derived: boolean; readonly sectionRole: string; readonly findings: readonly string[]; readonly caveats: readonly string[] })
  | (ProjectionInputBase & { readonly space: "entity_profiles"; readonly entityType: string; readonly canonicalName: string; readonly aliases: readonly string[]; readonly profileKind: "identity" | "capability" | "technical_significance" | "ecosystem"; readonly identifiers?: readonly string[] })
  | (ProjectionInputBase & { readonly space: "model_capabilities"; readonly modelVersion: string; readonly capabilities: readonly string[]; readonly constraints: readonly string[]; readonly observedAt: string; readonly modalities?: readonly string[]; readonly tasks?: readonly string[] })
  | (ProjectionInputBase & { readonly space: "benchmark_intelligence"; readonly benchmarkVersion: string; readonly metric: string; readonly protocol: string; readonly comparabilityWarnings: readonly string[]; readonly measuredTask: string; readonly dataset?: string; readonly resultObservations?: readonly string[] })
  | (ProjectionInputBase & { readonly space: "source_native_sections"; readonly sectionPath: readonly string[]; readonly sourceText: string });

export interface EvidenceValidationResult {
  readonly valid: boolean;
  readonly issues: readonly string[];
  readonly supportSetDigest: `sha256:${string}`;
}

export function validateEvidenceSupport(input: ProjectionInput): EvidenceValidationResult {
  const issues: string[] = [];
  const evidenceById = new Map<string, EvidenceSupport>();
  for (const evidence of input.evidence) {
    if (evidenceById.has(evidence.locatorId)) issues.push(`duplicate evidence locator ${evidence.locatorId}`);
    evidenceById.set(evidence.locatorId, evidence);
    if (evidence.quotedText.trim().length === 0) issues.push(`${evidence.locatorId}: quoted text is empty`);
    if (evidence.locator.quoteDigest !== undefined && evidence.locator.quoteDigest !== sha256Digest(evidence.quotedText)) {
      issues.push(`${evidence.locatorId}: quote digest mismatch`);
    }
  }
  if (input.evidence.length === 0) issues.push("at least one evidence locator is required");
  if (input.space !== "source_native_sections" && input.assertions.length === 0) issues.push("derived projections require supported assertions");
  for (const assertion of input.assertions) {
    if (assertion.statement.trim().length === 0) issues.push(`${assertion.id}: assertion is empty`);
    if (assertion.supportLocatorIds.length === 0) issues.push(`${assertion.id}: assertion has no support`);
    for (const locatorId of assertion.supportLocatorIds) {
      if (!evidenceById.has(locatorId)) issues.push(`${assertion.id}: unknown support locator ${locatorId}`);
    }
  }
  if (input.space === "source_native_sections" && input.assertions.length > 0) {
    issues.push("source-native sections must remain faithful rather than carry derived assertions");
  }
  if (input.space === "source_native_sections") {
    const reconstructed = input.evidence.map(({ quotedText }) => quotedText).join("\n\n");
    if (input.sourceText !== reconstructed) issues.push("source-native text does not exactly match ordered evidence text");
  }
  const supportSetDigest = sha256Digest(JSON.stringify([...evidenceById.values()]
    .map(({ locatorId, locator, quotedText }) => ({ locatorId, locator, quoteDigest: sha256Digest(quotedText) }))
    .sort((a, b) => a.locatorId.localeCompare(b.locatorId))));
  return deepFreeze({ valid: issues.length === 0, issues, supportSetDigest });
}

export function createProjection(input: ProjectionInput): Readonly<DomainProjection> {
  const validation = validateEvidenceSupport(input);
  if (!validation.valid) throw new Error(`Projection evidence validation failed: ${validation.issues.join("; ")}`);
  const supportLocatorIds = [...new Set(input.evidence.map(({ locatorId }) => locatorId))].sort();
  const text = projectionText(input);
  const base = {
    projectionId: deterministicUuid(sha256Digest({ sourceRecordId: input.sourceRecordId, procedureVersionId: input.procedureVersionId, space: input.space, text, supportSetDigest: validation.supportSetDigest })),
    procedureVersionId: input.procedureVersionId,
    sourceRecordId: input.sourceRecordId,
    text,
    supportLocatorIds,
  };
  let projection: unknown;
  switch (input.space) {
    case "engineering_claims": projection = { ...base, space: input.space, claimClass: input.claimClass, attribution: input.attribution, limitations: [...input.limitations] }; break;
    case "tool_capabilities": projection = { ...base, space: input.space, toolName: input.toolName, capabilities: [...input.capabilities], constraints: [...input.constraints] }; break;
    case "implementation_examples": projection = { ...base, space: input.space, language: input.language, commit: input.commit, path: input.path, ...(input.framework === undefined ? {} : { framework: input.framework }), ...(input.symbol === undefined ? {} : { symbol: input.symbol }) }; break;
    case "paper_case_study_knowledge": projection = { ...base, space: input.space, title: input.title, findingClass: input.findingClass, derived: input.derived }; break;
    case "entity_profiles": projection = { ...base, space: input.space, entityType: input.entityType, canonicalName: input.canonicalName, aliases: [...input.aliases] }; break;
    case "model_capabilities": projection = { ...base, space: input.space, modelVersion: input.modelVersion, capabilities: [...input.capabilities], constraints: [...input.constraints], observedAt: input.observedAt }; break;
    case "benchmark_intelligence": projection = { ...base, space: input.space, benchmarkVersion: input.benchmarkVersion, metric: input.metric, protocol: input.protocol, comparabilityWarnings: [...input.comparabilityWarnings] }; break;
    case "source_native_sections": projection = { ...base, space: input.space, sectionPath: [...input.sectionPath], faithful: true, exploratory: true }; break;
  }
  return deepFreeze(DomainProjectionSchema.parse(projection));
}

function projectionText(input: ProjectionInput): string {
  const assertions = input.assertions.map(({ statement }) => statement.trim());
  switch (input.space) {
    case "engineering_claims": return lines([input.problem, ...assertions, input.mechanism, ...input.applicability, ...input.limitations]);
    case "tool_capabilities": return lines([input.toolName, ...input.capabilities, ...input.constraints, ...(input.languages ?? []), ...(input.frameworks ?? []), ...(input.deploymentModes ?? [])]);
    case "implementation_examples": return lines([input.objective, input.language, input.framework, input.commit, input.path, input.symbol, ...(input.dependencies ?? []), ...(input.codeIdentifiers ?? []), ...assertions]);
    case "paper_case_study_knowledge": return lines([input.title, input.sectionRole, ...input.findings, ...input.caveats, ...assertions]);
    case "entity_profiles": return lines([input.canonicalName, input.entityType, input.profileKind, ...input.aliases, ...(input.identifiers ?? []), ...assertions]);
    case "model_capabilities": return lines([input.modelVersion, ...input.capabilities, ...input.constraints, ...(input.modalities ?? []), ...(input.tasks ?? []), input.observedAt, ...assertions]);
    case "benchmark_intelligence": return lines([input.benchmarkVersion, input.measuredTask, input.dataset, input.metric, input.protocol, ...(input.resultObservations ?? []), ...input.comparabilityWarnings, ...assertions]);
    case "source_native_sections": return lines([...input.sectionPath, input.sourceText]);
  }
}

function lines(values: readonly (string | undefined)[]): string {
  return values.filter((value): value is string => value !== undefined && value.trim().length > 0).map((value) => value.trim()).join("\n");
}

export type DomainDisposition =
  | "faithful_source_section" | "engineering_claim" | "tool_capability" | "implementation_example"
  | "paper_case_study" | "entity_profile" | "model_capability" | "benchmark_intelligence" | "not_ingestible";

const dispositionSpace: Readonly<Partial<Record<DomainDisposition, VectorSpace>>> = {
  faithful_source_section: "source_native_sections", engineering_claim: "engineering_claims",
  tool_capability: "tool_capabilities", implementation_example: "implementation_examples",
  paper_case_study: "paper_case_study_knowledge", entity_profile: "entity_profiles",
  model_capability: "model_capabilities", benchmark_intelligence: "benchmark_intelligence",
};

export interface ClassificationProposal {
  readonly dispositions: readonly DomainDisposition[];
  readonly targetContractVersion: string;
  readonly deduplicationKeys: readonly string[];
  readonly evidenceLocatorIds: readonly string[];
  readonly unresolvedIdentityQuestions: readonly string[];
}

export function classifyProjectionSpaces(proposal: ClassificationProposal): readonly VectorSpace[] {
  if (proposal.targetContractVersion.trim().length === 0) throw new Error("A target contract version is required");
  if (proposal.dispositions.length === 0) throw new Error("At least one domain disposition is required");
  const admittedDispositions = new Set<DomainDisposition>(["faithful_source_section", "engineering_claim", "tool_capability", "implementation_example", "paper_case_study", "entity_profile", "model_capability", "benchmark_intelligence", "not_ingestible"]);
  for (const disposition of proposal.dispositions) {
    if (!admittedDispositions.has(disposition)) throw new Error(`Unknown domain disposition: ${String(disposition)}`);
  }
  if (proposal.dispositions.includes("not_ingestible")) {
    if (proposal.dispositions.length !== 1) throw new Error("not_ingestible cannot be combined with projection domains");
    return [];
  }
  if (proposal.evidenceLocatorIds.length === 0) throw new Error("Projection classification requires evidence");
  if (proposal.deduplicationKeys.length === 0) throw new Error("Projection classification requires deduplication keys");
  const publicDispositions = proposal.dispositions.filter((item) => item !== "faithful_source_section");
  if (publicDispositions.length > 0 && proposal.unresolvedIdentityQuestions.length > 0) {
    throw new Error("Canonical projections require resolved entity identities");
  }
  return deepFreeze([...new Set(proposal.dispositions.map((item) => dispositionSpace[item]).filter((space): space is VectorSpace => space !== undefined))]);
}

export const publicProjectionSpaces: readonly PublicKnowledgeDomain[] = [
  "engineering_claims", "tool_capabilities", "implementation_examples", "paper_case_study_knowledge",
  "entity_profiles", "model_capabilities", "benchmark_intelligence",
];
