import { type VerificationArtifactHandle } from "@aiengineer/knowledge-contracts";
import { type AuditBundleSignatureVerifier, type TrustedArtifactResolver } from "@aiengineer/knowledge-verification";
export declare const componentDriftDimensions: readonly ["provider", "model", "parser", "grader", "policy"];
export type ComponentDriftDimension = typeof componentDriftDimensions[number];
type Components = {
    provider: string;
    model: string;
    parser: string;
    grader: string;
    policy: string;
};
export interface SealedAuditBundleArtifact {
    readonly artifact: VerificationArtifactHandle;
}
export interface VerificationComponentDriftObservation {
    readonly schemaVersion: "verification-component-drift-observation.v1";
    readonly tenantId: string;
    readonly baseline: {
        readonly runId: string;
        readonly auditBundleArtifact: {
            readonly artifactId: string;
            readonly digest: `sha256:${string}`;
        };
    };
    readonly candidate: {
        readonly runId: string;
        readonly auditBundleArtifact: {
            readonly artifactId: string;
            readonly digest: `sha256:${string}`;
        };
    };
    readonly baselineComponents: Components;
    readonly candidateComponents: Components;
    readonly changedDimensions: readonly ComponentDriftDimension[];
    readonly payloadDigest: `sha256:${string}`;
}
/** Produces registration-ready immutable bytes from two already-admitted, verified audit-manifest artifacts. */
export declare function compareVerifiedComponentVersions(input: {
    readonly baseline: SealedAuditBundleArtifact;
    readonly candidate: SealedAuditBundleArtifact;
    readonly createResolver: () => TrustedArtifactResolver;
    readonly verifier: AuditBundleSignatureVerifier;
}): Promise<VerificationComponentDriftObservation>;
export {};
