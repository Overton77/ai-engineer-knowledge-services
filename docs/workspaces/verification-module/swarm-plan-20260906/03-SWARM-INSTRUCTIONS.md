# Swarm instructions: complete the Knowledge Verification module

Give this file to the coordinator agent. The coordinator spawns bounded subagents until the goal is complete or a genuine external blocker is reached and named exactly.

---

## 0. Goal

Complete the Knowledge Verification module as specified in `ai-engineer-knowledge-services/docs/specifications/verification-module.md`, so that:

1. all twelve public use cases are admitted end to end across application, worker, HTTP, CLI, and MCP;
2. `diagnostics-companies-v1` runs as a sealed paired benchmark with a one-command offline demo, four reports, refresh/diff, and truthful human-label accounting;
3. a real Cursor Agent and a real Eve agent complete a mini research-and-report task on the frozen TruDiagnostic / Generation Lab bundle and have it verified through Mission Control's `verificationWorkflow` on Temporal Cloud (the Consumer Proof Harness);
4. an operator can launch benchmarks and inspect results, evidence chains, and accounting in the Mission Control dashboard through supported APIs only;
5. security, remote rollout, prototype parity/retirement, and a final independent audit against all 46 acceptance rows are recorded.

Completion is measured against the specification and the acceptance matrix, not against this file. This file sequences the work; it does not shrink it.

Working directories:

- KS: `C:/Users/Pinda/Proyectos/aiengineer/ai-engineer-knowledge-services`
- DB contract: `C:/Users/Pinda/Proyectos/aiengineer/ai-engineer-db-contract`
- Mission Control: `C:/Users/Pinda/Proyectos/aiengineer/ai-engineer-mission-control`
- Prototype: `C:/Users/Pinda/Proyectos/aiengineer/research_ingestion_systems_agent`
- Dashboard home: `C:/Users/Pinda/Proyectos/aiengineer/ai-engineer-mission-control/apps/dashboard` (`agents_dashboard` is read-only reference; do not edit or import from it)
- Proof evidence: `C:/Users/Pinda/Proyectos/aiengineer/internal` (outside every repo; preserve)

---

## 1. Read first, in this order

1. `docs/workspaces/verification-module/swarm-plan-20260906/01-CURRENT-SYSTEM-SUMMARY.md`
2. `docs/workspaces/verification-module/swarm-plan-20260906/02-INTEGRATION-AND-TESTING-MODEL.md`
3. `docs/workspaces/verification-module/handoff-20260906/README.md` and every file it links (runbook, modules/invariants, remaining goals, testing, evidence/history, continuation, inventory, `snapshot.json`)
4. `docs/specifications/verification-module.md` (authoritative)
5. `docs/workspaces/verification-module/ACCEPTANCE-MATRIX.md`, `DECISIONS.md`, `work-items.yaml`, `TEST-MATRIX.md`, `STATUS.md` (tail), `LOCAL-RESET-RECOVERY.md`
6. `ai-engineer-meta/ai-engineer-architecture/specs/mission-control/MISSION_CONTROL_PRESPEC.md` sections 2, 4, 10, 12, 14, 18, 19, 21 and `MISSION_CONTROL_SUPPLEMENT.md` sections 1 and 3
7. Root `mission_control_dashboard.md`
8. Each repository's `AGENTS.md` / `CLAUDE.md` before editing in it
9. For the specific stream you own: the WS-* review/handoff files named under that stream below

Do not infer completion from any handoff. Reinspect source, `git status`, installed DB state, and receipt hashes before relying on them.

---

## 2. Non-negotiables

Engineering invariants (from the spec, DECISIONS, and the pre-spec):

- One algorithm owner: Knowledge Services. No verification logic in Mission Control, Cursor skills, Eve tools, or dashboard code.
- Deterministic before semantic; a deterministic failure is never overridden.
- Producer deployment != verifier deployment. Self-verification is rejected, including for agents.
- Immutable content-addressed evidence; full-handle hydration; display excerpts are never selectors.
- `state` (execution) and `disposition` (admission) are separate. `quality_rejected` is terminal, never an infra retry.
- No uncertain redispatch. Unknown cost is a liability, never zero.
- Append-only judgments, publications, ledgers, decisions.
- Human gold only from actual humans, labelled with annotator count and qualification. Model labels are engineering labels.
- Promotion of providers, graders, policies, benchmark versions, and canonical knowledge is human-controlled.
- New shared schema only in `ai-engineer-db-contract`; consumers pin generated types; applied migrations are immutable (add follow-ups).
- No secret values in prompts, configs, events, artifacts, logs, or chat.
- Cross-repository consumers use HTTP client / CLI / MCP; no workspace-relative imports.
- Do not delete or retire legacy implementations until parity, cutover, and rollback evidence exist.

