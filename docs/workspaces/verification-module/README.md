# Verification Module Implementation Workspace

## Integration and deployment entry point — 2026-09-08 (EV-168)

If you are integrating with or deploying the module, start with the as-built documentation, not this workspace:

- [docs/verification/README.md](../../verification/README.md) — module guide; [OPERATOR-RUNBOOK](../../verification/OPERATOR-RUNBOOK.md), [DEPLOYMENT](../../verification/DEPLOYMENT.md), [INTEGRATION-GUIDE](../../verification/INTEGRATION-GUIDE.md), [SURFACE-REFERENCE](../../verification/SURFACE-REFERENCE.md).
- Agent skill for CLI and MCP: [skills/knowledge-verification/SKILL.md](../../../skills/knowledge-verification/SKILL.md).
- Package internals: [packages/verification/README.md](../../../packages/verification/README.md).
- Stabilization ledgers, code-derived inventory and the independent WS-12 audit: [stabilization-20260908/](stabilization-20260908/).

This workspace remains the historical coordination ledger (acceptance matrix, evidence log, decisions). Where it conflicts with `docs/verification/`, the as-built docs win.

## User-requested session handoff — 2026-09-06

Start with [the detailed handoff package](handoff-20260906/README.md). It contains the operating runbook, current modules/invariants, complete remaining-goal and testing plans, evidence history, fresh-task continuation prompt, verbatim 46-row acceptance snapshot and machine-readable source/evidence inventory. Latest engineering evidence is EV-097. The full goal remains unfinished (26 partial and20 missing acceptance rows). The user requested these handoff files and will decide the next move; wait for that instruction before resuming implementation. This documentation checkpoint is not a new engineering acceptance claim.

This directory is the shared coordination surface for the coordinator and implementation-agent swarm building the Knowledge Verification capability.

## Objective

Implement the approved [Knowledge Verification Module specification](../../specifications/verification-module.md) as the single reusable verification capability for Cursor Cloud Agents, EVE, other agent frameworks, Knowledge Services workers, Mission Control, and Agents Dashboard.

## Baseline warning

At workspace creation time, `ai-engineer-knowledge-services` has no commits and every scaffold file is untracked. Several source repositories containing verification code and database migrations are also dirty or untracked. Before parallel implementation or worktree creation, the coordinator must create or explicitly record a preservation checkpoint. No agent may delete, overwrite, or “clean up” pre-existing untracked work.

## Sources of truth

In precedence order:

1. approved specification: `docs/specifications/verification-module.md`;
2. decisions recorded in `DECISIONS.md`;
3. acceptance requirements in `ACCEPTANCE-MATRIX.md`;
4. work ownership and dependencies in `WORKSTREAMS.md`;
5. live coordination state in `STATUS.md`;
6. machine-readable assignments in `work-items.yaml`;
7. source-to-target movement in `MIGRATION-MAP.md`;
8. required proof in `TEST-MATRIX.md`;
9. evidence recorded in `EVIDENCE-LOG.md`.

Existing research and prototype sources are inputs, not alternate owners:

- `../research_ingestion_systems_agent/VERIFICATION_SYSTEM_TECHNICAL_DECISIONS.md`;
- `../research_ingestion_systems_agent/VERIFICATION_AGENT_RESEARCH_AND_PROTOTYPE_PLAN_2026-08-27.md`;
- `../research_ingestion_systems_agent/packages/verification-core`;
- `../research_ingestion_systems_agent/packages/contracts/src/verification.ts`;
- `../research_ingestion_systems_agent/INTERFAZE_EXPERIMENT_DESIGN.md`;
- `../research_ingestion_systems_agent/experiments/interfaze-lab`;
- canonical migrations in `../ai-engineer-db-contract/supabase/migrations`.

## Coordinator protocol

1. Establish the preservation checkpoint and run the baseline verification command.
2. Resolve or record every P0 decision in `DECISIONS.md`.
3. Assign one owner to every active workstream and non-overlapping owned paths.
4. Agents claim work by updating `STATUS.md` before editing.
5. Cross-repository changes require a named owner and dependency entry.
6. Agents record exact commands, results, artifacts, and hashes in `EVIDENCE-LOG.md`.
7. A task becomes `done` only when its acceptance evidence is present and independently reviewed.
8. The coordinator audits every P0 requirement before declaring the module complete.
9. Keep `STATUS.md` and `work-items.yaml` consistent; the Markdown board is human-facing and YAML is the automation handoff.

## Agent protocol

Before editing, each agent must:

1. read the specification, this README, `WORKSTREAMS.md`, `STATUS.md`, and applicable repository instructions;
2. verify its assigned paths do not overlap another active owner;
3. inspect current files and `git status` rather than assuming the scaffold is committed;
4. update the status row to `active` with agent name, timestamp, and intended files.

While working:

- keep algorithms out of skills and transports;
- keep migrations in `ai-engineer-db-contract`;
- preserve immutable artifacts and deterministic-before-semantic ordering;
- do not weaken failures to make tests pass;
- do not expose secrets, source contents, or hidden reasoning in logs;
- add tests and evidence in the same workstream as behavior changes;
- record blockers and cross-stream dependencies promptly.

At handoff:

- update the workstream document and `STATUS.md`;
- list changed files, commands, results, unresolved risks, and next action;
- add authoritative proof to `EVIDENCE-LOG.md`;
- do not mark a requirement complete based only on intent or code presence.

## Status values

- `unclaimed`
- `active`
- `blocked`
- `review`
- `done`

`done` means acceptance evidence has been reviewed. A passing narrow test does not prove a broader requirement.

## Baseline command

```powershell
corepack pnpm verify
```

