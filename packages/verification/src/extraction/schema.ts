import { canonicalizeJson, digestCanonicalJson } from "../deterministic/canonical.js";

export const EXTRACTION_SCHEMA_GATE_VERSION = "verification-extraction-schema.v1";

export interface ExtractionSchemaAdmissionLimits {
  readonly maxSchemaBytes: number;
  readonly maxDepth: number;
  readonly maxProperties: number;
  readonly maxEnumValues: number;
  readonly maxCandidateBytes: number;
}

export const DEFAULT_EXTRACTION_SCHEMA_LIMITS: ExtractionSchemaAdmissionLimits = Object.freeze({
  maxSchemaBytes: 65_536,
  maxDepth: 16,
  maxProperties: 256,
  maxEnumValues: 128,
  maxCandidateBytes: 1_048_576,
});

type JsonScalar = string | number | boolean | null;
type SchemaType = "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";

interface ObjectNode { readonly kind: "object"; readonly properties: ReadonlyMap<string, SchemaNode>; readonly required: ReadonlySet<string>; readonly additionalProperties: boolean; readonly minProperties?: number; readonly maxProperties?: number }
interface ArrayNode { readonly kind: "array"; readonly items: SchemaNode; readonly minItems?: number; readonly maxItems: number }
interface ScalarNode { readonly kind: "scalar"; readonly types: ReadonlySet<Exclude<SchemaType, "object" | "array">>; readonly enumValues?: readonly JsonScalar[]; readonly constValue?: JsonScalar; readonly minLength?: number; readonly maxLength?: number; readonly minimum?: number; readonly maximum?: number }
type SchemaNode = ObjectNode | ArrayNode | ScalarNode;

export interface AdmittedExtractionSchema {
  readonly schemaId: string;
  readonly schemaVersion: string;
  readonly schemaDigest: `sha256:${string}`;
  readonly gateVersion: typeof EXTRACTION_SCHEMA_GATE_VERSION;
  readonly limits: ExtractionSchemaAdmissionLimits;
  /** An immutable canonical snapshot retained for audit/provider request binding. */
  readonly canonicalSchema: unknown;
}

export interface ExtractionSchemaAdmission {
  readonly admitted: boolean;
  readonly checks: readonly ExtractionSchemaCheck[];
  readonly schema?: AdmittedExtractionSchema;
}

export interface ExtractionSchemaCheck { readonly code: string; readonly detail: string }

const schemaTypes = new Set<SchemaType>(["object", "array", "string", "number", "integer", "boolean", "null"]);
const allowedKeywords = new Set([
  "type", "description", "properties", "required", "additionalProperties", "items", "enum", "const",
  "minLength", "maxLength", "minimum", "maximum", "minItems", "maxItems", "minProperties", "maxProperties",
]);
const objectKeywords = new Set(["type", "description", "properties", "required", "additionalProperties", "minProperties", "maxProperties"]);
const arrayKeywords = new Set(["type", "description", "items", "minItems", "maxItems"]);
const stringKeywords = new Set(["type", "description", "enum", "const", "minLength", "maxLength"]);
const numericKeywords = new Set(["type", "description", "enum", "const", "minimum", "maximum"]);
const scalarKeywords = new Set(["type", "description", "enum", "const"]);
const admittedNodes = new WeakMap<object, SchemaNode>();
const plainObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const jsonScalar = (value: unknown): value is JsonScalar => value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
const nonNegativeInteger = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function boundedText(value: unknown, field: string): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > 255) return undefined;
  if (value !== value.trim() || /[\u0000-\u001f]/u.test(value)) return undefined;
  return value;
}

function parseTypes(value: unknown, path: string, checks: ExtractionSchemaCheck[]): ReadonlySet<SchemaType> | undefined {
  const values = typeof value === "string" ? [value] : Array.isArray(value) ? value : undefined;
  if (!values || values.length === 0 || values.length > 2 || values.some((item) => typeof item !== "string" || !schemaTypes.has(item as SchemaType))) {
    checks.push({ code: "SCHEMA_TYPE_UNSUPPORTED", detail: `${path} must declare one supported type or one type plus explicit null.` });
    return undefined;
  }
  const unique = new Set(values as SchemaType[]);
  if (unique.size !== values.length || (unique.size === 2 && !unique.has("null"))) {
    checks.push({ code: "SCHEMA_NULLABILITY_UNEXPLICIT", detail: `${path} may combine only a concrete type and null.` });
    return undefined;
  }
  return unique;
}

