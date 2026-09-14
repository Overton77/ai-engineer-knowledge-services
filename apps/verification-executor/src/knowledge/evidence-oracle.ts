import { z } from "zod";
import { SemanticAssessmentRecordSchema, VerificationPolicyDecisionSchema, VerificationPolicyDefinitionSchema, type VerificationArtifactHandle } from "@aiengineer/knowledge-contracts";
import { canonicalizeJson, digestCanonicalJson, inspectAuditBundle, validateRecordedPolicyInputsArtifact, type VerificationAuditBundle } from "@aiengineer/knowledge-verification";
import { evaluateVerificationPolicy } from "@aiengineer/knowledge-policy";
import { sha256Hex } from "@aiengineer/knowledge-db-read";
import type { AuthoritativeClaim, EvidenceOracle, IngestionIntent, ProposalOf } from "@aiengineer/knowledge-ingestion";
import { ClaimsIntentSchema, ReportIntentSchema } from "../intents.js";
import type { VerificationExecutor } from "../executor.js";

const Semantics = z.object({ schemaVersion: z.literal("verification-semantic-assessments.v1"), runId: z.string(), assessments: z.array(SemanticAssessmentRecordSchema) });
const Check = z.object({ schemaVersion: z.literal("verification-report-check.v1"), claimsRunId: z.string(), reportDigest: z.string(),
  problems: z.array(z.string()), citationsOnFailedClaims: z.array(z.string()), citationsUnderReview: z.array(z.string()),
  summary: z.object({ claimWeightedCitationCompleteness: z.number(), citationCorrectness: z.number().nullable(), pointerFailures: z.array(z.string()), missingQualifierAssertionIds: z.array(z.string()), unsupportedHighSeverityAssertionIds: z.array(z.string()) }),
});
const admitted = new Set(["pass", "pass_with_warnings"]);
const supported = new Set(["directly_supported", "supported_with_qualification", "derived_verified"]);
function deny(): never { throw new Error("EVIDENCE_NOT_AUTHORIZED"); }
const equal = (left: unknown, right: unknown): boolean => canonicalizeJson(left) === canonicalizeJson(right);
interface SealedRun { readonly claims: ReadonlyMap<string, AuthoritativeClaim>; readonly manifestDigest: string; readonly resultArtifactId: string }

/** The configured filesystem store is the authority boundary; callers cannot choose a tenant. */
export function verificationStoreOracle(verification: VerificationExecutor, options: { tenantId: string; policyVersion: string; policyDigest: string }): (intent: IngestionIntent) => EvidenceOracle {
  if (verification.store.tenantId !== options.tenantId || !/^sha256:[0-9a-f]{64}$/.test(options.policyDigest)) deny();
  return intent => {
    if (intent.context.tenantId !== options.tenantId) deny();
    const cached = new Map<string, Promise<SealedRun>>();
    const load = (runId: string): Promise<SealedRun> => {
      if (!cached.has(runId)) cached.set(runId, hydrateRun(verification, { runId, intent, policyVersion: options.policyVersion, policyDigest: options.policyDigest }));
      return cached.get(runId)!;
    };
    return {
      runSealed: async runId => { try { await load(runId); return true; } catch { return false; } },
      claimEligible: async (runId, claimId) => {
        try { const claim = (await load(runId)).claims.get(claimId); return claim ? { eligible: true, verdict: claim.verdict, authoritative: claim } : { eligible: false }; }
        catch { return { eligible: false }; }
      },
      reportEligible: async proposal => {
        try { await verifyReport(verification, proposal, load); return { eligible: true }; }
        catch { return { eligible: false, reason: "REPORT_BINDING_INVALID" }; }
      },
    };
  };
}

