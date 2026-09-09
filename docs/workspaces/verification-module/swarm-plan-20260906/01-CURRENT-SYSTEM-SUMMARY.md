# Verification module: current system summary

**Continuation checkpoint, 2026-09-08:** the body below preserves the September6 architecture snapshot. Start from [STATUS.md](../STATUS.md) and [ACCEPTANCE-MATRIX.md](../ACCEPTANCE-MATRIX.md) for current facts: EV159 has28 proved/11 partial/7 missing. Remote migrations and contract0.2.38 are installed; prototype cutover is accepted; the dashboard is implemented; actual Cursor Cloud, Temporal lifecycle and scheduled drift proofs passed. The temporary endpoint and disposable workers/schedules are closed. Human quality review and remaining provider/release requirements are outstanding. Do not repeat the historical pending setup or migration actions below.

Prepared 2026-09-06 after reading the Mission Control pre-spec and supplement, the full verification specification, the EV-097 handoff package, the workspace ledgers (DECISIONS, ACCEPTANCE-MATRIX, WS-07/WS-10 records), and the live source trees of `ai-engineer-knowledge-services`, `ai-engineer-mission-control`, `agents_dashboard`, and `research_ingestion_systems_agent`.

This is a navigation summary. It does not change any acceptance status. Where it says "exists", it means source and local evidence exist; it does not mean deployed, human-reviewed, or accepted.

## 1. What the module is

`@aiengineer/knowledge-verification` is the single owner of evidence-bound verification inside Knowledge Services (KS). It answers five ordered questions for every candidate result: capture integrity, selector integrity, mechanical correctness, semantic support, policy admission. Later stages cannot reverse an earlier deterministic failure. Orthogonal properties (support, world correctness, attribution faithfulness, source authority, provenance integrity) are stored separately; no aggregate score erases a failed property.

It is exposed four ways from one application core: direct first-party invocation, versioned HTTP (`apps/api`), machine-readable CLI (`apps/cli`), bounded MCP tools (`apps/mcp`). The durable worker (`apps/worker`) executes admitted operations under fenced leases. Mission Control dispatches it as a catalog-admitted capability; it never copies the algorithm.

## 2. Repository and ownership map

| Concern | Location | State |
|---|---|---|
| Shared schema, migrations, generated types, RLS | `ai-engineer-db-contract` | Local schema `20260906033000`, package `0.2.29`, 193-file canonical/vendor/installed parity. Remote last recorded at `20260906022000`; local range 221-330 is not applied remotely. Migrations 327-330 are the reconciliation ledger set. |
| Verification algorithms, contracts, application, persistence, runtime, transports | `ai-engineer-knowledge-services` | 23 workspace packages/apps plus `services/verification-parser` and `services/docling`. Turbo `typecheck test build` = 72 tasks, all passing at EV-097. |
| Orchestration consumer | `ai-engineer-mission-control` | Modular monolith: `apps/api` (Fastify), `apps/worker` (Temporal), `apps/mcp-server`, `apps/dashboard` (Next.js placeholder page only), `packages/mission-*`, `packages/missionctl`. Real local Temporal dispatch of KS verification exists (`verificationWorkflow` + `executeVerification` activity). Generic `MissionWorkflow`/`executeStage` is still a scaffold. Vendored KS client/contracts tarballs at `vendor/`. |
| Prototype / legacy owner | `research_ingestion_systems_agent` | Eve 0.44.4 verifier agent; `verify_evidence_bundle.ts` still imports legacy `@aiengineer/verification-core`. Default Eve tools disabled; `extensions/shared.ts` adds `list_research_records` (Supabase read) that must be isolated from the evidence-closed verifier. Not yet cut over. |
| Dashboard home | `ai-engineer-mission-control/apps/dashboard` | Next.js placeholder page today. Decided home for the control plane / debugger, starting with verification executions (see 02 section 4). |
| Reference only | `agents_dashboard` | Pre-research library UI (Next 16 canary, React 19, TanStack Query, shadcn, `pg`, pinned db-contract). Read for its route-handler pattern; not edited, not imported, not the dashboard home. |
| Proof runners, receipts, logs, source custody | parent `internal/` (outside any repo) | ~100 proof helper modes via `internal/verification-run-local-proof.mjs`. EV receipts and SHA-256 are recorded in the workspace review files. Must be preserved for continuation on this machine. |
| Specifications | `docs/specifications/verification-module.md`; `ai-engineer-meta/.../specs/mission-control/MISSION_CONTROL_PRESPEC.md` + `MISSION_CONTROL_SUPPLEMENT.md`; root `mission_control_dashboard.md` | Verification spec is authoritative for this module. Mission Control pre-spec is the consolidation draft toward a canonical lock; new Mission Control decisions land there. |

