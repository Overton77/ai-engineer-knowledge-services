# Ledger — docs/skill sync to `--wait` claims/report + `verify status` + MCP poll tool

No `.ts` or tests modified. Grounded in `apps/cli/src/verification-completion.ts`, `apps/cli/src/commands.ts`, `apps/mcp/src/index.ts`.

## Files changed

- `skills/knowledge-verification/SKILL.md` — `--wait` now includes claims/report (`WAITABLE_VERIFICATION_RECEIPTS`); unhandled list is the five remaining kinds (`VERIFICATION_WAIT_UNSUPPORTED_KIND`); poll via `verify status` / `knowledge_get_verification_operation`; claims/report completion + `held_for_review` escalate rule; signed terminal read remains authoritative.
- `skills/knowledge-verification/cli-reference.md` — `--wait` table adds claims/report dispositions; unhandled kinds + new error name; prefer `verify status`; catalog row `verify status` / `verification_operation` / `getVerificationOperation`; catalog count 30.
- `skills/knowledge-verification/mcp-reference.md` — added `knowledge_get_verification_operation`; spec `knowledge_get_operation` maps to that name; tool count 30 (13+17).
- `skills/knowledge-verification/examples.md` — claims may use `--wait`; poll example uses `verify status`; completion shape includes `claims?`/`report?`; signed result remains authoritative.
- `docs/verification/SURFACE-REFERENCE.md` — `--wait` exits/unhandled list; `verify status` catalog row; MCP poll tool; counts 30/35/30.
- `docs/verification/OPERATOR-RUNBOOK.md` — `verify citations --wait` is handled; poll via `verify status`; handled-kind list includes claims/report.
- `docs/verification/INTEGRATION-GUIDE.md` — polling names `verify status` and `knowledge_get_verification_operation`; failure table adds claims/report dispositions.
- `../.cursor/skills/knowledge-verification/SKILL.md` — wrapper wait/poll line matches handled vs unhandled kinds.
- `docs/workspaces/verification-module/stabilization-20260908/AS-BUILT-INVENTORY.md` — CLI `--wait` kinds; `verify status` row; MCP poll tool; counts 30/35/30.
- `docs/workspaces/verification-module/stabilization-20260908/ledger-inventory.md` — finding 4 updated to current waitable vs unhandled kinds and the `VERIFICATION_WAIT_UNSUPPORTED_KIND` throw.
- this file — created.

## Unchanged (checked)

- `skills/manifest.json` — skill ids/paths only; no tool or command names to add.
- Root `README.md` — no `--wait` coverage or MCP tool count.

## Audit remediation (A-01…A-13)

- **A-01** — Stated that production ownership grants require `--context` / MCP `context` `attemptId`+`missionId`+`workItemId` (and the `x-verification-*` headers) or 403; added those IDs to the CLI session example. Files: `skills/knowledge-verification/examples.md`, `SKILL.md`, `mcp-reference.md`, `docs/verification/INTEGRATION-GUIDE.md`.
- **A-02** — Registered-capture examples now use `requestedProjectionKinds:["html_dom"]`; documented the two admitted shapes (`web_page`→`html_dom`; acquire+pdf→`pdf_text`+`geometry`). Files: `examples.md`, `SKILL.md`, `INTEGRATION-GUIDE.md`.
- **A-03** — Replaced the false `VerificationOperationReceiptSchema` stdout with `AcceptedOperationSchema`; SKILL.md now sends agents to the terminal read for artifact handles. Files: `examples.md`, `SKILL.md`.
- **A-04** — Added an Ownership grants subsection (shape, 1–256, uniqueness, example, seed-orchestration prerequisite) and a rollout step before API start. Files: `docs/verification/DEPLOYMENT.md`, `OPERATOR-RUNBOOK.md`.
- **A-05** — Disposable reset path now `../ai-engineer-db-contract/scripts/reset-disposable-local.mjs`. File: `OPERATOR-RUNBOOK.md`.
- **A-06** — `verify extract` / `knowledge_verify_extraction` now say exactly one `captureId`. Files: `SKILL.md`, `examples.md`, `cli-reference.md`, `mcp-reference.md`.
- **A-07** — `--wait` also reads `GET /v1/receipts/:id` and needs `knowledge.read` plus the API receipts reader. Files: `cli-reference.md`, `SURFACE-REFERENCE.md`.
- **A-08** — skipped (code/test; coordinator).
- **A-09** — Decision route accepts actor `human`, or `service` with `human_reviewer`; never `model`. Files: `OPERATOR-RUNBOOK.md`, `SKILL.md`, `SURFACE-REFERENCE.md`, `examples.md`.
- **A-10** — Added a Spec deviations / deferred table (§17 reviews route; §19 tool names; §18 catalog flags / JSONL / checkpoint). File: `docs/verification/README.md`.
- **A-11** — left unchanged (`operationId` only remains correct after the coordinator code change).
- **A-12** — `--wait` unsupported-kind text now “starts with `VERIFICATION_WAIT_UNSUPPORTED_KIND:<kind>`”. Files: `SKILL.md`, `cli-reference.md`.
- **A-13** — One sentence: `--context.actor` is CLI-schema-local; the API binds the bearer actor. File: `examples.md`.
- **A-14** — skipped (not a doc task).
