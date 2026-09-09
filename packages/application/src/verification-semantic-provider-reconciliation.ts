import { z } from "zod";
import { SemanticBlindedInputSchema, VerificationArtifactHandleSchema, VerificationSemanticProviderReconciliationSchema, type VerificationArtifactHandle, type VerificationSemanticProviderReconciliation } from "@aiengineer/knowledge-contracts";
import { deepFreeze } from "@aiengineer/knowledge-domain";
import { canonicalizeJson, digestCanonicalJson, prepareGatewaySemanticRequest, sha256Digest, type AuditBundleSignatureVerifier, type TrustedArtifactResolver } from "@aiengineer/knowledge-verification";
import { SemanticJudgeProfileSchema } from "./verification-semantic-profile.js";

type Receipt = VerificationSemanticProviderReconciliation;
const grantSchema = z.strictObject({tenantId:z.uuid(),operationId:z.uuid(),providerAttemptId:z.uuid(),keyId:z.string().min(1).max(120),operatorId:z.string().min(1).max(120),executionMode:z.enum(["synthetic_transport","live_provider"]),billingEvidenceArtifact:VerificationArtifactHandleSchema});
export type SemanticReconciliationAuthorityGrant = z.infer<typeof grantSchema>;
export type SemanticReconciliationOriginalBinding = Pick<Receipt,"tenantId"|"operationId"|"operationStepId"|"providerAttemptId"|"budgetId"|"host"|"providerId"|"model"|"dispatchFence"|"dispatchLeaseToken"|"dispatchHolderIdentity"|"dispatchFencingToken"|"requestDigest"|"profileArtifact"|"blindedInputArtifact"|"requestArtifact"|"capture"|"observationArtifact"|"originalState"|"reservationCostMicros">;
export interface AdmittedSemanticProviderReconciliation {readonly receipt:Receipt;readonly artifact:VerificationArtifactHandle;}

export function semanticReconciliationOriginalBinding(receipt:Receipt):SemanticReconciliationOriginalBinding {
  const {billingEvidenceArtifact:_billing,decision:_decision,operatorId:_operator,ticketId:_ticket,issuedAt:_issued,expiresAt:_expires,seal:_seal,schemaVersion:_schema,...binding}=receipt;
  return binding;
}
export function semanticProviderReconciliationParents(receipt:Receipt):string[] {
  return [receipt.profileArtifact.artifactId,receipt.blindedInputArtifact.artifactId,receipt.requestArtifact.artifactId,receipt.billingEvidenceArtifact.artifactId,
    ...(receipt.capture ? [receipt.capture.transportArtifact.artifactId,receipt.capture.responseEnvelopeArtifact.artifactId,receipt.capture.rawResponseArtifact.artifactId] : []),
    ...(receipt.observationArtifact ? [receipt.observationArtifact.artifactId] : [])];
}
export function semanticProviderReconciliationTransformationSignature(receipt:Receipt) {
  return digestCanonicalJson({schemaVersion:"verification-semantic-provider-reconciliation-artifact.v1",tenantId:receipt.tenantId,providerAttemptId:receipt.providerAttemptId,payloadDigest:receipt.seal.payloadDigest,parents:semanticProviderReconciliationParents(receipt)});
}

