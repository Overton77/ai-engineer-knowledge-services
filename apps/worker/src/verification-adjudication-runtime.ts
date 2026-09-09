import type { VerificationAdjudicationPendingSubjectCommitPort } from "@aiengineer/knowledge-application";
import {
  createVerificationAdjudicationRequestService,
  type VerificationAdjudicationRuntimeDependencies as SharedVerificationAdjudicationRuntimeDependencies,
} from "@aiengineer/knowledge-persistence";
import { verificationAdjudicationRequestActivityHandler } from "./verification-adjudication-activity.js";

export { createVerificationAdjudicationRequestService } from "@aiengineer/knowledge-persistence";

export interface VerificationAdjudicationRuntimeDependencies extends SharedVerificationAdjudicationRuntimeDependencies {
  readonly subjects: VerificationAdjudicationPendingSubjectCommitPort;
}

export function createVerificationAdjudicationRequestHandler(dependencies: VerificationAdjudicationRuntimeDependencies) {
  return verificationAdjudicationRequestActivityHandler({
    service: createVerificationAdjudicationRequestService(dependencies),
    subjects: dependencies.subjects,
    operations: dependencies.database,
    storageBucket: dependencies.storageBucket,
    now: dependencies.now,
  });
}