## 3. What exists today, by layer

### 3.1 Contracts and pure verification (`packages/contracts`, `packages/verification`, `packages/domain`, `packages/policy`)

- Strict Zod contracts for evidence, operations, benchmarks, publications, provider reconciliation; generated OpenAPI.
- Deterministic core: SHA-256 and RFC 8785 canonicalization, exact/normalized quote, offsets, JSON Pointer, identity/unit/period/arithmetic replay, deployment-independence check.
- Selector primitives with parser/selector admission (HTML DOM projection, text, PDF text + geometry). Fixed-leaf evidence binding is proved; arrays/open-object/dynamic evidence are not.
- Deep-immutable domain, separately versioned deterministic policy; deterministic failure cannot be overridden by semantics.
- Bounded synthetic semantic adapters and recorded policy-input replay. No production evidence-closed semantic verifier, no cross-family judge in production, no gold calibration.

### 3.2 Provenance, persistence, parser (`packages/persistence`, `services/verification-parser`, `packages/conversion`)

- Registered content-addressed artifacts in one private bucket; every object registered in the relational ledger; full-handle hydration, never bare-hash reconstruction.
- Frozen `diagnostics-companies` source registry: 16 sources, 17 projections (import `7a74a7a8-...`, tenant `fbfa12cf-...`), restricted offline export closure of 82 artifacts. Includes the 13 spec captures, rectification publication, the real 19-vs-21 article, and the public TruAge sample PDF. Rights are source-specific; no redistribution approval.
- Reviewed isolated parser image v2 `sha256:1669a3f9...` (16/16 admission). Independent review of the v2 Python change was still pending at handoff.

### 3.3 Structured extraction pipeline (worker + application + persistence)

End to end: API authenticates actor and resolves server-owned mission/deployment/capability context -> worker acquires fenced lease and binds code/runtime/profile/parser identity -> native profile admission hydrates immutable inputs and builds selected evidence -> accounting reserves budget and claims exactly one original dispatch -> raw response/envelope captured before interpretation -> accepted output becomes an unverified candidate (a provider is never its own verifier) -> signed success/failure publications -> terminal receipts -> replacement workers recover published results rather than redispatching.

Proved with real child-process SIGKILL and natural lease expiry: post-publication/pre-terminal recovery (EV-090) and post-dispatch/pre-response recovery with retained unknown liability and no redispatch (EV-091). Other crash windows in the matrix are not yet proved.

### 3.4 Provider reconciliation (EV-092 to EV-097)

Signed Ed25519 operator decisions bind tenant, operation/step, provider attempt, original dispatch UUID/fence, request digest, full handles, liability state, actual cost, issuer, and <=24h validity. Purpose is provider accounting only; `redispatchAuthorized` is always false. Immutable `control_plane` ledger with atomic native settlement; exact retries converge; conflicting decisions are rejected; overrun stays visible. Historical reads verify at `appliedAt` and never mint a mutation permit. Exposed over HTTP (`POST/GET .../provider-attempts/:id/reconciliation`), typed client, CLI (`knowledge reconciliation apply|show`), and MCP (`knowledge_apply_provider_reconciliation`, `knowledge_get_provider_reconciliation`). All proofs use synthetic supplier evidence; authentic billing truth is open.

