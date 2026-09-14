import { z } from "zod";

/** `knowledge-ingestion-intent.v1` — see db-contract docs/schema-workspace/INTENT_AND_EXECUTOR_CONTRACTS.md §3. */

const Slug = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/, "slug: ^[a-z0-9][a-z0-9._-]{0,63}$");
const Uuid = z.string().uuid();
const Timestamp = z.iso.datetime({ offset: true });
const ExtentTimestamp = z.union([z.iso.date(), Timestamp]);
const Code = z.string().min(1).max(120);

export const WorldIntervalSchema = z.strictObject({ from: Timestamp.nullable(), to: Timestamp.nullable().default(null), bounds: z.literal("[)").default("[)") });
export type WorldInterval = z.infer<typeof WorldIntervalSchema>;

export const ExtentSchema = z.strictObject({
  sourceText: z.string().min(1).max(500),
  precision: z.enum(["instant", "day", "month", "quarter", "year", "relative", "unknown"]),
  earliest: ExtentTimestamp.optional(),
  latest: ExtentTimestamp.optional(),
  locatorRef: Uuid.optional(),
});

export const EvidenceRefSchema = z.strictObject({ runId: z.string().min(1).max(200), claimId: z.string().min(1).max(120), locatorRef: z.string().max(200).optional(), role: z.enum(["primary", "corroborating", "contradicting"]).default("primary") });
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;

const Belief = z.enum(["accepted", "disputed", "unknown"]).default("accepted");
const TemporalBasis = z.enum(["explicit", "carry_forward", "observation_bounded", "unresolved"]);

export const ALIAS_KINDS = ["synonym", "acronym", "former_name", "handle", "ticker", "slug", "misspelling", "translation", "model_alias"] as const;
export const IDENTIFIER_SCHEMES = ["wikidata", "ror", "orcid", "github", "huggingface", "npm", "pypi", "crates", "go_module", "doi", "arxiv", "openreview", "mcp_registry", "cve", "ghsa", "spdx", "crunchbase", "pitchbook", "linkedin", "x", "youtube_channel", "youtube_playlist", "youtube_video", "spotify", "apple_podcasts", "domain", "sec_cik", "lei", "isin", "other"] as const;

const ResolvedSubject = z.strictObject({ ref: Slug, mode: z.literal("resolved"), entityId: Uuid, kind: Code, resolvedFrom: z.strictObject({ snapshotOpId: Slug, row: z.number().int().nonnegative() }).optional() });
const NewSubject = z.strictObject({
  ref: Slug, mode: z.literal("new"), kind: Code,
  displayName: z.string().min(1).max(400),
  aliases: z.array(z.strictObject({ alias: z.string().min(1).max(400), aliasKind: z.enum(ALIAS_KINDS) })).default([]),
  identifiers: z.array(z.strictObject({ scheme: z.enum(IDENTIFIER_SCHEMES), value: z.string().min(1).max(400) })).default([]),
  typedPayload: z.record(z.string(), z.unknown()).default({}),
  onMatch: z.enum(["review", "use_existing", "fail"]).default("review"),
  evidence: z.array(EvidenceRefSchema).default([]),
});
export const SubjectSchema = z.discriminatedUnion("mode", [ResolvedSubject, NewSubject]);
export type Subject = z.infer<typeof SubjectSchema>;
export type NewSubject = z.infer<typeof NewSubject>;

const common = { proposition: z.string().min(1).max(4000).optional(), qualifiers: z.array(z.string().min(1).max(240)).optional(), proposalId: Slug, belief: Belief, evidence: z.array(EvidenceRefSchema).default([]), dependsOn: z.array(Slug).default([]), rationale: z.string().max(2000).optional(), reportBinding: z.strictObject({ reportVersionId: Uuid, assertionKey: Code.optional() }).optional() };
const Ref = Slug;

