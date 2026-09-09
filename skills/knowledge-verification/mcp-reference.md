# Knowledge verification MCP reference

Package: `@aiengineer/knowledge-mcp`. Tools proxy `KnowledgeClient` (same bearer) to the HTTP API. MCP is a distribution surface, not a validation boundary.

## Transport

- Streamable HTTP via Fastify `app.all("/mcp", …)` (`apps/mcp/src/index.ts`).
- Default listen: `PORT` fallback **4101** (`createMcpRuntime` sets `PORT` to `environment.PORT ?? "4101"`). `HOST` comes from `loadServerConfig` (default `127.0.0.1`).
- Auth: `Authorization: Bearer …` resolved by `createLocalIdentityResolver(KNOWLEDGE_API_IDENTITIES)`. Missing/unknown bearer → `401` `{code:"UNAUTHORIZED"}`.
- Process needs `POSTGRES_URL` and `KNOWLEDGE_API_URL` (public API origin; pathname `/` only). Optional `CANONICAL_LOCAL_ONLY=1`.
- Also: `GET /health` → `{status:"ok"}`.

Do not print identity maps or tokens.

## Shared context fields

Verification **mutations** (`verificationContextSchema`):

| field | required | notes |
| --- | --- | --- |
| `tenantId` | yes | UUID |
| `correlationId` | yes | 1–255 |
| `idempotencyKey` | yes | 8–255 |
| `attemptId` | no | UUID hint; required on the production ownership path |
| `workItemId` | no | UUID hint; required on the production ownership path |
| `missionId` | no | UUID hint; required on the production ownership path |
| `causationId` | no | non-empty string |
| `externalExecution` | no | `ExternalExecutionContextSchema` |

This is **not** CLI `OperationContextSchema`. Mutation tools take `{context, request}` where `request` is the public verification request schema.

Against an API configured with `VERIFICATION_SERVICE_OWNERSHIP_GRANTS_JSON` (the production path; required whenever `VERIFICATION_CLAIMS_ENABLED=1`), MCP `context` must carry `attemptId` + `missionId` + `workItemId` that match an ownership grant (tenant, bearer actor, mission) and existing `orchestration.attempt` / `work_item` / `mission` rows with the grant's `agentDeploymentId`. The client sends those IDs as `x-verification-attempt-id`, `x-verification-work-item-id`, `x-verification-mission-id`. Otherwise **403** `"Verification operation ownership denied"`. In legacy static mode, `attemptId` must equal `VERIFICATION_SERVICE_ATTEMPT_ID`.

Verification **reads** (and reconciliation show): `{context: {tenantId, correlationId}, …ids}`. No `idempotencyKey`.

Auth scope: `operation.submit` (mutations, including `knowledge_apply_provider_reconciliation`) or `knowledge.read` (reads). Unauthorized → tool error `FORBIDDEN`. Missing API client → `CAPABILITY_NOT_ADMITTED`. MCP cannot grant capabilities.

## Tool catalog (30)

13 named in `VERIFICATION_MCP_TOOL_NAMES` plus 17 registered in `index.ts`.