async function registered(verification: VerificationExecutor, artifactId: string): Promise<VerificationArtifactHandle> {
  const handle = await verification.store.resolveHandle({ artifactId });
  if (handle.tenantId !== verification.store.tenantId) deny();
  return handle;
}
async function artifactJson(verification: VerificationExecutor, handle: VerificationArtifactHandle): Promise<unknown> {
  if (handle.tenantId !== verification.store.tenantId) deny();
  const bytes = await verification.store.bytes(handle);
  if (bytes.byteLength !== handle.byteLength) deny();
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}

async function hydrateRun(verification: VerificationExecutor, input: { runId: string; intent: IngestionIntent; policyVersion: string; policyDigest: string }): Promise<SealedRun> {
  const declared = input.intent.evidence.verificationRuns.filter(run => run.runId === input.runId);
  if (declared.length !== 1 || !declared[0]?.manifestDigest) deny();
  const { state } = await verification.runStatus({ runId: input.runId });
  if (!state.auditArtifactId || !state.intentArtifactId || !state.resultArtifactId || !state.decisionArtifactId) deny();
  const auditHandle = await registered(verification, state.auditArtifactId);
  const audit = await artifactJson(verification, auditHandle) as VerificationAuditBundle;
  if (audit.tenantId !== input.intent.context.tenantId || audit.manifest.runId !== input.runId) deny();
  const inspection = await inspectAuditBundle(audit);
  if (!inspection.valid || inspection.signatureStatus === "invalid" || inspection.signatureStatus === "unverified" || inspection.manifestDigest !== declared[0]!.manifestDigest) deny();
  if (audit.policyBinding.policyArtifact.digest !== input.policyDigest) deny();
  if (audit.policyBinding.policyVersion !== input.policyVersion || !admitted.has(audit.manifest.policyOutcome)) deny();
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
  if (!equal(read(state.resultArtifactId), result) || digestCanonicalJson(result) !== audit.deterministicResultDigest || result.status !== "passed" || !result.semanticEligibility) deny();
  const definition = VerificationPolicyDefinitionSchema.parse(read(audit.policyBinding.policyArtifact.artifactId));
  const inputs = validateRecordedPolicyInputsArtifact({ handle: audit.policyBinding.recordedPolicyInputsArtifact,
    bytes: bytes.get(audit.policyBinding.recordedPolicyInputsArtifact.artifactId)!, bundle: audit.verificationBundle,
    deterministicResult: result, runId: input.runId, policyVersion: input.policyVersion });
  if (!semantics && inputs.assertions.some(item => item.semantic.judgeIdentities.length > 0)) deny();
  const decision = VerificationPolicyDecisionSchema.parse(read(state.decisionArtifactId));
  if (!equal(evaluateVerificationPolicy(definition, inputs), decision) || digestCanonicalJson(decision) !== audit.policyDecisionDigest || decision.overrideApplied) deny();
  const claims = new Map<string, AuthoritativeClaim>();
  for (const assertion of audit.verificationBundle.assertions) {
    const source = claimsIntent.claims.filter(claim => claim.claimId === assertion.assertionId);
    const mechanical = result.assertions.filter(item => item.assertionId === assertion.assertionId);
    const semantic = semantics?.assessments.filter(item => item.assertionId === assertion.assertionId) ?? [];
    const policyInput = inputs.assertions.find(item => item.assertionId === assertion.assertionId);
    const outcome = decision.assertionOutcomes.filter(item => item.assertionId === assertion.assertionId);
    if (source.length !== 1 || mechanical.length !== 1 || outcome.length !== 1 || !policyInput) continue;
    const claim = source[0]!; const judgment = semantic[0];
    const literal = policyInput.literalExtraction === true && outcome[0]!.reasonCodes.includes("LITERAL_EXTRACTION_POLICY_AUTHORIZED") && semantic.length === 0;
    const semanticAdmission = semantic.length === 1 && judgment && supported.has(judgment.verdict) && judgment.disposition === "admit"
      && judgment.judgeIdentities.length > 0 && equal(judgment, policyInput.semantic)
      && (assertion.value === undefined || judgment.assertionValueDigest === digestCanonicalJson(assertion.value));
    if (mechanical[0]!.status !== "passed" || !mechanical[0]!.semanticEligibility || !admitted.has(outcome[0]!.outcome) || (!literal && !semanticAdmission)) continue;
    if (claim.proposition !== assertion.proposition || claim.claimType !== assertion.claimType || !equal(claim.qualifiers, assertion.qualifiers)
      || !equal(claim.entityBindings, assertion.entityBindings) || !equal(claim.value ?? null, assertion.value ?? null) || !equal(claim.downstreamUse, assertion.downstreamUse)) continue;
    claims.set(claim.claimId, { statement: claim.proposition, claimType: claim.claimType, qualifiers: claim.qualifiers,
      ...(claim.value !== undefined ? { value: claim.value } : {}), entityBindings: claim.entityBindings, verdict: literal ? "literal_extraction_verified" : judgment!.verdict,
      manifestDigest: inspection.manifestDigest, policyVersion: definition.policyVersion, downstreamUse: claim.downstreamUse });
  }
  return { claims, manifestDigest: inspection.manifestDigest, resultArtifactId: state.resultArtifactId };
}

