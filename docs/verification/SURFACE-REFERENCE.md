# Verification surface reference

Exact HTTP, CLI, MCP, and worker contracts as of the 2026-09-08 as-built inventory. Fastify registers `::action`; the public URL uses a single `:`.

Routes are always registered in `buildServer`. Missing capability configuration returns **503** `CAPABILITY_NOT_ADMITTED` (except operation status, which falls back to the generic operation service).

## HTTP

Auth: `Authorization: Bearer` via `resolveIdentity` plus `x-tenant-id`, except profile capture (Bearer only; tenant comes from the server-owned profile). Mutations also require `Idempotency-Key` (8–255). All mutation submits also require a configured verification operation service and a resolved verification context, or 503.

### Reads (`knowledge.read`)

| Method | Path | Extra auth | Request | Response | Enabling env |
| --- | --- | --- | --- | --- | --- |
| GET | `/v1/verification/claims/:operationId/provider-attempts/:providerAttemptId/reconciliation` | — | none (strict empty query) | 200 `VerificationProviderReconciliationResourceSchema` | `VERIFICATION_SEMANTIC_PROVIDER_RECONCILIATION_GRANTS_JSON` + keys + ownership |
| GET | `/v1/verification/reports/:operationId/provider-attempts/:providerAttemptId/reconciliation` | — | none | 200 same | same |
| GET | `/v1/verification/extractions/:operationId/provider-attempts/:providerAttemptId/reconciliation` | — | none | 200 same | `VERIFICATION_PROVIDER_RECONCILIATION_GRANTS_JSON` + keys + ownership |
| GET | `/v1/verification/extractions/:operationId` | — | none | 200 `VerificationStructuredExtractionResourceSchema` | `VERIFICATION_STRUCTURED_EXTRACTION_READ_PUBLIC_KEYS_JSON` |
| GET | `/v1/verification/audit-inspections/:operationId` | — | none | 200 `VerificationAuditInspectionResourceSchema` | `VERIFICATION_AUDIT_INSPECTION_READS_ENABLED=1` |
| GET | `/v1/verification/adjudication-decisions/:operationId` | `isAdjudicationDecisionReadAdmitted` else 404 | none | 200 `VerificationAdjudicationDecisionTerminalResourceSchema` | `VERIFICATION_ADJUDICATION_DECISIONS_ENABLED=1` + ownership |
| GET | `/v1/verification/adjudications/:operationId` | — | none | 200 `VerificationAdjudicationTerminalResourceSchema` | adjudication trio JSON + ownership |
| GET | `/v1/verification/captures/:operationId` | — | none | 200 `VerificationCaptureTerminalResourceSchema` | `VERIFICATION_CAPTURE_READS_ENABLED=1` |
| GET | `/v1/verification/claims/:operationId` | — | none | 200 `VerificationClaimsTerminalResourceSchema` | `VERIFICATION_CLAIMS_REPORT_READ_PUBLIC_KEYS_JSON` |
| GET | `/v1/verification/reports/:operationId` | — | none | 200 `VerificationReportTerminalResourceSchema` | same |
| GET | `/v1/verification/benchmarks/comparisons/:comparisonId` | — | none | 200 `VerificationBenchmarkComparisonResourceSchema` | `VERIFICATION_BENCHMARK_COMPARISON_READ_PUBLIC_KEYS_JSON` |
| GET | `/v1/verification/benchmarks/:runId` | — | none | 200 `VerificationBenchmarkRunSummaryResourceSchema` | `VERIFICATION_BENCHMARK_READ_PUBLIC_KEYS_JSON` |
| GET | `/v1/verification/benchmarks/:runId/manifest` | — | none | 200 `VerificationBenchmarkRunManifestResourceSchema` | same |
| GET | `/v1/verification/runs/:runId` | — | none | 200 `VerificationRunSummaryResourceSchema` | `VERIFICATION_READS_ENABLED=1` |
| GET | `/v1/verification/runs/:runId/manifest` | — | none | 200 `VerificationRunManifestResourceSchema` | same |
| GET | `/v1/verification/runs/:id/cases` | — | query `pageSize`, `cursor` | 200 `VerificationRunCasesResourceSchema` | same |
| GET | `/v1/verification/cases/:id` | — | none | 200 `VerificationCaseResourceSchema` | same |
| GET | `/v1/verification/evidence/:id` | — | none | 200 `VerificationEvidenceResourceSchema` | same |
| GET | `/v1/verification/operations/:id` | — | none | 200 operation record or 404 | `POSTGRES_URL` + ownership/attempt (verification op service, else generic fallback) |

