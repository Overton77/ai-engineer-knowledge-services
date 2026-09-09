import type { ResolvedSelector, VerificationSelector } from "@aiengineer/knowledge-contracts";
import { canonicalizeJson, digestCanonicalJson, sha256Digest } from "../deterministic/canonical.js";
import type { DeterministicSelectorResolver, SelectorResolutionRequest, TrustedSelectorResolution } from "../deterministic/selectors.js";
import { parseCanonicalProjection, type CanonicalProjection, type DomNode } from "./projections.js";

const utf8 = new TextEncoder();
const decode = (bytes: Uint8Array): string => new TextDecoder("utf-8", { fatal: true }).decode(bytes);
type Status = "not_found" | "ambiguous" | "invalid" | "parse_error";
type Range = { readonly start: number; readonly end: number; readonly coordinateSpace: string };

function base(request: SelectorResolutionRequest, status: ResolvedSelector["status"], occurrenceCount: number, ranges: readonly Range[], normalization: ResolvedSelector["normalization"], selectedContent?: Uint8Array, selectedValue?: unknown): ResolvedSelector {
  return {
    captureId: request.captureId,
    representationArtifactId: request.representationArtifactId,
    representationDigest: request.representationDigest as `sha256:${string}`,
    selectorDigest: digestCanonicalJson(request.selector),
    selectorKind: request.selector.kind,
    status,
    occurrenceCount,
    ...(selectedContent === undefined ? {} : { selectedContentDigest: sha256Digest(selectedContent) }),
    ...(selectedValue === undefined ? {} : { selectedValue: selectedValue as never }),
    resolvedRanges: [...ranges],
    normalization,
    resolverVersion: "verification-projections.v1",
  };
}
function unresolved(request: SelectorResolutionRequest, status: Status, occurrenceCount = 0): TrustedSelectorResolution { return { resolution: base(request, status, occurrenceCount, [], "none"), selectedContent: new Uint8Array() }; }
function resolved(request: SelectorResolutionRequest, value: unknown, ranges: readonly Range[], normalization: ResolvedSelector["normalization"] = "none"): TrustedSelectorResolution {
  const content = utf8.encode(canonicalizeJson(value));
  return { resolution: base(request, "resolved", 1, ranges, normalization, content, value), selectedContent: content };
}
function resolvedText(request: SelectorResolutionRequest, text: string, ranges: readonly Range[], normalization: ResolvedSelector["normalization"] = "none"): TrustedSelectorResolution {
  const content = utf8.encode(text);
  return { resolution: base(request, "resolved", 1, ranges, normalization, content), selectedContent: content };
}

function requireProjection(request: SelectorResolutionRequest): CanonicalProjection | TrustedSelectorResolution {
  if (!/^sha256:[a-f0-9]{64}$/.test(request.representationDigest) || sha256Digest(request.content) !== request.representationDigest) return unresolved(request, "invalid");
  try { return parseCanonicalProjection(request.content); } catch { return unresolved(request, "parse_error"); }
}
const isResolution = (value: CanonicalProjection | TrustedSelectorResolution): value is TrustedSelectorResolution => "resolution" in value;
const selectorPointer = (pointer: string, value: unknown): { found: true; value: unknown } | { found: false } => {
  if (!/^(?:\/(?:[^~/]|~[01])*)*$/.test(pointer)) return { found: false };
  let current = value;
  if (pointer === "") return { found: true, value: current };
  for (const token of pointer.slice(1).split("/").map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))) {
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9]\d*)$/.test(token) || Number(token) >= current.length) return { found: false };
      current = current[Number(token)];
    } else if (current !== null && typeof current === "object" && Object.prototype.hasOwnProperty.call(current, token)) current = (current as Record<string, unknown>)[token];
    else return { found: false };
  }
  return { found: true, value: current };
};