export const ProposalSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...common, kind: z.literal("entity.create"), subjectRef: Ref }),
  z.strictObject({ ...common, kind: z.literal("entity.alias"), subjectRef: Ref, alias: z.string().min(1).max(400), aliasKind: z.enum(ALIAS_KINDS) }),
  z.strictObject({ ...common, kind: z.literal("entity.identifier"), subjectRef: Ref, scheme: z.enum(IDENTIFIER_SCHEMES), value: z.string().min(1).max(400) }),
  z.strictObject({ ...common, kind: z.literal("relationship.assert"), relationshipKind: Code, fromRef: Ref, toRef: Ref, qualifier: z.string().max(200).default(""), episode: z.number().int().positive().default(1), properties: z.record(z.string(), z.unknown()).default({}), worldInterval: WorldIntervalSchema.optional(), extent: ExtentSchema.optional(), temporalBasis: TemporalBasis.default("observation_bounded") }),
  z.strictObject({ ...common, kind: z.literal("fact.assert_state"), subjectRef: Ref.optional(), relationshipRef: z.string().min(1).max(200).optional(), streamKind: Code, scopeKey: z.string().max(200).optional(), worldInterval: WorldIntervalSchema, status: z.string().max(120).optional(), amount: z.number().optional(), currency: z.string().length(3).optional(), unit: z.string().max(120).optional(), refEntityRef: Ref.optional(), payload: z.record(z.string(), z.unknown()).default({}), extent: ExtentSchema.optional(), temporalBasis: TemporalBasis, specificationRef: Uuid.optional() }),
  z.strictObject({ ...common, kind: z.literal("event.assert"), eventKind: Code, subjectRef: Ref, objectRef: Ref.optional(), occurredDuring: WorldIntervalSchema, precision: z.enum(["instant", "day", "month", "quarter", "year", "relative", "unknown"]).optional(), occurrenceKind: z.enum(["actual", "scheduled", "cancelled"]).default("actual"), dedupeKey: z.string().max(200).optional(), payload: z.record(z.string(), z.unknown()).default({}), extent: ExtentSchema.optional() }),
  z.strictObject({ ...common, kind: z.literal("support.admit"), targetRef: z.string().min(1).max(200), supportRole: z.enum(["supports", "challenges", "context"]).default("supports"), locatorId: Uuid.optional() }),
  z.strictObject({ ...common, kind: z.literal("claim.materialize"), claimIds: z.array(z.string().min(1).max(120)).min(1).max(256), runId: z.string().min(1).max(200) }),
  z.strictObject({ ...common, kind: z.literal("metric.observe"), subjectRef: Ref, metricDefinitionVersionId: Uuid, value: z.number(), unit: z.string().max(120).optional(), observedAt: Timestamp, benchmarkRunRef: Ref.optional() }),
  z.strictObject({ ...common, kind: z.literal("candidate.stage"), entityKind: Code, displayName: z.string().min(1).max(400), payload: z.record(z.string(), z.unknown()).default({}), reason: z.enum(["identity_ambiguous", "no_stream_kind", "needs_human"]) }),
  z.strictObject({ ...common, kind: z.literal("report.publish"), title: z.string().min(1).max(400), asOf: z.string().min(4).max(40), markdown: z.string().min(1).max(2_000_000).optional(), reportArtifactId: Uuid.optional(), reportCheck: z.strictObject({ artifactId: Uuid, digest: z.string().regex(/^sha256:[0-9a-f]{64}$/), runId: z.string().min(1).max(200) }).optional(), claimRefs: z.array(EvidenceRefSchema).optional(), claimIds: z.array(z.string().min(1).max(120)).default([]) }),
]);
export type Proposal = z.infer<typeof ProposalSchema>;
export type ProposalKind = Proposal["kind"];
export type ProposalOf<K extends ProposalKind> = Extract<Proposal, { kind: K }>;

/** Inline claim text for `claim.materialize`; the executor cannot read sealed-run claim bodies from the sandbox side. */
export const InlineClaimSchema = z.strictObject({
  runId: z.string().min(1).max(200), claimId: z.string().min(1).max(120),
  claimType: z.enum(["attribute", "capability", "causal", "comparative", "compatibility", "definition", "event", "measurement", "methodological", "other", "provenance", "recommendation", "relationship", "temporal"]).default("attribute"),
  statement: z.string().min(1).max(4000),
  qualifiers: z.array(z.string().min(1).max(240)).optional(),
  verdict: z.string().max(80).optional(),
  subjects: z.array(z.strictObject({ ref: Slug, role: z.enum(["subject", "object", "context"]).default("subject") })).default([]),
});
export type InlineClaim = z.infer<typeof InlineClaimSchema>;

export const IngestionIntentSchema = z.strictObject({
  schemaVersion: z.literal("knowledge-ingestion-intent.v1"),
  intentId: Slug,
  context: z.looseObject({ tenantId: Uuid, correlationId: z.string().min(1).max(200).optional(), missionId: Uuid.optional(), attemptId: Uuid.optional(), activationId: z.string().max(200).optional(), actor: z.looseObject({ kind: z.enum(["agent", "human", "service"]), id: z.string().min(1).max(200) }).optional() }),
  contract: z.strictObject({ migrationHead: z.string().optional(), workspaceFingerprint: z.string().optional(), rulesVersion: z.string().optional() }).default({}),
  inputSnapshot: z.strictObject({ artifactId: Uuid.optional(), snapshotId: z.string().min(1).max(200).optional(), snapshotDigest: z.string().min(1).max(200), knowledgeSeq: z.number().int().nonnegative() }).optional(),
  expectedKnowledgeHead: z.number().int().nonnegative().optional(),
  onStale: z.enum(["fail", "rebase_if_disjoint"]).default("fail"),
  evidence: z.strictObject({ verificationRuns: z.array(z.strictObject({ runId: z.string().min(1).max(200), manifestDigest: z.string().max(200).optional() })).default([]), claims: z.array(InlineClaimSchema).default([]) }).default(() => ({ verificationRuns: [], claims: [] })),
  asOf: z.string().min(4).max(40).optional(),
  subjects: z.array(SubjectSchema).default([]),
  proposals: z.array(ProposalSchema).min(1).max(256),
  notes: z.string().max(20_000).optional(),
  idempotencyKey: z.string().optional(),
});
export type IngestionIntent = z.infer<typeof IngestionIntentSchema>;
export type IngestionIntentInput = z.input<typeof IngestionIntentSchema>;

export const ENTITY_REF_KINDS: ReadonlySet<ProposalKind> = new Set(["entity.create", "entity.alias", "entity.identifier", "fact.assert_state", "event.assert", "metric.observe"]);

/** Every subject ref a proposal points at, in a stable order. */
export function subjectRefsOf(proposal: Proposal): string[] {
  switch (proposal.kind) {
    case "relationship.assert": return [proposal.fromRef, proposal.toRef];
    case "fact.assert_state": return [proposal.subjectRef, proposal.refEntityRef].filter((ref): ref is string => Boolean(ref));
    case "event.assert": return [proposal.subjectRef, proposal.objectRef].filter((ref): ref is string => Boolean(ref));
    case "entity.create": case "entity.alias": case "entity.identifier": case "metric.observe": return [proposal.subjectRef];
    default: return [];
  }
}

