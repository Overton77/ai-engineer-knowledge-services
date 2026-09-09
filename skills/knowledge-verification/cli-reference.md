# Knowledge verification CLI reference

Bin name: `knowledge` (`apps/cli/package.json` → `./dist/index.js`). Package: `@aiengineer/knowledge-cli`.

## Generic invocation

Catalog commands (not the five specials) parse argv as `knowledge <group> <action> [flags]`.

| item | contract |
| --- | --- |
| flags | `--base-url`, `--context` (JSON `OperationContextSchema`), `--input` (JSON, default `{}`), `--timeout-ms` (100–300000, default 60000), `--wait` (verification_mutation only), `--human` (pretty JSON) |
| env | `KNOWLEDGE_API_URL` (or `--base-url`), `KNOWLEDGE_API_TOKEN` (required for catalog commands) |
| stdout | JSON of the accepted mutation/read payload, or the `--wait` completion object |
| stderr | `{code,message}` — generic `{code:"CLI_ERROR",message}`; unknown command `{code:"UNKNOWN_COMMAND",group,action}` |
| exit | implicit `0` on success without `--wait`; `--wait` uses `completed.exitCode`; catch → `2` |

`--context` is the full envelope in `packages/contracts/src/identity.ts` (`OperationContextSchema`): `tenantId`, `operationId`, `attemptId`, `correlationId`, `actor`, `capabilityVersion`, `idempotencyKey`, `reason`, `contractVersion` (`"v1"`), optional `projectId`, `missionId`, `workItemId`, `causationId`, `externalExecution`. Spec-style flags such as `--operation-id`, `--mission-id`, `--policy` are **not** implemented.

`--input` must be a JSON object. Mutation bodies are the public request schemas. Read commands accept only the keys in the catalog table.

### `--wait` semantics

`--wait` is ignored unless `command.mode === "verification_mutation"`. It requires `operationId` on the accepted payload, then polls `getVerificationOperation` (`verification-completion.ts`). `--wait` also reads `GET /v1/receipts/:id` for every receipt id and therefore requires `knowledge.read` on the same bearer plus the API receipts reader configured (503 without a resource reader).

| operation kind | `--wait` |
| --- | --- |
| `verification_capture` | exit `0` (capture treated as quality-passed) |
| `verification_extraction` | `0` if `result.valid===true`, `1` if `false` |
| `verification_replay` | same `result.valid` rule |
| `verification_metric` | same `result.valid` rule |
| `verification_benchmark` | `0` on success receipt |
| `verification_benchmark_compare` | `0` unless `engineeringGateOutcome==="fail"` → `1` |
| `verification_claims` | `0` if `disposition==="admitted"`, else `1`; completion `{operationId,state,claims:{runId,manifestDigest,policyOutcome,mechanicalStatus,disposition},receiptId,exitCode}` (not authoritative) |
| `verification_report` | same with `report` instead of `claims` |
| `needs_review` state | exit `1` (`qualityPassed: false`) |
| `failed` / `cancelled` / `quarantined` | throw → CLI `2` |
| timeout / missing success receipt / `valid` not boolean | throw → CLI `2` |

`--wait` does **not** handle these kinds (throws a message that starts with `VERIFICATION_WAIT_UNSUPPORTED_KIND:<kind>` → exit `2` even after `succeeded`): `verification_parse_artifact`, `verification_adjudication`, `verification_adjudication_decision`, `verification_audit_bundle`, `verification_structured_extraction`.

Poll instead: `knowledge verify status --input '{"operationId":"<uuid>"}'` then the terminal read in the catalog. Prefer `verify status` (`getVerificationOperation` → `GET /v1/verification/operations/:id`) over `operation status` (generic `GET /v1/operations/:id`). Claims/report `held_for_review` / `needs_review` / `review_required`: escalate to adjudication; do not retry or override. The signed `verify claims-result` / `verify report-result` read remains authoritative.

## Command catalog

Verification rows from `CLI_COMMANDS` + `dispatchCliCommand` (30). `--input` keys are required unless marked optional.