function rejectUnknownKeywords(schema: Record<string, unknown>, path: string, checks: ExtractionSchemaCheck[]): boolean {
  let valid = true;
  for (const key of Object.keys(schema)) {
    if (!allowedKeywords.has(key)) {
      checks.push({ code: key === "$ref" || key === "$dynamicRef" ? "SCHEMA_REF_REJECTED" : "SCHEMA_KEYWORD_UNSUPPORTED", detail: `${path} uses unsupported keyword ${key}.` });
      valid = false;
    }
  }
  return valid;
}

function rejectInapplicableKeywords(schema: Record<string, unknown>, types: ReadonlySet<SchemaType>, path: string, checks: ExtractionSchemaCheck[]): boolean {
  const base = types.has("object") ? objectKeywords : types.has("array") ? arrayKeywords : types.has("string") ? stringKeywords : (types.has("number") || types.has("integer")) ? numericKeywords : scalarKeywords;
  let valid = true;
  for (const key of Object.keys(schema)) if (!base.has(key)) { checks.push({ code: "SCHEMA_KEYWORD_INAPPLICABLE", detail: `${path} keyword ${key} is not valid for its declared type.` }); valid = false; }
  return valid;
}

function parseNode(schema: unknown, path: string, depth: number, state: { properties: number; enumValues: number }, limits: ExtractionSchemaAdmissionLimits, checks: ExtractionSchemaCheck[]): SchemaNode | undefined {
  if (!plainObject(schema)) {
    checks.push({ code: "SCHEMA_NODE_INVALID", detail: `${path} must be a plain JSON object.` });
    return undefined;
  }
  if (depth > limits.maxDepth) {
    checks.push({ code: "SCHEMA_DEPTH_EXCEEDED", detail: `${path} exceeds schema nesting limit.` });
    return undefined;
  }
  const keywordsValid = rejectUnknownKeywords(schema, path, checks);
  const description = schema.description;
  if (typeof description !== "string" || description.trim().length === 0 || description.length > 1_024) checks.push({ code: "SCHEMA_DESCRIPTION_REQUIRED", detail: `${path} requires a bounded non-empty description.` });
  const types = parseTypes(schema.type, path, checks);
  const typeKeywordsValid = types ? rejectInapplicableKeywords(schema, types, path, checks) : false;
  if (!keywordsValid || !typeKeywordsValid || !types || typeof description !== "string" || description.trim().length === 0 || description.length > 1_024) return undefined;
  if (types.has("object") || types.has("array")) {
    if (types.size !== 1) {
      checks.push({ code: "SCHEMA_CONTAINER_NULL_UNSUPPORTED", detail: `${path} containers cannot be nullable in the admitted subset.` });
      return undefined;
    }
    if (types.has("object")) {
      if (!plainObject(schema.properties) || !Array.isArray(schema.required) || typeof schema.additionalProperties !== "boolean") {
        checks.push({ code: "SCHEMA_OBJECT_POLICY_REQUIRED", detail: `${path} must explicitly declare properties, required, and boolean additionalProperties.` });
        return undefined;
      }
      const propertyNames = Object.keys(schema.properties);
      if (propertyNames.some((name) => name.length === 0 || name.length > 255 || /[\u0000-\u001f]/u.test(name))) checks.push({ code: "SCHEMA_PROPERTY_NAME_INVALID", detail: `${path} has an invalid property name.` });
      state.properties += propertyNames.length;
      if (state.properties > limits.maxProperties) checks.push({ code: "SCHEMA_PROPERTY_LIMIT_EXCEEDED", detail: `${path} exceeds the property limit.` });
      const required = schema.required;
      if (required.some((item) => typeof item !== "string") || new Set(required).size !== required.length || required.some((item) => !Object.hasOwn(schema.properties as object, item))) checks.push({ code: "SCHEMA_REQUIRED_INVALID", detail: `${path}.required must be unique declared property names.` });
      const children = new Map<string, SchemaNode>();
      for (const name of propertyNames) {
        const child = parseNode(schema.properties[name], `${path}/properties/${name}`, depth + 1, state, limits, checks);
        if (child) children.set(name, child);
      }
      if (checks.length > 0 && (state.properties > limits.maxProperties || children.size !== propertyNames.length || !propertyNames.length && schema.minProperties === undefined && schema.maxProperties === undefined)) return undefined;
      for (const key of ["minProperties", "maxProperties"] as const) if (schema[key] !== undefined && !nonNegativeInteger(schema[key])) checks.push({ code: "SCHEMA_BOUND_INVALID", detail: `${path}.${key} must be a non-negative safe integer.` });
      if (typeof schema.minProperties === "number" && typeof schema.maxProperties === "number" && schema.minProperties > schema.maxProperties) checks.push({ code: "SCHEMA_BOUND_INVALID", detail: `${path} property bounds are reversed.` });
      return checks.length === 0 ? { kind: "object", properties: children, required: new Set(required as string[]), additionalProperties: schema.additionalProperties, ...(schema.minProperties === undefined ? {} : { minProperties: schema.minProperties as number }), ...(schema.maxProperties === undefined ? {} : { maxProperties: schema.maxProperties as number }) } : undefined;
    }
    if (schema.items === undefined || !nonNegativeInteger(schema.maxItems) || (schema.minItems !== undefined && !nonNegativeInteger(schema.minItems)) || (typeof schema.minItems === "number" && schema.minItems > schema.maxItems) || schema.maxItems > 10_000) {
      checks.push({ code: "SCHEMA_ARRAY_BOUND_REQUIRED", detail: `${path} requires bounded items and maxItems no greater than 10000.` });
      return undefined;
    }
    const items = parseNode(schema.items, `${path}/items`, depth + 1, state, limits, checks);
    return items && checks.length === 0 ? { kind: "array", items, ...(schema.minItems === undefined ? {} : { minItems: schema.minItems }), maxItems: schema.maxItems } : undefined;
  }
  const scalarTypes = new Set([...types].filter((type): type is Exclude<SchemaType, "object" | "array"> => type !== "object" && type !== "array"));
  const enumValues = schema.enum;
  if (enumValues !== undefined) {
    if (!Array.isArray(enumValues) || enumValues.length === 0 || enumValues.length > limits.maxEnumValues || enumValues.some((item) => !jsonScalar(item)) || new Set(enumValues.map((item) => canonicalizeJson(item))).size !== enumValues.length) checks.push({ code: "SCHEMA_ENUM_INVALID", detail: `${path}.enum must contain unique bounded JSON scalars.` });
    else state.enumValues += enumValues.length;
  }
  if (state.enumValues > limits.maxEnumValues) checks.push({ code: "SCHEMA_ENUM_LIMIT_EXCEEDED", detail: `${path} exceeds the enum limit.` });
  if (schema.const !== undefined && !jsonScalar(schema.const)) checks.push({ code: "SCHEMA_CONST_INVALID", detail: `${path}.const must be a JSON scalar.` });
  for (const key of ["minLength", "maxLength"] as const) if (schema[key] !== undefined && (!nonNegativeInteger(schema[key]) || schema[key] > 16_384)) checks.push({ code: "SCHEMA_BOUND_INVALID", detail: `${path}.${key} must be a bounded non-negative safe integer.` });
  if (types.has("string") && !nonNegativeInteger(schema.maxLength)) checks.push({ code: "SCHEMA_STRING_BOUND_REQUIRED", detail: `${path} requires maxLength to bound output.` });
  if (typeof schema.minLength === "number" && typeof schema.maxLength === "number" && schema.minLength > schema.maxLength) checks.push({ code: "SCHEMA_BOUND_INVALID", detail: `${path} string bounds are reversed.` });
  for (const key of ["minimum", "maximum"] as const) if (schema[key] !== undefined && (typeof schema[key] !== "number" || !Number.isFinite(schema[key]))) checks.push({ code: "SCHEMA_BOUND_INVALID", detail: `${path}.${key} must be finite.` });
  if (typeof schema.minimum === "number" && typeof schema.maximum === "number" && schema.minimum > schema.maximum) checks.push({ code: "SCHEMA_BOUND_INVALID", detail: `${path} numeric bounds are reversed.` });
  return checks.length === 0 ? { kind: "scalar", types: scalarTypes, ...(enumValues === undefined ? {} : { enumValues: enumValues as JsonScalar[] }), ...(schema.const === undefined ? {} : { constValue: schema.const as JsonScalar }), ...(schema.minLength === undefined ? {} : { minLength: schema.minLength as number }), ...(schema.maxLength === undefined ? {} : { maxLength: schema.maxLength as number }), ...(schema.minimum === undefined ? {} : { minimum: schema.minimum as number }), ...(schema.maximum === undefined ? {} : { maximum: schema.maximum as number }) } : undefined;
}

