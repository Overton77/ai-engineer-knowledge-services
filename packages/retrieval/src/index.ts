import { deepFreeze, sha256Digest } from "@aiengineer/knowledge-domain";
import type {
  SourceLocator,
  VectorSpace,
} from "@aiengineer/knowledge-contracts";

export type RetrievalIntent =
  | "entity_discovery"
  | "knowledge_evidence"
  | "decision_support"
  | "implementation_support"
  | "tool_selection"
  | "implementation_lookup";
export type FilterValue =
  | string
  | number
  | boolean
  | readonly (string | number | boolean)[];
export interface RetrievalFilter {
  readonly field: string;
  readonly op: "eq" | "neq" | "in" | "contains" | "gte" | "lte";
  readonly value: FilterValue;
}
export interface RetrievalSubquery {
  readonly id: string;
  readonly text: string;
  readonly coverageRole: "required" | "supporting" | "optional";
}
export interface AdvancedRetrievalPlan {
  readonly policyVersionId: string;
  readonly normalizedQuery: string;
  readonly intents: readonly RetrievalIntent[];
  readonly subqueries: readonly RetrievalSubquery[];
  readonly spaces: readonly VectorSpace[];
  readonly hardFilters: readonly RetrievalFilter[];
  readonly softBoosts: readonly RetrievalFilter[];
  readonly candidateK: number;
  readonly finalK: number;
  readonly graph: {
    readonly maxDepth: number;
    readonly allowedEdges: readonly string[];
  };
  readonly minimumCoverage: number;
  readonly minimumEvidenceScore: number;
  readonly minimumEvidenceTerms: number;
}
export interface RetrievalPolicy {
  readonly id: string;
  readonly admittedSpaces: readonly VectorSpace[];
  readonly allowedFilterFields: readonly string[];
  readonly allowedGraphEdges: readonly string[];
  readonly allowedVisibilities?: readonly string[];
  readonly maxCandidateK: number;
  readonly maxFinalK: number;
  readonly maxGraphDepth: number;
  readonly maxGraphNodes: number;
  readonly rrfK: number;
  readonly channelWeights: Readonly<Partial<Record<RetrievalChannel, number>>>;
  readonly maxPerSource: number;
  readonly contextRadius: number;
  readonly minimumCoverage: number;
  readonly minimumEvidenceScore?: number;
  readonly minimumEvidenceTerms?: number;
}
export interface RetrievalRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly projectionId: string;
  readonly projectionVersionId: string;
  readonly space: VectorSpace;
  readonly targetKind: string;
  readonly targetSchemaVersion: string;
  readonly text: string;
  readonly identifiers?: readonly string[];
  readonly vector?: readonly number[];
  readonly fields: Readonly<Record<string, FilterValue>>;
  readonly locators: readonly SourceLocator[];
  readonly artifactIds?: readonly string[];
  readonly authority: "canonical" | "exploratory" | "user_managed";
  readonly assurance: "high" | "medium" | "low";
  readonly freshnessAt: string;
  readonly promoted: boolean;
  readonly lifecycle?: "active" | "inactive" | "tombstoned";
  readonly sourceId: string;
  readonly parentId?: string;
  readonly ordinal?: number;
  readonly contradictionIds?: readonly string[];
  readonly supersedesIds?: readonly string[];
  readonly flags?: Partial<RetrievalFlags>;
}
export interface RetrievalFlags {
  readonly contradicted: boolean;
  readonly corrected: boolean;
  readonly retracted: boolean;
  readonly deprecated: boolean;
  readonly superseded: boolean;
}
export interface GraphEdge {
  readonly fromId: string;
  readonly toId: string;
  readonly kind: string;
  readonly verified: boolean;
  readonly rationale?: string;
  readonly provenance?: readonly string[];
  readonly locatorDigest?: string;
}
export type RetrievalChannel =
  | "exact"
  | "trigram"
  | "fts"
  | "semantic"
  | "graph"
  | "rerank";
