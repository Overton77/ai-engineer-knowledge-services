# Cleanup progress

Status: reference. Updated 2026-09-27 UTC.

Target: [FINAL-LAYOUT.md](../FINAL-LAYOUT.md). Review: [FINAL-REVIEW.md](../FINAL-REVIEW.md).

## Current handoff

- Active checkout: `C:/Users/Pinda/Proyectos/aiengineer/ai-engineer-knowledge-services`; branch `refactor/ks-unit-1-package-merges`, created from clean integrated main `99aeaa6`. Required ancestor `81556ad` verified. The isolated checkout and safety stash are historical and untouched. No remote push or deployment is claimed.
- Jev is part of Knowledge Services and is included in combined validation: core service, child workers, HTTP/MCP host, contracts/application/client entrypoints, CLI, skill and public walkthrough evidence. See [next instruction](../NEXT-PACKAGE-CLEANUP.md).
- Unit 0 retains one missing historical judge-failure input; it is not unconditionally green. Unit 1 may proceed under the exact documented exception in the next instruction, retaining the failing test and requiring no new failures or lost coverage. All four source groups are committed through `2ba7111`; combined final validation is accepted under that exact exception.
- Fresh baseline and per-group inventories preserve all exports and test identities. Jev source is unchanged. Unit 2 specification is drafted and reviewed, but Unit 2 implementation and Units 3–7 remain queued.
- Coordinator and two reusable Sol workers: three agents total; maximum four. One implementation/validation worker runs groups sequentially; one read-only reviewer handles bounded checks. Coordinator owns ledger, live docs, unit specifications and integration. Do not run competing full test suites.
- Scoped safety stash `0971486d67cf7ddc32ac0f5eff952a9ebb15dfbb` preserves duplicate pre-merge baseline files and provisional evidence. Do not apply it: baseline changes are merged and its provisional before.json is obsolete.
- Actual pre–Mission Control plan: `ai-engineer-meta/ai-engineer-architecture/specs/knowledge-services-pre-mission-control/OPENAI_FIXTURE.md`. Its human gold review, frozen fixture/runner, budget and isolated deployment prerequisites remain separate from this local merge. Cleanup smoke tests are not that evaluation.
- Historical entries below describe the state when written. Current merge validation is recorded in the final session entry.
## Work board

| Work | Status | Entry / scope | Exit evidence |
|---|---|---|---|
| Final review and ledger | validated | Inspected target against code and consumers; corrected unit 1 instructions | Review findings and linked workspace written; docs build/check and diff check passed |
| 0 — baseline | repaired; one documented missing-input failure | [Spec](../UNIT-0-BASELINE.md); isolate fixture/setup repair | Clean-checkout verify; before test/export inventories; install and packaging evidence |
| 1 — package merges | validated, under exact baseline exception | [Continuation](../NEXT-PACKAGE-CLEANUP.md) and [spec](../UNIT-1-PACKAGE-MERGES.md) | No lost tests/exports; four merged packages; examples and packaging; verify/docs checks |
| 2 — host composition | specified; implementation queued | [Spec](../UNIT-2-HOST-COMPOSITION.md); reuse current shared verification host (R2), define lifecycle/profile matrix (R5); move config/wiring only | Server composition parity, shutdown/startup cleanup, profile admission, no new cycles; verify |
| 3 — application and MCP | queued | Write spec; inventory each residual HTTP shim; move retrieval execution and remaining policy checks | No sibling-HTTP calls; shared tenant/admission failures; intended new tool contracts tested and mapped for Eve; verify |
| 4 — folders, names, catalog | queued | Write spec; make CLI client exception explicit; inventory package/service/deployment path consumers | Runtime imports obey host rule; complete profile-aware catalog; reads/mutations/exclusions tested; verify |
| 5 — executor fold and Eve adaptation | queued | Write spec; first remove database cycle (R1); adapt Eve's host integration, binaries, packaging and env configuration (R4–R5) | New Eve/service integration and offline/remote CLI smoke tests pass; custody/recovery unchanged; obsolete app/interfaces removed; no legacy adapters |
| 6 — skills | queued | Write spec; preserve procedures and references; migrate agent sync/capability consumers | Eight canonical skills with accurate capability coverage; sandbox packaging and consumer skills check; no invented F6/Jev capabilities |
| 7 — proofs | queued | Write spec; classify live entrypoints/build tooling/historical scripts; inventory external path consumers | Live proof commands and packaged assets resolve; archive index preserves historical references; verify/docs checks |
| Post-cleanup — pre–Mission Control testing | queued | Cleanup complete; Eve uses new services, updated skills and capability profiles | Execute the applicable pre–Mission Control test plan; record results, failures and evidence against the new integration |

Unit 2 now has a bounded specification. Units 3–7 cannot be called ready until their specs exist. Their scope and gates are prepared above so that writing the next spec is bounded work, not another architecture survey.