async function verifyReport(verification: VerificationExecutor, proposal: ProposalOf<"report.publish">, load: (runId: string) => Promise<SealedRun>): Promise<void> {
  if (!proposal.reportCheck || !proposal.markdown || proposal.reportArtifactId || !proposal.claimRefs?.length) deny();
  const refs = proposal.claimRefs;
  if (proposal.claimIds.length && !equal([...proposal.claimIds].sort(), refs.map(ref => ref.claimId).sort())) deny();
  if (refs.some(ref => ref.runId !== proposal.reportCheck!.runId) || new Set(refs.map(ref => ref.claimId)).size !== refs.length) deny();
  const run = await load(proposal.reportCheck.runId);
  if (refs.some(ref => !run.claims.has(ref.claimId))) deny();
  const handle = await registered(verification, proposal.reportCheck.artifactId);
  if (handle.digest !== proposal.reportCheck.digest || !handle.producerActivityId.endsWith(":check_report")) deny();
  const check = Check.parse(await artifactJson(verification, handle));
  if (check.claimsRunId !== proposal.reportCheck.runId || check.reportDigest !== `sha256:${sha256Hex(proposal.markdown)}`
    || check.problems.length || check.citationsOnFailedClaims.length || check.citationsUnderReview.length
    || check.summary.claimWeightedCitationCompleteness !== 1 || check.summary.citationCorrectness !== 1
    || check.summary.pointerFailures.length || check.summary.missingQualifierAssertionIds.length || check.summary.unsupportedHighSeverityAssertionIds.length) deny();
  const parents = await Promise.all(handle.parentArtifactIds.map(id => registered(verification, id)));
  if (!parents.some(parent => parent.artifactId === run.resultArtifactId) || !parents.some(parent => parent.digest === check.reportDigest)) deny();
  const parentValues = await Promise.all(parents.map(parent => artifactJson(verification, parent).catch(() => undefined)));
  const reportIntents = parentValues.map(value => ReportIntentSchema.safeParse(value)).filter(value => value.success);
  if (reportIntents.length !== 1 || !reportIntents[0]!.success) deny();
  const intent = reportIntents[0]!.data;
  if (intent.claimsRunId !== proposal.reportCheck.runId) deny();
  const checkedIds = [...new Set(intent.assertions.flatMap(assertion => assertion.claimIds))].sort();
  if (!equal(checkedIds, refs.map(ref => ref.claimId).sort())) deny();
  for (const assertion of intent.assertions) for (const claimId of assertion.claimIds) {
    const claim = run.claims.get(claimId)!;
    if (assertion.exactText !== claim.statement || !equal(assertion.requiredQualifiers, claim.qualifiers)) deny();
  }
}
