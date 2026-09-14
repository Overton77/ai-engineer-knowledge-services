import { describe, expect, it } from "vitest";
import { admissionIssues, proposalEffect, type AuthoritativeClaim } from "./evidence-admission.js";
import { IngestionIntentSchema, type Proposal } from "./intent.js";
import { buildPlan, type PlanFacts } from "./plan.js";
import { fixtureFacts } from "./test-fixtures.js";

const tenantId = "00000000-0000-4000-8000-000000000011";
const entityId = "00000000-0000-4000-8000-000000000022";
const claim: AuthoritativeClaim = { statement: "Synthetic system is in preview.", claimType: "capability", qualifiers: ["in preview"], entityBindings: [{ role: "subject", canonicalId: entityId }], verdict: "supported_with_qualification", manifestDigest: "sha256:test", policyVersion: "fixture.v1", downstreamUse: ["knowledge_ingestion:claim.materialize", "knowledge_ingestion:fact.assert_state", "source_attributed_report"] };
const materialize = { proposalId: "claims", kind: "claim.materialize", runId: "run-a", claimIds: ["c1"] };
function fixture(proposal: unknown = materialize) {
  const intent = IngestionIntentSchema.parse({ schemaVersion: "knowledge-ingestion-intent.v1", intentId: "admission-unit", context: { tenantId, attemptId: tenantId }, evidence: { verificationRuns: [], claims: [] }, subjects: [{ mode: "resolved", ref: "system", kind: "ai_model_version", entityId }], proposals: [proposal] });
  const facts: PlanFacts = { ...fixtureFacts(), claims: [{ runId: "run-a", claimId: "c1", sealed: true, eligible: true, authoritative: structuredClone(claim), claimRowId: null }] };
  return { intent, proposal: intent.proposals[0]!, facts };
}
const codes = (input: ReturnType<typeof fixture>) => admissionIssues(input).map(issue => issue.code);

