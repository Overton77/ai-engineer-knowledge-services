import { z } from "zod";
import { VerificationArtifactHandleSchema, VerificationSourceAssessmentSchema,
  type VerificationArtifactHandle, type VerificationBundle, type VerificationRecordedPolicyInputs } from "@aiengineer/knowledge-contracts";
import type { PostgresCanonicalRepository, PostgresVerificationRepository } from "@aiengineer/knowledge-persistence";
import { assessSourceAuthority, canonicalizeJson, digestCanonicalJson, sha256Digest } from "@aiengineer/knowledge-verification";

const Digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const facts = ["source_identity", "authority", "independence", "directness", "freshness", "applicability", "jurisdiction", "license"] as const;
const CriticalFact = z.strictObject({ kind: z.enum(facts), finding: z.enum(["known", "unknown"]),
  explanation: z.string().min(1).max(2000), evidenceArtifact: VerificationArtifactHandleSchema });
const Source = z.strictObject({ sourceDigest: Digest, captureDigest: Digest, contentArtifact: VerificationArtifactHandleSchema,
  assessment: VerificationSourceAssessmentSchema, criticalFacts: z.array(CriticalFact).length(facts.length) });
export const SourceAuthorityReceiptSchema = z.strictObject({
  schemaVersion: z.literal("verification-source-authority-receipt.v1"), tenantId: z.uuid(), policyDigest: Digest, profileDigest: Digest,
  assertions: z.array(z.strictObject({ assertionId: z.string().min(1).max(256), claimDigest: Digest,
    sources: z.array(Source).min(1).max(256) })).min(1).max(512),
}).superRefine((receipt, context) => {
  if (new Set(receipt.assertions.map(item => item.assertionId)).size !== receipt.assertions.length)
    context.addIssue({ code: "custom", message: "SOURCE_AUTHORITY_DUPLICATE_ASSERTION" });
  for (const assertion of receipt.assertions) {
    if (new Set(assertion.sources.map(item => item.assessment.fragmentId)).size !== assertion.sources.length)
      context.addIssue({ code: "custom", message: "SOURCE_AUTHORITY_DUPLICATE_FRAGMENT" });
    for (const source of assertion.sources) {
      if (source.assessment.assertionId !== assertion.assertionId || new Set(source.criticalFacts.map(item => item.kind)).size !== facts.length)
        context.addIssue({ code: "custom", message: "SOURCE_AUTHORITY_INCOMPLETE_CENSUS" });
    }
  }
});
const Grant = z.strictObject({ tenantId: z.uuid(), issuerAttemptId: z.uuid(), artifact: VerificationArtifactHandleSchema });
export const SourceAuthorityPinsSchema = z.array(Grant).min(1).max(256);
export type SourceAuthorityPins = z.infer<typeof SourceAuthorityPinsSchema>;
export interface ClaimsSourceAuthorityStage {
  assess(input: { tenantId: string; bundle: VerificationBundle; policyArtifact: VerificationArtifactHandle }): Promise<{
    sourceAssessments: VerificationRecordedPolicyInputs["sourceAssessments"];
    assertions: ReadonlyMap<string, { authorityStatus: "sufficient" | "withheld" | "unknown";
      independentCorroboration: boolean; conflictPresent: boolean; criticalFactsKnown: boolean }>;
    evidenceArtifacts: readonly VerificationArtifactHandle[];
    semanticProfileDigests: ReadonlyMap<string, string>;
  }>;
}

/** Evidence selectors may be repaired; every original proposition, qualifier and other claim attribute remains pinned. */
export function sourceAuthorityClaimDigest(assertion: VerificationBundle["assertions"][number]) {
  const { evidence: _, ...claim } = assertion;
  return digestCanonicalJson(claim);
}

export function parseSourceAuthorityPins(value: string | undefined): SourceAuthorityPins | undefined {
  if (!value) return undefined;
  if (Buffer.byteLength(value, "utf8") > 2_000_000) throw new Error("SOURCE_AUTHORITY_CONFIGURATION_TOO_LARGE");
  return SourceAuthorityPinsSchema.parse(JSON.parse(value));
}

