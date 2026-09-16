import { z } from "zod";
import { SemanticAssessmentRecordSchema, VerificationPolicyDecisionSchema, VerificationPolicyDefinitionSchema, type VerificationArtifactHandle } from "@aiengineer/knowledge-contracts";
import { canonicalizeJson, digestCanonicalJson, inspectAuditBundle, validateRecordedPolicyInputsArtifact, resolveBuiltInSelector, resolveWithAdmittedResolver, projectionSelectorResolver, type VerificationAuditBundle } from "@aiengineer/knowledge-verification";
import { evaluateVerificationPolicy } from "@aiengineer/knowledge-policy";

import type { AuthoritativeClaim, EvidenceOracle, IngestionIntent } from "@aiengineer/knowledge-ingestion";
import { ClaimsIntentSchema } from "../intents.js";

export interface VerificationEvidenceReader {
  readonly store: {
    readonly tenantId: string;
    resolveHandle(input: { artifactId: string }): Promise<VerificationArtifactHandle>;
    bytes(handle: VerificationArtifactHandle): Promise<Uint8Array>;
  };
  runStatus(input: { runId: string }): Promise<{ state: {
    auditArtifactId?: string; intentArtifactId?: string; resultArtifactId?: string; bundleArtifactId?: string;
    decisionArtifactId?: string; semanticArtifactId?: string;
  } }>;
}

const Semantics = z.object({ schemaVersion: z.literal("verification-semantic-assessments.v1"), runId: z.string(), assessments: z.array(SemanticAssessmentRecordSchema) });
const admitted = new Set(["pass", "pass_with_warnings"]);
const supported = new Set(["directly_supported", "supported_with_qualification", "derived_verified"]);
function deny(): never { throw new Error("EVIDENCE_NOT_AUTHORIZED"); }
const equal = (left: unknown, right: unknown): boolean => canonicalizeJson(left) === canonicalizeJson(right);
export interface ReportEvidenceClaim {
  readonly runId:string; readonly claimId:string; readonly digest:string;
  readonly assertion:VerificationAuditBundle["verificationBundle"]["assertions"][number];
  readonly verdict:string; readonly policyOutcome:string; readonly eligible:boolean;
}
export interface SealedReportEvidence {
  readonly sourceArtifacts: readonly { artifactId: string; digest: string }[];
  readonly reportClaims:ReadonlyMap<string,ReportEvidenceClaim>; readonly manifestDigest:string;
  readonly auditArtifact:{artifactId:string;digest:string}; readonly resultArtifactId:string;
}
interface SealedRun extends SealedReportEvidence {
  readonly claims: ReadonlyMap<string, AuthoritativeClaim>;
  readonly selectedBytes: ReadonlyMap<string, Uint8Array>;
}

