# Knowledge Services final layout

Status: accepted (2026-09-27, developer-approved in session).

This is the target package, app, and skill layout for `ai-engineer-knowledge-services`, and the rule for how transports call application code. It supersedes the sequencing in `FEATURE-SET-SPECIFICATION.md` (S0–S7) and `ORCHESTRATION-PLAN.md` as the source of truth for **what exists and in what order it is built**. The folder-level decisions inside packages recorded in `PHASE-1-RECOMMENDATION.md` and `PHASE-2-RECOMMENDATION.md` stay valid; they become subfolders of the merged packages below.

Working rule: **progress over perfection.** Each unit of work is one PR (or a short series), mechanical where possible, and is done when `corepack pnpm verify` is green. No approval memo is required for a mechanical unit; a unit that changes behavior states that in its specification.

## 1. Why

A 2026-09-27 survey (source lines excluding tests, `@aiengineer/*` dependencies from each `package.json`):

- Verification is most of the repository: ~90% of `packages/application`, ~half of `packages/persistence`, ~half of `apps/worker`, 168 of 191 files in `scripts/`, plus `packages/verification` (13.4k) and `apps/verification-executor` (9.8k).
- `apps/verification-executor` is a second service: its own CLI (`knowledge-verify`), MCP server (`verify_*`), HTTP routes, store, skill home, and application logic in `src/knowledge/`.
- Six packages are under 600 lines (`domain` 87, `observability` 11 and unused, `config` 164, `documents` 195, `chunking` 364, `runtime` 599).
- Four chains exist only to feed one consumer: `schema-workspace → db-read → ingestion` (only the executor); `projections`, `vector-backends`, `embeddings` → `retrieval` (only application).
- Transports do not all follow ADR 0004: MCP still calls the API over HTTP (`createApiClient`), ownership/admission and the retrieval executor live in `apps/api`, API and worker each wire their own `*-runtime.ts` files, and the worker imports algorithm packages directly.

`persistence` importing `application` is correct (adapters implement application ports) and is not changed.

## 2. Organizing principle

Mission Control sees Knowledge Services as **one agent capability** with tool groups. Each group has the same name at every layer: application folder, MCP tool prefix, CLI subcommand, skill.

| Group | Scope | MCP prefix | CLI | Skill |
|---|---|---|---|---|
| knowledge | sources → preparation → publication → retrieval → evidence, evaluation | `knowledge_*` | `ks knowledge …` | `knowledge-sources`, `knowledge-preparation`, `knowledge-retrieval`, `knowledge-evaluation` |
| verify | captures, claims, reports, admission, recovery | `verify_*` (names unchanged) | `ks verify …` | `knowledge-verification` |
| db | schema navigation, bounded reads, ingestion | `db_*` | `ks db …` | `knowledge-db` |
| jev | Jev System One integration (upcoming) | `jev_*` | `ks jev …` | `jev-system-one` |

`knowledge-research` is the coordination skill over all groups. Mission Control grants groups per workflow (research/ingest: `knowledge` + `db`; a coding workflow: `verify` or read-only `db`).

## 3. Target layout

```
apps/
  api/        HTTP + A2A. Absorbs application/operations/a2a-adapter and the executor's /artifacts, /captures routes.
  mcp/        One MCP server (Streamable HTTP + stdio). Tool groups above; `verify_*` names unchanged.
  cli/        One binary `ks` → `ks knowledge|verify|db|jev …`. Remote mode via KnowledgeClient;
              `pack:sandbox` is a cli build target (replaces knowledge-verify packaging).
  worker/     One durable worker: lease loop + application's activity registry.

packages/
  contracts/      Public Zod schemas and error codes (published)                 unchanged
  client/         KnowledgeClient (folder rename of client-typescript; npm name unchanged)
  core/           domain + runtime + observability                               (3 → 1)
  host/           config + composition root: createHost(profile)                  (new; absorbs config)
  sources/        acquisition + inspection                                       (rename of acquisition)
  preparation/    conversion + documents + chunking                              (3 → 1)
  retrieval/      search (was retrieval) + projections + embeddings + vector-backends (4 → 1)
  policy/         admission and selection eligibility                            unchanged
  evaluation/     evaluation                                                     unchanged
  verification/   verification algorithms                                        unchanged
  knowledge-db/   schema-workspace + db-read + ingestion                         (3 → 1)
  application/    src/{operations,knowledge,verification,db}/ — use cases, ports, activity registry
  persistence/    Postgres/Supabase adapters for application ports               unchanged
  testkit/        devDependency only

services/
  docling/        unchanged
  parser/         rename of verification-parser

skills/           One home. Eight skills plus the manifest Mission Control consumes.
  knowledge-research        coordination (planned F6)
  knowledge-sources         ← knowledge-acquisition-and-vetting
  knowledge-preparation     ← knowledge-preparation-and-promotion
  knowledge-retrieval       ← knowledge-retrieval-and-evidence + vector-store-management
  knowledge-evaluation      unchanged
  knowledge-verification    ← knowledge-verification + executor's knowledge-verify + knowledge-verification-recovery (reference file)
  knowledge-db              ← knowledge-db + schema-explore + knowledge-ingest
  jev-system-one            kept here; grows with the Jev integration
  manifest.json             capability manifest

proofs/           was scripts/: proofs/verification/<feature>/…, one shared tsconfig; sprint-only proofs archived
```

Totals: 23 → 14 packages, 5 → 4 apps, 12 → 8 skills, one MCP server, one CLI.

