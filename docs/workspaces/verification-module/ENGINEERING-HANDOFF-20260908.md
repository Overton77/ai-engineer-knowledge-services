# Verification module engineering handoff

The verification integration is ready to use as the capability backbone while the team builds Mission Control. This is an engineering handoff, not approval to admit medical/company claims or promote benchmark quality. Human review, source-rights decisions, sensitive-input vendor approval, and the resulting sealed quality benchmark remain open.

## Post-handoff stabilization (EV-168, same day)

After this handoff the module was stabilized for integration: as-built docs under [`docs/verification/`](../../verification/README.md), the [`knowledge-verification` agent skill](../../../skills/knowledge-verification/SKILL.md) for CLI and MCP, CLI `--wait` grading for claims/report plus `verify status`, MCP `knowledge_get_verification_operation`, and an independent [WS-12 audit](stabilization-20260908/WS-12-COMPLETION-AUDIT.md) with all doc blockers remediated. Integration teams should use `docs/verification/` as the primary reference; this handoff stays authoritative for evidence history and the open external inputs below.

## What is ready

- KS owns the shared verification implementation and its HTTP, CLI, MCP and durable worker surfaces. Source bytes, selectors, report assertions, policies and sealed results have registered custody.
- The production Mission Control verification workflow has actual Temporal Cloud evidence for dispatch, idempotency, cancellation, failure classification, process-loss recovery and history replay. Its launch uses `REJECT_DUPLICATE`.
- Actual Cursor Cloud and Eve Luna agents have each invoked verification through Mission Control and Temporal Cloud on the same frozen `tru-symphony-source` capture. Both reports contained one declared assertion, passed deterministic checks, and ended `review_required`; semantic citation review and source authority were withheld.
- The paired CPH observations are registered as a descriptive evaluation experiment, with two actual arms and restricted comparison/transcript/report/ledger custody. It is not the diagnostics multi-arm `compareBenchmarkRuns` API and makes no human-gold or population claim.
- Dashboard supported controls cover authenticated launch, inspect, cancel, selected-run replay, human adjudication through its existing decision route, and restricted manual recovery. Browser requests go through supported server/API boundaries.
- Five-component drift detection has registered comparison/outbox/alert evidence and an actual disposable Temporal Cloud schedule proof. Persistent scheduling is an operator deployment configuration step.
- The approved 49 remote migrations and reviewed drift migration are applied. The remote migration ledger is 209; local canonical migrations are 143; the installed DB contract is 0.2.38.

## Start Mission Control integration here

Use `ai-engineer-mission-control/apps/api/src/verification-temporal.ts` and the existing `verificationWorkflow` as the capability dispatch adapter. The future parent mission/node workflow replaces the harness's seeded orchestration rows. Do not copy verification algorithms into agents or the dashboard.

Keep execution state separate from admission disposition. `completed` with `review_required` is successful execution with a held result. Credentials remain in server/activity configuration; source bytes and bearer tokens do not belong in workflow history.

Dashboard configuration is documented in `ai-engineer-mission-control/docs/VERIFICATION-CPH-RECEIPTS.md` and the recovery ledger `swarm-plan-20260906/SW-VR036-DASHBOARD-RECOVERY-CONTROL-20260908.md`. Replay and recovery use exact server-owned grants. Manual retry is restricted to deterministic replay/extraction infrastructure failures; it does not retry provider-capable, unknown, policy or quality outcomes. Generic verification promotion/suspension has no durable command yet and belongs to the future controlled promotion design.

The CPH catalog is an allowlist, not a filesystem scan. Cloud histories have one-day retention in the disposable proof namespace. A recovery-harness test accidentally reused the completed Eve workflow ID outside the production MC launch adapter. That second run had no activity and timed out after a cancellation request. The original completed Eve evidence is pinned to Temporal run `01a08332-76c1-7b11-a218-5c43a61824d8`; workflow-ID-only reads now select the later run and must not be presented as the original result. Use the retained R3 proof/history for this historical fixture. No new paid run was made to hide this issue.

## Evidence and validation

- EV160: `internal/verification-provider-cph-progress-EV160-20260908.json`; independent integrity audit verified all 11 snapshots. Matrix at this checkpoint: 30 proved, 9 partial, 7 missing.
- Eve primary lane: `internal/verification-eve-mc-cloud-0a269ad9-3681-4ef6-a7e2-b34e79bfdef6-r3.json`; original Cloud history replay and seven decoded payload objects checked. Exact Temporal/Gateway keys were checked; expired ephemeral MC/KS credentials were checked by qualified prefixes only.
- Registered comparison: `internal/verification-cph-observed-comparison-registration-65bc3c53-cf6e-43b8-9b1e-ee60b9e6bc10.json`. Experiment `b9a91a91-af48-5c78-af38-8457a2f03f6d`, comparison artifact `7ff82680-cb2d-5f3f-ac10-05359715d2b2`. A second execution reused the same canonical artifact and experiment IDs.
- Native selected-run replay: `internal/verification-dashboard-native-replay-c830275e-bd5e-4a1a-b8c6-a5b152d8a074.json`. Stable correlation and idempotency now prevent duplicate-context conflict.
- Native recovery: `internal/verification-dashboard-native-recovery-08a8496f-a46d-4d94-803a-d633dce9a83b.json`. The completion callback is an explicit synthetic fixture; signed BFF, KS HTTP schema, PostgreSQL failure/retry/lease/receipt and canonical worker are real. One manual retry event, no provider attempts, terminal success and terminal retry denial. Diagnostic cleanup: `internal/verification-dashboard-recovery-cleanup-20260908.json`.
- Current focused dashboard suite: 59 tests; production build and six isolated browser tests. API CPH projection: 18 focused tests plus native KS/Cloud read. CPH comparison contract: nine tests. Provider adapter: nine focused tests. Earlier broad accepted checks remain in the evidence log; they were not rerun unnecessarily.

Costs are qualified: the Cursor three-run cohort reports USD 0.04202667. The final Eve orchestration used two Luna dispatches; priced Gateway cost was not supplied, with USD 0.01 reserved unknown liability. These are not a total project bill and exclude earlier producer runs, coordinator usage and Temporal infrastructure. No additional model call was made for comparison registration or dashboard recovery.

## What the team must finish before quality promotion

The review pack is `catalog/verification-benchmarks/diagnostics-companies-benchmark-v1-human-review-v3/review.html`, with `pack.json` and `submission.template.json` alongside it. It has 180 blank candidates: 90 development, 14 calibration and 76 locked. No human label has been invented or substituted with model output.

Supply reviewer/adjudicator identities and authenticated annotations using the existing review tooling. Resolve source-license/access decisions and the remaining sensitive-input Interfaze account/ZDR/DPA/output-rights approval. Then run the existing sealed paired benchmark and bind the offline demo to those results. Until that happens, the offline command deliberately reports `verification_incomplete`/exit 2 and semantic-quality/calibration claims remain unproved.

The active goal remains unfinished until those acceptance gates and the final full-release audit are satisfied. The team can begin Mission Control implementation using the proved capability boundary now.