### Mutations (`operation.submit` unless noted)

| Method | Path | Extra auth | Request schema | Response | Enabling env |
| --- | --- | --- | --- | --- | --- |
| POST | `/v1/verification/claims/:operationId/provider-attempts/:providerAttemptId/reconciliation` | `operation.submit` | `ApplyProviderReconciliationRequestSchema` | 200 resource | semantic recon grants |
| POST | `/v1/verification/reports/:operationId/provider-attempts/:providerAttemptId/reconciliation` | `operation.submit` | same | 200 resource | same |
| POST | `/v1/verification/extractions/:operationId/provider-attempts/:providerAttemptId/reconciliation` | `operation.submit` | same | 200 resource | extraction recon grants |
| POST | `/v1/verification/benchmark-capture-profiles/:profileName/captures` | Bearer + server-owned profile; `operation.submit` on resolved tenant; acquire grant | `CaptureSourceRequestSchema` (`source.mode==="acquire"`) | 202 `VerificationProfileCaptureAcceptedSchema` | `VERIFICATION_BENCHMARK_CAPTURE_PROFILES_JSON` + ownership + catalog |
| POST | `/v1/verification/captures` | acquire grant if `mode==="acquire"` | `CaptureSourceRequestSchema` | 202 receipt | ownership/attempt; acquire needs `VERIFICATION_CAPTURE_ACQUIRE_ENABLED=1` + catalog |
| POST | `/v1/verification/artifacts:parse` | `isParseArtifactRequestAdmitted` | `ParseArtifactRequestSchema` | 202 receipt | `VERIFICATION_PARSE_ARTIFACT_ENABLED=1` + catalog |
| POST | `/v1/verification/extractions` | `isStructuredExtractionRequestAdmitted` | `ExtractStructuredDataRequestSchema` | 202 receipt | `VERIFICATION_STRUCTURED_EXTRACTION_CONFIG_JSON` |
| POST | `/v1/verification/benchmarks:run` | `isBenchmarkRequestAdmitted` | `RunBenchmarkRequestSchema` | 202 receipt | `VERIFICATION_BENCHMARK_CONFIG_JSON` |
| POST | `/v1/verification/benchmarks:compare` | `isBenchmarkComparisonRequestAdmitted` | `CompareBenchmarkRunsRequestSchema` | 202 receipt | `VERIFICATION_BENCHMARK_COMPARISON_CONFIG_JSON` |
| POST | `/v1/verification/metrics:verify` | — | `VerifyMetricObservationRequestSchema` | 202 receipt | `VERIFICATION_METRIC_ENABLED=1` |
| POST | `/v1/verification/claims:verify` | `isClaimsRequestAdmitted` | `VerifyClaimsRequestSchema` | 202 receipt | `VERIFICATION_CLAIMS_ENABLED=1` + projection/seal grants |
| POST | `/v1/verification/reports:verify` | `isClaimsRequestAdmitted` | `VerifyReportRequestSchema` | 202 receipt | same |
| POST | `/v1/verification/adjudications:record-decision` | actor `human`, or `service` with `human_reviewer`; never `model`; `isAdjudicationDecisionAdmitted` | `VerificationAdjudicationDecisionRequestSchema` | 202 receipt | `VERIFICATION_ADJUDICATION_DECISIONS_ENABLED=1` |
| POST | `/v1/verification/adjudications:request` | `isAdjudicationRequestAdmitted` | `RequestAdjudicationRequestSchema` | 202 receipt | adjudication grants + requirements + keys |
| POST | `/v1/verification/audit-bundles:inspect` | `isAuditInspectionRequestAdmitted` | `InspectAuditBundleRequestSchema` | 202 receipt | `VERIFICATION_AUDIT_INSPECTION_ENABLED=1` + grants |
| POST | `/v1/verification/extractions:verify` | — | `VerifyExtractionRequestSchema` | 202 receipt | ownership/attempt + catalog (worker) |
| POST | `/v1/verification/runs/:runId:replay` | path `runId` must match body | `ReplayRunRequestSchema` | 202 receipt | ownership/attempt |

