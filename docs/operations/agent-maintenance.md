# Git-driven agent maintenance

This pilot uses Git revisions as the unit of work. Agent sessions are consumers of work, not triggers. Source: `tools/maintenance/` for local execution, `.github/maintenance/` for remote dispatch and proposal publication, and `.github/workflows/agent-maintenance.yml` for GitHub execution. Deployment of the workflow and local watcher is a separate operational step; having these files does not prove either is running.

## Documentation and retrieval contract

Read `AGENTS.md`, then `docs/architecture/current-state.md` for current implementation and ownership, `docs/architecture/technology-stack.md` for pinned dependencies, and the relevant `knowledge/` concept. Accepted architecture decisions describe intent; current-state and implementation evidence describe what is actually implemented. Remaining package cleanup is tracked in `docs/operations/package-cleanup/NEXT-PACKAGE-CLEANUP.md`.

The eleven concept sections cover service boundaries; execution profiles and transports; capture, conversion and custody; preparation and publication; schema/read/ingestion; retrieval and evidence; evaluation and publication gates; verification and admission; durable execution and recovery; Jev decisions and workers; and agent skills and consumer readiness. Each records business vocabulary, invariants, implementation entry points, test anchors, limitations and related decisions. Front matter supplies searchable identifiers, aliases and example questions. These are authored explanations, not generated claims about runtime behavior.

`AGENTS.md` stays a compact starting map. Generated source-directory maps route deeper work. Canonical configuration is `.agent-docs/config.json` and `.agent-docs/modules.json`; the generator is owned by `ai-engineer-meta/tools/agent-docs`. Edit those sources, then run the canonical workspace build. Do not independently edit vendored updater programs or generated blocks. A registered document with `navigation: false` is hidden from the startup index but remains fingerprinted and available through module associations.

```sh
node .agent-docs/cli.mjs context --repo . --query "why does a knowledge read skip retrieval" --format json
node .agent-docs/cli.mjs check --repo .
node .agent-docs/retrieval-benchmark.mjs --repo .
```

Context retrieval returns bounded concept sections, source/test entry points, decision links and evidence freshness. Ranking uses Unicode words, identifier tokens, aliases and question vocabulary. It is deterministic lexical retrieval over semantic documentation, not an embedding index or a replacement for provider-native code search. Use the returned paths with code search and read the owning implementation before making claims. Changed or missing evidence is a reason to investigate, not an instruction to refresh hashes mechanically.

The same repository documents serve Cursor, Claude Code and Codex. Their native search can supply additional candidates; canonical navigation and business explanations stay provider independent. Do not claim that every provider loads every AGENTS.md automatically: startup and nested-instruction behavior differs. Repository adapters point to the common entry point.

## Events and resulting actions

| Event | Work | Result |
| --- | --- | --- |
| Working-tree reconciliation | Hash changed allowed files and staged identities | Local observation; dirty content is not uploaded or rewritten |
| Pre-commit | Check the exact staged whitespace, metadata syntax and supported source formatting | Fast deterministic feedback without changing the index |
| Post-commit / merge / checkout / rewrite | Enqueue committed SHA plus input and policy fingerprint | Deduplicated SQLite job |
| Independent local watcher | Reconcile missed events and drain eligible jobs | Isolated maintenance branch, patch, checks and receipt |
| Pre-push | Inspect the exact outgoing SHA rows | Optional receipt enforcement, disabled by default |
| GitHub PR or push | Opt-in automatic provider review | Revision-bound findings; no auto-merge |
| Authorized issue/PR command | Dispatch selected provider/task | Review or scoped proposal against a pinned revision |

Local SQLite lives under the Git common directory at `maintenance/state.sqlite`; no Supabase schema is needed. Jobs have bounded attempts, leases and fenced completion. A stale initiating HEAD supersedes a result. Maintenance branches do not recursively enqueue maintenance. Every attempt retains its checkout and receipt for inspection. Failed checks remain failures, including pre-existing failures; a patch does not certify the original SHA.

## What agents should change

For each affected behavior, review its business invariant, caller contract, implementation, existing tests and documentation together. Make small behavior-preserving cleanups only when the connection to the change is clear. Do not turn a maintenance pass into package migration, a public API redesign or broad formatting. Protected credentials, workflows, maintenance policy, migrations, sealed fixtures and evidence are outside automatic proposals.

