import type { ArtifactLedger } from "@aiengineer/knowledge-db-read";
import { eventExtent, extentTimestamp } from "./temporal.js";
import type { TenantSqlClient } from "@aiengineer/knowledge-persistence";
import { domainError } from "@aiengineer/knowledge-schema-workspace";
import type { ExtentSchema, IngestionIntent, NewSubject, Proposal, ProposalOf, WorldInterval } from "./intent.js";
import { claimKey, subjectRefOfPlaceholder } from "./placeholders.js";
import { slugify, type IngestionPlan, type PlannedProposal } from "./plan.js";
import type { AffectedRef, ProposalReceipt } from "./receipt.js";
import type { EntityKind, Vocabulary } from "./vocabulary.js";
import type { z } from "zod";

/**
 * Executes the admitted proposals of a plan inside the caller's `executor_service`
 * transaction, after `temporal.begin_batch` and before `temporal.commit_batch`. Every write
 * goes through the temporal helpers or a table `executor_service` may insert into.
 */
export interface ApplyContext {
  readonly client: TenantSqlClient;
  readonly tenantId: string;
  readonly receiptId: string;
  readonly intent: IngestionIntent;
  readonly plan: IngestionPlan;
  readonly vocabulary: Vocabulary;
  readonly artifacts: ArtifactLedger;
}

export interface ApplyOutcome {
  readonly proposals: readonly ProposalReceipt[];
  readonly affectedRefs: readonly AffectedRef[];
  readonly subjects: readonly { ref: string; entityId: string | null; created: boolean }[];
  readonly claims: readonly { runId: string; claimId: string; claimRowId: string | null }[];
}

type Row = Record<string, unknown>;
type Extent = z.infer<typeof ExtentSchema>;
type CreatedIds = Record<string, string | string[]>;
interface Written { ids: CreatedIds; supersedes?: string[]; noop?: boolean }

const SQL_PREVIEW_CHARS = 80;
const MAX_REPORT_SLUG_LENGTH = 120;
const REPORT_CLAIM_ROLE = "supports";

/** Ids resolved so far (from the plan, then from each write) and the affected refs the receipt reports. */
class ApplyState {
  readonly #entityIds = new Map<string, string>();
  readonly #claimRows = new Map<string, string>();
  readonly #createdSubjects = new Set<string>();
  readonly #results = new Map<string, CreatedIds>();
  readonly affected: AffectedRef[] = [];

  constructor(plan: IngestionPlan) {
    for (const subject of plan.subjects) if (subject.entityId) this.#entityIds.set(subject.ref, subject.entityId);
    for (const claim of plan.evidence.claims) if (claim.claimRowId) this.#claimRows.set(claimKey(claim.runId, claim.claimId), claim.claimRowId);
  }

  entity(ref: string): string {
    const id = this.#entityIds.get(ref);
    if (!id) throw domainError("SUBJECT_UNKNOWN", `subject ${ref} has no entity id at apply time`);
    return id;
  }