const visibleNode = (node: DomNode): boolean => !node.hidden && node.tag !== "script" && node.tag !== "style";
function domText(node: DomNode): string { return !visibleNode(node) ? "" : node.tag === "#text" ? node.text ?? "" : node.text ?? (node.children ?? []).map(domText).join(""); }
function domAtPath(root: DomNode, path: string): DomNode | undefined {
  if (!/^\d+(?:\/\d+)*$/.test(path)) return undefined;
  if (!visibleNode(root)) return undefined;
  let current: DomNode | undefined = root;
  for (const rawIndex of path.split("/")) { current = current?.children?.[Number(rawIndex)]; if (!current || !visibleNode(current)) return undefined; }
  return current;
}
function walk(root: DomNode): DomNode[] { return !visibleNode(root) ? [] : [root, ...(root.children ?? []).flatMap(walk)]; }
function cssMatches(root: DomNode, css: string): DomNode[] {
  const id = /^#([A-Za-z][A-Za-z0-9_-]*)$/.exec(css);
  const tag = /^[A-Za-z][A-Za-z0-9-]*$/.exec(css);
  const attribute = /^([A-Za-z][A-Za-z0-9-]*)?\[([A-Za-z_:][-A-Za-z0-9_:.]*)="([^"]+)"\]$/.exec(css);
  if (!id && !tag && !attribute) return [];
  return walk(root).filter((node) => node.tag !== "#text" && (id ? node.id === id[1] : tag ? node.tag === tag[0].toLowerCase() : (attribute![1] === undefined || node.tag === attribute![1]!.toLowerCase()) && node.attributes?.[attribute![2]!] === attribute![3]));
}
function xpathMatches(root: DomNode, xpath: string): DomNode[] {
  const match = /^\/\/([A-Za-z][A-Za-z0-9-]*)(?:\[@(id|[A-Za-z_:][-A-Za-z0-9_:.]*)='([^']+)'\])?$/.exec(xpath);
  if (!match) return [];
  return walk(root).filter((node) => node.tag !== "#text" && node.tag === match[1]!.toLowerCase() && (match[2] === undefined || (match[2] === "id" ? node.id : node.attributes?.[match[2]!]) === match[3]));
}
function resolveHtml(request: SelectorResolutionRequest, projection: Extract<CanonicalProjection, { kind: "html_dom" }>, selector: Extract<VerificationSelector, { kind: "html" }>): TrustedSelectorResolution {
  if ((selector.css?.length ?? 0) > 256 || (selector.xpath?.length ?? 0) > 256 || (selector.domPath?.length ?? 0) > 256 || (selector.canonicalTextFallback?.quote.length ?? 0) > 100_000) return unresolved(request, "invalid");
  const candidates: DomNode[][] = [];
  if (selector.css !== undefined) { const values = cssMatches(projection.document, selector.css); if (values.length !== 1) return unresolved(request, values.length > 1 ? "ambiguous" : "invalid", values.length); candidates.push(values); }
  if (selector.xpath !== undefined) { const values = xpathMatches(projection.document, selector.xpath); if (values.length !== 1) return unresolved(request, values.length > 1 ? "ambiguous" : "invalid", values.length); candidates.push(values); }
  if (selector.domPath !== undefined) { const node = domAtPath(projection.document, selector.domPath); if (!node) return unresolved(request, "invalid"); candidates.push([node]); }
  if (candidates.length === 0 || candidates.some((candidate) => candidate[0] !== candidates[0]![0])) return unresolved(request, "invalid");
  const selected = domText(candidates[0]![0]!);
  if (selected.length === 0) return unresolved(request, "not_found");
  if (selector.canonicalTextFallback !== undefined) {
    const fallback = selector.canonicalTextFallback;
    if (fallback.normalization === "casefold_whitespace_filler_removed" || projection.canonicalText === undefined) return unresolved(request, "invalid");
    const normalize = (text: string) => fallback.normalization === "none" ? text : fallback.normalization === "lf" ? text.replace(/\r\n?/gu, "\n") : text.replace(/\s+/gu, " ").trim();
    const text = normalize(projection.canonicalText);
    const quote = normalize(fallback.quote);
    const selectedText = normalize(selected);
    if (quote.length === 0) return unresolved(request, "invalid");
    const matches: number[] = [];
    for (let at = text.indexOf(quote); at >= 0; at = text.indexOf(quote, at + 1)) matches.push(at);
    const filtered = matches.filter((at) => (fallback.prefix === undefined || text.slice(Math.max(0, at - normalize(fallback.prefix).length), at) === normalize(fallback.prefix)) && (fallback.suffix === undefined || text.slice(at + quote.length, at + quote.length + normalize(fallback.suffix).length) === normalize(fallback.suffix)));
    if (filtered.length !== 1 || selectedText !== quote) return unresolved(request, filtered.length > 1 ? "ambiguous" : "invalid", filtered.length);
  }
  // A range refines the already unique DOM selection. It never locates a node,
  // substitutes for fallback agreement, normalizes text, or splits a code point.
  if (selector.textRange !== undefined) {
    const range = offsetRange(selected, selector.textRange.start, selector.textRange.end, "utf16_code_units");
    if (!range) return unresolved(request, "invalid");
    return resolvedText(request, selected.slice(range.start, range.end), [{ ...range, coordinateSpace: "html_dom_text_utf16" }]);
  }
  return resolvedText(request, selected, [{ start: 0, end: selected.length, coordinateSpace: "html_dom_text_utf16" }]);
}

