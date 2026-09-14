import {
  SemanticAssessmentRecordSchema,
  SemanticJudgeIdentitySchema,
  SemanticJudgeOutputSchema,
  type Assertion,
  type DeterministicVerificationResult,
  type SemanticAssessmentRecord,
  type SemanticJudgeIdentity,
  type SemanticJudgeOutput,
  type VerificationBundle,
} from "@aiengineer/knowledge-contracts";
import { canonicalizeJson, digestCanonicalJson, sha256Digest } from "../deterministic/index.js";

const MAX_FRAGMENTS = 16;
const MAX_FRAGMENT_CHARS = 16_000;
const MAX_TOTAL_CHARS = 64_000;

export interface MechanicallySelectedFragment {
  readonly evidenceId: string;
  readonly fragmentId: string;
  readonly exactText: string;
  readonly selectedContentDigest: `sha256:${string}`;
}

export interface AuthorizedSemanticFragment extends MechanicallySelectedFragment {
  readonly role: "supports" | "contradicts" | "qualifies" | "context";
  readonly origin: "declared" | "verifier_found";
}

export interface AuthorizedSemanticCase {
  readonly [authorizedSemanticCaseBrand]: true;
  readonly assertionId: string;
  readonly proposition: string;
  readonly value?: Assertion["value"];
  readonly qualifiers: readonly string[];
  readonly entityBindings: readonly { readonly role: string; readonly canonicalId: string }[];
  readonly riskClass: Assertion["riskClass"];
  readonly downstreamUse: readonly string[];
  readonly fragments: readonly AuthorizedSemanticFragment[];
}

const authorizedSemanticCaseBrand: unique symbol = Symbol("authorized-semantic-case");
const authorizedSemanticCases = new WeakSet<object>();

export interface SemanticJudgeAdapter {
  /** Supplied by trusted deployment composition, never accepted from provider output. */
  readonly identity: SemanticJudgeIdentity;
  readonly maximumInputCharacters: number;
  /** A judge is deliberately composed with no external capabilities. */
  readonly toolCatalog?: readonly [];
  judge(input: {
    readonly rubricVersion: "evidence-only.v1";
    /** Digest of the blinded, authorized input envelope. */
    readonly inputArtifactDigest?: `sha256:${string}`;
    readonly assertionId: string;
    readonly proposition: string;
    readonly value?: Assertion["value"];
    readonly qualifiers: readonly string[];
    readonly entityBindings: readonly { readonly role: string; readonly canonicalId: string }[];
    readonly fragments: readonly { readonly fragmentId: string; readonly exactText: string }[];
  }, execution: { readonly signal?: AbortSignal; readonly deadlineEpochMs?: number }): Promise<unknown>;
}

export type SemanticJudgePort = SemanticJudgeAdapter;

export interface SemanticDriftObservation {
  readonly requestedModel: string;
  readonly returnedModel?: string;
  readonly deploymentId: string;
  readonly drifted: boolean;
  readonly alertClass: "none" | "returned_model_mismatch";
}

export function observeSemanticModelDrift(input: {
  readonly requestedModel: string;
  readonly returnedModel?: string;
  readonly deploymentId: string;
}): SemanticDriftObservation {
  const drifted = input.returnedModel !== undefined && input.returnedModel !== input.requestedModel;
  return Object.freeze({ ...input, drifted, alertClass: drifted ? "returned_model_mismatch" : "none" });
}

export interface SemanticJudgeExecution {
  readonly signal?: AbortSignal;
  readonly deadlineEpochMs?: number;
}