Compatibility kept throughout: npm names stay `@aiengineer/knowledge-*`; public HTTP routes, MCP tool names (including `verify_*`), and `KnowledgeClient` methods do not change; persisted identity strings (for example the `packages/conversion` / `packages/chunking` procedure identities in `packages/persistence/src/preparation.ts`) do not change.

## 4. How transports call application

ADR 0004 stays the rule: **in-process servers (API, MCP, worker) call `packages/application`; out-of-process callers use `KnowledgeClient` over HTTP.** The layout adds the piece that makes it enforceable: `packages/host`.

### 4.1 One composition root

```ts
const ks = await createHost(profile); // "server" (Postgres + Supabase) | "local" (file store, offline)

ks.knowledge.sources.capture(ctx, input)
ks.knowledge.retrieval.search(ctx, input)
ks.verify.claims.submit(ctx, input)
ks.db.read(ctx, intent)
ks.operations.submit(ctx, envelope) / ks.operations.get(ctx, id)
ks.activities                           // worker activity registry, keyed by operation kind
```

- `host` reads configuration (absorbs `packages/config`), builds persistence and storage adapters, and returns application services grouped by tool group.
- Apps import only `@aiengineer/knowledge-host` and `@aiengineer/knowledge-contracts`. They do not import persistence, runtime, or algorithm packages.
- Ownership, admission gates (`is*RequestAdmitted`), `CanonicalRetrievalExecutor`, and the per-app `*-runtime.ts` compositions move to application (as ports and use cases) and host (as wiring).
- The `local` profile replaces the executor's `VERIFY_STORE_DIR` mode and serves the CLI's offline commands.

### 4.2 Handler shape

Every API route, MCP tool, CLI command, and A2A skill does exactly four things:

1. Parse input with the `contracts` schema.
2. Build an `OperationContext` (actor, tenant, trace, idempotency key).
3. Call one application function through `host`.
4. Map the result or error.

Application raises one error-code set defined in `contracts`. Each transport maps it: HTTP status (API), MCP error (MCP), exit code `0` success / `1` quality gate failed / `2` usage, auth, network or executor error (CLI). Handlers contain no SQL and no authorization logic.

### 4.3 Durable work

- API and MCP start durable work with `ks.operations.submit(...)` and return the accepted operation. Reads, and synchronous API-owned kinds such as `retrieval_run`, call application directly.
- The worker is a lease loop over `ks.activities[kind](ctx, step)`. It holds no use-case logic.

### 4.4 Per transport

| Surface | Calls | Notes |
|---|---|---|
| `apps/api` (HTTP + A2A) | `host` server profile | A2A is a second binding over the same services |
| `apps/mcp` Streamable HTTP | `host` server profile | `createApiClient` shim removed once §4.1 ports exist |
| `apps/mcp` stdio | `host` local profile | A remote agent uses the HTTP MCP endpoint, not a local proxy |
| `apps/worker` | `host` server profile, activity registry | No algorithm-package imports |
| `apps/cli` remote, sandbox package | `KnowledgeClient` → API | Replaces `VERIFY_EXECUTOR_URL`; store and credentials never enter the sandbox |
| `apps/cli` offline | `host` local profile | Lazy-loaded so remote commands do not load application |
| Mission Control, Eve, other repos | `KnowledgeClient`, or HTTP MCP for agents in sandboxes | Never import internal packages |

### 4.5 Catalog parity

`packages/application/src/operations/surface.ts` is the list of operation names and schemas. Bindings stay hand-written. One test asserts every catalog operation is exposed on API, MCP, and CLI or is listed as an explicit exclusion.

## 5. Units of work

Each unit has its own specification in this folder before it starts.

| Unit | Scope | Behavior change | Spec |
|---|---|---|---|
| 1 | Mechanical package merges: `core`, `preparation`, `retrieval`, `knowledge-db` | None | [`UNIT-1-PACKAGE-MERGES.md`](./UNIT-1-PACKAGE-MERGES.md) |
| 2 | Add `packages/host` (absorbs `config`); move API and worker runtime wiring into it | None intended | to write |
| 3 | Ownership, admission, retrieval executor into application; delete MCP `createApiClient` | MCP no longer calls the API | to write |
| 4 | Application folders by tool group; A2A adapter into `apps/api`; testkit to devDependency; naming pass (`acquisition`→`sources`, `client-typescript`→`client`, `verification-parser`→`parser`); catalog parity test | None | to write |
| 5 | Fold `verification-executor` into api/mcp/cli/application via host profiles | Executor binaries replaced by `ks` | to write |
| 6 | Skills to eight; update `skills/manifest.json` and sandbox packaging's required skills | Skill names change | to write |
| 7 | `scripts/` → `proofs/`; archive sprint-only proofs | None | to write |

Deliberately deferred until they cause a problem: unifying the three capture/parse paths (knowledge acquisition + Docling, verification capture + `services/verification-parser`, executor Firecrawl parse); renames inside `packages/verification`; the two `deterministicUuid` functions (`runtime` two-argument, `documents` one-argument).

## 6. Dated documents

Review records under `docs/operations/reviews/` and the phase memos in this folder are dated records. They keep pre-merge paths (`packages/conversion`, `packages/db-read`, …); read them with the mapping in §3. Live navigation (`AGENTS.md`, `docs/agents/CODE-MAP.md`, `knowledge/*.md`, `.agent-docs/`) is updated by the unit that moves the code.
