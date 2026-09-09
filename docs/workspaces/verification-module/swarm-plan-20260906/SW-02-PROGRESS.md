# SW-02 progress ledger

## Owned slice

- `packages/contracts/src/verification/claims.ts`
- `packages/contracts/src/verification/index.ts`
- `packages/application/src/verification-claims.ts`
- `packages/application/src/verification-claims.test.ts`
- `packages/application/src/index.ts`
- `packages/contracts/src/integration.ts`
- `packages/application/src/surface.ts`
- `packages/application/src/verification-service.ts`
- `apps/worker/src/verification-claims-activity.ts`

## Implemented

- Added strict, versioned artifact payload contracts for atomic claim bundles and report ledgers. Report assertion offsets bind to exact UTF-16 positions in the registered report artifact; citation inputs preserve pointer state and declared/verifier-found provenance remains in the underlying assertion evidence edge.
- Added deterministic claim/report application composition. It hydrates only tenant-owned registered full handles, validates digest and byte length, derives verifier identity exclusively from a runtime port, replays the existing deterministic verifier, and exposes `deterministic_only` explicitly. A failed mechanical result cannot become a policy pass.
- Report-wide results retain citation completeness, all-citation correctness, valid-pointer conditional correctness, pointer failures, qualifier loss, contradiction/duplication and high-severity unsupported claims as separate fields. Policy outcome is independent from verdict details.
- Review correction: report-ledger citations now contain only a declared evidence ID. Pointer state is derived from deterministic evidence resolution; semantic support is `insufficient_evidence`, authority is `unknown`, and deterministic-only reports always require review. Ledger assertion entries must exactly and bijectively match the bundled report assertions.
- Added focused tests for server-owned verifier independence and registered artifact digest mismatch.
- Added durable operation vocabulary and steps: `verification_claims` / `verify_claims_and_register`, `verification_report` / `verify_report_and_register`, `verification_adjudication` / `request_adjudication_and_register`, and `verification_audit_bundle` / `inspect_audit_bundle_and_register`. The worker handler registers claims/report result artifacts under the existing fenced operation lifecycle. Adjudication intentionally fails closed until its append-only native store exists.
- Refactored claim/report identity and source admission to reuse metric patterns: the runtime port receives the full assertions artifact registration and capture IDs, returns server-owned producer/runtime principals, and native registered captures/sources are compared against every declared bundle entry. The worker handler now requires a sealer and records its sealed-run output before terminal artifact registration.

## Verification

| Command | Result |
| --- | --- |
| `corepack pnpm --filter @aiengineer/knowledge-contracts build` | exit 0 |
| `corepack pnpm --filter @aiengineer/knowledge-verification build` | exit 0 |
| `corepack pnpm --filter @aiengineer/knowledge-contracts test` | exit 0; 12 files, 47 tests |
| `corepack pnpm --filter @aiengineer/knowledge-application exec vitest run src/verification-claims.test.ts` | exit 0; 2 tests |
| `corepack pnpm --filter @aiengineer/knowledge-application typecheck` | exit 0 |
| `corepack pnpm --filter @aiengineer/knowledge-application build` | exit 0 |
| `corepack pnpm --filter @aiengineer/knowledge-worker typecheck` | exit 0 |

The full application test command was attempted before the focused test and did not pass: an existing benchmark test timed out after 15 seconds. The new claims test initially had a syntax error, then passed after correction. No database, Storage, Docker, provider, or `.env` action was taken.

## Durable/public integration gap

HTTP, client, CLI, MCP and audit-bundle routes must wait for coordinator runtime registration and native guard additions. Reuse generic operation/receipt/registered-artifact and sealed-run custody; add operation-kind admission and artifact consumer/type guards, report assertion spans, plus append-only review request/decision storage. Do not expose a route that merely queues an unhandled operation. `parseArtifact` remains an existing parser/pipeline concern outside this focused claims composition slice.

## Next

After native operation kinds and a worker sealer/runtime factory exist, add the cross-surface adapters and a deterministic golden fixture across direct application, worker, HTTP, CLI, and MCP. Then add `inspectAuditBundle` and bounded `requestAdjudication` ports over the sealed generic run/artifact store.

- Added claims/report audit sealer skeleton with required policy resolution, content-addressed result/policy input/manifest artifacts, and fenced generic run recording; worker typecheck pending/recorded in session.