/** Issues accounting-only permits. The store must compare original binding again under lock. */
export class SemanticProviderReconciliationAdmission {
  readonly #grants:readonly SemanticReconciliationAuthorityGrant[];
  readonly #permits=new WeakSet<object>();
  constructor(private readonly dependencies:{
    readonly grants:readonly SemanticReconciliationAuthorityGrant[];
    readonly createResolver:()=>TrustedArtifactResolver;
    readonly verifier:AuditBundleSignatureVerifier;
    /** Native, terminal-operation read. Includes every capture/observation that exists. */
    readonly loadOriginalBinding:(tenantId:string,providerAttemptId:string)=>Promise<SemanticReconciliationOriginalBinding>;
    readonly now?:()=>Date;
  }) {
    this.#grants=deepFreeze(z.array(grantSchema).min(1).max(256).parse(dependencies.grants));
    const keys=this.#grants.map(grant=>`${grant.tenantId}:${grant.operationId}:${grant.providerAttemptId}:${grant.keyId}:${grant.operatorId}`);
    if(new Set(keys).size!==keys.length || this.#grants.some(grant=>grant.billingEvidenceArtifact.tenantId!==grant.tenantId))throw new Error("SEMANTIC_RECONCILIATION_GRANT_INVALID");
  }
  assertPermit(value:AdmittedSemanticProviderReconciliation) {
    if(!this.#permits.has(value))throw new Error("SEMANTIC_RECONCILIATION_ISSUER_REQUIRED");
    this.#time(value.receipt);return value;
  }
  /** Authenticates retained evidence at its durable application time; never grants mutation. */
  async verifyEvidenceAt(input:{tenantId:string;artifact:VerificationArtifactHandle;appliedAt:string;signal?:AbortSignal}):Promise<AdmittedSemanticProviderReconciliation>{
    const appliedAt=z.iso.datetime().parse(input.appliedAt),instant=new Date(appliedAt),current=(this.dependencies.now?.()??new Date()).getTime();
    if(instant.toISOString()!==appliedAt||!Number.isFinite(current)||instant.getTime()>current)throw new Error("SEMANTIC_RECONCILIATION_APPLICATION_TIME_INVALID");
    const historical=new SemanticProviderReconciliationAdmission({...this.dependencies,grants:this.#grants,now:()=>instant});
    const verified=await historical.admit(input);
    return deepFreeze({receipt:verified.receipt,artifact:verified.artifact});
  }
  async admit(input:{tenantId:string;artifact:VerificationArtifactHandle;signal?:AbortSignal}):Promise<AdmittedSemanticProviderReconciliation> {
    try {
      const tenantId=z.uuid().parse(input.tenantId),artifact=VerificationArtifactHandleSchema.parse(input.artifact),signal=input.signal;
      const receipt=VerificationSemanticProviderReconciliationSchema.parse(this.#decode(await this.#hydrate(tenantId,artifact,256_000,signal)));
      this.#time(receipt);
      const grant=this.#grants.find(value=>value.tenantId===tenantId&&value.operationId===receipt.operationId&&value.providerAttemptId===receipt.providerAttemptId&&value.keyId===receipt.seal.signature.keyId&&value.operatorId===receipt.operatorId);
      if(receipt.tenantId!==tenantId||!grant||canonicalizeJson(grant.billingEvidenceArtifact)!==canonicalizeJson(receipt.billingEvidenceArtifact)
        || (grant.executionMode==="synthetic_transport")!==(receipt.decision.basis==="synthetic_fixture"))throw new Error("AUTHORITY");
      const {seal,...body}=receipt;
      if(digestCanonicalJson(body)!==seal.payloadDigest||Buffer.from(seal.signature.signatureBase64,"base64").toString("base64")!==seal.signature.signatureBase64
        ||!await this.dependencies.verifier.verify({keyId:seal.signature.keyId,payload:new TextEncoder().encode(canonicalizeJson(body)),signatureBase64:seal.signature.signatureBase64}))throw new Error("SIGNATURE");
      if(artifact.createdAt!==receipt.issuedAt||artifact.producerActivityId!=="verification-service:semantic-provider-reconciliation"
        ||canonicalizeJson(artifact.parentArtifactIds)!==canonicalizeJson(semanticProviderReconciliationParents(receipt))||artifact.transformationSignature!==semanticProviderReconciliationTransformationSignature(receipt))throw new Error("ARTIFACT_BINDING");
      const profile=SemanticJudgeProfileSchema.parse(this.#decode(await this.#hydrate(tenantId,receipt.profileArtifact,32_000,signal)));
      const blinded=SemanticBlindedInputSchema.parse(this.#decode(await this.#hydrate(tenantId,receipt.blindedInputArtifact,96_000,signal)));
      const request=await this.#hydrate(tenantId,receipt.requestArtifact,160_000,signal);
      if(profile.identity.model!==receipt.model||profile.identity.provider!=="vercel-ai-gateway"||receipt.blindedInputArtifact.parentArtifactIds.length!==0
        ||canonicalizeJson(receipt.requestArtifact.parentArtifactIds)!==canonicalizeJson([receipt.blindedInputArtifact.artifactId])
        ||sha256Digest(request)!==prepareGatewaySemanticRequest({...blinded,inputArtifactDigest:receipt.blindedInputArtifact.digest as `sha256:${string}`},receipt.model).requestDigest)throw new Error("REQUEST_BINDING");
      const evidence=[receipt.profileArtifact,receipt.blindedInputArtifact,receipt.requestArtifact,receipt.billingEvidenceArtifact,
        ...(receipt.capture ? [receipt.capture.transportArtifact,receipt.capture.responseEnvelopeArtifact,receipt.capture.rawResponseArtifact] : []),...(receipt.observationArtifact?[receipt.observationArtifact]:[])];
      if(evidence.some(handle=>Date.parse(handle.createdAt)>Date.parse(receipt.issuedAt)))throw new Error("EVIDENCE_TIME");
      await this.#hydrate(tenantId,receipt.billingEvidenceArtifact,1_000_000,signal);
      for(const handle of evidence.slice(4))await this.#hydrate(tenantId,handle,96_000,signal);
      const original=await this.dependencies.loadOriginalBinding(tenantId,receipt.providerAttemptId);
      if(canonicalizeJson(original)!==canonicalizeJson(semanticReconciliationOriginalBinding(receipt)))throw new Error("ORIGINAL_BINDING");
      this.#time(receipt);if(signal?.aborted)throw new Error("CANCELLED");
      const permit=deepFreeze({receipt,artifact});this.#permits.add(permit);return permit;
    }catch(cause) {throw new Error("SEMANTIC_RECONCILIATION_ADMISSION_DENIED",{cause});}
  }
  #time(receipt:Receipt){const now=(this.dependencies.now?.()??new Date()).getTime();if(!Number.isFinite(now)||now<Date.parse(receipt.issuedAt)||now>=Date.parse(receipt.expiresAt))throw new Error("SEMANTIC_RECONCILIATION_EXPIRED_OR_FUTURE");}
  #decode(bytes:Uint8Array){const text=new TextDecoder("utf-8",{fatal:true}).decode(bytes),value:unknown=JSON.parse(text);if(canonicalizeJson(value)!==text)throw new Error("CANONICAL_BYTES");return value;}
  async #hydrate(tenantId:string,handle:VerificationArtifactHandle,limit:number,signal?:AbortSignal){
    if(signal?.aborted||handle.tenantId!==tenantId||handle.byteLength>limit)throw new Error("SCOPE_OR_SIZE");
    const resolver=this.dependencies.createResolver();await resolver.authorizeArtifact({tenantId,artifactId:handle.artifactId,purpose:"verification_replay"});
    if(signal?.aborted)throw new Error("CANCELLED");
    const loaded=await resolver.hydrateRegisteredArtifact({tenantId,artifactId:handle.artifactId}),bytes=loaded.bytes.slice();
    if(signal?.aborted||bytes.length!==handle.byteLength||sha256Digest(bytes)!==handle.digest||canonicalizeJson(VerificationArtifactHandleSchema.parse(loaded.registration))!==canonicalizeJson(handle))throw new Error("ARTIFACT_BYTES");
    return bytes;
  }
}