export function claimsHostActivation(input: { mode: string | undefined; projectionConfigured: boolean;
  sourceAuthorityConfigured: boolean; policyConfigured: boolean; signerConfigured: boolean; nativePersistence: boolean }): boolean {
  if (input.mode !== undefined && !["0", "1"].includes(input.mode)) throw new Error("INVALID_VERIFICATION_CLAIMS_ENABLED");
  const enabled = input.mode === "1" || input.projectionConfigured;
  if (input.sourceAuthorityConfigured && !enabled) throw new Error("SOURCE_AUTHORITY_CLAIMS_HOST_REQUIRED");
  if ((input.mode === "1" || input.sourceAuthorityConfigured) && (!input.policyConfigured || !input.signerConfigured))
    throw new Error("VERIFICATION_CLAIMS_SIGNED_SEAL_CONFIGURATION_REQUIRED");
  if ((input.mode === "1" || input.sourceAuthorityConfigured) && !input.nativePersistence) throw new Error("VERIFICATION_CLAIMS_NATIVE_PERSISTENCE_REQUIRED");
  return enabled;
}

/** Host configuration authenticates independently authored receipts, never producer-supplied evidence authority labels. */
export function createClaimsSourceAuthorityStage(input: { pins: SourceAuthorityPins;
  database: Pick<PostgresCanonicalRepository, "transaction">;
  repository: Pick<PostgresVerificationRepository, "createTrustedArtifactResolver"> }): ClaimsSourceAuthorityStage {
  const pins = SourceAuthorityPinsSchema.parse(structuredClone(input.pins));
  if (new Set(pins.map(pin => `${pin.tenantId}:${pin.artifact.artifactId}`)).size !== pins.length) throw new Error("SOURCE_AUTHORITY_DUPLICATE_PIN");
  return { async assess(request) {
    const artifacts = new Map<string, VerificationArtifactHandle>();
    const retainedBytes = new Map<string, Uint8Array>();
    let totalBytes = 0;
    async function retain(handle: VerificationArtifactHandle) {
      if (handle.tenantId !== request.tenantId) throw new Error("SOURCE_AUTHORITY_ARTIFACT_TENANT");
      const prior = artifacts.get(handle.artifactId);
      if (prior) {
        if (canonicalizeJson(prior) !== canonicalizeJson(handle)) throw new Error("SOURCE_AUTHORITY_ARTIFACT_DRIFT");
        return retainedBytes.get(handle.artifactId)!;
      }
      const resolver = input.repository.createTrustedArtifactResolver();
      await resolver.authorizeArtifact({ tenantId: request.tenantId, artifactId: handle.artifactId, purpose: "verification_admission" });
      const loaded = await resolver.hydrateRegisteredArtifact({ tenantId: request.tenantId, artifactId: handle.artifactId });
      if (canonicalizeJson(loaded.registration) !== canonicalizeJson(handle) || loaded.bytes.byteLength !== handle.byteLength
        || sha256Digest(loaded.bytes) !== handle.digest) throw new Error("SOURCE_AUTHORITY_ARTIFACT_DRIFT");
      if (!artifacts.has(handle.artifactId)) totalBytes += loaded.bytes.byteLength;
      if (totalBytes > 32_000_000 || artifacts.size > 2048) throw new Error("SOURCE_AUTHORITY_EVIDENCE_LIMIT");
      artifacts.set(handle.artifactId, handle);
      retainedBytes.set(handle.artifactId, loaded.bytes);
      return loaded.bytes;
    }
    const candidates = new Map<string, z.infer<typeof SourceAuthorityReceiptSchema>["assertions"][number]>();
    const semanticProfileDigests = new Map<string, string>();
    for (const pin of pins.filter(pin => pin.tenantId === request.tenantId)) {
      if (pin.artifact.mediaType !== "application/vnd.aiengineer.verification-source-authority-receipt+json") throw new Error("SOURCE_AUTHORITY_RECEIPT_TYPE");
      const issuer = await input.database.transaction(request.tenantId, async client => (await client.query<{ authorized: boolean }>(
        `select exists(select 1 from orchestration.artifact a join orchestration.attempt p on p.tenant_id=a.tenant_id and p.id=a.producer_attempt_id
          where a.tenant_id=$1 and a.id=$2 and a.producer_attempt_id=$3 and a.artifact_type='verification_source_authority_receipt'
          and p.id<>$4 and p.agent_deployment_id<>$5) authorized`,
        [request.tenantId, pin.artifact.artifactId, pin.issuerAttemptId, request.bundle.producer.attemptId, request.bundle.producer.deploymentId])).rows[0]);
      if (!issuer?.authorized) throw new Error("SOURCE_AUTHORITY_INDEPENDENT_ISSUER_REQUIRED");
      const receipt = SourceAuthorityReceiptSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await retain(pin.artifact))));
      if (receipt.tenantId !== request.tenantId) throw new Error("SOURCE_AUTHORITY_RECEIPT_TENANT");
      if (receipt.policyDigest !== request.policyArtifact.digest) continue;
      const requiredParents = [request.policyArtifact.artifactId, ...receipt.assertions.flatMap(assertion => assertion.sources.flatMap(source =>
        [source.contentArtifact.artifactId, ...source.criticalFacts.map(fact => fact.evidenceArtifact.artifactId)]))];
      if (requiredParents.some(id => !pin.artifact.parentArtifactIds.includes(id))) throw new Error("SOURCE_AUTHORITY_RECEIPT_LINEAGE");
      for (const assertion of receipt.assertions) {
        if (!request.bundle.assertions.some(item => item.assertionId === assertion.assertionId)) continue;
        if (candidates.has(assertion.assertionId)) throw new Error("SOURCE_AUTHORITY_ASSERTION_AMBIGUOUS");
        candidates.set(assertion.assertionId, assertion);
        semanticProfileDigests.set(assertion.assertionId, receipt.profileDigest);
      }
    }
    const sourceAssessments: VerificationRecordedPolicyInputs["sourceAssessments"] = [];
    const assertions = new Map<string, { authorityStatus: "sufficient" | "withheld" | "unknown"; independentCorroboration: boolean; conflictPresent: boolean; criticalFactsKnown: boolean }>();
    for (const claim of request.bundle.assertions) {
      const authority = candidates.get(claim.assertionId);
      if (!authority || authority.claimDigest !== sourceAuthorityClaimDigest(claim) || authority.sources.length !== claim.evidence.length)
        throw new Error("SOURCE_AUTHORITY_COMPLETE_CLAIM_REQUIRED");
      let criticalFactsKnown = true;
      for (const edge of claim.evidence) {
        const item = authority.sources.find(source => source.assessment.fragmentId === edge.fragment.fragmentId);
        const capture = request.bundle.captures.find(value => value.captureId === edge.fragment.captureId);
        const source = request.bundle.sources.find(value => value.sourceId === capture?.sourceId);
        if (!item || !capture || !source || item.captureDigest !== digestCanonicalJson(capture) || item.sourceDigest !== digestCanonicalJson(source)
          || canonicalizeJson(item.contentArtifact) !== canonicalizeJson(capture.contentArtifact)
          || edge.fragment.representationArtifactId !== capture.contentArtifact.artifactId) throw new Error("SOURCE_AUTHORITY_CAPTURE_BINDING");
        await retain(item.contentArtifact);
        const known: Record<typeof facts[number], boolean> = { source_identity: true,
          authority: item.assessment.vector.authority !== "unknown", independence: item.assessment.vector.independence !== "unknown",
          directness: item.assessment.vector.directness !== "unknown", freshness: item.assessment.vector.freshness !== "unknown" && item.assessment.freshnessKnown,
          applicability: item.assessment.vector.applicability !== "unknown", jurisdiction: item.assessment.jurisdictionKnown, license: item.assessment.licenseKnown };
        for (const fact of item.criticalFacts) {
          if ((fact.finding === "known") !== known[fact.kind]) throw new Error("SOURCE_AUTHORITY_CENSUS_MISMATCH");
          await retain(fact.evidenceArtifact);
          criticalFactsKnown &&= fact.finding === "known";
        }
        sourceAssessments.push(item.assessment);
      }
      const derived = assessSourceAuthority(claim.assertionId, sourceAssessments.filter(item => item.assertionId === claim.assertionId));
      assertions.set(claim.assertionId, { authorityStatus: derived.status, independentCorroboration: derived.independentCorroboration,
        conflictPresent: derived.conflictPresent, criticalFactsKnown });
    }
    return { sourceAssessments, assertions, semanticProfileDigests, evidenceArtifacts: [...artifacts.values()] };
  } };
}