## Independent review R2 (2026-09-06)

Read-only review retained in `SW-02-INDEPENDENT-REVIEW-R2.md`. The reviewed source snapshot passed focused contracts/application builds, 2 application claims tests, and 4 worker sealer tests. It found two blocking custody/admission gaps: API claims/report admission could enqueue without a configured worker claims handler, and the terminal operation result artifact was written outside the native lease-fenced sealed-run transaction. No database/provider/Storage proof was run. The API configuration finding was reported as under active remediation; the review must be refreshed against its final source before acceptance.

## Independent review R3 (2026-09-07)

`SW-02-INDEPENDENT-REVIEW-R3.md` refreshes R2 after the API grant admission and fenced terminal-artifact changes. Source review and focused checks close the two R2 source findings: routes fail closed without configured claims runtime grants, and the activity forwards the exact lease into persistence registration. Native Postgres/object-store cancellation and lease-expiry races remain open and require a real infrastructure proof; mocks do not establish atomic fencing.

## Request-adjudication transport slice (2026-09-07, pending focused checks)

Owned transport files were added/updated without changing the API server or application service: `apps/api/src/verification-adjudication-route.test.ts`, `packages/client-typescript/src/client.ts`, `packages/client-typescript/src/adjudication.test.ts`, `apps/cli/src/commands.ts`, `apps/cli/src/adjudication.test.ts`, `apps/mcp/src/{index,catalog,adjudication.test}.ts`, and `packages/contracts/scripts/generate-contract-artifacts.ts`.

The client, CLI `adjudication request`, and MCP `knowledge_request_adjudication` route only `RequestAdjudicationRequestSchema` through existing tenant-bound ownership headers and `operation.submit` authorization. The API test covers default capability-unavailable `503`, exact grant denial `403`, strict-body rejection, and accepted `verification_adjudication` enqueue. No decision, grant, override, human-gold, or terminal-read capability is claimed. The OpenAPI generator source adds only `POST /v1/verification/adjudications:request`; generated artifacts are intentionally not regenerated while contracts/application ownership is compiling.

Focused checks are held pending claims_custody's compile-stable notification; no broad build, provider, database, Storage, or credential action was run.

### Transport validation

After contracts/application stabilized, the focused suites passed:

| Command | Result |
| --- | --- |
| `corepack pnpm --filter @aiengineer/knowledge-client exec vitest run src/adjudication.test.ts` | exit 0; 1 test |
| `corepack pnpm --filter @aiengineer/knowledge-cli exec vitest run src/adjudication.test.ts` | exit 0; 1 test |
| `corepack pnpm --filter @aiengineer/knowledge-mcp exec vitest run src/adjudication.test.ts` | exit 0; 1 test |
| `corepack pnpm --filter @aiengineer/knowledge-application build` | exit 0; coordinated package-output refresh only |
| `corepack pnpm --filter @aiengineer/knowledge-api exec vitest run src/verification-adjudication-route.test.ts` | exit 0; 1 test |

The first API-test attempt returned `503 CAPABILITY_NOT_ADMITTED` from stale application package output; after the single coordinated application build, the same test passed. No generated OpenAPI artifact was written, no native fixture/runtime proof was run, and this transport coverage does not claim that a human decision, override, terminal read, or native subject transaction exists.

## Configured adjudication composition (2026-09-07, in progress)

Owned composition files are `apps/worker/src/index.ts` and `apps/api/src/index.ts`, with focused configuration coverage in `apps/worker/src/verification-adjudication-runtime-config.test.ts` and `apps/api/src/bootstrap.test.ts`.

The worker treats `VERIFICATION_ADJUDICATION_GRANTS_JSON`, `VERIFICATION_ADJUDICATION_REVIEW_REQUIREMENTS_JSON`, and `VERIFICATION_ADJUDICATION_PUBLIC_KEYS_JSON` as one bounded all-or-nothing server-owned trust set. It remains disabled when all are absent; partial, malformed, or invalid values fail closed. A complete adjudication configuration still separately requires the existing claims projection catalog for canonical source/projection admission, and creates `PostgresVerificationAdjudicationRepository` only for the adjudication handler. Audit-inspection configuration is neither read nor used for adjudication grants, keys, or review requirements.

