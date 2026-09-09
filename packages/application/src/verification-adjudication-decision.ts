import {
  OperationContextSchema, UuidSchema, VerificationAdjudicationDecisionRequestSchema,
  VerificationAdjudicationTerminalResourceSchema,
  type Actor, type OperationContext, type VerificationAdjudicationDecisionRequest,
  type VerificationAdjudicationTerminalResource, type VerificationAdjudicationDecisionResult,
} from "@aiengineer/knowledge-contracts";
import { deepFreeze } from "@aiengineer/knowledge-domain";
import { deterministicUuid } from "@aiengineer/knowledge-runtime";
import { canonicalizeJson, digestCanonicalJson, sha256Digest } from "@aiengineer/knowledge-verification";
import { z } from "zod";
import type { VerificationAdjudicationCommitLease, VerificationAdjudicationPacketRegistration } from "./verification-adjudication.js";

const authoritySchema=z.discriminatedUnion("provenance",[
  z.strictObject({provenance:z.literal("human_origin"),grantId:UuidSchema,role:z.string().min(1).max(128),expiresAt:z.iso.datetime().optional()}),
  z.strictObject({provenance:z.literal("synthetic_engineering"),role:z.string().min(1).max(128),expiresAt:z.iso.datetime().optional()}),
]);
export type VerificationReviewerAuthority=z.infer<typeof authoritySchema>;

/** Server-owned ports. Authority must be resolved from authenticated identity and
 * canonical grants, never from fields supplied in the decision request. */
export interface VerificationAdjudicationDecisionPreparationPort {
  authorizeReviewer(input:{tenantId:string;subjectId:string;actor:Actor}):Promise<VerificationReviewerAuthority|undefined>;
  loadVerifiedSubject(input:{tenantId:string;subjectId:string;actor:Actor}):Promise<VerificationAdjudicationTerminalResource>;
}
export class VerificationAdjudicationDecisionError extends Error {
  constructor(readonly code:"AUTHORITY_REQUIRED"|"EXPIRED"|"BINDING"|"CANCELLED") {super(`VERIFICATION_ADJUDICATION_DECISION_${code}`);}
}
export interface PreparedVerificationAdjudicationDecision {
  readonly decisionId:string;
  readonly request:VerificationAdjudicationDecisionRequest;
  readonly requestDigest:`sha256:${string}`;
  readonly context:OperationContext;
  readonly authority:VerificationReviewerAuthority;
  readonly sourceOperationId:string;
  readonly decisionDigest:`sha256:${string}`;
  readonly rationaleDigest:`sha256:${string}`;
  readonly decisionBytes:Uint8Array;
  readonly parentArtifactIds:readonly string[];
}

export interface VerificationAdjudicationDecisionCommitPort {
  /** Revalidate bytes and identity against the durable request, then recheck
   * grant and expiry under the exact lease lock. Identical commits recover.
   * Quorum is a read-time snapshot and never an admission instruction. */
  commitDecision(input: {
    readonly prepared: PreparedVerificationAdjudicationDecision;
    readonly lease: VerificationAdjudicationCommitLease;
    readonly registration: VerificationAdjudicationPacketRegistration;
  }): Promise<VerificationAdjudicationDecisionResult>;
}

/** Prepares immutable review evidence only. Persistence must recheck the exact
 * lease/fence, current grant and subject expiry in its committing transaction.
 * Quorum is a separate read-time projection; this payload never changes admission. */
export class VerificationAdjudicationDecisionPreparationService {
  constructor(private readonly port:VerificationAdjudicationDecisionPreparationPort,private readonly now:()=>number=Date.now){}
  async prepare(input:{request:VerificationAdjudicationDecisionRequest;context:OperationContext;signal:AbortSignal}):Promise<PreparedVerificationAdjudicationDecision>{
    const request=deepFreeze(VerificationAdjudicationDecisionRequestSchema.parse(input.request));
    const context=deepFreeze(OperationContextSchema.parse(input.context));
    const active=()=>{if(input.signal.aborted)throw new VerificationAdjudicationDecisionError("CANCELLED");};
    active();
    if(context.actor.kind==="model"||(context.actor.kind==="service"&&context.actor.serviceIdentity!=="human_reviewer"))throw new VerificationAdjudicationDecisionError("AUTHORITY_REQUIRED");
    const scope={tenantId:context.tenantId,subjectId:request.subjectId,actor:context.actor};
    const granted=await this.port.authorizeReviewer(scope);active();
    if(!granted)throw new VerificationAdjudicationDecisionError("AUTHORITY_REQUIRED");
    const authority=deepFreeze(authoritySchema.parse(granted));
    if((context.actor.kind==="human")!==(authority.provenance==="human_origin"))throw new VerificationAdjudicationDecisionError("AUTHORITY_REQUIRED");
    const checkExpiry=(expiresAt?:string)=>{const now=this.now();if(!Number.isFinite(now)||(expiresAt!==undefined&&Date.parse(expiresAt)<=now))throw new VerificationAdjudicationDecisionError("EXPIRED");};
    checkExpiry(authority.expiresAt);
    const subject=VerificationAdjudicationTerminalResourceSchema.parse(await this.port.loadVerifiedSubject(scope));active();
    checkExpiry(authority.expiresAt);checkExpiry(subject.output.reviewRequirements.expiresAt);
    if(subject.tenantId!==context.tenantId||subject.output.subjectId!==request.subjectId
      ||subject.packetArtifact.artifactId!==request.packetArtifact.artifactId||subject.packetArtifact.digest!==request.packetArtifact.digest
      ||!subject.output.reviewRequirements.eligibleReviewerRoles.includes(authority.role))throw new VerificationAdjudicationDecisionError("BINDING");
    const decisionId=deterministicUuid("verification-adjudication-decision",`${context.operationId}:${request.subjectId}:${context.actor.id}`);
    const requestDigest=digestCanonicalJson(request);
    const payload={schemaVersion:"verification-adjudication-decision.v1",verificationContractVersion:"verification.v1",decisionId,
      tenantId:context.tenantId,operationId:context.operationId,sourceOperationId:subject.operationId,subjectId:request.subjectId,
      requestDigest,packetArtifact:request.packetArtifact,decision:request.decision,rationale:request.rationale,
      reviewer:{actorId:context.actor.id,actorKind:context.actor.kind,...(context.actor.kind==="service"?{serviceIdentity:context.actor.serviceIdentity}:{}),
        role:authority.role,provenance:authority.provenance,...(authority.provenance==="human_origin"?{grantId:authority.grantId}:{})},
      originalPolicyOutcome:subject.output.originalPolicyOutcome,admissionChanged:false,humanGoldScoringEligible:false};
    const decisionBytes=new TextEncoder().encode(canonicalizeJson(payload));
    return {...deepFreeze({decisionId,request,requestDigest,context,authority,sourceOperationId:subject.operationId,
      decisionDigest:sha256Digest(decisionBytes),rationaleDigest:sha256Digest(request.rationale),parentArtifactIds:[request.packetArtifact.artifactId]}),decisionBytes};
  }
}