Operational rules:

- Never load KS `.env` for local proofs; use `internal/verification-run-local-proof.mjs`. Never print Supabase status JSON.
- Never reset local Supabase. Read `LOCAL-RESET-RECOVERY.md` before any recovery action.
- Never clean, reset, discard, or commit untracked work without explicit user instruction.
- Build `contracts` -> `application` -> `persistence`/`client`/`cli` before running proof scripts.
- Child-process crash proofs use actual SIGKILL and natural lease expiry.
- Do not rerun spent pilot budgets, settled cohorts, or consumed preparations to obtain fresh timestamps.
- Do not acquire gated reports by bypassing authentication, submitting forms, or accepting terms.
- Economical models by default (D-011): Luna for extraction/agent lanes where acceptable, Haiku for cross-family judging, Terra only with recorded justification.
- Check subprocess exit codes separately from trailing shell commands.

---

## 3. Decisions the user must make (proposed defaults included)

Everything not listed here is already authorized and should proceed. For the items below, do all preparatory work, then stop at the spend/mutation boundary and put the question at the end of a turn that also delivers progress.

| ID | Decision needed | Proposed default (coordinator may prepare against it, not execute) |
|---|---|---|
| D-014 | Spending cap for Consumer Proof Harness agent-lane runs (Cursor local, Cursor Cloud, Eve live) and for the semantic-judge calibration slice | Recorded maximum USD 25 across all CPH runs on a new isolated budget `cph-20260906`, per-call caps as D-013, stop on three consecutive provider failures. Cursor Cloud runs draw Cursor credits and are counted separately. |
| D-015 | Human labels for `diagnostics-companies-v1` | The user labels the atomized case package as single annotator; results recorded as `human_single_annotator`, not adjudicated gold. Dual annotation remains open. |
| D-016 | Temporal Cloud namespace, task queue naming, credential delivery | Namespace as provisioned by the user; task queue `verification`; `TEMPORAL_ADDRESS` / `TEMPORAL_NAMESPACE` / `TEMPORAL_API_KEY` by environment; never printed. |
| D-017 | Reachable KS/MC endpoint for Cursor Cloud lane | A test deployment or authenticated tunnel with HTTPS and short-lived bearer; loopback is not acceptable for Cloud. The coordinator proposes the concrete mechanism after inspecting `infra/aws` and existing deployment notes. |
| D-018 | Dashboard home | **Accepted by the user 2026-09-06:** `ai-engineer-mission-control/apps/dashboard` is the only dashboard home, built as a control plane / debugger from the first slice (four-zone Live view scoped to verification executions). Stack: Next 16 App Router, React 19, TanStack Query, shadcn + Tailwind 4, Playwright. `agents_dashboard` is reference only and is not edited. Record in `DECISIONS.md` as accepted. |
| D-019 | Remote migration application of 221-330 | Not applied until `REMOTE-MIGRATION-COMPATIBILITY-BRIEF.md` review is refreshed against actual remote history and the user approves the window. |

Record each accepted decision in `DECISIONS.md` with the template before acting on it.

---

## 4. Coordinator protocol

### 4.1 Bootstrap

1. Read the files in section 1. Record the start-of-session `git status --short` for each repository in the ledger.
2. Verify parent `internal/` exists and spot-check three receipt hashes from `snapshot.json`.
3. Confirm local infrastructure with bounded non-secret checks (Postgres 54322, API 54321, parser image `sha256:1669a3f9...` present, Temporal dev server if needed). Do not start duplicate workers; identify live processes by handle.
4. Refresh `work-items.yaml` with the streams below. Every item has: owner, owned files, invariant it protects, required proof, current state.
5. Open a session ledger `docs/workspaces/verification-module/swarm-plan-20260906/LEDGER.md` and append after every accepted slice: EV number (continue from EV-098), owner, exact command, exit code, fixture IDs, receipt path + SHA-256, limitations, next gap.

### 4.2 Spawning subagents

- One owner per stream; disjoint write sets; the coordinator is the only writer of `ACCEPTANCE-MATRIX.md`, `DECISIONS.md`, and `LEDGER.md`.
- Each subagent prompt must include: the stream section below verbatim, the read-first list for that stream, the write set, the invariants it must not violate, the exact proof it must produce, and the instruction not to claim completion beyond its slice.
- Prefer sequential subagents for anything that touches the database, Storage, or paid providers. Parallel subagents are fine for disjoint source packages, documentation, dashboard UI, and read-only investigations.
- Every material change receives an independent review subagent that did not write the code, reading the receipts and rerunning the audit mode. Reviews go in `WS-*-REVIEW.md` files following the existing naming.
- Use economical models for inventory, scaffolding, tests, and documentation. Reserve the strongest available model for native SQL authority, custody, recovery semantics, and security review.
- If subagent spawning is unavailable, continue locally in the same order.

