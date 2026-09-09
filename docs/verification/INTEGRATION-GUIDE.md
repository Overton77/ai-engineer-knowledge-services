# Verification integration guide

For Mission Control, Eve, Cursor Cloud agents, dashboards, and other services. Call HTTP, CLI, or MCP. Do not import `@aiengineer/knowledge-verification`. Do not call provider SDKs from agents.

## Operation envelope

The durable HTTP envelope is **not** a caller-supplied `OperationContext` body. The API authenticates the bearer, reads `x-tenant-id`, and builds a trusted `OperationContext` from ownership grants plus optional hints.

### `OperationContextSchema` (CLI `--context`, generic operations)

Required: `tenantId`, `operationId`, `attemptId`, `correlationId`, `actor`, `capabilityVersion`, `idempotencyKey`, `reason`, `contractVersion`. Schema-optional: `projectId`, `workItemId`, `missionId`, `causationId`, `externalExecution`.

CLI generic commands parse this full schema even though verification HTTP mutations send only tenant, correlation, idempotency, and hints as headers (`x-verification-attempt-id`, `x-verification-work-item-id`, `x-verification-mission-id`, `x-causation-id`, `x-external-*`).

### `VerificationOperationContextHintsSchema` (HTTP hint headers)

Schema-optional: `attemptId`, `workItemId`, `missionId`, `causationId`, `externalExecution`.

Against an API configured with `VERIFICATION_SERVICE_OWNERSHIP_GRANTS_JSON` (the production path; required whenever `VERIFICATION_CLAIMS_ENABLED=1`), CLI `--context` / MCP `context` / these hint headers must carry `attemptId` + `missionId` + `workItemId` that match an ownership grant (tenant, bearer actor, mission) and existing `orchestration.attempt` / `work_item` / `mission` rows with the grant's `agentDeploymentId`. Otherwise **403** `"Verification operation ownership denied"`. In legacy static mode (`VERIFICATION_SERVICE_ATTEMPT_ID` without grants), `attemptId` must equal that server value.

`externalExecution`: `runtime` (`eve` | `vercel_workflow` | `mission_control` | `other`), `runId`, optional `rootRunId`, `sessionId`, `turnId`, `toolCallId`.

Typed client context (`VerificationClientContext`): `tenantId`, `correlationId`, `idempotencyKey`, plus the same hint fields. On the production ownership path those three IDs are required even though the schema marks them optional.

## Headers

| Header | Role |
| --- | --- |
| `Authorization: Bearer <token>` | Identity from `KNOWLEDGE_API_IDENTITIES` (or deployed resolver) |
| `x-tenant-id` | Tenant UUID (required except profile capture) |
| `x-correlation-id` | Correlation string; API may assign one if absent |
| `Idempotency-Key` | Mutations only; trim length 8–255 |
| `x-verification-attempt-id` | Hint `attemptId` |
| `x-verification-work-item-id` | Hint `workItemId` |
| `x-verification-mission-id` | Hint `missionId` |
| `x-causation-id` | Hint `causationId` |
| `x-external-runtime` | `externalExecution.runtime` |
| `x-external-run-id` | `externalExecution.runId` |
| `x-external-root-run-id` | optional |
| `x-external-session-id` | optional |
| `x-external-turn-id` | optional |
| `x-external-tool-call-id` | optional |

Profile capture (`POST /v1/verification/benchmark-capture-profiles/:profileName/captures`) sends Bearer + `x-correlation-id` + `Idempotency-Key` only. No caller ownership headers.

## 202 receipt and polling

Mutations return **202** `AcceptedOperationSchema`:

Receipt `statusUrl` / `eventStreamUrl` / `cancellationUrl` / `retryUrl` / `reconcileUrl` are built as `/v1/operations/{id}` (and `:cancel` / `:retry` / `:reconcile`). Example:

```json
{
  "operationId": "00000000-0000-4000-8000-000000000009",
  "state": "queued",
  "contractVersion": "v1",
  "statusUrl": "https://knowledge.example/v1/operations/00000000-0000-4000-8000-000000000009",
  "eventStreamUrl": "https://knowledge.example/v1/operations/00000000-0000-4000-8000-000000000009/events",
  "cancellationUrl": "https://knowledge.example/v1/operations/00000000-0000-4000-8000-000000000009:cancel",
  "retryUrl": "https://knowledge.example/v1/operations/00000000-0000-4000-8000-000000000009:retry",
  "reconcileUrl": "https://knowledge.example/v1/operations/00000000-0000-4000-8000-000000000009:reconcile"
}
```