**Route count:** 36 paths containing `/v1/verification` (19 GET + 17 POST).

**Adjacent (not `/v1/verification` substring):** `/v1/internal/verification/drift-revalidations/{scan,claim,ack}` and `/v1/internal/verification/drift-alerts` require scope `verification.drift.consume` plus allowlisted `serviceIdentity`. Enabled by `VERIFICATION_DRIFT_REVALIDATION_ENABLED=1`.

Generic process health: `GET /health` → `{ "status": "ok" }` (not a verification-capability probe).

## CLI

Bin: `knowledge` (`@aiengineer/knowledge-cli`).

### Generic invocation

| Item | Contract |
| --- | --- |
| Flags | `--base-url`, `--context` (JSON `OperationContextSchema`), `--input` (JSON, default `{}`), `--timeout-ms` (100–300000, default 60000), `--wait` (`verification_mutation` only), `--human` (pretty JSON) |
| Env | `KNOWLEDGE_API_URL` (or `--base-url`), `KNOWLEDGE_API_TOKEN` (required) |
| stdout | JSON of accepted receipt, or `--wait` completion object |
| stderr | `{code,message}` — generic `{code:"CLI_ERROR",message}`; unknown command `{code:"UNKNOWN_COMMAND",group,action}`; specials use `DEMO_ERROR`, `BENCHMARK_CAPTURE_ERROR`, `BENCHMARK_DIFF_ERROR`, attestation codes |
| Exit | implicit 0 on success without `--wait`; `--wait` uses `completed.exitCode`; catch → **2** |

`--wait` polls `getVerificationOperation` and also reads `GET /v1/receipts/:id` for every receipt id. That requires `knowledge.read` on the same bearer plus the API receipts reader configured (503 without a resource reader). Completion exit codes:

| Exit | When |
| --- | --- |
| **0** | `verification_capture` (always); `result.valid === true` for extraction / replay / metric; `verification_benchmark` success; `verification_benchmark_compare` when `engineeringGateOutcome !== "fail"`; claims/report `disposition==="admitted"` |
| **1** | `result.valid === false`; operation state `needs_review`; comparison `engineeringGateOutcome === "fail"`; claims/report `held_for_review` or `quality_failed` |
| **2** | timeout; state `failed` / `cancelled` / `quarantined`; missing success receipt; unhandled kind (`VERIFICATION_WAIT_UNSUPPORTED_KIND`); any thrown error |

`--wait` **does not handle** these kinds (throws `VERIFICATION_WAIT_UNSUPPORTED_KIND:<kind>` → exit 2 even when the operation succeeded): `verification_parse_artifact`, `verification_adjudication`, `verification_adjudication_decision`, `verification_audit_bundle`, `verification_structured_extraction`.

For those kinds: submit without `--wait`, poll `GET /v1/verification/operations/{id}` or `knowledge verify status`, then the family-specific read. Prefer `verify status` (`getVerificationOperation`) over `operation status`. Claims/report `--wait` completion `{operationId,state,claims|report:{runId,manifestDigest,policyOutcome,mechanicalStatus,disposition},receiptId,exitCode}` is not the authoritative result; read `verify claims-result` / `verify report-result`. `held_for_review` / `needs_review` / `review_required`: escalate to adjudication; do not retry or override.

### Catalog

