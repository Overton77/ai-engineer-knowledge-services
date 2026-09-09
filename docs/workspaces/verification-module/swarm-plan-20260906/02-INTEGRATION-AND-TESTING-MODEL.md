# How services and agent systems use the verification module, and how to test it before Mission Control exists

This document answers three questions the pre-spec leaves implicit:

1. Exactly how each consumer (deep research, ingestion, codebase-implementation agents, Mission Control, dashboard) calls the module.
2. What a real Cursor Agent + Eve test against TruDiagnostic / Generation Lab material looks like on Temporal Cloud.
3. Which parts of that test are real, which are deliberate stand-ins, and why the stand-ins do not preempt the Mission Control kernel.

Terminology follows the Mission Control pre-spec: a **Mission** is durable intent; a **WorkItem/Attempt** is one runtime instance; a **Session** is a disposable harness context window; a **Capability** is a versioned, admitted operation. KS verification operations are capabilities. They already carry `tenantId`, `missionId`, `workItemId`, `attemptId`, `idempotencyKey`, and `externalExecution` on every call.

---

## 1. The single integration shape

Every consumer, regardless of runtime, does the same five things. Nothing else is supported.

```text
1. Freeze inputs      captureSource / registered artifact handles  (bytes, not URLs)
2. Declare intent     which use case, which policy version, which risk class
3. Submit             HTTP POST (202 + operation receipt) via client / CLI / MCP
4. Observe            GET operation / run / case / evidence  (compact, tenant-scoped)
5. Act on disposition admitted -> promote | quality_rejected -> stop, do not retry
                      | review_required -> HumanTask | infra failure -> retry class
```

The consumer never sees raw provider payloads, never receives verification algorithms, never supplies its own trusted verifier identity, and never gets a `succeeded` execution confused with an `admitted` result. `state` and `disposition` are separate fields and stay separate.

### 1.1 Identity flow

| Who | Holds | Passes |
|---|---|---|
| Mission Control worker | `KNOWLEDGE_API_TOKEN` (bearer), `VERIFICATION_DISPATCH_GRANTS_JSON` | tenant/mission/workItem/attempt + `externalExecution.runtime = mission_control` |
| KS API | ownership grants, deployment registry | resolves producer deployment vs verifier deployment; rejects self-verification |
| Agent (Cursor, Eve, Claude Code, Codex) | a scoped KS or MC token delivered by environment, never by prompt | operation IDs and artifact handles only |
| Dashboard server routes | server-held KS + MC tokens | read projections; launch via MC API |

Agents are producers. The KS verifier deployment is a different deployment. That is the pre-spec invariant 9 and VR-003, and it is already enforced in the KS ownership resolver.

---

## 2. Consumer by consumer

### 2.1 Deep research missions (Eve lane, later Mission Control `GOAL_LOOP` / `STAGE_GRAPH`)

```text
source discovery (Eve, bounded search)
  -> captureSource for every source the report will cite     (KS)
  -> research synthesis: report + assertion list with offsets (Eve, producer)
  -> evidence bundle: assertion -> capture -> selector          (Eve authored tool builds handles)
  -> verifyClaims  (atomic claims)                             (KS)
  -> verifyReport  (citation completeness, consistency, policy) (KS)
  -> policy admission -> PromotionProposal                     (KS decidePromotion; human where required)
  -> admitted atoms -> retrieval spaces / curriculum            (KS publication, never the agent)
```

Concrete rules for the Eve authored tool (replacing `verify_evidence_bundle.ts`):

- Accept artifact handles and a verification intent; forward `ctx.abortSignal`; use a stable idempotency key derived from mission/workItem/attempt + bundle digest, not a fresh UUID per retry.
- Return compact findings and audit handles. Never return raw provider bodies, configuration, or keys.
- The verifier identity comes from runtime configuration. The model cannot set it.
- The tool cannot alter deterministic findings. `quality_rejected` returns to the agent as a terminal fact, not as an error to retry.
- The `list_research_records` extension must not be present in the evidence-closed verifier's runtime tool catalog. Prove the actual catalog, not the source intention.

### 2.2 Ingestion missions (flywheel to KB)