### 4.3 Evidence convention

For each proof state what is real, simulated, injected, historical, or human-reviewed. Grouped check counts are report keys, not test counts. Record source and configuration digests, frozen dataset ID, command and exit code, artifacts and signatures, independent audit receipt, limitations, next gaps. Never promote an acceptance row on a narrow proof. Historical source hashes that no longer match mean "new proof needed", not "old run never happened".

---

## 5. Workstreams

Streams are numbered SW-01 to SW-11. Each lists goal, primary inputs, write set, steps, exit evidence, and forbidden actions. "Exit evidence" is what the coordinator needs to accept the slice; acceptance rows move only when a row's whole requirement is proved.

### SW-01 Extraction resilience and evidence coverage

Goal: prove the remaining crash and cancellation windows in `04-TESTING.md`; extend evidence support to arrays/dynamic keys with per-leaf native binding.

Inputs: `apps/worker/src/verification-structured-extraction-runtime.ts`, native capture/lifecycle/candidate/publication stores, `WS-08-STRUCTURED-EXTRACTION-PROCESS-REVIEW.md`, `WS-08-STRUCTURED-EXTRACTION-DISPATCH-REVIEW.md`, existing process/dispatch recovery child scripts.

Write set: `apps/worker/src/verification-structured-extraction-*`, `packages/application/src/verification-structured-extraction-*`, `packages/persistence/src/verification-structured-extraction-*`, new proof scripts under `scripts/` and parent `internal/`, follow-up db-contract migration only if a native guard is missing.

Steps:
1. For each unproved window (before reservation; reserved before dispatch; raw bytes registered before capture checkpoint; capture before accounting; accounting before interpretation; candidate before provenance; retention before publication; cancellation at each window) extend the real child harness to stop at the checkpoint, SIGKILL, wait for exit and natural lease expiry, then resume or cancel through the real API.
2. Count external dispatches independently. Assert exact before/after rows for operation, step, lease, provider, budget, lifecycle, capture, publication, receipt/outbox, artifacts.
3. Fix exposed defects; re-prove with fresh isolated cohorts; independent audit mode per window.
4. Arrays/dynamic evidence: design per-leaf source binding and selector coverage; add duplicate/missing index checks; bounded schema expansion. Do not relax the fixed-leaf gate.

Exit evidence: one EV per window group with receipt + audit; no duplicated provider call; no fabricated candidate or response; arrays proof with complete leaf lineage. VR-004/VR-007/VR-018 evidence appended.

Forbidden: replacing process death with caught exceptions; starting duplicate workers after a tool timeout; redispatching uncertain calls.

### SW-02 Claims and report verification use cases

Goal: admit `verifyClaims`, `verifyReport`, `requestAdjudication`, `inspectAuditBundle`, and standalone `parseArtifact` as end-to-end use cases across application, worker, HTTP, CLI, MCP, with independent verifier identity and qualifier-preserving report offsets. This is the critical path for SW-06 and SW-07.

Inputs: spec sections 7, 8.4, 8.5, 11, 17-19, 24, 27; `packages/verification/src/{claims,authority,semantic,provenance}`; `packages/application/src/verification*`; existing metric/extraction use-case wiring as the pattern; `HANDOFF-WS-05.md`, `SEMANTIC-POLICY-REVIEW.md`.

Write set: `packages/contracts/src/verification/*` (new request/response shapes, OpenAPI regeneration), `packages/verification/src/claims|authority|provenance`, `packages/application/src/verification-claims-*`, `verification-report-*`, `verification-adjudication-*`, `verification-audit-bundle-*`, `packages/persistence/src/verification-claims-*`, `apps/worker/src/verification-claims-*`, `apps/api/src/verification-*` routes, `apps/cli/src/commands.ts` (`verify citations`, `verify report`, `bundle inspect`, `review request`), `apps/mcp/src/index.ts` (`knowledge_verify_claims`, `knowledge_verify_report`, `knowledge_inspect_run`, `knowledge_request_adjudication`), `packages/client-typescript/src/client.ts`. Db-contract follow-up migrations for report assertion spans, claim temporal scope, human-review items if the current schema lacks them (the pre-spec already lists these as approved bounded gaps).