Update authored documentation when behavior, ownership, entry points, constraints or accepted status changed. If the current explanation is still accurate, record an evidence-backed no-change decision. Then rebuild generated navigation and check it. A source hash only establishes that bytes were observed; it does not establish that the prose is true.

Test recommendations must name a plausible failure, the boundary at which it can be observed, and the assertion that would distinguish correct behavior from that failure. Prefer names such as `rejects an expired lease before publishing results` over `works` or `test helper`. Avoid tests that merely repeat implementation details or require live production services.

| Boundary | Appropriate test |
| --- | --- |
| Pure ranking, command parsing, path admission, state transitions | Fast unit tests with explicit edge cases |
| Real concept files, Git trees, SQLite leases, proposal artifacts | Disposable integration/fixture tests with observable outcomes |
| HTTP/MCP/CLI caller compatibility | Contract or golden tests for the actual public shape |
| Database/worker durability | Isolated integration proof; never reset the shared populated database |
| A complete critical user workflow | A small end-to-end test where lower boundaries cannot prove the risk |
| Model-dependent retrieval or semantic judgment | Versioned evaluation corpus, measured relevance and abstention, separately reported live runs |

Coverage percentages identify unexercised code; they do not prove that the right behavior is tested. Model-written assessments are evidence to review, not authoritative proof. The local `review-evidence.v1` receipt requires documentation dispositions, test reasoning, findings and limitations. Deterministic checks run independently of the model report.

## Retrieval evaluation

The portable retrieval tests use a frozen six-concept snapshot from the real Knowledge Services repository at `3528642`, its manifest and 28 labeled queries: 18 screening queries, six held-out positives and four negative queries. Unit tests exercise token boundaries, identifier splitting, ranking stability, repeated text, bounds and freshness. Fixture tests protect original text and expected behavior. No model API or database is needed.

Labels were written by an agent; this is not an independent human gold set. The held-out queries have now been inspected and must not continue to be called unseen. Keep original labels and missed cases visible. Expanding the live corpus can add valid alternative answers while making strict old labels score worse; report that distinction rather than silently relabeling after seeing results. A later human review should add independent business questions and relevance judgments before introducing embeddings or declaring retrieval solved.

## Local operation

Run Node 24 from the repository root. Authenticate the selected CLI once using its own supported login. Provider secrets, if needed, belong in the launching environment, never in policy or Git. The engine does not load `.env` and does not pass database credentials to children.

```sh
node tools/maintenance/cli.mjs doctor
node tools/maintenance/cli.mjs install-hooks
node tools/maintenance/cli.mjs reconcile
node tools/maintenance/cli.mjs run --dry-run
node tools/maintenance/cli.mjs status
```

`tools/maintenance/policy.json` enables isolated proposals with Codex for this pilot after a successful real-provider smoke test. Set `observe` to `true` for observation-only operation; choose `codex`, `claude` or `cursor` after validating that provider. Run `node tools/maintenance/cli.mjs watch` under an independent OS supervisor, or invoke `watch --once` periodically. This watches Git, not the editor session. `pause` and `resume` control new job claims; they do not cancel an already running provider. Stop the supervisor to stop execution. Existing custom hooks are preserved and require explicit chaining; the installer refuses to overwrite them.

For a completed attempt, inspect the receipt, report, check logs and `proposal.patch` in the reported output directory. Review the retained worktree, commit approved changes on its maintenance branch and use the normal PR workflow. Automatic work does not merge itself. Preserve wanted changes before removing retained worktrees. See `tools/maintenance/README.md` for budgets and recovery details.

On Windows, `pwsh -File tools/maintenance/install-watcher.ps1 -Start` installs a hidden current-user Task Scheduler job that runs `watch --once` every minute, independently of agent sessions. The user must be signed in. Overlapping runs are ignored and each run is bounded to twenty minutes. `-Remove` stops and unregisters only that repository's managed task. Its most recent supervisor output is `<git-common-dir>/maintenance/watcher-last-run.log`; per-attempt receipts remain separate. The installer records executable directories under the Git common directory because scheduled tasks do not inherit the desktop session PATH. Rerun it after moving the repository or changing CLI executable locations. Installing the task does not change observation policy or provider authentication.

