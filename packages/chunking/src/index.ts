import type { DocumentNode, SourceLocator, VectorSpace } from "@aiengineer/knowledge-contracts";
import { deepFreeze, sha256Digest } from "@aiengineer/knowledge-domain";
import { deterministicUuid } from "@aiengineer/knowledge-documents";

export type ChunkStrategy = "transcripts" | "headings" | "claims" | "entities" | "tools" | "code" | "tables";

export interface ChunkProfile {
  readonly name: string;
  readonly version: string;
  readonly strategy: ChunkStrategy;
  readonly spaces: readonly VectorSpace[];
  readonly tokenizer: "unicode-word-punctuation-v1";
  readonly targetTokens: number;
  readonly minimumTokens: number;
  readonly maximumTokens: number;
  readonly overlapTokens: number;
  readonly maximumDuplicatedTokenRatio: number;
  readonly boilerplateOccurrences: number;
  readonly contextualHeadingPrefix: boolean;
}

export interface PreparedChunkSpan {
  readonly nodeId: string;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly locator: SourceLocator;
}

export interface PreparedChunk {
  readonly id: string;
  readonly ordinal: number;
  readonly role: string;
  readonly sourceText: string;
  readonly contextualPrefix: string;
  readonly embeddingText: string;
  readonly sourceTextDigest: `sha256:${string}`;
  readonly embeddingTextDigest: `sha256:${string}`;
  readonly sourceTokenCount: number;
  readonly embeddingTokenCount: number;
  readonly spans: readonly PreparedChunkSpan[];
}

export interface ChunkQaResult {
  readonly valid: boolean;
  readonly issues: readonly string[];
  readonly duplicateTokenRatio: number;
  readonly reconstructedChunkCount: number;
}

export interface ChunkingResult {
  readonly profile: ChunkProfile;
  readonly inputDigest: `sha256:${string}`;
  readonly outputDigest: `sha256:${string}`;
  readonly chunks: readonly PreparedChunk[];
  readonly omittedNodeIds: readonly string[];
  readonly qa: ChunkQaResult;
}

const defaults = {
  version: "1.0.0", tokenizer: "unicode-word-punctuation-v1" as const,
  targetTokens: 220, minimumTokens: 1, maximumTokens: 360, overlapTokens: 24,
  maximumDuplicatedTokenRatio: 0.2, boilerplateOccurrences: 3, contextualHeadingPrefix: true,
};

const profiles: readonly ChunkProfile[] = [
  { ...defaults, name: "transcript-topics-v1", strategy: "transcripts", spaces: ["source_native_sections", "engineering_claims"], targetTokens: 180, maximumTokens: 280 },
  { ...defaults, name: "heading-sections-v1", strategy: "headings", spaces: ["source_native_sections", "paper_case_study_knowledge"] },
  { ...defaults, name: "atomic-claims-v1", strategy: "claims", spaces: ["engineering_claims"], targetTokens: 80, maximumTokens: 160, overlapTokens: 0 },
  { ...defaults, name: "entity-facets-v1", strategy: "entities", spaces: ["entity_profiles"], targetTokens: 120, maximumTokens: 220, overlapTokens: 0 },
  { ...defaults, name: "tool-capabilities-v1", strategy: "tools", spaces: ["tool_capabilities", "model_capabilities"], targetTokens: 160, maximumTokens: 280 },
  { ...defaults, name: "code-symbols-v1", strategy: "code", spaces: ["implementation_examples"], targetTokens: 240, maximumTokens: 420, overlapTokens: 16 },
  { ...defaults, name: "table-row-groups-v1", strategy: "tables", spaces: ["benchmark_intelligence", "paper_case_study_knowledge"], targetTokens: 180, maximumTokens: 320, overlapTokens: 0 },
];