## Decisions carried forward

| ID | Decision / gate | Owner work |
|---|---|---|
| R1 | Preserve unit 1 graph; invert knowledge-db/persistence coupling before application consumes knowledge-db | 5 prerequisite |
| R2 | Reuse existing application admission factories/shared host; credential parsing remains transport-owned | 2–3 |
| R3 | Implement target groups/contracts and adapt Eve/skills; preserve authority semantics, not legacy aliases | 3–6 |
| R4 | No live consumers; adapt Eve's test integration directly, including current `scoped-host/v1` usage; no legacy adapters | 5–6 |
| R5 | Offline is an enforced capability set; remote CLI stays client-only and lazy | 2, 5 |
| R6 | Catalog separates declared, admitted, executable and transport/profile availability | 4 |
| R7 | Preserve the exact missing-input failure; Unit 1 continuation permits only that baseline exception and requires fresh comparison evidence and no new failures | 0–1 |
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

### Unit 0 resource diagnosis (in progress)

- Additional seven example typechecks passed: conversion, documents, chunking, retrieval, projections, embeddings and vector-backends (`corepack pnpm --filter ... --if-present examples`).
- Sol reproduced broad-corpus timing failure with both curated and original complete bundles: only p95 latency exceeded unchanged 1500 ms limit (~1593/1729 ms), with no hard or regression failures. Fixture repair is being revised to keep all original bundle content and byte hashes.
- Host resource snapshot: 16 logical CPUs, 16,056,316 KiB visible memory, only 458,736 KiB free. No coordinator full suite was competing with these focused runs. Existing unrelated Node workloads were left untouched; user was asked asynchronously to pause heavy workloads. Test thresholds/assertions are preserved.
- Disposable integration prerequisites: no running `supabase_db_*` container; `KS_TEST_DATABASE_URL`, `KS_TEST_PROJECT_DIR`, and `KS_TEST_SUPABASE_URL` unset. No environment files were loaded. Database-dependent skips remain explicit, not passes.
- Validation ownership remains coordinator. No package moves allowed until unit 0 is validated.

### 2026-09-27 — paused at the user's explicit request

User has another running workload they cannot stop and asked to pause until they say to resume. Both existing Sol workers were interrupted; do not resume or launch checks automatically. Three agents total have been used (coordinator + two reusable Sol workers); maximum four total remains binding.

- Checkout/branch: `C:/Users/Pinda/Proyectos/aiengineer/ai-engineer-knowledge-services`, `refactor/knowledge-services-final-layout`; HEAD `d3405af` checkpoints the reviewed preparation documents. No package moves started; unit 0 remains active/unvalidated, units 1–7 queued.
- Uncommitted fixture repair: `.gitattributes`; `fixtures/embedding-bundle-seed-2026-09-01/README.md`, `outputs/catalog.json`, and the three named `videos/*/embedding-bundle.json` files; `packages/testkit/src/{embedding-bundles.ts,embedding-bundles.test.ts,broad-evaluation-corpus.test.ts}`. Final fixture keeps exact original three reviewed bundles (37 documents, 41 claims), not the attempted subset. Loader validates catalog and complete file set/digests, removes implicit sibling fallback, and copies the catalog on import. LF attributes preserve pinned bytes. Coordinator review/fresh-checkout validation still required.
- Worker checks: testkit typecheck passed; latest full focused testkit 10 passed / 1 failed, sole failure p95 latency 2322.0102 ms > unchanged 1500 ms, no hard/regression failures. Original full bundles independently exceeded latency too. No gates weakened. No database/provider operations performed.
- Uncommitted baseline tooling: `workspace/evidence/{inventory.mjs,test-inventory.mjs,README.md,before.json}`. Scripts passed syntax checks. Provisional inventory: 13 packages, 78 tracked test files, zero export-name collisions and manifest cycles. `before.json` predates final actual-runtime-import implementation and MUST be recaptured after successful build; it is not validated before evidence. Test identity/outcome runner has not run.
- A bounded follow-up was dispatched to the existing inventory worker to cap root test fanout (`turbo run test --concurrency=1 -- --maxWorkers=2`) without changing assertions. It was interrupted by the pause; inspect root `package.json` diff before resuming to determine whether applied. Do not assume validation.
- Completed coordinator checks: frozen install with CI=true; cached 50-task typecheck; seven preparation/retrieval example typechecks; docs check (342 inputs) and whitespace check. Full uncached verify, clean-checkout proof, actual-runtime export inventory, test-name/outcome inventory, sandbox packaging and installed offline smoke remain pending.
- Resume only on user instruction. First inspect Git diff, worker status, resource availability, fixture hashes and current scripts; reuse existing workers if available. Complete resource-safe uncached baseline and clean isolated checkout proof, then capture inventories/packaging. Do not begin knowledge-db merge until unit 0 acceptance passes. Pre–Mission Control external prerequisites are recorded above and remain outstanding.
- Reservations suspended while paused: coordinator ledger/specs; implementation worker fixture/testkit/attributes; inventory worker evidence tooling/root test script. No agent may continue these reservations until resumed.