The current 23-package/app baseline passes and now contains substantive acquisition, retrieval, evaluation, persistence, client, API, worker, and integration tests. It still does not prove the not-yet-created verification package or diagnostics-company fixture.

## Recommended first wave

Run these concurrently only after the preservation checkpoint:

- WS-01 contracts and taxonomy reconciliation;
- WS-02 deterministic core migration and parity fixtures;
- WS-03 persistence/storage contract stabilization;
- WS-09 security threat model and guardrail requirements.

Provider, benchmark, transport, and integration work depends on those foundations.


EV-088 adds server-internal authenticated terminal extraction reads for accepted candidates and captured failures. The 15-check local PostgreSQL/Storage proof and all 72 workspace tasks pass. Exact receipt/body/hash authentication precedes Storage, original signed publications are hydrated and verified, and terminal/receipt identity is rechecked afterward. Public projection, tenant/owner HTTP authorization, mutation transports and broader acceptance remain pending. No full acceptance row is closed. See WS-08-STRUCTURED-EXTRACTION-READS-REVIEW.md.


EV-089 adds compact extraction custody resources, mission-authorized terminal reads, shared API/worker grant configuration, and extraction submission/read paths for HTTP, typed client, CLI and MCP. The 12-check local proof covers six original outcomes, five canonical admissions cancelled while queued, a built CLI process and actual MCP Streamable HTTP. All 72 workspace tasks pass (66 cached); 11 proof source hashes match. No supplier calls. New public submissions have not yet been driven through worker completion. Production health/auth/deployment, process-kill/reconciliation and broader acceptance remain partial. See WS-08-STRUCTURED-EXTRACTION-TRANSPORTS-REVIEW.md.


EV-090 proves fresh public extraction submission through configured worker execution and authenticated terminal reads, including six actual child SIGKILL/replacement recoveries after publication and before terminal receipt. Final30 checks and an independent44-artifact/17-source-file native audit pass; six original dispatches, two succeeded and four failed operations, no redispatch. Earlier crash windows, reconciliation, live deployment and all broader acceptance remain open. See WS-08-STRUCTURED-EXTRACTION-PROCESS-REVIEW.md.


EV-091 explicitly marks recovered dispatched calls uncertain before non-retryable failure when no response capture exists. Two actual dispatch-window child SIGKILL cases/six checks and direct native accounting/source-custody audit pass; no redispatch, capture, candidate or publication, and 200 total reserved unknown liability retained. All72 workspace tasks pass (69 cached). Reconciliation after failure/cancellation and broader acceptance remain open. See WS-08-STRUCTURED-EXTRACTION-DISPATCH-REVIEW.md.


EV-092 adds signed original-attempt reconciliation decision contracts and trusted issuer-bound admission with real Storage evidence hydration. Final six grouped checks, eight-artifact signature/accounting audit and contract0.2.27/190-file parity pass. Local327 registers the dedicated receipt artifact type. This is admission only: no settlement or budget adjustment occurred. Atomic reconciliation persistence, operator runtime and broader acceptance remain open. See WS-08-PROVIDER-RECONCILIATION-ADMISSION-REVIEW.md.


EV-093 adds immutable control-plane reconciliation ledger and atomic original-attempt settlement after failure/cancellation. Fresh failed and cancelled attempts pass8 grouped checks: rollback, concurrent exact retries, conflicts, role denial and immutable ledger. Native8-artifact/five-SQL-body audit confirms original dispatch/response preservation and future reservation rejection on the isolated overdrawn budget. All72 tasks pass; local329/contract0.2.28 with192-file parity current. Successful-operation reconciliation, publication stability and operator runtime remain open. See WS-08-PROVIDER-RECONCILIATION-SETTLEMENT-REVIEW.md.


EV-094 extends original-attempt reconciliation to succeeded extraction operations. Four fresh accepted/HTTP-failure cases across both providers pass20 grouped checks; original signed publications, authenticated HTTP resources, operations and receipts remain unchanged after settlement. Independent18-artifact/five-SQL-body audit passes, as do all72 workspace tasks and193-file contract parity. Local330/DBcontract0.2.29 current; remote unchanged. Operator runtime/transport and historical applied-decision reads remain open. See WS-08-PROVIDER-RECONCILIATION-PUBLICATIONS-REVIEW.md.


EV-095 adds internal historical applied-decision reads with real Storage/signature verification at durable application time and a second native ledger snapshot. Four existing settlements pass16 grouped checks, including expired-read/mutation separation, tenant scope, corrupt evidence and injected ledger drift. Dedicated proof TypeScript passes. Local330/contract0.2.29 and remote unchanged. Operator authorization/runtime/transports and broader acceptance remain open. See WS-08-PROVIDER-RECONCILIATION-READS-REVIEW.md.


EV-096 adds configured actor/issuer and mission/deployment authorization, HTTP POST/GET reconciliation, generated contracts and typed client methods. Four fresh settlements pass24 grouped checks through actual HTTP; independent18-artifact/10-source/five-SQL-body audit passes. Original publications remain unchanged. Local330/contract0.2.29 and remote unchanged. CLI/MCP, deployed configuration and broader acceptance remain open. See WS-08-PROVIDER-RECONCILIATION-HTTP-REVIEW.md.


EV-097 adds reconciliation apply/show CLI commands and MCP apply/get tools. Four fresh settlements through built CLI processes and actual MCP Streamable HTTP pass24 grouped checks, plus independent18-artifact/12-source/five-SQL-body audit. All72 workspace tasks pass,66 cached. Local330/DBcontract0.2.29 and remote unchanged. Partial-retention/cancellation recovery, deployed configuration and broader acceptance remain open. See WS-08-PROVIDER-RECONCILIATION-TRANSPORTS-REVIEW.md.
