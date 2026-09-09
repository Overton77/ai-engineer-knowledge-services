import type { VerificationSelector } from "@aiengineer/knowledge-contracts";
import { canonicalizeJson, sha256Digest } from "../deterministic/canonical.js";
import { compareFractions, parseDecimal, replayDecimalOperation, withinTolerance } from "../deterministic/decimal.js";
import { resolveWithAdmittedResolver, type DeterministicSelectorResolver } from "../deterministic/selectors.js";
import { type AdmittedExtractionSchema, validateExtractionCandidate } from "./schema.js";
import {sourceComponentValue} from "./source-component.js";

export type FieldComparison = "exact" | "normalized_text" | "decimal" | "percentage" | "currency" | "unit" | "date" | "datetime" | "enum" | "identifier" | "checksum";
export interface ExtractionNormalizationRule { readonly id: string; readonly operation: "trim_ascii" | "ascii_whitespace_collapsed" }
export interface ExtractionFieldRule {
  readonly path: string;
  readonly comparison: FieldComparison;
  readonly normalizationId?: string;
  readonly allowedValues?: readonly string[];
  readonly minimum?: string;
  readonly maximum?: string;
  /** `currency_code_token` validates only uppercase three-letter syntax; it is not an ISO registry lookup. */
  readonly identifierKind?: "uuid" | "sha256" | "cve" | "currency_code_token";
  readonly checksum?: "luhn" | "isbn13";
  /** Explicit scalar evidence extraction from structured selector results; locator metadata is never a field value. */
  readonly sourceComponent?: "table_cell_value" | "geometry_token_text" | "transcript_text";
  /** Required for multi-token/segment components, making source joining deterministic. */
  readonly sourceJoiner?: "space" | "none";
}
export interface ExtractionEvidence {
  readonly path: string;
  readonly captureId: string;
  readonly representationArtifactId: string;
  readonly representationDigest: `sha256:${string}`;
  readonly selector: VerificationSelector;
  readonly expectedSelectedContentDigest?: `sha256:${string}`;
}
/** Representation bytes are checked against their immutable digest before selection. Registration/tenant authorization belongs to WS-03 composition. */
export interface ImmutableExtractionRepresentation { readonly captureId: string; readonly artifactId: string; readonly digest: `sha256:${string}`; readonly content: Uint8Array }
export interface DuplicateRecordRule { readonly arrayPath: string; readonly keyPaths: readonly string[] }
export interface CrossFieldTotalRule { readonly resultPath: string; readonly operandPaths: readonly string[]; readonly operation: "identity" | "sum" | "difference" | "product" | "ratio" | "percent_change"; readonly tolerance?: string }
export interface ExtractionVerificationCheck { readonly code: string; readonly path: string; readonly status: "passed" | "failed"; readonly detail: string }
export interface ExtractionFieldVerificationResult { readonly valid: boolean; readonly candidateValid: boolean; readonly checks: readonly ExtractionVerificationCheck[] }
/** Package-internal capture from the one authoritative field-verification pass. */
export interface VerifiedExtractionScalarSelection {
  readonly path: string;
  readonly value: string | number | boolean | null;
  readonly rawValue: string | number | boolean | null;
  readonly rule: ExtractionFieldRule;
  readonly evidence: ExtractionEvidence;
  readonly selectedContentDigest: `sha256:${string}`;
}
export interface ExtractionFieldVerificationInput {
  readonly schema: AdmittedExtractionSchema;
  readonly candidate: unknown;
  readonly fields: readonly ExtractionFieldRule[];
  readonly evidence: readonly ExtractionEvidence[];
  readonly representations: readonly ImmutableExtractionRepresentation[];
  readonly normalizations?: readonly ExtractionNormalizationRule[];
  readonly duplicates?: readonly DuplicateRecordRule[];
  readonly totals?: readonly CrossFieldTotalRule[];
  readonly selectorResolvers?: readonly DeterministicSelectorResolver[];
}

