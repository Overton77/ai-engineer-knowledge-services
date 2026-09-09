import { VerificationAdjudicationDecisionPreparationService, type VerificationAdjudicationReadService } from "@aiengineer/knowledge-application";
import { PostgresVerificationAdjudicationDecisionPreparation, PostgresVerificationAdjudicationDecisionRepository, type PostgresCanonicalRepository, type PostgresVerificationRepository } from "@aiengineer/knowledge-persistence";
import { verificationAdjudicationDecisionActivityHandler } from "./verification-adjudication-decision-activity.js";

export interface VerificationAdjudicationDecisionRuntimeDependencies {
 readonly database: PostgresCanonicalRepository;
 readonly registrations: Pick<PostgresVerificationRepository,"registerFencedContentAddressedArtifact">;
 /** Must be composed with the canonical signed-packet repository and trust keys. */
 readonly verifiedSubjects: Pick<VerificationAdjudicationReadService,"getPendingSubject">;
 readonly storageBucket: string;
 readonly now: ()=>string;
 /** Server-owned engineering allowlist. It cannot create human provenance. */
 readonly syntheticReviewerGrants?: ConstructorParameters<typeof PostgresVerificationAdjudicationDecisionPreparation>[2];
}

export function createVerificationAdjudicationDecisionHandler(dependencies:VerificationAdjudicationDecisionRuntimeDependencies) {
 const authority=new PostgresVerificationAdjudicationDecisionPreparation(dependencies.database,dependencies.verifiedSubjects,dependencies.syntheticReviewerGrants);
 const preparation=new VerificationAdjudicationDecisionPreparationService(authority,()=>Date.parse(dependencies.now()));
 const decisions=new PostgresVerificationAdjudicationDecisionRepository(dependencies.database,dependencies.registrations,preparation);
 return verificationAdjudicationDecisionActivityHandler({preparation,decisions,operations:dependencies.database,storageBucket:dependencies.storageBucket,now:dependencies.now});
}