export interface StageContribution {
  readonly channel: RetrievalChannel;
  readonly rank: number;
  readonly rawScore: number;
  readonly rrfContribution: number;
  readonly explanation: string;
  readonly graphPath?: readonly string[];
}
export interface RetrievedCandidate {
  readonly record: RetrievalRecord;
  readonly contributions: readonly StageContribution[];
  readonly matchedConstraints: readonly string[];
  readonly penalties: readonly string[];
  readonly score: number;
  readonly finalRank: number;
  readonly contextOnly: boolean;
  readonly coveredSubqueryIds: readonly string[];
}
export interface EvidenceMember {
  readonly memberId: string;
  readonly recordId: string;
  readonly projectionId: string;
  readonly space: VectorSpace;
  readonly locators: readonly SourceLocator[];
  readonly contributions: readonly StageContribution[];
  readonly graphPaths: readonly (readonly string[])[];
  readonly matchedConstraints: readonly string[];
  readonly penalties: readonly string[];
  readonly authority: RetrievalRecord["authority"];
  readonly assurance: RetrievalRecord["assurance"];
  readonly freshAt: string;
  readonly contradictionIds: readonly string[];
  readonly supersedesIds: readonly string[];
  readonly coveredSubqueryIds: readonly string[];
  readonly contextOnly: boolean;
  readonly finalScore: number;
  readonly finalRank: number;
}
export interface ImmutableEvidencePacket {
  readonly id: string;
  readonly tenantId: string;
  readonly retrievalRunId: string;
  readonly digest: `sha256:${string}`;
  readonly createdAt: string;
  readonly normalizedQuery: string;
  readonly plan: AdvancedRetrievalPlan;
  readonly members: readonly EvidenceMember[];
  readonly omittedResults: readonly { recordId?: string; reason: string }[];
  readonly coverage: readonly { subqueryId: string; coverage: number }[];
  readonly abstention: {
    readonly recommended: boolean;
    readonly reason?: string;
  };
  readonly degradedMode: boolean;
  readonly stageLatenciesMs: Readonly<Record<string, number>>;
  readonly receiptId: string;
}
export interface Reranker {
  readonly version: string;
  rerank(
    query: string,
    records: readonly RetrievalRecord[],
  ): Promise<readonly { recordId: string; score: number }[]>;
}
export interface RetrievalStages {
  readonly exact: boolean;
  readonly trigram: boolean;
  readonly fts: boolean;
  readonly semantic: boolean;
  readonly graph: boolean;
  readonly rerank: boolean;
  readonly diversity: boolean;
  readonly context: boolean;
}
export interface RetrieveOptions {
  readonly tenantId: string;
  readonly policy: RetrievalPolicy;
  readonly records: readonly RetrievalRecord[];
  readonly graphEdges?: readonly GraphEdge[];
  readonly queryVector?: readonly number[];
  readonly hardFilters?: readonly RetrievalFilter[];
  readonly spaces?: readonly VectorSpace[];
  readonly candidateK?: number;
  readonly finalK?: number;
  readonly reranker?: Reranker;
  readonly now?: string;
  readonly retrievalRunId?: string;
  readonly stages?: Partial<RetrievalStages>;
}