| Group | Action | Mode | Use case / resource | Required input keys |
| --- | --- | --- | --- | --- |
| reconciliation | apply | provider_reconciliation | apply | `operationId`, `providerAttemptId`, `artifact` |
| reconciliation | show | provider_reconciliation | show | `operationId`, `providerAttemptId` |
| extraction | run | verification_mutation | extractStructuredData | full `ExtractStructuredDataRequestSchema` |
| extraction | show | read | structured_extraction | `operationId` only |
| benchmark | comparison | read | benchmark_comparison | `comparisonId` only |
| benchmark | compare | verification_mutation | compareBenchmarkRuns | full compare schema |
| benchmark | show | read | benchmark_run | `runId` |
| benchmark | manifest | read | benchmark_manifest | `runId` |
| benchmark | run | verification_mutation | runBenchmark | full run schema |
| benchmark | capture | verification_mutation | captureSource | full capture schema (overridden if argv[2] is `diagnostics-companies`) |
| artifact | parse | verification_mutation | parseArtifact | full parse schema |
| verify | status | read | verification_operation | `operationId` only |
| verify | claims-result | read | claims_result | `operationId` only |
| verify | report-result | read | report_result | `operationId` only |
| verify | cases | read | verification_cases | `runId`; optional `pageSize`, `cursor` |
| verify | case | read | verification_case | `caseRunId` |
| verify | evidence | read | verification_evidence | `evidenceId` |
| verify | run | read | verification_run | `runId` |
| verify | manifest | read | verification_manifest | `runId` |
| verify | extract | verification_mutation | verifyExtraction | full schema |
| verify | citations | verification_mutation | verifyClaims | full schema |
| verify | report | verification_mutation | verifyReport | full schema |
| verify | metric | verification_mutation | verifyMetricObservation | full schema |
| bundle | inspect | verification_mutation | inspectAuditBundle | full schema |
| bundle | show | read | audit_inspection | `operationId` only |
| bundle | replay | verification_mutation | replayRun | full schema |
| adjudication | request | verification_mutation | requestAdjudication | full schema |
| adjudication | decision | verification_mutation | recordAdjudicationDecision | full schema |
| adjudication | get | read | adjudication | `operationId` only |
| adjudication | get-decision | read | adjudication_decision | `operationId` only |

**Catalog verification rows:** 30.

Prefer `verify status` for polling verification operations (`getVerificationOperation` → `GET /v1/verification/operations/:id`). Generic control (not verification-specific, used for recovery): `operation status` (`GET /v1/operations/:id`), `operation events`, `operation retry`, `operation reconcile`. Retry/reconcile require `--input '{"operationId":"<uuid>"}'` and a full `--context`.

### Special-cased local commands

| Group | Action | Mode | Flags | Exit |
| --- | --- | --- | --- | --- |
| demo | diagnostics-companies | local | `--dataset` (must `diagnostics-companies-v1`), `--output` (required), `--open` | `qualityGate.exitCode`: pass 0, fail 1, unavailable / `verification_incomplete` 2; catch 2 |
| benchmark | capture diagnostics-companies | local + HTTP optional | `--propose-version` (must `diagnostics-companies-v2`), `--output`, `--profile`, `--base-url`, `--timeout-ms` | 0 `proposed_review_required`; 2 `refresh_incomplete` |
| benchmark | diff | local | positional previous/proposed; `--catalog-root`, `--proposal-root` | success 0; catch 2 |
| verification | attestation-export | local | `--audit-bundle`, `--trusted-public-keys`, `--trusted-binding`, `--output` | 0; catch 2. Signing key: `KNOWLEDGE_VERIFICATION_ATTESTATION_SIGNING_KEY_PEM` |
| verification | attestation-inspect | local | `--audit-bundle`, `--trusted-public-keys`, `--trusted-binding`, `--attestation` | 0 verified / 1 not; catch 2 |

**CLI command rows:** 35 (30 catalog + 5 special). `benchmark capture` is one catalog action plus one special argv form.

## MCP

Transport: Streamable HTTP, `POST`/`GET`/… `/mcp`. Auth: Bearer resolved by `createLocalIdentityResolver(KNOWLEDGE_API_IDENTITIES)`. Default listen `PORT` fallback **4101**. Needs `POSTGRES_URL`, `KNOWLEDGE_API_URL`. Verification tools proxy `KnowledgeClient` (same bearer) to the HTTP API.

`GET /health` → `{ "status": "ok" }`.

