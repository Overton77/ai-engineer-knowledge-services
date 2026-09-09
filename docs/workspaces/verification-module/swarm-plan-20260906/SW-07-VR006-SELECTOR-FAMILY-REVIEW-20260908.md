# VR-006 selector-family closure review

Receipt: [verification-vr006-selector-family-audit-c43dd6b5-d3b2-494b-9d15-bc8ac6295119.json](../../../../../../../internal/verification-vr006-selector-family-audit-c43dd6b5-d3b2-494b-9d15-bc8ac6295119.json), SHA-256 `eeb5dac31ef7c1b719439c35e840feddffef48a68b14ab8248b9416fbafc4fc0`.

VR-006 requires the admitted selector families, not a new capture cohort or a claim about every extracted leaf. The audited matrix scope has nine families: text, JSON, HTML, PDF, image, table, media, repository, and dataset records. The contracts expose 12 selector kinds because text and dataset records each have several precise forms.

| Family | Admitted kinds | Positive control | Boundary control |
| --- | --- | --- | --- |
| Text | text quote, character position, multi-fragment text | canonical text selection | ambiguity, drift, invalid ellipsis |
| JSON | JSON Pointer | RFC 6901 resolution | malformed escaping |
| HTML | HTML | agreeing CSS/XPath/DOM target | fallback disagreement, hidden/script/duplicate target |
| PDF | PDF text | physical-page text-layer selection | page/hash/range/surrogate mismatch |
| Image | bounding box | pixel-coordinate geometry selection | dimension mismatch/out-of-box rejection |
| Table | table cell | coordinate/header binding | adjacent, overlap, budget rejection |
| Media | media timecode | half-open transcript window | speaker/channel ambiguity, reversed segments |
| Repository | repository range | commit/path/line binding | unsafe path and invalid range |
| Dataset records | dataset, API record | version/key and page/record binding | version/key/record ambiguity and missing field |

The prior missing image positive was added to the real `ProjectionSelectorResolver` suite. It selects a pixel-coordinate token only when the selector binds the projection image dimensions; changed dimensions reject. This exercises the actual pixel branch rather than only contract validation.

Focused evidence passed: contracts 11/11 and verification 26/26. The retained native capture replay binds 22 read-only CAS reads and 14 projection artifacts, with zero provider calls and writes.

**Recommendation:** record VR-006 proved for its exact selector-family row. VR-007's full accepted-leaf lineage/gold audit remains separate.
