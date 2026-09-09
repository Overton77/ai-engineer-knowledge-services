# Knowledge Verification — AS-BUILT INVENTORY

Derived from source on 2026-09-08. Paths relative to `ai-engineer-knowledge-services/` unless noted. Routes are always registered in `buildServer`; env vars compose the `options.*` capabilities that return 503 `CAPABILITY_NOT_ADMITTED` when absent. Fastify paths use `::action` (public URL has a single `:`).

---

## 1. HTTP API routes (verification)

Auth: Bearer via `resolveIdentity` + `x-tenant-id`, except profile capture (Bearer only; tenant comes from server-owned profile). Mutations also require `Idempotency-Key` (8–255) via `verificationContext` (`apps/api/src/server.ts:656`). Additional grants are noted.

### 1.1 Reads (`knowledge.read`)

| method | path | extra auth | request schema | response | enabling env | source |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/v1/verification/claims/:operationId/provider-attempts/:providerAttemptId/reconciliation` | — | none (strict empty query) | 200 `VerificationProviderReconciliationResourceSchema` | `VERIFICATION_SEMANTIC_PROVIDER_RECONCILIATION_GRANTS_JSON` + keys + ownership | `apps/api/src/server.ts:1111` |
| GET | `/v1/verification/reports/:operationId/provider-attempts/:providerAttemptId/reconciliation` | — | none | 200 same | same | `apps/api/src/server.ts:1111` |
| GET | `/v1/verification/extractions/:operationId/provider-attempts/:providerAttemptId/reconciliation` | — | none | 200 same | `VERIFICATION_PROVIDER_RECONCILIATION_GRANTS_JSON` + keys + ownership | `apps/api/src/server.ts:1193` |
| GET | `/v1/verification/extractions/:operationId` | — | none | 200 `VerificationStructuredExtractionResourceSchema` | `VERIFICATION_STRUCTURED_EXTRACTION_READ_PUBLIC_KEYS_JSON` | `apps/api/src/server.ts:1271` |
| GET | `/v1/verification/audit-inspections/:operationId` | — | none | 200 `VerificationAuditInspectionResourceSchema` | `VERIFICATION_AUDIT_INSPECTION_READS_ENABLED=1` | `apps/api/src/server.ts:1325` |
| GET | `/v1/verification/adjudication-decisions/:operationId` | `isAdjudicationDecisionReadAdmitted` else 404 | none | 200 `VerificationAdjudicationDecisionTerminalResourceSchema` | `VERIFICATION_ADJUDICATION_DECISIONS_ENABLED=1` + ownership | `apps/api/src/server.ts:1401` |
| GET | `/v1/verification/adjudications/:operationId` | — | none | 200 `VerificationAdjudicationTerminalResourceSchema` | adjudication trio JSON + ownership | `apps/api/src/server.ts:1497` |
| GET | `/v1/verification/captures/:operationId` | — | none | 200 `VerificationCaptureTerminalResourceSchema` | `VERIFICATION_CAPTURE_READS_ENABLED=1` | `apps/api/src/server.ts:1571` |
| GET | `/v1/verification/claims/:operationId` | — | none | 200 `VerificationClaimsTerminalResourceSchema` | `VERIFICATION_CLAIMS_REPORT_READ_PUBLIC_KEYS_JSON` | `apps/api/src/server.ts:1645` |
| GET | `/v1/verification/reports/:operationId` | — | none | 200 `VerificationReportTerminalResourceSchema` | same | `apps/api/src/server.ts:1645` |
| GET | `/v1/verification/benchmarks/comparisons/:comparisonId` | — | none | 200 `VerificationBenchmarkComparisonResourceSchema` | `VERIFICATION_BENCHMARK_COMPARISON_READ_PUBLIC_KEYS_JSON` | `apps/api/src/server.ts:1732` |
| GET | `/v1/verification/benchmarks/:runId` | — | none | 200 `VerificationBenchmarkRunSummaryResourceSchema` | `VERIFICATION_BENCHMARK_READ_PUBLIC_KEYS_JSON` | `apps/api/src/server.ts:1787` |
| GET | `/v1/verification/benchmarks/:runId/manifest` | — | none | 200 `VerificationBenchmarkRunManifestResourceSchema` | same | `apps/api/src/server.ts:1787` |
| GET | `/v1/verification/runs/:runId` | — | none | 200 `VerificationRunSummaryResourceSchema` | `VERIFICATION_READS_ENABLED=1` | `apps/api/src/server.ts:1841` |
| GET | `/v1/verification/runs/:runId/manifest` | — | none | 200 `VerificationRunManifestResourceSchema` | same | `apps/api/src/server.ts:1841` |
| GET | `/v1/verification/runs/:id/cases` | — | query `pageSize`,`cursor` | 200 `VerificationRunCasesResourceSchema` | same | `apps/api/src/server.ts:1894` |
| GET | `/v1/verification/cases/:id` | — | none | 200 `VerificationCaseResourceSchema` | same | `apps/api/src/server.ts:1894` |
| GET | `/v1/verification/evidence/:id` | — | none | 200 `VerificationEvidenceResourceSchema` | same | `apps/api/src/server.ts:1894` |
| GET | `/v1/verification/operations/:id` | — | none | 200 operation record or 404 | `POSTGRES_URL` + ownership/attempt (verification op service) | `apps/api/src/server.ts:2607` |

### 1.2 Mutations (`operation.submit` unless noted)

| method | path | extra auth | request schema | response | enabling env | source |
| --- | --- | --- | --- | --- | --- | --- |
| POST | `/v1/verification/claims/:operationId/provider-attempts/:providerAttemptId/reconciliation` | `operation.submit` | `ApplyProviderReconciliationRequestSchema` | 200 resource | semantic recon grants | `apps/api/src/server.ts:1111` |
| POST | `/v1/verification/reports/:operationId/provider-attempts/:providerAttemptId/reconciliation` | `operation.submit` | same | 200 resource | same | `apps/api/src/server.ts:1111` |
| POST | `/v1/verification/extractions/:operationId/provider-attempts/:providerAttemptId/reconciliation` | `operation.submit` | same | 200 resource | extraction recon grants | `apps/api/src/server.ts:1193` |
| POST | `/v1/verification/benchmark-capture-profiles/:profileName/captures` | Bearer + server-owned profile; `operation.submit` on resolved tenant; acquire grant | `CaptureSourceRequestSchema` (`source.mode==="acquire"`) | 202 `VerificationProfileCaptureAcceptedSchema` | `VERIFICATION_BENCHMARK_CAPTURE_PROFILES_JSON` + ownership + catalog | `apps/api/src/server.ts:1982` |
| POST | `/v1/verification/captures` | acquire grant if `mode==="acquire"` | `CaptureSourceRequestSchema` | 202 receipt | ownership/attempt; acquire needs `VERIFICATION_CAPTURE_ACQUIRE_ENABLED=1` + catalog | `apps/api/src/server.ts:2126` |
| POST | `/v1/verification/artifacts:parse` | `isParseArtifactRequestAdmitted` | `ParseArtifactRequestSchema` | 202 receipt | `VERIFICATION_PARSE_ARTIFACT_ENABLED=1` + catalog | `apps/api/src/server.ts:2171` |
| POST | `/v1/verification/extractions` | `isStructuredExtractionRequestAdmitted` | `ExtractStructuredDataRequestSchema` | 202 receipt | `VERIFICATION_STRUCTURED_EXTRACTION_CONFIG_JSON` | `apps/api/src/server.ts:2205` |
| POST | `/v1/verification/benchmarks:run` | `isBenchmarkRequestAdmitted` | `RunBenchmarkRequestSchema` | 202 receipt | `VERIFICATION_BENCHMARK_CONFIG_JSON` | `apps/api/src/server.ts:2251` |
| POST | `/v1/verification/benchmarks:compare` | `isBenchmarkComparisonRequestAdmitted` | `CompareBenchmarkRunsRequestSchema` | 202 receipt | `VERIFICATION_BENCHMARK_COMPARISON_CONFIG_JSON` | `apps/api/src/server.ts:2283` |
| POST | `/v1/verification/metrics:verify` | — | body passed through (`VerifyMetricObservationRequestSchema` in app) | 202 receipt | `VERIFICATION_METRIC_ENABLED=1` | `apps/api/src/server.ts:2332` |
| POST | `/v1/verification/claims:verify` | `isClaimsRequestAdmitted` | `VerifyClaimsRequestSchema` | 202 receipt | `VERIFICATION_CLAIMS_ENABLED=1` + projection/seal grants | `apps/api/src/server.ts:2348` |
| POST | `/v1/verification/reports:verify` | `isClaimsRequestAdmitted` | `VerifyReportRequestSchema` | 202 receipt | same | `apps/api/src/server.ts:2380` |
| POST | `/v1/verification/adjudications:record-decision` | actor not `model`; service must be `human_reviewer`; `isAdjudicationDecisionAdmitted` | `VerificationAdjudicationDecisionRequestSchema` | 202 receipt | `VERIFICATION_ADJUDICATION_DECISIONS_ENABLED=1` | `apps/api/src/server.ts:2412` |
| POST | `/v1/verification/adjudications:request` | `isAdjudicationRequestAdmitted` | `RequestAdjudicationRequestSchema` | 202 receipt | adjudication grants+requirements+keys | `apps/api/src/server.ts:2467` |
| POST | `/v1/verification/audit-bundles:inspect` | `isAuditInspectionRequestAdmitted` | `InspectAuditBundleRequestSchema` | 202 receipt | `VERIFICATION_AUDIT_INSPECTION_ENABLED=1` + grants | `apps/api/src/server.ts:2516` |
| POST | `/v1/verification/extractions:verify` | — | `VerifyExtractionRequestSchema` | 202 receipt | ownership/attempt + catalog (worker) | `apps/api/src/server.ts:2565` |
| POST | `/v1/verification/runs/:runId:replay` | path `runId` must match body | `ReplayRunRequestSchema` | 202 receipt | ownership/attempt | `apps/api/src/server.ts:2584` |

**Route count:** 36 paths containing `/v1/verification` (19 GET + 17 POST).

**Adjacent (not `/v1/verification` substring):** `/v1/internal/verification/drift-revalidations/{scan,claim,ack}` and `/v1/internal/verification/drift-alerts` require scope `verification.drift.consume` plus allowlisted `serviceIdentity` (`apps/api/src/server.ts:924`, `1013`). Enabled by `VERIFICATION_DRIFT_REVALIDATION_ENABLED=1`.

All mutation submits also require `options.verificationOperationService` + `resolveVerificationContext` or 503.

---

## 2. Contract schemas

Package `@aiengineer/knowledge-contracts`. Barrel: `packages/contracts/src/index.ts:16` → `verification/index.ts`.

### 2.1 Request / response Zod schemas by use case

| use case | request / mutation schemas | terminal / result / resource schemas |
| --- | --- | --- |
| captureSource | `CaptureSourceRequestSchema` | `VerificationCaptureTerminalResourceSchema`, `VerificationAcquiredCaptureTerminalResourceSchema`, `VerificationRegisteredCaptureTerminalResourceSchema`, `VerificationProfileCaptureAcceptedSchema` (in `integration.ts`) |
| parseArtifact | `ParseArtifactRequestSchema` | `VerificationParseArtifactResultSchema` |
| extractStructuredData | `ExtractStructuredDataRequestSchema` | `VerificationStructuredExtractionResourceSchema`, `VerificationStructuredExtractionResultSchema`, `VerificationStructuredExtractionPublicationSchema`, `VerificationStructuredExtractionFailureSchema`, `VerificationStructuredExtractionFailureResultSchema`, `StructuredExtractionFailureCodeSchema`, `StructuredExtractionFailureLifecycleSnapshotSchema`, `StructuredExtractionPublicationLifecycleSnapshotSchema`, `StructuredExtractionProviderCallSnapshotSchema`, `VerificationStructuredExtractionSourceCustodySchema`, `VerificationStructuredExtractionRuntimeSchema`, `VerificationStructuredExtractionExecutionSchema`, `VerificationAcceptedExtractionLeafSchema`, `VerificationExtractionFieldEvidenceResultSchema` |
| verifyExtraction | `VerifyExtractionRequestSchema`, `VerifyExtractionInputSchema` | `VerificationExtractionFieldEvidenceResultSchema` |
| verifyClaims | `VerifyClaimsRequestSchema`, `VerifyClaimsInputSchema` | `VerificationClaimsTerminalResourceSchema`, `VerificationClaimsServiceResultSchema`, `VerificationClaimsOperationResultSchema`, `VerificationClaimsSealResultSchema`, `VerificationClaimsArtifactSchema` |
| verifyReport | `VerifyReportRequestSchema` | `VerificationReportTerminalResourceSchema`, `VerificationReportServiceResultSchema`, `VerificationReportOperationResultSchema`, `VerificationReportLedgerSchema`, `VerificationReportWideSummarySchema`, `VerificationReportGateArtifactSchema`, `ReportCitationInputSchema`, `ReportAssertionInputSchema` |
| verifyMetricObservation | `VerifyMetricObservationRequestSchema`, `VerifyMetricObservationInputSchema` | `VerificationMetricObservationSchema`, `MetricMechanicalResultSchema` |
| runBenchmark | `RunBenchmarkRequestSchema`, `RunVerificationBenchmarkInputSchema` | `VerificationBenchmarkRunSummaryResourceSchema`, `VerificationBenchmarkRunManifestResourceSchema`, `VerificationBenchmarkOperationResultSchema`, `VerificationBenchmarkPublicationManifestSchema`, plus dataset/case/arm schemas in `benchmark.ts` |
| compareBenchmarkRuns | `CompareBenchmarkRunsRequestSchema`, `CompareVerificationBenchmarkRunsInputSchema` | `VerificationBenchmarkComparisonResourceSchema`, `VerificationBenchmarkComparisonMetricResourceSchema`, `VerificationBenchmarkComparisonPublicationSchema`, `VerificationBenchmarkComparisonOperationResultSchema`, `VerificationBenchmarkComparisonProfileSchema` |
| replayRun | `ReplayRunRequestSchema` | run/manifest read schemas |
| inspectAuditBundle | `InspectAuditBundleRequestSchema` | `VerificationAuditInspectionResultSchema`, `VerificationAuditInspectionOperationResultSchema`, `VerificationAuditInspectionResourceSchema` |
| requestAdjudication | `RequestAdjudicationRequestSchema` | `VerificationAdjudicationTerminalResourceSchema`, `VerificationAdjudicationPacketSchema`, `VerificationAdjudicationOperationResultSchema`, `VerificationAdjudicationPendingSubjectSchema` |
| recordAdjudicationDecision | `VerificationAdjudicationDecisionRequestSchema` | `VerificationAdjudicationDecisionResultSchema`, `VerificationAdjudicationDecisionTerminalResourceSchema` |
| provider reconciliation | `ApplyProviderReconciliationRequestSchema` | `VerificationProviderReconciliationSchema`, `VerificationProviderReconciliationResourceSchema`, `VerificationSemanticProviderReconciliationSchema` |
| drift | none in contracts (inline Zod in `server.ts:975`) | unverified as named contract schemas |
| reads | `GetVerificationOperationRequestSchema`, `GetVerificationRunRequestSchema`, `GetVerificationRunManifestRequestSchema`, `ListVerificationRunCasesRequestSchema`, `GetVerificationCaseRequestSchema`, `GetVerificationEvidenceRequestSchema` | `VerificationRunSummaryResourceSchema`, `VerificationRunManifestResourceSchema`, `VerificationRunCasesResourceSchema`, `VerificationCaseResourceSchema`, `VerificationCaseSummaryResourceSchema`, `VerificationEvidenceResourceSchema`, `VerificationArtifactReferenceSchema` |

Shared envelopes: `VerificationMutationRequestSchema` (omits `recordAdjudicationDecision` and `parseArtifact` is included), `VerificationOperationContextHintsSchema`, `VerificationCommandSchema`, `VerificationOperationReceiptSchema`, `VerificationEventSchema`, `VerificationRunManifestSchema`, `VerificationResultEnvelopeSchema`, `VerifyBundleInputSchema`.

### 2.2 Operation-kind names

From `verificationServiceOperationKinds` / `verificationOwnedOperationKinds` (`packages/application/src/verification-service.ts:52`):

`verification_capture`, `verification_extraction`, `verification_replay`, `verification_parse_artifact`, `verification_metric`, `verification_benchmark`, `verification_benchmark_compare`, `verification_structured_extraction`, `verification_claims`, `verification_report`, `verification_adjudication`, `verification_adjudication_decision`, `verification_audit_bundle`.

`VerificationUseCaseSchema` (`operations.ts:27`): `captureSource`, `parseArtifact`, `extractStructuredData`, `verifyExtraction`, `verifyClaims`, `verifyReport`, `verifyMetricObservation`, `runBenchmark`, `compareBenchmarkRuns`, `replayRun`, `inspectAuditBundle`, `requestAdjudication`. **Does not include `recordAdjudicationDecision`.**

### 2.3 Verdict lattice / policy outcomes

`SemanticVerdictSchema` (`model.ts:256`): `pending_semantic_review`, `directly_supported`, `supported_with_qualification`, `partially_supported`, `context_only`, `contradicted`, `mixed_or_conflicting`, `not_supported`, `insufficient_evidence`, `unverifiable`, `source_unavailable`, `locator_error`, `parser_error`, `derived_verified`, `derived_failed`.

`PolicyOutcomeSchema` (`model.ts:274`): `pass`, `pass_with_warnings`, `review`, `fail`, `abstain`.

Mechanical status: `passed` | `failed` | `review_required`. Adjudication decision: `affirm` | `reject` | `defer`. Decision provenance: `human_origin` | `synthetic_engineering`.

---

## 3. Application use cases

Exports from `packages/application/src/index.ts` (verification-related). Durable server = HTTP/worker/Postgres. Offline/local = demo/diagnostics composition.

| group | path | exports | path kind |
| --- | --- | --- | --- |
| admission / core | `verification-admission.ts` | `VerificationAdmissionService` | durable |
| service / submit | `verification-service.ts` | `VerificationOperationApplicationService`, `VerificationOperationExecutor`, `VerificationServiceCatalog`, `verificationServiceOperationKinds`, `verificationOwnedOperationKinds`, `VERIFICATION_SERVICE_REQUEST_VERSION` | durable |
| replay | `verification-replay.ts` | `createOfflineVerificationPolicyReplayPort`, `replayVerificationAudit`, `replayVerificationMetricAudit` | mixed |
| provider | `verification-provider.ts` | `VerificationProviderArtifactComposer`, `AccountedVerificationProviderSink` | durable |
| provider transport | `verification-provider-transport.ts` | `prepareVerificationProviderTransportResponse`, transport schemas | durable |
| provider recon | `verification-provider-reconciliation.ts` | `ProviderReconciliationAdmission`, parent/signature helpers | durable |
| metrics | `verification-metrics.ts` | `VerificationMetricApplicationService`, `VerificationMetricProfileCatalog`, `VerificationMetricProfileSchema` | durable |
| claims | `verification-claims.ts` | `VerificationClaimsApplicationService`, `VerificationClaimsProjectionGrantCatalog` | durable |
| claims reads | `verification-claims-report-reads.ts` | `VerificationClaimsReportReadService` | durable |
| parse | `verification-parse.ts` | `ParseArtifactApplicationService` | durable |
| audit | `verification-audit-inspection.ts`, `-grants.ts`, `-reads.ts` | `VerificationAuditInspectionApplicationService`, `VerificationAuditInspectionGrantCatalog`, `VerificationAuditInspectionReadService` | durable |
| reads | `verification-reads.ts` | `VerificationRunReadService`, `VerificationCaseReadService` | durable |
| capture reads | `verification-capture-reads.ts` | `VerificationCaptureReadApplicationService` | durable |
| acquisition | `verification-source-acquisition.ts` | `TrustedVerificationSourceAcquirer`, `VerificationSourceAcquisitionCatalog` | durable |
| seal | `verification-seal-policy.ts` | `VerificationSealPolicyCatalog` | durable |
| semantic | `verification-semantic.ts`, `-observation.ts`, `-observation-recorder.ts`, `-recovery.ts`, `-replay.ts`, `-audit-replay.ts`, `-profile.ts`, `-provider-reconciliation.ts` | `verifySemanticEvidence`, composers/recorders, `parseSemanticJudgeProfileCatalog`, `SemanticJudgeProfileCatalog` | durable |
| adjudication | `verification-adjudication.ts`, `-reads.ts`, `-decision.ts` | request/read/decision services | durable |
| drift | `verification-drift-revalidation.ts`, `verification-component-drift.ts` | `VerificationDriftRevalidationPlanner`, `semanticObservationDrift`, `compareVerifiedComponentVersions` | durable (internal) |
| extraction | `verification-structured-extraction-*.ts` | runtime parse/admission, publication/failure/candidate builders, read service, replay | durable |
| benchmark durable | `verification-benchmark-runtime-config.ts`, `-reads.ts`, `-comparison*.ts`, `-publication.ts`, `-inputs.ts`, `-registered-profile.ts`, `-registered-replay.ts`, `-source-import.ts`, `-offline-executor.ts` | config parsers, read/comparison services, catalogs/admissions, `RegisteredDiagnosticsOfflineBenchmark` | durable / offline replay |
| benchmark projections | `verification-benchmark-projections.ts`, `-observations.ts`, `-response-replay.ts` | `prepareRegisteredBenchmarkProjections`, `hydrateRegisteredBenchmarkObservations`, `replayDiagnosticsCapturedResponse` | mixed |
| diagnostics offline | `verification-benchmark.ts` (`runDiagnosticsCompaniesDemo`, grant/load helpers), `verification-diagnostics-*.ts`, `verification-benchmark-version-diff.ts`, `verification-benchmark-refresh-proposal.ts` | demo composition, quality gates, fixtures, mutation/coverage, `prepareVerificationBenchmarkVersionDiff`, `prepareDiagnosticsBenchmarkRefreshProposal` | **offline/local** |

---

## 4. CLI commands

Bin: `knowledge` (`apps/cli/package.json:7`).

### 4.1 Generic invocation (`apps/cli/src/index.ts:36`)

| item | contract |
| --- | --- |
| flags | `--base-url`, `--context` (JSON `OperationContextSchema`), `--input` (JSON, default `{}`), `--timeout-ms` (100–300000, default 60000), `--wait` (verification_mutation only), `--human` (pretty JSON) |
| env | `KNOWLEDGE_API_URL` (or `--base-url`), `KNOWLEDGE_API_TOKEN` (required) |
| stdout | JSON of accepted receipt or `--wait` completion object |
| stderr | `{code,message}` — generic `{code:"CLI_ERROR",message}`; unknown command `{code:"UNKNOWN_COMMAND",group,action}`; specials use `DEMO_ERROR`, `BENCHMARK_CAPTURE_ERROR`, `BENCHMARK_DIFF_ERROR`, attestation codes |
| exit | implicit 0 on success without `--wait`; `--wait` uses `completed.exitCode`; catch → **2** |

`--wait` completion (`verification-completion.ts`): polls `getVerificationOperation`. Handled kinds in `WAITABLE_VERIFICATION_RECEIPTS` (capture, extraction, replay, metric, benchmark, compare, claims, report). **0** = capture always / `result.valid===true` / benchmark success / comparison `engineeringGateOutcome!=="fail"` / claims or report `disposition==="admitted"`. **1** = `valid===false`, `needs_review`, comparison `fail`, or claims/report `held_for_review`/`quality_failed`. Timeout / failed/cancelled/quarantined / missing receipt / unhandled kind (`verification_parse_artifact`, adjudication, audit, structured extraction; `VERIFICATION_WAIT_UNSUPPORTED_KIND`) throw → CLI **2**. Claims/report completion `{operationId,state,claims|report:{runId,manifestDigest,policyOutcome,mechanicalStatus,disposition},receiptId,exitCode}` is not the authoritative result.

### 4.2 Catalog (`CLI_COMMANDS` + `dispatchCliCommand`)

| group | action | mode | use case / resource | required input keys | notes |
| --- | --- | --- | --- | --- | --- |
| reconciliation | apply | provider_reconciliation | apply | `operationId`,`providerAttemptId`,`artifact` | |
| reconciliation | show | provider_reconciliation | show | `operationId`,`providerAttemptId` | |
| extraction | run | verification_mutation | extractStructuredData | full `ExtractStructuredDataRequestSchema` | |
| extraction | show | read | structured_extraction | `operationId` only | |
| benchmark | comparison | read | benchmark_comparison | `comparisonId` only | |
| benchmark | compare | verification_mutation | compareBenchmarkRuns | full compare schema | |
| benchmark | show | read | benchmark_run | `runId` | |
| benchmark | manifest | read | benchmark_manifest | `runId` | |
| benchmark | run | verification_mutation | runBenchmark | full run schema | |
| benchmark | capture | verification_mutation | captureSource | full capture schema | overridden if argv[2] is `diagnostics-companies` |
| artifact | parse | verification_mutation | parseArtifact | full parse schema | |
| verify | status | read | verification_operation | `operationId` only | `getVerificationOperation` |
| verify | claims-result | read | claims_result | `operationId` only | |
| verify | report-result | read | report_result | `operationId` only | |
| verify | cases | read | verification_cases | `runId`; optional `pageSize`,`cursor` | |
| verify | case | read | verification_case | `caseRunId` | |
| verify | evidence | read | verification_evidence | `evidenceId` | |
| verify | run | read | verification_run | `runId` | |
| verify | manifest | read | verification_manifest | `runId` | |
| verify | extract | verification_mutation | verifyExtraction | full schema | |
| verify | citations | verification_mutation | verifyClaims | full schema | |
| verify | report | verification_mutation | verifyReport | full schema | |
| verify | metric | verification_mutation | verifyMetricObservation | full schema | |
| bundle | inspect | verification_mutation | inspectAuditBundle | full schema | |
| bundle | show | read | audit_inspection | `operationId` only | |
| bundle | replay | verification_mutation | replayRun | full schema | |
| adjudication | request | verification_mutation | requestAdjudication | full schema | |
| adjudication | decision | verification_mutation | recordAdjudicationDecision | full schema | |
| adjudication | get | read | adjudication | `operationId` only | |
| adjudication | get-decision | read | adjudication_decision | `operationId` only | |

**Catalog verification rows:** 30.

### 4.3 Special-cased groups (`index.ts:15`)

| group | action | mode | flags | exit |
| --- | --- | --- | --- | --- |
| demo | diagnostics-companies | local | `--dataset` (must `diagnostics-companies-v1`), `--output` (required), `--open` | `qualityGate.exitCode`: pass 0, fail 1, unavailable/`verification_incomplete` 2; catch 2 |
| benchmark | capture diagnostics-companies | local+HTTP optional | `--propose-version` (must `diagnostics-companies-v2`), `--output`, `--profile`, `--base-url`, `--timeout-ms` | 0 `proposed_review_required`; 2 `refresh_incomplete` |
| benchmark | diff | local | positional previous/proposed; `--catalog-root`, `--proposal-root` | success 0; catch 2 |
| verification | attestation-export | local | `--audit-bundle`, `--trusted-public-keys`, `--trusted-binding`, `--output` | 0; catch 2 |
| verification | attestation-inspect | local | `--audit-bundle`, `--trusted-public-keys`, `--trusted-binding`, `--attestation` | 0 verified / 1 not; catch 2 |

**CLI command rows documented:** 35 (30 catalog + 5 special). `benchmark capture` is one catalog action plus one special argv form.

---

## 5. MCP tools

Transport: Streamable HTTP, `POST/GET/… /mcp` (`apps/mcp/src/index.ts:244`). Auth: Bearer resolved by `createLocalIdentityResolver(KNOWLEDGE_API_IDENTITIES)` (`:307`). Default listen `PORT` fallback **4101** (`:293`). Needs `POSTGRES_URL`, `KNOWLEDGE_API_URL`. Verification tools proxy `KnowledgeClient` (same bearer) to the HTTP API.

`FORBIDDEN_MCP_CAPABILITIES` (`catalog.ts:59`): `raw_sql`, `secret.read`, `storage.list`, `publication.approve`, `publication.publish`, `capability.admit`.

Shared mutation context fields: `tenantId`, `correlationId`, `idempotencyKey`, optional hints (`attemptId`, `workItemId`, `missionId`, `causationId`, `externalExecution`). Auth scope: `operation.submit` (mutations) or `knowledge.read` (reads).

### 5.1 Mutations (`VERIFICATION_MCP_TOOL_NAMES`)

| tool | input | client call | mut/read |
| --- | --- | --- | --- |
| `knowledge_extract_structured_data` | context + `ExtractStructuredDataRequestSchema` | `extractStructuredData` | mut |
| `knowledge_capture_source` | context + `CaptureSourceRequestSchema` | `captureVerificationSource` | mut |
| `knowledge_parse_artifact` | context + `ParseArtifactRequestSchema` | `parseArtifact` | mut |
| `knowledge_verify_extraction` | context + `VerifyExtractionRequestSchema` | `verifyExtraction` | mut |
| `knowledge_verify_claims` | context + `VerifyClaimsRequestSchema` | `verifyClaims` | mut |
| `knowledge_verify_report` | context + `VerifyReportRequestSchema` | `verifyReport` | mut |
| `knowledge_verify_metric` | context + `VerifyMetricObservationRequestSchema` | `verifyMetricObservation` | mut |
| `knowledge_request_adjudication` | context + `RequestAdjudicationRequestSchema` | `requestAdjudication` | mut |
| `knowledge_record_adjudication_decision` | context + `VerificationAdjudicationDecisionRequestSchema` | `recordAdjudicationDecision` | mut |
| `knowledge_inspect_audit_bundle` | context + `InspectAuditBundleRequestSchema` | `inspectAuditBundle` | mut |
| `knowledge_replay_run` | context + `ReplayRunRequestSchema` | `replayVerificationRun` | mut |
| `knowledge_run_benchmark` | context + `RunBenchmarkRequestSchema` | `runBenchmark` | mut |
| `knowledge_compare_benchmark_runs` | context + `CompareBenchmarkRunsRequestSchema` | `compareBenchmarkRuns` | mut |

### 5.2 Reads / recon (registered in `index.ts:184`)

| tool | fields | client call | mut/read |
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
| `knowledge_list_verification_cases` | context, `runId`, optional `pageSize`,`cursor` | `listVerificationRunCases` | read |
| `knowledge_get_verification_case` | context, `caseRunId` | `getVerificationCase` | read |
| `knowledge_get_verification_evidence` | context, `evidenceId` | `getVerificationEvidence` | read |
| `knowledge_get_verification_run` | context, `runId` | `getVerificationRun` | read |
| `knowledge_get_verification_manifest` | context, `runId` | `getVerificationRunManifest` | read |
| `knowledge_get_verification_operation` | context `{tenantId,correlationId}`, `operationId` | `getVerificationOperation` | read |

**MCP verification tools:** 30 (13 named catalog + 17 extra). Spec `knowledge_get_operation` maps to `knowledge_get_verification_operation`.

---

## 6. Worker activities

Handlers admitted only when their env is present; empty JSON/flag leaves the kind unregistered.

| operation kind | step | activity / runtime file | enable / config env | disabled when |
| --- | --- | --- | --- | --- |
| `verification_capture` | `register_and_admit` | `verification-activities.ts` | `VERIFICATION_SERVICE_CATALOG_JSON`; acquire: `VERIFICATION_CAPTURE_ACQUIRE_ENABLED=1` + `VERIFICATION_SOURCE_ACQUISITION_GRANTS_JSON` | catalog empty |
| `verification_extraction` | `verify_and_register` | same | catalog | catalog empty |
| `verification_replay` | `hydrate_and_recompute` | `verification-activities.ts`; replaced by `verification-sealed-replay-activity.ts` if metrics configured | catalog; sealed replay if metric grants | catalog empty |
| `verification_parse_artifact` | `parse_and_admit` | `verification-parse-activity.ts` | `VERIFICATION_PARSE_ARTIFACT_ENABLED=1` + catalog | flag ≠ `1` |
| `verification_metric` | `verify_metric_and_register` | `verification-metric-activity.ts` | `VERIFICATION_METRIC_PROFILE_GRANTS_JSON`; seal: `VERIFICATION_SEAL_POLICY_GRANTS_JSON` + runtime identity | grants empty |
| `verification_claims` | claims step (handler) | `verification-claims-activity.ts` | `VERIFICATION_CLAIMS_PROJECTION_GRANTS_JSON` + seal grants; optional `VERIFICATION_SEMANTIC_RUNTIME_JSON` + `VERIFICATION_SEMANTIC_PROFILE_GRANTS_JSON` | projection JSON empty |
| `verification_report` | same handler | same | same | same |
| `verification_audit_bundle` | audit inspect | `verification-audit-inspection-activity.ts` + runtime | `VERIFICATION_AUDIT_INSPECTION_ENABLED=1` + grants + public keys + claims grants; `VERIFICATION_AUDIT_INSPECTION_TIMEOUT_MS` | flag ≠ `1` |
| `verification_adjudication` | request | `verification-adjudication-activity.ts` + runtime | all three adjudication JSONs; timeout | any of trio missing |
| `verification_adjudication_decision` | `record_packet_bound_decision` | `verification-adjudication-decision-activity.ts` | `VERIFICATION_ADJUDICATION_DECISIONS_ENABLED=1` (+ optional synthetic grants JSON) | flag unset/`0` |
| `verification_benchmark` | `replay_recorded_and_register` | `verification-benchmark-activity.ts` + runtime | `VERIFICATION_BENCHMARK_CONFIG_JSON` + signing key id/PEM | config empty |
| `verification_benchmark_compare` | `compare_registered_and_publish` | `verification-benchmark-comparison-activity.ts` + runtime | comparison config + signing key id/PEM | config empty |
| `verification_structured_extraction` | `extract_and_register` | `verification-structured-extraction-runtime.ts` | extraction config + signing key id/PEM; `AI_GATEWAY_API_KEY` or `INTERFAZE_API_KEY` | config empty |

Shared worker identity when any verification block is on: `VERIFICATION_PARSER_IMAGE_DIGEST` (required), `VERIFICATION_PARSER_COMMAND` (default `docker`), `VERIFICATION_STORAGE_BUCKET` (default `ai-engineer-cloud-bucket`). Seal identity: `VERIFICATION_CODE_GIT_SHA`, `VERIFICATION_CODE_DIRTY` (`0`/`1`), `VERIFICATION_RUNTIME_PLATFORM`, `VERIFICATION_RUNTIME_DEPLOYMENT_ID`. Optional `VERIFICATION_AUDIT_SIGNING_KEY_ID` + `VERIFICATION_AUDIT_SIGNING_PRIVATE_KEY_PEM`.

`apps/worker/src/worker.ts` is the generic durable loop (no verification kinds).

---

## 7. Environment variable matrix

Reads use `environment = process.env` (or injected `Environment`). `packages/config` has **no** `VERIFICATION_*` keys. MCP/CLI have **no** `VERIFICATION_*` reads.

### 7.1 `VERIFICATION_*` (api / worker)

| name | process | req/opt | shape | purpose | source |
| --- | --- | --- | --- | --- | --- |
| `VERIFICATION_SERVICE_OWNERSHIP_GRANTS_JSON` | api, worker* | req for most capabilities | JSON grants | bind actor→tenant/mission/attempt | `apps/api/src/index.ts:100` |
| `VERIFICATION_SERVICE_ATTEMPT_ID` | api | opt (legacy static context) | UUID | static attempt when no ownership resolver | `index.ts:99` |
| `VERIFICATION_SERVICE_WORK_ITEM_ID` | api | opt | UUID | static work item hint | `index.ts:197` |
| `VERIFICATION_SERVICE_MISSION_ID` | api | opt | UUID | static mission hint | `index.ts:198` |
| `VERIFICATION_SERVICE_CAUSATION_ID` | api | opt | string | static causation | `index.ts:199` |
| `VERIFICATION_SERVICE_EXTERNAL_RUNTIME` | api | pair with run id | string | external execution | `index.ts:200` |
| `VERIFICATION_SERVICE_EXTERNAL_RUN_ID` | api | pair | string | | `index.ts:200` |
| `VERIFICATION_SERVICE_EXTERNAL_ROOT_RUN_ID` | api | opt | string | | `index.ts:202` |
| `VERIFICATION_SERVICE_EXTERNAL_SESSION_ID` | api | opt | string | | `index.ts:202` |
| `VERIFICATION_SERVICE_EXTERNAL_TURN_ID` | api | opt | string | | `index.ts:202` |
| `VERIFICATION_SERVICE_EXTERNAL_TOOL_CALL_ID` | api | opt | string | | `index.ts:202` |
| `VERIFICATION_SERVICE_CAPABILITY_VERSION` | api | opt | string | default `verification-service.v1` | `index.ts:252` |
| `VERIFICATION_EVE_RUNTIME_ATTESTATION_KEYS_JSON` | api | opt | JSON keys | Eve attestation on ownership resolver | `index.ts:101` |
| `VERIFICATION_SERVICE_CATALOG_JSON` | api, worker | req for capture/parse | JSON catalog | source/profile grants | `index.ts:167`, `worker/index.ts:388` |
| `VERIFICATION_CAPTURE_ACQUIRE_ENABLED` | api, worker | opt 0/1 | flag | live source acquire | `index.ts:163`, `worker/index.ts:547` |
| `VERIFICATION_SOURCE_ACQUISITION_GRANTS_JSON` | worker | req if acquire=1 | JSON array | transport grants | `worker/index.ts:555` |
| `VERIFICATION_PARSE_ARTIFACT_ENABLED` | api, worker | opt 0/1 | flag | parse admission | `index.ts:159`, `worker/index.ts:390` |
| `VERIFICATION_METRIC_ENABLED` | api | opt 0/1 | flag | admit `verification_metric` | `index.ts:115` |
| `VERIFICATION_METRIC_PROFILE_GRANTS_JSON` | worker | req for metric activity | JSON array | metric profiles | `worker/index.ts:392` |
| `VERIFICATION_CLAIMS_ENABLED` | api | opt 0/1 | flag | claims/report submit | `index.ts:118` |
| `VERIFICATION_CLAIMS_PROJECTION_GRANTS_JSON` | api, worker | req if claims/audit/adj | JSON array | projection grants | `index.ts:184`, `worker/index.ts:394` |
| `VERIFICATION_SEAL_POLICY_GRANTS_JSON` | api, worker | req if claims/seal | JSON array | seal policy artifacts | `index.ts:184`, `worker/index.ts:429` |
| `VERIFICATION_CLAIMS_REPORT_READ_PUBLIC_KEYS_JSON` | api | opt | JSON keys | claims/report reads | `verification-claims-report-reads-runtime.ts:13` |
| `VERIFICATION_AUDIT_INSPECTION_ENABLED` | api, worker | opt 0/1 | flag | inspect submit + worker | `index.ts:121`, `worker/index.ts:396` |
| `VERIFICATION_AUDIT_INSPECTION_GRANTS_JSON` | api, worker | req if enabled | JSON | exact audit grants | `index.ts:126`, `worker/index.ts:405` |
| `VERIFICATION_AUDIT_INSPECTION_PUBLIC_KEYS_JSON` | worker | req if inspect enabled | JSON keys | inspect verify | `worker/index.ts:407` |
| `VERIFICATION_AUDIT_INSPECTION_READS_ENABLED` | api | opt 0/1 | flag | inspect GET | `verification-audit-inspection-reads-runtime.ts:8` |
| `VERIFICATION_AUDIT_INSPECTION_TIMEOUT_MS` | worker | opt | positive int | default 30000 | `worker/index.ts:864` |
| `VERIFICATION_ADJUDICATION_GRANTS_JSON` | api, worker | all-or-nothing trio | JSON | adjudication | `index.ts:138`, `worker/index.ts:132` |
| `VERIFICATION_ADJUDICATION_REVIEW_REQUIREMENTS_JSON` | api, worker | trio | JSON | reviewer quorum/roles | `index.ts:139`, `worker/index.ts:134` |
| `VERIFICATION_ADJUDICATION_PUBLIC_KEYS_JSON` | api, worker | trio | JSON keys | packet keys | `index.ts:140`, `worker/index.ts:136` |
| `VERIFICATION_ADJUDICATION_TIMEOUT_MS` | api, worker | opt | int | default 30000 | `adjudication-reads-runtime.ts:66`, `worker/index.ts:918` |
| `VERIFICATION_ADJUDICATION_DECISIONS_ENABLED` | api, worker | opt 0/1 | flag | decision record/read | `adjudication-decision-runtime.ts:15`, `worker/index.ts:191` |
| `VERIFICATION_ADJUDICATION_SYNTHETIC_REVIEWER_GRANTS_JSON` | api, worker | opt if enabled | JSON array | synthetic reviewers | same |
| `VERIFICATION_BENCHMARK_CONFIG_JSON` | api, worker | opt | JSON | run benchmark | `index.ts:105`, `benchmark-runtime.ts:17` |
| `VERIFICATION_BENCHMARK_SIGNING_KEY_ID` | worker | req if config | string | benchmark seal | `benchmark-runtime.ts:21` |
| `VERIFICATION_BENCHMARK_SIGNING_PRIVATE_KEY_PEM` | worker | req if config | PEM | | `benchmark-runtime.ts:21` |
| `VERIFICATION_BENCHMARK_COMPARISON_CONFIG_JSON` | api, worker | opt | JSON | compare | `index.ts:108`, `comparison-runtime.ts:9` |
| `VERIFICATION_BENCHMARK_COMPARISON_SIGNING_KEY_ID` | worker | req if config | string | | `comparison-runtime.ts:11` |
| `VERIFICATION_BENCHMARK_COMPARISON_SIGNING_PRIVATE_KEY_PEM` | worker | req if config | PEM | | `comparison-runtime.ts:11` |
| `VERIFICATION_BENCHMARK_CAPTURE_PROFILES_JSON` | api | opt | JSON | profile capture routing | `index.ts:212` |
| `VERIFICATION_BENCHMARK_READ_PUBLIC_KEYS_JSON` | api | opt | JSON keys | benchmark GET | `benchmark-reads-runtime.ts:31` |
| `VERIFICATION_BENCHMARK_COMPARISON_READ_PUBLIC_KEYS_JSON` | api | opt | JSON keys | comparison GET | `benchmark-comparison-reads-runtime.ts:7` |
| `VERIFICATION_STRUCTURED_EXTRACTION_CONFIG_JSON` | api, worker | opt | JSON | extract live | `index.ts:111`, `structured-extraction-runtime.ts:20` |
| `VERIFICATION_STRUCTURED_EXTRACTION_SIGNING_KEY_ID` | worker | req if config | string | | `structured-extraction-runtime.ts:25` |
| `VERIFICATION_STRUCTURED_EXTRACTION_SIGNING_PRIVATE_KEY_PEM` | worker | req if config | PEM | | same |
| `VERIFICATION_STRUCTURED_EXTRACTION_READ_PUBLIC_KEYS_JSON` | api | opt | JSON keys | extraction GET | `structured-extraction-reads-runtime.ts:10` |
| `VERIFICATION_PROVIDER_RECONCILIATION_GRANTS_JSON` | api | opt | JSON | extraction recon | `provider-reconciliation-runtime.ts:17` |
| `VERIFICATION_SEMANTIC_PROVIDER_RECONCILIATION_GRANTS_JSON` | api | opt | JSON | claims/report recon | `semantic-reconciliation-runtime.ts:19` |
| `VERIFICATION_PROVIDER_RECONCILIATION_PUBLIC_KEYS_JSON` | api | req if recon grants | JSON keys | | both recon runtimes |
| `VERIFICATION_READS_ENABLED` | api | opt 0/1 | flag | run/case/evidence GET | `verification-reads-runtime.ts:6` |
| `VERIFICATION_CAPTURE_READS_ENABLED` | api | opt 0/1 | flag | capture GET | `capture-reads-runtime.ts:10` |
| `VERIFICATION_PARSER_IMAGE_DIGEST` | api, worker | req if claims/capture-reads/worker verify | `sha256:`+64hex | parser pin | `index.ts:192`, `worker/index.ts:446` |
| `VERIFICATION_PARSER_COMMAND` | worker | opt | string | default `docker` | `worker/index.ts:477` |
| `VERIFICATION_STORAGE_BUCKET` | api, worker | opt | string | default `ai-engineer-cloud-bucket` | many; `index.ts:76` |
| `VERIFICATION_CODE_GIT_SHA` | api, worker | req if claims/seal | string | seal identity | `index.ts:192`, `worker/index.ts:517` |
| `VERIFICATION_CODE_DIRTY` | api, worker | req if seal | `0`/`1` | | same |
| `VERIFICATION_RUNTIME_PLATFORM` | api, worker | req if seal | string | | same |
| `VERIFICATION_RUNTIME_DEPLOYMENT_ID` | api, worker | req if seal | string | | same |
| `VERIFICATION_SEMANTIC_RUNTIME_JSON` | worker | opt | JSON | claims semantic stage | `claims-semantic-stage.ts:18` |
| `VERIFICATION_SEMANTIC_PROFILE_GRANTS_JSON` | api, worker | opt | JSON | judge profiles | `adjudication-reads-runtime.ts:50`, `worker/index.ts:162` |
| `VERIFICATION_AUDIT_SIGNING_KEY_ID` | worker | opt pair | string | audit signer | `audit-signing-runtime.ts:5` |
| `VERIFICATION_AUDIT_SIGNING_PRIVATE_KEY_PEM` | worker | opt pair | PEM | | `audit-signing-runtime.ts:6` |
| `VERIFICATION_DRIFT_REVALIDATION_ENABLED` | api | opt 0/1 default 0 | flag | internal drift queue | `index.ts:64` |
| `VERIFICATION_DRIFT_CONSUMER_SERVICE_IDENTITIES_JSON` | api | req if drift=1 | JSON array | allowlist | `index.ts:66` |
| `VERIFICATION_COMPONENT_DRIFT_MONITORS_JSON` | api | pair | JSON | component drift | `index.ts:70` |
| `VERIFICATION_COMPONENT_DRIFT_PUBLIC_KEYS_JSON` | api | pair | JSON keys | | `index.ts:71` |

\*worker reads ownership only via API-composed grants in other processes; worker itself authorizes by `WORKER_TENANT_ID`.

### 7.2 Non-`VERIFICATION_*` dependencies

| name | process | purpose |
| --- | --- | --- |
| `POSTGRES_URL` | api, worker, mcp | canonical DB |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | api, worker | artifact store |
| `KNOWLEDGE_API_IDENTITIES` | api, mcp | bearer map |
| `KNOWLEDGE_API_URL` | api (public origin), mcp, cli | public origin / client |
| `KNOWLEDGE_API_TOKEN` | cli | client bearer |
| `AI_GATEWAY_API_KEY` | api (retrieval), worker (extraction/embeddings) | gateway |
| `INTERFAZE_API_KEY` | worker | interfaze extraction host |
| `KNOWLEDGE_PERSISTENCE_MODE` | worker | `postgres` vs memory |
| `WORKER_TENANT_ID`, `WORKER_ID`, `WORKER_POLL_MS`, `WORKER_LEASE_MS` | worker | loop scope |
| `CANONICAL_LOCAL_ONLY` | api, worker, mcp | local Postgres |
| `VERCEL_OIDC_TOKEN` | api | alternate gateway auth |
| `KNOWLEDGE_CALLBACK_SIGNING_KEYS` | api | A2A callbacks (not verification-specific) |

### 7.3 Missing from `.env.example`

`.env.example` has only: `VERIFICATION_SERVICE_OWNERSHIP_GRANTS_JSON`, `VERIFICATION_SERVICE_CATALOG_JSON`, `VERIFICATION_METRIC_ENABLED`, `VERIFICATION_METRIC_PROFILE_GRANTS_JSON`, `VERIFICATION_PARSER_IMAGE_DIGEST`, `VERIFICATION_PARSER_COMMAND`, `VERIFICATION_STORAGE_BUCKET`, `VERIFICATION_READS_ENABLED`, `VERIFICATION_SEAL_POLICY_GRANTS_JSON`, `VERIFICATION_CODE_GIT_SHA`, `VERIFICATION_CODE_DIRTY`, `VERIFICATION_RUNTIME_PLATFORM`, `VERIFICATION_RUNTIME_DEPLOYMENT_ID`.

**Missing (read by api/worker, absent from `.env.example`):**  
`VERIFICATION_ADJUDICATION_DECISIONS_ENABLED`, `VERIFICATION_ADJUDICATION_GRANTS_JSON`, `VERIFICATION_ADJUDICATION_PUBLIC_KEYS_JSON`, `VERIFICATION_ADJUDICATION_REVIEW_REQUIREMENTS_JSON`, `VERIFICATION_ADJUDICATION_SYNTHETIC_REVIEWER_GRANTS_JSON`, `VERIFICATION_ADJUDICATION_TIMEOUT_MS`, `VERIFICATION_AUDIT_INSPECTION_ENABLED`, `VERIFICATION_AUDIT_INSPECTION_GRANTS_JSON`, `VERIFICATION_AUDIT_INSPECTION_PUBLIC_KEYS_JSON`, `VERIFICATION_AUDIT_INSPECTION_READS_ENABLED`, `VERIFICATION_AUDIT_INSPECTION_TIMEOUT_MS`, `VERIFICATION_AUDIT_SIGNING_KEY_ID`, `VERIFICATION_AUDIT_SIGNING_PRIVATE_KEY_PEM`, `VERIFICATION_BENCHMARK_CAPTURE_PROFILES_JSON`, `VERIFICATION_BENCHMARK_COMPARISON_CONFIG_JSON`, `VERIFICATION_BENCHMARK_COMPARISON_READ_PUBLIC_KEYS_JSON`, `VERIFICATION_BENCHMARK_COMPARISON_SIGNING_KEY_ID`, `VERIFICATION_BENCHMARK_COMPARISON_SIGNING_PRIVATE_KEY_PEM`, `VERIFICATION_BENCHMARK_CONFIG_JSON`, `VERIFICATION_BENCHMARK_READ_PUBLIC_KEYS_JSON`, `VERIFICATION_BENCHMARK_SIGNING_KEY_ID`, `VERIFICATION_BENCHMARK_SIGNING_PRIVATE_KEY_PEM`, `VERIFICATION_CAPTURE_ACQUIRE_ENABLED`, `VERIFICATION_CAPTURE_READS_ENABLED`, `VERIFICATION_CLAIMS_ENABLED`, `VERIFICATION_CLAIMS_PROJECTION_GRANTS_JSON`, `VERIFICATION_CLAIMS_REPORT_READ_PUBLIC_KEYS_JSON`, `VERIFICATION_COMPONENT_DRIFT_MONITORS_JSON`, `VERIFICATION_COMPONENT_DRIFT_PUBLIC_KEYS_JSON`, `VERIFICATION_DRIFT_CONSUMER_SERVICE_IDENTITIES_JSON`, `VERIFICATION_DRIFT_REVALIDATION_ENABLED`, `VERIFICATION_EVE_RUNTIME_ATTESTATION_KEYS_JSON`, `VERIFICATION_PARSE_ARTIFACT_ENABLED`, `VERIFICATION_PROVIDER_RECONCILIATION_GRANTS_JSON`, `VERIFICATION_PROVIDER_RECONCILIATION_PUBLIC_KEYS_JSON`, `VERIFICATION_SEMANTIC_PROFILE_GRANTS_JSON`, `VERIFICATION_SEMANTIC_PROVIDER_RECONCILIATION_GRANTS_JSON`, `VERIFICATION_SEMANTIC_RUNTIME_JSON`, `VERIFICATION_SERVICE_ATTEMPT_ID`, `VERIFICATION_SERVICE_CAPABILITY_VERSION`, `VERIFICATION_SERVICE_CAUSATION_ID`, `VERIFICATION_SERVICE_EXTERNAL_ROOT_RUN_ID`, `VERIFICATION_SERVICE_EXTERNAL_RUNTIME`, `VERIFICATION_SERVICE_EXTERNAL_RUN_ID`, `VERIFICATION_SERVICE_EXTERNAL_SESSION_ID`, `VERIFICATION_SERVICE_EXTERNAL_TOOL_CALL_ID`, `VERIFICATION_SERVICE_EXTERNAL_TURN_ID`, `VERIFICATION_SERVICE_MISSION_ID`, `VERIFICATION_SERVICE_WORK_ITEM_ID`, `VERIFICATION_SOURCE_ACQUISITION_GRANTS_JSON`, `VERIFICATION_STRUCTURED_EXTRACTION_CONFIG_JSON`, `VERIFICATION_STRUCTURED_EXTRACTION_READ_PUBLIC_KEYS_JSON`, `VERIFICATION_STRUCTURED_EXTRACTION_SIGNING_KEY_ID`, `VERIFICATION_STRUCTURED_EXTRACTION_SIGNING_PRIVATE_KEY_PEM`.

**Count missing:** 54.

---

## 8. `packages/verification` module map

Package: `@aiengineer/knowledge-verification` `0.1.0`. Dependencies: `@aiengineer/knowledge-contracts` only (`packages/verification/package.json`).

| dir | index exports (names) | purpose | tests |
| --- | --- | --- | --- |
| `deterministic/` | `canonicalizeJson`, `digestCanonicalJson`, `sha256Digest`, `fromPrototypeSha256`, `toPrototypeSha256`, decimal helpers, `verifyDeterministicBundle`, `resolveBuiltInSelector`, `resolveWithAdmittedResolver` | mechanical verification + RFC8785 | `deterministic.test.ts` |
| `selectors/` | `parseCanonicalProjection`, `ProjectionSelectorResolver`, `projectionSelectorResolver` | projection parse + selector resolve | `resolvers.test.ts` |
| `extraction/` | `admitExtractionSchema`, `validateExtractionCandidate`, `verifyExtractionFields`, `verifyExtractionFieldsWithAcceptedSelections`, `verifyExtractionFieldsWithEvidence`, `sourceComponentValue` | schema gate + field evidence | `extraction.test.ts` |
| `provenance/` | seal/inspect/replay audit, DSSE attestation, policy-input validate, benchmark publication seal/verify | audit seal + replay + attest | `provenance.test.ts`, `attestation.test.ts`, `benchmark-publication.test.ts`, `benchmark-comparison-publication.test.ts` |
| `claims/` | `acceptClaimDecomposition`, `evaluateDecompositionProposal`, `applyReportWideMechanicalGates`, `verifyReportWide`, `verifyReportWideFromLedger` | claim class + report-wide gates | (covered via package tests; no `claims/*.test.ts`) |
| `authority/` | `assessSourceAuthority` | authority vector | none in dir |
| `semantic/` | `verifySemanticCase`, `verifyAssertionSemantics`, `authorizeSemanticCase`, `observeSemanticModelDrift`, `mechanicalSemanticClosure`, `proposeUncitedEvidenceRescue`, `summarizeAttributionPerturbations` | semantic judge + rescue | `verification.test.ts`, `diagnostics.test.ts` |
| `providers/` | `providerRegistry`, `registeredProvider`, gateway/interfaze providers, semantic judge adapters, bounds | provider I/O | `providers.test.ts`, `gateway-semantic-observation.test.ts`, `semantic-judge.test.ts` |
| `prototype-compat` (files) | `prototypeSha256`, locator resolvers, `verifyPrototypeBundle`, `replayPrototypeArithmetic` | prototype parity | `prototype-compat.test.ts` |

Root `src/index.ts` re-exports those dirs plus selected contract schemas.

### Spec topology → actual home

| spec dir | actual home |
| --- | --- |
| domain | `packages/contracts/src/verification/*` + `packages/verification` engines |
| selectors | `packages/verification/src/selectors` + `packages/contracts/src/verification/selectors.ts` |
| claims | `packages/verification/src/claims` + `packages/application/src/verification-claims.ts` |
| deterministic | `packages/verification/src/deterministic` |
| authority | `packages/verification/src/authority` |
| metrics | `packages/application/src/verification-metrics.ts` (+ worker sealer) |
| provenance | `packages/verification/src/provenance` |
| providers | `packages/verification/src/providers` + `packages/application/src/verification-provider.ts` |
| experiments | `packages/evaluation/src/verification-benchmark*.ts`, `verification-statistics.ts`, `verification-human-review.ts`; `packages/application/src/verification-benchmark*.ts` |
| demos | `apps/cli/src/diagnostics-demo.ts` + `packages/application/src/verification-diagnostics-*` + `verification-benchmark.ts` (`runDiagnosticsCompaniesDemo`) |
| testing | package `*.test.ts` + `scripts/prove-verification-*`. `packages/testkit` has **no** verification module (retrieval/embedding corpus only). |

---

## 9. Persistence & DB contract

Pinned: `@aiengineer/database-contract` → `file:vendor/aiengineer-database-contract-0.2.38.tgz` (`packages/persistence/package.json:18`).

### `knowledge_service.*` tables touched by `packages/persistence/src/verification*.ts`

`knowledge_service.operation`, `knowledge_service.operation_step`, `knowledge_service.receipt`, `knowledge_service.operation_event`, `knowledge_service.lease`.

Adjacent schemas (same files, not `knowledge_service`): `evidence.verification_run`, `evidence.verification_adjudication_subject`, `evidence.verification_adjudication_decision`, `evidence.verification_adjudication_reviewer_grant`, `evidence.verification_adjudication_review_state`; `orchestration.artifact`, `orchestration.verification_artifact_metadata`, `orchestration.artifact_lineage`, `orchestration.verification_provider_attempt`, `orchestration.verification_semantic_response_observation`, `orchestration.verification_drift_revalidation_outbox`, `orchestration.verification_component_drift_observation`.

Storage: env `VERIFICATION_STORAGE_BUCKET` default `ai-engineer-cloud-bucket`. Object key prefix from registrar (`packages/persistence/src/verification.ts:111`): `{tenantId}/{digest[7:9]}/{digest[7:]}` (digest hex after `sha256:`).

---

## 10. Other repos touched

`../ai-engineer-mission-control` exists. Verification-related files (names only; not read deeply):

- `apps/api/src/verification-temporal.ts` (+ `.test.ts`)
- `apps/api/src/verification-http.ts` (+ `.test.ts`)
- `apps/worker/src/verification-workflow.ts`, `verification-activities.ts`, `verification-runtime.ts`, `verification-dispatch.ts`, `verification-drift-workflow.ts`, `verification-drift-runtime.ts`, `verification-drift-schedule.ts` (+ tests)
- `packages/mission-kernel/src/verification-dispatch.ts`
- scripts: `prove-verification-temporal*.ts`, `prove-verification-http.ts`, `prove-verification-dashboard-native.ts`, `prove-verification-semantic-temporal.ts`, `prove-verification-adjudication-temporal.ts`, `prove-verification-audit-temporal.ts`, `configure-verification-drift-schedule.ts`, `verification-cloud-proof-worker.ts`, `verification-loopback-fixture-bridge.mjs`, `verification-proof-secret-scan.mjs`
- docs: `VERIFICATION-CPH-RECEIPTS.md`, `VERIFICATION-DRIFT-OPERATIONS.md`

Dashboard: present via prove/dashboard scripts and `verification-http.ts` (not enumerated as a separate app file here).

---

## 11. Test / proof scripts

**`scripts/prove-verification-*.ts` / `.mjs`:** 87 files.

| topic | scripts |
| --- | --- |
| adjudication | `prove-verification-adjudication-{dashboard-proxy,decision-full-startup,decision-public-reads,decision-reads,decision-recovery,mission-control,public-reads,reads,review-rollback,worker}.ts` |
| admission / ownership | `prove-verification-admission.ts`, `prove-verification-operation-ownership.ts` |
| audit | `prove-verification-audit-inspection-transports.ts`, `prove-verification-audit-mission-control.ts` |
| benchmark | `prove-verification-benchmark-{comparison-application,comparison-crash,comparison-kernel,comparison-lifecycle,comparison-reads,comparison-terminal-success,comparison-worker,crash,durable-negatives,extraction-experiment,extraction-live,freeze,freeze-v4,live-smoke,normalization,offline,publication-negatives,reads,refresh-native,v1-tooling,worker}.ts` |
| capture / parse | `prove-verification-capture-terminal-parity.ts`, `prove-verification-parse-terminal-parity.ts`, `prove-verification-parser-review.mjs`, `prove-verification-parser-review-v2.mjs`, `prove-verification-parser-v2-visible.ts`, `prove-verification-source-acquisition-native.ts` |
| claims / report | `prove-verification-claims-report-{reads,read-transports,transports,worker}.ts`, `prove-verification-ev162-report-semantics.ts` |
| diagnostics | `prove-verification-diagnostics-v1-semantic-pairs.ts`, `prove-verification-diagnostics-v1-semantic-missing-two.ts` |
| eve / cursor / cloud | `prove-verification-eve-{live-report,negative-controls,report}.ts`, `prove-verification-cursor-report.ts`, `prove-verification-cloud-agent-report-loopback.ts` |
| dashboard / MC | `prove-verification-dashboard-adjudication-read.ts`, `prove-verification-semantic-mission-control.ts`, `prove-verification-vr014-review-capability.ts` |
| metric / replay / persistence | `prove-verification-metric-service.ts`, `prove-verification-registered-replay.ts`, `prove-verification-full-retained-replay.ts`, `prove-verification-persistence.ts` |
| provider / recon | `prove-verification-providers.ts`, `prove-verification-provider-{accounting,operation-scope,response-capture,reconciliation,reconciliation-admission,reconciliation-http,reconciliation-publications,reconciliation-reads,reconciliation-transports}.ts` |
| service / worker | `prove-verification-service-terminal-parity.ts`, `prove-verification-service-worker.ts` |
| structured extraction | `prove-verification-structured-extraction-{accepted-recovery,candidate,dispatch-recovery,failure,failure-recovery,failure-terminal,lifecycle,process-recovery,publication,public-worker,reads,replay,terminal,transports,worker}.ts` |

Root `package.json` verification-relevant script: `prove:verification-persistence` (`tsx --env-file=.env scripts/prove-verification-persistence.ts`). CI `.github/workflows/verify.yml` runs **`pnpm verify`** (`typecheck && test && build`).