/** Admit only the deterministic, non-recursive schema subset before provider invocation. */
export function admitExtractionSchema(input: { readonly schemaId: string; readonly schemaVersion: string; readonly schema: unknown; readonly limits?: Partial<ExtractionSchemaAdmissionLimits> }): ExtractionSchemaAdmission {
  const checks: ExtractionSchemaCheck[] = [];
  const schemaId = boundedText(input.schemaId, "schemaId");
  const schemaVersion = boundedText(input.schemaVersion, "schemaVersion");
  if (!schemaId || !schemaVersion) checks.push({ code: "SCHEMA_ID_VERSION_INVALID", detail: "schemaId and schemaVersion must be bounded, non-empty identifiers." });
  const limits = { ...DEFAULT_EXTRACTION_SCHEMA_LIMITS, ...input.limits };
  if (Object.entries(limits).some(([key, value]) => !Number.isSafeInteger(value) || value <= 0 || value > DEFAULT_EXTRACTION_SCHEMA_LIMITS[key as keyof ExtractionSchemaAdmissionLimits])) checks.push({ code: "SCHEMA_LIMIT_INVALID", detail: "Runtime limits must be positive safe integers that only tighten hard admission caps." });
  const schemaPreflight = preflightCandidate(input.schema, limits.maxSchemaBytes);
  if (schemaPreflight) checks.push({ code: "SCHEMA_PREFLIGHT_REJECTED", detail: `Schema failed bounded JSON preflight: ${schemaPreflight.detail}` });
  let canonical: string | undefined;
  try { canonical = canonicalizeJson(input.schema); } catch { checks.push({ code: "SCHEMA_NOT_CANONICAL_JSON", detail: "Schema must be canonicalizable JSON without unsupported values." }); }
  if (canonical && new TextEncoder().encode(canonical).byteLength > limits.maxSchemaBytes) checks.push({ code: "SCHEMA_BYTES_EXCEEDED", detail: "Schema exceeds the configured byte limit." });
  const snapshot = canonical === undefined ? undefined : JSON.parse(canonical) as unknown;
  const root = checks.length === 0 && snapshot !== undefined ? parseNode(snapshot, "#", 0, { properties: 0, enumValues: 0 }, limits, checks) : undefined;
  if (!root || root.kind !== "object") {
    checks.push({ code: "SCHEMA_ROOT_OBJECT_REQUIRED", detail: "The admitted extraction schema root must be an object." });
    return { admitted: false, checks };
  }
  const admitted = Object.freeze({ schemaId: schemaId!, schemaVersion: schemaVersion!, schemaDigest: digestCanonicalJson(snapshot), gateVersion: EXTRACTION_SCHEMA_GATE_VERSION, limits: Object.freeze({ ...limits }), canonicalSchema: deepFreeze(snapshot) }) as AdmittedExtractionSchema;
  admittedNodes.set(admitted, root);
  return { admitted: true, checks, schema: admitted };
}

