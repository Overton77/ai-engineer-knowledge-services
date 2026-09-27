# Package cleanup delivery and continuation

Status: reference. Execution handoff, 2026-09-27.

## Current delivery

Unit 1 is merged into local `main` from `refactor/ks-unit-1-package-merges` at `85066f0`. Source checkpoints: knowledge-db `6e81658`, retrieval `3bceceb`, preparation `4aa5d38`, core `2ba7111`. Final combined validation and local integration are recorded in the [ledger](./workspace/PROGRESS.md). The bounded [Unit 2 specification](./UNIT-2-HOST-COMPOSITION.md) is prepared; its implementation is not part of this delivery.

The instructions below are the retained Unit 1 execution brief. Do not replay completed moves. For subsequent work, start from integrated main, read the Unit 2 specification and ledger, reassess the missing historical fixture exception, then use a separate Unit 2 branch.

## Unit 1 starting point

Work in `C:/Users/Pinda/Proyectos/aiengineer/ai-engineer-knowledge-services`. The combined baseline is integrated into local `main` under the developer's explicit instruction. Verify that `main` contains `81556ad` and this handoff, then create `refactor/ks-unit-1-package-merges` from its current tip. If that unit branch already exists, inspect its ancestry and ledger and resume it without resetting or discarding work. Merge `e9829a8` combines Jev checkpoint `dbe0c4b` with cleanup baseline branch through `38ff40d`; these SHAs identify history, not reset targets. The isolated `ks-package-cleanup` checkout and completed final-layout branch are historical references.

Read repository AGENTS.md, [coordinator instructions](./COORDINATOR-INSTRUCTIONS.md), [final layout](./FINAL-LAYOUT.md), [progress](./workspace/PROGRESS.md), and [Unit 1](./UNIT-1-PACKAGE-MERGES.md). This handoff updates their starting state and gives the narrow baseline exception below. Their other scope and preservation rules remain in force.

## Branch and delivery rule — developer accepted

Use **one branch per cleanup unit, with as many cohesive commits as needed**. Branch from the integrated local `main`; do not stack unfinished unit branches or implement cleanup directly on `main`. Keep Unit 1's four package groups on the same unit branch, committing each validated group separately. Do not squash away useful checkpoints merely to make one commit per unit.

After completing a unit, inspect its diff and acceptance evidence, resolve new regressions, update the ledger and next-unit specification, and merge the validated unit into local `main` with a merge commit. This local unit-integration workflow is authorized; no routine approval round is required. Create the following unit branch from that updated `main`. Remote publication and deployments are separate actions, not implied by these local merges.

Move quickly through bounded implementation and relevant checks. Preserve functionality throughout; deliberate enhancements belong in the specified behavior-changing units with tests and consumer/skill updates. Unit 1 stays mechanical. The overall goal remains organized packages and apps, redesigned skills, direct Eve adaptation, and the actual pre–Mission Control evaluation. Documentation and passing smoke tests alone do not complete that goal.

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

> Continue the Knowledge Services package cleanup from local main. Read `docs/operations/package-cleanup/NEXT-PACKAGE-CLEANUP.md`, create or safely resume `refactor/ks-unit-1-package-merges`, and complete Unit 1's four mechanical package merges with at most four agents total. One unit per branch; multiple cohesive commits are expected. Preserve Jev and all existing functionality, capture fresh before/after evidence, keep the one documented missing historical fixture failure visible, and fix all new regressions. Update generated agent navigation and the progress ledger, prepare the concrete Unit 2 specification, then merge the validated Unit 1 branch into local main. Move quickly through implementation and verification; do not stop at another plan. The full cleanup still includes the later app organization, redesigned skills, Eve adaptation and pre–Mission Control evaluation.
