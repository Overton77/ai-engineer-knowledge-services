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

Auth scope: `operation.submit` (mutations, including `verify_reconciliation_apply`) or `knowledge.read` (reads). Unauthorized → tool error `FORBIDDEN`. Missing API client → `CAPABILITY_NOT_ADMITTED`. MCP cannot grant capabilities.

## Tool catalog (30)

13 named in `VERIFICATION_MCP_TOOL_NAMES` plus 17 registered in `index.ts`.

| tool | mut/read | key input fields | maps to |
| --- | --- | --- | --- |
| `verify_extraction_run` | mut | context + `ExtractStructuredDataRequestSchema` | `extractStructuredData` |
| `verify_benchmark_capture` | mut | context + `CaptureSourceRequestSchema` | `captureVerificationSource` |
| `verify_artifact_parse` | mut | context + `ParseArtifactRequestSchema` | `parseArtifact` |
| `verify_extract` | mut | context + `VerifyExtractionRequestSchema` (exactly one `captureId`) | `verifyExtraction` |
| `verify_citations` | mut | context + `VerifyClaimsRequestSchema` | `verifyClaims` |
| `verify_report` | mut | context + `VerifyReportRequestSchema` | `verifyReport` |
| `verify_metric` | mut | context + `VerifyMetricObservationRequestSchema` | `verifyMetricObservation` |
| `verify_adjudication_request` | mut | context + `RequestAdjudicationRequestSchema` | `requestAdjudication` |
| `verify_adjudication_decision` | mut | context + `VerificationAdjudicationDecisionRequestSchema` | `recordAdjudicationDecision` |
| `verify_bundle_inspect` | mut | context + `InspectAuditBundleRequestSchema` | `inspectAuditBundle` |
| `verify_bundle_replay` | mut | context + `ReplayRunRequestSchema` | `replayVerificationRun` |
| `verify_benchmark_run` | mut | context + `RunBenchmarkRequestSchema` | `runBenchmark` |
| `verify_benchmark_compare` | mut | context + `CompareBenchmarkRunsRequestSchema` | `compareBenchmarkRuns` |
| `verify_reconciliation_apply` | mut | context, `operationId`, `providerAttemptId`, `artifact` | `applyProviderReconciliation` |
| `verify_reconciliation_show` | read | context, `operationId`, `providerAttemptId` | `getProviderReconciliation` |
| `verify_extraction_show` | read | context, `operationId` | `getStructuredExtraction` |
| `verify_bundle_show` | read | context, `operationId` | `getAuditInspection` |
| `verify_claims_result` | read | context, `operationId` | `getVerificationClaimsResult` |
| `verify_report_result` | read | context, `operationId` | `getVerificationReportResult` |
| `verify_adjudication_get` | read | context, `operationId` | `getAdjudicationSubject` |
| `verify_adjudication_get_decision` | read | context, `operationId` | `getAdjudicationDecision` |
| `verify_benchmark_show` | read | context, `runId` | `getBenchmarkRun` |
| `verify_benchmark_manifest` | read | context, `runId` | `getBenchmarkRunManifest` |
| `verify_benchmark_comparison` | read | context, `comparisonId` | `getBenchmarkComparison` |
| `verify_cases` | read | context, `runId`, optional `pageSize`, `cursor` | `listVerificationRunCases` |
| `verify_case` | read | context, `caseRunId` | `getVerificationCase` |
| `verify_evidence` | read | context, `evidenceId` | `getVerificationEvidence` |
| `verify_run` | read | context, `runId` | `getVerificationRun` |
| `verify_manifest` | read | context, `runId` | `getVerificationRunManifest` |
| `verify_status` | read | context `{tenantId,correlationId}`, `operationId` | `getVerificationOperation` |

Spec names `knowledge_extract_structured` and `knowledge_inspect_run` are **not** registered. Spec `knowledge_get_operation` maps to `verify_status`. There is no capture-show tool. Requires `knowledge.read`; missing API client → `CAPABILITY_NOT_ADMITTED`. Returns operation status (state, kind, receiptIds); read the kind-specific terminal result once `state` is `succeeded`.

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