```text
captureSource -> parseArtifact -> extractStructuredData -> verifyExtraction
  -> verifyMetricObservation (for numeric facts)
  -> promotion proposal (admitted / held / quarantined / no_op_duplicate)
  -> only admitted records reach official_canonical spaces
```

Agents author ingestion intent. Only `ingestion_executor` talks to target adapters. Verification sits between extraction and promotion. Zone 1-2 artifacts (starter packets, mission ledger) can be indexed as `provisional` only; they never become public answers.

### 2.3 Codebase-implementation agent workflows (Cursor, Claude Code, Codex lanes)

Be exact here, because the pre-spec deliberately splits the proof families:

- **Code correctness is proved by tests, typecheck, E2E, evaluator, human review. Not by verification.v1.** Do not route unit-test results through the verification module. Mission Control's code proof plane is Playwright traces, test reports, deployment URLs, and evaluator scores.

Where verification.v1 does apply inside a coding mission:

| Situation | Use case | Selector family |
|---|---|---|
| Agent writes an ADR, README, design note, or technical thread citing vendor docs, papers, or Context7 output | `captureSource` on the cited docs, then `verifyReport` | text / HTML / PDF |
| Agent claims something about a codebase ("`executeStage` returns success without execution at `activities.ts:42`") in a report or handoff | `verifyClaims` against a repository capture | repository commit / path / line range |
| Agent extracts structured facts from configs, lockfiles, OpenAPI documents, migration files | `extractStructuredData` + `verifyExtraction` | JSON Pointer / text / dataset |
| Harness or model comparison ("does Claude Code or Cursor Cloud complete this goal cheaper?") | `runBenchmark` / `compareBenchmarkRuns` via `evaluation.*` | n/a (experiment family) |
| Auditing what an agent relied on | `inspectAuditBundle`, `replayRun` | n/a |

So for code missions the module is the proof plane for **the factual artifacts a coding agent produces**, not for the code. That is the honest boundary, and it is what keeps agent-authored documentation from silently entering the KB.

### 2.4 Mission Control as dispatcher (kernel, all lanes)

Already implemented locally and to be kept as-is when the kernel arrives:

```text
MissionWorkflow -> NodeWorkflow -> verificationWorkflow(input)   // deterministic, no I/O
                                     -> executeVerification activity
                                          -> KS HTTP submit (202)
                                          -> poll operation (bounded)
                                          -> compact outcome {state, disposition, handles}
```

Rules that already hold and must survive the kernel build:

- Workflow performs no I/O. Activity submits a bounded versioned capability and polls.
- Credentials, source bytes, and full receipts never enter Temporal history.
- `disposition: quality_rejected` is terminal and never retried as infrastructure failure.
- Cancellation reaches the KS operation; uncertain submission is reconciled under the same idempotency identity.
- `assertVerificationDispatchLaunchInput` runs before `startWorkflow`.
- Dedicated task queue `verification`.

When the kernel exists, a `MissionNode` with `strategy: DETERMINISTIC` and `capability: knowledge.verification.<useCase>@verification.v1` compiles to exactly this workflow. Nothing in the current shape has to change; only the parent that starts it changes (compiler-emitted node instead of a direct HTTP launch).

### 2.5 Dashboard

Read-first (D-010, VR-032). Server route handlers hold tokens and call KS `/v1/verification/*` for reads and MC `/v1/verification/executions` for launch/cancel. Browser code never touches canonical tables. Search over verification runs is one leg of the pre-spec's federated Knowledge search; it is not a second index.

---

## 3. The consumer proof harness: testing without building the kernel

The user's intent: run a real Cursor Agent and a real Eve agent with an evidence/source bundle, do a mini research-and-report task on TruDiagnostic and Generation Lab, verify it through the module, on Temporal Cloud. Do this without inventing a competing mission kernel.

Name it the **Consumer Proof Harness (CPH)**. It is a proof fixture, not a product. It lives in KS `scripts/` and parent `internal/`, and in MC only as the already-existing `verificationWorkflow` lane plus one Temporal Cloud connection profile.

### 3.1 What CPH is