### 2026-09-27 — resumed on user instruction

User explicitly requested continuation and completion. Existing two Sol workers will be reused (three agents total including coordinator). HEAD and all paused files preserved. Host has ~566 MiB free memory, so root test package/process concurrency is being capped without weakening assertions. Resume reservations: inventory worker root package.json for bounded test runner change; coordinator ledger/review/integration checks; fixture worker remains idle until assigned. Proceed through unit 0 before package moves.

### Resumed baseline checkpoint

- Root `test` now runs `turbo run test --concurrency=1 -- --maxWorkers=2`; coordinator full verification is running with `TURBO_FORCE=true` and no competing validation jobs. Uncached typecheck completed successfully: 50/50 tasks, zero cache hits, 5m11s. Tests are in progress.
- Independently verified physical fixture hashes and exact source equality for all three files: 18/12/7 selected documents and 14/15/12 claims. Staging exposed CRLF-to-LF normalization that would break hashes in clean clones; worker is correcting attributes to `-text`, preserving raw source bytes rather than rewriting digests.
- Confirmed harness latency accounting issue: evaluation launches 96 cases with Promise.all; normal retrieval resolves asynchronously after synchronous work, so early timers include later cases' CPU work. A separate testkit-only per-run queue is the proposed baseline repair if the full run reproduces the gate failure; no quality thresholds or production evaluation contracts change.

### Unit 0 — uncached baseline failures narrowed

- Full `TURBO_FORCE=true corepack pnpm verify` stopped in tests: uncached typecheck 50/50 passed; test phase 37 successful of 39 tasks, application 4 failed files / 38 failed tests / 398 passed tests. Root build and verification examples were not reached. Log: OS temporary `ks-cleanup-resume-verify.log`.
- Testkit now passes 4 files / 11 tests under bounded package/process concurrency; no serial evaluation or threshold change is being made. Available memory recovered to ~4.4 GiB during the run.
- Application failures: three preparation cases reject sparse `sectionPath` values; other failures reference obsolete workspace-local `internal/verification-offline-source-preparation-9093b465-16c2-4cc1-b7f4-728d3958b0ed` and `internal/verification-benchmark-extraction-live-feeb824c-e4d0-597f-abd7-7667fa080869` paths. Passing adjacent tests already use committed sealed fixtures in `catalog/verification-assets/50a3552cffc639a78d7789865be929baefd64d2342431e2de958e669c21f163e` and `catalog/verification-benchmarks/diagnostics-companies-pilot-v4-extraction-replay-v1`.
- Reservations: implementation worker repairs only the two benchmark test fixture bindings and finishes pinned-byte attributes; inventory worker repairs conversion heading hierarchy and adds focused regression coverage. Their test runs are sequential. Coordinator owns integration/review. No receipts, captures, gate thresholds, or stored procedure identities change.
- Staged fixture byte proof passed after `-text`: original SHA-256 preserved in Git for all three bundles. CR-at-EOL whitespace attributes are being added to recognize retained CRLF without ignoring actual whitespace defects.

### Unit 0 — isolation and remaining replay fixture

- Active coordinator checkout is now `C:/Users/Pinda/Proyectos/ks-package-cleanup`, branch `refactor/knowledge-services-cleanup-isolated`, created at `7025f26`. This contains the accepted preparation documents and committed exact-byte embedding fixture repair. Intended baseline edits/evidence were copied explicitly; unrelated concurrent Jev additions, manifests and lockfile changes remain only in the original checkout, untouched.
- Latest scoped commit `354ee23` fixes sparse heading ancestry without changing source offsets and bounds root test fanout. Conversion's 16 targeted tests, typecheck and build passed before transfer. Fresh isolated `CI=true corepack pnpm install --frozen-lockfile` passed (29 projects, 9 seconds).
- Rebound source-import tests to tracked sealed assets; replay reads validate manifest byte counts and SHA-256. Focused original-checkout application run improved from 38 failures to 37 passing / 1 failing; source-import 6/6 and preparation 4/4 passed. Original checkout typecheck subsequently encountered unrelated Jev module resolution errors; fresh isolated validation excludes that in-flight work.
- Remaining input: `25-gl-repeatability-mutated-haiku_judge-failure.json`, expected in original `C:/Users/Pinda/Proyectos/aiengineer/internal/verification-benchmark-extraction-live-feeb824c-e4d0-597f-abd7-7667fa080869/`. Exact file does not exist. Tracked replay catalog has six extractor failures but no seventh judge failure; bounded semantic-manifest and Git-history searches found none. No receipt was fabricated, no seven-failure coverage removed. User asked for the original input location.
- Unit 0 remains unvalidated; unit 1 remains queued per its green-baseline gate. Sol implementation worker owns fresh full validation and independently runnable builds/examples; Sol inventory worker owns evidence tooling review only, no competing tests. Three agents total have been used. Subsequent canonical progress is recorded in this isolated worktree's ledger.