function offsetRange(text: string, start: number, end: number, basis: "utf8_bytes" | "utf16_code_units" | "unicode_code_points"): { start: number; end: number } | undefined {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start) return undefined;
  if (basis === "utf16_code_units") {
    if (end > text.length || (start > 0 && /[\uDC00-\uDFFF]/u.test(text[start]!)) || (end > 0 && /[\uD800-\uDBFF]/u.test(text[end - 1]!))) return undefined;
    return { start, end };
  }
  if (basis === "unicode_code_points") { const points = [...text]; return end <= points.length ? { start: points.slice(0, start).join("").length, end: points.slice(0, end).join("").length } : undefined; }
  const bytes = utf8.encode(text);
  if (end > bytes.length) return undefined;
  try { const prefix = decode(bytes.slice(0, start)); const selection = decode(bytes.slice(start, end)); return { start: prefix.length, end: prefix.length + selection.length }; } catch { return undefined; }
}
function resolvePdf(request: SelectorResolutionRequest, projection: Extract<CanonicalProjection, { kind: "pdf_text" }>, selector: Extract<VerificationSelector, { kind: "pdf_text" }>): TrustedSelectorResolution {
  const page = projection.pages.find((item) => item.physicalPageNumber === selector.page);
  if (!page) return unresolved(request, "not_found");
  if (page.textLayerDigest !== selector.textLayerDigest || sha256Digest(page.text) !== page.textLayerDigest) return unresolved(request, "invalid");
  const range = offsetRange(page.text, selector.start, selector.end, selector.offsetBasis);
  if (!range) return unresolved(request, "invalid");
  return resolvedText(request, page.text.slice(range.start, range.end), [{ start: selector.start, end: selector.end, coordinateSpace: `pdf_physical_page_${selector.page}:${selector.offsetBasis}` }]);
}

function resolveGeometry(request: SelectorResolutionRequest, projection: Extract<CanonicalProjection, { kind: "geometry" }>, selector: Extract<VerificationSelector, { kind: "bounding_box" }>): TrustedSelectorResolution {
  const pages = selector.page === undefined ? projection.pages : projection.pages.filter((page) => page.physicalPageNumber === selector.page);
  if (pages.length !== 1) return unresolved(request, pages.length > 1 ? "ambiguous" : "not_found", pages.length);
  const page = pages[0]!;
  if (selector.coordinateSpace === "pixels" && (page.imageWidth !== selector.imageWidth || page.imageHeight !== selector.imageHeight)) return unresolved(request, "invalid");
  const box = selector.coordinateSpace === "normalized" ? { x: selector.x, y: selector.y, width: selector.width, height: selector.height } : { x: selector.x / selector.imageWidth!, y: selector.y / selector.imageHeight!, width: selector.width / selector.imageWidth!, height: selector.height / selector.imageHeight! };
  const normalize = (token: (typeof page.tokens)[number]) => token.coordinateSpace === "normalized" ? token : token.coordinateSpace === "pixels"
    ? { ...token, x: token.x / page.imageWidth!, y: token.y / page.imageHeight!, width: token.width / page.imageWidth!, height: token.height / page.imageHeight! }
    : { ...token, x: token.x / page.widthPoints!, y: token.y / page.heightPoints!, width: token.width / page.widthPoints!, height: token.height / page.heightPoints! };
  const tokens = page.tokens.map(normalize).filter((token) => token.x >= box.x && token.y >= box.y && token.x + token.width <= box.x + box.width && token.y + token.height <= box.y + box.height).sort((a, b) => a.order - b.order);
  if (tokens.length === 0) return unresolved(request, "not_found");
  const value = { intersectionPolicy: "contained" as const, box, tokens: tokens.map(({ text, x, y, width, height, order }) => ({ text, x, y, width, height, order })) };
  return resolved(request, value, tokens.map((token) => ({ start: token.order, end: token.order + 1, coordinateSpace: "normalized_geometry_token_order" })));
}

