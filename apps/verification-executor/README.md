# @aiengineer/knowledge-verification-executor

Deterministic verification executors over **agent-written intent files**. One
process exposes the same operations on three surfaces so a multi-agent pipeline
can call each verification stage separately, in order:

| Surface | Entry | Use |
|---|---|---|
| CLI, local | `knowledge-verify <command>` (`dist/index.js`) | Operators, tests; runs against `VERIFY_STORE_DIR` in-process |
| CLI, remote | same commands with `VERIFY_EXECUTOR_URL=http://host:4310` | **Agent skills inside sandboxes.** Forwards every command to a `serve` process; the store, judge credentials and receipts never enter the sandbox |
| MCP (Streamable HTTP) | `knowledge-verify serve` → `POST /mcp` | Eve / any MCP client; tools named `verify_*` |
| MCP (stdio) | `knowledge-verify mcp-stdio` | Local harnesses (Cursor, Claude Code) |
| HTTP | `/artifacts` (POST bytes → handle, GET by id/digest), `/captures` (POST document bytes → capture), `/media-types`, `/runs/:runId`, `/captures`, `/health` | Sandbox → store handoff, run inspection |

The agent-facing procedure for the CLI surface is the packaged skill in
[`skills/knowledge-verify/`](skills/knowledge-verify/SKILL.md) (sequence, quality gates, exit
codes, failure playbook, intent schemas). `pnpm pack:sandbox` bundles the CLI **and** that skill
into `dist/sandbox/knowledge-verify-<version>.tgz` for `npm i -g` inside a sandbox image.

### Exit codes (CLI)

`0` command succeeded and its quality gate passed · `1` succeeded but the gate failed
(`locate` not resolved, `verify-claims` not passed, `verify-extraction` invalid, `judge` verdict
not admitted, `policy` not pass, `seal` invalid, `check-report` not ok) · `2` usage / network /
auth / executor error. Every command prints one JSON document to stdout; `--out <file>` writes
it to a file and prints a compact summary instead.

The agent's job is to **capture sources, choose exact quotes, and write intent
files**. The executor compiles intents into verification bundles and runs the
`@aiengineer/knowledge-verification` library; it never trusts agent-supplied
digests, bundles, or verdicts.

## Operations (one tool / command each)

| Stage | CLI | MCP tool | Produces |
|---|---|---|---|
| Capture | `capture <url> --run R --capture-id C` | `verify_capture_source` | immutable capture (content artifact + capture record). URLs ending in `.pdf/.docx/.xlsx/.pptx/.odt/.rtf/.epub` are downloaded and parsed to text (Firecrawl `/v2/parse`); original bytes kept as `originalArtifact` |
| Capture file | `capture-file <path> --run R --capture-id C` | `verify_capture_file` (base64/text) · `POST /captures` | same, for files the agent already holds (sandbox downloads, uploads) |
| Media types | `media-types` | `verify_supported_media_types` | which extensions/media types capture accepts and how each is handled |
| Inspect | `read C`, `search C <query>` | `verify_read_capture`, `verify_search_capture` | windows / matches of the captured text |
| Locate | `locate C <quote>` | `verify_locate_quote` | resolved / ambiguous / not_found + suggestions |
| Register | `register <file> --label L --run R` | (`POST /artifacts`) | `{ artifactId, digest }` for intent/report files |
| Claims | `verify-claims intent.json --run R` | `verify_claims` | bundle + mechanical result (capture integrity, selector integrity, digest binding) |
| Extraction | `verify-extraction intent.json --run R` | `verify_extraction` | per-field validity against captured quotes |
| Judge | `judge --run R [--model …] [--cross-family …]` | `verify_judge_semantics` | evidence-only semantic verdicts per assertion |
| Policy | `policy --run R [--policy p.json]` | `verify_evaluate_policy` | pass / pass_with_warnings / review / fail / abstain |
| Seal | `seal --run R` | `verify_seal_run` | audit bundle (manifest + payload digests, lineage) |
| Report | `check-report intent.json --run R` | `verify_check_report` | citation correctness, misplaced citations, uncited/failed citations |
| Status | `status --run R` | `verify_run_status` | run state + ordered step receipts |

Every mutating call is recorded as a **step receipt** (`runs/<runId>/steps/NNNN-<op>.json`)
with input and output, so a run can be replayed step by step.

## Intent files

- `verification-claims-intent.v1` — atomic propositions, each bound to one or more
  `{ captureId, quote }` evidence entries with authority signals.
- `verification-extraction-intent.v1` — a bounded JSON schema, a candidate object,
  and per-field `{ path, comparison, captureId, quote }` bindings.
- `verification-report-intent.v1` — the report artifact plus sentences (`exactText`)
  mapped to `claimIds`.

Schemas live in `src/intents.ts` and are exported from the MCP tool input schemas.
Quotes must be exact substrings of the capture and occur exactly once
(`text_quote`, normalization `none`).

## Store