### Unit 0 — fresh-checkout defects and focused repairs

- First isolated uncached verification: typecheck passed; test stopped in application with 59 failures / 370 passed / 7 skipped. Follow-up `corepack pnpm exec turbo run test --continue=always --concurrency=1 -- --maxWorkers=2` completed all 50 tasks (44 successful, 37 cached) and exposed six failing packages: application, persistence, CLI, db-read, ingestion and API. This expanded run was needed because the original verify stops before downstream tests.
- Windows checkout converted sealed catalog LF bytes to CRLF. Scoped `-text` attributes preserve benchmark Git blobs; two new checkout-index sample exports exactly matched recorded hashes. Verification-assets audit found fifteen Git-normalized blobs that do not match their unchanged source manifests, so those assets require recovery from digest-matching original bytes, not blanket newline conversion. Full validation is held until the audit finishes.
- Four database integration suites eagerly opened the sibling db-contract workspace before Vitest could apply their existing `skipIf(!url)`. Setup now runs in beforeAll, with guarded cleanup. Test identities, assertions and skip predicates are unchanged. Focused db-read two files: 7 skipped; ingestion two files: 12 skipped, as expected without disposable DB. These are not database integration passes.
- Persistence's migration assertion now reads the already-pinned database-contract package rather than an unpinned sibling path; its six focused tests pass. No migration or shared schema was changed.
- CLI test task now depends on its own build because its existing tests execute built CLI/assets. This corrects missing-dist failures in fresh checkouts.
- Existing API `/v1/evidence-packets/:id/citations` route and `RetrievalCitationReplay` response were absent from the OpenAPI generator. Registered them and regenerated artifacts without changing API behavior; focused OpenAPI parity passes.
- Exact initial isolated logs: OS temporary `ks-package-cleanup-verify-7025f26.log` and `ks-package-cleanup-test-continue-7025f26.log`. Stable compact final results and inventories will be recorded after the byte audit and corrected validation. Missing original judge checkpoint remains unresolved; no package merge has begun.

### Unit 0 — fixture custody and standalone package repaired

- Commits: `3e18fd6` contains portable baseline setup/API documentation fixes and first sealed-byte recovery; `9ef092a` preserves semantic fixture bytes; `82965b3` fixes standalone executor packaging/entrypoints. No structural unit has begun.
- Byte proofs are committed at `evidence/catalog-checkout.json` (10 manifests, 282 entries, 15 recovered assets) and `evidence/semantic-catalog-checkout.json` (6 manifests, 1,172 entries, 20 recovered assets). Every recovered file exactly matches its unchanged manifest SHA-256 and byte length; coordinator independently rechecked all 35 recovered assets. Fresh checkout-index samples reproduce the sealed bytes. Git attributes preserve bytes and treat .bin assets as binary. No manifest digest, receipt seal, or capture content was invented.
- Full verification at `3e18fd6`: typecheck passed; application 432 passed / 4 failed. Three failures were remaining semantic-fixture byte drift, now repaired; fourth is the missing judge checkpoint. Other passed suites are retained evidence; focused semantic/CLI validation will check later repairs without masking the still-red gate.
- `corepack pnpm examples:verification` passed, as did all seven preparation/retrieval example scripts. Independent initial root build failed only CLI semantic-asset copy before the expanded byte recovery; its rerun is pending below.
- Sandbox pack initially failed because a regex interpreted bundled prompt text as external import names (`Select`, `do not invent`). It now uses esbuild metafile external imports for the two packed outputs, checks output sizes, and rejects undeclared dependencies/unpacked chunks. Executor build and `pack:sandbox` pass. Runtime dependencies remain `@modelcontextprotocol/sdk`, `pg`, `zod`.
- Installed smoke initially exposed zero-output CLI startup: entrypoint detection depended on the original directory name. Both entrypoints now compare actual module/argv real paths; library import remains inert. Reviewed source is committed separately from structural work.
- Final standalone test: npm install of tarball in a fresh OS temporary directory outside the workspace passed; both installed npm shim help commands returned nonempty output; the packaged `skills/knowledge-verify/examples/offline.mjs` against installed `dist/index.js` passed. Mechanical and extraction checks passed; changed values and missing rule options rejected; decimal bounds enforced; ambiguous quote resolved; raw image unsupported; policy review with zero semantic judgments, zero provider calls, 11 receipts. Tarball SHA-256: `f40a6f685dff2ebd3458006842fb34086828cad2e48df66cff88b6ed56c8feb8`.
- Logs: OS temporary `ks-cleanup-pack.log`, `ks-cleanup-installed-install-fixed.log`, `ks-cleanup-installed-help-fixed.log`, `ks-cleanup-installed-knowledge-help.log`, `ks-cleanup-installed-offline-fixed.log`. The command results above are durable evidence; temporary logs are diagnostic convenience.