export function authorizeSemanticCase(
  bundle: VerificationBundle,
  deterministic: DeterministicVerificationResult,
  assertionId: string,
  selected: readonly MechanicallySelectedFragment[],
): AuthorizedSemanticCase {
  const assertion = bundle.assertions.find((item) => item.assertionId === assertionId);
  const mechanical = deterministic.assertions.find((item) => item.assertionId === assertionId);
  if (!assertion || !mechanical) throw new Error("SEMANTIC_ASSERTION_NOT_FOUND");
  if (!mechanical.semanticEligibility || mechanical.status !== "passed" || deterministic.status !== "passed" || !deterministic.semanticEligibility) throw new Error("SEMANTIC_MECHANICAL_GATE_CLOSED");
  if (!assertion.atomic || !assertion.proposition) throw new Error("SEMANTIC_ATOMIC_PROPOSITION_REQUIRED");
  if (selected.length === 0 || selected.length > MAX_FRAGMENTS) throw new Error("SEMANTIC_FRAGMENT_COUNT_INVALID");
  const ids = new Set<string>();
  let totalCharacters = 0;
  const fragments = selected.map((candidate) => {
    if (ids.has(candidate.fragmentId)) throw new Error("SEMANTIC_FRAGMENT_DUPLICATE");
    ids.add(candidate.fragmentId);
    if (candidate.exactText.length === 0 || candidate.exactText.length > MAX_FRAGMENT_CHARS) throw new Error("SEMANTIC_FRAGMENT_SIZE_INVALID");
    totalCharacters += candidate.exactText.length;
    const edge = assertion.evidence.find((item) => item.evidenceId === candidate.evidenceId && item.fragment.fragmentId === candidate.fragmentId);
    const mechanicalEvidence = mechanical.evidence.find((item) => item.evidenceId === candidate.evidenceId);
    if (!edge || !mechanicalEvidence) throw new Error("SEMANTIC_FRAGMENT_NOT_DECLARED");
    if (mechanicalEvidence.status !== "passed" || mechanicalEvidence.resolution.status !== "resolved") throw new Error("SEMANTIC_FRAGMENT_NOT_MECHANICALLY_SELECTED");
    if (mechanicalEvidence.resolution.selectedContentDigest !== candidate.selectedContentDigest || sha256Digest(candidate.exactText) !== candidate.selectedContentDigest) throw new Error("SEMANTIC_FRAGMENT_DIGEST_MISMATCH");
    return Object.freeze({ ...candidate, role: edge.role, origin: edge.origin });
  });
  if (totalCharacters > MAX_TOTAL_CHARS) throw new Error("SEMANTIC_TOTAL_EVIDENCE_TOO_LARGE");
  const admitted = Object.freeze({
    [authorizedSemanticCaseBrand]: true as const,
    assertionId,
    proposition: assertion.proposition,
    ...(assertion.value !== undefined ? { value: freezeValue(structuredClone(assertion.value)) } : {}),
    qualifiers: Object.freeze([...assertion.qualifiers]),
    entityBindings: Object.freeze(assertion.entityBindings.map((binding) => Object.freeze({ ...binding }))),
    riskClass: assertion.riskClass,
    downstreamUse: Object.freeze([...assertion.downstreamUse]),
    fragments: Object.freeze(fragments),
  });
  authorizedSemanticCases.add(admitted);
  return admitted;
}

function snapshotAdapter(adapter: SemanticJudgeAdapter): { readonly adapter: SemanticJudgeAdapter; readonly identity: SemanticJudgeIdentity; readonly maximumInputCharacters: number } {
  const identity = Object.freeze(SemanticJudgeIdentitySchema.parse(adapter.identity));
  if (!Number.isInteger(adapter.maximumInputCharacters) || adapter.maximumInputCharacters < 1 || adapter.maximumInputCharacters > MAX_TOTAL_CHARS) throw new Error("JUDGE_CAPACITY_INVALID");
  if (adapter.toolCatalog !== undefined && adapter.toolCatalog.length !== 0) throw new Error("JUDGE_TOOL_CATALOG_NOT_EMPTY");
  return Object.freeze({ adapter, identity, maximumInputCharacters: adapter.maximumInputCharacters });
}

