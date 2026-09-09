import { canonicalizeJson } from "../deterministic/canonical.js";

/**
 * Selector-only projection input. Admission, raw parsing, sandboxing, and
 * parent-artifact registration are deliberately outside this module. The
 * application layer must establish those facts before calling a resolver.
 */
export interface ProjectionAdmissionContext {
  readonly parentArtifactDigest: `sha256:${string}`;
  readonly transformationSignature: `sha256:${string}`;
  readonly parserVersion: string;
}

export type CanonicalProjection = HtmlDomProjection | PdfTextProjection | GeometryProjection | TableProjection | TranscriptProjection | RepositoryProjection | DatasetProjection | PaginatedApiProjection;

export interface DomNode {
  readonly tag: string;
  readonly id?: string;
  readonly attributes?: Readonly<Record<string, string>>;
  readonly text?: string;
  readonly hidden?: boolean;
  readonly children?: readonly DomNode[];
}
export interface HtmlDomProjection { readonly kind: "html_dom"; readonly document: DomNode; readonly canonicalText?: string }
export interface PdfTextProjection {
  readonly kind: "pdf_text";
  readonly pageCount: number;
  readonly pages: readonly { readonly physicalPageNumber: number; readonly text: string; readonly textLayerDigest: `sha256:${string}`; readonly widthPoints: number; readonly heightPoints: number }[];
  /** Residuals are preserved rather than invented from native text. */
  readonly residuals?: readonly { readonly kind: "unresolved_visual_content"; readonly physicalPageNumber: number; readonly detail: string }[];
}
export interface GeometryProjection {
  readonly kind: "geometry";
  readonly pages: readonly {
    readonly physicalPageNumber?: number;
    readonly widthPoints?: number;
    readonly heightPoints?: number;
    readonly imageWidth?: number;
    readonly imageHeight?: number;
    readonly tokens: readonly { readonly text: string; readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly coordinateSpace: "normalized" | "pixels" | "pdf_points"; readonly order: number }[];
  }[];
}
export interface TableProjection { readonly kind: "table"; readonly tables: readonly { readonly tableId: string; readonly cells: readonly { readonly row: number; readonly column: number; readonly value: string; readonly headerPath: readonly string[]; readonly rowSpan?: number; readonly columnSpan?: number }[] }[] }
export interface TranscriptProjection { readonly kind: "transcript"; readonly durationMs: number; readonly segments: readonly { readonly segmentId: string; readonly startMs: number; readonly endMs: number; readonly text: string; readonly speaker?: string; readonly channel?: string }[] }
export interface RepositoryProjection { readonly kind: "repository"; readonly commit: string; readonly lineRangeConvention: "zero_based_half_open"; readonly files: readonly { readonly path: string; readonly content: string }[] }
export interface DatasetProjection { readonly kind: "dataset"; readonly datasetVersionId: string; readonly rows: readonly { readonly key: string; readonly value: unknown }[] }
export interface PaginatedApiProjection { readonly kind: "paginated_api"; readonly apiVersion: string; readonly queryDigest: `sha256:${string}`; readonly pages: readonly { readonly pageKey: string; readonly records: readonly { readonly recordKey: string; readonly value: unknown }[] }[] }

type UnknownRecord = Record<string, any>;
// Runtime validation is deliberately exhaustive below; `any` here keeps the
// untrusted JSON boundary from leaking `unknown` through every checked field.
const isRecord = (value: unknown): value is Record<string, any> => value !== null && typeof value === "object" && !Array.isArray(value);
const string = (value: unknown): value is string => typeof value === "string";
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value);
const positive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;
const nonNegative = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const digest = (value: unknown): value is `sha256:${string}` => string(value) && /^sha256:[a-f0-9]{64}$/.test(value);
const fail = (message: string): never => { throw new Error(`PROJECTION_INVALID:${message}`); };
const required = <T>(value: T | undefined, field: string): T => value === undefined ? fail(`MISSING_${field}`) : value;
const array = (value: unknown, field: string): any[] => Array.isArray(value) ? value : fail(`ARRAY_${field}`);
const unique = (values: readonly string[], field: string): void => { if (new Set(values).size !== values.length) fail(`DUPLICATE_${field}`); };
const MAX_BYTES = 1_000_000;
const MAX_ITEMS = 10_000;
const MAX_STRING = 100_000;
const MAX_EXPANDED_TABLE_CELLS = 100_000;
const boundedString = (value: unknown, field: string): value is string => string(value) && value.length <= MAX_STRING;
const boundedArray = (value: unknown, field: string): any[] => { const values = array(value, field); return values.length <= MAX_ITEMS ? values : fail(`TOO_MANY_${field}`); };
const only = (value: UnknownRecord, keys: readonly string[], field: string): void => { if (Object.keys(value).some((key) => !keys.includes(key))) fail(`${field}_EXTRA_KEY`); };