### Unit 0 — final independent checks at 82965b3

- Root `corepack pnpm build`: 28/28 tasks passed, zero cache hits. CLI `corepack pnpm --filter @aiengineer/knowledge-cli exec vitest run --maxWorkers=2`: 10 files / 52 tests passed. Application semantic fixture targeted file: 8/8 tests passed. Executor typecheck passed. Logs: OS temporary `ks-package-cleanup-build-82965b3.log`, `ks-package-cleanup-cli-test-82965b3.log`, `ks-package-cleanup-semantic-test-82965b3.log`.
- Full verify has not been rerun since the last semantic-byte repair: its earlier failed result remains a failed result. Focused checks resolved the three semantic digest failures. The sole remaining identified failure is the absent sealed judge checkpoint. It has not been skipped or replaced.
- Source-package inventories are being captured as `pending-before-exports.json` and `pending-before-tests.json`, not validated unit 0 evidence. The missing application fixture is outside the thirteen packages; successful source-package inventories do not waive the full baseline gate.
- Unit 1 through unit 7, Eve/skill adaptation, and post-cleanup pre–Mission Control testing remain queued. Existing verification and preparation/retrieval examples have passed; this is baseline validation, not completion of the requested refactor or walkthrough updates.

### Required input and next executable action

- Missing original file: `25-gl-repeatability-mutated-haiku_judge-failure.json`. It is absent from the recorded original workspace internal directory, the equivalent original-repository internal directory, tracked replay/semantic catalogs and Git history. The seven-failure test intentionally still requires it. User has been asked for its original location; no answer yet.
- On receipt: verify the original checkpoint and packed artifact digests, retain exact bytes in a scoped repository-owned digest-pinned fixture without rewriting existing historical seals, and finish the test binding. Run the affected replay file, then the complete isolated `corepack pnpm verify`. Re-capture/validate pending inventories and repeat only checks affected by that fixture change. Unit 1 can start only when unit 0 acceptance is genuinely green.
- Next structural task is the `knowledge-db` group from `UNIT-1-PACKAGE-MERGES.md`; no new planning/permission round or extra agents are needed. Reuse existing Sol workers if available, with this isolated checkout explicitly named.
- Full mission remains incomplete. This is a precise missing-input handoff, not a validated unit or a user-requested pause.

### Final handoff — original replay input required

- Pending inventories at implementation SHA `82965b3`: 13 packages; 422 compiler-resolved source exports; 189 actual runtime exports; zero group collisions and zero declared manifest cycles. Test inventory: 78 tracked/executed files, including 18 example files; 684 identities, 652 passed, 32 skipped, zero failed; all 13 package runs exit zero. Coordinator checked counts and the evidence README. These remain pending because the full baseline gate is not green.
- Final documentation check passed (342 selected inputs) and whitespace check passed. All baseline changes are scoped local commits on the isolated branch; no push, PR, merge or deployment performed.
- Both Sol workers are complete and idle. Three agents total were used, never more than the authorized four. No tests, services, provider calls or automation are running on this task's behalf.
- Resume from this isolated checkout and its ledger when the missing original judge checkpoint is supplied. Preserve the original checkout's independent Jev work. Refactor, new host/application layout, Eve integration, eight-skill consolidation, proof/walkthrough updates and actual pre–Mission Control execution are not complete and must not be claimed as completed by the baseline fixes.

### 2026-09-27 — Jev integration and next package-cleanup handoff

Developer requested a combined local starting point and instructions for the next cleanup work. Checkpointed intended Jev changes as `dbe0c4b`, then merged cleanup branch `38ff40d` into `refactor/knowledge-services-final-layout` with merge commit `e9829a8`. Its parents are the Jev checkpoint and cleanup baseline. The sole content conflict was generated `.agent-docs/provenance.json`; regenerated it from the combined authored inputs. Enabled repository-local `core.longpaths` for Windows checkout paths. No structural package merges occurred in this integration turn.

Preserved duplicate earlier cleanup files and provisional evidence in scoped stash `0971486d67cf7ddc32ac0f5eff952a9ebb15dfbb`; no application of that stale backup is needed. The merged tree contains the baseline fixture/setup/packaging repairs and the complete Jev service, worker, contracts/client/application exports, host, CLI, skill, docs and public experiments. Existing local Jev database/process state was left alone. No paid experiment, populated database operation, deployment or remote Git publication was performed.

Combined validation (runtime source at `e9829a8`; subsequent edits only handoff/navigation):