const ALL_SPACES: readonly VectorSpace[] = [
  "engineering_claims",
  "tool_capabilities",
  "implementation_examples",
  "paper_case_study_knowledge",
  "entity_profiles",
  "model_capabilities",
  "benchmark_intelligence",
  "source_native_sections",
];
export function buildRetrievalPlan(
  query: string,
  policy: RetrievalPolicy,
  options: Pick<
    RetrieveOptions,
    "hardFilters" | "spaces" | "candidateK" | "finalK"
  > = {},
): AdvancedRetrievalPlan {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) throw new Error("QUERY_REQUIRED");
  const spaces = options.spaces ?? inferSpaces(normalizedQuery);
  const unauthorized = spaces.filter((x) => !policy.admittedSpaces.includes(x));
  if (unauthorized.length)
    throw new Error(`SPACE_NOT_ADMITTED:${unauthorized.join(",")}`);
  const filters = options.hardFilters ?? [];
  for (const filter of filters)
    if (!policy.allowedFilterFields.includes(filter.field))
      throw new Error(`FILTER_NOT_ALLOWED:${filter.field}`);
  const candidateK = options.candidateK ?? Math.min(50, policy.maxCandidateK);
  const finalK = options.finalK ?? Math.min(10, policy.maxFinalK);
  if (
    !Number.isInteger(candidateK) ||
    !Number.isInteger(finalK) ||
    candidateK < 1 ||
    finalK < 1 ||
    candidateK > policy.maxCandidateK ||
    finalK > policy.maxFinalK ||
    finalK > candidateK
  )
    throw new Error("RETRIEVAL_LIMIT_EXCEEDED");
  if (!Number.isFinite(policy.rrfK) || policy.rrfK < 1)
    throw new Error("INVALID_RRF_POLICY");
  if (
    !Number.isFinite(policy.minimumCoverage) ||
    policy.minimumCoverage < 0 ||
    policy.minimumCoverage > 1
  )
    throw new Error("INVALID_COVERAGE_POLICY");
  const parts = normalizedQuery
    .split(/\s+(?:versus|vs\.?|then)\s+|[;?]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 16);
  const subqueries = (parts.length ? parts : [normalizedQuery]).map(
    (text, index) => ({
      id: `q${index + 1}`,
      text,
      coverageRole:
        index === 0 ? ("required" as const) : ("supporting" as const),
    }),
  );
  const minimumEvidenceScore = policy.minimumEvidenceScore ?? 0;
  if (
    !Number.isFinite(minimumEvidenceScore) ||
    minimumEvidenceScore < 0 ||
    minimumEvidenceScore > 1
  )
    throw new Error("INVALID_EVIDENCE_SCORE_POLICY");
  const minimumEvidenceTerms = policy.minimumEvidenceTerms ?? 0;
  if (!Number.isInteger(minimumEvidenceTerms) || minimumEvidenceTerms < 0)
    throw new Error("INVALID_EVIDENCE_TERMS_POLICY");
  return deepFreeze({
    policyVersionId: policy.id,
    normalizedQuery,
    intents: inferIntents(normalizedQuery),
    subqueries,
    spaces,
    hardFilters: filters,
    softBoosts: [],
    candidateK,
    finalK,
    graph: {
      maxDepth: Math.min(1, policy.maxGraphDepth),
      allowedEdges: policy.allowedGraphEdges,
    },
    minimumCoverage: policy.minimumCoverage,
    minimumEvidenceScore,
    minimumEvidenceTerms,
  });
}