Steps:
1. Reconcile the TypeScript and database claim-type vocabularies into one versioned taxonomy or an explicit lossless mapping (spec 16.2). Record the decision.
2. Contract: assertion kinds `claim` and `report`, evidence edges with declared vs verifier-found status, judgment records append-only, report-wide check results, policy outcome separate from verdict.
3. Application: `verifyClaims` = selector resolution -> deterministic entity/number/quote checks -> semantic stage (SW-03 port; deterministic-only mode must work and be labelled) -> authority/independence vector -> policy. `verifyReport` = claim coverage, citation correctness vs completeness as independent metrics, consistency, unsupported high-severity detection, qualifier preservation, policy admission.
4. `requestAdjudication`: authorized bounded queue item with evidence handles and failure context; immutable reviewer decisions; conflict handling; later decisions coexist.
5. `inspectAuditBundle`: validate and summarize a sealed run bundle; version and corruption failures typed.
6. Worker: durable operation kinds, leases, terminal receipts, quality vs infra distinction.
7. Transports: HTTP `claims:verify`, `reports:verify`, `reviews`, run/bundle reads; CLI; MCP; client; OpenAPI and typed client regenerated; cross-surface golden parity test (VR-022).
8. Prohibited-authority tests: same-deployment refusal, caller-supplied verifier identity rejected, display excerpt as selector rejected, out-of-range citation typed as pointer failure.

Exit evidence: one frozen fixture (a short report over the diagnostics bundle) verified identically through direct application, worker, HTTP, CLI, MCP with equal result hashes where deterministic; receipts and independent audit; VR-010/VR-011/VR-012/VR-014/VR-022 evidence appended.

Forbidden: embedding provider SDK types in contracts; aggregate scores that hide component results; letting semantics run on mechanically failed bundles.

### SW-03 Evidence-closed semantic verifier

Goal: production-shaped stage 4 with bounded tool surface, cross-family judge, abstention, drift observability, and calibration against human labels once D-015 delivers them.

Inputs: spec 11.3, 11.4, 13, 14, 24, 25; `packages/verification/src/semantic`, `packages/verification/src/providers`; `PROVIDER-REVIEW.md`, `SEMANTIC-POLICY-REVIEW.md`; D-011/D-013 limits; Gateway configuration in `packages/config`.

Write set: `packages/verification/src/semantic/*`, `packages/verification/src/providers/*`, `packages/application/src/verification-semantic-*`, `packages/config` semantic/judge configuration, provider registry entries with promotion state `lab`, proof scripts.

Steps:
1. Define the `SemanticJudge` port contract: blinded input artifact hash, fragment IDs only, categorical verdict lattice, unsupported facets, calibrated probability slot, public rationale, provider identity and cost; no tools, no network, no delegation.
2. Implement the Haiku evidence-only rubric judge and a three-way NLI adapter (or record why NLI is deferred). Register both in the provider registry as `lab`.
3. Capability inspection test: prove the runtime tool catalog for the judge is empty of shell/filesystem/web/delegation. Prompt-injection fixtures in source text and provider metadata must not change verdicts.
4. Cross-family second judge on high-risk/disagreement; abstention path to `requestAdjudication`.
5. Drift: record model/version per judgment; scheduled comparison fixture; alert-class event when returned model differs from requested.
6. Calibration: only after human labels exist (D-015); reliability diagram, Brier, ECE, risk-coverage on calibration split only. Until then, label every quality number `engineering_label`.

Exit evidence: judge conformance suite with recorded fixtures; prohibited-tool eval; injection resistance; drift fixture; receipts. VR-013/VR-017/VR-031 evidence appended.

Forbidden: enabling Interfaze `ask_interfaze`/browse/GUI/file tools; letting the judge see unauthorized fragments; treating provider confidence as calibrated.

### SW-04 `diagnostics-companies-v1` benchmark, reports, demo command

Goal: finish the mandatory pack (spec 15.9): atomized cases, human-label package, frozen leakage groups, paired arms, adversarial mutations, four reports with navigable evidence, machine ledgers, one-command offline demo, refresh/diff.

Inputs: `WS-07-INDEPENDENT-ACCEPTANCE.md`, `HANDOFF-WS-07.md`, `HANDOFF-FROZEN-SOURCE-REGISTRY.md`, `catalog/verification-benchmarks/diagnostics-companies-benchmark-v1-preparation-v3/manifest.json`, `WS-08-BENCHMARK-*`, spec 15.9.1-15.9.6, D-012/D-013.

Write set: `catalog/verification-benchmarks/*` (new immutable versions only), `packages/evaluation/src/verification*`, `packages/verification/src/experiments|demos`, `apps/cli/src/commands.ts` (`demo diagnostics-companies`, `benchmark diff`), report generators, proof scripts, `internal/` receipts.

