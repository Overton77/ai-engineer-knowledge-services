import { digestCanonicalJson, inspectAuditBundle, type VerificationAuditBundle } from "@aiengineer/knowledge-verification";
import { ClaimsIntentSchema } from "./intents.js";
import { loadSealedReportEvidence, type VerificationEvidenceReader } from "./knowledge/evidence-oracle.js";

/** Host-only evidence inspection. A saved run state or a producer's summary is not a verdict. */
export function createRootRunInspector(input: {
  readonly verification: VerificationEvidenceReader;
  readonly tenantId: string;
  readonly policyVersion: string;
  readonly policyDigest: string;
  readonly allowedRunIds: readonly string[];
}) {
  const allowed = new Set(input.allowedRunIds);
  if (!allowed.size || allowed.size !== input.allowedRunIds.length
    || [...allowed].some(id => !id.trim())
    || input.verification.store.tenantId !== input.tenantId) throw new Error("ROOT_INSPECTION_SCOPE_REQUIRED");
  return async (runId: string) => {
    if (!allowed.has(runId)) throw new Error("ROOT_INSPECTION_RUN_NOT_AUTHORIZED");
    const { state } = await input.verification.runStatus({ runId });
    if (!state.auditArtifactId) throw new Error("ROOT_INSPECTION_SEALED_RUN_REQUIRED");
    const handle = await input.verification.store.resolveHandle({ artifactId: state.auditArtifactId });
    const audit = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
      await input.verification.store.bytes(handle))) as VerificationAuditBundle;
    const inspection = await inspectAuditBundle(audit);
    const evidence = await loadSealedReportEvidence(input.verification, {
      tenantId: input.tenantId, runId, manifestDigest: inspection.manifestDigest,
      policyVersion: input.policyVersion, policyDigest: input.policyDigest,
    });
    const originals = audit.verificationBundle.assertions.map(assertion => assertion.assertionId);
    if (!originals.length || new Set(originals).size !== originals.length || evidence.reportClaims.size !== originals.length
      || originals.some(id => !evidence.reportClaims.has(id))) throw new Error("ROOT_INSPECTION_ASSERTION_DENOMINATOR");
    const intentHandle = await input.verification.store.resolveHandle({ artifactId: state.intentArtifactId! });
    if (!audit.manifest.inputArtifacts.some(artifact => artifact.artifactId === intentHandle.artifactId && artifact.digest === intentHandle.digest))
      throw new Error("ROOT_INSPECTION_INTENT_BINDING");
    const submittedIntent = ClaimsIntentSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
      await input.verification.store.bytes(intentHandle))));
    return {
      runId, tenantId: input.tenantId, manifestDigest: evidence.manifestDigest,
      auditArtifact: evidence.auditArtifact, resultArtifactId: evidence.resultArtifactId,
      sourceArtifacts: structuredClone(evidence.sourceArtifacts),
      captures: structuredClone(audit.verificationBundle.captures),
      sources: structuredClone(audit.verificationBundle.sources),
      claims: structuredClone([...evidence.reportClaims.values()]),
      assertionCount: originals.length,
      intentDigest: digestCanonicalJson(submittedIntent),
    };
  };
}