| tool | mut/read | key input fields | maps to |
| --- | --- | --- | --- |
| `knowledge_extract_structured_data` | mut | context + `ExtractStructuredDataRequestSchema` | `extractStructuredData` |
| `knowledge_capture_source` | mut | context + `CaptureSourceRequestSchema` | `captureVerificationSource` |
| `knowledge_parse_artifact` | mut | context + `ParseArtifactRequestSchema` | `parseArtifact` |
| `knowledge_verify_extraction` | mut | context + `VerifyExtractionRequestSchema` (exactly one `captureId`) | `verifyExtraction` |
| `knowledge_verify_claims` | mut | context + `VerifyClaimsRequestSchema` | `verifyClaims` |
| `knowledge_verify_report` | mut | context + `VerifyReportRequestSchema` | `verifyReport` |
| `knowledge_verify_metric` | mut | context + `VerifyMetricObservationRequestSchema` | `verifyMetricObservation` |
| `knowledge_request_adjudication` | mut | context + `RequestAdjudicationRequestSchema` | `requestAdjudication` |
| `knowledge_record_adjudication_decision` | mut | context + `VerificationAdjudicationDecisionRequestSchema` | `recordAdjudicationDecision` |
| `knowledge_inspect_audit_bundle` | mut | context + `InspectAuditBundleRequestSchema` | `inspectAuditBundle` |
| `knowledge_replay_run` | mut | context + `ReplayRunRequestSchema` | `replayVerificationRun` |
| `knowledge_run_benchmark` | mut | context + `RunBenchmarkRequestSchema` | `runBenchmark` |
| `knowledge_compare_benchmark_runs` | mut | context + `CompareBenchmarkRunsRequestSchema` | `compareBenchmarkRuns` |
| `knowledge_apply_provider_reconciliation` | mut | context, `operationId`, `providerAttemptId`, `artifact` | `applyProviderReconciliation` |
| `knowledge_get_provider_reconciliation` | read | context, `operationId`, `providerAttemptId` | `getProviderReconciliation` |
| `knowledge_get_structured_extraction` | read | context, `operationId` | `getStructuredExtraction` |
| `knowledge_get_audit_inspection` | read | context, `operationId` | `getAuditInspection` |
| `knowledge_get_verification_claims_result` | read | context, `operationId` | `getVerificationClaimsResult` |
| `knowledge_get_verification_report_result` | read | context, `operationId` | `getVerificationReportResult` |
| `knowledge_get_adjudication` | read | context, `operationId` | `getAdjudicationSubject` |
| `knowledge_get_adjudication_decision` | read | context, `operationId` | `getAdjudicationDecision` |
| `knowledge_get_benchmark_run` | read | context, `runId` | `getBenchmarkRun` |
| `knowledge_get_benchmark_manifest` | read | context, `runId` | `getBenchmarkRunManifest` |
| `knowledge_get_benchmark_comparison` | read | context, `comparisonId` | `getBenchmarkComparison` |
| `knowledge_list_verification_cases` | read | context, `runId`, optional `pageSize`, `cursor` | `listVerificationRunCases` |
| `knowledge_get_verification_case` | read | context, `caseRunId` | `getVerificationCase` |
| `knowledge_get_verification_evidence` | read | context, `evidenceId` | `getVerificationEvidence` |
| `knowledge_get_verification_run` | read | context, `runId` | `getVerificationRun` |
| `knowledge_get_verification_manifest` | read | context, `runId` | `getVerificationRunManifest` |
| `knowledge_get_verification_operation` | read | context `{tenantId,correlationId}`, `operationId` | `getVerificationOperation` |

Spec names `knowledge_extract_structured` and `knowledge_inspect_run` are **not** registered. Spec `knowledge_get_operation` maps to `knowledge_get_verification_operation`. There is no capture-show tool. Requires `knowledge.read`; missing API client → `CAPABILITY_NOT_ADMITTED`. Returns operation status (state, kind, receiptIds); read the kind-specific terminal result once `state` is `succeeded`.

Non-verification tools in `MCP_TOOL_CATALOG` (source, vector_store, retrieval, …) share the server and are out of scope.

## Forbidden capabilities

`FORBIDDEN_MCP_CAPABILITIES` (`apps/mcp/src/catalog.ts`):

- `raw_sql`
- `secret.read`
- `storage.list`
- `publication.approve`
- `publication.publish`
- `capability.admit`

Do not expose unrestricted shell, browser, upload, or provider pass-through under the verification namespace. Tool results are compact summaries and artifact handles, not raw provider payloads.

## How to start in-repo

From `ai-engineer-knowledge-services/`:

```text
corepack pnpm dev:mcp
```

Root `package.json` maps that to `corepack pnpm --filter @aiengineer/knowledge-mcp dev` (`tsx watch src/index.ts`). After build: `corepack pnpm --filter @aiengineer/knowledge-mcp start` → `node dist/index.js`.

The API and worker must already admit the verification capability the tool will call; MCP does not enable env flags or grants.