function validateOutput(raw: unknown, semanticCase: AuthorizedSemanticCase): SemanticJudgeOutput {
  preflightJudgeOutput(raw);
  let serialized: string;
  try { serialized = JSON.stringify(raw); } catch { throw new Error("JUDGE_OUTPUT_NOT_SERIALIZABLE"); }
  if (!serialized || serialized.length > 16_000) throw new Error("JUDGE_OUTPUT_CAPACITY_EXCEEDED");
  const output = SemanticJudgeOutputSchema.parse(raw);
  if (output.assertionId !== semanticCase.assertionId) throw new Error("JUDGE_ASSERTION_BINDING_MISMATCH");
  const known = new Set(semanticCase.fragments.map((fragment) => fragment.fragmentId));
  const referenced = [...output.supportingFragmentIds, ...output.contradictingFragmentIds];
  if (referenced.some((id) => !known.has(id))) throw new Error("JUDGE_FRAGMENT_ID_INVENTED");
  if (new Set(output.supportingFragmentIds).size !== output.supportingFragmentIds.length || new Set(output.contradictingFragmentIds).size !== output.contradictingFragmentIds.length) throw new Error("JUDGE_FRAGMENT_ID_DUPLICATE");
  if (new Set(output.unsupportedFacets).size !== output.unsupportedFacets.length) throw new Error("JUDGE_UNSUPPORTED_FACET_DUPLICATE");
  if (output.supportingFragmentIds.some((id) => output.contradictingFragmentIds.includes(id))) throw new Error("JUDGE_FRAGMENT_ROLE_CONFLICT");
  const supportVerdicts = ["directly_supported", "supported_with_qualification", "partially_supported"];
  if (supportVerdicts.includes(output.verdict) && output.supportingFragmentIds.length === 0) throw new Error("JUDGE_SUPPORT_FRAGMENT_REQUIRED");
  if (output.verdict === "directly_supported" && (output.nliLabel !== "entailed" || output.unsupportedFacets.length > 0 || !output.qualifiersPreserved || output.contradictingFragmentIds.length > 0)) throw new Error("JUDGE_DIRECT_SUPPORT_FIELDS_CONTRADICT");
  if (output.verdict === "supported_with_qualification" && (output.nliLabel === "contradicted" || output.contradictingFragmentIds.length > 0)) throw new Error("JUDGE_QUALIFIED_SUPPORT_FIELDS_CONTRADICT");
  if (output.verdict === "partially_supported" && output.nliLabel === "contradicted") throw new Error("JUDGE_PARTIAL_SUPPORT_FIELDS_CONTRADICT");
  if (["supported_with_qualification", "partially_supported"].includes(output.verdict) && output.unsupportedFacets.length === 0) throw new Error("JUDGE_QUALIFICATION_FACET_REQUIRED");
  if (output.verdict === "contradicted" && (output.nliLabel !== "contradicted" || output.contradictingFragmentIds.length === 0 || output.supportingFragmentIds.length > 0)) throw new Error("JUDGE_CONTRADICTION_FIELDS_CONTRADICT");
  if (["not_supported", "insufficient_evidence", "context_only"].includes(output.verdict) && output.nliLabel !== "neutral") throw new Error("JUDGE_NEUTRAL_FIELDS_CONTRADICT");
  if (["not_supported", "insufficient_evidence"].includes(output.verdict) && referenced.length > 0) throw new Error("JUDGE_UNSUPPORTED_FRAGMENT_FIELDS_CONTRADICT");
  if (!output.qualifiersPreserved && semanticCase.qualifiers.length > 0 && output.unsupportedFacets.length === 0) throw new Error("JUDGE_MISSING_QUALIFIER_FACET_REQUIRED");
  return output;
}

async function runJudge(snapshot: ReturnType<typeof snapshotAdapter>, semanticCase: AuthorizedSemanticCase, execution: SemanticJudgeExecution): Promise<{ identity: SemanticJudgeIdentity; output: SemanticJudgeOutput }> {
  assertExecutionActive(execution);
  const inputCharacters = semanticCase.assertionId.length + semanticCase.proposition.length
    + (semanticCase.value === undefined ? 0 : canonicalizeJson(semanticCase.value).length)
    + semanticCase.qualifiers.reduce((sum, item) => sum + item.length, 0)
    + semanticCase.entityBindings.reduce((sum, item) => sum + item.role.length + item.canonicalId.length, 0)
    + semanticCase.fragments.reduce((sum, item) => sum + item.fragmentId.length + item.exactText.length, 0);
  if (inputCharacters > snapshot.maximumInputCharacters) throw new Error("JUDGE_INPUT_CAPACITY_EXCEEDED");
  const blindedInput = semanticJudgeInput(semanticCase);
  const raw = await snapshot.adapter.judge({
    ...blindedInput,
    inputArtifactDigest: digestCanonicalJson(blindedInput),
  }, execution);
  assertExecutionActive(execution);
  return { identity: snapshot.identity, output: validateOutput(raw, semanticCase) };
}

const uncertain = new Set<SemanticJudgeOutput["verdict"]>(["supported_with_qualification", "partially_supported", "context_only", "insufficient_evidence"]);
const supported = new Set<SemanticJudgeOutput["verdict"]>(["directly_supported", "supported_with_qualification"]);