- `corepack pnpm install --frozen-lockfile`: passed, 31 workspace projects.
- `corepack pnpm typecheck`: 53/53 tasks passed, zero cached.
- `corepack pnpm exec turbo run test --continue=always --concurrency=1 -- --maxWorkers=2`: all tasks attempted; 53/54 tasks successful, zero cached. Test summaries total 2,771 passed, 126 skipped, one failed. The only failure is the existing registered replay test `replays all seven actual captured schema failures exactly once in memory`, with `SEALED_CHECKPOINT_MISSING:records/25-gl-repeatability-mutated-haiku_judge-failure.json`. Skipped integration tests are not passing evidence.
- Included Jev tests: core 9/9, service 6/6, client 25/25 (including Jev client coverage), all passed.
- `corepack pnpm build`: 30/30 tasks passed (23 cached).
- `corepack pnpm examples:verification`: passed; executor offline example produced 11 receipts, zero provider calls, mechanical/extraction passed, semantic judgment not run, policy review.
- `node skills/check.mjs`: passed, 12 skills, 6 Jev MCP tools and 9 Jev commands.
- `corepack pnpm --filter @aiengineer/knowledge-verification-executor pack:sandbox`: passed. Tarball SHA-256 `b5fc59b466bbd480de3c0c28ab8999b57caec6ff1ee9d89ee852ff52210334c1`; runtime dependencies MCP SDK, pg and zod.

[Next package-cleanup instruction](../NEXT-PACKAGE-CLEANUP.md) is the current handoff. It makes the coordinator's exact missing-input exception explicit for mechanical Unit 1, without calling Unit 0 green or weakening the test. Reassess before behavior-changing units. Fresh merged inventories are required before moves; previous pending inventory files remain historical. Updated the old green-only entrypoints to link this continuation and corrected the pre-Jev package/app count assumption. No skill consolidation or later cleanup unit is claimed complete.

Installed sandbox verification also passed in a fresh temporary npm project outside the workspace: both knowledge-verify and knowledge shims returned nonempty help with exit 0; the packaged offline example passed with 11 receipts and zero provider calls. Generated agent documentation build/check passed with 354 selected inputs, and git diff --check passed.

### 2026-09-27 — main integration and one branch per unit

The developer explicitly approved integrating the combined baseline into main and using one branch per cleanup unit, with multiple commits per branch. Preserve functionality and make deliberate enhancements in their specified units; complete the package/app organization and redesigned skills on the path to Mission Control. Updated the coordinator instructions, accepted layout and next-session handoff to apply this rule. Unit 1 starts on `refactor/ks-unit-1-package-merges`, includes all four mechanical groups, and ends with validation, a concrete Unit 2 specification and local integration into main. Routine local unit merges are authorized; no new permission round is required.

Pre-integration main was `9084428`, with no commits absent from the final-layout branch. The implementation remains exactly the previously validated runtime at `e9829a8`; subsequent changes are documentation only. Prior validation and the single missing historical receipt failure remain recorded above. No structural cleanup unit has been executed in this handoff turn. Final main integration uses a merge commit; its SHA is available from main's Git history. No remote publication or deployment is included.

### 2026-09-27 — Unit 1 execution from integrated main

- Coordinator owns acceptance, this ledger, live navigation and the Unit 2 specification. Sol implementation worker owns baseline evidence, then each mechanical merge group sequentially; a second Sol worker performs read-only host-composition review. Three agents total, no recursive delegation or competing test suites.
- Checkout: `C:/Users/Pinda/Proyectos/aiengineer/ai-engineer-knowledge-services`. Initial status clean; main `99aeaa6` contains `81556ad`. Created `refactor/ks-unit-1-package-merges` from that tip. Historical isolated worktree and safety stash remain untouched.
- Scope is the current handoff: knowledge-db → retrieval → preparation → core, separate validated commits, live documentation and bounded Unit 2 specification, then local merge into main. Later units, Eve/skill consolidation and pre–Mission Control evaluation remain queued.
- Fresh compiler/runtime export, manifest graph, test identity and consumer-probe evidence precedes moves. The worker has exclusive install/build/test ownership until released. Coordinator reviews consumers and prepares authored navigation independently.
- Exact missing historical judge receipt exception remains in force for Unit 1 only; no assertion, skip condition or receipt may be changed to hide it. No environment secrets, provider calls, database mutations, remote publication or deployment are part of this execution.

### Unit 1 — combined baseline captured