Forbidden capabilities: `raw_sql`, `secret.read`, `storage.list`, `publication.approve`, `publication.publish`, `capability.admit`.

Shared mutation context fields: `tenantId`, `correlationId`, `idempotencyKey`, optional hints (`attemptId`, `workItemId`, `missionId`, `causationId`, `externalExecution`). Auth scope: `operation.submit` (mutations) or `knowledge.read` (reads).

### Mutations (`VERIFICATION_MCP_TOOL_NAMES`)

| Tool | Input | Client call |
| --- | --- | --- |
| `knowledge_extract_structured_data` | context + `ExtractStructuredDataRequestSchema` | `extractStructuredData` |
| `knowledge_capture_source` | context + `CaptureSourceRequestSchema` | `captureVerificationSource` |
| `knowledge_parse_artifact` | context + `ParseArtifactRequestSchema` | `parseArtifact` |
| `knowledge_verify_extraction` | context + `VerifyExtractionRequestSchema` | `verifyExtraction` |
| `knowledge_verify_claims` | context + `VerifyClaimsRequestSchema` | `verifyClaims` |
| `knowledge_verify_report` | context + `VerifyReportRequestSchema` | `verifyReport` |
| `knowledge_verify_metric` | context + `VerifyMetricObservationRequestSchema` | `verifyMetricObservation` |
| `knowledge_request_adjudication` | context + `RequestAdjudicationRequestSchema` | `requestAdjudication` |
| `knowledge_record_adjudication_decision` | context + `VerificationAdjudicationDecisionRequestSchema` | `recordAdjudicationDecision` |
| `knowledge_inspect_audit_bundle` | context + `InspectAuditBundleRequestSchema` | `inspectAuditBundle` |
| `knowledge_replay_run` | context + `ReplayRunRequestSchema` | `replayVerificationRun` |
| `knowledge_run_benchmark` | context + `RunBenchmarkRequestSchema` | `runBenchmark` |
| `knowledge_compare_benchmark_runs` | context + `CompareBenchmarkRunsRequestSchema` | `compareBenchmarkRuns` |

### Reads / reconciliation

| Tool | Fields | Client call | Mut/read |
| --- | --- | --- | --- |
| `knowledge_get_benchmark_run` | context `{tenantId,correlationId}`, `runId` | `getBenchmarkRun` | read |
| `knowledge_get_benchmark_manifest` | same | `getBenchmarkRunManifest` | read |
| `knowledge_apply_provider_reconciliation` | context, `operationId`, `providerAttemptId`, `artifact` | `applyProviderReconciliation` | mut |
| `knowledge_get_provider_reconciliation` | context, `operationId`, `providerAttemptId` | `getProviderReconciliation` | read |
| `knowledge_get_structured_extraction` | context, `operationId` | `getStructuredExtraction` | read |
| `knowledge_get_audit_inspection` | context, `operationId` | `getAuditInspection` | read |
| `knowledge_get_verification_claims_result` | context, `operationId` | `getVerificationClaimsResult` | read |
| `knowledge_get_verification_report_result` | context, `operationId` | `getVerificationReportResult` | read |
| `knowledge_get_adjudication` | context, `operationId` | `getAdjudicationSubject` | read |
| `knowledge_get_adjudication_decision` | context, `operationId` | `getAdjudicationDecision` | read |
| `knowledge_get_benchmark_comparison` | context, `comparisonId` | `getBenchmarkComparison` | read |
| `knowledge_list_verification_cases` | context, `runId`, optional `pageSize`, `cursor` | `listVerificationRunCases` | read |
| `knowledge_get_verification_case` | context, `caseRunId` | `getVerificationCase` | read |
| `knowledge_get_verification_evidence` | context, `evidenceId` | `getVerificationEvidence` | read |
| `knowledge_get_verification_run` | context, `runId` | `getVerificationRun` | read |
| `knowledge_get_verification_manifest` | context, `runId` | `getVerificationRunManifest` | read |
| `knowledge_get_verification_operation` | context `{tenantId,correlationId}`, `operationId` | `getVerificationOperation` | read |

