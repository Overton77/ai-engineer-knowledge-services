# Ledger: Knowledge Verification agent skill

> **Superseded note (EV-168, same day):** statements below about `--wait` not covering claims/report and about the absence of an operation-status MCP tool describe the code *before* the stabilization changes. Current behaviour: `--wait` grades `verification_claims`/`verification_report`; `knowledge verify status` and MCP `knowledge_get_verification_operation` exist. See `ledger-docs-sync.md` and `WS-12-COMPLETION-AUDIT.md`.

**Date:** 2026-09-08  
**Scope:** Author repo + Cursor skills for CLI/MCP verification. No `.ts` / test / `package.json` edits. No builds or tests. No `.env` reads.

## Written

- `skills/knowledge-verification/SKILL.md` (179 lines)
- `skills/knowledge-verification/cli-reference.md`
- `skills/knowledge-verification/mcp-reference.md`
- `skills/knowledge-verification/examples.md`
- `skills/manifest.json` — added `{ "id": "knowledge-verification", "version": "1.0.0", "path": "knowledge-verification/SKILL.md" }`
- `skills/README.md` — "five" → "six"; one added sentence
- `../.cursor/skills/knowledge-verification/SKILL.md` (workspace wrapper, 61 lines)
- this ledger

## Files read

### Inventory / spec / house style / authoring

- `docs/workspaces/verification-module/stabilization-20260908/AS-BUILT-INVENTORY.md` (§1 HTTP, §2 contracts, §4 CLI, §5 MCP)
- `docs/specifications/verification-module.md` (§18 CLI, §19 MCP, §22 Cursor Cloud skills)
- `skills/knowledge-evaluation/SKILL.md`, `skills/README.md`, `skills/manifest.json`
- `skills/knowledge-retrieval-and-evidence/SKILL.md` (frontmatter convention)
- `C:\Users\Pinda\.cursor\skills-cursor\create-skill\SKILL.md`
- `docs/workspaces/verification-module/stabilization-20260908/ledger-package-readme.md` (ledger style)

### Contracts (request shapes)

- `packages/contracts/src/verification/operations.ts` (`VerificationUseCaseSchema`, `Verify*InputSchema`, `VerificationOperationReceiptSchema`)
- `packages/contracts/src/verification/requests.ts` — **actual public request schemas**
- `packages/contracts/src/verification/parse.ts` (`ParseArtifactRequestSchema`)
- `packages/contracts/src/verification/adjudication.ts` (`VerificationAdjudicationDecisionRequestSchema`)
- `packages/contracts/src/identity.ts` (`OperationContextSchema`, `ActorSchema`, `ExternalExecutionContextSchema`)
- `packages/contracts/src/verification/primitives.ts` (`VerificationContractVersionSchema`, `VerificationIdSchema`, `VerificationArtifactHandleSchema`, `VerificationOperationContextSchema`)
- `packages/contracts/src/primitives.ts` (`Sha256DigestSchema`, `IdempotencyKeySchema`, `ContractVersionSchema`, `ArtifactReferenceSchema`)
- `packages/contracts/src/verification/reads.ts` (`VerificationArtifactReferenceSchema` pick used by decisions)
- `packages/contracts/src/verification/index-primitives.ts` (re-exports)

Not read in full (not required to fill public request examples): `model.ts` `AssertionSchema`, `selectors.ts`, `benchmark.ts` case/arm trees. Public `verifyClaims` / `runBenchmark` use artifact `{artifactId,digest}` and `executionMode: "offline_recorded"`, not those nested objects.

### CLI / MCP / package entrypoints

