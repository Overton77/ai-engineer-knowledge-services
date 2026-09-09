# VR041 deterministic mutation family gap — 2026-09-08

Current `verification-diagnostics-mutation-report.ts` reports seven required family labels, but the frozen pilot-v3 transforms map only algorithms, counts, and qualifiers. EV131 therefore correctly records names, biomarkers, institutions, and citations as missing. `sample_type_swap` and `study_design_swap` have no verified semantic basis for biomarker/institution mapping and remain unmapped.

A report mapping cannot create actual family behavior. The smallest honest completion candidate is a new, explicitly engineering-only derived fixture version bound to existing frozen source handles, with deterministic pointer/field mutations and no human-gold or semantic-quality claim. It must be composed through the existing offline pipeline; no frozen-v1 or locked gold will be changed.

## Engineering-only runner — 2026-09-08

Added `packages/application/src/verification-diagnostics-engineering-mutations.ts`, which wraps the existing admitted-projection adversarial verifier. Every requested mutation supplies a family, original literal, replacement, and exact admitted projection. A record is `verified` only if the original literal appears in the selected frozen projection bytes; otherwise it is explicitly `unavailable`. It records selector/digest/field mechanics without semantic or human-label claims. Added a focused test and new engineering-only catalog README. Application typecheck passed. The focused Vitest process began but did not produce a terminal summary within its command window; no passing test claim is made.

## Generated report semantic tests — 2026-09-08

Added `verification-diagnostics-generated-report-semantics.test.ts` only. It proves fabricated/cloned prepared values are rejected before dispatch callbacks and duplicate replay entries are rejected before resolver creation. The focused command was invoked with maxWorkers=1 but the package Vitest configuration collected unrelated tests; two unrelated retained-local tests timed out at five seconds, so this is not a clean suite pass. The new test’s individual completion was not independently available from that aggregate output.