export interface CandidateValidationCheck { readonly code: string; readonly path: string; readonly detail: string }
export interface CandidateValidationResult { readonly valid: boolean; readonly checks: readonly CandidateValidationCheck[]; readonly leafPaths: readonly string[] }

const escapePointer = (value: string): string => value.replace(/~/gu, "~0").replace(/\//gu, "~1");
const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Array.isArray(value) ? value : Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};
const nodeMatches = (node: ScalarNode, value: unknown): boolean => (value === null && node.types.has("null")) || (typeof value === "string" && node.types.has("string")) || (typeof value === "boolean" && node.types.has("boolean")) || (typeof value === "number" && Number.isFinite(value) && (node.types.has("number") || (node.types.has("integer") && Number.isInteger(value))));

function preflightCandidate(value: unknown, maxBytes: number): CandidateValidationCheck | undefined {
  const stack: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  const seen = new WeakSet<object>();
  let nodes = 0;
  let estimatedBytes = 0;
  try {
    while (stack.length > 0) {
      const current = stack.pop()!;
      nodes += 1;
      if (nodes > 50_000 || current.depth > 64) return { code: "CANDIDATE_PREFLIGHT_EXCEEDED", path: "#", detail: "Candidate exceeds preflight node or depth bounds." };
      if (current.value === null || typeof current.value === "boolean") { estimatedBytes += 5; continue; }
      if (typeof current.value === "number") { if (!Number.isFinite(current.value)) return { code: "CANDIDATE_NOT_JSON", path: "#", detail: "Candidate contains a non-finite number." }; estimatedBytes += 32; continue; }
      if (typeof current.value === "string") { estimatedBytes += current.value.length * 6 + 2; if (estimatedBytes > maxBytes) return { code: "CANDIDATE_PREFLIGHT_EXCEEDED", path: "#", detail: "Candidate strings exceed conservative aggregate byte bounds." }; continue; }
      if (typeof current.value !== "object" || !Array.isArray(current.value) && !plainObject(current.value)) return { code: "CANDIDATE_NOT_JSON", path: "#", detail: "Candidate contains a non-JSON value." };
      if (seen.has(current.value)) return { code: "CANDIDATE_NOT_JSON", path: "#", detail: "Candidate object graph is cyclic or aliases a prior node." };
      seen.add(current.value);
      if (Array.isArray(current.value)) {
        if (current.value.length > 10_000) return { code: "CANDIDATE_PREFLIGHT_EXCEEDED", path: "#", detail: "Candidate container exceeds preflight item bounds." };
        for (const child of current.value) stack.push({ value: child, depth: current.depth + 1 });
      } else {
        let keys = 0;
        for (const key in current.value) if (Object.hasOwn(current.value, key)) {
          keys += 1;
          estimatedBytes += key.length * 6 + 3;
          if (keys > 10_000 || estimatedBytes > maxBytes) return { code: "CANDIDATE_PREFLIGHT_EXCEEDED", path: "#", detail: "Candidate object exceeds conservative aggregate preflight bounds." };
          stack.push({ value: (current.value as Record<string, unknown>)[key], depth: current.depth + 1 });
        }
      }
    }
  } catch { return { code: "CANDIDATE_NOT_JSON", path: "#", detail: "Candidate cannot be safely inspected as JSON." }; }
  return undefined;
}