| group | action | mode | use case / resource | required input keys |
| --- | --- | --- | --- | --- |
| reconciliation | apply | provider_reconciliation | apply | `operationId`, `providerAttemptId`, `artifact` |
| reconciliation | show | provider_reconciliation | show | `operationId`, `providerAttemptId` |
| extraction | run | verification_mutation | extractStructuredData | full `ExtractStructuredDataRequestSchema` |
| extraction | show | read | structured_extraction | `operationId` only |
| benchmark | comparison | read | benchmark_comparison | `comparisonId` only |
| benchmark | compare | verification_mutation | compareBenchmarkRuns | full `CompareBenchmarkRunsRequestSchema` |
| benchmark | show | read | benchmark_run | `runId` |
| benchmark | manifest | read | benchmark_manifest | `runId` |
| benchmark | run | verification_mutation | runBenchmark | full `RunBenchmarkRequestSchema` |
| benchmark | capture | verification_mutation | captureSource | full `CaptureSourceRequestSchema` |
| artifact | parse | verification_mutation | parseArtifact | full `ParseArtifactRequestSchema` |
| verify | status | read | verification_operation (`getVerificationOperation`) | `operationId` only |
| verify | claims-result | read | claims_result | `operationId` only |
| verify | report-result | read | report_result | `operationId` only |
| verify | cases | read | verification_cases | `runId`; optional `pageSize`, `cursor` |
| verify | case | read | verification_case | `caseRunId` |
| verify | evidence | read | verification_evidence | `evidenceId` |
| verify | run | read | verification_run | `runId` |
| verify | manifest | read | verification_manifest | `runId` |
| verify | extract | verification_mutation | verifyExtraction | full `VerifyExtractionRequestSchema` (exactly one `captureId`) |
| verify | citations | verification_mutation | verifyClaims | full `VerifyClaimsRequestSchema` |
| verify | report | verification_mutation | verifyReport | full `VerifyReportRequestSchema` |
| verify | metric | verification_mutation | verifyMetricObservation | full `VerifyMetricObservationRequestSchema` |
| bundle | inspect | verification_mutation | inspectAuditBundle | full `InspectAuditBundleRequestSchema` |
| bundle | show | read | audit_inspection | `operationId` only |
| bundle | replay | verification_mutation | replayRun | full `ReplayRunRequestSchema` |
| adjudication | request | verification_mutation | requestAdjudication | full `RequestAdjudicationRequestSchema` |
| adjudication | decision | verification_mutation | recordAdjudicationDecision | full `VerificationAdjudicationDecisionRequestSchema` |
| adjudication | get | read | adjudication | `operationId` only |
| adjudication | get-decision | read | adjudication_decision | `operationId` only |

`benchmark capture` is overridden when `argv[2] === "diagnostics-companies"` (special below). Adjacent non-verification groups (`operation status|events|retry|reconcile`, retrieve, eval, …) exist on the same bin but are out of scope for this skill.

There is no `capture show` catalog action.

## Special local commands

These bypass `KNOWLEDGE_API_TOKEN` except where noted. Stderr codes: `DEMO_ERROR`, `BENCHMARK_CAPTURE_ERROR`, `BENCHMARK_DIFF_ERROR`, attestation codes.

| group | action | mode | flags | exit |
| --- | --- | --- | --- | --- |
| demo | diagnostics-companies | local | `--dataset` (must `diagnostics-companies-v1`), `--output` (required), `--open` | `qualityGate.exitCode`: pass `0`, fail `1`, unavailable/`verification_incomplete` `2`; catch `2` |
| benchmark | capture diagnostics-companies | local+HTTP optional | `--propose-version` (must `diagnostics-companies-v2`), `--output` (default `.knowledge/benchmark-proposals/diagnostics-companies-v2`), `--profile` (must `diagnostics-companies`), `--base-url`, `--timeout-ms` (100–60000, default 60000) | `0` `proposed_review_required`; `2` `refresh_incomplete` |
| benchmark | diff | local | positional previous/proposed; `--catalog-root`, `--proposal-root` | success `0`; catch `2` |
| verification | attestation-export | local | `--audit-bundle`, `--trusted-public-keys`, `--trusted-binding`, `--output` | `0`; catch `2` |
| verification | attestation-inspect | local | `--audit-bundle`, `--trusted-public-keys`, `--trusted-binding`, `--attestation` | `0` verified / `1` not; catch `2` |

## How to run from the repo

Working directory: `ai-engineer-knowledge-services/`. There is no root `package.json` script for the CLI.

1. **Built bin (required for the demo).** Demo assets are copied to `apps/cli/dist/demo-assets/` only by `apps/cli` `build` (`tsup` + `scripts/copy-demo-assets.mjs`). They are not next to `src/`.

```text
corepack pnpm --filter @aiengineer/knowledge-cli build
node apps/cli/dist/index.js demo diagnostics-companies --dataset diagnostics-companies-v1 --output <dir>
node apps/cli/dist/index.js verify citations --context '<json>' --input '<json>'
```

If the `knowledge` bin is on `PATH` after install/link, the same argv works.

2. **Dev (catalog HTTP commands).** `apps/cli` script `dev` is `tsx src/index.ts`. Extra args after `--`:

```text
corepack pnpm --filter @aiengineer/knowledge-cli dev -- verify citations --context '<json>' --input '<json>'
```

Do not use `tsx src/index.ts` for `demo diagnostics-companies` unless demo assets exist beside the executing module; the supported path is the built `dist/index.js`.
