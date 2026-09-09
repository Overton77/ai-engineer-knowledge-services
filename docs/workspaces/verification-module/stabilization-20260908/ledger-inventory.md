# Ledger — AS-BUILT inventory (2026-09-08)

## What I did

Read-only inventory of the Knowledge Verification module from TypeScript source. No source edits, no builds, no tests, no `.env` reads.

Wrote:

- `docs/workspaces/verification-module/stabilization-20260908/AS-BUILT-INVENTORY.md`
- this ledger

## Files read (primary)

- `apps/api/src/server.ts` (routes ~1111–2628, `verificationContext`, drift consumer)
- `apps/api/src/index.ts` (`createApiRuntime` env composition)
- `apps/api/src/verification-*-runtime.ts` (reads/recon/decision/drift/capture)
- `packages/contracts/src/index.ts`, `packages/contracts/src/verification/{index,operations,model,requests,reads,parse,adjudication,provider-reconciliation}.ts` and schema greps across the folder
- `packages/application/src/index.ts` + export greps on `verification-*.ts`
- `apps/cli/src/{index,commands,verification-completion,diagnostics-demo,benchmark-capture,benchmark-version-diff,verification-attestation}.ts`, `apps/cli/package.json`
- `apps/mcp/src/{index,catalog}.ts`
- `apps/worker/src/{index,worker,verification-activities,verification-*-activity,verification-*-runtime}.ts`
- `packages/verification/src/index.ts` + subdirectory indexes + export greps
- `packages/persistence/package.json` + SQL greps in `verification*.ts`
- `.env.example`, root `package.json`, `.github/workflows/verify.yml`
- `scripts/prove-verification-*` filename listing (87)
- `ls` of `../ai-engineer-mission-control` verification-named files (not read deeply)

## Search method

`rg` for `/v1/verification`, `environment.VERIFICATION_`, `process.env.VERIFICATION_`, `knowledge_service.`, `^export const \w+Schema`, `operationKind:`. Did not pass `-h` to rg.

`process.env.VERIFICATION_` does not appear in api/worker/mcp/cli; those processes read `environment.VERIFICATION_*` where `environment` defaults to `process.env`.

## Ambiguities / notes (not guessed)

1. **Drift HTTP** lives at `/v1/internal/verification/...` — substring is not `/v1/verification`. Listed as adjacent only.
2. **`recordAdjudicationDecision`** is an HTTP/CLI/MCP use case and a worker kind, but is **absent** from `VerificationUseCaseSchema` and `VerificationMutationRequestSchema`.
3. Routes are **always registered**; env vars compose `options.*`. Empty env → 503 `CAPABILITY_NOT_ADMITTED`, not an unregistered route.
4. **`waitForVerification`** (`WAITABLE_VERIFICATION_RECEIPTS`) handles capture / extraction / replay / metric / benchmark / compare / claims / report. Unhandled kinds (`verification_parse_artifact`, adjudication request/decision, audit, structured extraction) throw `VERIFICATION_WAIT_UNSUPPORTED_KIND:<kind>` → CLI exit 2.
5. **`packages/config`** has no `VERIFICATION_*` reads. MCP/CLI have none either.
6. **`knowledge_service.*`** tables used by verification persistence are only `operation`, `operation_step`, `receipt`, `operation_event`, `lease`. Most verification rows live in `evidence.*` / `orchestration.*`.
7. **`packages/testkit`** has no verification surface (retrieval/embedding only).
8. Script-only `VERIFICATION_*` (proof/dashboard/parser/eve) were **excluded** from the api/worker/mcp/cli matrix.
9. Fastify registers `artifacts::parse`; public URL form used in tests is `:parse` (single colon). Inventory uses the public form.
10. Mission-control “dashboard” is inferred from file names (`verification-http.ts`, prove-dashboard scripts); UI route tree not enumerated.
11. `claims/` under `packages/verification` has no dedicated `*.test.ts`; coverage is unverified beyond sibling package tests.
12. Worker does not read `VERIFICATION_METRIC_ENABLED` / `VERIFICATION_CLAIMS_ENABLED`; those are API admission flags. Worker enables by grants JSON presence.

## Counts for parent summary

- HTTP `/v1/verification` routes: **36**
- CLI commands documented: **34** (29 catalog + 5 special)
- MCP verification tools: **29**
- `VERIFICATION_*` env vars read by api/worker: **67**
- Of those, missing from `.env.example`: **54**