/** Validates the provider candidate independently; provider confidence is deliberately absent. */
export function validateExtractionCandidate(schema: AdmittedExtractionSchema, candidate: unknown): CandidateValidationResult {
  const checks: CandidateValidationCheck[] = [];
  const leafPaths: string[] = [];
  const root = admittedNodes.get(schema);
  if (!root) return { valid: false, checks: [{ code: "SCHEMA_ADMISSION_HANDLE_INVALID", path: "#", detail: "Schema was not produced by this admission gate instance." }], leafPaths };
  const preflight = preflightCandidate(candidate, schema.limits.maxCandidateBytes);
  if (preflight) return { valid: false, checks: [preflight], leafPaths };
  try {
    if (new TextEncoder().encode(canonicalizeJson(candidate)).byteLength > schema.limits.maxCandidateBytes) return { valid: false, checks: [{ code: "CANDIDATE_BYTES_EXCEEDED", path: "#", detail: "Candidate exceeds the admitted output byte limit." }], leafPaths };
  } catch { return { valid: false, checks: [{ code: "CANDIDATE_NOT_JSON", path: "#", detail: "Candidate is not canonicalizable JSON." }], leafPaths }; }
  let unknownNodes = 0;
  const visitUnknown = (value: unknown, path: string, depth: number): void => {
    unknownNodes += 1;
    if (unknownNodes > 10_000 || depth > 64) { checks.push({ code: "CANDIDATE_UNKNOWN_STRUCTURE_EXCEEDED", path, detail: "Additional-property structure exceeds deterministic traversal limits." }); return; }
    if (Array.isArray(value)) { value.forEach((item, index) => visitUnknown(item, `${path}/${index}`, depth + 1)); return; }
    if (plainObject(value)) { for (const key of Object.keys(value)) visitUnknown(value[key], `${path}/${escapePointer(key)}`, depth + 1); return; }
    leafPaths.push(path);
  };
  const visit = (node: SchemaNode, value: unknown, path: string): void => {
    if (node.kind === "object") {
      if (!plainObject(value)) { checks.push({ code: "CANDIDATE_TYPE", path, detail: "Expected object." }); return; }
      const propertyCount = Object.keys(value).length;
      if ((node.minProperties !== undefined && propertyCount < node.minProperties) || (node.maxProperties !== undefined && propertyCount > node.maxProperties)) checks.push({ code: "CANDIDATE_PROPERTY_BOUND", path, detail: "Object violates admitted property bounds." });
      for (const key of node.required) if (!Object.hasOwn(value, key)) checks.push({ code: "CANDIDATE_REQUIRED_MISSING", path: `${path}/${escapePointer(key)}`, detail: "Required property is absent; null is distinct from absent." });
      for (const [key, child] of node.properties) if (Object.hasOwn(value, key)) visit(child, value[key], `${path}/${escapePointer(key)}`);
      for (const key of Object.keys(value)) if (!node.properties.has(key)) {
        if (!node.additionalProperties) checks.push({ code: "CANDIDATE_ADDITIONAL_PROPERTY", path: `${path}/${escapePointer(key)}`, detail: "Additional property is forbidden by the admitted schema." });
        else visitUnknown(value[key], `${path}/${escapePointer(key)}`, 0);
      }
      return;
    }
    if (node.kind === "array") {
      if (!Array.isArray(value)) { checks.push({ code: "CANDIDATE_TYPE", path, detail: "Expected array." }); return; }
      if (value.length > node.maxItems || (node.minItems !== undefined && value.length < node.minItems)) checks.push({ code: "CANDIDATE_ARRAY_BOUND", path, detail: "Array violates admitted item bounds." });
      value.forEach((item, index) => visit(node.items, item, `${path}/${index}`));
      return;
    }
    if (!nodeMatches(node, value)) { checks.push({ code: "CANDIDATE_TYPE", path, detail: "Value does not match the admitted scalar type/nullability." }); return; }
    const codePoints = typeof value === "string" ? [...value].length : undefined;
    if (codePoints !== undefined && ((node.minLength !== undefined && codePoints < node.minLength) || (node.maxLength !== undefined && codePoints > node.maxLength))) checks.push({ code: "CANDIDATE_STRING_BOUND", path, detail: "String violates admitted Unicode code-point bounds." });
    if (typeof value === "number" && ((node.minimum !== undefined && value < node.minimum) || (node.maximum !== undefined && value > node.maximum))) checks.push({ code: "CANDIDATE_NUMERIC_BOUND", path, detail: "Number violates admitted bounds." });
    if (node.enumValues && !node.enumValues.some((item) => canonicalizeJson(item) === canonicalizeJson(value))) checks.push({ code: "CANDIDATE_ENUM", path, detail: "Value is outside the admitted enum." });
    if (node.constValue !== undefined && canonicalizeJson(node.constValue) !== canonicalizeJson(value)) checks.push({ code: "CANDIDATE_CONST", path, detail: "Value differs from admitted const." });
    leafPaths.push(path);
  };
  visit(root, candidate, "");
  return { valid: checks.length === 0, checks, leafPaths: leafPaths.sort() };
}
