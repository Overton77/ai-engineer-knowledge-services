# Independent selector review

Coordinator, 2026-09-05. Selector-only implementation accepted after coordinator review and independent package/probe runs. Production parser admission and extraction remain separate work.

| ID | Finding | Required regression | State |
| --- | --- | --- | --- |
| SR-01 | No global byte/depth/node/item bounds; table spans can expand into an enormous loop. | Tiny huge-span input, deep JSON, excessive array/node input fail within a bounded budget. | Fixed and reviewed |
| SR-02 | HTML selection can reach hidden nodes and descendants of hidden ancestors, including script/style text. | Hidden ancestor and executable/style subtree cannot produce visible evidence. | Fixed and reviewed |
| SR-03 | Separate node text plus children loses mixed-content order. | `A<b>B</b>C` yields source order through an explicitly supported lossless representation. | Fixed and reviewed |
| SR-04 | HTML fallback implements different normalization and prefix/suffix semantics from the core. | Same quote/context/normalization has consistent resolution; unsupported modes fail explicitly. | Fixed and reviewed |
| SR-05 | UTF-16 PDF ranges can split surrogate pairs, yielding replacement bytes rather than source text. | Split-pair bounds rejected; complete astral character ranges reproduce exact bytes. | Fixed and reviewed |
| SR-06 | Transcript output trusts array order and allows overlapping same-speaker segments. | Reversed chronology, overlapping segments and partial-window ambiguity cannot silently resolve. | Fixed and reviewed |
| SR-07 | Nested projection unknown fields are silently dropped; residual page bounds are unchecked. | Strict nested fields and in-range residual references. | Fixed and reviewed |

The admitted resolver's selected content must distinguish source values from locator metadata. Geometry box coordinates and requested media intervals do not themselves establish a factual value reported by the source. Downstream field and semantic checks must retain that distinction.

## Final adversarial review

Coordinator found and reviewed additional regressions for hidden-ancestor DOM paths, empty normalized fallback quotes (an infinite-loop risk), pre-expansion aggregate table budgets, and unsafe integer coordinate ends. The six-check independent HTML probe passes, as does the full verification package suite (29/29). Mixed content uses ordered #text nodes; ID attributes are represented only by the explicit node.id property. Supported CSS/XPath is deliberately bounded. This acceptance covers pure capture-byte-bound selectors, not authenticity of an application-supplied projection or parser output.
