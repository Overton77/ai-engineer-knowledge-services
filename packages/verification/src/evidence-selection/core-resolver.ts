import type {
  ResolvedSelector,
  VerificationSelector,
} from "@aiengineer/knowledge-contracts";
import { canonicalizeJson, sha256Digest } from "../canonical/index.js";
import { evaluateJsonPointer } from "./json-pointer.js";
import {
  evidenceSelectionReporter,
  type EvidenceSelection,
  type EvidenceSelectionRequest,
} from "./selection.js";
import {
  findAllOccurrences,
  normalizeText,
  type NormalizedText,
} from "./text-normalization.js";
import { resolveTextOffsetRange } from "./text-offsets.js";
import { decodeUtf8, encodeUtf8 } from "./utf8.js";
import { CORE_RESOLVER_VERSION } from "../versions.js";

const report = evidenceSelectionReporter(CORE_RESOLVER_VERSION);

type CoreSelector<Kind extends VerificationSelector["kind"]> = Extract<
  VerificationSelector,
  { kind: Kind }
>;
type ResolvedRanges = ResolvedSelector["resolvedRanges"];
type TextOutcome = Pick<ResolvedSelector, "resolvedRanges" | "normalization">;

/**
 * Resolves the locator kinds this package owns directly: text quotes, character positions,
 * JSON pointers, and ordered multi-fragment text. `undefined` means the kind belongs to another resolver.
 */
export function resolveCoreEvidenceSelector(
  request: EvidenceSelectionRequest,
): EvidenceSelection | undefined {
  const { selector } = request;
  switch (selector.kind) {
    case "text_quote":
      return resolveTextQuote(request, selector);
    case "character_position":
      return resolveCharacterPosition(request, selector);
    case "json_pointer":
      return resolveJsonPointer(request, selector);
    case "multi_fragment_text":
      return resolveMultiFragmentText(request, selector);
    default:
      return undefined;
  }
}

/** A quote identifies evidence only if it occurs exactly once after normalization and prefix/suffix filtering. */
function resolveTextQuote(
  request: EvidenceSelectionRequest,
  selector: CoreSelector<"text_quote">,
): EvidenceSelection {
  const source = decodeSource(request);
  if (typeof source !== "string") return source;
  const normalizedSource = normalizeText(source, selector.normalization);
  const normalizedQuote = normalizeText(
    selector.quote,
    selector.normalization,
  ).text;
  const occurrences = findQuoteOccurrences(
    normalizedSource.text,
    normalizedQuote,
    selector,
  );
  if (occurrences.length !== 1) {
    return report.unresolved(
      request,
      occurrences.length > 1 ? "ambiguous" : "not_found",
      occurrences.length,
    );
  }
  const range = sourceRangeOf(
    normalizedSource,
    occurrences[0]!,
    normalizedQuote.length,
  );
  if (!range) return report.unresolved(request, "not_found");
  return resolvedText(request, source.slice(range.start, range.end), {
    resolvedRanges: [{ ...range, coordinateSpace: "utf16_code_units" }],
    normalization: selector.normalization,
  });
}

function findQuoteOccurrences(
  normalizedSource: string,
  normalizedQuote: string,
  selector: CoreSelector<"text_quote">,
): number[] {
  let occurrences = findAllOccurrences(normalizedSource, normalizedQuote);
  if (selector.prefix !== undefined) {
    const prefix = normalizeText(selector.prefix, selector.normalization).text;
    occurrences = occurrences.filter(
      (at) =>
        normalizedSource.slice(Math.max(0, at - prefix.length), at) === prefix,
    );
  }
  if (selector.suffix !== undefined) {
    const suffix = normalizeText(selector.suffix, selector.normalization).text;
    const quoteEnd = (at: number) => at + normalizedQuote.length;
    occurrences = occurrences.filter(
      (at) =>
        normalizedSource.slice(quoteEnd(at), quoteEnd(at) + suffix.length) ===
        suffix,
    );
  }
  return occurrences;
}

/** Maps a hit in the normalized text back onto the original source; `undefined` if the mapping is missing. */
function sourceRangeOf(
  normalized: NormalizedText,
  normalizedStart: number,
  length: number,
): { start: number; end: number } | undefined {
  const start = normalized.sourceStarts[normalizedStart];
  const end = normalized.sourceEnds[normalizedStart + length - 1];
  return start === undefined || end === undefined ? undefined : { start, end };
}

