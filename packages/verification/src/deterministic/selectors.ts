import type {
  ResolvedSelector,
  VerificationSelector,
} from "@aiengineer/knowledge-contracts";
import { canonicalizeJson, digestCanonicalJson, sha256Digest } from "./canonical.js";

export interface SelectorResolutionRequest {
  readonly captureId: string;
  readonly representationArtifactId: string;
  readonly representationDigest: string;
  readonly selector: VerificationSelector;
  readonly content: Uint8Array;
}

export interface TrustedSelectorResolution {
  readonly resolution: ResolvedSelector;
  readonly selectedContent: Uint8Array;
}

export interface DeterministicSelectorResolver {
  readonly resolverVersion: string;
  readonly supportedKinds: readonly VerificationSelector["kind"][];
  resolve(request: SelectorResolutionRequest): TrustedSelectorResolution;
}

interface TextProjection { readonly text: string; readonly starts: readonly number[]; readonly ends: readonly number[] }
interface InternalSelection {
  readonly resolution: ResolvedSelector;
  readonly selectedContent: Uint8Array;
  readonly selectedText?: string;
  readonly selectedValue?: unknown;
}

const utf8 = new TextEncoder();
const decode = (content: Uint8Array): string => new TextDecoder("utf-8", { fatal: true }).decode(content);
const allIndexes = (text: string, needle: string): number[] => {
  if (!needle) return [];
  const indexes: number[] = [];
  let from = 0;
  while (from <= text.length - needle.length) {
    const at = text.indexOf(needle, from);
    if (at < 0) break;
    indexes.push(at);
    from = at + 1;
  }
  return indexes;
};

function normalizeText(value: string, normalization: "none" | "lf" | "lf_whitespace_collapsed" | "casefold_whitespace_filler_removed"): TextProjection {
  if (normalization === "none") return { text: value, starts: Array.from({ length: value.length }, (_, index) => index), ends: Array.from({ length: value.length }, (_, index) => index + 1) };
  let lfText = "";
  const lfStarts: number[] = [];
  const lfEnds: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    if (char === "\r") {
      const end = value[index + 1] === "\n" ? index + 2 : index + 1;
      lfText += "\n";
      lfStarts.push(index);
      lfEnds.push(end);
      if (end === index + 2) index += 1;
    } else {
      lfText += char;
      lfStarts.push(index);
      lfEnds.push(index + 1);
    }
  }
  if (normalization === "lf") return { text: lfText, starts: lfStarts, ends: lfEnds };
  const removed = new Set<number>();
  if (normalization === "casefold_whitespace_filler_removed") {
    for (const match of lfText.matchAll(/\b(?:uh|um)\b/giu)) {
      const start = match.index ?? 0;
      for (let index = start; index < start + match[0].length; index += 1) removed.add(index);
    }
  }
  let text = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let pendingStart: number | undefined;
  let pendingEnd: number | undefined;
  const append = (output: string, rawStart: number, rawEnd: number): void => {
    text += output;
    for (let unit = 0; unit < output.length; unit += 1) {
      starts.push(rawStart);
      ends.push(rawEnd);
    }
  };
  for (let index = 0; index < lfText.length;) {
    const codePoint = lfText.codePointAt(index)!;
    const char = String.fromCodePoint(codePoint);
    const units = char.length;
    const rawStart = lfStarts[index]!;
    const rawEnd = lfEnds[index + units - 1]!;
    const treatedAsWhitespace = /\s/u.test(char) || Array.from({ length: units }, (_, offset) => removed.has(index + offset)).every(Boolean);
    if (treatedAsWhitespace) {
      if (text.length > 0) {
        pendingStart ??= rawStart;
        pendingEnd = rawEnd;
      }
    } else {
      if (pendingStart !== undefined && pendingEnd !== undefined) append(" ", pendingStart, pendingEnd);
      pendingStart = undefined;
      pendingEnd = undefined;
      const output = normalization === "casefold_whitespace_filler_removed" ? char.toLocaleLowerCase("und") : char;
      append(output, rawStart, rawEnd);
    }
    index += units;
  }
  return { text, starts, ends };
}

function baseResolution(request: SelectorResolutionRequest, fields: Omit<ResolvedSelector, "captureId" | "representationArtifactId" | "representationDigest" | "selectorDigest" | "selectorKind" | "resolverVersion">): ResolvedSelector {
  return {
    captureId: request.captureId,
    representationArtifactId: request.representationArtifactId,
    representationDigest: request.representationDigest,
    selectorDigest: digestCanonicalJson(request.selector),
    selectorKind: request.selector.kind,
    resolverVersion: "verification-core.v1",
    ...fields,
  };
}