Docs-only revisions use generated-document checks. Other revisions install frozen dependencies with scripts disabled, check generated docs and run `pnpm verify`. The existing registered replay exception `SEALED_CHECKPOINT_MISSING:records/25-gl-repeatability-mutated-haiku_judge-failure.json` must remain a failed check until the owning evidence is properly recovered; do not synthesize or reseal it to make this pilot pass.

## GitHub and provider setup

Repository collaborators with write, maintain or admin permission can start an issue or PR comment with exactly one of these commands:

```text
/agent codex review
/agent claude docs
/agent cursor tests
/agent codex fix
```

Each provider supports `review`, `docs`, `tests` and `fix`. These explicit commands are the portable tag interface. Native `@codex`, `@claude` and `@cursor` integrations have their own installation and permission rules; this dispatcher does not intercept them. Issue text is task data and cannot grant new permissions. Bot commands, fork proposals, closed PRs and stale heads are rejected or skipped. Automatic review is opt-in via the repository variable `MAINTENANCE_AUTO_REVIEW` (`codex`, `claude` or `cursor`); leaving it unset prevents duplicate paid reviewers.

Before remote use, publish the workflow on the default branch, enable Actions, configure the chosen provider secret (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY` or `CURSOR_API_KEY`), and install/authorize that provider for the repository. A key in local `.env` is not a GitHub Actions secret. Publishing proposals needs a dedicated GitHub App with repository contents and pull-request write permissions; configure `MAINTENANCE_APP_ID` and `MAINTENANCE_APP_PRIVATE_KEY` and set `MAINTENANCE_PUBLISH_PROPOSALS=true`; the App ID is a repository variable and its private key a secret. Provider execution must not receive this publishing credential. App-created PRs allow normal subsequent CI to run; a workflow's ordinary GITHUB_TOKEN has event-trigger restrictions.

Codex/Claude execution produces an artifact in an isolated checkout. A separate trusted publisher validates paths, file types, size bounds and the current source head before opening a draft PR. The publisher never runs candidate repository scripts. The new PR must pass normal CI and review before merging. Without publishing credentials, retain the proposal artifact for manual review rather than pretending a PR was created.

Cursor Cloud uses its provider-managed isolated environment, pinned starting revision and a new branch for proposals. The local artifact validator cannot enforce paths inside Cursor's own environment; its resulting PR requires repository CI and human review. A successful API launch is only a dispatch receipt, not completion or a passing review. The workflow polls for up to ten minutes, retains the result artifact and links the provider run. It distinguishes completed, failed, superseded and still-pending work; a pending run may continue remotely after the polling budget. Observe the provider run and resulting PR before treating that work as delivered.

Remote configuration and local installation should be recorded separately from code validation. Never infer that a workflow is active, a provider is authenticated, or a deployed service is healthy solely because the corresponding files exist.

## Initial validation evidence

The documentation/retrieval generator passed 80 canonical tests; the portable KS retrieval, dispatch, publication and local-engine suites passed 78 tests. Formatting, the unchanged lint ratchet and all 21 packages' typechecks passed. A genuine local Codex run in a disposable repository produced a valid report and passed its independent test. A separate live trial exceeded its 180-second budget and correctly retained a failed receipt. Neither outcome establishes unattended reliability; the pilot policy allows fifteen minutes per job and two attempts, preserving failures for inspection.

The frozen baseline found 21 of 24 positive queries in its top three (MRR .8535) and abstained on two of four negatives. Improved ranking on the same frozen corpus found 22/24 (MRR .8938), abstaining on three negatives. The expanded eleven-concept corpus also found 22/24 (MRR .8660), with three correct abstentions. One strict original-label critical route remains outside the top three in the expanded corpus; do not claim complete retrieval acceptance.

The selected KS documentation check and isolated portability proof passed. A wider workspace rollout is blocked by the pre-existing missing registered meta file `ai-engineer-architecture/specs/research-operations-workspace/DEPLOYMENT_AND_DELIVERY.md`; no placeholder or unrelated registry deletion was introduced to bypass it. Canonical updater sources were updated in the local meta workspace; that repository has no initial commit, so its broader untracked contents were not swept into a commit for this task.