Steps:
1. Case atomization from the 180-candidate pack into assertion-level cases with gold-label slots for all nine families in 15.9.3; keep the leakage components indivisible; fix or justify the 90/14/76 imbalance before freezing.
2. Human-label package for the user (D-015): a reviewable artifact (JSON + rendered HTML) where each case shows the assertion, the exact fragment, and the label choices; import path that records annotator identity and count; leave labels empty until the user fills them.
3. Paired arms on identical frozen cases: baseline Luna, Interfaze, Luna->Interfaze second opinion, Interfaze->Haiku cross-family, consensus-with-abstention. Repeated runs where budget allows. Shared cached calls only by exact digest with attribution.
4. Statistics: clustered paired bootstrap, McNemar, effect sizes, multiple-comparison correction, calibration on calibration split only, worst-slice and catastrophic errors, cost/latency/stability, review burden. Truthful denominators; missing is not zero.
5. Adversarial mutations (name/algorithm/count/institution/biomarker/timeline/citation/qualifier swaps; invented head-to-head) must degrade monotonically.
6. Reports: `trudiagnostic-research-report`, `generation-lab-research-report`, `diagnostics-comparison-report`, `verification-audit` in HTML + Markdown/JSON; every factual statement has an assertion -> fragment path; company claim / research finding / reviewer inference / unresolved labelled visibly; no patient-specific advice; conflicts (19 vs 21, 2-4 vs 3-4 weeks, count changes) visible.
7. `knowledge demo diagnostics-companies --dataset diagnostics-companies-v1 --output <dir>`: offline from frozen captures; validates fixture integrity, runs extraction and claim/report verification, applies mutations, generates reports, replays, exits per contract. Audit report shows each of the ten required paths in 15.9.5.
8. `knowledge benchmark capture ... --propose-version v2` and `knowledge benchmark diff v1 v2`: new immutable version and drift report; v1 untouched.

Exit evidence: sealed paired manifest and reports; CLI e2e with artifact inventory; offline replay reproduces digests; pack gates in 15.9.6 evaluated one by one with pass/fail and the human-label status stated. VR-008/VR-019/VR-020/VR-021/VR-037 to VR-046 evidence appended.

Forbidden: new paid runs before D-014 acceptance; reproducing full copyrighted pages in reports; relabelling engineering labels as gold; silently reconciling counts.

### SW-05 Case/score, export/replay completeness

Goal: audit dataset/case/label/variant/grader identities and immutability; persist all generated case and score outputs with engineering-label provenance; extend disconnected export/replay to every operation with signed manifest; test missing/corrupt/unsupported-version evidence and drift.

Inputs: `WS-08-FULL-RETAINED-REPLAY-PLAN.md`, `WS-08-RECORDED-BENCHMARK-REPLAY-HANDOFF.md`, `WS-08-SEALED-REPLAY-ACTIVITY-HANDOFF.md`, spec 8.6, 28.5, 30.

Write set: `packages/evaluation/src/verification*`, `packages/verification/src/provenance`, `packages/application/src/verification-replay-*`, `apps/cli` (`bundle inspect`), proof scripts.

Exit evidence: a sealed bundle replays the promised scope offline with no workspace-only files; typed failures for corruption, missing evidence, unsupported version, source/runtime drift. VR-019/VR-029/VR-030/VR-035 evidence appended.

### SW-06 Consumer Proof Harness: Temporal Cloud + Cursor + Eve

Goal: run the real agent tests described in `02-INTEGRATION-AND-TESTING-MODEL.md` section 3. Depends on SW-02 (claims/report use cases) and D-014/D-016/D-017. Temporal Cloud connection work can start immediately.

Inputs: `WS-10-*`, `EVE-INTEGRATION-PREPARATION.md`, `CURSOR-CLOUD-IMPLEMENTATION-BRIEF.md`, MC `apps/worker/src/verification-*`, MC `apps/api/src/verification-*`, MC `.env.example`, MC `docs/architecture/0001-runtime-and-deployment.md`, prototype `agents/verification/agent/*`, spec 20-22.

Write set: MC `apps/worker`, `apps/api` (Temporal Cloud connection profile, readiness), MC `skills/` (verification skills per spec 22), MC `catalog/capabilities` (KS verification capability descriptors), KS `scripts/cph-*`, prototype `agents/verification/agent/tools/verify_evidence_bundle.ts` and `extensions/shared.ts` isolation, parent `internal/cph-*` receipts, a CPH README under this folder.

