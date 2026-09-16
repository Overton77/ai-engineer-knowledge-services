import { digestCanonicalJson, inspectAuditBundle, type VerificationAuditBundle } from "@aiengineer/knowledge-verification";
import type { FilesystemStore } from "./store.js";
import { loadSealedReportEvidence } from "./knowledge/evidence-oracle.js";
import type { createVerificationReceiptRecorder } from "./root-host-verification-receipts.js";

type Record = Awaited<ReturnType<ReturnType<typeof createVerificationReceiptRecorder>["read"]>>[number];

/** Resolve the sealed chain from a canonical receipt, without consulting mutable run state. */
export async function readRootRecoveryEvidence(input: { store: FilesystemStore; record: Record }) {
  const completion = input.record.completion;
  if (!completion) return null;
  const { summary } = completion, { tenantId, runId } = summary.submission;
  const handle = await input.store.resolveHandle({ artifactId: summary.auditArtifact.artifactId });
  if (input.store.tenantId !== tenantId || handle.digest !== summary.auditArtifact.digest
    || handle.producerActivityId !== "verification-executor:seal_run"
    || handle.producerVersion !== "knowledge-verification-executor.v1") throw new Error("ROOT_RECOVERY_AUDIT_CUSTODY");
  const audit = await input.store.json<VerificationAuditBundle>(handle);
  const inspection = await inspectAuditBundle(audit);
  if (!inspection.valid || audit.tenantId !== tenantId || audit.manifest.runId !== runId
    || inspection.manifestDigest !== summary.manifestDigest) throw new Error("ROOT_RECOVERY_AUDIT_BINDING");
  const outputs = audit.manifest.outputArtifacts;
  const uniqueOutput = (activity: string) => {
    const matches = outputs.filter(artifact => artifact.producerActivityId === `verification-executor:${activity}`);
    if (matches.length !== 1) throw new Error("ROOT_RECOVERY_ARTIFACT_ROLE");
    return matches[0]!;
  };
  const bundle = uniqueOutput("compile_claims"), result = uniqueOutput("verify_claims"), decision = uniqueOutput("evaluate_policy");
  if (result.artifactId !== summary.resultArtifactId) throw new Error("ROOT_RECOVERY_RESULT_BINDING");
  const captures = new Set(audit.verificationBundle.captures.map(capture => capture.contentArtifact.artifactId));
  const intents = bundle.parentArtifactIds.filter(id => !captures.has(id));
  const semantics = audit.manifest.inputArtifacts.filter(artifact => artifact.producerActivityId === "verification-executor:judge_semantics");
  if (intents.length !== 1 || semantics.length > 1) throw new Error("ROOT_RECOVERY_ARTIFACT_ROLE");
  const evidence = await loadSealedReportEvidence({ store: input.store, async runStatus() {
    return { state: { auditArtifactId: handle.artifactId, intentArtifactId: intents[0]!, bundleArtifactId: bundle.artifactId,
      resultArtifactId: result.artifactId, decisionArtifactId: decision.artifactId,
      ...(semantics[0] ? { semanticArtifactId: semantics[0].artifactId } : {}) } };
  } }, { tenantId, runId, manifestDigest: summary.manifestDigest,
    policyVersion: audit.policyBinding.policyVersion, policyDigest: audit.policyBinding.policyArtifact.digest });
  const dispositions = [...evidence.reportClaims.values()].map(({ claimId, digest, eligible, verdict, policyOutcome }) =>
    ({ claimId, digest, eligible, verdict, policyOutcome }));
  if (dispositions.length !== audit.verificationBundle.assertions.length
    || digestCanonicalJson(dispositions) !== digestCanonicalJson(summary.dispositions)) throw new Error("ROOT_RECOVERY_DISPOSITIONS");
  return { tenantId, operationId: input.record.operationId, runId, auditArtifact: summary.auditArtifact,
    artifacts: { bundle: bundle.artifactId, result: result.artifactId, policy: audit.policyBinding.policyArtifact.artifactId,
      inputs: audit.policyBinding.recordedPolicyInputsArtifact.artifactId, decision: decision.artifactId } };
}
