import {
  createVerificationAuditInspectionService,
  type VerificationAuditInspectionRuntimeDependencies,
} from "@aiengineer/knowledge-persistence";
import { verificationAuditInspectionActivityHandler } from "./verification-audit-inspection-activity.js";

export {
  createVerificationAuditInspectionService,
  parseVerificationAuditInspectionPublicKeys,
  type VerificationAuditInspectionRuntimeDependencies,
  type VerificationAuditInspectionRuntimeService,
} from "@aiengineer/knowledge-persistence";

export function createVerificationAuditInspectionHandler(dependencies: VerificationAuditInspectionRuntimeDependencies): ReturnType<typeof verificationAuditInspectionActivityHandler> {
  return verificationAuditInspectionActivityHandler({
    service: createVerificationAuditInspectionService(dependencies),
    repository: dependencies.repository,
    operations: dependencies.database,
    storageBucket: dependencies.storageBucket,
    now: dependencies.now,
  });
}