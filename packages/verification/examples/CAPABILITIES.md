# Verification capabilities and media coverage

Status: **Reference — source-reviewed on 2026-09-16.** This describes the implementation and
fixture evidence, not production deployment or measured semantic accuracy. Baseline and
validation are in the [review record](../../../docs/operations/reviews/verification.md).

## What an agent can assert, and what verification establishes

An assertion declares a proposition, subject bindings, qualifiers, risk and intended use,
plus evidence links. A locator identifies the exact source material. A successful locator
does not establish that the proposition follows from that material. Mechanical verification
checks identity, immutable bytes, locator uniqueness, binding and deterministic rules.
Semantic support and policy admission are separate decisions after mechanics.

The executor accepts **14 claim types**: attribute, relationship, measurement, capability,
compatibility, temporal, causal, comparative, methodological, definition, event, provenance,
recommendation and other. Each claim can carry 1–8 evidence entries with supports,
contradicts, qualifies or context roles, up to 16 qualifiers, 8 entity bindings and 8
downstream uses. There can be up to 256 claims per intent; this maximum is not a recommended
semantic batch size. Propositions are limited to 600 characters and quotes to 4,000.

These categories describe claims; they are not fourteen specialized truth-checking engines.
`compileClaims` marks claims atomic. It does not independently discover that a compound
sentence is atomic. The package decomposition interface validates supplied segmentation,
exact report reconstruction, offsets and qualifier preservation; it does not independently
discover every factual assertion. Human-gold decomposition accuracy remains separate.

Example: “Panel A has 42 samples” can cite a unique row plus a contextual header. A count
of 42 found in Panel B, an omitted date, or a different population is not support for that
claim merely because the digits occur. Preserve those qualifiers in the assertion and report.

Evidence: [intent schemas](../../../apps/verification-executor/src/intents.ts),
[compilation](../../../apps/verification-executor/src/executor.ts),
[decomposition](../src/claims/decomposition.ts), [mechanical engine](../src/deterministic/engine.ts).

## Media and locator matrix

There are **4 built-in selectors and 8 projection selectors**. Every row is exercised by
[the executable fixtures](selectors.ts). A canonical projection resolver consumes an already
prepared representation; it does not download, OCR, transcribe or visually interpret media.

| Source representation | Selector and deterministically checked location | Agent-facing availability / important limit |
|---|---|---|
| Text / Markdown | `text_quote`: unique quote, optional adjacent prefix/suffix, explicit normalization | Executor uses exact quote with normalization `none`; no prefix/suffix intent fields, so extend the quote |
| Text positions | `character_position`: UTF-8 bytes, UTF-16 units or Unicode code points | Internal/bundle capability; executor intents do not accept offsets. Reported coordinates retain their declared basis; split code points are rejected |
| JSON | `json_pointer`: escaped RFC 6901 field/index path | Internal/bundle capability; executor captures JSON as text and quotes it |
| Discontinuous text | `multi_fragment_text`: ordered non-overlapping fragments with explicit ` … ` joiner | Internal/bundle capability; executor instead accepts separate evidence entries |
| HTML DOM | `html`: bounded CSS/XPath subset or DOM child path, optional text range | Hidden/script/style content excluded; locator descriptions must agree. Not arbitrary browser CSS/XPath. Executor HTML capture produces text, not this DOM projection |
| Native PDF text | `pdf_text`: physical page, text-layer digest and offset basis | Requires matching sealed projection and source lineage. Page labels and visual chart contents cannot be inferred from text |
| PDF/image text geometry | `bounding_box`: normalized/pixel box containing ordered tokens | Selects pre-existing tokens, not raw pixels. No OCR, chart interpretation, image similarity or visual grounding is established by this resolver |
| Tables / spreadsheet-like data | `table`: table ID, row, column, header path, optional expected value | Validates geometry/merged-cell constraints in the projection; executor spreadsheet/CSV input is provider-produced Markdown, not cell-addressable evidence |
| Audio/video transcript | `media_timecode`: half-open milliseconds, speaker/channel, fully contained segments | Mixed unscoped speakers/channels are ambiguous. No raw audio transcription, audio-event detection or video-frame verification in these entrypoints |
| Repository source | `repository`: full commit, safe path, zero-based half-open lines or UTF-8 bytes | Frozen file contents only; no checkout execution, test-running or semantic correctness proof |
| Dataset | `dataset`: version, unique row key, optional column | Requires supplied frozen rows; no live database query or population-statistical validation |
| Paginated API | `api_record`: page, unique record key, optional field pointer | Requires supplied API version/query digest/pages; does not prove all remote pages were collected |

Projection parsers reject malformed, noncanonical, unbounded or inconsistent representations.
Deterministic bundle execution also requires admitted projection lineage: manufacturing a JSON
projection that resolves successfully is not sufficient to admit evidence.
See [projection resolver](../src/evidence-selection/projection-resolver.ts), [projection validation](../src/evidence-selection/projections.ts),
[core resolver](../src/evidence-selection/core-resolver.ts) and
[regression tests](../src/evidence-selection/projection-resolver.test.ts).

### What can actually enter through each surface?

The executor's [capture catalog](../../../apps/verification-executor/src/capture.ts) declares
**17 media types**. Markdown, plain text and JSON decode locally; HTML uses a simple
tag-removal conversion. CSV, PDF, Word, OpenDocument, RTF, Excel, PowerPoint and EPUB route
through the configured Firecrawl document parser. Document capture stores original bytes and
the selected text representation. Quotes are bound to the derived text, not native page/cell
coordinates. Local text decoding is permissive UTF-8; it is not an encoding-forensics tool.