```text
[seeded orchestration rows]   one tenant, one mission, N work items, one attempt each
        |                     (real rows in orchestration.* via canonical functions,
        |                      because evidence.verification_run FKs to them)
        v
[frozen source bundle]        the registered diagnostics-companies closure (16 sources,
        |                      17 projections, restricted export), by handle
        v
[agent run]  ---------------> Cursor Agent (CLI headless, then Cloud)   OR   Eve (authored tool)
        |                     goal: "Write a short evidence-cited research report on <company>
        |                     using only the supplied captures. Every factual sentence must
        |                     carry an assertion with an exact selector. Submit for verification."
        v
[submit]                      agent -> MC POST /v1/verification/executions   (primary)
        |                              -> Temporal Cloud verificationWorkflow -> KS
        |                     agent -> KS CLI/HTTP directly                    (degraded lane,
        |                              recorded as such, same identities)
        v
[verify]                      verifyClaims + verifyReport (+ verifyExtraction for structured
        |                     company fields), policy version pinned, verifier deployment != agent
        v
[observe]                     dashboard read + CLI read + receipt
        v
[receipt]                     JSON receipt in parent internal/ with SHA-256, Temporal workflow ID,
                              KS operation IDs, agent run ID, model IDs, cost, disposition per claim
```

### 3.2 What is real and what is a stand-in

| Component | Real | Stand-in | Why the stand-in is legitimate |
|---|---|---|---|
| Temporal Cloud connection, namespace, worker, `verificationWorkflow` | yes | | This is the durable piece Gate C/D of the pre-spec needs anyway |
| KS API, worker, Postgres, Storage, parser image | yes (local or a reachable test deployment) | | Same code path as production |
| Agent runtime (Cursor Agent CLI/Cloud, Eve) | yes | | The point of the test |
| Provider calls (Luna, Haiku, Interfaze) | yes, within an accepted budget decision | | Needed for real synthesis and semantic stage |
| Producer / verifier deployment split | yes | | Enforced by KS ownership resolver |
| Mission, work item, attempt rows | | seeded fixture rows | The kernel's compiler will later create these; the FKs and IDs are identical |
| `MissionDefinition`, `CompiledGraph`, revisions, spawn, commands, peek | | absent | Not needed to prove dispatch; building them here would be a second kernel |
| Coordinator agent, dashboard chat | | absent | Gate E work |
| Human gold labels | | the user as single annotator, labelled as such | Dual annotation is not available; do not call it adjudicated gold |
| Supplier billing truth | | synthetic or absent | Authentic reconciliation is a separate operator path |

Recording this table in every CPH receipt is mandatory. It is how the proof stays honest and how the later kernel knows exactly which rows were fixtures.

### 3.3 Why this does not preempt Mission Control

- It uses the existing MC `verificationWorkflow` and HTTP launch route unchanged; it adds a Temporal Cloud connection profile, not a workflow type.
- It does not add tables. Orchestration rows are created through canonical db-contract functions.
- It does not give agents provider keys or Temporal access. Agents get a scoped bearer via environment and call an HTTP surface.
- It does not implement graph, spawn, command, or peek. Those are Gates B, E, I.
- Every identifier it mints is the identifier the kernel will mint. When the compiler lands, CPH's "seeded rows" step is replaced by "commit revision", and nothing downstream changes.

### 3.4 Two agent lanes, in order

**Lane A: Cursor Agent.** Start with the local CLI in headless print mode (already authenticated), workspace = a scratch directory containing the exported frozen bundle manifest and the `knowledge` CLI on PATH, plus the `verify-report` skill (spec section 22). Success = the agent produces a report artifact + assertion ledger, calls `knowledge benchmark capture` / `verify` commands (or MC launch), and reads the disposition. Then repeat on Cursor Cloud with a no-repo or fixture-repo run, economical model, `envVars` existence-checked, PR creation disabled, agent archived (not deleted) afterwards. Cloud requires a reachable KS/MC endpoint; loopback will not work from Cloud.