`VERIFY_STORE_DIR` (default `.verification-store`) is a content-addressed filesystem
store: `artifacts/<sha256>` bytes + `artifacts/<sha256>[.<lineage16>].handle.json`,
`captures/<captureId>.json`, `runs/<runId>/state.json` + step receipts. Artifact identity is
**bytes + lineage**: parentless artifacts (captures, registered files) are keyed by digest alone
and re-putting them is idempotent; derived artifacts (results, decisions, bundles) are keyed by
digest + sorted parents + transformation, so the same bytes re-derived from new parents get a
new handle and `seal` never sees a stale parent. A `captureId` is immutable: identical bytes
under an existing id return the original record (`reused: true`), different bytes raise
`CAPTURE_ID_CONFLICT`. Reads re-hash and fail on mismatch. Swapping the directory for a bucket
changes only `store.ts`.

## Environment

`VERIFY_PORT` `VERIFY_HOST` `VERIFY_STORE_DIR` `VERIFY_EXECUTOR_TOKEN` (bearer for HTTP)
`VERIFY_JUDGE_MODEL` (default `openai/gpt-5.6-terra`) `VERIFY_CROSS_FAMILY_JUDGE_MODEL`
`VERIFY_TENANT_ID` `VERIFY_PRODUCER_DEPLOYMENT_ID` `VERIFY_VERIFIER_DEPLOYMENT_ID`
`AI_GATEWAY_API_KEY` (judge) `FIRECRAWL_API_KEY` (capture; falls back to HTTPS GET).

## Knowledge executor (`knowledge` bin)

The same process also hosts the schema-workspace, bounded-read, and ingestion surfaces
(spec: `ai-engineer-db-contract/docs/SCHEMA_WORKSPACE_MATERIALIZATION_SPEC.md` §5–§7). They are
generated from one operation registry (`src/knowledge/operations.ts`, `defineOperation`) into:

| surface | shape |
|---|---|
| CLI | `knowledge schema search\|get\|manifest\|materialize`, `knowledge db head\|read-intent\|sql\|explain`, `knowledge ingest plan\|apply\|receipt`, `knowledge artifact get` (`knowledge help`) |
| HTTP | `POST /knowledge/<operation>` (JSON in/out), `GET /knowledge/operations`, `/health` reports workspace and database heads |
| MCP | `schema_search`, `schema_get`, `schema_manifest`, `schema_materialize`, `db_head`, `db_read_intent`, `db_sql_readonly`, `db_explain`, `ingest_plan`, `ingest_apply`, `ingest_receipt`, `artifact_get` beside the `verify_*` tools on `/mcp` |

Libraries: `packages/schema-workspace` (load/search/pages/head check/materialize),
`packages/db-read` (catalog-driven `knowledge-read-intent.v1` → snapshot, guarded SQL, artifact ledger),
`packages/ingestion` (`knowledge-ingestion-intent.v1` → plan → apply as `executor_service` → receipt).
Skills: `skills/schema-explore`, `skills/knowledge-db`, `skills/knowledge-ingest`.

Exit lattice for `knowledge`: 0 ok · 1 domain outcome (`PARAMS_INVALID`, `VOCABULARY_VIOLATION`, `REBASE_REQUIRED`, plan rejected, …) · 2 infrastructure (`WORKSPACE_MISSING`, `HEAD_MISMATCH`, `DB_UNAVAILABLE`, usage).

### Environment (knowledge)

`POSTGRES_URL` or `KNOWLEDGE_DB_URL` (enables the knowledge tools; the pool connects as the login user and `set local role` switches to
`pipeline_agent`/`app_reader` for reads and `executor_service` for ingestion inside each transaction)
`SCHEMA_WORKSPACE_DIR` (default: the pinned `@aiengineer/database-contract` `workspace/`)
`KNOWLEDGE_TENANT_ID` (default tenant for CLI/MCP calls) `KNOWLEDGE_ARTIFACT_DIR` (default `.knowledge-artifacts`; ledger rows are `storage_state='pending'` until bucket upload)
`KNOWLEDGE_ARTIFACT_STORAGE=supabase` + `SUPABASE_URL` + `SUPABASE_SECRET_KEY` (upload to `research-ingestion-intents`)
`KNOWLEDGE_ALLOW_STALE=1` (experiments only: run when workspace head ≠ database head)
`KNOWLEDGE_EVIDENCE_ORACLE=declared` is rejected. Every production surface requires the co-hosted sealed verification store with the same tenant. Tests inject their own explicit synthetic adapter.
`KNOWLEDGE_EVIDENCE_POLICY_VERSION` selects the host-authorized version; custom versions also require `KNOWLEDGE_EVIDENCE_POLICY_DIGEST` for the exact immutable definition. See [knowledge admission and recovery](../../docs/verification/KNOWLEDGE-ADMISSION.md).
`KNOWLEDGE_EXECUTOR_URL` / `KNOWLEDGE_EXECUTOR_TOKEN` (remote mode for the `knowledge` CLI; `VERIFY_EXECUTOR_URL` is honoured too).

## Build

```sh
pnpm --filter @aiengineer/knowledge-verification-executor build   # dist/index.js + dist/knowledge.js, workspace deps inlined
node apps/verification-executor/dist/index.js serve --port 4310     # or: node dist/knowledge.js serve --port 4310
```

`dist/index.js` + `dist/knowledge.js` plus `@modelcontextprotocol/sdk`, `zod`, and `pg` is everything a sandbox needs
(`pnpm --filter @aiengineer/knowledge-verification-executor pack:sandbox` stages both bins and all four skills).