Steps:
1. Temporal Cloud: connect the MC worker with environment credentials (D-016); run the existing `verificationWorkflow` against the local KS on a metric fixture; retain workflow ID, history export, replay. This is EV-098 candidate territory and can run before SW-02 finishes.
2. Seed CPH orchestration rows (tenant, mission, work items, attempts) through canonical db-contract functions; record IDs in the receipt; mark them `fixture` in the receipt table.
3. Register the KS verification capability descriptors in MC `catalog/capabilities` with exact versions and `verification` task queue. Discovery does not grant authority; MC runtime grants do.
4. Author the Cursor skills (`verify-report`, `verify-source-attribution`, `verify-extraction`, `replay-verification-run`, `adjudicate-verification`, `run-extraction-benchmark`) as operational instructions that call `knowledge` CLI or MC HTTP. Fixture-test each skill's invocation text against the real CLI help and exit codes.
5. Lane A local: Cursor Agent CLI headless in a scratch workspace with the exported frozen bundle manifest, `knowledge` CLI on PATH, scoped KS/MC bearer by environment. Task: short evidence-cited report on one company; submit for `verifyReport` via MC launch; read disposition. Retain transcript as a restricted registered artifact.
6. Lane A Cloud (after D-017): bounded no-repo or fixture-repo run, economical model, envVars existence-checked, PR creation disabled, agent archived not deleted. Same task, same identities.
7. Lane B: cut over `verify_evidence_bundle.ts` to a KS-client-backed tool; prove the runtime tool catalog excludes `list_research_records` and default tools; Eve eval against the real HTTP runtime with the deterministic assertions listed in 02 section 3.4; then one live-model run of the mini report task.
8. Cross-lane comparison recorded as a benchmark comparison: claims, dispositions, deterministic-stage failures, cost, latency.
9. Negative cases in each lane: wrong tenant/mission identity rejected; corrupted locator rejected; producer==verifier rejected; cancellation from MC reaches KS; retry with same idempotency key converges.

Exit evidence: CPH receipts with the real/stand-in table filled, Temporal Cloud workflow IDs and histories, KS operation IDs, agent run IDs, model IDs, cost; independent audit; VR-023/VR-024/VR-025 evidence appended with exact scope (local vs Cloud, mocked vs live model).

Forbidden: giving agents provider keys or Temporal credentials; putting bearer tokens in prompts; implementing MissionDefinition/graph/spawn/commands here; claiming Cloud proof from local runs; loading KS `.env`.

### SW-07 Dashboard: verification control plane / debugger in Mission Control

Goal: the first dashboard slice in `02-INTEGRATION-AND-TESTING-MODEL.md` section 4, in **`ai-engineer-mission-control/apps/dashboard` only** (D-018, accepted). It is a debugger from day one: the four-zone Live view (health bar, topology, live event stream, inspector + command composer, output rail) scoped to verification executions, plus benchmark / run / evidence / extraction / CPH pages. Reads through supported APIs; mutations only through Mission Control's durable routes and KS control actions.

Inputs: root `mission_control_dashboard.md` (sections 3, 5, 6, 7, 9, 15, 16, 21), pre-spec section 18, `02-INTEGRATION-AND-TESTING-MODEL.md` sections 4.2-4.5, KS OpenAPI and `packages/client-typescript`, MC `apps/api/src/verification-http.ts`, MC `apps/dashboard` current files, D-010, VR-032/VR-036. `agents_dashboard` may be read for its route-handler + TanStack pattern; it is never edited or imported.

Write set: MC `apps/dashboard/**` following the layout in 02 section 4.4 (`app/(control-plane)/verification/*`, `app/api/knowledge|mission-control/[...path]/route.ts`, `src/server`, `src/features/{live-view,executions,benchmarks,runs,extractions,harness}`, `src/components/ui`, `src/lib`, `e2e/`), `apps/dashboard/package.json`, dashboard ESLint config, and MC `turbo.json`/root scripts only if needed to include dashboard typecheck/test/e2e in `pnpm verify`.