const utf8 = new TextDecoder("utf-8", { fatal: true });
const jsonPointerTokens = (path: string): string[] | undefined => {
  if (path === "") return [];
  if (!path.startsWith("/") || path.length > 4_096) return undefined;
  let depth = 0;
  for (let index = 0; index < path.length; index += 1) { if (path[index] === "/") { depth += 1; if (depth > 64) return undefined; } }
  const tokens: string[] = [];
  for (const token of path.slice(1).split("/")) {
    if (/~(?:[^01]|$)/u.test(token)) return undefined;
    tokens.push(token.replace(/~1/gu, "/").replace(/~0/gu, "~"));
  }
  return tokens;
};
const getAtPointer = (value: unknown, path: string): { found: boolean; value?: unknown } => {
  const tokens = jsonPointerTokens(path);
  if (!tokens) return { found: false };
  let current: unknown = value;
  for (const token of tokens) {
    if (Array.isArray(current)) {
      if (!/^(0|[1-9]\d*)$/u.test(token)) return { found: false };
      const index = Number(token);
      if (!Number.isSafeInteger(index) || index >= current.length) return { found: false };
      current = current[index];
    } else if (current !== null && typeof current === "object" && Object.hasOwn(current, token)) current = (current as Record<string, unknown>)[token];
    else return { found: false };
  }
  return { found: true, value: current };
};
const check = (checks: ExtractionVerificationCheck[], code: string, path: string, passed: boolean, detail: string): void => { checks.push({ code, path, status: passed ? "passed" : "failed", detail }); };
const strictDecimal = (value: unknown): string | undefined => typeof value === "string" && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value) && value.length <= 128 && (value.split(".")[1]?.length ?? 0) <= 36 ? value : undefined;
const strictPercent = (value: unknown): string | undefined => {
  if (typeof value !== "string" || !value.endsWith("%")) return undefined;
  return strictDecimal(value.slice(0, -1));
};
const strictCurrency = (value: unknown, allowed: readonly string[] | undefined): { code: string; amount: string } | undefined => {
  if (!allowed || allowed.length === 0 || typeof value !== "string") return undefined;
  const match = /^([A-Z]{3}) (-?(?:0|[1-9]\d*)(?:\.\d+)?)$/u.exec(value);
  return match && allowed.includes(match[1]!) && strictDecimal(match[2]!) ? { code: match[1]!, amount: match[2]! } : undefined;
};
const normalize = (value: string, rule: ExtractionNormalizationRule): string | undefined => {
  if (rule.operation === "trim_ascii") return value.replace(/^[ \t\r\n]+|[ \t\r\n]+$/gu, "");
  if (/[\u0000-\u001f\u007f]/u.test(value.replace(/[\t\r\n]/gu, ""))) return undefined;
  return value.replace(/^[ \t\r\n]+|[ \t\r\n]+$/gu, "").replace(/[ \t\r\n]+/gu, " ");
};
const validDate = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match || match[1] === "0000") return undefined;
  const date = new Date(0);
  date.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  date.setUTCHours(0, 0, 0, 0);
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() + 1 === Number(match[2]) && date.getUTCDate() === Number(match[3]) ? value : undefined;
};
const validDateTime = (value: unknown): number | undefined => {
  if (typeof value !== "string") return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/u.exec(value);
  if (!match || match[1] === "0000") return undefined;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]), hour = Number(match[4]), minute = Number(match[5]), second = Number(match[6]);
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return undefined;
  const probe = new Date(0);
  probe.setUTCFullYear(year, month - 1, day);
  probe.setUTCHours(hour, minute, second, Number((match[7] ?? "").padEnd(3, "0")));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() + 1 !== month || probe.getUTCDate() !== day) return undefined;
  const zone = match[8]!;
  const base = probe.getTime();
  if (zone === "Z") return base;
  const sign = zone[0] === "+" ? 1 : -1;
  const offsetHours = Number(zone.slice(1, 3)), offsetMinutes = Number(zone.slice(4, 6));
  if (offsetHours > 23 || offsetMinutes > 59) return undefined;
  return base - sign * (offsetHours * 60 + offsetMinutes) * 60_000;
};
const identifierValid = (value: unknown, kind: ExtractionFieldRule["identifierKind"]): boolean => {
  if (typeof value !== "string" || !kind) return false;
  if (kind === "uuid") return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);
  if (kind === "sha256") return /^sha256:[0-9a-f]{64}$/u.test(value);
  if (kind === "cve") return /^CVE-\d{4}-\d{4,}$/u.test(value);
  return /^[A-Z]{3}$/u.test(value);
};
const luhn = (value: string): boolean => {
  if (!/^\d{2,64}$/u.test(value)) return false;
  let sum = 0;
  for (let index = value.length - 1, factor = 1; index >= 0; index -= 1, factor = factor === 1 ? 2 : 1) { let digit = Number(value[index]) * factor; if (digit > 9) digit -= 9; sum += digit; }
  return sum % 10 === 0;
};
const isbn13 = (value: string): boolean => {
  if (!/^\d{13}$/u.test(value)) return false;
  const total = [...value].slice(0, 12).reduce((sum, digit, index) => sum + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return (10 - total % 10) % 10 === Number(value[12]);
};
const comparisonKinds = new Set<FieldComparison>(["exact", "normalized_text", "decimal", "percentage", "currency", "unit", "date", "datetime", "enum", "identifier", "checksum"]);
const boundedAllowedValues = (values: readonly string[] | undefined): boolean => values === undefined || (values.length <= 128 && values.every((value) => typeof value === "string" && value.length > 0 && value.length <= 128) && new Set(values).size === values.length);
const sourceComponents = new Set<NonNullable<ExtractionFieldRule["sourceComponent"]>>(["table_cell_value", "geometry_token_text", "transcript_text"]);
const totalOperations = new Set<CrossFieldTotalRule["operation"]>(["identity", "sum", "difference", "product", "ratio", "percent_change"]);
const MAX_FIELD_ITEMS = 10_000;
const MAX_REPRESENTATIONS = 256;
const MAX_REPRESENTATION_BYTES = 1_048_576;
const MAX_TOTAL_REPRESENTATION_BYTES = 64 * 1_024 * 1_024;
const MAX_EVIDENCE_SCAN_BYTES = 64 * 1_024 * 1_024;
const MAX_DUPLICATE_KEY_PATHS = 16;
const MAX_DUPLICATE_WORK = 100_000;
const MAX_TOTAL_OPERANDS = 64;
const MAX_TOTAL_OPERAND_WORK = 10_000;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

function compareValue(rule: ExtractionFieldRule, candidate: unknown, evidence: unknown, normalizations: ReadonlyMap<string, ExtractionNormalizationRule>): { passed: boolean; detail: string } {
  if (rule.comparison === "exact") return { passed: canonicalizeJson(candidate) === canonicalizeJson(evidence), detail: "Candidate equals selected evidence exactly." };
  if (rule.comparison === "normalized_text") {
    const normalization = rule.normalizationId ? normalizations.get(rule.normalizationId) : undefined;
    if (!normalization || typeof candidate !== "string" || typeof evidence !== "string") return { passed: false, detail: "Normalized text requires an explicit normalization rule and strings." };
    const left = normalize(candidate, normalization), right = normalize(evidence, normalization);
    return { passed: left !== undefined && left === right, detail: "Candidate and selected evidence match under the declared normalization." };
  }
  if (rule.comparison === "decimal") {
    const left = strictDecimal(candidate), right = strictDecimal(evidence);
    if (!left || !right) return { passed: false, detail: "Decimal values must be bounded canonical decimal strings." };
    try {
      const actual = parseDecimal(left), selected = parseDecimal(right);
      const rangeOk = (!rule.minimum || compareFractions(actual, parseDecimal(rule.minimum)) >= 0) && (!rule.maximum || compareFractions(actual, parseDecimal(rule.maximum)) <= 0);
      return { passed: compareFractions(actual, selected) === 0 && rangeOk, detail: "Exact decimal comparison and declared range were replayed." };
    } catch { return { passed: false, detail: "Decimal rule bounds are invalid." }; }
  }
  if (rule.comparison === "percentage") {
    const left = strictPercent(candidate), right = strictPercent(evidence);
    if (!left || !right) return { passed: false, detail: "Percentages require canonical decimal strings with a literal percent sign." };
    try { return { passed: compareFractions(parseDecimal(left), parseDecimal(right)) === 0, detail: "Percentage values match without locale inference." }; } catch { return { passed: false, detail: "Percentage parse failed." }; }
  }
  if (rule.comparison === "currency") {
    const left = strictCurrency(candidate, rule.allowedValues), right = strictCurrency(evidence, rule.allowedValues);
    if (!left || !right) return { passed: false, detail: "Currency requires an allowed ISO code and `CODE decimal` spelling; symbols/locales are unsupported." };
    try { return { passed: left.code === right.code && compareFractions(parseDecimal(left.amount), parseDecimal(right.amount)) === 0, detail: "Currency code and exact amount match." }; } catch { return { passed: false, detail: "Currency amount parse failed." }; }
  }
  if (rule.comparison === "unit") return { passed: typeof candidate === "string" && typeof evidence === "string" && Boolean(rule.allowedValues?.includes(candidate)) && candidate === evidence, detail: "Unit is an explicit allowed token and matches evidence." };
  if (rule.comparison === "date") { const left = validDate(candidate), right = validDate(evidence); return { passed: left !== undefined && left === right, detail: "Calendar date is valid and matches evidence." }; }
  if (rule.comparison === "datetime") { const left = validDateTime(candidate), right = validDateTime(evidence); return { passed: left !== undefined && left === right, detail: "RFC3339 datetime with explicit timezone resolves to the same instant." }; }
  if (rule.comparison === "enum") return { passed: rule.allowedValues !== undefined && typeof candidate === "string" && rule.allowedValues.includes(candidate) && canonicalizeJson(candidate) === canonicalizeJson(evidence), detail: "Explicit enum membership and evidence equality were checked." };
  if (rule.comparison === "identifier") return { passed: identifierValid(candidate, rule.identifierKind) && canonicalizeJson(candidate) === canonicalizeJson(evidence), detail: "Supported identifier format and evidence equality were checked." };
  const validChecksum = typeof candidate === "string" && (rule.checksum === "luhn" ? luhn(candidate) : rule.checksum === "isbn13" ? isbn13(candidate) : false);
  return { passed: validChecksum && candidate === evidence, detail: "Declared checksum and evidence equality were checked." };
}

/**
 * Re-resolves every evidence edge from verified bytes. It intentionally receives no provider result/status/confidence field.
 * Upstream persistence must authorize and hydrate the representations; this pure layer verifies their digest and content again.
 */
export function verifyExtractionFields(input: ExtractionFieldVerificationInput): ExtractionFieldVerificationResult {
  return verifyExtractionFieldsWithAcceptedSelections(input).result;
}

/** Used by the evidence adapter only. It never changes the legacy result shape. */
export function verifyExtractionFieldsWithAcceptedSelections(input: ExtractionFieldVerificationInput): { readonly result: ExtractionFieldVerificationResult; readonly selections: readonly VerifiedExtractionScalarSelection[] } {
  const checks: ExtractionVerificationCheck[] = [];
  if (input.fields.length > MAX_FIELD_ITEMS || input.evidence.length > MAX_FIELD_ITEMS || (input.normalizations?.length ?? 0) > 256 || (input.duplicates?.length ?? 0) > 1_024 || (input.totals?.length ?? 0) > 1_024 || input.representations.length > MAX_REPRESENTATIONS) {
    check(checks, "EXTRACTION_VERIFICATION_LIMIT_EXCEEDED", "", false, "Field, evidence, normalization, duplicate, total, or representation input exceeds hard limits.");
    return { result: { valid: false, candidateValid: false, checks }, selections: [] };
  }
  if (input.representations.some((item) => item.content.byteLength > MAX_REPRESENTATION_BYTES)) {
    check(checks, "REPRESENTATION_BYTES_EXCEEDED", "", false, "Representation bytes exceed the selector verification limit.");
    return { result: { valid: false, candidateValid: false, checks }, selections: [] };
  }
  if (input.representations.reduce((total, item) => total + item.content.byteLength, 0) > MAX_TOTAL_REPRESENTATION_BYTES) {
    check(checks, "REPRESENTATION_AGGREGATE_BYTES_EXCEEDED", "", false, "Aggregate representation bytes exceed the hard verification limit.");
    return { result: { valid: false, candidateValid: false, checks }, selections: [] };
  }
  const unverifiedRepresentations = new Map(input.representations.map((item) => [item.artifactId, item]));
  let requestedEvidenceBytes = 0;
  for (const edge of input.evidence) {
    requestedEvidenceBytes += unverifiedRepresentations.get(edge.representationArtifactId)?.content.byteLength ?? 0;
    if (requestedEvidenceBytes > MAX_EVIDENCE_SCAN_BYTES) {
      check(checks, "EVIDENCE_SCAN_BYTES_EXCEEDED", "", false, "Repeated selector resolution would exceed the hard aggregate scan budget.");
      return { result: { valid: false, candidateValid: false, checks }, selections: [] };
    }
  }
  const candidate = validateExtractionCandidate(input.schema, input.candidate);
  for (const item of candidate.checks) check(checks, item.code, item.path, false, item.detail);
  if (!candidate.valid) return { result: { valid: false, candidateValid: false, checks }, selections: [] };
  const normalizations = new Map<string, ExtractionNormalizationRule>();
  for (const rule of input.normalizations ?? []) {
    if (typeof rule.id !== "string" || rule.id.length === 0 || rule.id.length > 255 || normalizations.has(rule.id) || (rule.operation !== "trim_ascii" && rule.operation !== "ascii_whitespace_collapsed")) check(checks, "NORMALIZATION_RULE_INVALID", "", false, "Normalization rules require a unique bounded ID and supported operation.");
    else normalizations.set(rule.id, rule);
  }
  const ruleByPath = new Map<string, ExtractionFieldRule>();
  const evidenceByPath = new Map<string, ExtractionEvidence>();
  const representationById = new Map<string, ImmutableExtractionRepresentation>();
  for (const rule of input.fields) {
    const pointer = jsonPointerTokens(rule.path);
    const decimalBoundsValid = rule.comparison === "decimal" ? (rule.minimum === undefined || strictDecimal(rule.minimum) !== undefined) && (rule.maximum === undefined || strictDecimal(rule.maximum) !== undefined) : rule.minimum === undefined && rule.maximum === undefined;
    const componentValid = rule.sourceComponent === undefined ? rule.sourceJoiner === undefined : sourceComponents.has(rule.sourceComponent) && (rule.sourceComponent === "table_cell_value" ? rule.sourceJoiner === undefined : rule.sourceJoiner === "space" || rule.sourceJoiner === "none");
    const optionsApplicable = (rule.allowedValues === undefined || rule.comparison === "enum" || rule.comparison === "currency" || rule.comparison === "unit")
      && (rule.identifierKind === undefined || rule.comparison === "identifier")
      && (rule.normalizationId === undefined || rule.comparison === "normalized_text")
      && (rule.checksum === undefined || rule.comparison === "checksum");
    if (!pointer || ruleByPath.has(rule.path) || !comparisonKinds.has(rule.comparison) || !boundedAllowedValues(rule.allowedValues) || !decimalBoundsValid || !componentValid || !optionsApplicable) check(checks, "FIELD_RULE_INVALID", rule.path, false, "Field rule path, comparison, options, scalar source component, and decimal bounds must be bounded and applicable.");
    else ruleByPath.set(rule.path, rule);
  }
  for (const item of input.evidence) {
    if (!jsonPointerTokens(item.path) || evidenceByPath.has(item.path)) check(checks, "FIELD_EVIDENCE_INVALID", item.path, false, "Evidence path must be a unique RFC 6901 pointer.");
    else evidenceByPath.set(item.path, item);
  }
  for (const item of input.representations) {
    if (representationById.has(item.artifactId) || sha256Digest(item.content) !== item.digest) check(checks, "REPRESENTATION_IMMUTABILITY_FAILED", "", false, "Representation identity is duplicate or content does not match its immutable digest.");
    else representationById.set(item.artifactId, item);
  }
  const selections: VerifiedExtractionScalarSelection[] = [];
  const scalar = (value: unknown): value is string | number | boolean | null => value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value);
  for (const path of candidate.leafPaths) {
    const rule = ruleByPath.get(path), evidence = evidenceByPath.get(path);
    if (!rule) { check(checks, "FIELD_RULE_MISSING", path, false, "Every candidate leaf requires an explicit verification rule."); continue; }
    if (!evidence) { check(checks, "FIELD_EVIDENCE_MISSING", path, false, "Every candidate leaf requires evidence." ); continue; }
    const representation = representationById.get(evidence.representationArtifactId);
    if (!representation || representation.captureId !== evidence.captureId || representation.digest !== evidence.representationDigest) { check(checks, "EVIDENCE_REPRESENTATION_UNSUPPORTED", path, false, "Evidence does not bind to a verified immutable representation." ); continue; }
    const selection = resolveWithAdmittedResolver({ captureId: representation.captureId, representationArtifactId: representation.artifactId, representationDigest: representation.digest, selector: evidence.selector, content: representation.content }, input.selectorResolvers ?? []);
    if (!selection || selection.resolution.status !== "resolved" || selection.resolution.occurrenceCount !== 1 || selection.resolution.selectedContentDigest !== sha256Digest(selection.selectedContent) || (evidence.expectedSelectedContentDigest !== undefined && evidence.expectedSelectedContentDigest !== selection.resolution.selectedContentDigest)) { check(checks, "EVIDENCE_RESOLUTION_FAILED", path, false, "Evidence selector did not uniquely resolve to the expected selected bytes." ); continue; }
    let selected: unknown;
    const component = sourceComponentValue(rule, evidence.selector, selection.resolution.selectedValue);
    if (component.detail) { check(checks, "EVIDENCE_SOURCE_COMPONENT_INVALID", path, false, component.detail); continue; }
    if (component.value !== undefined) selected = component.value;
    else if (selection.resolution.selectedValue === null || typeof selection.resolution.selectedValue === "string" || typeof selection.resolution.selectedValue === "number" || typeof selection.resolution.selectedValue === "boolean") selected = selection.resolution.selectedValue;
    else if (selection.resolution.selectedValue !== undefined) { check(checks, "EVIDENCE_VALUE_UNSUPPORTED", path, false, "Selector returned metadata rather than a scalar source value; geometry and locator metadata are not factual evidence." ); continue; }
    else {
      try { selected = utf8.decode(selection.selectedContent); } catch { check(checks, "EVIDENCE_VALUE_UNSUPPORTED", path, false, "Selected bytes are not a supported scalar source value." ); continue; }
    }
    const actual = getAtPointer(input.candidate, path);
    if (!actual.found) { check(checks, "FIELD_CANDIDATE_MISSING", path, false, "Validated leaf unexpectedly cannot be read." ); continue; }
    const outcome = compareValue(rule, actual.value, selected, normalizations);
    check(checks, `FIELD_${rule.comparison.toUpperCase()}_MATCH`, path, outcome.passed, outcome.detail);
    if (outcome.passed && scalar(actual.value) && scalar(selected)) selections.push(Object.freeze({ path, value: actual.value, rawValue: selected, rule: Object.freeze({ ...rule }), evidence: Object.freeze({ ...evidence, selector: structuredClone(evidence.selector) }), selectedContentDigest: selection.resolution.selectedContentDigest }));
  }
  for (const [path] of ruleByPath) if (!candidate.leafPaths.includes(path)) check(checks, "FIELD_RULE_NOT_LEAF", path, false, "Field rule points to a missing or non-leaf candidate path.");
  for (const [path] of evidenceByPath) if (!candidate.leafPaths.includes(path)) check(checks, "FIELD_EVIDENCE_NOT_LEAF", path, false, "Evidence points to a missing or non-leaf candidate path.");
  let duplicateWork = 0;
  for (const rule of input.duplicates ?? []) {
    const array = getAtPointer(input.candidate, rule.arrayPath);
    if (!Array.isArray(array.value) || rule.keyPaths.length === 0 || rule.keyPaths.length > MAX_DUPLICATE_KEY_PATHS || rule.keyPaths.some((path) => jsonPointerTokens(path) === undefined)) { check(checks, "DUPLICATE_RULE_INVALID", rule.arrayPath, false, "Duplicate rule requires bounded RFC 6901 key paths and an array."); continue; }
    duplicateWork += array.value.length * rule.keyPaths.length;
    if (duplicateWork > MAX_DUPLICATE_WORK) { check(checks, "DUPLICATE_WORK_EXCEEDED", rule.arrayPath, false, "Duplicate key comparison exceeds the aggregate deterministic work budget."); continue; }
    const keys = new Set<string>(); let duplicate = false;
    for (const record of array.value) {
      const values = rule.keyPaths.map((path) => getAtPointer(record, path));
      if (values.some((value) => !value.found || value.value === null || typeof value.value === "object")) { duplicate = true; break; }
      const key = canonicalizeJson(values.map((value) => value.value));
      if (keys.has(key)) { duplicate = true; break; }
      keys.add(key);
    }
    check(checks, "RECORD_KEYS_UNIQUE", rule.arrayPath, !duplicate, "Record key tuples are unique and non-null scalar values.");
  }
  let totalOperandWork = 0;
  for (const rule of input.totals ?? []) {
    if (rule.operandPaths.length === 0 || rule.operandPaths.length > MAX_TOTAL_OPERANDS || rule.operandPaths.some((path) => jsonPointerTokens(path) === undefined) || jsonPointerTokens(rule.resultPath) === undefined) { check(checks, "TOTAL_RULE_RESOURCE_INVALID", rule.resultPath, false, "Total rule paths and operand count exceed deterministic bounds."); continue; }
    totalOperandWork += rule.operandPaths.length;
    if (totalOperandWork > MAX_TOTAL_OPERAND_WORK) { check(checks, "TOTAL_WORK_EXCEEDED", rule.resultPath, false, "Total operand replay exceeds the aggregate deterministic work budget."); continue; }
    const result = getAtPointer(input.candidate, rule.resultPath);
    const operands = rule.operandPaths.map((path) => getAtPointer(input.candidate, path));
    const resultDecimal = result.found ? strictDecimal(result.value) : undefined;
    const operandDecimals = operands.map((item) => item.found ? strictDecimal(item.value) : undefined);
    const cardinalityValid = totalOperations.has(rule.operation) && ((rule.operation === "identity" && rule.operandPaths.length === 1) || ((rule.operation === "ratio" || rule.operation === "percent_change") && rule.operandPaths.length === 2) || ((rule.operation === "sum" || rule.operation === "difference" || rule.operation === "product") && rule.operandPaths.length >= 1));
    if (!resultDecimal || operandDecimals.some((item) => !item) || !cardinalityValid) { check(checks, "CROSS_FIELD_TOTAL_INPUT_INVALID", rule.resultPath, false, "Total operation/cardinality and operands must be supported canonical decimal values."); continue; }
    try {
      const replayed = replayDecimalOperation(rule.operation, operandDecimals as string[]);
      const toleranceText = rule.tolerance === undefined ? "0" : strictDecimal(rule.tolerance);
      if (!toleranceText) throw new TypeError("invalid tolerance");
      const tolerance = parseDecimal(toleranceText);
      if (tolerance.numerator < 0n) throw new TypeError("negative tolerance");
      check(checks, "CROSS_FIELD_TOTAL_REPLAY", rule.resultPath, withinTolerance(parseDecimal(resultDecimal), replayed, tolerance), "Exact decimal core replayed the declared total operation.");
    } catch { check(checks, "CROSS_FIELD_TOTAL_RULE_INVALID", rule.resultPath, false, "Total operation, cardinality, or tolerance is invalid."); }
  }
  const result = { valid: checks.every((item) => item.status === "passed"), candidateValid: true, checks };
  return { result, selections: result.valid ? Object.freeze(selections) : [] };
}