  entityIdOf(ref: string): string | null { return this.#entityIds.get(ref) ?? null; }
  wasCreated(ref: string): boolean { return this.#createdSubjects.has(ref); }
  rememberCreatedEntity(ref: string, entityId: string): void { this.#entityIds.set(ref, entityId); this.#createdSubjects.add(ref); }

  /** The claim row backing a proposal's primary evidence, when it exists. */
  claim(proposal: Proposal): string | null {
    const cited = proposal.evidence[0];
    return cited ? this.claimRow(cited.runId, cited.claimId) : null;
  }

  claimRow(runId: string, claimId: string): string | null { return this.#claimRows.get(claimKey(runId, claimId)) ?? null; }
  rememberClaimRow(runId: string, claimId: string, claimRowId: string): void { this.#claimRows.set(claimKey(runId, claimId), claimRowId); }

  resultOf(proposalId: string): CreatedIds | undefined { return this.#results.get(proposalId); }
  rememberResult(proposalId: string, ids: CreatedIds): void { this.#results.set(proposalId, ids); }

  touch(schema: string, table: string, id: string): void { this.affected.push({ schema, table, id }); }
}

const rangeLiteral = (interval: WorldInterval | undefined): string | null => interval ? `[${interval.from ?? ""},${interval.to ?? ""})` : null;

async function one(client: TenantSqlClient, sql: string, params: readonly unknown[]): Promise<Row> {
  const row = (await client.query<Row>(sql, params)).rows[0];
  if (!row) throw domainError("EXECUTOR_INTERNAL", `statement returned no row: ${sql.slice(0, SQL_PREVIEW_CHARS)}`);
  return row;
}

const scalar = async (client: TenantSqlClient, sql: string, params: readonly unknown[]): Promise<string> => String(Object.values(await one(client, sql, params))[0]);

export async function applyPlan(context: ApplyContext): Promise<ApplyOutcome> {
  const state = new ApplyState(context.plan);
  const receipts: ProposalReceipt[] = [];
  for (const proposalId of context.plan.order) receipts.push(await applyOne(context, plannedProposal(context.plan, proposalId), state));
  return {
    proposals: receipts,
    affectedRefs: state.affected,
    subjects: context.plan.subjects.map((subject) => ({ ref: subject.ref, entityId: state.entityIdOf(subject.ref), created: state.wasCreated(subject.ref) })),
    claims: context.plan.evidence.claims.map((claim) => ({ runId: claim.runId, claimId: claim.claimId, claimRowId: state.claimRow(claim.runId, claim.claimId) })),
  };
}

function plannedProposal(plan: IngestionPlan, proposalId: string): PlannedProposal {
  const planned = plan.proposals.find((proposal) => proposal.proposalId === proposalId);
  if (!planned) throw domainError("EXECUTOR_INTERNAL", `plan order names unknown proposal ${proposalId}`);
  return planned;
}

async function applyOne(context: ApplyContext, planned: PlannedProposal, state: ApplyState): Promise<ProposalReceipt> {
  const base = { proposalId: planned.proposalId, outcome: planned.outcome, ...(planned.reason ? { reason: planned.reason } : {}), ...(planned.existing ? { existing: planned.existing } : {}) };
  if (planned.outcome === "review_required") return { ...base, created: await stageCandidate(context, planned.effective, state) };
  if (planned.outcome !== "admitted") return base;
  const written = await write(context, planned.effective, state);
  state.rememberResult(planned.proposalId, written.ids);
  return { ...base, created: written.ids, ...(written.supersedes ? { supersedes: written.supersedes } : {}), ...(written.noop ? { noop: true } : {}) };
}

async function write(context: ApplyContext, proposal: Proposal, state: ApplyState): Promise<Written> {
  switch (proposal.kind) {
    case "entity.create": return createEntity(context, proposal, state);
    case "entity.alias": return insertIfAbsent(context, state, aliasRow(state.entity(proposal.subjectRef), proposal));
    case "entity.identifier": return insertIfAbsent(context, state, identifierRow(state.entity(proposal.subjectRef), proposal));
    case "relationship.assert": return assertRelationship(context, proposal, state);
    case "fact.assert_state": return assertState(context, proposal, state);
    case "event.assert": return assertEvent(context, proposal, state);
    case "support.admit": return admitSupport(context, proposal, state);
    case "claim.materialize": return materializeClaims(context, proposal, state);
    case "metric.observe": return observeMetric(context, proposal, state);
    case "candidate.stage": return { ids: await stageCandidate(context, proposal, state) };
    case "report.publish": return publishReport(context, proposal, state);
  }
}

/** Extents are reported through the owning proposal's `created.extentId`, not as affected refs. */
async function makeExtent(context: ApplyContext, extent: Extent | undefined): Promise<string | null> {
  if (!extent) return null;
    return scalar(context.client, "select temporal.make_extent($1,$2,$3::uuid,$4::timestamptz,$5::timestamptz)", [extent.sourceText, extent.precision, extent.locatorRef ?? null, extentTimestamp(extent.earliest), extentTimestamp(extent.latest)]);
}

interface InsertIfAbsent { table: string; key: string; columns: Record<string, unknown>; conflict: string; lookup: string; lookupParams: unknown[] }

const aliasRow = (entityId: string, alias: { alias: string; aliasKind: string }): InsertIfAbsent => ({
  table: "corpus.entity_alias", key: "aliasId",
  columns: { entity_id: entityId, alias: alias.alias, alias_kind: alias.aliasKind },
  conflict: "on conflict (tenant_id, entity_id, alias_normalized, alias_kind) do nothing",
  lookup: "entity_id=$1 and alias_normalized=lower(btrim($2)) and alias_kind=$3", lookupParams: [entityId, alias.alias, alias.aliasKind],
});

const identifierRow = (entityId: string, identifier: { scheme: string; value: string }): InsertIfAbsent => ({
  table: "corpus.entity_identifier", key: "identifierId",
  columns: { entity_id: entityId, scheme: identifier.scheme, value: identifier.value },
  conflict: "on conflict (tenant_id, scheme, value) do nothing",
  lookup: "scheme=$1 and value=$2", lookupParams: [identifier.scheme, identifier.value],
});

async function insertIfAbsent(context: ApplyContext, state: ApplyState, input: InsertIfAbsent): Promise<Written> {
  const columns = Object.keys(input.columns);
  const inserted = (await context.client.query<Row>(`insert into ${input.table}(${columns.join(",")}) values(${columns.map((_, index) => `$${index + 1}`).join(",")}) ${input.conflict} returning id`, Object.values(input.columns))).rows[0];
  const id = inserted ? String(inserted.id) : await scalar(context.client, `select id from ${input.table} where ${input.lookup}`, input.lookupParams);
  const [schema, table] = input.table.split(".") as [string, string];
  if (inserted) state.touch(schema, table, id);
  return { ids: { [input.key]: id }, ...(inserted ? {} : { noop: true }) };
}

async function createEntity(context: ApplyContext, proposal: ProposalOf<"entity.create">, state: ApplyState): Promise<Written> {
  const planned = context.plan.subjects.find((subject) => subject.ref === proposal.subjectRef);
  const subject = context.intent.subjects.find((item) => item.ref === proposal.subjectRef);
  if (!planned?.entityId || !subject || subject.mode !== "new") throw domainError("SUBJECT_UNKNOWN", `cannot create subject ${proposal.subjectRef}`);
  const kind = context.vocabulary.entityKinds.get(subject.kind);
  if (!kind) throw domainError("VOCABULARY_VIOLATION", `unknown entity kind ${subject.kind}`);
  const { client, receiptId } = context;
  const candidateId = await scalar(client, "insert into staging.candidate(proposed_kind, proposed_payload) values($1,$2::jsonb) returning id", [subject.kind, JSON.stringify({ displayName: subject.displayName, aliases: subject.aliases, identifiers: subject.identifiers, typedPayload: subject.typedPayload, intentId: context.intent.intentId, ref: subject.ref })]);
  const entityId = await scalar(client, "insert into corpus.entity(id, kind, display_name, slug, created_by_receipt_id) values($1,$2,$3,$4,$5) returning id", [planned.entityId, subject.kind, subject.displayName, planned.slug ?? slugify(subject.displayName), receiptId]);
  const decisionId = await scalar(client, "insert into staging.resolution_decision(candidate_id, entity_id, decision, receipt_id) values($1,$2,'create',$3) returning id", [candidateId, entityId, receiptId]);
  await client.query("update staging.candidate set resolved_entity_id=$2 where id=$1", [candidateId, entityId]);
  await insertTypedRow(client, state, { kind, entityId, payload: subject.typedPayload });
  const { aliasIds, identifierIds } = await insertNames(context, state, { entityId, subject });
  const nameSegmentId = await assertEntityName(context, { entityId, subject, claimRowId: state.claim(proposal) });
  state.rememberCreatedEntity(subject.ref, entityId);
  state.touch("corpus", "entity", entityId);
  state.touch("staging", "candidate", candidateId);
  state.touch("staging", "resolution_decision", decisionId);
  state.touch("temporal", "segment", nameSegmentId);
  return { ids: { entityId, candidateId, decisionId, nameSegmentId, aliasIds, identifierIds } };
}

interface TypedRow { readonly kind: EntityKind; readonly entityId: string; readonly payload: Record<string, unknown> }

/** Inserts the kind's typed row, resolving `$subject:` placeholders and serialising nested objects as JSON. */
async function insertTypedRow(client: TenantSqlClient, state: ApplyState, row: TypedRow): Promise<void> {
  const columns = Object.keys(row.payload).filter((column) => row.kind.columns.includes(column));
  const values = columns.map((column) => typedColumnValue(row.payload[column], state));
  const quoted = columns.map((column) => `"${column.replaceAll('"', '""')}"`);
  const placeholders = columns.map((_, index) => `$${index + 2}`);
  await client.query(`insert into "${row.kind.schema}"."${row.kind.table}"(id${quoted.length ? `,${quoted.join(",")}` : ""}) values($1${placeholders.length ? `,${placeholders.join(",")}` : ""})`, [row.entityId, ...values]);
}

function typedColumnValue(value: unknown, state: ApplyState): unknown {
  const subjectRef = subjectRefOfPlaceholder(value);
  if (subjectRef !== undefined) return state.entity(subjectRef);
  const isPlainObject = value !== null && typeof value === "object" && !Array.isArray(value);
  return isPlainObject ? JSON.stringify(value) : value;
}

interface NamedEntity { readonly entityId: string; readonly subject: NewSubject }

async function insertNames(context: ApplyContext, state: ApplyState, named: NamedEntity): Promise<{ aliasIds: string[]; identifierIds: string[] }> {
  const aliasIds: string[] = [];
  const identifierIds: string[] = [];
  for (const alias of named.subject.aliases) aliasIds.push(String((await insertIfAbsent(context, state, aliasRow(named.entityId, alias))).ids.aliasId));
  for (const identifier of named.subject.identifiers) identifierIds.push(String((await insertIfAbsent(context, state, identifierRow(named.entityId, identifier))).ids.identifierId));
  return { aliasIds, identifierIds };
}

async function assertEntityName(context: ApplyContext, named: NamedEntity & { readonly claimRowId: string | null }): Promise<string> {
  const validFrom = context.intent.asOf ?? new Date().toISOString();
  return scalar(context.client, "select temporal.assert_state($1,'entity_name',tstzrange($2::timestamptz,null,'[)'),p_payload=>$3::jsonb,p_temporal_basis=>'observation_bounded',p_claim=>$4)", [named.entityId, validFrom, JSON.stringify({ display_name: named.subject.displayName }), named.claimRowId]);
}

async function assertRelationship(context: ApplyContext, proposal: ProposalOf<"relationship.assert">, state: ApplyState): Promise<Written> {
  const extentId = await makeExtent(context, proposal.extent);
  const relationshipId = await scalar(context.client, "select temporal.assert_relationship($1,$2,$3,$4::tstzrange,$5,$6,$7::jsonb,$8,$9)", [proposal.relationshipKind, state.entity(proposal.fromRef), state.entity(proposal.toRef), rangeLiteral(proposal.worldInterval), proposal.qualifier, proposal.episode, JSON.stringify(proposal.properties), extentId, state.claim(proposal)]);
  state.touch("corpus", "relationship", relationshipId);
  const isTemporal = context.vocabulary.relationshipKinds.get(proposal.relationshipKind)?.temporal ?? false;
  const segmentId = isTemporal ? await activeRelationshipSegment(context.client, relationshipId) : undefined;
  return { ids: { relationshipId, ...(segmentId ? { segmentId } : {}), ...(extentId ? { extentId } : {}) } };
}

async function activeRelationshipSegment(client: TenantSqlClient, relationshipId: string): Promise<string | undefined> {
  const active = (await client.query<Row>("select s.id from temporal.segment s join temporal.stream st on st.id=s.stream_id where st.subject_relationship_id=$1 and st.kind='relationship_active' and s.k_to is null and s.k_from=temporal.current_k() order by s.id desc limit 1", [relationshipId])).rows[0];
  return active ? String(active.id) : undefined;
}

async function assertState(context: ApplyContext, proposal: ProposalOf<"fact.assert_state">, state: ApplyState): Promise<Written> {
  const extentId = await makeExtent(context, proposal.extent);
  const relationshipId = proposal.relationshipRef ? String(state.resultOf(proposal.relationshipRef)?.relationshipId ?? proposal.relationshipRef) : null;
  const segmentId = await scalar(context.client,
    "select temporal.assert_state($1,$2,$3::tstzrange,$4,$5,$6::numeric,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16)",
    [proposal.subjectRef ? state.entity(proposal.subjectRef) : null, proposal.streamKind, rangeLiteral(proposal.worldInterval), proposal.scopeKey ?? "", proposal.status ?? null, proposal.amount ?? null, proposal.currency ?? null, proposal.unit ?? null, proposal.refEntityRef ? state.entity(proposal.refEntityRef) : null, JSON.stringify(proposal.payload), extentId, state.claim(proposal), proposal.temporalBasis, relationshipId, proposal.belief, proposal.specificationRef ?? null]);
  const segment = await describeAssertedSegment(context.client, segmentId);
  if (!segment.reused) state.touch("temporal", "segment", segmentId);
  return { ids: { segmentId, streamId: segment.streamId, ...(extentId ? { extentId } : {}) }, supersedes: segment.supersedes, ...(segment.reused ? { noop: true } : {}) };
}

/** What `assert_state` did: which older segments it closed, which stream it belongs to, and whether it reused a pre-batch segment. */
async function describeAssertedSegment(client: TenantSqlClient, segmentId: string): Promise<{ supersedes: string[]; streamId: string; reused: boolean }> {
  const supersedes = (await client.query<Row>("select id from temporal.segment where stream_id=(select stream_id from temporal.segment where id=$1) and k_to=temporal.current_k() order by id", [segmentId])).rows.map((row) => String(row.id));
  const streamId = await scalar(client, "select stream_id from temporal.segment where id=$1", [segmentId]);
  const reused = (await client.query<Row>("select 1 from temporal.segment where id=$1 and k_from<temporal.current_k()", [segmentId])).rows.length > 0;
  return { supersedes, streamId, reused };
}

async function assertEvent(context: ApplyContext, proposal: ProposalOf<"event.assert">, state: ApplyState): Promise<Written> {
  const extentId = await makeExtent(context, eventExtent(proposal));
  const occurrenceId = await scalar(context.client, "select temporal.assert_event($1,$2,$3::tstzrange,$4,$5,null,$6,$7,$8,$9::jsonb,$10)", [proposal.eventKind, state.entity(proposal.subjectRef), rangeLiteral(proposal.occurredDuring), proposal.occurrenceKind, proposal.objectRef ? state.entity(proposal.objectRef) : null, proposal.dedupeKey ?? null, extentId, state.claim(proposal), JSON.stringify(proposal.payload), proposal.belief]);
  const eventId = await scalar(context.client, "select event_id from temporal.event_occurrence where id=$1", [occurrenceId]);
  state.touch("temporal", "event_occurrence", occurrenceId);
  return { ids: { eventId, occurrenceId, ...(extentId ? { extentId } : {}) } };
}

async function admitSupport(context: ApplyContext, proposal: ProposalOf<"support.admit">, state: ApplyState): Promise<Written> {
  const claimRowId = state.claim(proposal);
  if (!claimRowId || !proposal.locatorId) throw domainError("SUPPORT_CLAIM_MISSING", `${proposal.proposalId}: no claim row or locator to admit support with`);
  const target = await resolveSupportTarget(context.client, proposal.targetRef, state);
  const supportId = await scalar(context.client, "select temporal.admit_support($1,$2,$3,$4,$5)", [target.segmentId, target.occurrenceId, claimRowId, proposal.locatorId, proposal.supportRole]);
  state.touch("evidence", "segment_support", supportId);
  return { ids: { supportId } };
}

/** A support target is a proposal in this plan (segment or occurrence it created) or an existing segment/occurrence id. */
async function resolveSupportTarget(client: TenantSqlClient, targetRef: string, state: ApplyState): Promise<{ segmentId: string | null; occurrenceId: string | null }> {
  const result = state.resultOf(targetRef);
  if (result?.segmentId) return { segmentId: String(result.segmentId), occurrenceId: null };
  const existingSegment = (await client.query<Row>("select id from temporal.segment where id=$1", [targetRef])).rows[0];
  if (existingSegment) return { segmentId: targetRef, occurrenceId: null };
  return { segmentId: null, occurrenceId: result?.occurrenceId ? String(result.occurrenceId) : targetRef };
}

async function materializeClaims(context: ApplyContext, proposal: ProposalOf<"claim.materialize">, state: ApplyState): Promise<Written> {
  const attemptId = context.intent.context.attemptId;
  if (!attemptId) throw domainError("ATTEMPT_REQUIRED", "claim.materialize needs context.attemptId (evidence.claim.producer_attempt_id is not null)");
  const claimRowIds: string[] = [];
  for (const claimId of proposal.claimIds) {
    const existing = state.claimRow(proposal.runId, claimId);
    if (existing) { claimRowIds.push(existing); continue; }
    const fact = context.plan.evidence.claims.find(claim => claim.runId === proposal.runId && claim.claimId === claimId);
    const authoritative = fact?.authoritative;
    const inline = authoritative ? { statement: authoritative.statement, claimType: authoritative.claimType, verdict: authoritative.verdict,
      subjects: authoritative.entityBindings.map(binding => ({ ref: context.intent.subjects.find(subject => subject.mode === "resolved" && subject.entityId === binding.canonicalId)?.ref, role: binding.role })) }
      : fact?.fixtureOnly ? context.intent.evidence.claims.find((claim) => claim.runId === proposal.runId && claim.claimId === claimId) : undefined;
    if (!inline) throw domainError("CLAIM_TEXT_MISSING", `${proposal.proposalId}: no inline text for ${claimKey(proposal.runId, claimId)}`);
    const manifestDigest = authoritative?.manifestDigest ?? context.intent.evidence.verificationRuns.find((run) => run.runId === proposal.runId)?.manifestDigest ?? null;
    const structured = { verification: { runId: proposal.runId, claimId, verdict: inline.verdict ?? null, manifestDigest, qualifiers: authoritative?.qualifiers ?? [], policyVersion: authoritative?.policyVersion ?? null } };
    const claimRowId = await scalar(context.client, "insert into evidence.claim(claim_type, statement, structured, status, producer_attempt_id, created_by_receipt_id, tenant_id) values($1,$2,$3::jsonb,'proposed',$4,$5,$6) returning id", [inline.claimType, inline.statement, JSON.stringify(structured), attemptId, context.receiptId, context.tenantId]);
    for (const subject of inline.subjects) {
      if (!subject.ref) throw domainError("CLAIM_SUBJECT_REVERIFICATION_REQUIRED", "Verified claim subject is unresolved");
      const entityId = state.entityIdOf(subject.ref);
      if (entityId) await context.client.query("insert into evidence.claim_subject(claim_id, entity_id, role) values($1,$2,$3) on conflict do nothing", [claimRowId, entityId, subject.role]);
    }
    state.rememberClaimRow(proposal.runId, claimId, claimRowId);
    state.touch("evidence", "claim", claimRowId);
    claimRowIds.push(claimRowId);
  }
  return { ids: { claimRowIds } };
}

async function observeMetric(context: ApplyContext, proposal: ProposalOf<"metric.observe">, state: ApplyState): Promise<Written> {
  const observationId = await scalar(context.client, "insert into ranking.metric_observation(metric_definition_version_id, subject_entity_id, benchmark_run_id, value, unit, observed_at, claim_id) values($1,$2,$3,$4,$5,$6::timestamptz,$7) returning id",
    [proposal.metricDefinitionVersionId, state.entity(proposal.subjectRef), proposal.benchmarkRunRef ? state.entity(proposal.benchmarkRunRef) : null, proposal.value, proposal.unit ?? null, proposal.observedAt, state.claim(proposal)]);
  state.touch("ranking", "metric_observation", observationId);
  return { ids: { observationId } };
}

/** Stages a `candidate.stage` proposal, or any proposal the plan routed to review, for a human decision. */
async function stageCandidate(context: ApplyContext, proposal: Proposal, state: ApplyState): Promise<CreatedIds> {
  const payload = proposal.kind === "candidate.stage"
    ? { displayName: proposal.displayName, reason: proposal.reason, payload: proposal.payload, rationale: proposal.rationale ?? null }
    : { proposal, reason: "review_required" };
  const candidateId = await scalar(context.client, "insert into staging.candidate(proposed_kind, proposed_payload) values($1,$2::jsonb) returning id", [candidateKind(context.plan, proposal), JSON.stringify({ ...payload, intentId: context.intent.intentId, proposalId: proposal.proposalId })]);
  state.touch("staging", "candidate", candidateId);
  return { candidateId };
}

const FALLBACK_CANDIDATE_KIND = "concept";

function candidateKind(plan: IngestionPlan, proposal: Proposal): string {
  if (proposal.kind === "candidate.stage") return proposal.entityKind;
  if (proposal.kind === "entity.create") return plan.subjects.find((subject) => subject.ref === proposal.subjectRef)?.kind ?? FALLBACK_CANDIDATE_KIND;
  return FALLBACK_CANDIDATE_KIND;
}

async function publishReport(context: ApplyContext, proposal: ProposalOf<"report.publish">, state: ApplyState): Promise<Written> {
  const artifactId = await reportArtifactId(context, proposal);
  const slug = `${context.intent.intentId}-${slugify(proposal.title)}`.slice(0, MAX_REPORT_SLUG_LENGTH);
  const reportId = await scalar(context.client, "insert into research.report(mission_id, slug, title) values($1,$2,$3) on conflict (tenant_id, slug) do update set title=excluded.title returning id", [context.intent.context.missionId ?? null, slug, proposal.title]);
  const version = Number(await scalar(context.client, "select coalesce(max(version),0)+1 from research.report_version where report_id=$1", [reportId]));
  const versionId = await scalar(context.client, "insert into research.report_version(report_id, version, markdown_artifact_id, assurance_summary) values($1,$2,$3,$4::jsonb) returning id", [reportId, version, artifactId, JSON.stringify({ asOf: proposal.asOf, receiptId: context.receiptId })]);
  const claimRowIds: string[] = [];
  for (const reference of proposal.claimRefs ?? []) {
    const claimRowId = state.claimRow(reference.runId, reference.claimId);
    if (!claimRowId) throw domainError("REPORT_CLAIM_MISSING", "A bound report claim is not materialized");
    await context.client.query("insert into research.report_claim(report_version_id, claim_id, role) values($1,$2,$3) on conflict do nothing", [versionId, claimRowId, REPORT_CLAIM_ROLE]);
    claimRowIds.push(claimRowId);
  }
  state.touch("research", "report", reportId);
  state.touch("research", "report_version", versionId);
  return { ids: { reportId, reportVersionId: versionId, markdownArtifactId: artifactId, version: String(version), claimRowIds } };
}

/** The plan admits `report.publish` only with inline markdown or an existing artifact id. */
async function reportArtifactId(context: ApplyContext, proposal: ProposalOf<"report.publish">): Promise<string> {
  if (proposal.reportArtifactId) return proposal.reportArtifactId;
  if (!proposal.markdown) throw domainError("EXECUTOR_INTERNAL", `${proposal.proposalId}: report.publish reached apply without markdown or reportArtifactId`);
  const missionId = context.intent.context.missionId;
  const stored = await context.artifacts.putWith(context.client, { tenantId: context.tenantId, artifactType: "knowledge_report_markdown", text: proposal.markdown, ...(missionId ? { missionId } : {}) });
  return stored.artifactId;
}