Steps:
1. Inspect the current `apps/dashboard` (placeholder page, `next.config.ts`, `vercel.json`, `tsconfig.json`) and MC workspace conventions. Pin Next 16 App Router, React 19, TanStack Query, shadcn + Tailwind 4, Playwright; record versions in the ledger. No `pg`, no Supabase, no db-contract runtime import.
2. Scaffold the folder structure from 02 section 4.4 first, with ESLint import-boundary rules and `server-only` markers, before writing features. Keep `app/page.tsx` as a landing that links into the control-plane group.
3. `src/server`: KS and MC typed clients wrapping the published client package, token and tenant resolution from server session, DTO mappers that strip upstream internals (no full manifests, no object keys, no billing details beyond compact accounting). Route handlers validate params with Zod and return DTOs only.
4. `features/live-view`: build the four zones as composable components with a topology adapter interface (verification execution now, mission later), a normalized event model with typed families (temporal, worker, provider, verification, accounting, human), coalescing as presentation only, cursor-based tail through route-handler polling with the transport isolated so a WebSocket gateway can replace it later, an inspector that shows the selected scope and its receipts/grants/identities, and a command composer whose commands are exactly: cancel execution (MC), retry / reconcile operation (KS control actions), request adjudication (after SW-02). Render `accepted -> delivered -> observed` from API state; never optimistic success. `state` and `disposition` are two fields everywhere.
5. Pages: executions list + launch composer (`runBenchmark`, `verifyReport`, `verifyExtraction`, `verifyMetricObservation` with frozen inputs by handle and policy version) -> MC `POST /v1/verification/executions` with server-minted idempotency key; benchmarks list/detail/comparison with truthful denominators; run -> cases -> evidence with deterministic vs semantic findings separate and verdict -> fragment -> manifest round trip; extraction operations with provider attempt state and original vs reconciled accounting; CPH receipts view rendering the real-vs-stand-in table.
6. States: loading, empty, error, denied, cross-tenant. Failure taxonomy rendered distinctly (provider vs harness vs quality vs policy). Role checks on every command.
7. Playwright: Live view renders for a real local execution; cancel shows durable delivery state; verdict -> fragment -> manifest round trip; launch requires role; client bundle contains no database or secret configuration.
8. Architecture inspection note proving no direct canonical-table access and no verification logic in the dashboard; add dashboard typecheck/lint/test/e2e to MC `pnpm verify`.

Exit evidence: dashboard running against local KS + MC with at least one real execution driven end to end from the launch composer through the Live view to a terminal disposition; Playwright traces and screenshots retained; route/auth tests; import-boundary lint passing; VR-032 and VR-036 evidence appended (VR-036 only for the controls that exist).

Forbidden: building in `agents_dashboard` or any third app; direct Supabase/Postgres access from browser or route handlers; verification algorithms or status derivation logic duplicated in the UI; optimistic command success; exposing full internal manifests or object keys; claiming acceptance from API tests alone.

### SW-08 Security, operations, remote rollout

Goal: WS-09 threat model execution and adversarial suite; outage and retry classes; clean-environment setup; deployment configuration; remote migration compatibility review for 221-330; runbooks.

Inputs: `THREAT-MODEL-DRAFT.md`, `SECURITY-REVIEW-PLAN.md`, `REMOTE-MIGRATION-COMPATIBILITY-BRIEF.md`, `REMOTE-DEPLOYMENT-PREPARATION.md`, `RISKS.md`, spec 9.1, 25, 26, 27.

Write set: KS `packages/acquisition` (URL/network policy), `packages/config`, `apps/api` auth tests, `services/verification-parser` limits, security proof scripts, runbooks under `docs/workspaces/verification-module/`, db-contract RLS follow-ups if gaps are found.

Steps: cross-tenant RLS under actual roles; signed URL expiry; missing objects and collisions; SSRF/private-address/redirect; parser isolation, decompression and schema bombs; secret scans of manifests, logs, events; retention/deletion controls; ZDR header test; DB/Storage/provider outage behaviour and retry classification; read-key revocation policy; refreshed remote history inspection and a written compatibility plan (execution waits for D-019); deployment configuration with health and capability checks; rollback runbook.

Exit evidence: adversarial suite receipts; threat model with each threat mapped to a control and a test; remote compatibility plan; clean-environment setup log. VR-017/VR-026/VR-027/VR-028/VR-029 evidence appended.

Forbidden: applying remote migrations without D-019; weakening ownership matching to make a test pass.

### SW-09 Prototype parity and retirement

Goal: measure old/new algorithm parity, cut consumers over to the service/client, record rollback and compatibility period, then retire duplicate algorithms explicitly.

Inputs: spec 30, D-004, `research_ingestion_systems_agent` verification agent and `@aiengineer/verification-core`, `MIGRATION-MAP.md`, SW-06 Eve cutover results.

Write set: prototype repository (compatibility adapter, import replacement), KS parity proof scripts, `MIGRATION-MAP.md` updates.

Steps: freeze prototype fixture results; run identical fixtures through KS; byte/semantic parity report; replace imports with client; compatibility period recorded; deletion targets listed explicitly for the coordinator; retire only after SW-06 lanes pass.

Exit evidence: parity report, consumer cutover evidence, recorded rollback path. VR-001/VR-033 evidence appended.

Forbidden: deleting prototype code before parity and cutover evidence; a second copy of any algorithm.

### SW-10 Human review workflow and shadow gates

Goal: the human adjudication workflow end to end (queue from SW-02, dashboard cards from SW-07, immutable decisions), then a bounded production-shadow run against approved gates.

