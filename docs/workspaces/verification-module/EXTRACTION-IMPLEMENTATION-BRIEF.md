# WS-04 implementation and review brief

Coordinator preparation, 2026-09-05. This is a bounded dispatch brief; the specification remains authoritative. WS-04 is not claimed by this document.

## Integration boundaries

Keep deterministic selectors and field checks under `packages/verification/src/selectors` and `extraction`. Compose the existing acquisition, conversion, documents, runtime artifact store, and WS-03 provenance ports. Do not put network access, parser processes, or database clients in the deterministic core. Extend the stable facade through narrow exports. Record necessary contract changes and regenerate schemas.

The current core admits text quote, character position, ordered multi-fragment text, and JSON Pointer. Other selector kinds fail closed through the trusted resolver port. Implement capture-bound projection schemas and resolvers for HTML, PDF text, geometry, table, transcript/timecode, repository, dataset, and paginated API records. Projection content must bind to its artifact digest and source lineage; arbitrary caller metadata is insufficient to authenticate a repository commit or dataset version.

## Review cases

- HTML: duplicate DOM matches, script/hidden text policy, conflicting CSS/XPath/path locators, explicit fallback route and selected digest. Never silently turn a failed DOM selector into a successful quote match.
- PDF: physical one-based page numbering, declared offset basis, exact page text-layer hash, missing text layer, graph-only values, and mismatched page dimensions. PDF points are not pixels; convert explicitly or use normalized geometry.
- Geometry: zero/negative/out-of-bounds boxes, page/image dimension mismatch, token intersection policy, ordered extraction, and ambiguity. A box alone does not prove semantic support.
- Tables: row/column/header association, duplicate table IDs, merged cells, repeated headers, wrong adjacent value, and missing versus empty cells.
- Transcript: half-open time windows, overlap, speaker/channel ambiguity, exact boundary behavior, and absence of aligned tokens. Do not fabricate word-level timing from whole-segment text.
- Repository: full immutable commit, safe path, byte versus line conventions, Unicode boundaries, and missing/mismatched commit metadata; no local filesystem lookup in the resolver.
- Dataset/API: unique keys, version/page lineage, duplicate record IDs across pages, absent/null fields, malformed pointers, and explicit page disambiguation.
- Every successful resolver records one occurrence, exact selected-content digest, normalization, coordinate/offset information, and implementation version; ambiguous selections abstain.
- Schema gate: bounded supported JSON Schema subset before a provider call, no remote refs/executable extensions, bounded nesting/properties/enums, explicit missing/null/additional-property behavior, canonical schema identity, separate normalization rules.
- Field checks: evidence for every leaf; null and missing distinct; decimal/percentage/currency/unit/date/timezone handling; checksums/identifiers; duplicate records; cross-field totals and derivations use the exact arithmetic core. Provider confidence is diagnostic only.

## Real fixture inputs already prepared

Read `SOURCE-CAPTURE-NOTES.md` and `PDF-FIXTURE-NOTES.md`. The restricted captures reside outside redistributable source at `../../../../internal/verification-source-captures/20260905/`. The index binds 14 HTML/provider response projections. A public 24-page TruAge sample PDF and a native pdfplumber projection are available with receipts and hashes. These coordinator preparations must be ingested through production ports before being presented as production verification proof.

The PDF was visually checked on physical pages 2 and 7. Native text on page 2 omits plotted numbers visible in the image despite containing other text. Record this as a real residual and require visual evidence or abstention for graph-dependent claims. Historical sample output is not a current product specification. Do not redistribute the full PDF or corporate captures under an assumed open license.

Use synthetic hostile/geometry/transcript fixtures where no licensed real fixture exists, labeled explicitly. Coordinator subsequently captured `gl-immune-age-19` with authentic 19-system article text and a 21-system footer; see the updated source notes and separate receipt. This is a real content conflict; its displayed publication date alone does not prove a dated product transition.

## Parser operational proof

The pinned Docling service is defined in `services/docling/compose.yaml`; it is a separate boundary. Existing limits and loopback binding do not alone prove network denial. Demonstrate actual CPU, memory, disk, page, time, and network bounds for admitted local parser execution. Preserve parser/version/options signatures, raw bytes, derived artifact lineage, and residuals. Do not install an unbounded parser in a request handler or silently use a different parser after failure.

Use unique test log paths, hash completed logs, and write a handoff. The coordinator will independently inspect adverse cases and rerun meaningful tests before marking this workstream done.

## Confirmed acquisition dependency defect

Coordinator fixed the execution deadline and cancellation boundary while WS-03 proceeded. The original probe now rejects with `ACQUISITION_TIMEOUT` after 14 ms; acquisition tests pass 20/20, including stalled body, execution DNS timeout without subsequent fetch, and cancellation of an oversized response. WS-04 should independently review this dependency and cover remaining parser/acquisition limits. Planning-stage DNS and artifact-store latency are distinct from the tested network execution boundary; do not generalize this proof to those phases. Original finding follows.

Coordinator probe `../../../../internal/verification-acquisition-deadline-probe.mts` reproduced a response-body deadline bypass in `packages/acquisition/src/http.ts`: a transport returns headers immediately and body bytes after 100 ms; the 10 ms configured timeout is cleared at headers, and acquisition accepts the late bytes after 113 ms. The probe exits 1 while the defect remains. Close this narrow dependency before admitting production acquisition: keep an enforceable deadline through DNS, headers, redirects, and body streaming, cancel/drain rejected bodies, and prove no artifact is stored after timeout. Retain a meaningful package regression; a test that only delays headers misses this failure.
