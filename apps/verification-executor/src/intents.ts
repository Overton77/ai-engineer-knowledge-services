import { LiteralExtractionPolicySchema } from "@aiengineer/knowledge-contracts";
import { z } from "zod";

/**
 * Agent-facing intent files.
 *
 * An agent writes these with its filesystem tools; the executor compiles them
 * into full `VerificationBundle`s (adding identity, digests, actor bindings) and
 * runs the deterministic verifier. Agents never author bundles directly.
 */

export const AuthorityVectorSchema = z.object({
  authority: z.enum(["primary", "authoritative_aggregator", "independent", "secondary", "promotional", "unknown"]).default("primary"),
  independence: z.enum(["independent", "same_organization", "self_reported", "interested_party", "unknown"]).default("self_reported"),
  directness: z.enum(["direct", "derived", "commentary", "unknown"]).default("direct"),
  freshness: z.enum(["current", "historical", "stale", "unknown"]).default("current"),
  applicability: z.enum(["direct", "partial", "indirect", "unknown"]).default("direct"),
});

export const ClaimEvidenceIntentSchema = z.object({
  captureId: z.string().min(1).max(255),
  /** Exact substring of the captured content. Copy characters exactly; use locate_quote first. */
  quote: z.string().min(1).max(4000),
  role: z.enum(["supports", "contradicts", "qualifies", "context"]).default("supports"),
  authority: AuthorityVectorSchema.prefault({}),
});

export const ClaimIntentSchema = z.object({
  claimId: z.string().trim().min(1).max(120),
  /** One atomic sentence the quote(s) support. */
  proposition: z.string().min(1).max(600),
  /** Optional normalized value (metric text, number, date). */
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  claimType: z.enum(["attribute", "relationship", "measurement", "capability", "compatibility", "temporal", "causal", "comparative", "methodological", "definition", "event", "provenance", "recommendation", "other"]).default("measurement"),
  riskClass: z.enum(["low", "medium", "high", "critical"]).default("low"),
  qualifiers: z.array(z.string().min(1).max(240)).max(16).default([]),
  entityBindings: z.array(z.object({ role: z.string().min(1).max(80), canonicalId: z.string().min(1).max(200) })).max(8).default([]),
  downstreamUse: z.array(z.string().min(1).max(120)).min(1).max(8).default(["source_attributed_report"]),
  evidence: z.array(ClaimEvidenceIntentSchema).min(1).max(8),
});

export const ClaimsIntentSchema = z.object({
  schemaVersion: z.literal("verification-claims-intent.v1"),
  intentId: z.string().trim().min(1).max(200),
  title: z.string().max(300).optional(),
  policyVersion: z.string().min(1).max(160).default("executor-default.v1"),
  producer: z.object({ deploymentId: z.string().min(1).max(255), attemptId: z.string().min(1).max(255), capabilityVersion: z.string().min(1).max(120) }).optional(),
  claims: z.array(ClaimIntentSchema).min(1).max(256),
});
export type ClaimsIntent = z.infer<typeof ClaimsIntentSchema>;

export const ExtractionFieldIntentSchema = z.object({
  /** JSON pointer into `candidate`, e.g. "/models/0/context_window". */
  path: z.string().regex(/^\//).max(300),
  comparison: z.enum(["exact", "normalized_text", "decimal", "percentage", "currency", "unit", "date", "datetime", "enum", "identifier", "checksum"]).default("exact"),
  captureId: z.string().min(1).max(255),
  quote: z.string().min(1).max(4000),
});

export const ExtractionIntentSchema = z.object({
  schemaVersion: z.literal("verification-extraction-intent.v1"),
  intentId: z.string().trim().min(1).max(200),
  schema: z.object({ schemaId: z.string().min(1).max(120), schemaVersion: z.string().min(1).max(40), jsonSchema: z.record(z.string(), z.unknown()) }),
  candidate: z.record(z.string(), z.unknown()),
  fields: z.array(ExtractionFieldIntentSchema).min(1).max(256),
});
export type ExtractionIntent = z.infer<typeof ExtractionIntentSchema>;

export const ReportIntentSchema = z.object({
  schemaVersion: z.literal("verification-report-intent.v1"),
  intentId: z.string().trim().min(1).max(200),
  /** Run whose claims the report cites (verify_claims must have run there). */
  claimsRunId: z.string().min(1).max(200),
  /** The report text as an artifact (register it first) — or inline text. */
  reportArtifactId: z.string().optional(),
  reportText: z.string().max(100_000).optional(),
  assertions: z.array(z.object({
    /** Exact sentence/line copied from the report. */
    exactText: z.string().min(1).max(20_000),
    /** claimIds from the claims intent that this sentence relies on. */
    claimIds: z.array(z.string().min(1).max(120)).min(1).max(32),
    claimWeight: z.number().positive().max(100).default(1),
    severity: z.enum(["low", "medium", "high", "critical"]).default("medium"),
    requiredQualifiers: z.array(z.string().min(1).max(240)).max(32).default([]),
  })).min(1).max(512),
}).refine((value) => value.reportArtifactId || value.reportText, { message: "reportArtifactId or reportText is required" });
export type ReportIntent = z.infer<typeof ReportIntentSchema>;

export const PolicyDefinitionInputSchema = z.object({
  literalExtraction: LiteralExtractionPolicySchema.optional(),
  policyVersion: z.string().min(1).max(160).default("executor-default.v1"),
  criticalDownstreamUses: z.array(z.string().min(1).max(120)).max(32).default([]),
  requireCrossFamilyForRisk: z.array(z.enum(["low", "medium", "high", "critical"])).max(4).default([]),
  requireIndependentAuthorityForScopes: z.array(z.enum(["source_summary", "descriptive_fact", "population_accuracy", "clinical_utility", "comparative_superiority", "causal", "product_validation", "method_validation"])).max(8).default([]),
  mixedEvidenceOutcome: z.enum(["review", "abstain", "fail"]).default("review"),
  unknownCriticalOutcome: z.enum(["review", "abstain", "fail"]).default("review"),
  authorityWithheldOutcome: z.enum(["review", "abstain", "fail"]).default("review"),
  reviewAvailable: z.boolean().default(true),
});
export type PolicyDefinitionInput = z.infer<typeof PolicyDefinitionInputSchema>;