**MCP verification tools:** 30 (13 named catalog + 17 extra). Spec `knowledge_get_operation` maps to `knowledge_get_verification_operation`.

## Worker activities

Handlers are admitted only when their env is present; empty JSON/flag leaves the kind unregistered. `apps/worker/src/worker.ts` is the generic durable loop (no verification kinds).

| Operation kind | Step | Activity / runtime | Enable / config env | Disabled when |
| --- | --- | --- | --- | --- |
| `verification_capture` | `register_and_admit` | `verification-activities.ts` | `VERIFICATION_SERVICE_CATALOG_JSON`; acquire: `VERIFICATION_CAPTURE_ACQUIRE_ENABLED=1` + `VERIFICATION_SOURCE_ACQUISITION_GRANTS_JSON` | catalog empty |
| `verification_extraction` | `verify_and_register` | same | catalog | catalog empty |
| `verification_replay` | `hydrate_and_recompute` | `verification-activities.ts`; replaced by `verification-sealed-replay-activity.ts` if metrics configured | catalog; sealed replay if metric grants | catalog empty |
| `verification_parse_artifact` | `parse_and_admit` | `verification-parse-activity.ts` | `VERIFICATION_PARSE_ARTIFACT_ENABLED=1` + catalog | flag ≠ `1` |
| `verification_metric` | `verify_metric_and_register` | `verification-metric-activity.ts` | `VERIFICATION_METRIC_PROFILE_GRANTS_JSON`; seal: `VERIFICATION_SEAL_POLICY_GRANTS_JSON` + runtime identity | grants empty |
| `verification_claims` | claims step | `verification-claims-activity.ts` | `VERIFICATION_CLAIMS_PROJECTION_GRANTS_JSON` + seal grants; optional `VERIFICATION_SEMANTIC_RUNTIME_JSON` + `VERIFICATION_SEMANTIC_PROFILE_GRANTS_JSON` | projection JSON empty |
| `verification_report` | same handler | same | same | same |
| `verification_audit_bundle` | audit inspect | `verification-audit-inspection-activity.ts` + runtime | `VERIFICATION_AUDIT_INSPECTION_ENABLED=1` + grants + public keys + claims grants; `VERIFICATION_AUDIT_INSPECTION_TIMEOUT_MS` | flag ≠ `1` |
| `verification_adjudication` | request | `verification-adjudication-activity.ts` + runtime | all three adjudication JSONs; timeout | any of trio missing |
| `verification_adjudication_decision` | `record_packet_bound_decision` | `verification-adjudication-decision-activity.ts` | `VERIFICATION_ADJUDICATION_DECISIONS_ENABLED=1` (+ optional synthetic grants JSON) | flag unset/`0` |
| `verification_benchmark` | `replay_recorded_and_register` | `verification-benchmark-activity.ts` + runtime | `VERIFICATION_BENCHMARK_CONFIG_JSON` + signing key id/PEM | config empty |
| `verification_benchmark_compare` | `compare_registered_and_publish` | `verification-benchmark-comparison-activity.ts` + runtime | comparison config + signing key id/PEM | config empty |
| `verification_structured_extraction` | `extract_and_register` | `verification-structured-extraction-runtime.ts` | extraction config + signing key id/PEM; `AI_GATEWAY_API_KEY` or `INTERFAZE_API_KEY` | config empty |

Shared worker identity when any verification block is on: `VERIFICATION_PARSER_IMAGE_DIGEST` (required), `VERIFICATION_PARSER_COMMAND` (default `docker`), `VERIFICATION_STORAGE_BUCKET` (default `ai-engineer-cloud-bucket`). Seal identity: `VERIFICATION_CODE_GIT_SHA`, `VERIFICATION_CODE_DIRTY` (`0`/`1`), `VERIFICATION_RUNTIME_PLATFORM`, `VERIFICATION_RUNTIME_DEPLOYMENT_ID`. Optional `VERIFICATION_AUDIT_SIGNING_KEY_ID` + `VERIFICATION_AUDIT_SIGNING_PRIVATE_KEY_PEM`. Worker authorizes by `WORKER_TENANT_ID`.
