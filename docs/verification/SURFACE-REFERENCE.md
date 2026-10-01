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

Bin: `ks` (`@aiengineer/knowledge-cli`, Unit 5C), one binary with the `knowledge`, `verify` and `db` groups (`jev` is reserved for 5F). Names are defined in `apps/cli/src/ks-commands.ts`; each command runs under one profile — remote (KnowledgeClient), local (host's file-store profile, loaded lazily) or offline utility — chosen by the command, never by a failure.

### Generic invocation

| Item | Contract |
| --- | --- |
| Flags | `--base-url`, `--context` (JSON `OperationContextSchema`), `--input` (JSON, default `{}`), `--timeout-ms` (100–300000, default 60000), `--wait` (`verification_mutation` only), `--human` (pretty JSON) |
| Env | `KNOWLEDGE_API_URL` (or `--base-url`), `KNOWLEDGE_API_TOKEN` (required) |
| stdout | JSON of accepted receipt, or `--wait` completion object |
| stderr | JSON — `{code:"CLI_ERROR",command,message}`; usage `{code:"USAGE",command,message,help}`; unknown command `{code:"UNKNOWN_COMMAND",command,help}`; specials use `DEMO_ERROR`, `BENCHMARK_CAPTURE_ERROR`, `BENCHMARK_DIFF_ERROR`, attestation codes |
| Exit | 0 on success without `--wait`; `--wait` uses `completed.exitCode`; a failed local quality gate → **1**; usage, auth, network or executor error → **2**, never a fallback |

`--wait` polls `getVerificationOperation` and also reads `GET /v1/receipts/:id` for every receipt id. That requires `knowledge.read` on the same bearer plus the API receipts reader configured (503 without a resource reader). Completion exit codes:

| Exit | When |
| --- | --- |
| **0** | `verification_capture` (always); `result.valid === true` for extraction / replay / metric; `verification_benchmark` success; `verification_benchmark_compare` when `engineeringGateOutcome !== "fail"`; claims/report `disposition==="admitted"` |
| **1** | `result.valid === false`; operation state `needs_review`; comparison `engineeringGateOutcome === "fail"`; claims/report `held_for_review` or `quality_failed` |
| **2** | timeout; state `failed` / `cancelled` / `quarantined`; missing success receipt; unhandled kind (`VERIFICATION_WAIT_UNSUPPORTED_KIND`); any thrown error |

`--wait` **does not handle** these kinds (throws `VERIFICATION_WAIT_UNSUPPORTED_KIND:<kind>` → exit 2 even when the operation succeeded): `verification_parse_artifact`, `verification_adjudication`, `verification_adjudication_decision`, `verification_audit_bundle`, `verification_structured_extraction`.

For those kinds: submit without `--wait`, poll `GET /v1/verification/operations/{id}` or `ks verify status`, then the family-specific read. Prefer `verify status` (`getVerificationOperation`) over `operation status`. Claims/report `--wait` completion `{operationId,state,claims|report:{runId,manifestDigest,policyOutcome,mechanicalStatus,disposition},receiptId,exitCode}` is not the authoritative result; read `verify claims-result` / `verify report-result`. `held_for_review` / `needs_review` / `review_required`: escalate to adjudication; do not retry or override.

### Catalog

| ks command | Mode | Use case / resource | Required input keys |
| --- | --- | --- | --- |
| `verify reconciliation apply` | provider_reconciliation | apply | `operationId`, `providerAttemptId`, `artifact` |
| `verify reconciliation show` | provider_reconciliation | show | `operationId`, `providerAttemptId` |
| `verify extraction run` | verification_mutation | extractStructuredData | full `ExtractStructuredDataRequestSchema` |
| `verify extraction show` | read | structured_extraction | `operationId` only |
| `verify benchmark comparison` | read | benchmark_comparison | `comparisonId` only |
| `verify benchmark compare` | verification_mutation | compareBenchmarkRuns | full compare schema |
| `verify benchmark show` | read | benchmark_run | `runId` |
| `verify benchmark manifest` | read | benchmark_manifest | `runId` |
| `verify benchmark run` | verification_mutation | runBenchmark | full run schema |
| `verify benchmark capture` | verification_mutation | captureSource | full capture schema (`verify benchmark capture diagnostics-companies` is a separate local command) |
| `verify artifact parse` | verification_mutation | parseArtifact | full parse schema |
| `verify status` | read | verification_operation | `operationId` only |
| `verify claims-result` | read | claims_result | `operationId` only |
| `verify report-result` | read | report_result | `operationId` only |
| `verify cases` | read | verification_cases | `runId`; optional `pageSize`, `cursor` |
| `verify case` | read | verification_case | `caseRunId` |
| `verify evidence` | read | verification_evidence | `evidenceId` |
| `verify run` | read | verification_run | `runId` |
| `verify manifest` | read | verification_manifest | `runId` |
| `verify extract` | verification_mutation | verifyExtraction | full schema |
| `verify citations` | verification_mutation | verifyClaims | full schema |
| `verify report` | verification_mutation | verifyReport | full schema |
| `verify metric` | verification_mutation | verifyMetricObservation | full schema |
| `verify bundle inspect` | verification_mutation | inspectAuditBundle | full schema |
| `verify bundle show` | read | audit_inspection | `operationId` only |
| `verify bundle replay` | verification_mutation | replayRun | full schema |
| `verify adjudication request` | verification_mutation | requestAdjudication | full schema |
| `verify adjudication decision` | verification_mutation | recordAdjudicationDecision | full schema |
| `verify adjudication get` | read | adjudication | `operationId` only |
| `verify adjudication get-decision` | read | adjudication_decision | `operationId` only |

**Catalog verification rows:** 30.

Prefer `verify status` for polling verification operations (`getVerificationOperation` → `GET /v1/verification/operations/:id`). Generic control (not verification-specific, used for recovery): `ks knowledge operation status` (`GET /v1/operations/:id`), `… operation events`, `… operation retry`, `… operation reconcile`. Retry/reconcile require `--input '{"operationId":"<uuid>"}'` and a full `--context`.

### Special-cased local commands

| ks command | Mode | Flags | Exit |
| --- | --- | --- | --- |
| `verify demo diagnostics-companies` | local | `--dataset` (must `diagnostics-companies-v1`), `--output` (required), `--open` | `qualityGate.exitCode`: pass 0, fail 1, unavailable / `verification_incomplete` 2; catch 2 |
| `verify benchmark capture diagnostics-companies` | local + HTTP optional | `--propose-version` (must `diagnostics-companies-v2`), `--output`, `--profile`, `--base-url`, `--timeout-ms` | 0 `proposed_review_required`; 2 `refresh_incomplete` |
| `verify benchmark diff` | local | positional previous/proposed; `--catalog-root`, `--proposal-root` | success 0; catch 2 |
| `verify attestation export` | local | `--audit-bundle`, `--trusted-public-keys`, `--trusted-binding`, `--output` | 0; catch 2. Signing key: `KNOWLEDGE_VERIFICATION_ATTESTATION_SIGNING_KEY_PEM` |
| `verify attestation inspect` | local | `--audit-bundle`, `--trusted-public-keys`, `--trusted-binding`, `--attestation` | 0 verified / 1 not; catch 2 |

**CLI command rows:** 35 (30 catalog + 5 special) in this reference; `ks` binds 74 remote, 16 local-profile and 5 offline commands in all.

### Local profile (Unit 5C)

The verification intent pipeline runs on host's local profile over a file store until 5D3 serves it remotely. `--help` and remote commands never load it. Store: `--store <dir>` or `KNOWLEDGE_LOCAL_STORE_DIR` (default `.knowledge-store`). Identity: `--tenant-id`, `--producer-deployment-id`, `--verifier-deployment-id`, `--producer-attempt-id`, `--verifier-attempt-id`, `--principal-salt`, `--git-sha`, or the matching `KNOWLEDGE_LOCAL_*` variable. Providers only when named by `--providers capture,semantic` or `KNOWLEDGE_LOCAL_PROVIDERS`, with keys only from `KNOWLEDGE_LOCAL_FIRECRAWL_API_KEY` and `KNOWLEDGE_LOCAL_AI_GATEWAY_API_KEY` (models: `KNOWLEDGE_LOCAL_JUDGE_MODEL`, `KNOWLEDGE_LOCAL_CROSS_FAMILY_JUDGE_MODEL`). No `VERIFY_*` name is read. Without a named provider, `verify capture source`, document conversion and `verify chain judge` exit 2 with `CAPABILITY_NOT_ADMITTED` before anything is constructed.

| ks command | Operation | Exit 1 when |
| --- | --- | --- |
| `verify artifact register` | `verify_register_artifact` | — |
| `verify artifact get` | `verify_get_artifact` | — |
| `verify capture source` | `verify_capture_source` | — |
| `verify capture file` | `verify_capture_file` | — |
| `verify capture list` | `verify_list_captures` | — |
| `verify capture read` | `verify_read_capture` | — |
| `verify capture search` | `verify_search_capture` | — |
| `verify capture locate` | `verify_locate_quote` | status ≠ resolved |
| `verify capture media-types` | `verify_supported_media_types` | — |
| `verify chain claims` | `verify_claims` | mechanical status ≠ passed |
| `verify chain extraction` | `verify_extraction` | valid ≠ true |
| `verify chain judge` | `verify_judge_semantics` | any verdict not admitted |
| `verify chain policy` | `verify_evaluate_policy` | outcome ∉ pass, pass_with_warnings |
| `verify chain seal` | `verify_seal_run` | inspection invalid |
| `verify chain check-report` | `verify_check_report` | ok ≠ true |
| `verify chain status` | `verify_run_status` | — |

## MCP

Transport: Streamable HTTP, `POST`/`GET`/… `/mcp`. Auth: Bearer resolved by `createLocalIdentityResolver(KNOWLEDGE_API_IDENTITIES)`. Default listen `PORT` fallback **4101**. Needs `POSTGRES_URL`, `KNOWLEDGE_API_URL`. Verification tools proxy `KnowledgeClient` (same bearer) to the HTTP API.

`GET /health` → `{ "status": "ok" }`.

Forbidden capabilities: `raw_sql`, `secret.read`, `storage.list`, `publication.approve`, `publication.publish`, `capability.admit`.

Shared mutation context fields: `tenantId`, `correlationId`, `idempotencyKey`, optional hints (`attemptId`, `workItemId`, `missionId`, `causationId`, `externalExecution`). Auth scope: `operation.submit` (mutations) or `knowledge.read` (reads).

### Mutations (`VERIFICATION_MCP_TOOL_NAMES`)

| Tool | Input | Client call |
| --- | --- | --- |
| `verify_extraction_run` | context + `ExtractStructuredDataRequestSchema` | `extractStructuredData` |
| `verify_benchmark_capture` | context + `CaptureSourceRequestSchema` | `captureVerificationSource` |
| `verify_artifact_parse` | context + `ParseArtifactRequestSchema` | `parseArtifact` |
| `verify_extract` | context + `VerifyExtractionRequestSchema` | `verifyExtraction` |
| `verify_citations` | context + `VerifyClaimsRequestSchema` | `verifyClaims` |
| `verify_report` | context + `VerifyReportRequestSchema` | `verifyReport` |
| `verify_metric` | context + `VerifyMetricObservationRequestSchema` | `verifyMetricObservation` |
| `verify_adjudication_request` | context + `RequestAdjudicationRequestSchema` | `requestAdjudication` |
| `verify_adjudication_decision` | context + `VerificationAdjudicationDecisionRequestSchema` | `recordAdjudicationDecision` |
| `verify_bundle_inspect` | context + `InspectAuditBundleRequestSchema` | `inspectAuditBundle` |
| `verify_bundle_replay` | context + `ReplayRunRequestSchema` | `replayVerificationRun` |
| `verify_benchmark_run` | context + `RunBenchmarkRequestSchema` | `runBenchmark` |
| `verify_benchmark_compare` | context + `CompareBenchmarkRunsRequestSchema` | `compareBenchmarkRuns` |

### Reads / reconciliation

| Tool | Fields | Client call | Mut/read |
| --- | --- | --- | --- |
| `verify_benchmark_show` | context `{tenantId,correlationId}`, `runId` | `getBenchmarkRun` | read |
| `verify_benchmark_manifest` | same | `getBenchmarkRunManifest` | read |
| `verify_reconciliation_apply` | context, `operationId`, `providerAttemptId`, `artifact` | `applyProviderReconciliation` | mut |
| `verify_reconciliation_show` | context, `operationId`, `providerAttemptId` | `getProviderReconciliation` | read |
| `verify_extraction_show` | context, `operationId` | `getStructuredExtraction` | read |
| `verify_bundle_show` | context, `operationId` | `getAuditInspection` | read |
| `verify_claims_result` | context, `operationId` | `getVerificationClaimsResult` | read |
| `verify_report_result` | context, `operationId` | `getVerificationReportResult` | read |
| `verify_adjudication_get` | context, `operationId` | `getAdjudicationSubject` | read |
| `verify_adjudication_get_decision` | context, `operationId` | `getAdjudicationDecision` | read |
| `verify_benchmark_comparison` | context, `comparisonId` | `getBenchmarkComparison` | read |
| `verify_cases` | context, `runId`, optional `pageSize`, `cursor` | `listVerificationRunCases` | read |
| `verify_case` | context, `caseRunId` | `getVerificationCase` | read |
| `verify_evidence` | context, `evidenceId` | `getVerificationEvidence` | read |
| `verify_run` | context, `runId` | `getVerificationRun` | read |
| `verify_manifest` | context, `runId` | `getVerificationRunManifest` | read |
| `verify_status` | context `{tenantId,correlationId}`, `operationId` | `getVerificationOperation` | read |

**MCP verification tools:** 30 (13 named catalog + 17 extra). Spec `knowledge_get_operation` maps to `verify_status`.

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