function unresolved(request: SelectorResolutionRequest, status: "not_found" | "ambiguous" | "invalid" | "parse_error", occurrenceCount = 0): InternalSelection {
  return {
    resolution: baseResolution(request, { status, occurrenceCount, resolvedRanges: [], normalization: "none" }),
    selectedContent: new Uint8Array(),
  };
}

function resolveTextQuote(request: SelectorResolutionRequest, selector: Extract<VerificationSelector, { kind: "text_quote" }>): InternalSelection {
  let source: string;
  try { source = decode(request.content); } catch { return unresolved(request, "parse_error"); }
  const normalizedSource = normalizeText(source, selector.normalization);
  const normalizedQuote = normalizeText(selector.quote, selector.normalization).text;
  let matches = allIndexes(normalizedSource.text, normalizedQuote);
  if (selector.prefix !== undefined) {
    const prefix = normalizeText(selector.prefix, selector.normalization).text;
    matches = matches.filter((at) => normalizedSource.text.slice(Math.max(0, at - prefix.length), at) === prefix);
  }
  if (selector.suffix !== undefined) {
    const suffix = normalizeText(selector.suffix, selector.normalization).text;
    matches = matches.filter((at) => normalizedSource.text.slice(at + normalizedQuote.length, at + normalizedQuote.length + suffix.length) === suffix);
  }
  if (matches.length !== 1) return unresolved(request, matches.length > 1 ? "ambiguous" : "not_found", matches.length);
  const normalizedStart = matches[0]!;
  const normalizedEnd = normalizedStart + normalizedQuote.length - 1;
  const start = normalizedSource.starts[normalizedStart];
  const end = normalizedSource.ends[normalizedEnd];
  if (start === undefined || end === undefined) return unresolved(request, "not_found");
  const selectedText = source.slice(start, end);
  const selectedContent = utf8.encode(selectedText);
  return {
    resolution: baseResolution(request, {
      status: "resolved",
      occurrenceCount: 1,
      selectedContentDigest: sha256Digest(selectedContent),
      selectedValue: selectedText,
      resolvedRanges: [{ start, end, coordinateSpace: "utf16_code_units" }],
      normalization: selector.normalization,
    }),
    selectedContent,
    selectedText,
    selectedValue: selectedText,
  };
}

function positionRange(text: string, selector: Extract<VerificationSelector, { kind: "character_position" }>): { start: number; end: number } | undefined {
  if (selector.offsetBasis === "utf16_code_units") return selector.end <= text.length ? { start: selector.start, end: selector.end } : undefined;
  if (selector.offsetBasis === "unicode_code_points") {
    const points = [...text];
    if (selector.end > points.length) return undefined;
    return { start: points.slice(0, selector.start).join("").length, end: points.slice(0, selector.end).join("").length };
  }
  const bytes = utf8.encode(text);
  if (selector.end > bytes.length) return undefined;
  try {
    const prefix = decode(bytes.slice(0, selector.start));
    const selected = decode(bytes.slice(selector.start, selector.end));
    return { start: prefix.length, end: prefix.length + selected.length };
  } catch { return undefined; }
}

function resolveCharacterPosition(request: SelectorResolutionRequest, selector: Extract<VerificationSelector, { kind: "character_position" }>): InternalSelection {
  let source: string;
  try { source = decode(request.content); } catch { return unresolved(request, "parse_error"); }
  const normalized = normalizeText(source, selector.normalization).text;
  const range = positionRange(normalized, selector);
  if (!range) return unresolved(request, "invalid");
  const selectedText = normalized.slice(range.start, range.end);
  const selectedContent = utf8.encode(selectedText);
  return {
    resolution: baseResolution(request, {
      status: "resolved", occurrenceCount: 1, selectedContentDigest: sha256Digest(selectedContent), selectedValue: selectedText,
      resolvedRanges: [{ ...range, coordinateSpace: selector.offsetBasis }], normalization: selector.normalization,
    }),
    selectedContent, selectedText, selectedValue: selectedText,
  };
}