function json(value: unknown, field: string): unknown {
  try { canonicalizeJson(value); return value; } catch { return fail(`JSON_${field}`); }
}

function parseNode(input: any, depth = 0): DomNode {
  if (depth > 64) fail("DOM_DEPTH");
  if (!isRecord(input)) fail("DOM_NODE");
  if (input.tag === "#text") {
    only(input, ["tag", "text"], "DOM_TEXT_NODE");
    if (!boundedString(input.text, "DOM_TEXT") || input.text.length === 0) fail("DOM_TEXT_NODE");
    return { tag: "#text", text: input.text };
  }
  only(input, ["tag", "id", "attributes", "text", "hidden", "children"], "DOM_NODE");
  if (!boundedString(input.tag, "DOM_TAG") || !/^[A-Za-z][A-Za-z0-9:-]*$/.test(input.tag)) fail("DOM_NODE");
  if (input.id !== undefined && (!boundedString(input.id, "DOM_ID") || input.id.length === 0)) fail("DOM_ID");
  if (input.text !== undefined && !boundedString(input.text, "DOM_TEXT")) fail("DOM_TEXT");
  if (input.hidden !== undefined && typeof input.hidden !== "boolean") fail("DOM_HIDDEN");
  let attributes: Record<string, string> | undefined;
  if (input.text !== undefined && input.children !== undefined) fail("DOM_MIXED_CONTENT_UNSUPPORTED");
  if (input.attributes !== undefined) {
    if (!isRecord(input.attributes)) fail("DOM_ATTRIBUTES");
    attributes = {};
    for (const [key, value] of Object.entries(input.attributes)) {
      if (!/^[A-Za-z_:][-A-Za-z0-9_:.]*$/.test(key) || !boundedString(value, "DOM_ATTRIBUTE")) fail("DOM_ATTRIBUTE");
      attributes[key] = value as string;
    }
    if (attributes.id !== undefined) fail("DOM_ID_ATTRIBUTE_DUPLICATE");
  }
  const children = input.children === undefined ? undefined : boundedArray(input.children, "DOM_CHILDREN").map((child) => parseNode(child, depth + 1));
  return { tag: input.tag.toLowerCase(), ...(input.id === undefined ? {} : { id: input.id }), ...(attributes === undefined ? {} : { attributes }), ...(input.text === undefined ? {} : { text: input.text }), ...(input.hidden === undefined ? {} : { hidden: input.hidden }), ...(children === undefined ? {} : { children }) };
}

function parseHtml(input: UnknownRecord): HtmlDomProjection {
  only(input, ["kind", "document", "canonicalText"], "HTML");
  if (input.canonicalText !== undefined && !boundedString(input.canonicalText, "HTML_CANONICAL_TEXT")) fail("HTML_CANONICAL_TEXT");
  return { kind: "html_dom", document: parseNode(required(input.document, "DOCUMENT")), ...(input.canonicalText === undefined ? {} : { canonicalText: input.canonicalText }) };
}

