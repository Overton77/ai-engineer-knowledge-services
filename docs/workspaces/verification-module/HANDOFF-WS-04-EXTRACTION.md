# WS-04 extraction schema and deterministic field verification handoff

**State:** ready for coordinator review; this is a bounded extraction slice and does not complete WS-04.  
**Implementation owner:** verification-extraction-agent  
**Date:** 2026-09-05

## Delivered boundary

`packages/verification/src/extraction/` is a pure, provider-free admission and verification layer exposed from the narrow package facade. `admitExtractionSchema` performs bounded aggregate JSON preflight before canonicalization, then compiles its private executable tree from an immutable canonical snapshot. It accepts only a bounded, declared JSON Schema subset: object roots, bounded arrays and strings, primitive scalars, `enum`/`const`, finite numeric bounds, explicit `required`, explicit boolean `additionalProperties`, explicit scalar nullability, and non-empty descriptions on every schema node. It rejects every unimplemented keyword, all `$ref` forms (including remote refs), pattern/content/executable extensions, recursion, unbounded strings/arrays, noncanonical JSON, oversized schemas, and property/enum/depth limits. It returns the schema ID/version, canonical schema SHA-256 digest, and gate version. Normalization policies deliberately are not schema keywords.

`validateExtractionCandidate` independently validates candidate shape and limits with strict absent-versus-null and additional-property handling. Its admitted execution tree is private to the module; the returned schema is an immutable canonical JSON snapshot, so later mutation of caller schema JSON cannot alter validation. Candidate canonicalization/byte failures return before traversal, and open additional-property traversal has independent depth/node bounds. `verifyExtractionFields` then requires one rule and one evidence edge for every candidate leaf. It replays the selector from the supplied capture-bound representation bytes after digest verification, requires one resolved occurrence and a replayed selected-content digest, and ignores any provider status or confidence field. A failed, ambiguous, unbound, changed, non-scalar, or geometry-metadata-only selection is a deterministic failure. Registration, authorization, hydration, tenant relations, and parser lineage remain WS-03/composition responsibilities; this function verifies the bytes it receives again and does not make caller evidence-success flags authoritative.

An admitted schema is process-local by design. A schema deserialized from persistence or transport is not an admission handle and fails closed; the composition layer must re-admit its immutable `canonicalSchema` with the declared ID/version before dispatch or validation. Runtime limits may only tighten fixed module caps. Before canonicalizing output, candidate preflight rejects non-JSON values, aliases/cycles, excessive containers/nodes/depth, and conservatively oversized strings. Field verification caps aggregate representation bytes and the sum of bytes scanned across repeated evidence resolutions, preventing a large number of selectors from repeatedly parsing the same projection without bound.

Supported comparisons are exact and explicitly declared normalized text, canonical bounded decimal/percentage, `ISO_CODE decimal` currency with caller-declared allowed codes, caller-declared unit/enum tokens, strict Gregorian dates, RFC 3339 datetimes with explicit timezone, UUID/SHA-256/CVE/currency-code-token identifiers, Luhn/ISBN-13 checksums, decimal ranges, unique record-key tuples, and exact-decimal total/derivation replay using the existing deterministic decimal core. `currency_code_token` means only syntactic uppercase three-letter validation; it is not a registry lookup. Field rules can also explicitly extract `table_cell_value`, `geometry_token_text`, or `transcript_text`: the component must match its selector kind, and multiple tokens/segments require a declared `space` or `none` joiner. Coordinates, requested bounding boxes, table/header metadata, and media intervals are never candidate values. Decimal bounds are rejected for other comparisons, total operations/cardinality are validated before replay, and tolerance cannot be negative. Locales, currency symbols, unit inference, arbitrary regexes, ambiguous dates, timestamps without timezones, and unsupported evidence abstain/fail closed.

The facade now also exports `selectors/index.ts`, as requested by the coordinator. No selector, provenance, persistence, provider, network, or parser implementation was changed by this slice.

## Adversarial proof

`src/extraction/extraction.test.ts` has eleven synthetic, clearly self-authored tests for:

- canonical schema digest; remote refs, dangerous regex keyword, and unbounded schema rejection;
- missing vs null vs forbidden additional fields, plus open additional-property leaves still requiring field evidence;
- immutable admission snapshots, type-inapplicable keyword rejection, object property bounds, Unicode code-point string lengths, cyclic output early rejection, and bounded unknown-property traversal;
- wrong adjacent JSON cell despite a forged caller `status: "resolved"` flag;
- exact `0.1 + 0.2 = 0.3` replay and an incorrect total failure;
- ambiguous text evidence and impossible calendar date failure;
- strict currency/unit/date-time/identifier/Luhn/range behavior; and
- duplicate record-key rejection while every record leaf has evidence.
- positive table/header, geometry token versus query-box width, and transcript source text versus interval metadata cases.
- comparison-inapplicable option rejection and bounded pointer, duplicate-key, and total-operand work before replay.

Executed from `C:\Users\Pinda\Proyectos\aiengineer\ai-engineer-knowledge-services`:

```text
corepack pnpm --filter @aiengineer/knowledge-verification exec vitest run src/extraction/extraction.test.ts
```

Result: exit 0; 1 file, 11 tests passed. Log: `C:\Users\Pinda\Proyectos\aiengineer\internal\ws-04-extraction-targeted-test-20260905.log`; SHA-256 `65dae7ad15d65c745b04b582c2e37bae546f5719c8c4aa4533c946b6b31c3311`.

```text
corepack pnpm --filter @aiengineer/knowledge-verification typecheck
```

Result: exit 0. Log: `C:\Users\Pinda\Proyectos\aiengineer\internal\ws-04-extraction-typecheck-20260905.log`; SHA-256 `fd81c9b1373462ba71d872ee46355c165ac305fd2301cf2db9e559611e2a3cfa`.

The final full package suite passed 4 files / 39 tests. Log: `C:\Users\Pinda\Proyectos\aiengineer\internal\ws-04-extraction-package-test-20260905.log`; SHA-256 `fd754483400345db2ebabc65561787acbaa8e8b094e495360242ea5392760d84`.

## Source hashes

- `schema.ts`: `fb45c6ed9b6cede099a4d34228986b005bef17a36496a9c5682b86cb694f3913`
- `verification.ts`: `e16d1d41b5b46ee0b1e28ebbedb4b3ca1ed9857b8883ee687a9995719f3731eb`
- `index.ts`: `4f3924d9c09211bb612f415fad9a76be547676317fd6dbee8a55d3e9960d4f85`
- `extraction.test.ts`: `f9ac7fd20cfba6e7b1e0200978ff19b7a738044749ad76bee1da9b75dccc00cd`
- facade `src/index.ts`: `3a9cf455d24638543e59f6d75f1443b5fb0e916d3f8fce2cd398967587dc480b`

## Review limits and next action

This is not evidence that a provider is called only after admission, that real parser output is persistently registered, or that real captures are semantically correct. A later composition owner must bind admitted schema/candidate artifacts and parser projections through the WS-03 trusted resolver, invoke this admission before WS-06 provider dispatch, and run an integrated real-capture field proof. Structured selector metadata remains unsupported by default; only the explicitly declared table cell, ordered geometry-token text, and ordered transcript-text components are admitted as scalar evidence.