export async function retrieve(
  query: string,
  options: RetrieveOptions,
): Promise<ImmutableEvidencePacket> {
  const now = options.now ?? new Date().toISOString();
  const plan = buildRetrievalPlan(query, options.policy, options);
  const stages: RetrievalStages = {
    exact: true,
    trigram: true,
    fts: true,
    semantic: true,
    graph: true,
    rerank: true,
    diversity: true,
    context: true,
    ...options.stages,
  };
  const omitted: { recordId?: string; reason: string }[] = [];
  const timings: Record<string, number> = {};
  const time = <T>(name: string, fn: () => T): T => {
    const start = performance.now();
    const result = fn();
    timings[name] = performance.now() - start;
    return result;
  };
  const eligible = time("authorize_filter", () =>
    options.records.filter((record) => {
      if (record.tenantId !== options.tenantId) {
        omitted.push({ recordId: record.id, reason: "tenant_mismatch" });
        return false;
      }
      if (
        options.policy.allowedVisibilities &&
        !options.policy.allowedVisibilities.includes(
          String(record.fields.visibility),
        )
      ) {
        omitted.push({
          recordId: record.id,
          reason: "visibility_not_authorized",
        });
        return false;
      }
      if (
        !plan.spaces.includes(record.space) ||
        !record.promoted ||
        record.lifecycle === "inactive" ||
        record.lifecycle === "tombstoned"
      ) {
        omitted.push({ recordId: record.id, reason: "not_eligible" });
        return false;
      }
      if (!plan.hardFilters.every((filter) => matches(record, filter))) {
        omitted.push({ recordId: record.id, reason: "hard_filter_mismatch" });
        return false;
      }
      return true;
    }),
  );
  const channelRanks = new Map<string, StageContribution[]>();
  const rankChannel = (
    channel: RetrievalChannel,
    scored: readonly {
      record: RetrievalRecord;
      score: number;
      explanation: string;
      graphPath?: readonly string[];
    }[],
  ) => {
    scored.slice(0, plan.candidateK).forEach((item, index) => {
      const weight = options.policy.channelWeights[channel] ?? 1;
      const contribution = weight / (options.policy.rrfK + index + 1);
      const entry: {
        channel: RetrievalChannel;
        rank: number;
        rawScore: number;
        rrfContribution: number;
        explanation: string;
        graphPath?: readonly string[];
      } = {
        channel,
        rank: index + 1,
        rawScore: item.score,
        rrfContribution: contribution,
        explanation: item.explanation,
        ...(item.graphPath ? { graphPath: item.graphPath } : {}),
      };
      channelRanks.set(item.record.id, [
        ...(channelRanks.get(item.record.id) ?? []),
        entry,
      ]);
    });
  };
  time("lexical", () => {
    for (const subquery of plan.subqueries) {
      const tokens = tokenize(subquery.text);
      if (stages.exact)
        rankChannel(
          "exact",
          score(
            eligible,
            (r) => exactScore(r, subquery.text),
            "exact identifier/phrase match",
          ),
        );
      if (stages.trigram)
        rankChannel(
          "trigram",
          score(
            eligible,
            (r) => trigramScore(r.text, subquery.text),
            "trigram similarity",
          ),
        );
      if (stages.fts)
        rankChannel(
          "fts",
          score(
            eligible,
            (r) => ftsScore(r.text, tokens),
            "full-text token coverage",
          ),
        );
    }
  });
  if (options.queryVector && stages.semantic)
    time("semantic", () =>
      rankChannel(
        "semantic",
        score(
          eligible,
          (r) => (r.vector ? cosine(options.queryVector!, r.vector) : 0),
          "cosine semantic similarity",
        ),
      ),
    );
  if (stages.graph)
    time("graph", () => {
      const seeds = [...channelRanks.entries()]
        .sort((a, b) => sum(b[1]) - sum(a[1]))
        .slice(0, Math.min(10, plan.candidateK))
        .map(([id]) => id);
      const byId = new Map(eligible.map((x) => [x.id, x]));
      const seen = new Set(seeds);
      let frontier = seeds.map((id) => ({ id, path: [id] }));
      for (let depth = 1; depth <= plan.graph.maxDepth; depth++) {
        const next: typeof frontier = [];
        for (const node of frontier)
          for (const edge of options.graphEdges ?? []) {
            const sourceRecord = byId.get(edge.fromId),
              targetRecord = byId.get(edge.toId);
            const locatorBoundToEndpoint = [sourceRecord, targetRecord].some(
              (endpoint) =>
                endpoint?.locators.some(
                  (locator) => locator.quoteDigest === edge.locatorDigest,
                ),
            );
            if (
              !edge.verified ||
              !edge.rationale?.trim() ||
              !edge.provenance?.length ||
              !edge.locatorDigest ||
              !locatorBoundToEndpoint ||
              edge.fromId !== node.id ||
              !plan.graph.allowedEdges.includes(edge.kind) ||
              seen.size >= options.policy.maxGraphNodes
            )
              continue;
            const record = targetRecord;
            if (!record) continue;
            const path = [...node.path, edge.kind, edge.toId];
            rankChannel("graph", [
              {
                record,
                score: 1 / depth,
                explanation: `verified ${edge.kind} expansion: ${edge.rationale}`,
                graphPath: path,
              },
            ]);
            if (!seen.has(edge.toId)) {
              seen.add(edge.toId);
              next.push({ id: edge.toId, path });
            }
          }
        frontier = next;
      }
    });
  let degradedMode = false;
  if (options.reranker && stages.rerank) {
    const fusedIds = [...channelRanks.entries()]
      .sort((a, b) => sum(b[1]) - sum(a[1]))
      .slice(0, plan.candidateK)
      .map(([id]) => id);
    try {
      const reranked = await options.reranker.rerank(
        plan.normalizedQuery,
        fusedIds.map((id) => eligible.find((r) => r.id === id)!),
      );
      rankChannel(
        "rerank",
        reranked
          .map((x) => ({
            record: eligible.find((r) => r.id === x.recordId)!,
            score: x.score,
            explanation: `reranker ${options.reranker!.version}`,
          }))
          .filter((x) => x.record !== undefined),
      );
    } catch {
      degradedMode = true;
      omitted.push({ reason: "reranker_failed_fused_results_used" });
    }
  }
  const prelim = [...channelRanks]
    .map(([id, contributions]) => {
      const record = eligible.find((x) => x.id === id)!;
      const covered = plan.subqueries
        .filter(
          (q) =>
            exactScore(record, q.text) > 0 ||
            ftsScore(record.text, tokenize(q.text)) > 0,
        )
        .map((q) => q.id);
      const penalties: string[] = [];
      let penalty = 0;
      if (record.flags?.retracted) {
        penalties.push("retracted");
        penalty += 1;
      }
      if (record.flags?.superseded) {
        penalties.push("superseded");
        penalty += 0.25;
      }
      if (record.flags?.contradicted) {
        penalties.push("contradicted");
        penalty += 0.15;
      }
      const ageDays = Math.max(
        0,
        (Date.parse(now) - Date.parse(record.freshnessAt)) / 86_400_000,
      );
      if (ageDays > 730) {
        penalties.push("stale_over_730_days");
        penalty += 0.02;
      }
      return {
        record,
        contributions,
        matchedConstraints: plan.hardFilters.map((f) => `${f.field}:${f.op}`),
        penalties,
        score: sum(contributions) - penalty,
        coveredSubqueryIds: covered,
      };
    })
    .filter((x) => {
      if (x.record.flags?.retracted) {
        omitted.push({ recordId: x.record.id, reason: "retracted" });
        return false;
      }
      return true;
    })
    .sort(compareCandidate);
  const selected: typeof prelim = [];
  const sourceCounts = new Map<string, number>();
  for (const item of prelim) {
    if (selected.length >= plan.finalK) break;
    const count = sourceCounts.get(item.record.sourceId) ?? 0;
    if (stages.diversity && count >= options.policy.maxPerSource) {
      omitted.push({
        recordId: item.record.id,
        reason: "source_diversity_cap",
      });
      continue;
    }
    sourceCounts.set(item.record.sourceId, count + 1);
    selected.push(item);
  }
  const ranked: RetrievedCandidate[] = selected.map((item, index) => ({
    ...item,
    finalRank: index + 1,
    contextOnly: false,
  }));
  const selectedIds = new Set(ranked.map((x) => x.record.id));
  if (stages.context && options.policy.contextRadius > 0) {
    for (const item of [...ranked])
      for (const context of eligible) {
        if (
          selectedIds.has(context.id) ||
          context.sourceId !== item.record.sourceId ||
          context.ordinal === undefined ||
          item.record.ordinal === undefined ||
          Math.abs(context.ordinal - item.record.ordinal) >
            options.policy.contextRadius
        )
          continue;
        selectedIds.add(context.id);
        ranked.push({
          record: context,
          contributions: [],
          matchedConstraints: [],
          penalties: [],
          score: 0,
          finalRank: item.finalRank,
          contextOnly: true,
          coveredSubqueryIds: [],
        });
      }
  }
  const coverage = plan.subqueries.map((q) => ({
    subqueryId: q.id,
    coverage: ranked.some(
      (item) => !item.contextOnly && item.coveredSubqueryIds.includes(q.id),
    )
      ? 1
      : 0,
  }));
  const required = coverage.filter(
    (_, i) => plan.subqueries[i]!.coverageRole === "required",
  );
  const coverageScore =
    required.reduce((n, x) => n + x.coverage, 0) / Math.max(1, required.length);
  const evidenceScore = Math.max(
    0,
    ...selected.flatMap((item) =>
      item.contributions
        .filter(
          ({ channel }) =>
            channel === "exact" || channel === "fts" || channel === "semantic",
        )
        .map(({ rawScore }) => rawScore),
    ),
  );
  const queryTerms = tokenize(plan.normalizedQuery);
  const evidenceTerms = Math.max(
    0,
    ...selected.map((item) => {
      const textTerms = new Set(tokenize(item.record.text));
      return queryTerms.filter((term) => textTerms.has(term)).length;
    }),
  );
  const exactIdentifierHit = selected.some((item) =>
    item.contributions.some(
      ({ channel, rawScore }) => channel === "exact" && rawScore === 1,
    ),
  );
  const insufficientTerms =
    !exactIdentifierHit && evidenceTerms < plan.minimumEvidenceTerms;
  const policyBypassAttempt =
    /\b(?:ignore|bypass|disable|override)\b.{0,48}\b(?:tenant|authorization|access|policy|filter)s?\b|\b(?:reveal|exfiltrate|leak)\b.{0,48}\b(?:private|secret|other (?:tenant|customer))\b/i.test(
      plan.normalizedQuery,
    );
  const abstain =
    policyBypassAttempt ||
    coverageScore < plan.minimumCoverage ||
    evidenceScore < plan.minimumEvidenceScore ||
    insufficientTerms ||
    selected.length === 0;
  const members = ranked.map((item) =>
    deepFreeze({
      memberId: stableId(`member:${item.record.id}:${item.contextOnly}`),
      recordId: item.record.id,
      projectionId: item.record.projectionId,
      space: item.record.space,
      locators: item.record.locators,
      contributions: item.contributions,
      graphPaths: item.contributions.flatMap((c) =>
        c.graphPath ? [c.graphPath] : [],
      ),
      matchedConstraints: item.matchedConstraints,
      penalties: item.penalties,
      authority: item.record.authority,
      assurance: item.record.assurance,
      freshAt: item.record.freshnessAt,
      contradictionIds: item.record.contradictionIds ?? [],
      supersedesIds: item.record.supersedesIds ?? [],
      coveredSubqueryIds: item.coveredSubqueryIds,
      contextOnly: item.contextOnly,
      finalScore: item.score,
      finalRank: item.finalRank,
    }),
  );
  const retrievalRunId =
    options.retrievalRunId ??
    stableId(`run:${options.tenantId}:${sha256Digest(JSON.stringify(plan))}`);
  const receiptId = stableId(`receipt:${retrievalRunId}`);
  const immutableCore = {
    tenantId: options.tenantId,
    retrievalRunId,
    normalizedQuery: plan.normalizedQuery,
    plan,
    members,
    omittedResults: omitted,
    coverage,
    abstention: {
      recommended: abstain,
      ...(abstain
        ? {
            reason: policyBypassAttempt
              ? "query requests authorization-policy bypass"
              : coverageScore < plan.minimumCoverage
                ? `required subquery coverage ${coverageScore.toFixed(2)} is below ${plan.minimumCoverage.toFixed(2)}`
                : insufficientTerms
                  ? `top evidence matches ${evidenceTerms} query terms; ${plan.minimumEvidenceTerms} required`
                  : `top evidence score ${evidenceScore.toFixed(3)} is below ${plan.minimumEvidenceScore.toFixed(3)}`,
          }
        : {}),
    },
    degradedMode,
    receiptId,
  };
  const digest = sha256Digest(JSON.stringify(immutableCore));
  return deepFreeze({
    id: stableId(`packet:${digest}`),
    digest,
    createdAt: now,
    ...immutableCore,
    stageLatenciesMs: timings,
  });
}