/** Offsets that miss the text or split a code point are a bad locator (`invalid`), not a missing quote. */
function resolveCharacterPosition(
  request: EvidenceSelectionRequest,
  selector: CoreSelector<"character_position">,
): EvidenceSelection {
  const source = decodeSource(request);
  if (typeof source !== "string") return source;
  const normalized = normalizeText(source, selector.normalization).text;
  const range = resolveTextOffsetRange(normalized, selector);
  if (!range) return report.unresolved(request, "invalid");
  // The report keeps the caller's declared coordinates, not the converted UTF-16 slice, so replay sees the same numbers.
  return resolvedText(request, normalized.slice(range.start, range.end), {
    resolvedRanges: [
      {
        start: selector.start,
        end: selector.end,
        coordinateSpace: selector.offsetBasis,
      },
    ],
    normalization: selector.normalization,
  });
}

/** The selection is the canonical JSON of the pointed node; a pointer is a path, so no character range is reported. */
function resolveJsonPointer(
  request: EvidenceSelectionRequest,
  selector: CoreSelector<"json_pointer">,
): EvidenceSelection {
  let document: unknown;
  try {
    document = JSON.parse(decodeUtf8(request.content)) as unknown;
  } catch {
    return report.unresolved(request, "parse_error");
  }
  const lookup = evaluateJsonPointer(selector.pointer, document);
  if (!lookup.found) return report.unresolved(request, "not_found");
  const selectedText = canonicalizeJson(lookup.value);
  const selectedContent = encodeUtf8(selectedText);
  return {
    resolution: report.report(request, {
      status: "resolved",
      occurrenceCount: 1,
      selectedContentDigest: sha256Digest(selectedContent),
      selectedValue: lookup.value as never,
      resolvedRanges: [],
      normalization: "none",
    }),
    selectedContent,
    selectedText,
    selectedValue: lookup.value,
  };
}

/**
 * Two or more core text locators, in order, joined with the declared joiner.
 * The joined text is a constructed selection, not a contiguous slice of the source.
 */
function resolveMultiFragmentText(
  request: EvidenceSelectionRequest,
  selector: CoreSelector<"multi_fragment_text">,
): EvidenceSelection | undefined {
  const fragments: EvidenceSelection[] = [];
  for (const fragmentSelector of selector.fragments) {
    const fragment = resolveCoreEvidenceSelector({
      ...request,
      selector: fragmentSelector,
    });
    if (fragment === undefined) return undefined;
    fragments.push(fragment);
  }
  if (fragments.some((fragment) => fragment.resolution.status !== "resolved")) {
    const anyAmbiguous = fragments.some(
      (fragment) => fragment.resolution.status === "ambiguous",
    );
    return report.unresolved(request, anyAmbiguous ? "ambiguous" : "not_found");
  }
  const ranges = fragments.flatMap(
    (fragment) => fragment.resolution.resolvedRanges,
  );
  if (!rangesAreOrdered(ranges)) return report.unresolved(request, "invalid");
  const joined = fragments
    .map((fragment) => fragment.selectedText ?? "")
    .join(selector.joiner);
  return resolvedText(request, joined, {
    resolvedRanges: ranges,
    normalization: selector.fragments[0]!.normalization,
  });
}

/** Fragments must share one coordinate space and must not overlap or run backwards. */
function rangesAreOrdered(ranges: ResolvedRanges): boolean {
  for (let index = 1; index < ranges.length; index += 1) {
    const previous = ranges[index - 1]!;
    const current = ranges[index]!;
    if (
      previous.coordinateSpace !== current.coordinateSpace ||
      current.start < previous.end
    )
      return false;
  }
  return true;
}

/** Returns the decoded source, or a `parse_error` selection when the bytes are not UTF-8 text. */
function decodeSource(
  request: EvidenceSelectionRequest,
): string | EvidenceSelection {
  try {
    return decodeUtf8(request.content);
  } catch {
    return report.unresolved(request, "parse_error");
  }
}

function resolvedText(
  request: EvidenceSelectionRequest,
  selectedText: string,
  outcome: TextOutcome,
): EvidenceSelection {
  const selectedContent = encodeUtf8(selectedText);
  return {
    resolution: report.report(request, {
      status: "resolved",
      occurrenceCount: 1,
      selectedContentDigest: sha256Digest(selectedContent),
      selectedValue: selectedText,
      ...outcome,
    }),
    selectedContent,
    selectedText,
    selectedValue: selectedText,
  };
}