- Fresh forced build of all thirteen merge-source packages and their dependencies passed, 22/22 tasks with zero cache hits. Node `v24.18.0`, pnpm `10.34.5`; initial clean source SHA `99aeaa61483cec0ba720f21bce25b659cb302aab`. Captures show dirty=true because coordinator documentation was being authored; production source remained unchanged until captures finished.
- `evidence/unit1-before.json`: 422 compiler-resolved source symbols, 189 runtime exports from the fresh build, zero group collisions and zero declared manifest cycles. `evidence/unit1-before-tests.json`: all thirteen runs exit zero, 78 files, 684 identities, 652 passed and 32 skipped. Every skip remains visible; no database integration pass is claimed.
- Compiler consumer probes import all public symbols: knowledge-db 211, retrieval 81, preparation 78, core 52; each pre-move probe passed. The executable probe and source/result files are under `evidence/` with the `unit1-` prefix. Historical pending captures were not reused.
- Scoped sibling audit found Eve `tools/team/t14-launcher.mjs:96` resolving `@aiengineer/knowledge-embeddings` and `tools/team/t14-ks-host.mjs:171` pointing to `packages/runtime/dist/index.js`. These require direct adaptation in the designated later Eve unit; no shim or sibling change is introduced here, and Eve validation is not claimed. Mission Control root manifest and Eve's selected team/sandbox/skill-sync consumers were checked; this is a bounded audit, not a workspace crawl.
- Authored navigation merges preserve existing interfaces/test anchors, qualify search-only statements within the larger retrieval package, and retain Jev registrations. Unit 2 specification drafted from actual API/MCP/worker construction and independently reviewed; it reserves unsupported offline capabilities and records Jev queue ownership/physical child-worker packaging.

### Unit 1 — knowledge-db accepted

- Merged schema-workspace, db-read and ingestion into `packages/knowledge-db` with their original internal folders, ordered root exports and separate fixture folders. Consumers, dependency keys, lockfile and live proof entrypoints now use the new package/path. No query, algorithm, assertion, skip predicate or persisted procedure identity changed.
- Install, package build/typecheck and workspace typecheck (49/49 tasks) passed. The merged suite passed 411 tests and retained 32 skips across all 443 identities. Coordinator independently ran both `compare-group knowledge-db` commands: no export, type/value kind, runtime name, test-file, test-identity or outcome differences. The 211-symbol consumer probe passed.
- Validation caught and resolved two over-adjusted fixture imports and a source-versus-built nominal class mismatch in the external fixture declaration; its ReadExecutor type now uses the package root, matching the original external consumer semantics. Final executor typecheck and probe pass. No tests were weakened.
- Evidence: `evidence/unit1-knowledge-db-after.json`, `unit1-knowledge-db-after-tests.json`, and the before/after consumer probes. Full graph validation remains scheduled after all four groups. Ignored remnants of obsolete folders are preserved outside the repository, not deleted.
- Accepted implementation commit: `6e81658`. Affected executor suite passed 235 tests with 39 existing skips. Frozen install passed with 29 workspace projects. `git log --follow` on the moved read executor reaches its pre-move history. Retrieval is the next sequential group.

### Unit 1 — retrieval accepted

- Commit `3bceceb` consolidates search, vector-backends, embeddings and projections in `packages/retrieval`, with examples grouped by origin and preserved public/private stage boundaries in the barrels. Install/frozen install passed (26 workspace projects); package typecheck/build/examples passed; workspace typecheck passed 43/43 tasks.
- All 136 retrieval-group tests passed, zero skips. Coordinator independently reran export and test comparisons: zero differences; the 81-symbol compiler consumer probe passed. Captures: `evidence/unit1-retrieval-after.json`, `unit1-retrieval-after-tests.json`, and consumer probe outputs. Declared graph remains acyclic.
- Affected consumer checks: API retrieval tests 9 passed/13 skipped, application knowledge test 1 passed, executor content-links integration 2 skipped. Integration prerequisites were unavailable; skips are not passes.
- Root typecheck exposed a nominal source/built ReadExecutor mismatch in the prior group's test helper declaration. The declaration now accepts `Pick<ReadExecutor, "head" | "runIntent">`, matching its exact runtime calls. Its implementation, assertions and outcomes are unchanged; both knowledge-db and executor typechecks pass. This is a test declaration correction, not a public service contract change.
- Obsolete ignored-only retrieval support directories were preserved under the same temporary backup root. Next: preparation, including unchanged persisted conversion/chunking procedure identities.

### Unit 1 — preparation accepted

- Commit `4aa5d38` consolidates documents, chunking and conversion into `packages/preparation`, preserving internal filenames and grouped examples. Install/frozen install passed (24 workspace projects); package typecheck/build/examples and full workspace typecheck (39/39) passed.
- All 83 package tests passed, no skips. All 78 public-symbol probes compile. Coordinator independently compared the export/runtime/type-kind/test-file inventory and test identity/outcome inventory: zero differences and no manifest cycles. Evidence uses the `unit1-preparation-after` and consumer-probe prefixes.
- Affected worker activity registry: 34 passed; application preparation/knowledge/admission/acquisition: 17 passed. No behavior or assertion changes were needed. Three explicit comments now mark persisted conversion/chunking identity strings in persistence; SQL and digests are unchanged. The named internal source-audit path list follows the moves.
- Independent committed-source review of the first two groups found no source loss or assertion/dependency-section change. It found stale moved example README commands; all seven retrieval/preparation example READMEs are corrected in the pending docs commit. Removed a stale example explanation of the sparse-heading bug already repaired in the baseline.
- Next: core, then sequential complete graph validation and installed sandbox proof before local integration.