function score(
  records: readonly RetrievalRecord[],
  scorer: (r: RetrievalRecord) => number,
  explanation: string,
) {
  return records
    .map((record) => ({ record, score: scorer(record), explanation }))
    .filter((x) => x.score > 0)
    .sort(
      (a, b) => b.score - a.score || a.record.id.localeCompare(b.record.id),
    );
}
function exactScore(record: RetrievalRecord, query: string) {
  const q = normalize(query);
  return (record.identifiers ?? []).some((x) => {
    const identifier = normalize(x);
    return identifier === q || q.includes(identifier);
  })
    ? 1
    : normalize(record.text).includes(q)
      ? 0.95
      : 0;
}
function tokenize(value: string) {
  return [
    ...new Set(
      normalize(value)
        .split(/[^a-z0-9_+.#/-]+/)
        .filter((x) => x.length > 1),
    ),
  ];
}
function ftsScore(text: string, tokens: readonly string[]) {
  if (!tokens.length) return 0;
  const words = tokenize(text);
  const set = new Set(words);
  return tokens.filter((x) => set.has(x)).length / tokens.length;
}
function trigramScore(a: string, b: string) {
  const grams = (x: string) => {
    const n = `  ${normalize(x)} `;
    const result: string[] = [];
    for (let i = 0; i < n.length - 2; i++) result.push(n.slice(i, i + 3));
    return result;
  };
  const aa = grams(a),
    bb = grams(b),
    counts = new Map<string, number>();
  aa.forEach((x) => counts.set(x, (counts.get(x) ?? 0) + 1));
  let overlap = 0;
  for (const x of bb) {
    const count = counts.get(x) ?? 0;
    if (count) {
      overlap++;
      counts.set(x, count - 1);
    }
  }
  return aa.length + bb.length ? (2 * overlap) / (aa.length + bb.length) : 0;
}
function cosine(a: readonly number[], b: readonly number[]) {
  if (a.length !== b.length)
    throw new Error(`QUERY_VECTOR_DIMENSION_MISMATCH:${a.length}:${b.length}`);
  let dot = 0,
    an = 0,
    bn = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i]!,
      bv = b[i]!;
    if (!Number.isFinite(av) || !Number.isFinite(bv))
      throw new Error("NON_FINITE_VECTOR");
    dot += av * bv;
    an += av * av;
    bn += bv * bv;
  }
  return an && bn ? dot / (Math.sqrt(an) * Math.sqrt(bn)) : 0;
}
function matches(record: RetrievalRecord, filter: RetrievalFilter) {
  const actual = record.fields[filter.field];
  const expected = filter.value;
  if (actual === undefined) return false;
  switch (filter.op) {
    case "eq":
      return actual === expected;
    case "neq":
      return actual !== expected;
    case "in":
      return Array.isArray(expected) && expected.includes(actual as never);
    case "contains":
      return Array.isArray(actual)
        ? actual.includes(expected as never)
        : String(actual).includes(String(expected));
    case "gte":
      return actual >= expected;
    case "lte":
      return actual <= expected;
  }
}
function sum(items: readonly StageContribution[]) {
  return items.reduce((n, x) => n + x.rrfContribution, 0);
}
function compareCandidate(
  a: { score: number; record: RetrievalRecord },
  b: { score: number; record: RetrievalRecord },
) {
  return (
    b.score - a.score ||
    b.record.assurance.localeCompare(a.record.assurance) ||
    Date.parse(b.record.freshnessAt) - Date.parse(a.record.freshnessAt) ||
    a.record.id.localeCompare(b.record.id)
  );
}
function normalize(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/\s+/g, " ")
    .trim();
}
function inferIntents(query: string): RetrievalIntent[] {
  const result: RetrievalIntent[] = [];
  if (/who|company|organization|entity/.test(query))
    result.push("entity_discovery");
  if (/how|code|implement|example|api/.test(query))
    result.push("implementation_support");
  if (/tool|choose|compare|best/.test(query)) result.push("tool_selection");
  if (/claim|evidence|why|does|what/.test(query))
    result.push("knowledge_evidence");
  return result.length ? result : ["decision_support"];
}
function inferSpaces(query: string): VectorSpace[] {
  if (/benchmark|score|metric/.test(query)) return ["benchmark_intelligence"];
  if (/model|llm/.test(query))
    return ["model_capabilities", "engineering_claims"];
  if (/code|implement|api|repository/.test(query))
    return [
      "implementation_examples",
      "tool_capabilities",
      "source_native_sections",
    ];
  if (/paper|study/.test(query))
    return ["paper_case_study_knowledge", "source_native_sections"];
  if (/who|company|organization/.test(query))
    return ["entity_profiles", "engineering_claims"];
  return [...ALL_SPACES];
}
function stableId(seed: string) {
  const hex = sha256Digest(seed).slice(7, 39);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