### 3.5 Metrics, sealing, replay, benchmarks

- Configured mechanical metric verification (`verifyMetricObservation`), trusted provenance, terminal run recording, native sealed replay (`replayRun`).
- Benchmark input/profile/source projections, durable run execution, publication, paired comparison, crash recovery, and reads. Registered profile replay and full retained replay exist.
- Paid engineering pilot `feeb824c-...`: 39 cases / 117 calls / 110 structured successes / 7 schema failures, 709 artifacts independently replayed offline; 99,754 microUSD settled and 1,950,000 microUSD held for unknown Interfaze billing. V5 reports accepted with navigable anchors. Human gold count: zero.
- 180-candidate preparation pack reproduces against 1,186 frozen fragments; provisional leakage-grouped 90/14/76 split needs human review. Not 180 finished cases.

### 3.6 Public surfaces that exist now

HTTP (`apps/api`): `/v1/verification/captures`, `/extractions`, `/extractions/:id`, `/extractions/latest`, `/extractions:verify`, `/metrics:verify`, `/benchmarks:run`, `/benchmarks:compare`, `/benchmarks/latest`, `/benchmarks/comparisons/:id`, `/benchmarks/comparisons/latest`, `/runs/:id:replay`, `/runs/:id/cases`, `/cases/:id`, `/evidence/:id`, `/operations/:id`, reconciliation POST/GET.

CLI (`apps/cli`): `knowledge extraction run|show`, `knowledge verify extract|metric|run|manifest|cases|case|evidence`, `knowledge benchmark run|compare|show|manifest|comparison|capture`, `knowledge bundle replay`, `knowledge reconciliation apply|show`, plus operation status/events/retry/reconcile. Exit-code contract 0/1/2.

MCP (`apps/mcp`): `knowledge_capture_source`, `knowledge_extract_structured_data`, `knowledge_get_structured_extraction`, `knowledge_verify_extraction`, `knowledge_verify_metric`, `knowledge_run_benchmark`, `knowledge_compare_benchmark_runs`, `knowledge_get_benchmark_run|manifest|comparison`, `knowledge_replay_run`, `knowledge_get_verification_run|manifest|case|evidence`, `knowledge_list_verification_cases`, reconciliation apply/get.

Not on any public surface yet: `verifyClaims`, `verifyReport`, `inspectAuditBundle`, `requestAdjudication`, `parseArtifact` as a standalone use case, `knowledge demo diagnostics-companies`, `knowledge benchmark diff`, `knowledge bundle inspect`, `POST /v1/verification/reviews`.

### 3.7 Mission Control dispatch (WS-10, EV-043 to EV-048)

- `verificationWorkflow(input)` is deterministic and calls one activity `executeVerification`; the activity submits a bounded KS capability through the vendored typed client and polls durable receipts. Compact outcomes only enter Temporal history.
- Runtime registration: `KNOWLEDGE_API_URL`, `KNOWLEDGE_API_TOKEN`, `VERIFICATION_DISPATCH_GRANTS_JSON` (tenant, mission, actor, capabilityVersion); API identities via `MISSION_VERIFICATION_IDENTITIES_JSON`.
- MC HTTP: `GET /v1/verification/readiness`, `POST /v1/verification/executions`, `GET /v1/verification/executions/:workflowId`, cancel route.
- Proved locally on Temporal dev server (`verification-local`, loopback 7233): real service call, quality rejection as terminal `disposition: quality_rejected` with `state: succeeded`, queued-operation cancellation, history replay via `Worker.runReplayHistory`, and (per WS-10 recovery handoff) worker-loss reconciliation with one operation row. Nothing has run against Temporal Cloud. Cursor Cloud and Eve have not invoked the service.

### 3.8 Readiness observations already on record