function resolveJsonPointer(request: SelectorResolutionRequest, selector: Extract<VerificationSelector, { kind: "json_pointer" }>): InternalSelection {
  let value: unknown;
  try { value = JSON.parse(decode(request.content)) as unknown; } catch { return unresolved(request, "parse_error"); }
  if (selector.pointer !== "") {
    for (const token of selector.pointer.slice(1).split("/").map((item) => item.replace(/~1/g, "/").replace(/~0/g, "~"))) {
      if (Array.isArray(value)) {
        if (!/^(?:0|[1-9]\d*)$/.test(token)) return unresolved(request, "not_found");
        const index = Number(token);
        if (index >= value.length) return unresolved(request, "not_found");
        value = value[index];
      } else if (value !== null && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, token)) {
        value = (value as Record<string, unknown>)[token];
      } else return unresolved(request, "not_found");
    }
  }
  const selectedText = canonicalizeJson(value);
  const selectedContent = utf8.encode(selectedText);
  return {
    resolution: baseResolution(request, {
      status: "resolved", occurrenceCount: 1, selectedContentDigest: sha256Digest(selectedContent), selectedValue: value as never,
      resolvedRanges: [], normalization: "none",
    }),
    selectedContent, selectedText, selectedValue: value,
  };
}

export function resolveBuiltInSelector(request: SelectorResolutionRequest): InternalSelection | undefined {
  const selector = request.selector;
  if (selector.kind === "text_quote") return resolveTextQuote(request, selector);
  if (selector.kind === "character_position") return resolveCharacterPosition(request, selector);
  if (selector.kind === "json_pointer") return resolveJsonPointer(request, selector);
  if (selector.kind === "multi_fragment_text") {
    const parts = selector.fragments.map((fragment) => resolveBuiltInSelector({ ...request, selector: fragment }));
    if (parts.some((part) => part === undefined)) return undefined;
    const resolved = parts as InternalSelection[];
    if (resolved.some((part) => part.resolution.status !== "resolved")) return unresolved(request, resolved.some((part) => part.resolution.status === "ambiguous") ? "ambiguous" : "not_found");
    const ranges = resolved.flatMap((part) => part.resolution.resolvedRanges);
    for (let index = 1; index < ranges.length; index += 1) {
      const previous = ranges[index - 1]!;
      const current = ranges[index]!;
      if (previous.coordinateSpace !== current.coordinateSpace || current.start < previous.end) return unresolved(request, "invalid");
    }
    const selectedText = resolved.map((part) => part.selectedText ?? "").join(selector.joiner);
    const selectedContent = utf8.encode(selectedText);
    return {
      resolution: baseResolution(request, {
        status: "resolved", occurrenceCount: 1, selectedContentDigest: sha256Digest(selectedContent), selectedValue: selectedText,
        resolvedRanges: ranges, normalization: selector.fragments[0]!.normalization,
      }), selectedContent, selectedText, selectedValue: selectedText,
    };
  }
  return undefined;
}

export function resolveWithAdmittedResolver(request: SelectorResolutionRequest, resolvers: readonly DeterministicSelectorResolver[]): InternalSelection | undefined {
  const builtIn = resolveBuiltInSelector(request);
  if (builtIn) return builtIn;
  const resolver = resolvers.find((candidate) => candidate.supportedKinds.includes(request.selector.kind));
  if (!resolver) return undefined;
  const external = resolver.resolve(request);
  const resolution = external.resolution;
  const bindingMatches = resolution.captureId === request.captureId
    && resolution.representationArtifactId === request.representationArtifactId
    && resolution.representationDigest === request.representationDigest
    && resolution.selectorDigest === digestCanonicalJson(request.selector)
    && resolution.selectorKind === request.selector.kind
    && resolution.resolverVersion === resolver.resolverVersion;
  if (!bindingMatches) return unresolved(request, "invalid");
  const selectedContentDigest = sha256Digest(external.selectedContent);
  if (resolution.status === "resolved" && resolution.selectedContentDigest !== selectedContentDigest) return unresolved(request, "invalid");
  if (resolution.selectedValue !== undefined && sha256Digest(canonicalizeJson(resolution.selectedValue)) !== selectedContentDigest) return unresolved(request, "invalid");
  let selectedText: string | undefined;
  try { selectedText = decode(external.selectedContent); } catch { selectedText = undefined; }
  return {
    resolution,
    selectedContent: external.selectedContent,
    ...(selectedText === undefined ? {} : { selectedText }),
  };
}

export type DeterministicSelection = InternalSelection;