- `apps/cli/src/index.ts`
- `apps/cli/src/commands.ts`
- `apps/cli/src/verification-completion.ts`
- `apps/cli/src/diagnostics-demo.ts`
- `apps/cli/src/benchmark-capture.ts` (special flags; `DEFAULT_PROFILE`)
- `apps/cli/src/verification-attestation.ts` (flag names only)
- `apps/cli/src/benchmark-version-diff.ts` (flag names)
- `apps/cli/package.json` (`bin.knowledge`, `dev`/`build` scripts)
- `apps/cli/scripts/copy-demo-assets.mjs` (demo assets land in `dist/demo-assets/`)
- `apps/mcp/src/index.ts` (transport, `verificationContextSchema`, tool registration)
- `apps/mcp/src/catalog.ts` (`VERIFICATION_MCP_TOOL_NAMES`, `FORBIDDEN_MCP_CAPABILITIES`)
- `apps/mcp/package.json`
- `package.json` (`dev:mcp`)
- `packages/config/src/index.ts` (`HOST`/`PORT` defaults)
- `packages/application/src/verification-diagnostics-quality-gates.ts` (demo exit lattice)
- `packages/client-typescript/src/client.ts` (`getVerificationOperation` vs `getOperation` paths)

## Inventory / spec / code discrepancies

1. **Public request schemas are not in `operations.ts`.** They are in `requests.ts`, `parse.ts`, and `adjudication.ts`. `operations.ts` has internal `Verify*InputSchema` (inline `AssertionSchema` arrays) and `VerificationOperationReceiptSchema`. `VerificationUseCaseSchema` omits `recordAdjudicationDecision`.
2. **CLI `--context` is full `OperationContextSchema`**, requiring `operationId`, `attemptId`, `actor`, `capabilityVersion`, `reason`, `contractVersion`. Spec §18 flags (`--operation-id`, `--mission-id`, `--work-item-id`, `--attempt-id`, `--idempotency-key`, `--policy`, `--output`) are not implemented on catalog commands.
3. **MCP mutation context is slimmer** (`tenantId`, `correlationId`, `idempotencyKey` + hints). Read tools omit `idempotencyKey`. Distinct from both CLI `OperationContextSchema` and `VerificationOperationContextSchema` in `primitives.ts`.
4. **Spec §19 names** `knowledge_extract_structured`, `knowledge_get_operation`, `knowledge_inspect_run` — actual tools are `knowledge_extract_structured_data`; there is no operation-status MCP tool.
5. **`--wait` unhandled kinds** (`verification_claims`, `verification_report`, `verification_parse_artifact`, `verification_adjudication`, `verification_adjudication_decision`, `verification_audit_bundle`, `verification_structured_extraction`) throw after `succeeded` → CLI exit `2`. Inventory matches code.
6. **`--wait` vs agent rule:** code maps operation `needs_review` to exit `1`. Skill rule still treats `completed` + `review_required` as held, not an infrastructure failure and not overridable.
7. **No capture-show CLI/MCP tool.** Capture terminal is HTTP `GET /v1/verification/captures/:operationId` only.
8. **`operation status` ≠ verification wait poll.** CLI read uses `GET /v1/operations/:id`. `--wait` uses `GET /v1/verification/operations/:id`.
9. **Demo assets** exist only after `apps/cli` `build` (`dist/demo-assets/`). `tsx src/index.ts` has no sibling `demo-assets/`.
10. **MCP port:** `createMcpRuntime` defaults `4101`; `loadServerConfig` default `PORT` is `4100` (API).
11. **`recordAdjudicationDecision`:** inventory HTTP extra auth — actor not `model`; `serviceIdentity` must be `human_reviewer`. Decision cannot change admission (`admissionChanged: false`).
12. **`knowledge_apply_provider_reconciliation`** is a mutation registered next to the MCP read tools (inventory §5.2).
13. **`--wait` `valid` not boolean** throws → exit `2` (not exit `1`). Inventory summarizes only `valid===false` as `1`.

## Request shapes not fully verified

- Whether CLI/HTTP `202` accepted JSON is exactly `VerificationOperationReceiptSchema` (client print is the dispatch return; receipt example is schema-shaped, labeled illustrative).
- `ParseArtifactRequestSchema.sourceArtifact` full `VerificationArtifactHandleSchema` (many custody fields). Not required for the eight example bodies.
- Optional receipt `error` (`VerificationErrorSchema`) and `--wait` completion object beyond fields visible in `verification-completion.ts`.
- `OperationStatusSchema` field-by-field for `operation status` vs `getVerificationOperation`.
- `ExternalExecutionContextSchema` and `ActorSchema` `human`/`model` variants (examples use `service` + `knowledge_api` only).
- Acquire-mode `sourceUri` live catalog admission (schema refinements read; grants/env not exercised).