/** Shares graph admission with content linking without accepting a caller-authored oracle. */
export async function loadSealedContentClaim(verification: VerificationEvidenceReader, input: {
  tenantId: string; runId: string; claimKey: string; manifestDigest: string;
  policyVersion: string; policyDigest: string;
}): Promise<{ claim: AuthoritativeClaim; assertionDigest: string; selectedText: ReadonlyMap<string, string> }> {
  if (verification.store.tenantId !== input.tenantId) deny();
  const run = await hydrateRun(verification, input);
  const claim = run.claims.get(input.claimKey);
  const assertion = run.reportClaims.get(input.claimKey);
  if (!claim?.provenance || !assertion?.eligible) deny();
  const selectedText = new Map<string, string>();
  for (const edge of claim.provenance.evidence) {
    const bytes = run.selectedBytes.get(JSON.stringify([input.claimKey, edge.fragmentId]));
    if (bytes === undefined) deny();
    selectedText.set(edge.fragmentId, new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  }
  return { claim, assertionDigest: assertion.digest, selectedText };
}

/** Authenticates outcome evidence for reporting, including explicitly rejected assertions. */
export function loadSealedReportEvidence(verification:VerificationEvidenceReader,input:{tenantId:string;runId:string;manifestDigest:string;policyVersion:string;policyDigest:string}):Promise<SealedReportEvidence> {
  if (verification.store.tenantId!==input.tenantId) deny();
  return hydrateRun(verification,{...input,reportMode:true});
}

/** The configured filesystem store is the authority boundary; callers cannot choose a tenant. */
export function verificationStoreOracle(verification: VerificationEvidenceReader, options: { tenantId: string; policyVersion: string; policyDigest: string }): (intent: IngestionIntent) => EvidenceOracle {
  if (verification.store.tenantId !== options.tenantId || !/^sha256:[0-9a-f]{64}$/.test(options.policyDigest)) deny();
  return intent => {
    if (intent.context.tenantId !== options.tenantId) deny();
    const cached = new Map<string, Promise<SealedRun>>();
    const load = (runId: string): Promise<SealedRun> => {
      if (!cached.has(runId)) cached.set(runId, Promise.resolve().then(() => {
        const declared = intent.evidence.verificationRuns.filter(run => run.runId===runId);
        if (declared.length!==1 || !declared[0]?.manifestDigest) deny();
        return hydrateRun(verification, { runId,tenantId:options.tenantId,manifestDigest:declared[0].manifestDigest, policyVersion: options.policyVersion, policyDigest: options.policyDigest });
      }));
      return cached.get(runId)!;
    };
    return {
      runSealed: async runId => { try { await load(runId); return true; } catch { return false; } },
      claimEligible: async (runId, claimId) => {
        try { const claim = (await load(runId)).claims.get(claimId); return claim ? { eligible: true, verdict: claim.verdict, authoritative: claim } : { eligible: false }; }
        catch { return { eligible: false }; }
      },
      reportEligible: async () => ({eligible:false,reason:"LEGACY_REPORT_PUBLISH_UNSUPPORTED"}),
    };
  };
}

async function registered(verification: VerificationEvidenceReader, artifactId: string): Promise<VerificationArtifactHandle> {
  const handle = await verification.store.resolveHandle({ artifactId });
  if (handle.tenantId !== verification.store.tenantId) deny();
  return handle;
}
async function artifactJson(verification: VerificationEvidenceReader, handle: VerificationArtifactHandle): Promise<unknown> {
  if (handle.tenantId !== verification.store.tenantId) deny();
  const bytes = await verification.store.bytes(handle);
  if (bytes.byteLength !== handle.byteLength) deny();
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}

async function hydrateRun(verification: VerificationEvidenceReader, input: { runId: string; tenantId:string;manifestDigest:string;policyVersion: string; policyDigest: string;reportMode?:boolean }): Promise<SealedRun> {
  const { state } = await verification.runStatus({ runId: input.runId });
  if (!state.auditArtifactId || !state.intentArtifactId || !state.resultArtifactId || !state.decisionArtifactId) deny();
  const auditHandle = await registered(verification, state.auditArtifactId);
  const audit = await artifactJson(verification, auditHandle) as VerificationAuditBundle;
  if (audit.tenantId !== input.tenantId || audit.manifest.runId !== input.runId) deny();
  const inspection = await inspectAuditBundle(audit);
  if (!inspection.valid || inspection.signatureStatus === "invalid" || inspection.signatureStatus === "unverified" || inspection.manifestDigest !== input.manifestDigest) deny();
  if (audit.policyBinding.policyArtifact.digest !== input.policyDigest) deny();
  if (audit.policyBinding.policyVersion !== input.policyVersion || (!input.reportMode && !admitted.has(audit.manifest.policyOutcome))) deny();
  const handles = new Map([...audit.manifest.inputArtifacts, ...audit.manifest.outputArtifacts].map(handle => [handle.artifactId, handle]));
  const bytes = new Map<string, Uint8Array>();
  for (const expected of handles.values()) {
    const actual = await registered(verification, expected.artifactId);
    if (!equal(expected, actual)) deny();
    const content = await verification.store.bytes(actual);
    if (content.byteLength !== actual.byteLength) deny();
    bytes.set(actual.artifactId, content);
  }
  const read = (id: string): unknown => {
    const content = bytes.get(id);
    if (!content) deny();
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(content)) as unknown;
  };
  const claimsIntent = ClaimsIntentSchema.parse(read(state.intentArtifactId));
  const semantics = state.semanticArtifactId ? Semantics.parse(read(state.semanticArtifactId)) : undefined;
  if ((semantics && semantics.runId !== input.runId) || claimsIntent.policyVersion !== input.policyVersion) deny();
  const result = audit.manifest.deterministicResult;
  if (!equal(read(state.resultArtifactId), result) || digestCanonicalJson(result) !== audit.deterministicResultDigest || (!input.reportMode && (result.status !== "passed" || !result.semanticEligibility))) deny();
  const definition = VerificationPolicyDefinitionSchema.parse(read(audit.policyBinding.policyArtifact.artifactId));
  const inputs = validateRecordedPolicyInputsArtifact({ handle: audit.policyBinding.recordedPolicyInputsArtifact,
    bytes: bytes.get(audit.policyBinding.recordedPolicyInputsArtifact.artifactId)!, bundle: audit.verificationBundle,
    deterministicResult: result, runId: input.runId, policyVersion: input.policyVersion });
  if (!semantics && inputs.assertions.some(item => item.semantic.judgeIdentities.length > 0)) deny();
  const decision = VerificationPolicyDecisionSchema.parse(read(state.decisionArtifactId));
  if (!equal(evaluateVerificationPolicy(definition, inputs), decision) || digestCanonicalJson(decision) !== audit.policyDecisionDigest || decision.overrideApplied) deny();
  const claims = new Map<string, AuthoritativeClaim>();
  const selectedBytes = new Map<string, Uint8Array>();
  const reportClaims = new Map<string,ReportEvidenceClaim>();
  for (const assertion of audit.verificationBundle.assertions) {
    const source = claimsIntent.claims.filter(claim => claim.claimId === assertion.assertionId);
    const mechanical = result.assertions.filter(item => item.assertionId === assertion.assertionId);
    const semantic = semantics?.assessments.filter(item => item.assertionId === assertion.assertionId) ?? [];
    const policyInput = inputs.assertions.find(item => item.assertionId === assertion.assertionId);
    const outcome = decision.assertionOutcomes.filter(item => item.assertionId === assertion.assertionId);
    if (source.length !== 1 || mechanical.length !== 1 || outcome.length !== 1 || !policyInput) continue;
    const claim = source[0]!; const judgment = semantic[0];
    if (claim.proposition !== assertion.proposition || claim.claimType !== assertion.claimType || !equal(claim.qualifiers, assertion.qualifiers)
      || !equal(claim.entityBindings, assertion.entityBindings) || !equal(claim.value ?? null, assertion.value ?? null) || !equal(claim.downstreamUse, assertion.downstreamUse)) deny();
    if (semantic.length>1 || (judgment && !equal(judgment,policyInput.semantic))) deny();
    const literal = policyInput.literalExtraction === true && outcome[0]!.reasonCodes.includes("LITERAL_EXTRACTION_POLICY_AUTHORIZED") && semantic.length === 0;
    const semanticAdmission = semantic.length === 1 && judgment && supported.has(judgment.verdict) && judgment.disposition === "admit"
      && judgment.judgeIdentities.length > 0 && equal(judgment, policyInput.semantic)
      && (assertion.value === undefined || judgment.assertionValueDigest === digestCanonicalJson(assertion.value));
    const eligible = mechanical[0]!.status === "passed" && mechanical[0]!.semanticEligibility && admitted.has(outcome[0]!.outcome) && Boolean(literal || semanticAdmission);
    reportClaims.set(claim.claimId,{runId:input.runId,claimId:claim.claimId,digest:digestCanonicalJson(assertion),assertion,
      verdict:literal?"literal_extraction_verified":policyInput.semantic.verdict,policyOutcome:outcome[0]!.outcome,eligible});
    if (!eligible) continue;
    if (claim.proposition !== assertion.proposition || claim.claimType !== assertion.claimType || !equal(claim.qualifiers, assertion.qualifiers)
      || !equal(claim.entityBindings, assertion.entityBindings) || !equal(claim.value ?? null, assertion.value ?? null) || !equal(claim.downstreamUse, assertion.downstreamUse)) continue;
    const evidence = assertion.evidence.map(edge => {
      const capture = audit.verificationBundle.captures.find(item => item.captureId === edge.fragment.captureId);
      const source = capture && audit.verificationBundle.sources.find(item => item.sourceId === capture.sourceId);
      const resolution = mechanical[0]!.evidence.find(item => item.evidenceId === edge.evidenceId);
      if (!capture || !source || resolution?.status !== "passed" || !resolution.resolution.selectedContentDigest) deny();
      const representation = handles.get(edge.fragment.representationArtifactId);
      const content = bytes.get(edge.fragment.representationArtifactId);
      if (!representation || !content) deny();
      const request = { captureId: capture.captureId, representationArtifactId: representation.artifactId, representationDigest: representation.digest, selector: edge.fragment.selector, content };
      const selected = resolveBuiltInSelector(request) ?? resolveWithAdmittedResolver(request, [projectionSelectorResolver]);
      if (!selected || !equal(selected.resolution, resolution.resolution)) deny();
      selectedBytes.set(JSON.stringify([claim.claimId, edge.fragment.fragmentId]), selected.selectedContent);
      return { source, capture: { captureId: capture.captureId, capturedAt: capture.capturedAt, captureMethod: capture.captureMethod,
        captureMethodVersion: capture.captureMethodVersion, artifactId: capture.contentArtifact.artifactId, digest: capture.contentArtifact.digest,
        mediaType: capture.contentArtifact.mediaType, byteLength: capture.contentArtifact.byteLength },
        fragmentId: edge.fragment.fragmentId, representationArtifactId: edge.fragment.representationArtifactId, selector: edge.fragment.selector,
        selectedContentDigest: resolution.resolution.selectedContentDigest, selectedSizeBytes: selected.selectedContent.byteLength,
        occurrenceCount: resolution.resolution.occurrenceCount,
        selectorDigest: resolution.resolution.selectorDigest, normalization: resolution.resolution.normalization, resolverVersion: resolution.resolution.resolverVersion,
        role: edge.role, authority: edge.authority,
        parserLineageArtifactIds: edge.parserLineageArtifactIds };
    });
    claims.set(claim.claimId, { statement: claim.proposition, claimType: claim.claimType, qualifiers: claim.qualifiers,
      ...(claim.value !== undefined ? { value: claim.value } : {}), entityBindings: claim.entityBindings, verdict: literal ? "literal_extraction_verified" : judgment!.verdict,
      manifestDigest: inspection.manifestDigest, policyVersion: definition.policyVersion, downstreamUse: claim.downstreamUse,
      provenance: { tenantId: input.tenantId, auditArtifactId: auditHandle.artifactId,
        policyArtifactId: audit.policyBinding.policyArtifact.artifactId, policyDigest: input.policyDigest,
        decisionArtifactId: state.decisionArtifactId, decisionDigest: audit.policyDecisionDigest, outcome: outcome[0]!.outcome,
        run: { runId: input.runId, producerAttemptId: audit.verificationBundle.producer.attemptId, producerDeploymentId: audit.verificationBundle.producer.deploymentId,
          verifierAttemptId: audit.verificationBundle.verifier.attemptId, verifierDeploymentId: audit.verificationBundle.verifier.deploymentId,
          bundleArtifactId: state.bundleArtifactId!, resultArtifactId: state.resultArtifactId, auditDigest: auditHandle.digest,
          startedAt: audit.manifest.startedAt, completedAt: audit.manifest.completedAt },
        assessment: { properties: policyInput.semantic, supportingFragmentIds: policyInput.semantic.supportingFragmentIds,
          contradictingFragmentIds: policyInput.semantic.contradictingFragmentIds, unsupportedFacets: policyInput.semantic.unsupportedFacets,
          reasonCodes: outcome[0]!.reasonCodes, inputsDigest: audit.policyBinding.recordedPolicyInputsArtifact.digest,
          outputSchemaDigest: digestCanonicalJson(z.toJSONSchema(VerificationPolicyDecisionSchema)) }, evidence } });
  }
  const sourceArtifacts = [...new Set(audit.verificationBundle.assertions.flatMap(assertion =>
    assertion.evidence.map(edge => edge.fragment.representationArtifactId)))].map(id => {
      const artifact = handles.get(id);
      if (!artifact) deny();
      return { artifactId: artifact.artifactId, digest: artifact.digest };
    });
  return { claims, selectedBytes,reportClaims,sourceArtifacts,auditArtifact:{artifactId:auditHandle.artifactId,digest:auditHandle.digest}, manifestDigest: inspection.manifestDigest, resultArtifactId: state.resultArtifactId };
}

