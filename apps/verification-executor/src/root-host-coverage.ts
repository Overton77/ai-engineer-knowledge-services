import { z } from "zod";
import { digestCanonicalJson, sha256Digest } from "@aiengineer/knowledge-verification";
import type { VerificationExecutor } from "./executor.js";
import { deterministicUuid } from "./store.js";
import { createRootRunInspector } from "./root-host-inspection.js";
import { ClaimIntentSchema } from "./intents.js";

export const RootCoverageScopeSchema = z.strictObject({
  questionId: z.string().min(1),
  facets: z.array(z.strictObject({ id: ClaimIntentSchema.shape.claimId, proposition: ClaimIntentSchema.shape.proposition,
    qualifiers: ClaimIntentSchema.shape.qualifiers })).min(1).max(8),
}).superRefine((scope, context) => {
  if (new Set(scope.facets.map(facet => facet.id)).size !== scope.facets.length)
    context.addIssue({ code: "custom", message: "Coverage facet IDs must be unique" });
});
export type RootCoverageScope = z.infer<typeof RootCoverageScopeSchema>;

export function coverageFragments(markdown: string): string[] {
  const fragments: string[] = [];
  let current = "";
  for (const character of markdown) {
    if (current.length + character.length > 4000) {
      fragments.push(current);
      current = "";
      if (fragments.length === 8) throw new Error("ROOT_COVERAGE_REPORT_CAPACITY_EXCEEDED");
    }
    current += character;
  }
  if (current) fragments.push(current);
  if (!fragments.length) throw new Error("ROOT_COVERAGE_REPORT_EMPTY");
  return fragments;
}

/** Evaluation only: these claims judge report completeness and are never ingestion authority. */
export function createRootCoverageEvaluator(input: { verification: VerificationExecutor; tenantId: string;
  policyVersion: string; policyDigest: string; scope: RootCoverageScope;
  loadReport: (reportVersionId: string) => Promise<{ artifactId: string; digest: string; markdown: string }>;
}) {
  const scope = RootCoverageScopeSchema.parse(structuredClone(input.scope));
  const scopeDigest = digestCanonicalJson(scope), pending = new Map<string, Promise<unknown>>();
  const evaluate = async (reportVersionId: string) => {
    z.uuid().parse(reportVersionId);
    const report = await input.loadReport(reportVersionId);
    if (sha256Digest(report.markdown) !== report.digest) throw new Error("ROOT_COVERAGE_REPORT_DIGEST");
    const fragments = coverageFragments(report.markdown);
    const runId = deterministicUuid("root-report-coverage-fragments.v2", `${input.tenantId}:${reportVersionId}:${report.digest}:${scopeDigest}:${input.policyDigest}`);
    const verification = input.verification;
    let state = (await verification.runStatus({ runId })).state;
    if (!state.resultArtifactId) {
      const evidence: { captureId: string; quote: string }[] = [];
      for (const [index, quote] of fragments.entries()) {
        const captured = await verification.captureFile({ runId, filename: `report-coverage-${index + 1}.txt`,
          sourceUri: `https://t14.invalid/evaluation/report/${reportVersionId}/part/${index + 1}`,
          bytes: new TextEncoder().encode(quote) });
        evidence.push({ captureId: captured.captureId, quote });
      }
      const verified = await verification.verifyClaims({ runId, intent: { schemaVersion: "verification-claims-intent.v1",
        intentId: `report-coverage:${runId}`, claims: scope.facets.map(facet => ({ claimId: facet.id,
          proposition: facet.proposition, qualifiers: facet.qualifiers, claimType: "capability",
          downstreamUse: ["source_attributed_report"], evidence })) } });
      if (verified.status !== "passed") throw new Error(`ROOT_COVERAGE_DETERMINISTIC_FAILURE:${JSON.stringify({
        captureChecks: verified.captureChecks, assertions: verified.assertions })}`);
      state = (await verification.runStatus({ runId })).state;
    }
    if (!state.semanticArtifactId) await verification.judgeSemantics({ runId });
    state = (await verification.runStatus({ runId })).state;
    if (!state.decisionArtifactId) await verification.evaluatePolicy({ runId });
    state = (await verification.runStatus({ runId })).state;
    if (!state.auditArtifactId) await verification.sealRun({ runId });
    const inspected = await createRootRunInspector({ verification, tenantId: input.tenantId,
      policyVersion: input.policyVersion, policyDigest: input.policyDigest, allowedRunIds: [runId] })(runId);
    const results = scope.facets.map(facet => {
      const claim = inspected.claims.find(claim => claim.claimId === facet.id);
      if (!claim || claim.assertion.proposition !== facet.proposition
        || digestCanonicalJson(claim.assertion.qualifiers) !== digestCanonicalJson(facet.qualifiers))
        throw new Error("ROOT_COVERAGE_FACET_BINDING");
      return { id: facet.id, covered: claim.eligible, verdict: claim.verdict, policyOutcome: claim.policyOutcome };
    });
    return { schemaVersion: "t14-report-coverage.v1", evaluatorVersion: "report-coverage-fragments.v2", classification: "synthetic-engineering-evaluation-not-human-gold",
      questionId: scope.questionId, scopeDigest, reportVersionId, reportArtifact: { artifactId: report.artifactId, digest: report.digest },
      fragmentDigests: fragments.map(sha256Digest),
      passed: results.every(result => result.covered), facets: results, evidence: inspected };
  };
  return (reportVersionId: string) => {
    if (!pending.has(reportVersionId)) pending.set(reportVersionId, evaluate(reportVersionId)
      .finally(() => pending.delete(reportVersionId)));
    return pending.get(reportVersionId)!;
  };
}
