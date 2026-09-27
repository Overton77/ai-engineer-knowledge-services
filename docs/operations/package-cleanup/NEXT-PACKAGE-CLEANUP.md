# Continue package cleanup after Jev integration

Status: reference. Execution handoff, 2026-09-27.

## Starting point

Work in `C:/Users/Pinda/Proyectos/aiengineer/ai-engineer-knowledge-services`, branch `refactor/knowledge-services-final-layout`. Merge `e9829a8` combines Jev checkpoint `dbe0c4b` with cleanup baseline branch through `38ff40d`. Inspect the current HEAD and status; continue from its descendant, never reset to these historical SHAs. The isolated `ks-package-cleanup` checkout is now a historical reference.

Read repository AGENTS.md, [coordinator instructions](./COORDINATOR-INSTRUCTIONS.md), [final layout](./FINAL-LAYOUT.md), [progress](./workspace/PROGRESS.md), and [Unit 1](./UNIT-1-PACKAGE-MERGES.md). This handoff updates their starting state and gives the narrow baseline exception below. Their other scope and preservation rules remain in force.

## Execute Unit 1

Complete the four mechanical merges in this order: **knowledge-db, retrieval, preparation, core**. Follow Unit 1's exact layouts, manifests, consumer updates, example moves, export preservation and documentation rules. Commit each validated group. Do not reopen the architecture survey or start later behavior changes. Maximum four agents total, including the coordinator; reuse workers, keep ownership disjoint, and run full validation sequentially.

Before moving files, capture compiler-resolved exports, test identities and the declared dependency graph from this merged checkout. Existing `*.pending.json` captures describe the earlier isolated checkout and are historical evidence, not the combined Jev baseline. Record HEAD, status and environment alongside fresh evidence. Compare identities and exports after each group, accounting explicitly for path/package renames.

The next unit ends with all four groups integrated, imports and live documentation updated, examples resolving, no lost tests/exports, and validation compared with the merged baseline. Then write a bounded Unit 2 host-composition specification and update the ledger. Do not claim Units 2–7, skill consolidation, Eve adaptation or pre–Mission Control evaluation are complete.

## One known baseline exception

Proceed with mechanical Unit 1 while retaining the existing failure in `packages/application/src/verification/benchmark/verification-benchmark-registered-replay.test.ts`: `SEALED_CHECKPOINT_MISSING:records/25-gl-repeatability-mutated-haiku_judge-failure.json`. The original historical judge-failure receipt and its manifest entry are unavailable. The precise lookup history is in the ledger.

This is a coordinator continuation decision to enable the developer's requested forward progress, not a claim that Unit 0 or the full suite is green. It supersedes the earlier green-only prerequisite **only for this exact missing-input failure during Unit 1**. Keep the test running and report its failure. Do not skip/delete/weaken assertions, generate a substitute receipt, reseal historical evidence, or accept additional failures under this exception. If the original receipt becomes available, restore it with provenance and rerun the affected checks. Unexpected failures must be resolved before accepting a merge group.

Frozen install, typecheck, build, example checks, skill conformance, generated documentation checks, package/export comparisons and installed sandbox smoke must pass. Run the entire test graph with bounded concurrency and record every failure and skip; expected integration skips remain visible. A clean test result is still required for an unconditional baseline or release claim. Reassess this exception explicitly before later behavior-changing units.

## Jev is implemented and must be preserved

See [Jev architecture](../../architecture/modules/jev.md) and [validation](../../jev/VALIDATION.md). Preserve `packages/jev`, `apps/jev`, the `contracts/jev`, `application/jev` and `client-typescript/jev` entrypoints, `KnowledgeClient.jev`, the Jev CLI, six MCP tools, registered skill and its references. Keep real child-worker files available beside the compiled Jev runtime; a single-file bundle can break its worker launch. Preserve queue ownership, cancellation/retry and authentication semantics. Existing `.jev/` state is local operator data; do not delete it or run paid experiments as cleanup checks.

The merged starting inventory is 24 packages and 6 apps. Unit 1 removes nine package boundaries, producing 15 packages and retaining 6 apps. The old final-layout counts predate Jev; they are not permission to discard its package or host. Specify Jev's eventual host/CLI/MCP consolidation when writing the relevant later unit, including lifecycle and worker packaging. The final eight-skill target already includes `jev-system-one`.

There are no live production consumers requiring legacy adapters. Adapt Eve directly in its designated later units. Preserve stored evidence and the populated shared database; use isolated disposable infrastructure for any genuine integration checks. Offline verification never requires loading an operator `.env` or calling a paid provider.

## Suggested next-session instruction

> Continue the Knowledge Services package cleanup from the merged `refactor/knowledge-services-final-layout` branch. Read `docs/operations/package-cleanup/NEXT-PACKAGE-CLEANUP.md` and complete Unit 1's four mechanical package merges, with at most four agents total. Preserve the implemented Jev service and integration, capture fresh before/after evidence, keep the one documented missing historical fixture failure visible, and fix all new regressions. Update generated agent navigation and the progress ledger, commit the completed groups, then leave a concrete Unit 2 specification. Do not stop at another plan.