function resolveTable(request: SelectorResolutionRequest, projection: Extract<CanonicalProjection, { kind: "table" }>, selector: Extract<VerificationSelector, { kind: "table" }>): TrustedSelectorResolution {
  const tables = projection.tables.filter((table) => table.tableId === selector.tableId);
  if (tables.length !== 1) return unresolved(request, tables.length > 1 ? "ambiguous" : "not_found", tables.length);
  const cells = tables[0]!.cells.filter((cell) => cell.row === selector.row && cell.column === selector.column);
  if (cells.length !== 1) return unresolved(request, cells.length > 1 ? "ambiguous" : "not_found", cells.length);
  const cell = cells[0]!;
  if (canonicalizeJson(cell.headerPath) !== canonicalizeJson(selector.headerPath) || (selector.expectedCellValue !== undefined && selector.expectedCellValue !== cell.value)) return unresolved(request, "invalid");
  return resolved(request, cell, [{ start: selector.row, end: selector.row + 1, coordinateSpace: `table:${selector.tableId}:row` }, { start: selector.column, end: selector.column + 1, coordinateSpace: `table:${selector.tableId}:column` }]);
}

function resolveMedia(request: SelectorResolutionRequest, projection: Extract<CanonicalProjection, { kind: "transcript" }>, selector: Extract<VerificationSelector, { kind: "media_timecode" }>): TrustedSelectorResolution {
  if (selector.endMs > projection.durationMs) return unresolved(request, "invalid");
  const segments = projection.segments.filter((segment) => segment.startMs >= selector.startMs && segment.endMs <= selector.endMs && (selector.speaker === undefined || segment.speaker === selector.speaker) && (selector.channel === undefined || segment.channel === selector.channel));
  if (segments.length === 0) return unresolved(request, "not_found");
  if (selector.speaker === undefined && new Set(segments.map((segment) => segment.speaker ?? "")).size > 1) return unresolved(request, "ambiguous", segments.length);
  if (selector.channel === undefined && new Set(segments.map((segment) => segment.channel ?? "")).size > 1) return unresolved(request, "ambiguous", segments.length);
  const value = { interval: { startMs: selector.startMs, endMs: selector.endMs, convention: "half_open" as const }, segments };
  return resolved(request, value, segments.map((segment) => ({ start: segment.startMs, end: segment.endMs, coordinateSpace: "media_ms_half_open" })));
}

