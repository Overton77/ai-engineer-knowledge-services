import { canonicalJson } from "@aiengineer/knowledge-db-read";
import { subjectRefsOf, type IngestionIntent, type Proposal } from "./intent.js";
import type { ClaimFacts, PlanFacts } from "./plan.js";
import type { VocabularyIssue } from "./validate.js";

/** A trusted oracle hydrates these fields from registered, sealed artifact bytes. */
export interface AuthoritativeClaim {
  readonly statement: string;
  readonly claimType: string;
  readonly qualifiers: readonly string[];
  readonly value?: string | number | boolean | null;
  readonly entityBindings: readonly { role: string; canonicalId: string }[];
  readonly verdict: string;
  readonly manifestDigest: string;
  readonly policyVersion: string;
  readonly downstreamUse: readonly string[];
}
export interface ReportEvidence { readonly eligible: boolean; readonly reason?: string }
export interface ClaimEligibility { readonly eligible: boolean; readonly verdict?: string; readonly authoritative?: AuthoritativeClaim; readonly fixtureOnly?: boolean }

export function proposalClaims(proposal: Proposal): readonly { runId: string; claimId: string }[] {
  if (proposal.kind === "claim.materialize") return proposal.claimIds.map(claimId => ({ runId: proposal.runId, claimId }));
  if (proposal.kind === "report.publish") return proposal.claimRefs ?? [];
  return proposal.evidence;
}

/** Exact normalized effect encoding for scalar claim values; prose alone cannot authorize SQL effects. */
export function proposalEffect(intent: IngestionIntent, proposal: Proposal): string {
  const { proposalId: _id, evidence: _evidence, dependsOn: _dependencies, rationale: _rationale,
    reportBinding: _report, proposition: _statement, qualifiers: _qualifiers, ...effect } = proposal;
  const subjects = subjectRefsOf(proposal).map(ref => intent.subjects.find(subject => subject.ref === ref) ?? null);
  return canonicalJson({ effect, subjects });
}

export function admissionIssues(input: { intent: IngestionIntent; proposal: Proposal; facts: PlanFacts }): VocabularyIssue[] {
  const { intent, proposal, facts } = input;
  if (proposal.kind === "candidate.stage") return [];
  const issue = (code: string): VocabularyIssue[] => [{ code, message: `${proposal.proposalId}: ${code}` }];
  const references = proposalClaims(proposal);
  if (!references.length) return issue("EVIDENCE_REQUIRED");
  const claims = references.map(ref => facts.claims.find(claim => claim.runId === ref.runId && claim.claimId === ref.claimId));
  if (claims.some(claim => !claim?.eligible)) return issue("EVIDENCE_NOT_ELIGIBLE");
  const verified = claims as ClaimFacts[];
  if (verified.every(claim => claim.fixtureOnly)) return [];
  if (verified.some(claim => !claim.authoritative)) return issue("AUTHORITATIVE_CLAIM_REQUIRED");
  for (const claim of verified) {
    const authoritative = claim.authoritative!;
    const use = proposal.kind === "report.publish" ? "source_attributed_report" : `knowledge_ingestion:${proposal.kind}`;
    if (!authoritative.downstreamUse.includes(use)) return issue("EVIDENCE_INTENDED_USE_MISMATCH");
    const inline = intent.evidence.claims.find(item => item.runId === claim.runId && item.claimId === claim.claimId);
    if (inline && (inline.statement !== authoritative.statement || inline.claimType !== authoritative.claimType
      || (inline.verdict !== undefined && inline.verdict !== authoritative.verdict)
      || canonicalJson(inline.qualifiers ?? []) !== canonicalJson(authoritative.qualifiers))) return issue("INLINE_CLAIM_MISMATCH");
    if (inline?.subjects.some(subject => {
      const resolved = intent.subjects.find(item => item.ref === subject.ref);
      return !resolved || resolved.mode !== "resolved" || !authoritative.entityBindings.some(binding => binding.role === subject.role && binding.canonicalId === resolved.entityId);
    })) return issue("CLAIM_SUBJECT_REVERIFICATION_REQUIRED");
    if (proposal.kind !== "claim.materialize" && proposal.kind !== "report.publish") {
      if (proposal.proposition !== authoritative.statement || canonicalJson(proposal.qualifiers ?? []) !== canonicalJson(authoritative.qualifiers)
        || authoritative.value !== proposalEffect(intent, proposal)) return issue("PROPOSAL_REVERIFICATION_REQUIRED");
    }
    if (proposal.kind === "claim.materialize" && authoritative.entityBindings.some(binding => !intent.subjects.some(subject => subject.mode === "resolved" && subject.entityId === binding.canonicalId))) return issue("CLAIM_SUBJECT_REVERIFICATION_REQUIRED");
  }
  if (proposal.kind === "report.publish" && !facts.reports?.[proposal.proposalId]?.eligible) return issue("REPORT_BINDING_REQUIRED");
  return [];
}