API composition admits `verification_adjudication` only after the same three configured values, dynamic ownership context, exact tenant/artifact/digest claims-or-report grant, and a succeeded producer operation. It does not enable adjudication merely because audit inspection is configured. No decision, override, terminal read, database, Storage, provider, or native proof is claimed.

Focused worker validation is pending Sol's persistence repository source/export availability; no broad build was started.

Focused configuration check: `corepack pnpm --filter @aiengineer/knowledge-api exec vitest run src/bootstrap.test.ts src/verification-adjudication-route.test.ts` exited 0 (2 files, 7 tests). Worker focused configuration check remains held until the Sol-owned persistence repository export is present; no broad build was run.

### Composition validation

| Command | Result |
| --- | --- |
| `corepack pnpm --filter @aiengineer/knowledge-api exec vitest run src/bootstrap.test.ts src/verification-adjudication-route.test.ts` | exit 0; 2 files, 7 tests |
| `corepack pnpm --filter @aiengineer/knowledge-worker exec vitest run src/verification-adjudication-runtime-config.test.ts` | exit 0; 1 file, 2 tests |
| `corepack pnpm --filter @aiengineer/knowledge-worker typecheck` | exit 0 |
| `corepack pnpm --filter @aiengineer/knowledge-api typecheck` | exit 0 |

No broad build, database, object Storage, provider, or native worker execution was performed. These checks establish configuration parsing and typed composition only; native subject transaction proof remains outside this slice.

## Independent native adjudication audit (2026-09-07)

Executed `internal/audit-verification-adjudication-worker-ad8630a5.mjs` against proof `internal/verification-adjudication-worker-ad8630a5-5fce-4041-8218-42a581215198.json` after verifying its SHA-256 `ac0107dcb3226f2b3f603711c19e05651cfc4f4ef3495fbcd9644b176a1a4894` and the retained claims/report source proof digest.

The auditor used verified loopback-only local configuration, set direct SQL transactions read-only, and made Storage reads only. It independently found eight succeeded adjudication operations (HTTP/client/CLI/MCP across claims/report), one immutable pending subject and canonical packet for each, exact result/receipt/event/request/actor/step/producer bindings, source-manifest signature verification for both retained families, and exact packet parent closures. The recovery subject holds its original fence (`703`) while its terminal receipt has higher fence (`705`); the other seven pairs match. The cancelled attempt has zero subjects, packets, and receipts; the denied operation remains absent. No human decision or admission change is present.

Receipt: `internal/verification-adjudication-worker-independent-audit-ad8630a5-5fce-4041-8218-42a581215198.json`, SHA-256 `654bcb4ec720908f96a9e4a9a42fe03c4d7743fbb0fae078586be9cbe5aa80c7`. The executable auditor and receipt contain no credentials. No provider, parser, database, or Storage mutation occurred except writing the immutable local audit receipt.

### Independent native audit r2

r1 remains retained but its custody-scope wording was too broad. The new r2 auditor uses one direct PostgreSQL `BEGIN READ ONLY` session and verifies `SHOW transaction_read_only = on` before every SQL-only custody check; object access is Storage `get` only. It recomputes canonical durable request and step-input digests, binds context/actor/attempt/mission, receipt input/output and guarded event payload, hydrates every ordered packet parent against artifact metadata and Storage bytes, validates source signatures, exact parent/lineage metadata, and compares subject request/seal/policy/review/target fields. Result: 8 operations; exactly one original-subject/later-receipt fence recovery; cancellation/denial remain zero rows.

r2 receipt: `internal/verification-adjudication-worker-independent-audit-ad8630a5-5fce-4041-8218-42a581215198-r2.json`, SHA-256 `acd69339a927b8a6a7c234bc5726d87aa6464724c148869f1cf5c090a6210184`.

## Terminal-read transport preparation (2026-09-07)

The independent audit r2 is frozen for root’s r3 remediation; this agent will not alter its script or receipts. Next owned scope is API/client/CLI/MCP terminal-read transport only, pending claims_custody’s exact exported adjudication read contracts and native read service. Planned behavior is a tenant-bound, authenticated read of the public bounded terminal result only. The route, client method, CLI command, MCP catalog entry, and tests will fail closed when the configured read capability or exact actor grant is unavailable. No human decision, override, packet bytes, internal manifests, or raw storage coordinate is planned for transport output. No transport source or checks have been started pending the contract handoff.