function resolveRepository(request: SelectorResolutionRequest, projection: Extract<CanonicalProjection, { kind: "repository" }>, selector: Extract<VerificationSelector, { kind: "repository" }>): TrustedSelectorResolution {
  if (projection.commit !== selector.commit || !/^(?!\/)(?!.*\\)(?!.*\0)(?!.*(?:^|\/)\.?(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(selector.path) || selector.path.split("/").some((part) => part === "." || part === "..")) return unresolved(request, "invalid");
  const files = projection.files.filter((file) => file.path === selector.path);
  if (files.length !== 1) return unresolved(request, files.length > 1 ? "ambiguous" : "not_found", files.length);
  const content = files[0]!.content;
  if (selector.rangeKind === "bytes") {
    const range = offsetRange(content, selector.start, selector.end, "utf8_bytes");
    if (!range) return unresolved(request, "invalid");
    return resolvedText(request, content.slice(range.start, range.end), [{ start: selector.start, end: selector.end, coordinateSpace: "repository_utf8_bytes" }]);
  }
  const lines = content.split("\n");
  if (!Number.isSafeInteger(selector.start) || !Number.isSafeInteger(selector.end) || selector.start < 0 || selector.end <= selector.start || selector.end > lines.length) return unresolved(request, "invalid");
  return resolvedText(request, lines.slice(selector.start, selector.end).join("\n"), [{ start: selector.start, end: selector.end, coordinateSpace: "repository_lines_zero_based_half_open" }]);
}

function resolveDataset(request: SelectorResolutionRequest, projection: Extract<CanonicalProjection, { kind: "dataset" }>, selector: Extract<VerificationSelector, { kind: "dataset" }>): TrustedSelectorResolution {
  if (projection.datasetVersionId !== selector.datasetVersionId) return unresolved(request, "invalid");
  const matches = projection.rows.filter((row) => row.key === selector.rowKey);
  if (matches.length !== 1) return unresolved(request, matches.length > 1 ? "ambiguous" : "not_found", matches.length);
  const row = matches[0]!;
  if (selector.column === undefined) return resolved(request, row, [{ start: 0, end: 1, coordinateSpace: `dataset:${selector.datasetVersionId}:key:${selector.rowKey}` }]);
  if (row.value === null || typeof row.value !== "object" || Array.isArray(row.value) || !Object.prototype.hasOwnProperty.call(row.value, selector.column)) return unresolved(request, "not_found");
  return resolved(request, (row.value as Record<string, unknown>)[selector.column], [{ start: 0, end: 1, coordinateSpace: `dataset:${selector.datasetVersionId}:key:${selector.rowKey}:column:${selector.column}` }]);
}

function resolveApi(request: SelectorResolutionRequest, projection: Extract<CanonicalProjection, { kind: "paginated_api" }>, selector: Extract<VerificationSelector, { kind: "api_record" }>): TrustedSelectorResolution {
  const pages = selector.pageKey === undefined ? projection.pages : projection.pages.filter((page) => page.pageKey === selector.pageKey);
  if (pages.length === 0) return unresolved(request, "not_found");
  const matches = pages.flatMap((page) => page.records.filter((record) => record.recordKey === selector.recordKey).map((record) => ({ pageKey: page.pageKey, record })));
  if (matches.length !== 1) return unresolved(request, matches.length > 1 ? "ambiguous" : "not_found", matches.length);
  const match = matches[0]!;
  if (selector.fieldPointer === undefined) return resolved(request, match.record, [{ start: 0, end: 1, coordinateSpace: `api:${projection.apiVersion}:page:${match.pageKey}:record:${selector.recordKey}` }]);
  const pointed = selectorPointer(selector.fieldPointer, match.record.value);
  if (!pointed.found) return unresolved(request, "not_found");
  return resolved(request, pointed.value, [{ start: 0, end: 1, coordinateSpace: `api:${projection.apiVersion}:page:${match.pageKey}:record:${selector.recordKey}:pointer:${selector.fieldPointer}` }]);
}

export class ProjectionSelectorResolver implements DeterministicSelectorResolver {
  readonly resolverVersion = "verification-projections.v1";
  readonly supportedKinds = ["html", "pdf_text", "bounding_box", "table", "media_timecode", "repository", "dataset", "api_record"] as const;

  resolve(request: SelectorResolutionRequest): TrustedSelectorResolution {
    const projection = requireProjection(request);
    if (isResolution(projection)) return projection;
    switch (request.selector.kind) {
      case "html": return projection.kind === "html_dom" ? resolveHtml(request, projection, request.selector) : unresolved(request, "invalid");
      case "pdf_text": return projection.kind === "pdf_text" ? resolvePdf(request, projection, request.selector) : unresolved(request, "invalid");
      case "bounding_box": return projection.kind === "geometry" ? resolveGeometry(request, projection, request.selector) : unresolved(request, "invalid");
      case "table": return projection.kind === "table" ? resolveTable(request, projection, request.selector) : unresolved(request, "invalid");
      case "media_timecode": return projection.kind === "transcript" ? resolveMedia(request, projection, request.selector) : unresolved(request, "invalid");
      case "repository": return projection.kind === "repository" ? resolveRepository(request, projection, request.selector) : unresolved(request, "invalid");
      case "dataset": return projection.kind === "dataset" ? resolveDataset(request, projection, request.selector) : unresolved(request, "invalid");
      case "api_record": return projection.kind === "paginated_api" ? resolveApi(request, projection, request.selector) : unresolved(request, "invalid");
      default: return unresolved(request, "invalid");
    }
  }
}

export const projectionSelectorResolver = new ProjectionSelectorResolver();