export async function verifySemanticCase(
  semanticCase: AuthorizedSemanticCase,
  adapters: { readonly primary: SemanticJudgeAdapter; readonly crossFamily?: SemanticJudgeAdapter },
  execution: SemanticJudgeExecution = {},
): Promise<SemanticAssessmentRecord> {
  if (!authorizedSemanticCases.has(semanticCase)) throw new Error("SEMANTIC_CASE_NOT_RUNTIME_AUTHORIZED");
  const primarySnapshot = snapshotAdapter(adapters.primary);
  const crossFamilySnapshot = adapters.crossFamily ? snapshotAdapter(adapters.crossFamily) : undefined;
  const primary = await runJudge(primarySnapshot, semanticCase, execution);
  const secondRequired = ["high", "critical"].includes(semanticCase.riskClass) || uncertain.has(primary.output.verdict);
  const judgments = [primary];
  let crossFamily = false;
  if (secondRequired && crossFamilySnapshot) {
    const secondIdentity = crossFamilySnapshot.identity;
    crossFamily = secondIdentity.family !== primary.identity.family && secondIdentity.deploymentId !== primary.identity.deploymentId;
    if (crossFamily) judgments.push(await runJudge(crossFamilySnapshot, semanticCase, execution));
  }
  const outputs = judgments.map((item) => item.output);
  let verdict: SemanticAssessmentRecord["verdict"] = primary.output.verdict;
  let disposition: SemanticAssessmentRecord["disposition"] = supported.has(primary.output.verdict) ? "admit" : primary.output.verdict === "contradicted" ? "fail" : "review";
  const reasonCodes: string[] = [];
  if (secondRequired && !crossFamily) {
    disposition = semanticCase.riskClass === "critical" ? "abstain" : "review";
    reasonCodes.push("CROSS_FAMILY_SECOND_JUDGE_REQUIRED");
  }
  if (judgments.length === 2 && judgments[0]!.output.verdict !== judgments[1]!.output.verdict) {
    const bothSupport = outputs.every((output) => supported.has(output.verdict));
    verdict = bothSupport ? "supported_with_qualification" : "mixed_or_conflicting";
    disposition = "review";
    reasonCodes.push("JUDGE_DISAGREEMENT");
  }
  if (outputs.some((output) => output.verdict === "contradicted") && outputs.some((output) => supported.has(output.verdict))) {
    verdict = "mixed_or_conflicting";
    disposition = "review";
  }
  const supportStatus = verdict === "directly_supported" || verdict === "supported_with_qualification" ? "satisfied"
    : verdict === "contradicted" || verdict === "not_supported" ? "not_satisfied" : "unknown";
  return SemanticAssessmentRecordSchema.parse({
    assertionId: semanticCase.assertionId,
    ...(semanticCase.value !== undefined ? { assertionValueDigest: digestCanonicalJson(semanticCase.value) } : {}),
    verdict,
    disposition,
    evidenceSupport: supportStatus,
    worldCorrectness: "not_assessed",
    attributionFaithfulness: "not_assessed",
    sourceAuthority: "not_assessed",
    provenanceIntegrity: "satisfied",
    judgeIdentities: judgments.map((item) => item.identity),
    supportingFragmentIds: [...new Set(outputs.flatMap((output) => output.supportingFragmentIds))],
    contradictingFragmentIds: [...new Set(outputs.flatMap((output) => output.contradictingFragmentIds))],
    unsupportedFacets: [...new Set(outputs.flatMap((output) => output.unsupportedFacets))],
    reasonCodes,
    crossFamilySecondJudge: crossFamily,
    rawProviderConfidences: judgments.flatMap((item) => item.output.rawProviderConfidence === undefined ? [] : [{ deploymentId: item.identity.deploymentId, value: item.output.rawProviderConfidence }]),
  });
}

function assertExecutionActive(execution: SemanticJudgeExecution): void {
  if (execution.signal?.aborted) throw new Error("JUDGE_CANCELLED");
  if (execution.deadlineEpochMs !== undefined) {
    if (!Number.isFinite(execution.deadlineEpochMs) || execution.deadlineEpochMs <= 0) throw new Error("JUDGE_DEADLINE_INVALID");
    if (Date.now() >= execution.deadlineEpochMs) throw new Error("JUDGE_DEADLINE_EXCEEDED");
  }
}