Inputs: spec 11.3 step 5, 23, 29 Phase 7, D-015, SW-02 adjudication queue, SW-07 dashboard.

Write set: KS adjudication application/persistence (if not fully covered in SW-02), MC dashboard human-task cards for verification reviews, shadow-run proof scripts.

Steps: reviewer authorization and conflict handling; original evidence/time/version binding; immutable decisions with later coexistence; audit access; shadow verification on a bounded slice of real research/ingestion output compared against human adjudication; drift, disagreement, review volume, cost, latency recorded against the gates in spec 15.8.

Exit evidence: review e2e receipts; shadow-run report with truthful denominators; gates evaluated pass/fail. VR-014/VR-036 evidence appended.

Forbidden: enforcing admission on production paths before sustained gates pass; inventing human decisions.

### SW-11 Final independent audit

Goal: audit every specification deliverable, use case, numbered command, artifact, and all 46 acceptance rows against actual evidence; produce the final report.

Inputs: everything above; `ACCEPTANCE-MATRIX.md`; `LEDGER.md`.

Write set: `docs/workspaces/verification-module/FINAL-AUDIT-<date>.md`, `ACCEPTANCE-MATRIX.md` (coordinator only).

Steps: derive a checklist from the spec; for each item inspect source/runtime/artifact evidence at matching scope; missing, stale, indirect, or simulated evidence cannot satisfy a deployed/human requirement; verify old-consumer retirement and rollback; rerun the full workspace `typecheck test build`; retain the report with command outputs and artifact IDs.

Exit evidence: the audit report; matrix rows updated only where fully proved; an explicit list of any rows that remain open with the exact external action required. VR-034.

---

## 6. Sequencing and parallelism

```text
Wave 1 (parallel, disjoint writes)
  SW-01 extraction resilience            (worker/application/persistence extraction files)
  SW-02 claims/report use cases          (contracts/verification/application/api/cli/mcp claims files)  <- critical path
  SW-03 semantic verifier                 (verification/semantic, providers, config)
  SW-04 steps 1-2 (case atomization, human-label package)   (catalog, evaluation)
  SW-06 step 1 (Temporal Cloud connection with existing metric fixture)   (MC worker/api)
  SW-07 steps 1-5 scaffold, server layer, live-view, pages over existing MC/KS routes   (MC apps/dashboard)
  SW-08 threat-model execution that needs no new surfaces                  (acquisition/config/parser)

Wave 2 (after SW-02 lands and D-014/D-016/D-017 are accepted)
  SW-06 steps 2-9 (CPH lanes A and B)
  SW-04 steps 3-8 (paired arms, reports, demo, refresh)  -- paid arms wait for D-014
  SW-05 export/replay completeness
  SW-07 steps 6-8 (states, role checks, Playwright, architecture note, verify integration) + request-adjudication command once SW-02 lands
  SW-03 calibration (after D-015 labels arrive)

Wave 3
  SW-08 remote compatibility plan and deployment configuration (execution waits for D-019)
  SW-09 parity and cutover (after SW-06 lanes pass)
  SW-10 human review workflow and shadow gates

Wave 4
  SW-09 retirement
  SW-11 final audit
```

Rules: no two subagents write the same package concurrently; database and paid-provider work is serialized; the coordinator reviews each accepted slice before the next dependent slice starts.

---

## 7. Reporting back to the user

At the end of each wave, and whenever a decision in section 3 becomes blocking, deliver a short report that contains, in this order:

1. What was proved this wave (EV numbers, one line each, with receipt path and SHA-256).
2. Acceptance rows whose evidence changed, and whether any row moved to `proved`.
3. What is real vs stand-in in every agent/Cloud/human claim.
4. Decisions needed from the user, each with the proposed default and what is blocked without it.
5. Spend to date against each accepted budget, including unknown liabilities.
6. Next wave plan.

Do not send progress prose without receipts. Do not ask for permission already granted in DECISIONS or in this file.

---

## 8. Completion protocol

Before declaring the goal complete:

- Every item in spec sections 7, 15.9.4-15.9.6, 17, 18, 19, 33, and 34 has matching evidence at matching scope.
- All 46 rows in `ACCEPTANCE-MATRIX.md` are either `proved` with receipt references or listed with the exact external action still required (named human, named credential, named deployment) and why engineering cannot substitute.
- SW-11's report is retained and referenced from `STATUS.md`.
- Every repository's `git status` at end of session is recorded; nothing was reset, cleaned, or committed without instruction.
- All proof workers, API listeners, and Temporal workers started by this session are stopped; long-lived infrastructure state is recorded, not inferred.

If a genuine impasse is reached, name it precisely and continue every other stream to completion. Scaling down the goal is the user's decision, not the coordinator's.
