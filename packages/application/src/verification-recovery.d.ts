import { type VerificationFailureSet, type VerificationRecoveryAction, type VerificationRecoveryBatch, type VerificationRecoveryBinding, type VerificationRecoveryObservation, type VerificationRecoveryPlan, type VerificationRecoveryReceipt, type VerificationRecoveryInvalidation } from "@aiengineer/knowledge-contracts";
import { type AuditBundleSignatureVerifier, type TrustedArtifactResolver } from "@aiengineer/knowledge-verification";
import { type SealedAuditBundleArtifact } from "./verification-component-drift.js";
type Stage = VerificationRecoveryObservation["earliestStage"];
type Artifact = VerificationRecoveryObservation["diagnosticArtifacts"][number];
type BatchRef = {
    tenantId: string;
    batchId: string;
};
/** These ports read authenticated immutable records. They never accept producer verdicts as authority. */
export interface VerificationRecoveryAuthority {
    now(): string;
    readBatch(input: BatchRef): Promise<VerificationRecoveryBatch>;
    readPlan(input: {
        tenantId: string;
        planDigest: string;
    }): Promise<VerificationRecoveryPlan>;
    readInvalidation(input: {
        tenantId: string;
        caseId: string;
        planDigest: string;
    }): Promise<VerificationRecoveryInvalidation>;
    readResult(input: {
        tenantId: string;
        inputDigest: string;
        operationId?: string;
    }): Promise<VerificationRecoveryVerifiedResult | null>;
    readProbe(input: {
        tenantId: string;
        artifact: Artifact;
    }): Promise<{
        tenantId: string;
        dependencyId: string;
        originalId: string;
        inputDigest: string;
        signature: string;
        passed: boolean;
        artifactDigest: string;
        operationId: string;
        calls: number;
        costMicros: number;
        caseId: string;
        recoveryPolicyVersion: string;
    }>;
}
export interface VerificationRecoveryVerifiedResult {
    tenantId: string;
    inputDigest: string;
    binding: VerificationRecoveryBinding;
    observation: VerificationRecoveryObservation;
    coveredRequirementIds: readonly string[];
    verifiedStages: readonly Stage[];
    revoked: boolean;
    usage: {
        calls: number;
        costMicros: number;
    };
}
/** Freezes the complete authoritative batch, including unsuccessful and unfinished originals. */
export declare function composeVerificationFailureSet(input: BatchRef & {
    authority: VerificationRecoveryAuthority;
}): Promise<VerificationFailureSet>;
export declare function admitVerificationRecoveryPlan(input: {
    failureSet: VerificationFailureSet;
    actions: VerificationRecoveryAction[];
    probes: VerificationRecoveryPlan["probes"];
    reservation: VerificationRecoveryPlan["reservation"];
    authority: VerificationRecoveryAuthority;
}): Promise<VerificationRecoveryPlan>;
/** Reconciles actual independent receipts; producer-proposed success/coverage fields are not accepted. */
export declare function reconcileVerificationRecoveryReceipt(input: {
    failureSet: VerificationFailureSet;
    plan: VerificationRecoveryPlan;
    authority: VerificationRecoveryAuthority;
}): Promise<VerificationRecoveryReceipt>;
export interface VerificationRecoveryDependencyGraph {
    tenantId: string;
    caseId: string;
    planDigest: string;
    baselineAuditDigest: string;
    nodes: readonly {
        id: string;
        dependencyIds: readonly string[];
        admissionAuditDigest: string;
        revoked: boolean;
        revalidatedStages: readonly Stage[];
    }[];
    rootIds: readonly string[];
}
/** Registration-ready trusted closure. Receipt composition consumes it; publication adapters enforce its gate. */
export declare function evaluateVerificationRecoveryInvalidation(input: {
    caseId: string;
    planDigest: string;
    baseline: SealedAuditBundleArtifact;
    candidate: SealedAuditBundleArtifact;
    createResolver: () => TrustedArtifactResolver;
    verifier: AuditBundleSignatureVerifier;
    readDependencyGraph: (input: {
        tenantId: string;
        caseId: string;
        planDigest: string;
        baselineAuditDigest: string;
    }) => Promise<VerificationRecoveryDependencyGraph>;
}): Promise<VerificationRecoveryInvalidation>;
export {};