**Lane B: Eve.** Cut `verify_evidence_bundle.ts` over to a KS-client-backed tool. Run an actual Eve eval against the real HTTP runtime with deterministic assertions: tool used, forbidden tools absent, same-deployment refusal, corrupted locator rejected, cancellation propagates, idempotent receipt on retry, context bounds respected. Then one live-model run on the mini report task.

Each lane produces: agent transcript artifact (registered, restricted), report artifact, assertion ledger, KS operation IDs, MC workflow ID, receipt, and a short review file in the workspace. Compare the two lanes on identical frozen inputs: claim count, admitted / held / rejected, cost, latency, and any deterministic-stage failures. That comparison is an `experiment` in the supplement's sense and should be recorded as a benchmark comparison, not a paragraph.

### 3.5 Preconditions the harness cannot skip

- `verifyClaims` and `verifyReport` must exist as admitted use cases across worker/HTTP/CLI/MCP. Today they do not. This is the critical-path dependency of the whole test.
- An evidence-closed semantic stage (Haiku as cross-family judge under D-011, bounded, no tools) must exist for stage 4; without it `verifyReport` can only produce deterministic-stage results, which is still a valid first CPH run if labelled as deterministic-only.
- A new accepted spending decision for agent-lane runs (see 03-SWARM-INSTRUCTIONS, "Decisions the user must make").
- A Temporal Cloud namespace and API key delivered by environment, never printed.
- For the Cloud lane, a reachable KS/MC endpoint with HTTPS and short-lived tokens.

---

## 4. Dashboard: what to build now

The user wants to run benchmarks and see results now, and wants the dashboard to be a control plane / debugger from the first slice, not a table viewer. That is compatible with D-010 as long as every mutation goes through Mission Control's durable, authenticated routes.

### 4.1 Home and stack

**Home is `ai-engineer-mission-control/apps/dashboard`. Only there.** The MC README already names it the debugger control plane and data view on Vercel, and the pre-spec section 18 information architecture is its target shape. `agents_dashboard` is not the home, is not extended, and is not a dependency; it is read-only reference for one thing (server route handlers + TanStack Query reading through supported APIs). Nothing is imported from it.

Stack: Next.js 16 (App Router), React 19, TypeScript strict, TanStack Query, shadcn/ui + Tailwind 4, Playwright. Confirm the exact versions currently pinned in MC `apps/dashboard/package.json` and match the rest of the MC workspace (pnpm, turbo, `tsconfig.base.json`). No `pg`, no Supabase client, no `@aiengineer/database-contract` runtime import in the dashboard; it speaks HTTP to KS and MC only.

### 4.2 Debugger shape, even for one service

Verification is the first capability the dashboard debugs. Build the four-zone Live view from the dashboard spec now, scoped to a verification execution, so the same components host missions later:

```text
┌──────────────── Health bar: execution id / state / disposition / elapsed / cost / cancel ────────────────┐
├───────────────┬────────────────────────────────┬───────────────────────────────┬────────────────────────┤
│ TOPOLOGY      │ LIVE EVENT STREAM              │ INSPECTOR + COMMAND           │ OUTPUT RAIL            │
│ execution     │ MC execution state changes     │ selected node details         │ registered artifacts   │
│  └ workflow   │ KS operation events (polled    │ receipts, grants, identities  │ manifests, reports,    │
│     └ op      │  through route handler, cursor)│ commands: cancel / retry /    │ evidence fragments,    │
│        └ steps│ typed families: temporal,      │  reconcile / request review   │ publications, CPH      │
│  status marks │  worker, provider, verification│ delivery state per command    │ receipts               │
│               │  accounting, human             │                               │ "Use as input" (later) │
└───────────────┴────────────────────────────────┴───────────────────────────────┴────────────────────────┘
```

