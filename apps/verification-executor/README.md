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
store: `artifacts/<sha256>` bytes + `handles/<artifactId>.json`, `captures/<captureId>.json`,
`runs/<runId>/run.json` + step receipts. Puts are idempotent; reads re-hash and fail on
mismatch. Swapping the directory for a bucket changes only `store.ts`.

## Environment

`VERIFY_PORT` `VERIFY_HOST` `VERIFY_STORE_DIR` `VERIFY_EXECUTOR_TOKEN` (bearer for HTTP)
`VERIFY_JUDGE_MODEL` (default `openai/gpt-5.6-terra`) `VERIFY_CROSS_FAMILY_JUDGE_MODEL`
`VERIFY_TENANT_ID` `VERIFY_PRODUCER_DEPLOYMENT_ID` `VERIFY_VERIFIER_DEPLOYMENT_ID`
`AI_GATEWAY_API_KEY` (judge) `FIRECRAWL_API_KEY` (capture; falls back to HTTPS GET).

## Build

```sh
pnpm --filter @aiengineer/knowledge-verification-executor build   # dist/index.js, workspace deps inlined
node apps/verification-executor/dist/index.js serve --port 4310
```

`dist/index.js` plus `@modelcontextprotocol/sdk` and `zod` is everything a sandbox needs.
