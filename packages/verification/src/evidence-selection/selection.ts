import type {
  ResolvedSelector,
  VerificationSelector,
} from "@aiengineer/knowledge-contracts";
import { digestCanonicalJson } from "../deterministic/canonical.js";

/**
 * Bytes the caller already holds, the capture they belong to, and the locator to apply to them.
 * The custody fields are copied onto every report so a selection cannot be re-attached to another capture.
 */
export interface EvidenceSelectionRequest {
  readonly captureId: string;
  readonly representationArtifactId: string;
  readonly representationDigest: string;
  readonly selector: VerificationSelector;
  readonly content: Uint8Array;
}

/**
 * Outcome of applying one locator to captured bytes.
 * A failed locate is still an EvidenceSelection: read `resolution.status`, which is never "resolved" on failure.
 */
export interface EvidenceSelection {
  readonly resolution: ResolvedSelector;
  readonly selectedContent: Uint8Array;
  readonly selectedText?: string;
  readonly selectedValue?: unknown;
}

/**
 * Resolves selector kinds the core does not own (projection-backed media such as HTML, PDF, tables).
 * Its output is a claim: `resolveEvidenceSelector` re-checks custody and digests before returning it.
 */
export interface EvidenceSelectorResolver {
  readonly resolverVersion: string;
  readonly supportedKinds: readonly VerificationSelector["kind"][];
  resolve(request: EvidenceSelectionRequest): EvidenceSelection;
}

export type EvidenceSelectionFailure = Exclude<
  ResolvedSelector["status"],
  "resolved"
>;

type CustodyField =
  | "captureId"
  | "representationArtifactId"
  | "representationDigest"
  | "selectorDigest"
  | "selectorKind"
  | "resolverVersion";

/** The part of a report a resolver decides; custody is stamped by the reporter. */
export type EvidenceSelectionOutcome = Omit<ResolvedSelector, CustodyField>;

export interface EvidenceSelectionReporter {
  report(
    request: EvidenceSelectionRequest,
    outcome: EvidenceSelectionOutcome,
  ): ResolvedSelector;
  unresolved(
    request: EvidenceSelectionRequest,
    status: EvidenceSelectionFailure,
    occurrenceCount?: number,
  ): EvidenceSelection;
}

/** Report builders for one resolver version. Every report copies custody from the request. */
export function evidenceSelectionReporter(
  resolverVersion: string,
): EvidenceSelectionReporter {
  function report(
    request: EvidenceSelectionRequest,
    outcome: EvidenceSelectionOutcome,
  ): ResolvedSelector {
    return {
      captureId: request.captureId,
      representationArtifactId: request.representationArtifactId,
      representationDigest:
        request.representationDigest as ResolvedSelector["representationDigest"],
      selectorDigest: digestCanonicalJson(request.selector),
      selectorKind: request.selector.kind,
      resolverVersion,
      ...outcome,
    };
  }

  // A failed locate reports `normalization: "none"` even when the locator asked for another mode:
  // the report must not describe a normalized selection that did not happen.
  function unresolved(
    request: EvidenceSelectionRequest,
    status: EvidenceSelectionFailure,
    occurrenceCount = 0,
  ): EvidenceSelection {
    return {
      resolution: report(request, {
        status,
        occurrenceCount,
        resolvedRanges: [],
        normalization: "none",
      }),
      selectedContent: new Uint8Array(),
    };
  }

  return { report, unresolved };
}
