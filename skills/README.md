# Skills

This directory is the source of truth for the eleven versioned Knowledge Services skills listed in
`manifest.json`. Consumers pin a released version and may add runtime-specific wrapper instructions,
but must not fork authority, evidence, tenant, or publication semantics.

Every skill uses a public v1 surface: the platform HTTP/client and MCP tools, or the verification
executor's `knowledge` CLI, HTTP routes and `/mcp`, or the Jev worker service's CLI, HTTP and MCP. None authorizes raw SQL beyond the guarded
read-only capability, secrets, private bucket listing, direct vector writes, self-approval, or
publication.

| Skill | Surfaces | Covers |
|---|---|---|
| `schema-explore` | executor | Progressive navigation of the pinned schema workspace without querying the database |
| `knowledge-db` | executor | Named catalog reads and reproducible snapshots an ingestion intent can cite |
| `knowledge-ingest` | executor | Ingestion intents, report registration/assessment, content links, preserved source receipts |
| `knowledge-acquisition-and-vetting` | executor, platform | Discovery, preserved untrusted attempts, capture and vetting |
| `knowledge-preparation-and-promotion` | executor, platform | Conversion, chunking, summaries, content links, promotion proposals and reviews |
| `knowledge-verification` | platform (+ executor reads) | Admitted claims, citations, extraction, report, benchmark, replay, adjudication |
| `knowledge-verification-recovery` | executor, platform | Durable recovery cases: triage, probes, bounded repair, per-member re-verification |
| `knowledge-retrieval-and-evidence` | platform | Scoped retrieval plans, explanations and immutable evidence packets |
| `knowledge-evaluation` | platform | Reviewed retrieval cases, ablations, release recommendations |
| `vector-store-management` | platform | Store classes, ingestion, publication and rollback |
| `jev-system-one` | jev-cli, jev-mcp, jev-http | Jev typed decisions over inline, local and remote inputs; persistent single-host jobs, process workers, bounded batches and LLM composition |

## Two distributions: the executor's `knowledge` and the platform `ks`

`@aiengineer/knowledge-verification-executor` ships the sandbox `knowledge` (and `knowledge-verify`)
binary with the `schema_*`, `db_*`, `ingest_*`, `artifact_get`, `report_*`, `source_*`, `content_*`,
`checkpoint_*` and `recovery_*` operations until Unit 5H removes it. `@aiengineer/knowledge-cli` ships
`ks` (Unit 5C): `ks knowledge|verify|db …` call the admitted API, and the `ks verify capture|chain|artifact`
intent pipeline runs on the local file-store profile. Its `pack:sandbox` tarball ships the `platform-cli`
skills. A bare binary name is not a dependency identity: a run pin must name the distribution, and
`manifest.json` records which surfaces each skill uses.

`@aiengineer/knowledge-jev-service` ships the separate `jev` binary. Its client commands use the
Jev HTTP interface; its `/mcp` tools share that host's queue. Dedicated `mcp-stdio` starts its own
host and must use a separate database if an HTTP host is already running.

## Conformance

```bash
node skills/check.mjs          # exit 1 on drift, 2 when a catalog source cannot be read
node skills/check.mjs --json   # digests per skill, for freezing onto an explicit run pin
```

The check reads the implemented catalogs — the executor operation registry and MCP server, the
`ks` command table (`apps/cli/src/ks-commands.ts`, with fail-closed status from `CLI_COMMANDS`), the platform MCP tool list, and the Jev MCP/CLI sources — and fails when a skill names a
command or tool that is not implemented, names an explicitly unsupported platform command, uses a
surface it did not declare, omits a catalog operation it owns, or describes a structural seal as
admission. `absentOperations` and `artifactTypes` document names that deliberately are not
operations; the check fails if one of them becomes an admitted operation.

Skill digests use the same content hash as the research run-pin installation (sorted relative paths
over the complete UTF-8 bytes of `SKILL.md` and every reference file), so an installed child slot and
the pinned digest can be compared directly.
