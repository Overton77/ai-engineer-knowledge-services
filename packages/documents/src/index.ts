import { createHash } from "node:crypto";
import {
  DocumentNodeSchema,
  SourceLocatorSchema,
  type DocumentNode,
  type SourceLocator,
} from "@aiengineer/knowledge-contracts";
import { deepFreeze, sha256Digest } from "@aiengineer/knowledge-domain";

export interface StructuralBlock {
  readonly localKey: string;
  readonly parentKey?: string;
  readonly ordinal: number;
  readonly kind: DocumentNode["kind"];
  readonly text: string;
  readonly role?: string;
  readonly language?: string;
  readonly locator?: Omit<SourceLocator, "representationId" | "nodeId" | "quoteDigest">;
}

export interface StructuralDocumentInput {
  readonly tenantId: string;
  readonly representationId: string;
  readonly createdAt: string;
  readonly blocks: readonly StructuralBlock[];
}

export interface StructuralDocument {
  readonly representationId: string;
  readonly digest: `sha256:${string}`;
  readonly nodes: readonly Readonly<DocumentNode>[];
}

export function deterministicUuid(value: string): string {
  const bytes = createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function normalizeDocumentText(text: string, kind: DocumentNode["kind"]): string {
  const lineNormalized = text.replace(/\r\n?/g, "\n").normalize("NFC");
  if (kind === "code_block" || kind === "table") return lineNormalized.trimEnd();
  return lineNormalized.replace(/[\t ]+/g, " ").replace(/ *\n */g, "\n").trim();
}

export function createSourceLocator(
  representationId: string,
  nodeId: string,
  text: string,
  locator: StructuralBlock["locator"] = {},
): SourceLocator {
  return SourceLocatorSchema.parse({
    ...locator,
    representationId,
    nodeId,
    quoteDigest: sha256Digest(text),
  });
}

function locatorDigestValue(locator: StructuralBlock["locator"]): Record<string, string | number | string[]> {
  if (locator === undefined) return {};
  return {
    ...(locator.page === undefined ? {} : { page: locator.page }),
    ...(locator.sectionPath === undefined ? {} : { sectionPath: [...locator.sectionPath] }),
    ...(locator.startOffset === undefined ? {} : { startOffset: locator.startOffset }),
    ...(locator.endOffset === undefined ? {} : { endOffset: locator.endOffset }),
    ...(locator.startTimeMs === undefined ? {} : { startTimeMs: locator.startTimeMs }),
    ...(locator.endTimeMs === undefined ? {} : { endTimeMs: locator.endTimeMs }),
    ...(locator.domPath === undefined ? {} : { domPath: locator.domPath }),
    ...(locator.symbol === undefined ? {} : { symbol: locator.symbol }),
  };
}

export function convertStructuralDocument(input: StructuralDocumentInput): StructuralDocument {
  if (new Set(input.blocks.map(({ localKey }) => localKey)).size !== input.blocks.length) {
    throw new Error("Structural block localKey values must be unique");
  }
  const knownKeys = new Set(input.blocks.map(({ localKey }) => localKey));
  for (const block of input.blocks) {
    if (block.parentKey !== undefined && !knownKeys.has(block.parentKey)) {
      throw new Error(`Unknown parentKey: ${block.parentKey}`);
    }
    if (block.parentKey === block.localKey) throw new Error(`Block ${block.localKey} cannot parent itself`);
  }

  const idByKey = new Map(input.blocks.map(({ localKey }) => [
    localKey,
    deterministicUuid(`${input.representationId}:node:${localKey}`),
  ]));
  assertAcyclic(input.blocks);
  const nodes = input.blocks.map((block) => {
    const text = normalizeDocumentText(block.text, block.kind);
    const id = idByKey.get(block.localKey)!;
    const value = {
      id,
      tenantId: input.tenantId,
      digest: sha256Digest({
        representationId: input.representationId,
        localKey: block.localKey,
        parentKey: block.parentKey ?? null,
        ordinal: block.ordinal,
        kind: block.kind,
        role: block.role ?? null,
        language: block.language ?? null,
        text,
        locator: locatorDigestValue(block.locator),
      }),
      schemaVersion: "v1" as const,
      createdAt: input.createdAt,
      representationId: input.representationId,
      ...(block.parentKey === undefined ? {} : { parentId: idByKey.get(block.parentKey)! }),
      ordinal: block.ordinal,
      kind: block.kind,
      ...(block.role === undefined ? {} : { role: block.role }),
      text,
      locator: createSourceLocator(input.representationId, id, text, block.locator),
      ...(block.language === undefined ? {} : { language: block.language }),
    };
    return deepFreeze(DocumentNodeSchema.parse(value));
  });

  const siblingOrdinals = new Set<string>();
  for (const node of nodes) {
    const key = `${node.parentId ?? "root"}:${node.ordinal}`;
    if (siblingOrdinals.has(key)) throw new Error(`Duplicate sibling ordinal: ${key}`);
    siblingOrdinals.add(key);
  }
  const digest = sha256Digest(nodes.map(({ id, digest }) => ({ id, digest })));
  return deepFreeze({ representationId: input.representationId, digest, nodes });
}

function assertAcyclic(blocks: readonly StructuralBlock[]): void {
  const parentByKey = new Map(blocks.map(({ localKey, parentKey }) => [localKey, parentKey]));
  for (const block of blocks) {
    const seen = new Set<string>();
    let cursor: string | undefined = block.localKey;
    while (cursor !== undefined) {
      if (seen.has(cursor)) throw new Error(`Structural parent cycle at ${cursor}`);
      seen.add(cursor);
      cursor = parentByKey.get(cursor);
    }
  }
}

export function reconstructNodeSpan(node: DocumentNode, startOffset = 0, endOffset = node.text.length): string {
  if (startOffset < 0 || endOffset <= startOffset || endOffset > node.text.length) {
    throw new RangeError(`Invalid node span ${startOffset}:${endOffset} for ${node.id}`);
  }
  return node.text.slice(startOffset, endOffset);
}

export function verifyNodeLocators(nodes: readonly DocumentNode[]): readonly string[] {
  const issues: string[] = [];
  for (const node of nodes) {
    if (node.locator.representationId !== node.representationId) issues.push(`${node.id}: representation mismatch`);
    if (node.locator.nodeId !== node.id) issues.push(`${node.id}: node mismatch`);
    if (node.locator.quoteDigest !== sha256Digest(node.text)) issues.push(`${node.id}: quote digest mismatch`);
    const end = node.locator.endOffset;
    if (end !== undefined && end > node.text.length) issues.push(`${node.id}: offset exceeds text`);
  }
  return deepFreeze(issues);
}
