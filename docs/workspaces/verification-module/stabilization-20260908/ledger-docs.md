# Ledger — verification documentation set (2026-09-08)

> **Superseded note (EV-168, same day):** statements below about `--wait` not covering claims/report and about the absence of an operation-status MCP tool describe the code *before* the stabilization changes. Current behaviour: `--wait` grades `verification_claims`/`verification_report`; `knowledge verify status` and MCP `knowledge_get_verification_operation` exist. See `ledger-docs-sync.md` and `WS-12-COMPLETION-AUDIT.md`.

Owner: docs agent. No `.ts`, test, or `package.json` files modified. No builds/tests run. `.env` not read.

## Files written / edited

| Path | Action |
| --- | --- |
| `docs/verification/README.md` | created |
| `docs/verification/SURFACE-REFERENCE.md` | created |
| `docs/verification/OPERATOR-RUNBOOK.md` | created |
| `docs/verification/DEPLOYMENT.md` | created |
| `docs/verification/INTEGRATION-GUIDE.md` | created |
| `.env.example` | edited (54 missing `VERIFICATION_*` appended; existing lines left in place) |
| `README.md` | edited (operator docs + Gate 6 deployment link + verification subsection) |
| this file | created |

Did not touch `skills/` or `.cursor/`.

## Files read

### Primary
- `docs/workspaces/verification-module/stabilization-20260908/AS-BUILT-INVENTORY.md` (full)
- `packages/verification/README.md` (full)
- `docs/workspaces/verification-module/ENGINEERING-HANDOFF-20260908.md` (full)
- `docs/workspaces/verification-module/ACCEPTANCE-MATRIX.md` (header rows + EV-161 close)
- `docs/specifications/verification-module.md` (§1–6.2, §5 verdicts, §21 Eve bridge)

### Contracts / client / CLI / API
- `packages/contracts/src/identity.ts` — `OperationContextSchema`, `ExternalExecutionContextSchema`, `ServiceIdentitySchema`
- `packages/contracts/src/verification/requests.ts` — request schemas + hints
- `packages/contracts/src/verification/primitives.ts` — `VerificationIdSchema`, `VerificationOperationContextSchema`
- `packages/contracts/src/verification/model.ts` — `SemanticVerdictSchema`, `PolicyOutcomeSchema`
- `packages/contracts/src/verification/adjudication.ts` — decision request
- `packages/contracts/src/verification/provider-reconciliation.ts` — apply schema
- `packages/contracts/src/integration.ts` — `AcceptedOperationSchema`, `OperationStatusSchema`, operation kinds
- `packages/contracts/src/primitives.ts` — `IdempotencyKeySchema`
- `packages/client-typescript/src/client.ts` — methods, headers, `VerificationClientContext`
- `apps/cli/package.json` — bin `knowledge`, scripts `dev`/`build`
- `apps/cli/src/index.ts` — flags, specials, `--wait`
- `apps/cli/src/commands.ts` — catalog, `CliKnowledgeClient`, retry/reconcile
- `apps/cli/src/verification-completion.ts` — `--wait` kinds and exits
- `apps/cli/src/diagnostics-demo.ts` — demo args/exits
- `apps/cli/src/verification-attestation.ts` — flags + `KNOWLEDGE_VERIFICATION_ATTESTATION_SIGNING_KEY_PEM`
- `apps/api/src/server.ts` — `verificationContext`, GET 503s, `/health`, adjudication `human_reviewer`, operations GET
- `apps/api/src/index.ts` — `createApiRuntime`, drift, storage default
- `apps/api/package.json`, `apps/worker/package.json`, `apps/mcp/package.json`
- `apps/mcp/src/catalog.ts` — 13 tools + forbidden
- `apps/mcp/src/index.ts` — port 4101, `/mcp`, extra 16 tools
- `packages/application/src/verification-benchmark.ts` (output inventory)
- `packages/application/src/surface.ts` — receipt URL construction
- `packages/persistence/src/verification.ts` — object key layout
- `packages/persistence/package.json` — contract 0.2.38 pin
- `packages/config/src/index.ts` — HOST/PORT defaults