describe("authoritative admission matrix", () => {
  it("allows hydrated claim materialization without caller inline text", () => { expect(codes(fixture())).toEqual([]); });
  it("rejects empty evidence on an accepted effect (F01)", () => { expect(codes(fixture({ proposalId: "event", kind: "event.assert", eventKind: "founded", subjectRef: "system", occurredDuring: { from: "2026-01-01T00:00:00Z", to: null } }))).toEqual(["EVIDENCE_REQUIRED"]); });
  it("permits evidence-free staging without canonical admission", () => { expect(codes(fixture({ proposalId: "stage", kind: "candidate.stage", entityKind: "organization", displayName: "Synthetic", reason: "needs_human" }))).toEqual([]); });
  it("rejects boolean-only evidence without authenticated bytes", () => { const f = fixture(); delete (f.facts.claims[0] as { authoritative?: AuthoritativeClaim }).authoritative; expect(codes(f)).toEqual(["AUTHORITATIVE_CLAIM_REQUIRED"]); });
  it("requires policy intended use (F04)", () => { const f = fixture(); Object.assign(f.facts.claims[0]!.authoritative!, { downstreamUse: ["source_attributed_report"] }); expect(codes(f)).toEqual(["EVIDENCE_INTENDED_USE_MISMATCH"]); });
  it.each(["statement", "verdict", "qualifiers"])("rejects altered inline %s (F05/F08)", field => {
    const f = fixture(); f.intent.evidence.claims.push({ runId: "run-a", claimId: "c1", statement: claim.statement, claimType: "capability", qualifiers: [...claim.qualifiers], verdict: claim.verdict, subjects: [] });
    Object.assign(f.intent.evidence.claims[0]!, { [field]: field === "qualifiers" ? [] : "altered" }); expect(codes(f)).toEqual(["INLINE_CLAIM_MISMATCH"]);
  });
  it("holds claim/new-entity links before materialization (F12)", () => { const f = fixture(); f.intent.subjects = [{ mode: "new", ref: "system", kind: "ai_model_version", displayName: "new", aliases: [], identifiers: [], typedPayload: {}, onMatch: "review", evidence: [] }]; expect(codes(f)).toEqual(["CLAIM_SUBJECT_REVERIFICATION_REQUIRED"]); });
  it("rejects prose-only authorization of a normalized effect", () => {
    const f = fixture({ proposalId: "fact", kind: "fact.assert_state", subjectRef: "system", streamKind: "model_offering_availability", status: "ga", worldInterval: { from: "2026-01-01T00:00:00Z", to: null }, temporalBasis: "explicit", proposition: claim.statement, qualifiers: [...claim.qualifiers], evidence: [{ runId: "run-a", claimId: "c1" }] });
    expect(codes(f)).toEqual(["PROPOSAL_REVERIFICATION_REQUIRED"]);
    Object.assign(f.facts.claims[0]!.authoritative!, { value: proposalEffect(f.intent, f.proposal) }); expect(codes(f)).toEqual([]);
    (f.proposal as Extract<Proposal, {kind: "fact.assert_state"}>).status = "preview"; expect(codes(f)).toEqual(["PROPOSAL_REVERIFICATION_REQUIRED"]);
  });
  it("requires exact run-qualified report references (F10)", () => {
    const f = fixture({ proposalId: "report", kind: "report.publish", title: "Report", asOf: "2026", markdown: claim.statement, claimRefs: [{ runId: "run-b", claimId: "c1" }] }); expect(codes(f)).toEqual(["EVIDENCE_NOT_ELIGIBLE"]);
  });
  it("requires complete verified report binding (F11)", () => {
    const f = fixture({ proposalId: "report", kind: "report.publish", title: "Report", asOf: "2026", markdown: claim.statement, claimRefs: [{ runId: "run-a", claimId: "c1" }] }); expect(codes(f)).toEqual(["REPORT_BINDING_REQUIRED"]);
  });
  it("requires a materialized claim for canonical effects", () => {
    const f = fixture({ proposalId: "report", kind: "report.publish", title: "Report", asOf: "2026", markdown: claim.statement, claimRefs: [{ runId: "run-a", claimId: "c1" }] });
    const facts = { ...f.facts, reports: { report: { eligible: true } }, subjects: { system: { ref: "system", kind: "ai_model_version", lifecycle: "active" as const } } };
    const plan = buildPlan(f.intent, facts, { version: "unit", migrationHead: "test" }); expect(plan.proposals[0]).toMatchObject({ outcome: "held", reason: "claim_row_required", actions: [] }); expect(plan.plannedOutcome).toBe("partial");
  });  it("holds a dependency chain transitively while admitting an independent closure", () => {
    const f = fixture({ proposalId: "stage", kind: "candidate.stage", entityKind: "organization", displayName: "Review", reason: "needs_human" });
    f.intent.proposals.push(...IngestionIntentSchema.parse({ ...f.intent, proposals: [
      { ...materialize, proposalId: "dependent", dependsOn: ["stage"] },
      { ...materialize, proposalId: "transitive", dependsOn: ["dependent"] },
      { ...materialize, proposalId: "independent" },
    ] }).proposals);
    const plan = buildPlan(f.intent, { ...f.facts, subjects: { system: { ref: "system", kind: "ai_model_version", lifecycle: "active" } } }, { version: "unit", migrationHead: "test" });
    expect(plan.errors).toEqual([]); expect(plan.plannedOutcome).toBe("partial");
    expect(plan.proposals.find(item => item.proposalId === "dependent")).toMatchObject({ outcome: "held", actions: [] });
    expect(plan.proposals.find(item => item.proposalId === "transitive")).toMatchObject({ outcome: "held", actions: [] });
    expect(plan.proposals.find(item => item.proposalId === "independent")).toMatchObject({ outcome: "admitted" });
  });

});