1. Poll `GET /v1/verification/operations/{id}` (`knowledge.read`) — or the receipt `statusUrl` `GET /v1/operations/{id}` — until a terminal state: `succeeded`, `needs_review`, `failed`, `cancelled`, `quarantined`. Prefer the verification-aware route. CLI: `knowledge verify status --input '{"operationId":"<uuid>"}'` (`getVerificationOperation`). MCP: `knowledge_get_verification_operation` `{context:{tenantId,correlationId},operationId}` (spec §19 `knowledge_get_operation`). `knowledge operation status` calls generic `GET /v1/operations/{id}`.
2. Then GET the family terminal resource (`/v1/verification/claims/{id}`, `/reports/{id}`, `/captures/{id}`, `/extractions/{id}`, `/adjudications/{id}`, `/audit-inspections/{id}`, …).

KS operation `state` values: `queued` | `running` | `needs_review` | `quarantined` | `succeeded` | `failed` | `cancelled`.

## Typed client (`@aiengineer/knowledge-client`)

Verification methods used by `CliKnowledgeClient` / MCP:

| Method | Kind |
| --- | --- |
| `captureVerificationSource` | mut |
| `captureVerificationSourceWithProfile` | mut (no tenant header) |
| `parseArtifact` | mut |
| `extractStructuredData` | mut |
| `verifyExtraction` | mut |
| `verifyClaims` | mut |
| `verifyReport` | mut |
| `verifyMetricObservation` | mut |
| `runBenchmark` | mut |
| `compareBenchmarkRuns` | mut |
| `replayVerificationRun` | mut |
| `inspectAuditBundle` | mut |
| `requestAdjudication` | mut |
| `recordAdjudicationDecision` | mut |
| `applyProviderReconciliation` | mut |
| `applySemanticProviderReconciliation` | mut |
| `getVerificationOperation` | read |
| `getVerificationClaimsResult` | read |
| `getVerificationReportResult` | read |
| `getVerificationCaptureResult` | read |
| `getStructuredExtraction` | read |
| `getAuditInspection` | read |
| `getAdjudicationSubject` | read |
| `getAdjudicationDecision` | read |
| `getBenchmarkRun` / `getBenchmarkRunManifest` | read |
| `getBenchmarkComparison` | read |
| `getVerificationRun` / `getVerificationRunManifest` | read |
| `listVerificationRunCases` / `getVerificationCase` / `getVerificationEvidence` | read |
| `getProviderReconciliation` / `getSemanticProviderReconciliation` | read |
| `retryOperation` / `reconcileOperation` | control |

`KnowledgeClientError` wraps problem details when `response.ok` is false.

## Failure taxonomy

| Layer | Meaning |
| --- | --- |
| Execution `succeeded` | Worker finished. Inspect terminal resource for policy/quality. |
| Execution `needs_review` | Held for review. CLI `--wait` exit **1**. Escalate to adjudication; do not retry or override. |
| MC `completed` + `review_required` | Successful execution with a held result. Not an infrastructure failure. |
| Claims/report `--wait` `admitted` | `mechanicalStatus==="passed"` and `policyOutcome` `pass` / `pass_with_warnings`. Exit **0**. Compact projection only; signed terminal read is authoritative. |
| Claims/report `--wait` `held_for_review` | Review/abstain policy or `review_required` mechanics. Exit **1**. Escalate to adjudication; do not retry or override. |
| Claims/report `--wait` `quality_failed` | Mechanical `failed` or policy `fail`. Exit **1**. |
| `CAPABILITY_NOT_ADMITTED` **503** | Flag/JSON/service missing. Do not treat as a quality fail. |
| Quality fail | Terminal `valid === false`, comparison `engineeringGateOutcome === "fail"`, policy `fail`. CLI `--wait` exit **1**. |
| Infrastructure | Timeout, `failed` / `cancelled` / `quarantined`, missing receipt, unhandled `--wait` kind (`VERIFICATION_WAIT_UNSUPPORTED_KIND`), transport error. CLI exit **2**. |
| `FORBIDDEN` **403** | Ownership, projection grant, or reviewer identity denied. |
| `INVALID_CONTRACT` **400** | Missing/short `Idempotency-Key` or schema mismatch. |

Provider errors, harness failures, quality failures, and policy rejection are distinct (`OperationFailureSummary.category`, `qualityFailure`).

## Request examples

Shapes checked against Zod in `packages/contracts/src/verification/requests.ts`. Only fields that exist are shown.