- **Topology**: execution -> Temporal workflow -> KS operation -> steps / provider attempts / cases, with status marks (queued, running, waiting, uncertain, cancelled, failed, succeeded, quality_rejected). Tree and outline modes; DAG can wait for missions.
- **Event stream**: normalized event cards from MC `GET /v1/verification/executions/:id` state and KS `operation events` reads, coalesced by presentation only, expandable to raw, cursor-based tail via route handler polling now (WebSocket gateway is Gate E; design the client so the transport swaps without touching cards).
- **Inspector + command**: selected target scope shown explicitly; commands are only what MC and KS durably support today: cancel execution (MC), retry / reconcile operation (KS `operation retry|reconcile` control actions), request adjudication (after SW-02). Each command shows `accepted -> delivered -> observed` from the API, never optimistic success. Every command carries a server-minted idempotency key and actor.
- **Output rail**: artifacts by registered handle with compact previews (manifest, report HTML excerpt, evidence fragment with selector), opened through signed short-lived access from the route handler. Never full internal manifests in the browser.
- **Health bar**: `state` and `disposition` rendered as two separate fields, always.

### 4.3 Pages in the first slice

1. **Executions** (`/verification/executions`): list and the Live view above per execution. Launch composer: pick use case (`runBenchmark`, `verifyReport`, `verifyExtraction`, `verifyMetricObservation`), frozen inputs by handle, policy version; submits to MC `POST /v1/verification/executions`.
2. **Benchmarks** (`/verification/benchmarks`): runs, run detail (manifest, arms, per-case rows), comparison with paired statistics and truthful denominators; each row opens in the Live view or the case drilldown.
3. **Runs and evidence** (`/verification/runs/[id]`, `/verification/cases/[id]`, `/verification/evidence/[id]`): deterministic vs semantic findings separately; failure taxonomy; verdict -> fragment -> manifest navigation and back.
4. **Extraction operations** (`/verification/extractions`): terminal state, provider attempt state (dispatched / uncertain / settled), original vs reconciled accounting, reconciliation ledger reads.
5. **CPH receipts** (`/verification/harness`): renders the real-vs-stand-in table from 3.2 per run, with links into the Live view.

### 4.4 Code organization (non-negotiable for the dashboard owner)

```text
apps/dashboard/
  app/
    (control-plane)/                 # route group; missions/, live/, coordinator/, tasks/ join later
      verification/
        executions/ page.tsx  [id]/page.tsx
        benchmarks/ page.tsx  [id]/page.tsx  comparisons/[id]/page.tsx
        runs/[id]/  cases/[id]/  evidence/[id]/
        extractions/ page.tsx  [id]/page.tsx
        harness/ page.tsx
    api/                             # server route handlers only; the browser's sole backend
      knowledge/[...path]/route.ts   # typed proxy to KS /v1/verification/* reads
      mission-control/[...path]/route.ts  # typed proxy to MC /v1/verification/executions*
  src/
    server/                          # server-only: tokens, tenant/session, KS + MC clients, DTO mapping
      knowledge-client.ts  mission-control-client.ts  auth.ts  dto/
    features/
      live-view/                     # health bar, topology, event stream, inspector, command composer, output rail
      executions/  benchmarks/  runs/  extractions/  harness/
        api.ts (TanStack hooks)  components/  types.ts
    components/ui/                   # shadcn primitives only
    lib/                             # pure helpers: formatting, status maps, event normalization
  e2e/                               # Playwright
```

Rules: server-only modules marked `import "server-only"`; route handlers validate params with Zod and return typed DTOs, never raw upstream bodies; feature folders own their hooks, components, and types; components render, hooks fetch, `src/server` talks to services; no business logic in components; no verification algorithms anywhere in the dashboard; every status enum lives once in `lib/status.ts` and mirrors the KS/MC contracts; strict ESLint with import-boundary rules (`features/*` cannot import `server/*`; only `app/api/*` can). Keep the placeholder `app/page.tsx` as the landing that links into the control-plane group.

### 4.5 Boundaries and tests

All reads: browser -> Next route handler -> KS/MC HTTP with server-held tokens; tenant from server session, never from the browser. Test loading / empty / error / denied / cross-tenant states. Playwright must exercise: Live view renders for a real execution, cancel shows durable delivery state, verdict -> fragment -> manifest round trip, launch requires role, and the client bundle contains no database or secret configuration. Do not claim dashboard acceptance from green API tests.

This slice becomes the **Knowledge**, **Outputs**, and part of the **Live Mission** areas of the pre-spec information architecture when missions arrive in Gate E; the `live-view` feature is reused for missions with a different topology adapter, not rewritten.