function preflightJudgeOutput(root: unknown): void {
  const stack: { value: unknown; depth: number }[] = [{ value: root, depth: 0 }];
  const seen = new Set<object>();
  let nodes = 0;
  let characters = 0;
  while (stack.length > 0) {
    const { value, depth } = stack.pop()!;
    nodes += 1;
    if (nodes > 256 || depth > 8) throw new Error("JUDGE_OUTPUT_STRUCTURE_EXCEEDED");
    if (typeof value === "string") {
      characters += value.length;
      if (characters > 16_000) throw new Error("JUDGE_OUTPUT_CAPACITY_EXCEEDED");
    } else if (value !== null && typeof value === "object") {
      if (seen.has(value)) throw new Error("JUDGE_OUTPUT_NOT_SERIALIZABLE");
      seen.add(value);
      if (Array.isArray(value)) {
        if (value.length > 64) throw new Error("JUDGE_OUTPUT_STRUCTURE_EXCEEDED");
        for (const item of value) stack.push({ value: item, depth: depth + 1 });
      } else {
        const entries = Object.entries(value);
        if (entries.length > 32) throw new Error("JUDGE_OUTPUT_STRUCTURE_EXCEEDED");
        for (const [key, item] of entries) {
          characters += key.length;
          if (key.length > 160 || characters > 16_000) throw new Error("JUDGE_OUTPUT_CAPACITY_EXCEEDED");
          stack.push({ value: item, depth: depth + 1 });
        }
      }
    }
  }
}

export async function verifyAssertionSemantics(input: {
  readonly bundle: VerificationBundle;
  readonly deterministicResult: DeterministicVerificationResult;
  readonly assertionId: string;
  readonly selectedFragments: readonly MechanicallySelectedFragment[];
  readonly adapters: { readonly primary: SemanticJudgeAdapter; readonly crossFamily?: SemanticJudgeAdapter };
  readonly execution?: SemanticJudgeExecution;
}): Promise<SemanticAssessmentRecord> {
  const closed = mechanicalSemanticClosure(input.deterministicResult, input.assertionId);
  if (closed) return closed;
  return verifySemanticCase(authorizeSemanticCase(input.bundle, input.deterministicResult, input.assertionId, input.selectedFragments), input.adapters, input.execution);
}

export function mechanicalSemanticClosure(
  deterministic: DeterministicVerificationResult,
  assertionId: string,
): SemanticAssessmentRecord | undefined {
  const assertion = deterministic.assertions.find((item) => item.assertionId === assertionId);
  if (!assertion || (deterministic.status === "passed" && deterministic.semanticEligibility && assertion.semanticEligibility)) return undefined;
  const unsupportedResolver = assertion.evidence.some((item) => item.checks.some((check) => check.code === "SELECTOR_RESOLVER_ADMITTED"));
  const locatorFailed = !unsupportedResolver && assertion.evidence.some((item) => item.status === "failed");
  return SemanticAssessmentRecordSchema.parse({
    assertionId,
    verdict: locatorFailed ? "locator_error" : "unverifiable",
    disposition: locatorFailed ? "fail" : "abstain",
    evidenceSupport: "not_assessed",
    worldCorrectness: "not_assessed",
    attributionFaithfulness: "not_assessed",
    sourceAuthority: "not_assessed",
    provenanceIntegrity: "not_satisfied",
    judgeIdentities: [], supportingFragmentIds: [], contradictingFragmentIds: [], unsupportedFacets: [],
    reasonCodes: ["MECHANICAL_GATE_CLOSED"], crossFamilySecondJudge: false, rawProviderConfidences: [],
  });
}

export function semanticCalibrationStatus(): { readonly status: "pending_empirical_labels"; readonly calibratedProbabilityAvailable: false } {
  return Object.freeze({ status: "pending_empirical_labels", calibratedProbabilityAvailable: false });
}

/** Shared live/replay envelope: normalized values cannot be excluded from the reviewed bytes. */
export function semanticJudgeInput(semanticCase: AuthorizedSemanticCase) {
  if (!authorizedSemanticCases.has(semanticCase)) throw new Error("SEMANTIC_CASE_NOT_AUTHORIZED");
  return {
    rubricVersion: "evidence-only.v1" as const, assertionId: semanticCase.assertionId, proposition: semanticCase.proposition,
    ...(semanticCase.value !== undefined ? { value: structuredClone(semanticCase.value) } : {}),
    qualifiers: [...semanticCase.qualifiers], entityBindings: semanticCase.entityBindings.map(binding => ({ ...binding })),
    fragments: semanticCase.fragments.map(({ fragmentId, exactText }) => ({ fragmentId, exactText })),
  };
}

function freezeValue<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeValue(child);
    Object.freeze(value);
  }
  return value;
}