### Ops / infra / existing docs
- `package.json` (root) — engines, `verify`, `dev:*`
- `.env.example` (before edit)
- `README.md` (before edit)
- `docs/operations/runbooks.md` (exists)
- `docs/security.md` (exists)
- `docs/architecture/0001-runtime-and-deployment.md`
- `infra/aws/README.md`
- `.dockerignore`
- `.github/workflows/verify.yml`
- `services/verification-parser/README.md`
- `docs/workspaces/verification-module/LOCAL-RESET-RECOVERY.md`
- `docs/workspaces/verification-module/swarm-plan-20260906/SW-00-FULL-VERIFY-REGRESSION.md`

### Not read (intentionally)
- `.env` (secrets)
- Historical workspace ledger beyond acceptance/handoff/inventory/SW-00/LOCAL-RESET
- Mission Control `verification-temporal.ts` (pointer only)
- Every worker activity file (used inventory §6 after spot-checking worker package scripts)

## Claims verified against source (were inventory “or needed check”)

- Verdict lattice and policy outcomes match `model.ts`.
- 13 kinds and 12 use cases match inventory; `recordAdjudicationDecision` omitted from `VerificationUseCaseSchema`.
- CLI bin `knowledge`; `--wait` kinds and exit 0/1/2 match `verification-completion.ts` + `index.ts`.
- `--wait` does **not** handle claims/report/parse/adjudication/audit/structured extraction.
- MCP 29 tools + forbidden list + PORT 4101.
- Adjudication decision requires authenticated `human_reviewer` (not `model`).
- GET capability-off 503 `CAPABILITY_NOT_ADMITTED` on family reads; `GET /health` always ok; `GET /v1/verification/operations/:id` does **not** 503 for missing verification capability.
- Object key `{tenantId}/{digest[7:9]}/{digest[7:]}`.
- Contract pin 0.2.38.
- Demo output file list from `runDiagnosticsCompaniesDemo`.
- Request example fields exist on Zod schemas.
- Receipt URLs are `/v1/operations/{id}` (`packages/application/src/surface.ts`), not `/v1/verification/operations/{id}`.
- `.env.example` was missing exactly the 54 names in inventory §7.3; all 54 appended.

## Doc / code mismatches recorded

1. Spec §6.2 package topology (`domain/`, `metrics/`, `experiments/`, `demos/` under `packages/verification`) does not match as-built (metrics/application, experiments/evaluation+application, demos/CLI). README states as-built.
2. ADR 0001 says MCP does not call a sibling HTTP endpoint. Verification MCP tools proxy `KnowledgeClient` to the HTTP API.
3. KS operation state is `succeeded`, not `completed`. MC handoff uses `completed` + `review_required`. Docs distinguish both.
4. CLI `--context` requires full `OperationContextSchema`; HTTP verification mutations send headers only. Documented.
5. Inventory says 36 `/v1/verification` paths; not independently re-counted in `server.ts`.
6. Reconciliation CLI apply/show uses the **extraction** HTTP host only (`commands.ts`). Claims/report recon exists on HTTP/client (`applySemanticProviderReconciliation`) but is not a CLI group.

## Unverifiable / omitted

- Exact Temporal namespace name (operator-provisioned; not in KS).
- Production parser image digest (operator `docker image inspect`; offline demo uses a fixture digest — not documented as the deploy pin).
- Whether every inventory §7 env is still read at the cited line (not re-opened all api/worker sites).
- Mission Control `verificationWorkflow` internals and `REJECT_DUPLICATE` source (handoff + user instruction; MC files not read).
- `statusUrl` host/origin when `KNOWLEDGE_API_URL` is unset in non-production (origin helper exists; example uses a placeholder host).
- Whether `GET /v1/operations/{id}` and `GET /v1/verification/operations/{id}` return identical bodies (both exist; poll either).
- Eve-host env `EVE_VERIFICATION_GRANTS_JSON` / `EVE_VERIFICATION_SIGNING_PRIVATE_KEY_PEM` are **not** KS `process.env` reads (spec §21 only). Not added to `.env.example`.
- `skills/knowledge-verification/SKILL.md` linked from root README though another agent owns that file (may not exist at write time).

## Acceptance titles used

Copied from `ACCEPTANCE-MATRIX.md` for VR-007, 008, 010, 011, 014, 017, 019, 020, 021, 034, 037, 038, 040, 041, 042. Status 31/8/7 from EV-161 / ENGINEERING-HANDOFF.