function parsePdf(input: UnknownRecord): PdfTextProjection {
  const allowed = new Set(["kind", "pageCount", "pages", "residuals"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) fail("PDF_EXTRA_KEY");
  if (!integer(input.pageCount) || input.pageCount <= 0) fail("PDF_PAGE_COUNT");
  const pages = boundedArray(input.pages, "PDF_PAGES").map((item) => {
    if (!isRecord(item)) fail("PDF_PAGE"); only(item, ["physicalPageNumber", "text", "textLayerDigest", "widthPoints", "heightPoints"], "PDF_PAGE");
    if (!integer(item.physicalPageNumber) || item.physicalPageNumber <= 0 || !boundedString(item.text, "PDF_TEXT") || !digest(item.textLayerDigest) || !positive(item.widthPoints) || !positive(item.heightPoints)) fail("PDF_PAGE");
    return { physicalPageNumber: item.physicalPageNumber, text: item.text, textLayerDigest: item.textLayerDigest, widthPoints: item.widthPoints, heightPoints: item.heightPoints };
  });
  if (pages.length !== input.pageCount || new Set(pages.map((page) => page.physicalPageNumber)).size !== pages.length || pages.some((page) => page.physicalPageNumber > input.pageCount)) fail("PDF_PAGE_LINEAGE");
  const residuals = input.residuals === undefined ? undefined : boundedArray(input.residuals, "PDF_RESIDUALS").map((item) => {
    if (isRecord(item)) only(item, ["kind", "physicalPageNumber", "detail"], "PDF_RESIDUAL");
    if (!isRecord(item) || item.kind !== "unresolved_visual_content" || !integer(item.physicalPageNumber) || item.physicalPageNumber <= 0 || !string(item.detail) || item.detail.length === 0) fail("PDF_RESIDUAL");
    return { kind: "unresolved_visual_content" as const, physicalPageNumber: item.physicalPageNumber, detail: item.detail };
  });
  if (residuals?.some((item) => item.physicalPageNumber > input.pageCount)) fail("PDF_RESIDUAL_PAGE");
  return { kind: "pdf_text", pageCount: input.pageCount, pages, ...(residuals === undefined ? {} : { residuals }) };
}

function parseGeometry(input: UnknownRecord): GeometryProjection {
  if (Object.keys(input).some((key) => key !== "kind" && key !== "pages")) fail("GEOMETRY_EXTRA_KEY");
  const pages = boundedArray(input.pages, "GEOMETRY_PAGES").map((item) => {
    if (!isRecord(item)) fail("GEOMETRY_PAGE");
    const allowed = new Set(["physicalPageNumber", "widthPoints", "heightPoints", "imageWidth", "imageHeight", "tokens"]);
    if (Object.keys(item).some((key) => !allowed.has(key))) fail("GEOMETRY_PAGE_EXTRA_KEY");
    if (item.physicalPageNumber !== undefined && (!integer(item.physicalPageNumber) || item.physicalPageNumber <= 0)) fail("GEOMETRY_PAGE_NUMBER");
    if ((item.widthPoints === undefined) !== (item.heightPoints === undefined) || (item.widthPoints !== undefined && (!positive(item.widthPoints) || !positive(item.heightPoints)))) fail("GEOMETRY_POINT_DIMENSIONS");
    if ((item.imageWidth === undefined) !== (item.imageHeight === undefined) || (item.imageWidth !== undefined && (!integer(item.imageWidth) || !integer(item.imageHeight) || item.imageWidth <= 0 || item.imageHeight <= 0))) fail("GEOMETRY_PIXEL_DIMENSIONS");
    const tokens = boundedArray(item.tokens, "GEOMETRY_TOKENS").map((token) => {
      if (isRecord(token)) only(token, ["text", "x", "y", "width", "height", "coordinateSpace", "order"], "GEOMETRY_TOKEN");
      if (!isRecord(token) || !string(token.text) || !nonNegative(token.x) || !nonNegative(token.y) || !positive(token.width) || !positive(token.height) || !integer(token.order) || token.order < 0 || (token.coordinateSpace !== "normalized" && token.coordinateSpace !== "pixels" && token.coordinateSpace !== "pdf_points")) fail("GEOMETRY_TOKEN");
      if (token.coordinateSpace === "normalized" && (token.x + token.width > 1 || token.y + token.height > 1)) fail("GEOMETRY_NORMALIZED_BOUNDS");
      if (token.coordinateSpace === "pixels" && (item.imageWidth === undefined || token.x + token.width > item.imageWidth || token.y + token.height > item.imageHeight!)) fail("GEOMETRY_PIXEL_BOUNDS");
      if (token.coordinateSpace === "pdf_points" && (item.widthPoints === undefined || token.x + token.width > item.widthPoints || token.y + token.height > item.heightPoints!)) fail("GEOMETRY_POINT_BOUNDS");
      return { text: token.text, x: token.x, y: token.y, width: token.width, height: token.height, coordinateSpace: token.coordinateSpace, order: token.order };
    });
    if (new Set(tokens.map((token) => token.order)).size !== tokens.length) fail("GEOMETRY_TOKEN_ORDER");
    return { ...(item.physicalPageNumber === undefined ? {} : { physicalPageNumber: item.physicalPageNumber }), ...(item.widthPoints === undefined ? {} : { widthPoints: item.widthPoints, heightPoints: item.heightPoints! }), ...(item.imageWidth === undefined ? {} : { imageWidth: item.imageWidth, imageHeight: item.imageHeight! }), tokens };
  });
  if (pages.length === 0 || new Set(pages.map((page) => page.physicalPageNumber).filter((page): page is number => page !== undefined)).size !== pages.filter((page) => page.physicalPageNumber !== undefined).length) fail("GEOMETRY_PAGE_DUPLICATE");
  return { kind: "geometry", pages };
}

function parseTable(input: UnknownRecord): TableProjection {
  if (Object.keys(input).some((key) => key !== "kind" && key !== "tables")) fail("TABLE_EXTRA_KEY");
  const tables = boundedArray(input.tables, "TABLES").map((item) => {
    if (!isRecord(item) || !string(item.tableId) || item.tableId.length === 0) fail("TABLE");
    only(item, ["tableId", "cells"], "TABLE");
    const cells = boundedArray(item.cells, "TABLE_CELLS").map((cell) => {
      if (!isRecord(cell) || !integer(cell.row) || cell.row < 0 || !integer(cell.column) || cell.column < 0 || !string(cell.value)) fail("TABLE_CELL");
      only(cell, ["row", "column", "value", "headerPath", "rowSpan", "columnSpan"], "TABLE_CELL");
      const headerPath = array(cell.headerPath, "TABLE_HEADER_PATH");
      if (headerPath.some((part) => !boundedString(part, "TABLE_HEADER") || part.length === 0) || (cell.rowSpan !== undefined && (!integer(cell.rowSpan) || cell.rowSpan <= 0 || cell.rowSpan > 1_000)) || (cell.columnSpan !== undefined && (!integer(cell.columnSpan) || cell.columnSpan <= 0 || cell.columnSpan > 1_000))) fail("TABLE_CELL_METADATA");
      return { row: cell.row, column: cell.column, value: cell.value, headerPath: headerPath as string[], ...(cell.rowSpan === undefined ? {} : { rowSpan: cell.rowSpan }), ...(cell.columnSpan === undefined ? {} : { columnSpan: cell.columnSpan }) };
    });
    return { tableId: item.tableId, cells };
  });
  const expandedCellCount = tables.reduce((total, table) => total + table.cells.reduce((tableTotal, cell) => tableTotal + (cell.rowSpan ?? 1) * (cell.columnSpan ?? 1), 0), 0);
  if (expandedCellCount > MAX_EXPANDED_TABLE_CELLS) fail("TABLE_EXPANDED_CELL_BUDGET");
  for (const table of tables) {
    const occupied = new Set<string>();
    for (const cell of table.cells) {
      const rowEnd = cell.row + (cell.rowSpan ?? 1);
      const columnEnd = cell.column + (cell.columnSpan ?? 1);
      if (!Number.isSafeInteger(rowEnd) || !Number.isSafeInteger(columnEnd)) fail("TABLE_COORDINATE_OVERFLOW");
      for (let row = cell.row; row < rowEnd; row += 1) for (let column = cell.column; column < columnEnd; column += 1) { const key = `${row}:${column}`; if (occupied.has(key)) fail("TABLE_OVERLAPPING_CELLS"); occupied.add(key); }
    }
  }
  unique(tables.map((table) => table.tableId), "TABLE_ID");
  return { kind: "table", tables };
}

function parseTranscript(input: UnknownRecord): TranscriptProjection {
  if (Object.keys(input).some((key) => key !== "kind" && key !== "durationMs" && key !== "segments")) fail("TRANSCRIPT_EXTRA_KEY");
  if (!integer(input.durationMs) || input.durationMs < 0) fail("TRANSCRIPT_DURATION");
  const segments = boundedArray(input.segments, "TRANSCRIPT_SEGMENTS").map((item) => {
    if (!isRecord(item) || !string(item.segmentId) || !integer(item.startMs) || !integer(item.endMs) || item.startMs < 0 || item.endMs <= item.startMs || item.endMs > input.durationMs || !string(item.text) || (item.speaker !== undefined && !string(item.speaker)) || (item.channel !== undefined && !string(item.channel))) fail("TRANSCRIPT_SEGMENT");
    only(item, ["segmentId", "startMs", "endMs", "text", "speaker", "channel"], "TRANSCRIPT_SEGMENT");
    return { segmentId: item.segmentId, startMs: item.startMs, endMs: item.endMs, text: item.text, ...(item.speaker === undefined ? {} : { speaker: item.speaker }), ...(item.channel === undefined ? {} : { channel: item.channel }) };
  });
  unique(segments.map((segment) => segment.segmentId), "TRANSCRIPT_SEGMENT_ID");
  for (let index = 1; index < segments.length; index += 1) if (segments[index - 1]!.endMs > segments[index]!.startMs) fail("TRANSCRIPT_OVERLAP_OR_UNSORTED");
  return { kind: "transcript", durationMs: input.durationMs, segments };
}

function safePath(path: string): boolean { return /^(?!\/)(?!.*\\)(?!.*\0)(?!.*(?:^|\/)\.?(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(path) && !path.split("/").some((part) => part === "." || part === ".."); }
function parseRepository(input: UnknownRecord): RepositoryProjection {
  if (Object.keys(input).some((key) => key !== "kind" && key !== "commit" && key !== "lineRangeConvention" && key !== "files")) fail("REPOSITORY_EXTRA_KEY");
  if (!string(input.commit) || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(input.commit) || input.lineRangeConvention !== "zero_based_half_open") fail("REPOSITORY_METADATA");
  const files = boundedArray(input.files, "REPOSITORY_FILES").map((item) => { if (!isRecord(item) || !boundedString(item.path, "REPOSITORY_PATH") || !safePath(item.path) || !boundedString(item.content, "REPOSITORY_CONTENT")) fail("REPOSITORY_FILE"); only(item, ["path", "content"], "REPOSITORY_FILE"); return { path: item.path, content: item.content }; });
  unique(files.map((file) => file.path), "REPOSITORY_PATH");
  return { kind: "repository", commit: input.commit, lineRangeConvention: "zero_based_half_open", files };
}

function parseDataset(input: UnknownRecord): DatasetProjection {
  if (Object.keys(input).some((key) => key !== "kind" && key !== "datasetVersionId" && key !== "rows")) fail("DATASET_EXTRA_KEY");
  if (!string(input.datasetVersionId) || input.datasetVersionId.length === 0) fail("DATASET_VERSION");
  const rows = boundedArray(input.rows, "DATASET_ROWS").map((item) => { if (!isRecord(item) || !boundedString(item.key, "DATASET_KEY") || item.key.length === 0 || !("value" in item)) fail("DATASET_ROW"); only(item, ["key", "value"], "DATASET_ROW"); return { key: item.key, value: json(item.value, "DATASET_VALUE") }; });
  unique(rows.map((row) => row.key), "DATASET_KEY");
  return { kind: "dataset", datasetVersionId: input.datasetVersionId, rows };
}

function parseApi(input: UnknownRecord): PaginatedApiProjection {
  if (Object.keys(input).some((key) => key !== "kind" && key !== "apiVersion" && key !== "queryDigest" && key !== "pages")) fail("API_EXTRA_KEY");
  if (!string(input.apiVersion) || input.apiVersion.length === 0 || !digest(input.queryDigest)) fail("API_LINEAGE");
  const pages = boundedArray(input.pages, "API_PAGES").map((item) => {
    if (!isRecord(item) || !string(item.pageKey) || item.pageKey.length === 0) fail("API_PAGE");
    only(item, ["pageKey", "records"], "API_PAGE");
    const records = boundedArray(item.records, "API_RECORDS").map((record) => { if (!isRecord(record) || !boundedString(record.recordKey, "API_RECORD_KEY") || record.recordKey.length === 0 || !("value" in record)) fail("API_RECORD"); only(record, ["recordKey", "value"], "API_RECORD"); return { recordKey: record.recordKey, value: json(record.value, "API_VALUE") }; });
    unique(records.map((record) => record.recordKey), "API_RECORD_KEY_IN_PAGE");
    return { pageKey: item.pageKey, records };
  });
  unique(pages.map((page) => page.pageKey), "API_PAGE_KEY");
  return { kind: "paginated_api", apiVersion: input.apiVersion, queryDigest: input.queryDigest, pages };
}

/** Parses only canonical JSON projections. It does not assert they were safely produced or registered. */
export function parseCanonicalProjection(content: Uint8Array): CanonicalProjection {
  if (content.byteLength > MAX_BYTES) fail("BYTES");
  let text = "";
  let value: unknown = undefined;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(content); value = JSON.parse(text); } catch { fail("JSON_PARSE"); }
  if (canonicalizeJson(value) !== text) fail("JSON_NOT_CANONICAL");
  if (!isRecord(value) || !string(value.kind)) fail("KIND");
  const projection = value as UnknownRecord;
  switch (projection.kind) {
    case "html_dom": return parseHtml(projection);
    case "pdf_text": return parsePdf(projection);
    case "geometry": return parseGeometry(projection);
    case "table": return parseTable(projection);
    case "transcript": return parseTranscript(projection);
    case "repository": return parseRepository(projection);
    case "dataset": return parseDataset(projection);
    case "paginated_api": return parseApi(projection);
    default: return fail("KIND");
  }
}