- Cursor Cloud API v1 reachable read-only; 36 models include `gpt-5.6-luna`, `gpt-5.6-terra`, `claude-haiku-4-5`; none of the workspace repositories are installed for the Cursor GitHub app; KS has no origin remote. Local Cursor Agent CLI `2026.04.13-a9d7fb5` authenticated.
- Eve 0.44.4 installed; evals boot the real HTTP runtime; `mockModel` available and must be labeled as mocked inference.
- Gateway models per D-011: `openai/gpt-5.6-luna` extraction baseline, `anthropic/claude-haiku-4.5` cross-family judge, Terra for justified escalation only.

## 4. Governing decisions that bind the next session

D-001 to D-013 are accepted. The ones that constrain the work most:

- D-003: HTTP is the cross-repository contract; CLI/MCP are facades; no direct imports across repositories.
- D-005: deterministic failures are monotonic; semantics runs only on mechanically eligible bundles.
- D-007: Interfaze is an extractor, never a verifier or truth oracle.
- D-010: dashboard ships read-only experiment/evidence views before controls; controls wait for durable authenticated operation APIs.
- D-011/D-012/D-013: economical models, USD 20 recorded pilot maximum on `ws06-ws07-pilot`, minimal public-text processing grant (<=40 cases, one call per candidate, 2,000 UTF-16 chars, 10,000 bytes request, 900 output tokens). Any new live spend needs a new accepted decision.
- D-018 (accepted 2026-09-06, see 03 section 3): dashboard home is `ai-engineer-mission-control/apps/dashboard`, built as a control plane / debugger from the first slice.

## 5. Acceptance position

All 46 acceptance rows are `partial` or `missing`. None is `proved`. Green package tasks are not acceptance. Historical WS labels ("WS-01/02/03 done") describe bounded accepted slices only.

Largest open clusters, roughly in dependency order:

1. Extraction resilience for the remaining crash/cancellation windows; arrays/dynamic evidence.
2. `verifyClaims` / `verifyReport` / `requestAdjudication` / `inspectAuditBundle` as admitted cross-surface use cases with independent verifier identity and qualifier-preserving report offsets.
3. Evidence-closed semantic verifier with bounded tools, cross-family judge, abstention, and real human-labelled calibration.
4. `diagnostics-companies-v1` benchmark: human labels, atomized cases, frozen leakage groups, paired arms, one-command offline demo, four reports, refresh/diff.
5. Security (WS-09), remote migration compatibility for 221-330, deployment configuration, operational runbooks.
6. Real orchestration consumers: Temporal Cloud, Cursor (local then Cloud), Eve authored tool; then prototype parity and retirement.
7. Dashboard control plane in MC `apps/dashboard`, launch controls over durable commands, human review workflow, shadow gates, final independent audit.

## 6. Operational traps the next session must respect

- KS `.env` is remote Supabase. Local proofs go through `internal/verification-run-local-proof.mjs`, which injects local credentials in memory. Never print the Supabase status JSON.
- Do not reset local Supabase to recover state; read `LOCAL-RESET-RECOVERY.md` first.
- Settled reconciliation cohorts cannot accept new first-time decisions; create fresh preparations.
- Admission permits are in-memory branded objects with expiry; never serialize or reconstruct them.
- Build dependency exports (`contracts` -> `application` -> `persistence`/`client`/`cli`) before running proof scripts; stale `dist` can pass typecheck and fail at runtime.
- Child-process proofs use actual SIGKILL and natural lease expiry; a caught exception is not process-death coverage.
- Parent `internal/` is outside all repositories. Receipts there are referenced by SHA-256 from review files; preserve it.
- Untracked files in every repository are live work. No cleanup, reset, or commit without explicit instruction.
- Disk space on this machine ran out during the 2026-09-06 planning session (a doc write failed with "No space left on device"). Check free space before long proof runs; proof receipts, Temporal histories, and Storage objects are large. See root `HANDOFF-2026-08-23-DISK-RECLAIM.md` for prior reclaim notes.
