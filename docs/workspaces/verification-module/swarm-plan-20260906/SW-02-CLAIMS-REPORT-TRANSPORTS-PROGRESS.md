# SW-02 claims/report transport parity proof progress

Updated 2026-09-07. Scope is a new loopback-only configured HTTP/client/CLI/MCP submission proof using the retained native claims/report worker fixture. No shared service, contract, API, client, CLI, MCP, provider, parser, database, or Storage source was changed.

## Implemented proof boundary

- `scripts/prove-verification-claims-report-transports.ts` resolves retained registered claims and report requests from the existing worker fixture and their canonical operation records.
- It composes an ephemeral `127.0.0.1` API with server-owned identity, exact ownership grants, a `PostgresKnowledgeOperationService` restricted to claims/report operation kinds, and an exact retained-artifact admission predicate.
- It exercises typed HTTP client submission and retry idempotency, the CLI dispatcher, and MCP verification executor for both claims and report. Unauthorized actor attempts must reject. New operations remain queued and are cancelled before database close; no worker, parser, provider, or remote process is started.
- Claims/report have no public typed terminal receipt/result read route in the current client/API/CLI/MCP surfaces. The proof labels cross-transport terminal-result parity unsupported instead of inventing a read endpoint.

## Current check status and limitation

The existing structured-transport TypeScript configuration cannot presently typecheck either the old proof or this new proof because shared API/MCP code references `inspectAuditBundle` while the installed `KnowledgeClient` lacks that method. The resulting errors occur in `apps/api/src/server.ts`, `apps/mcp/src/index.ts`, and existing `prove-verification-structured-extraction-transports.ts`; they are outside this proof's owned scope and were reported to the coordinator. No broad build or proof execution was run while shared audit/client wiring is in progress.

No receipt exists yet because execution would mutate the canonical local operation journal; run only after the shared type defect is repaired and coordinator sequencing permits it.

## Pre-run custody hardening

- Admission is now an exact canonical request-digest allowlist derived from the two retained requests, after verifying every unique referenced artifact is registered to the fixture tenant with its exact stored SHA-256 digest. The configured API predicate is an engineering proof fixture grant, not human or production authority.
- The proof uses synthetic engineering service identities. It rejects a different tenant, a denied identity, and a changed capture list under the same idempotency key before enqueue.
- A `wx` startup journal is written before the first mutation. Any failure writes a separate retained failure receipt. Every queued proof operation is cancelled and its cancelled state re-read before the success receipt is written; `finally` retains a second cancellation guard.
- The script additionally rejects query/hash endpoint overrides before server composition.

## Executed loopback proof

`VERIFICATION_LOCAL_DIRECT_DEFAULTS=1 node internal/verification-run-local-proof.mjs claims-report-transports` exited 0. Receipt: `internal/verification-claims-report-transports-5f818ba4-f88c-4f3a-bdab-9dcbbb6664ea.json`. Both exact retained requests passed HTTP typed-client retry idempotency, CLI dispatcher, and MCP executor submission; denied actor, changed tenant, and changed request were rejected. All six new operations were re-read as cancelled before the success receipt. The proof made zero parser/provider calls. This is configured loopback API plus in-process CLI/MCP adapter evidence; public claims/report terminal result parity remains unsupported because no read surface exists.

Independent read-only audit confirms all six durable rows are cancelled, have zero receipts, retain tenant/mission/work-item/attempt bindings, and have stored request SHA-256 values matching freshly canonicalized request JSON. See `SW-02-CLAIMS-REPORT-TRANSPORTS-INDEPENDENT-AUDIT.md` and `internal/verification-claims-report-transports-independent-audit-5f818ba4-f88c-4f3a-bdab-9dcbbb6664ea.json`.