### Unit 1 — core accepted; full validation active

- Commit `2ba7111` consolidates domain, runtime and observability into `packages/core` and updates all scoped source/manifests/scripts. Install/frozen install passed (22 workspace projects); package typecheck/build and root typecheck (36/36 tasks) passed.
- Core's 22 tests passed with zero skips. The 52-symbol consumer probe passed. Coordinator independently ran both comparison commands: no missing/added exports, changed type/value kinds, runtime differences, test-file losses, identity losses or changed outcomes. Declared graph remains acyclic. Evidence uses the `unit1-core-after` prefix.
- Affected acquisition tests: 6 passed; worker metric/claims sealer tests: 18 passed. Distinct deterministicUuid helpers remain in their specified packages. All obsolete package directories' ignored remnants are preserved outside the repository; the live source inventory is now fifteen packages and six apps.
- All four structural groups are committed. One Sol worker owns the complete final test/build/example/packaging run and final captures; the read-only reviewer checks the final source diff. Coordinator owns live-reference audit, documentation generation, acceptance and local merge. No competing test suite is running.

### Unit 1 — final review and output-cache diagnosis

- Independent source review found no lost implementation, changed assertions or altered persisted SQL identities across the four commits. Jev package/service/contracts/application/client source is unchanged; its physical worker build and queue ownership remain intact.
- Live-reference audit covers 1,595 tracked source/navigation files and records only four intentional persisted identity matches. Deferred Eve references are recorded separately. Generated documentation build/check passes; module maps retain representative test anchors within the generator limit, while full test coverage lives in the test inventories.
- Initial complete validation exposed ignored acquisition dist tests from an older build. A direct clean rebuild passed 43 source tests, but Turbo subsequently restored the stale build cache. The exact output directories were preserved under the temporary validation directory; the worker is refreshing builds and tests with --force. No source assertion, skip predicate or test-discovery configuration was changed. These failed diagnostic runs are not acceptance evidence.

- Forced complete graph finished with zero cache hits: 36/37 tasks successful, 2,729 tests passed, 126 skipped and one failed. The sole failure is the exact retained registered-replay missing historical checkpoint. Normal verify rerun also has only that failure; acquisition output contamination no longer recurs.
- The historical 2,771-pass total included 42 stale compiled acquisition tests in eight dist files, alongside 43 source tests (85 total). The original temporary ks-jev-merged-tests.log confirms the eight counts: acquisition 9, deadline 3, mapped-address 16, residuals 8, route 2, upload/filesystem-source 1, inspect/inspect 2, paper/plan-http 1. The fresh run retains all 43 source tests in 12 files. The old compiled files remain preserved in the temporary stale-dist backup; no source test or test-discovery setting changed.

### Unit 1 — final acceptance

- Complete graph: 2,729 passed, 126 skipped, one exact permitted missing historical receipt failure; 36/37 tasks, zero cached. Normal verify rerun confirms the same sole failure, with typecheck passed (36/36 tasks). Verify cannot be called green and stopped before build/examples; those stages were executed independently.
- Frozen install passed (22 workspace projects). Root build passed 21/21 tasks; preparation/retrieval example typechecks and verification examples passed. Skill conformance passed: 12 skills, 6 Jev MCP tools and 9 Jev commands. Jev core/service/client tests passed (9/6/25). No Jev production source changed.
- Final all-group exports and test identities compare without any missing/added names, kind changes, file losses or changed outcomes. All 684 identities remain (652 passed, 32 skipped); all 422 public-symbol probes compile. Coordinator independently reran both final comparison commands. Declared graph has zero cycles.
- Sandbox pack passed: SHA-256 `862d37cc6fc8dfa8da13bd96b5355a7de6a835b4b6f4f69c8423b1e8ccf66147`. A fresh npm install outside the workspace passed; knowledge-verify and knowledge help shims returned content; installed offline example passed with 11 receipts and zero provider calls. Semantic judgment was not run and policy outcome remained review.
- Durable evidence: `evidence/unit1-validation.json`, `unit1-after.json`, `unit1-after-tests.json`, all consumer probes, and `unit1-live-reference-audit.json`. Diagnostic logs are under `%TEMP%/ks-unit1-final-2ba7111`; they are not required to reconstruct the structured acceptance record.
- Authored navigation and all seven moved example READMEs are updated. Generated documentation build/check and whitespace checks pass. Unit 2 specification is prepared and independently reviewed; Units 2–7 implementation, Eve adaptation, skill consolidation and pre–Mission Control evaluation remain queued. No remote publication, deployment, shared database mutation or paid provider run occurred.
