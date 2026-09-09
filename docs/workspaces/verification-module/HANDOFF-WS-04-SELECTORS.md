# WS-04 selector-only handoff

**State:** ready for coordinator review; this is not completion of WS-04.

## Delivered boundary

`packages/verification/src/selectors/` supplies `ProjectionSelectorResolver`, a pure implementation of the existing `DeterministicSelectorResolver` port for the eight non-text/JSON selector families:

- HTML DOM: bounded `#id`, tag, attribute-equality CSS; bounded `//tag[@attribute='value']` XPath; numeric DOM paths; all supplied locators must identify the same unique visible node. Hidden, script, and style subtrees are excluded. Element nodes reject mixed direct text-plus-child content; ordered `#text` leaves retain mixed inline text and source whitespace exactly. The text fallback is an integrity assertion after DOM resolution, requires canonical projection text, preserves prefix/suffix outside-quote semantics, and cannot become a selection route.
- PDF native text: physical one-based page numbers, exact per-page text-layer digest, declared UTF-8/UTF-16/code-point offsets, and preserved visual residuals.
- Bounding boxes: normalized, pixel, and PDF-point token geometry; PDF points convert to normalized dimensions before the explicit contained-token policy is applied.
- Tables: unique table IDs, unambiguous coordinates, header paths, cell expectations, and non-overlapping merged-cell geometry.
- Media: fully contained, ordered, non-overlapping transcript segments within a half-open interval. The resolver does not invent word timings; unspecified speaker/channel dimensions that produce multiple values abstain as ambiguous.
- Repository: full SHA-1/SHA-256 commit binding, safe POSIX paths, zero-based half-open lines, UTF-8 byte-boundary validation, and no filesystem lookup.
- Dataset/API: version and key binding, duplicate rejection, null-versus-absent behavior, canonical JSON-pointer navigation, API version/query/page lineage, and explicit page disambiguation.

Every projection is canonical JSON, schema-validated, bounded to 1 MB/10,000 items/100,000 characters, and bound to `representationDigest` before selection. Table spans are capped and their aggregate expanded-cell budget is capped at 100,000 across the entire projection before any overlap expansion; unsafe exclusive row/column ends are rejected before iteration. Successful outputs carry one occurrence, an exact selected-content digest, resolved ranges/coordinates, and resolver version `verification-projections.v1`. The `ProjectionAdmissionContext` type documents the separate required parent artifact digest, transformation signature, and parser version. This selector-only code does **not** claim raw parsing, parser sandboxing, projection admission, or parent-lineage authentication; core capture/projection checks and a later WS-04 parser workstream own those proofs.

The package facade was intentionally not edited. Coordinator should review and then wire `src/selectors/index.ts` into the facade or composition root that admits this resolver.

## Tests

Synthetic fixtures in `resolvers.test.ts` are clearly self-authored. They cover the eight families plus core-port admission and adversarial cases: duplicate DOM/API matches, hidden-script exclusion and hidden-ancestor DOM paths, strict duplicate-ID representation rejection, whitespace-only fallback rejection, lossless `A<b>B</b>C` and whitespace-preserving ordered text leaves, rejected ambiguous direct mixed DOM content, noncanonical and digest-changed projections, mismatched PDF page/text-layer digest and UTF-16 surrogate splits, graph residual retention, PDF point conversion, wrong geometry dimensions, table header/adjacent/empty cells, single-span, many-medium-span, cross-table, and safe-integer-overflow bombs, transcript boundaries/speaker ambiguity/reversed overlap, unsafe paths and UTF-8 byte splitting, dataset version/key/absent fields, and pagination ambiguity.

Executed from `C:\Users\Pinda\Proyectos\aiengineer\ai-engineer-knowledge-services`:

```text
corepack pnpm --filter @aiengineer/knowledge-verification exec vitest run src/selectors/resolvers.test.ts
```

Result: exit 0; 1 file, 9 tests passed. Log: `C:\Users\Pinda\Proyectos\aiengineer\internal\ws-04-selectors-targeted-test-r3.log`; SHA-256 `fba213ab7f3823accc750f83b96d30d2ef56c3917921a46bf5995f84c49e19aa`.

```text
corepack pnpm --filter @aiengineer/knowledge-verification typecheck
```

Result: exit 0. Log: `C:\Users\Pinda\Proyectos\aiengineer\internal\ws-04-selectors-typecheck-r3.log`; SHA-256 `fd81c9b1373462ba71d872ee46355c165ac305fd2301cf2db9e559611e2a3cfa`.

## Source hashes

- `projections.ts`: `5ad52548b578633cdfcf5e3037c7de910c374c4bc3fc543e01639bbb5ab99b29`
- `resolvers.ts`: `c561c4a8f76cc403a6a12e4cc0f61200d3fd45abd85f0adc09209f602d48264a`
- `index.ts`: `cdb521ea9ba5e8e38bd5df120f265fa76a33d5dcc716e97af9cda47db0d4d28c`
- `resolvers.test.ts`: `8ffda7df0060194d528a8830b5c2b0f968527cfa901d716041738de4f2b56f16`

## Limitations for review

- CSS/XPath support is intentionally narrow and unsupported syntax fails closed.
- Projection bytes must already be an admitted, registered representation; caller JSON is not trusted as raw HTML/PDF/media/repository input.
- The restricted TruAge PDF and corporate captures were not copied into this repository. The synthetic PDF fixture represents the documented page-2 native-text residual only; a later, controlled integration test may hydrate the restricted full projection through production ports.
