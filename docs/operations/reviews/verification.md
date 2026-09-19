# Verification package review

Status: **Reference — reviewed 2026-09-16; see validation and limitations below.**

## Scope and baseline

Reviewed `packages/verification` at repository HEAD
`08703d3fdaa887286473b54a6612b1963f1a5789`, with the existing working tree retained.
The developer explicitly requested this module and verification-executor review, examples,
clean code and skill updates, with emphasis on assertions, locators and diverse media.
Semantic optimization is deferred by the developer. No general sprint-completion evidence
was supplied; this review does not certify that sprint or the entire Knowledge Services inventory.

There were existing conversion, ingestion-test relocation, worker, skill and module-manifest
edits. They were not reset or folded into a commit. This is an in-place, reviewable local change;
no branch synchronization, PR, merge, deployment or repository-wide delivery-control rollout
is claimed. The older seven-phase clean-code recommendation remains a separate broad plan;
this review does not certify all of its phases complete.

The package owns algorithms. Application composition owns admitted service use cases;
external consumers use HTTP/client/CLI/MCP. The companion
[executor review](verification-executor.md) covers agent intents and local execution.

## Developer requirements and evidence

| ID | Observable acceptance | Assessment / evidence |
|---|---|---|
| VER-REVIEW-01 | Explain assertion versus verification and the extent/diversity of capabilities from implementation | Present: [library capability matrix](../../../packages/verification/CAPABILITIES.md) and [acquisition capabilities](../../../apps/verification-executor/examples/CAPABILITIES-ACQUISITION.md) trace 14 claim types, 12 selectors, 11 field comparisons, report/authority/audit behavior and limitations |
| VER-REVIEW-02 | Show how agents locate evidence across media; do not call a schema or projection type an end-to-end capability | Partial product capability, fully documented: native projection examples exist, but admitted arbitrary raw image/audio/video routes and executor native selector intents do not |
| VER-REVIEW-03 | Clean code without weakening evidence integrity | Shared internal offset conversion replaces duplicate algorithms; reported coordinates, surrogate boundaries and BOM behavior corrected with regression tests |
| VER-REVIEW-04 | Runnable default examples show success and meaningful failure without paid calls | Present: 12 real selector paths and ambiguous-quote/context recovery; synthetic projections explicitly labelled |
| VER-REVIEW-05 | Update skills and generated navigation with usable distributed examples | Present: canonical platform skill 1.2.0, executor skill 1.1.0, references/template, full-content digest checks and research-consumer regeneration |
| VER-REVIEW-06 | Leave semantic optimization for later | Preserved: no semantic model, prompt, algorithm or threshold change |

## Code review and intentional changes

- G5/G33/F1: `src/text-offsets.ts` centralizes code-point-aligned slicing behind a two-argument
  internal function shared by built-in positions, PDF, DOM and repository ranges.
- G26: built-in character positions now retain the requested coordinate basis in reported ranges
  instead of labelling converted UTF-16 indexes as byte/code-point indexes.
- G3: invalid/empty/noninteger ranges and surrogate-splitting ranges fail closed consistently.
  UTF-8 slice decoding preserves U+FEFF as text rather than dropping it as a stream BOM.
- Public exports and serialized contracts are unchanged. Corrected coordinate results can differ
  from historical retained results for affected Unicode inputs; replay should expose that drift,
  not silently rewrite old bundles. No golden digest was refreshed.

No broad API migration is needed. Existing semantic authorization, prototype compatibility,
audit signing, provider policy and decomposition/report product semantics are retained.
Remaining readability debt includes long orchestration functions, wildcard package exports,
and permissive internal projection-validation typing; this focused review is not a claim that
every item in the previous refactor plan has disappeared.

## Validation

See the companion executor review for the shared validation matrix, packaging and consumer
checks. Package examples are included in typechecking and Vitest. Root `pnpm verify` now also
runs both verification example commands after build so executor CLI drift fails visibly.

## Product gaps and decisions still needed

The developer's universal-media aspiration is not yet fully implemented. Native locator
exposure through executor intents, admitted OCR/transcription/frame representations,
and representation-preserving acquisition fallbacks need explicit interface and parser work.
No fallback should turn missing chart/audio/video evidence into a text-based pass. These are
reported gaps, not newly implemented capabilities or silently waived acceptance criteria.
Human-gold calibration, source-rights decisions, vendor approval and semantic quality evidence
remain as documented in the dated verification acceptance guide.
