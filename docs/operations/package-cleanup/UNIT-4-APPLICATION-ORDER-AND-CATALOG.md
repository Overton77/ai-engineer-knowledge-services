# Unit 4 specification: application order, naming pass and catalog parity

Status: proposed execution specification, prepared at the end of Unit 3 on 2026-09-27. Begin only from the locally integrated Unit 3 main. Parent: [FINAL-LAYOUT.md](./FINAL-LAYOUT.md), unit 4 (§2, §3, §4.5). Previous unit: [UNIT-3-APPLICATION-AND-MCP.md](./UNIT-3-APPLICATION-AND-MCP.md). Progress: [workspace/PROGRESS.md](./workspace/PROGRESS.md).

## Scope and entry gate

Create `refactor/ks-unit-4-application-order-and-catalog` from integrated main, or inspect and safely resume it. This unit changes structure and names, not behavior: routes, tool names, CLI commands, schemas, authority outcomes and persisted identity strings stay as they are. It adds one parity test over the operation catalog.

Before editing, rerun the registered-replay test (`packages/application/src/verification/benchmark/verification-benchmark-registered-replay.test.ts`) and record the missing historical judge receipt outcome. The exception does not carry forward automatically; make and record an explicit continuation decision. No new failure, substitute receipt or weakened assertion is permitted.

Out of scope: executor fold, `local` host profile, CLI/MCP stdio, Eve adaptation and Jev transport consolidation (Unit 5); skills (Unit 6); `scripts/` → `proofs/` and proof typechecking (Unit 7); worker activity extraction; persistence type-only application imports (application order phase 5). Do not build the pre–Mission Control experiment runner here.

## Work items

1. **Application folders by tool group** ([application order](../internal-fallbacks-and-application-order.md#application-order) phases 1–4). Group `packages/application/src` into `operations/`, `knowledge/` (preparation, source discovery, promotion selection, checkpoints, retrieval, `reads/knowledge-resource-reads.ts`), `verification/` (with `reads/verification-resource-reads.ts`) and `db/` where a use case exists; keep `access/` and `reads/resource-read-result.ts` shared. Folder moves keep every exported name from `index.ts` (zero consumer edits in the move commit). Then delete stale `.d.ts` beside live `.ts`, split `verification-benchmark.ts` so product benchmark stops importing diagnostics, and quarantine `diagnostics/` on the barrel without dropping export names.
2. **A2A adapter into `apps/api`.** Move the A2A task mapping (`operationKindForA2ATask`, `operationInputForA2ATask`, `operationEnvelopeForA2ATask`) and its tests from `application/src/operations/a2a-adapter.ts` to the API app, its only transport. The `CallbackReplayStore` port and `CallbackReplayGuard` stay in application: persistence implements the port and host composes it, and neither may import an app. Keep behavior and test identities.
3. **testkit to devDependency.** `apps/api` currently lists `@aiengineer/knowledge-testkit` as a runtime dependency (the in-memory demo evaluation route uses its embedding bundles). Move the demo-only bundle loading behind host or an explicit demo port so no production runtime imports testkit; record the decision if a runtime use remains.
4. **Naming pass (folders; npm names unchanged unless listed).** `packages/acquisition` → `packages/sources`, `packages/client-typescript` → `packages/client` (npm name `@aiengineer/knowledge-client` unchanged), `services/verification-parser` → `services/parser`. Update imports, manifests, lockfile, scripts, fixtures, sandbox packaging paths and authored navigation. Preserve persisted identity strings; inventory Eve and Mission Control references to these paths and record them for Unit 5 rather than adding forwarding shims.
5. **Catalog parity test** (FINAL-LAYOUT §4.5). Inventory reads and mutations from `operations/surface.ts`, the verification catalogs, the MCP catalog and tool registrations, API routes and CLI commands. Classify each operation as declared, admitted or executable per profile and transport. One test asserts every catalog operation is exposed on API, MCP and CLI or listed as an explicit exclusion with a reason. A declared kind never becomes executable because of parity; ingestion keeps its own receipt semantics.

## Carried from Unit 3

- MCP resource failures now return the API problem code (`{ "code": … }`) as a tool error. When the catalog gains one error-code set in `contracts` (§4.2), map it once for both transports; do not change API statuses or titles.
- Host `verification/api/*-runtime.ts` files still combine construction with each service's ownership gate (`createVerificationOperationReadAuthorizer`, reconciliation grant matching). If a folder move touches them, extract the gates into application ports only with their tests and without changing failure codes.
- Proof scripts are not typechecked by `verify`; Unit 3 adapted the touched proofs to in-process MCP composition (`scripts/mcp-in-process-options.ts`) and left pre-existing type errors for Unit 7's shared proof tsconfig.

## Bounded sequence

1. Record entry evidence: fixture reassessment, application export inventory, test identities for application/api/mcp/cli/host/persistence/worker, and the current catalog inventory (reads and mutations per transport).
2. Application folder moves with an unchanged export list; validate and commit. Then `.d.ts` cleanup, benchmark split and diagnostics quarantine as separate commits.
3. A2A adapter move and testkit dependency change; validate and commit.
4. Naming pass, one package per commit, each with install/typecheck/build and affected tests.
5. Catalog parity test with explicit exclusions; authored navigation, generated docs, ledger and the bounded Unit 5 specification; local integration.

## Acceptance evidence

- Frozen install, typecheck and build pass; declared graph acyclic; host never imports apps; application/persistence never import host. Exported application symbols are unchanged except for the named A2A move.
- Existing suites keep their test identities (moved tests mapped explicitly); API/MCP parity and no-HTTP-shim tests still pass.
- The catalog parity test lists every operation with its declared/admitted/executable state per transport and a reason for each exclusion.
- Entire test graph sequentially with bounded workers; every failure and skip listed; fixture reassessment recorded separately. Examples, skill conformance, sandbox pack and installed offline CLI smoke pass (paths updated by the naming pass).
- Jev packages, app, client, CLI, six MCP tools and skill remain unchanged and their tests pass.
- Update `.agent-docs` authored inputs and live concepts; generate and check navigation; `git diff --check` passes. Merge locally only after reviewed evidence.

## Pre–Mission Control experiment dependency

The bounded stage-graph experiment in [NEXT-PACKAGE-CLEANUP.md](./NEXT-PACKAGE-CLEANUP.md) uses stage tool subsets; where those depend on the profile-aware operation catalog, this unit's catalog inventory is a prerequisite. Unit 4 does not build or run the experiment.