Raw PNG/JPEG/audio/video are not supported by `capture-file`. Do not mislabel their bytes as
text or silently substitute agent-authored OCR/transcripts. A transcript captured as text
supports statements about that transcript; it does not independently verify the original media.

The platform capture use case is narrower still: the
[application admission rule](../../../packages/application/src/verification/operations/verification-service.ts)
admits HTML DOM for web pages and acquired PDFs with ordered PDF-text + geometry projections,
subject to host catalogs and grants. The
[native parser](../../../services/verification-parser/README.md) is distinct from the executor's
Firecrawl conversion and from Docling. A selector type in the contract is not proof that a
public acquisition route for that type is admitted or deployed.

## Deterministic verification diversity

| Capability | What is established | Limits |
|---|---|---|
| Capture and provenance | Registered artifact digest/length, capture identities, representation binding, expected selection digest | Immutable storage is not proof of source truth or acquisition completeness |
| Assertion mechanics | Unique IDs, exact evidence resolution, declared atomicity, runtime producer/verifier separation | Caller-supplied atomicity and authority vectors are not independently established facts |
| Bounded schema | Admitted schema subset; candidate types, required fields, null/absent distinction, collection/string bounds | Not unrestricted JSON Schema and not semantic accuracy |
| Field comparisons | 11 kinds below; evidence re-resolved from immutable bytes for every leaf | No judge confidence substitutes for a failed match |
| Cross-field arithmetic | Exact rational-decimal identity, sum, difference, product, ratio and percent change; explicit tolerances and rounding | Internal package/metric surfaces; executor extraction intents do not expose totals/duplicate rules |
| Duplicate records | Declared array key paths checked for repeated records | Keys must be supplied; not fuzzy entity resolution |
| Structured selected values | Explicit table-cell, geometry-token or transcript-text scalar extraction | Must choose supported source component and joining rule; executor intents remain text-only |
| Reports | Declared citation completeness/weights, pointer failures, misplaced citations, omitted qualifiers, duplicates/conflicts, consistency groups, high-severity support | Measures producer-declared assertions, not discovery of uncited facts. Executor report check uses first evidence edge per cited claim |
| Authority | Directness, applicability, freshness, independence and source-family assessment | One qualifying independent family can satisfy corroboration; not a quorum or proof of world correctness |
| Audit/replay | Manifest/payload lineage, digest binding, replay drift, optional Ed25519 signatures and DSSE/SLSA attestations | Unsigned integrity differs from signature authority; a valid seal is not admission |

The **11 field comparisons** are exact, normalized text, decimal, percentage, currency, unit,
date, datetime, enum, identifier and checksum. Currency uses explicit `CODE decimal` strings
and allowed codes, not locale or currency-symbol inference. Unit checks compare allowed tokens;
they do not convert kilograms to pounds. Dates are strict calendar dates; datetimes require a
timezone. Identifier checks support UUID, SHA-256, CVE and three-letter currency-code syntax;
checksum checks support Luhn and ISBN-13. They do not verify that an identifier was actually issued.

This review wires the existing rule options into executor intents: `allowedValues`,
`normalizationId`, `minimum`, `maximum`, `identifierKind`, `checksum` and top-level
`normalizations`. Missing/inapplicable options still fail closed. Older executors may silently
strip unknown options; deploy a matching build before teaching agents these fields.

Evidence: [field verifier](../src/extraction/verification.ts),
[field tests](../src/extraction/extraction.test.ts), [decimal engine](../src/deterministic/decimal.ts),
[report algorithms](../src/claims/report.ts), [authority](../src/authority/assessment.ts),
[audit](../src/provenance/seal.ts), [replay](../src/provenance/replay.ts),
[attestations](../src/provenance/attestation.ts).

## Providers, recovery and semantic scope

Semantic authorization, evidence-only judging, source-attribution checks, bounded rescue,
cross-family judging and policy exist. The examples intentionally do not call a semantic
provider. No prompt, model selection, calibration, semantic algorithm or quality threshold
is optimized here. Mechanical failure cannot be reversed by a semantic result.

Executor acquisition currently calls Firecrawl `/v1/scrape` and `/v2/parse` directly, with
request timeouts. Automatic PDF capture catches any direct-download/parser error and tries
scraping; this broad fallback can omit original document bytes. It does not establish equivalent
native PDF geometry. Other scrape failures do not have an automatic retry chain. HTTPS fetching
does not impose a streaming byte cap before buffering the body; parse upload checks 50 MB after
download. These are observed limitations, not a newly approved provider policy.

Semantic provider adapters have their own bounds, deadlines, cancellation, admission and
request/response persistence. Neither the new fixture run nor existing fixture tests prove
current live provider behavior. No provider adapter was changed; live calls were not made.

For production, unresolved evidence should remain held and flow through the host's durable
recovery/adjudication mechanism. A standalone executor can run without that host; a synthetic
example's local quote correction is not authorization to bypass production recovery custody.

## Assessment and next decisions

**Strongest coverage:** immutable text evidence, native structured locators, schema/field
mechanics, exact arithmetic and retained audit artifacts. **Partial end-to-end coverage:**
many media can become text, but agents cannot express every library selector in executor
intents. **Missing in these surfaces:** admitted arbitrary raw image/audio/video acquisition,
OCR/transcription/frame interpretation with retained locator lineage, and comprehensive
independent discovery of report assertions.

The “whatever format” requirement is therefore **partial**, not universal. Supporting the
remaining media requires explicit parser/representation admission and an agent-facing locator
contract, with retained source lineage. Merely accepting a new MIME type would not meet it.
Those are product/interface decisions for subsequent work, not semantic tuning. No human labels,
source rights, provider approvals or quality-benchmark evidence were fabricated to close them.