export class ChunkProfileRegistry {
  readonly #profiles = new Map<string, ChunkProfile>();
  constructor(initial: readonly ChunkProfile[] = profiles) {
    for (const profile of initial) this.register(profile);
  }
  register(profile: ChunkProfile): void {
    validateProfile(profile);
    const key = `${profile.name}@${profile.version}`;
    if (this.#profiles.has(key)) throw new Error(`Chunk profile already registered: ${key}`);
    this.#profiles.set(key, deepFreeze({ ...profile, spaces: [...profile.spaces] }));
  }
  get(name: string, version = "1.0.0"): ChunkProfile {
    const profile = this.#profiles.get(`${name}@${version}`);
    if (profile === undefined) throw new Error(`Unknown chunk profile: ${name}@${version}`);
    return profile;
  }
  forSpace(space: VectorSpace): readonly ChunkProfile[] {
    return [...this.#profiles.values()].filter(({ spaces }) => spaces.includes(space));
  }
  list(): readonly ChunkProfile[] { return [...this.#profiles.values()]; }
}

export const defaultChunkProfileRegistry = new ChunkProfileRegistry();

function validateProfile(profile: ChunkProfile): void {
  if (profile.minimumTokens < 1 || profile.targetTokens < profile.minimumTokens || profile.maximumTokens < profile.targetTokens) {
    throw new Error(`Invalid token bounds for ${profile.name}`);
  }
  if (profile.overlapTokens >= profile.maximumTokens) throw new Error(`Overlap must be below maximum tokens for ${profile.name}`);
  if (profile.maximumDuplicatedTokenRatio < 0 || profile.maximumDuplicatedTokenRatio > 1) throw new Error("Invalid duplicated-token ratio");
}

export function tokenize(text: string): readonly string[] {
  return text.normalize("NFC").match(/[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) ?? [];
}

interface RawSpan { node: DocumentNode; startOffset: number; endOffset: number }

export function chunkDocument(nodes: readonly DocumentNode[], profile: ChunkProfile): ChunkingResult {
  validateProfile(profile);
  const ordered = orderDocumentNodes(nodes);
  const boilerplate = findBoilerplate(ordered, profile.boilerplateOccurrences);
  const seenContent = new Set<string>();
  const omittedNodeIds = ordered.filter((node) => {
    const key = normalizedDuplicateKey(node.text);
    const omit = boilerplate.has(key) || node.role === "boilerplate" || seenContent.has(key);
    seenContent.add(key);
    return omit;
  }).map(({ id }) => id);
  const admitted = ordered.filter((node) => !omittedNodeIds.includes(node.id) && node.text.trim().length > 0);
  const selected = selectForStrategy(admitted, profile.strategy);
  const rawGroups = buildGroups(selected, profile);
  const chunks = rawGroups.map((spans, ordinal) => materializeChunk(spans, ordinal, profile, ordered));
  const qa = validateChunks(chunks, nodes, profile);
  const inputDigest = sha256Digest(nodes.map(({ id, digest }) => ({ id, digest })));
  const outputDigest = sha256Digest(JSON.stringify(chunks.map(({ id, sourceTextDigest, embeddingTextDigest, spans }) => ({ id, sourceTextDigest, embeddingTextDigest, spans }))));
  return deepFreeze({ profile, inputDigest, outputDigest, chunks, omittedNodeIds, qa });
}

function orderDocumentNodes(nodes: readonly DocumentNode[]): DocumentNode[] {
  const children = new Map<string | undefined, DocumentNode[]>();
  for (const node of nodes) {
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node);
    children.set(node.parentId, siblings);
  }
  for (const siblings of children.values()) siblings.sort((a, b) => a.ordinal - b.ordinal || a.id.localeCompare(b.id));
  const ordered: DocumentNode[] = [];
  const visit = (node: DocumentNode): void => {
    ordered.push(node);
    for (const child of children.get(node.id) ?? []) visit(child);
  };
  for (const root of children.get(undefined) ?? []) visit(root);
  if (ordered.length !== nodes.length) throw new Error("Document nodes contain an orphan or structural cycle");
  return ordered;
}

function selectForStrategy(nodes: readonly DocumentNode[], strategy: ChunkStrategy): readonly DocumentNode[] {
  const kinds: Partial<Record<ChunkStrategy, readonly DocumentNode["kind"][]>> = {
    transcripts: ["transcript_segment"], code: ["code_block"], tables: ["table"],
  };
  const allowed = kinds[strategy];
  if (allowed === undefined) return nodes;
  const selected = nodes.filter(({ kind }) => allowed.includes(kind));
  return selected.length === 0 ? nodes : selected;
}

function buildGroups(nodes: readonly DocumentNode[], profile: ChunkProfile): readonly (readonly RawSpan[])[] {
  if (profile.strategy === "claims") return nodes.flatMap(splitClaims).map((span) => [span]);
  const groups: RawSpan[][] = [];
  let current: RawSpan[] = [];
  let tokens = 0;
  for (const node of nodes) {
    const parts = splitNode(node, profile.maximumTokens);
    for (const part of parts) {
      const partTokens = tokenize(part.node.text.slice(part.startOffset, part.endOffset)).length;
      const structuralBoundary = node.kind === "heading" && current.length > 0;
      if (current.length > 0 && (structuralBoundary || tokens + partTokens > profile.targetTokens)) {
        groups.push(current); current = []; tokens = 0;
      }
      current.push(part); tokens += partTokens;
      if (tokens >= profile.targetTokens) { groups.push(current); current = []; tokens = 0; }
    }
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

function splitClaims(node: DocumentNode): readonly RawSpan[] {
  const spans: RawSpan[] = [];
  const expression = /[^.!?\n]+(?:[.!?]+|\n|$)/g;
  for (const match of node.text.matchAll(expression)) {
    const raw = match[0]; const leading = raw.length - raw.trimStart().length;
    const text = raw.trim(); if (text.length === 0) continue;
    const startOffset = (match.index ?? 0) + leading;
    spans.push({ node, startOffset, endOffset: startOffset + text.length });
  }
  return spans;
}

function splitNode(node: DocumentNode, maximumTokens: number): readonly RawSpan[] {
  const matches = [...node.text.matchAll(/[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu)];
  if (matches.length <= maximumTokens) return [{ node, startOffset: 0, endOffset: node.text.length }];
  const spans: RawSpan[] = [];
  for (let cursor = 0; cursor < matches.length; cursor += maximumTokens) {
    const slice = matches.slice(cursor, cursor + maximumTokens);
    const first = slice[0]!; const last = slice.at(-1)!;
    spans.push({ node, startOffset: first.index, endOffset: last.index + last[0].length });
  }
  return spans;
}

function materializeChunk(spans: readonly RawSpan[], ordinal: number, profile: ChunkProfile, allNodes: readonly DocumentNode[]): PreparedChunk {
  const sourceText = spans.map(({ node, startOffset, endOffset }) => node.text.slice(startOffset, endOffset)).join("\n\n");
  const heading = profile.contextualHeadingPrefix ? nearestHeading(spans[0]!.node, allNodes) : undefined;
  const contextualPrefix = heading === undefined ? "" : `${heading.text}\n\n`;
  const embeddingText = `${contextualPrefix}${sourceText}`;
  const preparedSpans = spans.map(({ node, startOffset, endOffset }) => ({
    nodeId: node.id, startOffset, endOffset,
    locator: { ...node.locator, startOffset, endOffset },
  }));
  const identity = sha256Digest(JSON.stringify({ profile: `${profile.name}@${profile.version}`, spans: preparedSpans, sourceText: sha256Digest(sourceText), projection: sha256Digest(embeddingText) }));
  return deepFreeze({
    id: deterministicUuid(identity), ordinal, role: spans[0]!.node.role ?? profile.strategy,
    sourceText, contextualPrefix, embeddingText,
    sourceTextDigest: sha256Digest(sourceText), embeddingTextDigest: sha256Digest(embeddingText),
    sourceTokenCount: tokenize(sourceText).length, embeddingTokenCount: tokenize(embeddingText).length,
    spans: preparedSpans,
  });
}

function nearestHeading(node: DocumentNode, allNodes: readonly DocumentNode[]): DocumentNode | undefined {
  let cursor: DocumentNode | undefined = node;
  const byId = new Map(allNodes.map((candidate) => [candidate.id, candidate]));
  while (cursor !== undefined) {
    if (cursor.kind === "heading") return cursor;
    cursor = cursor.parentId === undefined ? undefined : byId.get(cursor.parentId);
  }
  return undefined;
}

function normalizedDuplicateKey(text: string): string { return text.replace(/\s+/g, " ").trim().toLocaleLowerCase(); }
function findBoilerplate(nodes: readonly DocumentNode[], threshold: number): ReadonlySet<string> {
  const counts = new Map<string, number>();
  for (const { text } of nodes) {
    const key = normalizedDuplicateKey(text);
    if (key.length > 0) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Set([...counts].filter(([key, count]) => key.length < 240 && count >= threshold).map(([key]) => key));
}

export function reconstructChunk(chunk: PreparedChunk, nodes: readonly DocumentNode[]): string {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return chunk.spans.map((span) => {
    const node = byId.get(span.nodeId);
    if (node === undefined) throw new Error(`Missing span node ${span.nodeId}`);
    if (span.endOffset > node.text.length || span.endOffset <= span.startOffset) throw new Error(`Invalid span for ${span.nodeId}`);
    return node.text.slice(span.startOffset, span.endOffset);
  }).join("\n\n");
}

export function validateChunks(chunks: readonly PreparedChunk[], nodes: readonly DocumentNode[], profile: ChunkProfile): ChunkQaResult {
  const issues: string[] = []; let reconstructedChunkCount = 0;
  for (const chunk of chunks) {
    if (chunk.sourceTokenCount > profile.maximumTokens) issues.push(`${chunk.id}: exceeds maximum source tokens`);
    if (chunk.sourceTokenCount < profile.minimumTokens) issues.push(`${chunk.id}: below minimum source tokens`);
    try {
      if (reconstructChunk(chunk, nodes) !== chunk.sourceText) issues.push(`${chunk.id}: reconstruction mismatch`);
      else reconstructedChunkCount += 1;
    } catch (error) { issues.push(`${chunk.id}: ${error instanceof Error ? error.message : "span failure"}`); }
  }
  const duplicateTokenRatio = adjacentDuplicateRatio(chunks);
  if (duplicateTokenRatio > profile.maximumDuplicatedTokenRatio) issues.push(`duplicated token ratio ${duplicateTokenRatio.toFixed(3)} exceeds limit`);
  return deepFreeze({ valid: issues.length === 0, issues, duplicateTokenRatio, reconstructedChunkCount });
}

function adjacentDuplicateRatio(chunks: readonly PreparedChunk[]): number {
  let duplicated = 0; let total = 0;
  for (let index = 1; index < chunks.length; index += 1) {
    const current = chunks[index]!; const previous = chunks[index - 1]!;
    total += current.sourceTokenCount;
    for (const span of current.spans) {
      for (const prior of previous.spans) {
        if (span.nodeId !== prior.nodeId) continue;
        const overlapStart = Math.max(span.startOffset, prior.startOffset);
        const overlapEnd = Math.min(span.endOffset, prior.endOffset);
        if (overlapEnd > overlapStart) {
          const spanLength = span.endOffset - span.startOffset;
          duplicated += Math.ceil(((overlapEnd - overlapStart) / spanLength) * current.sourceTokenCount);
        }
      }
    }
  }
  return total === 0 ? 0 : duplicated / total;
}
