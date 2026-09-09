import type { DeterministicVerificationResult, SemanticAssessmentRecord, VerificationBundle } from "@aiengineer/knowledge-contracts";
import { verifyAssertionSemantics, type MechanicallySelectedFragment, type SemanticJudgeAdapter, type SemanticJudgeExecution } from "@aiengineer/knowledge-verification";

export interface VerificationSemanticRequest {
  readonly bundle: VerificationBundle;
  readonly deterministicResult: DeterministicVerificationResult;
  readonly assertionId: string;
  readonly selectedFragments: readonly MechanicallySelectedFragment[];
  readonly adapters: { readonly primary: SemanticJudgeAdapter; readonly crossFamily?: SemanticJudgeAdapter };
  readonly execution?: SemanticJudgeExecution;
}

/** Trusted application composition for stage 4; public callers cannot supply a verifier identity. */
export async function verifySemanticEvidence(request: VerificationSemanticRequest): Promise<SemanticAssessmentRecord> {
  const producerDeploymentId = request.bundle.producer.deploymentId;
  const identities = [request.adapters.primary.identity, request.adapters.crossFamily?.identity].filter(Boolean);
  if (identities.some((identity) => identity!.deploymentId === producerDeploymentId)) throw new Error("SEMANTIC_PRODUCER_VERIFIER_COLLISION");
  if (request.adapters.crossFamily && request.adapters.crossFamily.identity.deploymentId === request.adapters.primary.identity.deploymentId) throw new Error("SEMANTIC_VERIFIER_IDENTITY_COLLISION");
  return verifyAssertionSemantics(request);
}