### Registered capture (`CaptureSourceRequestSchema`)

```json
{
  "verificationContractVersion": "verification.v1",
  "source": {
    "mode": "register",
    "sourceKind": "web_page",
    "sourceId": "capture-1",
    "contentArtifact": {
      "artifactId": "00000000-0000-4000-8000-000000000011",
      "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }
  },
  "requestedProjectionKinds": ["html_dom"]
}
```

`mode: "acquire"` uses `sourceKind` + credential-free `sourceUri` instead of `sourceId`/`contentArtifact`. Zod allows 1–4 unique values from `native_text`, `canonical_json`, `html_dom`, `pdf_text`, `geometry`, `ocr_geometry`, `table_grid`, `transcript`. The application admits only two shapes: `sourceKind:"web_page"` with exactly `["html_dom"]`, or `mode:"acquire"` + `sourceKind:"pdf"` with exactly `["pdf_text","geometry"]`. Other combinations → `VERIFICATION_CAPTURE_MODE_NOT_ADMITTED`.

### Verify claims (`VerifyClaimsRequestSchema`)

```json
{
  "verificationContractVersion": "verification.v1",
  "captureIds": ["capture-1"],
  "assertions": {
    "artifactId": "00000000-0000-4000-8000-000000000012",
    "digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  }
}
```

`captureIds`: unique, length 1–100. Digests are `sha256:` + 64 hex.

### Replay (`ReplayRunRequestSchema`)

```json
{
  "verificationContractVersion": "verification.v1",
  "runId": "00000000-0000-4000-8000-000000000013",
  "replayMode": "deterministic_only"
}
```

`replayMode` is `deterministic_only` or `recorded_provider_outputs`. HTTP path `runId` must equal the body.

## Integration lanes

### Mission Control

Capability dispatch adapter: `../ai-engineer-mission-control/apps/api/src/verification-temporal.ts` and `verificationWorkflow`. Launch uses `REJECT_DUPLICATE`. The future parent mission/node workflow replaces harness-seeded orchestration rows. Do not copy verification algorithms into MC.

Keep execution state separate from admission disposition. Dashboard configuration: `../ai-engineer-mission-control/docs/VERIFICATION-CPH-RECEIPTS.md`. Drift operations: `../ai-engineer-mission-control/docs/VERIFICATION-DRIFT-OPERATIONS.md`.

Propagate `missionId`, `workItemId`, `attemptId`, and `externalExecution` (`runtime: "mission_control"`) as hint headers.

### Eve signed runtime bridge

Spec §21. The model-facing tool receives only the admitted verification request and artifact references. It never receives a tenant, routing IDs, grant selection, key ID, or signing capability.

| Env | Owner | Role |
| --- | --- | --- |
| `VERIFICATION_EVE_RUNTIME_ATTESTATION_KEYS_JSON` | KS API | Public Ed25519 keys `{issuer,keyId,publicKeyPem}` |
| `VERIFICATION_SERVICE_OWNERSHIP_GRANTS_JSON` | KS API | Grant with `eveRuntimeAuthority` `{grantId,issuer,keyIds}` |
| `EVE_VERIFICATION_GRANTS_JSON` | Eve host | Fixed catalog; each grant has `runtimeAttestation` `{issuer,keyId,agentDeploymentId}` |
| `EVE_VERIFICATION_SIGNING_PRIVATE_KEY_PEM` | Eve host | Used only immediately before authenticated HTTP submit; never logged, persisted, or given to the model |

KS retains public keys only. Host-issued idempotency key and correlation ID are stable for a retry. Correlation form in the spec: `eve-verification:<operationId>`. Use cases on the attestation contract: `verifyClaims`, `verifyReport`. This bridge conveys authenticated runtime lineage only. It does not admit policy outcomes or grant human authority.

### Cursor Cloud

CLI or HTTP only. Propagate mission / work-item / attempt IDs as hints. Never call provider SDKs from the agent. Never copy KS algorithms into the cloud skill. Skills should invoke `knowledge` or the typed client against the live API.

### Dashboard

Reads and controls go through supported MC/KS HTTP only. No direct database mutation. No generic verification promotion/suspension durable command yet.

## See also

- [SURFACE-REFERENCE.md](SURFACE-REFERENCE.md) — routes, CLI, MCP, worker
- [OPERATOR-RUNBOOK.md](OPERATOR-RUNBOOK.md) — local profiles and CLI flows
- [README.md](README.md) — acceptance state
