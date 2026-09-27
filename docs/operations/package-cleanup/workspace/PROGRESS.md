# Cleanup progress

Status: reference. Updated 2026-09-27 UTC.

Target: [FINAL-LAYOUT.md](../FINAL-LAYOUT.md). Review: [FINAL-REVIEW.md](../FINAL-REVIEW.md).

## Current handoff

- New-session entrypoint: [COORDINATOR-INSTRUCTIONS.md](../COORDINATOR-INSTRUCTIONS.md). The developer requested GPT 6 Astra as coordinator/planner/reviewer and GPT 6 Sol implementation workers, mostly sequentially. No workers have been launched by the preparation session.

- Developer direction: no live consumers. Adapt the Eve research test agent directly to the new services and updated skills; do not build legacy adapters or stage a production migration. Run pre–Mission Control testing immediately after cleanup and Eve adaptation are complete.

- Review base: `90844286c2653480bb48ac83bbe79a62a815db5e` (`main`, merged Claude Code PR #1).
- Preparation owner: Codex, current final-layout review session. Changes are local documentation edits; no implementation branch or structural unit is claimed.
- Next task: execute [unit 0](../UNIT-0-BASELINE.md), establish a reproducible green baseline, then begin unit 1's `knowledge-db` merge. No package moves have started.
- Known remote failure: PR Verify run `36285046974` failed five tests in `embedding-bundles.test.ts` and `broad-evaluation-corpus.test.ts` on missing `embedding-bundle-seed-2026-09-01`. Docs passed. Pre-PR main failed earlier in typecheck.
- Local verification: Windows, Node `v24.18.0`, pnpm `10.34.5`; `corepack pnpm verify` exited 1. Typecheck passed (50 tasks); tests stopped after a worker fork exited unexpectedly. Testkit embedding-bundles and executor root-host-coverage also reported failures during that run. The top-level build and verification-example stages were not reached; prerequisites built during typecheck are not equivalent to a completed verify.
- Focused reruns: `corepack pnpm --filter @aiengineer/knowledge-worker exec vitest run --maxWorkers=2` passed 23 files / 143 tests, with 5 integration tests skipped. Executor `vitest run src/root-host-coverage.test.ts --maxWorkers=1` passed 1 file / 2 tests. This suggests concurrency/resource sensitivity but does not establish its cause or a green full baseline.
- Testkit rerun: `corepack pnpm --filter @aiengineer/knowledge-testkit exec vitest run --maxWorkers=1` passed 4 files / 9 tests locally. This does not resolve the clean-checkout CI fixture dependency. Log: `ks-final-layout-testkit-check.log` in the operator's temporary directory.
- Preparation validation: documentation build/check passed (342 selected inputs); `git diff --check` passed. A frozen-lockfile install, clean-checkout full pass, before/after export proof, sandbox packaging, and disposable-database integration proofs remain unit 0 work.
- Link validation: all local Markdown file links in the seven authored cleanup documents resolve. A second documentation build made no changes.
- Reservations: none after the preparation session ends. Future implementer claims unit 0 and records its branch/worktree here.

## Work board

| Work | Status | Entry / scope | Exit evidence |
|---|---|---|---|
| Final review and ledger | validated | Inspected target against code and consumers; corrected unit 1 instructions | Review findings and linked workspace written; docs build/check and diff check passed |
| 0 — baseline | queued | [Spec](../UNIT-0-BASELINE.md); isolate fixture/setup repair | Clean-checkout verify; before test/export inventories; install and packaging evidence |
| 1 — package merges | queued | [Spec](../UNIT-1-PACKAGE-MERGES.md); unit 0 complete | No lost tests/exports; four merged packages; examples and packaging; verify/docs checks |
| 2 — host composition | queued | Write spec; reuse current shared verification host (R2), define lifecycle/profile matrix (R5); move config/wiring only | Server composition parity, shutdown/startup cleanup, profile admission, no new cycles; verify |
| 3 — application and MCP | queued | Write spec; inventory each residual HTTP shim; move retrieval execution and remaining policy checks | No sibling-HTTP calls; shared tenant/admission failures; intended new tool contracts tested and mapped for Eve; verify |
| 4 — folders, names, catalog | queued | Write spec; make CLI client exception explicit; inventory package/service/deployment path consumers | Runtime imports obey host rule; complete profile-aware catalog; reads/mutations/exclusions tested; verify |
| 5 — executor fold and Eve adaptation | queued | Write spec; first remove database cycle (R1); adapt Eve's host integration, binaries, packaging and env configuration (R4–R5) | New Eve/service integration and offline/remote CLI smoke tests pass; custody/recovery unchanged; obsolete app/interfaces removed; no legacy adapters |
| 6 — skills | queued | Write spec; preserve procedures and references; migrate agent sync/capability consumers | Eight canonical skills with accurate capability coverage; sandbox packaging and consumer skills check; no invented F6/Jev capabilities |
| 7 — proofs | queued | Write spec; classify live entrypoints/build tooling/historical scripts; inventory external path consumers | Live proof commands and packaged assets resolve; archive index preserves historical references; verify/docs checks |
| Post-cleanup — pre–Mission Control testing | queued | Cleanup complete; Eve uses new services, updated skills and capability profiles | Execute the applicable pre–Mission Control test plan; record results, failures and evidence against the new integration |

Units 2–7 cannot be called ready until their specs exist. Their scope and gates are prepared above so that writing the next spec is bounded work, not another architecture survey.

## Decisions carried forward

| ID | Decision / gate | Owner work |
|---|---|---|
| R1 | Preserve unit 1 graph; invert knowledge-db/persistence coupling before application consumes knowledge-db | 5 prerequisite |
| R2 | Reuse existing application admission factories/shared host; credential parsing remains transport-owned | 2–3 |
| R3 | Implement target groups/contracts and adapt Eve/skills; preserve authority semantics, not legacy aliases | 3–6 |
| R4 | No live consumers; adapt Eve's test integration directly, including current `scoped-host/v1` usage; no legacy adapters | 5–6 |
| R5 | Offline is an enforced capability set; remote CLI stays client-only and lazy | 2, 5 |
| R6 | Catalog separates declared, admitted, executable and transport/profile availability | 4 |
| R7 | Red baseline is not a waiver; fixture repair and comparison evidence precede merges | 0–1 |
| R8 | Mechanical moves preserve tests/types/runtime identities; count targets do not prove behavior | 1, 6–7 |

## Session log

### 2026-09-27 — archived superseded instructions

Moved the six historical proposal/phase documents into `../archive/`, preserving their contents. Replaced the top-level README with current execution navigation, linked retained phase decisions from FINAL-LAYOUT to their archived locations, and updated the documentation registry. The archive index explicitly disclaims the old sequencing and approval/delegation rules. No implementation work or unit status changed.

### 2026-09-27 — developer clarified integration scope

The developer confirmed no live services consume these interfaces. Eve is the existing test agent and intended real integration; it will be adapted to the new services. Replaced the production-style consumer migration gate with direct Eve adaptation in units 5–6 and an explicit post-cleanup pre–Mission Control test step using updated skills. No compatibility shim or staged deployment is required. Stored evidence, tenant/admission invariants, and the populated shared database still retain their existing protections.

### 2026-09-27 — final review and execution setup

Reviewed target/spec, declared dependency unions, current shared host, MCP naming/authentication, operation admission catalog, executor configuration/exports/packaging, persisted transaction interfaces, and selected sibling research-agent consumer entrypoints. Confirmed 23 package manifests and 11 root manifest skills plus the executor skill. Found no reason to change the accepted package count; identified the unit 5 dependency cycle and consumer migration as concrete later gates. No sibling source, runtime behavior, database, deployment, or existing receipt changed.

Checks and final preparation status are recorded above. Next implementer should read the current handoff and unit 0 before running a package codemod.

Local diagnostic logs are in the current operator's temporary directory (`ks-final-layout-review-verify.log`, `ks-final-layout-worker-check.log`, `ks-final-layout-executor-check.log`). The durable handoff is the command/outcome summary above; these temporary files are diagnostic convenience, not completion evidence for unit 0. Preparation remains uncommitted on the review base; do not infer a PR or landed code change.

### 2026-09-27 — implementation claimed

- Owner: GPT 6 Astra coordinator; GPT 6 Sol implementation worker; maximum four agents total, workers reused sequentially.
- Branch: `refactor/knowledge-services-final-layout`; checkout: `C:/Users/Pinda/Proyectos/aiengineer/ai-engineer-knowledge-services`; baseline: `90844286c2653480bb48ac83bbe79a62a815db5e`.
- Prepared authored/generated documentation remains intact in this checkout. No worktree copy or reset was used.
- Unit 0 active. Plan: repair fixture isolation, diagnose repeatable verification resource limits, capture compiler-resolved export/test inventories and packaging baseline; then perform unit 1 merge groups sequentially. Write each later specification only after its predecessor validates. Adapt Eve in units 5–6 and execute the actual pre–Mission Control fixture after unit 7.
- Reservations: coordinator owns this ledger, unit specifications and baseline evidence tooling; Sol worker owns `packages/testkit/` fixture repair. No competing full test suites.
- Located requested test-plan package through meta AGENTS.md: `ai-engineer-meta/ai-engineer-architecture/specs/knowledge-services-pre-mission-control/OPENAI_FIXTURE.md`, with `EVE_AGENT_EXECUTION.md` and implementation navigation. Exact executable gates/prerequisites are being inspected before any integration claims.

### Pre–Mission Control prerequisites inspected

- Authoritative plan: `C:/Users/Pinda/Proyectos/aiengineer/ai-engineer-meta/ai-engineer-architecture/specs/knowledge-services-pre-mission-control/OPENAI_FIXTURE.md`; execution mapping: sibling `EVE_AGENT_EXECUTION.md`.
- Current source supersedes the older scaffold-only handoff: `fixtures/openai-pre-mc/README.md` reports 48 distinct captured documents and 37 admitted projections, with engineering candidate labels. It explicitly says no scored lane has run. `gold-review.json` remains `review_required`; fixture seed/delta, discovery recordings, fault cases and corpus freeze remain incomplete. This is not passing release evidence.
- Existing checks: KS `corepack pnpm verify`; preparation/retrieval package example commands; executor `corepack pnpm --filter @aiengineer/knowledge-verification-executor pack:sandbox` and installed offline example. Eve `corepack pnpm verify`, `corepack pnpm skills:check`; public-host/team tests to be adapted in units 5–6.
- No `fixture:openai` script exists in either root manifest. The fixture README explicitly prohibits launching it before P6.1/P4.4/P5.3 prerequisites. Cleanup will not invent that runner or call a substitute smoke test the full plan. Actual-model lanes additionally lack a frozen spend ceiling; release needs human-origin gold review and an identified isolated deployment target. Continue all independent refactoring and deterministic checks.
- Environment: Windows, Node v24.18.0, pnpm 10.34.5. Initial non-TTY frozen install aborted before purge confirmation; `CI=true corepack pnpm install --frozen-lockfile` succeeded (29 projects, 32.9 s). `corepack pnpm typecheck` passed all 50 tasks from cache; an uncached full baseline is still required.
- Documentation check: `node .agent-docs/cli.mjs check --repo .` clean (342 selected inputs); `git diff --check` passed.
