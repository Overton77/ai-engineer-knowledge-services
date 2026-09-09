---
name: knowledge-verification
description: >-
  Runs admitted Knowledge Verification operations through the knowledge CLI and
  knowledge_verify_* MCP tools. Use when verifying claims, verifying citations,
  checking source attribution, verifying extraction, verifying a report, running
  an extraction benchmark, replaying a verification run, inspecting an audit
  bundle, requesting or recording adjudication, using the knowledge verification
  CLI, or running the diagnostics-companies demo.
license: Proprietary
metadata:
  version: "1.0.0"
  contract: "verification.v1"
---

# Knowledge verification

Admitted verification of extractions, claims (citations / source attribution), reports, benchmarks, replays, audit bundles, and adjudication. Surfaces are the `knowledge` CLI and bounded MCP tools. Contract: `verification.v1`. Skills contain operational instructions, not verifier algorithms.

## When to use

- A registered artifact handle and capture set must be verified, replayed, benchmarked, or sent to human review.
- The user names verify claims, verify citations, source attribution, verify extraction, verify report, replay verification run, audit bundle, adjudication, the knowledge verification CLI, `knowledge_verify_*` MCP tools, or the diagnostics-companies demo.

## Which verification surface

Two CLIs exist. Pick by where you are running:

| You are… | Use | Skill |
|---|---|---|
| A research agent producing a verified report (capture → quote → intent → judge → policy → seal), typically inside a sandbox with `VERIFY_EXECUTOR_URL` set | `knowledge-verify` (verification executor) | [`apps/verification-executor/skills/knowledge-verify/SKILL.md`](../../apps/verification-executor/skills/knowledge-verify/SKILL.md) |
| An operator or orchestration agent calling the admitted platform API with tenant/mission ownership context (`knowledge verify …`, `knowledge_verify_*` MCP) | `knowledge` CLI / MCP | this skill |

Do not mix them in one run: the executor writes its own run receipts and store; the platform API writes to Postgres via operations. If `knowledge-verify --help` works and `KNOWLEDGE_API_URL` is unset, you are on the executor surface.

## When not to use

- Retrieval, evaluation, publication, or vector-store work (other skills).
- Live provider SDK calls, raw SQL, secret reads, or unsigned local grading presented as admitted verification.
- Inventing locators from display excerpts, or treating the offline demo as a sealed production benchmark.

## Non-negotiable rules

- Never treat display excerpts as selectors.
- Never retry with the producer deployment.
- Never call provider SDKs directly for admitted verification.
- Never fabricate artifact IDs, receipts, or human labels.
- `completed` + `review_required` is a held result, not a failure.
- Exit `0` admitted, `1` completed quality failure, `2` infrastructure/config/auth.
- Deterministic failures cannot be overridden by semantic judges.
- MCP/CLI cannot grant capabilities.

## Preflight

Env: `KNOWLEDGE_API_URL` (or CLI `--base-url`), `KNOWLEDGE_API_TOKEN`. MCP also needs `POSTGRES_URL` and bearer identities from `KNOWLEDGE_API_IDENTITIES` (server-side; do not print secrets).

CLI `--context` is full `OperationContextSchema` (`packages/contracts/src/identity.ts`): required `tenantId`, `operationId`, `attemptId`, `correlationId`, `actor`, `capabilityVersion`, `idempotencyKey` (8–255), `reason`, `contractVersion` (`v1`). Schema-optional: `projectId`, `missionId`, `workItemId`, `causationId`, `externalExecution`.

MCP mutation `context` is slimmer: `tenantId`, `correlationId`, `idempotencyKey`, plus schema-optional hints `attemptId`, `workItemId`, `missionId`, `causationId`, `externalExecution`. MCP reads need only `tenantId` and `correlationId`.

Against an API configured with `VERIFICATION_SERVICE_OWNERSHIP_GRANTS_JSON` (the production path; required whenever `VERIFICATION_CLAIMS_ENABLED=1`), CLI `--context` / MCP `context` must carry `attemptId` + `missionId` + `workItemId` that match an ownership grant (tenant, bearer actor, mission) and existing `orchestration.attempt` / `work_item` / `mission` rows with the grant's `agentDeploymentId`. The client sends those IDs as `x-verification-attempt-id`, `x-verification-work-item-id`, `x-verification-mission-id`. Otherwise **403** `"Verification operation ownership denied"`. In legacy static mode (`VERIFICATION_SERVICE_ATTEMPT_ID` without grants), `attemptId` must equal that server value.

`--input` is the public request body (`verificationContractVersion` always `"verification.v1"`). Artifact inputs are `{artifactId, digest}` where `digest` is `sha256:` + 64 hex.

Accepted mutation stdout is `AcceptedOperationSchema` (`operationId`, `state:"queued"`, `contractVersion`, `statusUrl`, `eventStreamUrl`, `cancellationUrl`, `retryUrl`, `reconcileUrl`) — no artifact IDs. Obtain artifact handles from the family terminal read after the operation succeeds. Capture terminal is HTTP `GET /v1/verification/captures/:operationId` only — no CLI/MCP capture-show tool. Do not invent handles.

Admitted capture shapes (application; Zod is wider): `sourceKind:"web_page"` requires exactly `requestedProjectionKinds:["html_dom"]`; only `mode:"acquire"` + `sourceKind:"pdf"` may use `["pdf_text","geometry"]`. Other combinations → `VERIFICATION_CAPTURE_MODE_NOT_ADMITTED`.

Generic CLI: `knowledge <group> <action> --context '<json>' --input '<json>' [--base-url] [--timeout-ms] [--wait] [--human]`. Invocation details: [cli-reference.md](cli-reference.md). MCP tools: [mcp-reference.md](mcp-reference.md). Bodies: [examples.md](examples.md).

### Wait and poll

- `--wait` is verification_mutation only. It polls `getVerificationOperation`. Handled kinds (`WAITABLE_VERIFICATION_RECEIPTS`): `verification_capture`, `verification_extraction`, `verification_replay`, `verification_metric`, `verification_benchmark`, `verification_benchmark_compare`, `verification_claims`, `verification_report`.
- `--wait` does **not** handle `verification_parse_artifact`, `verification_adjudication`, `verification_adjudication_decision`, `verification_audit_bundle`, `verification_structured_extraction` (throws a message that starts with `VERIFICATION_WAIT_UNSUPPORTED_KIND:<kind>` → exit `2`).
- Prefer `knowledge verify status --input '{"operationId":"<uuid>"}'` (`getVerificationOperation`) over `operation status`. Then the family terminal read. `--wait` completion is a compact projection, not the authoritative result.
- MCP: `knowledge_get_verification_operation` (spec §19 `knowledge_get_operation`), then the family `knowledge_get_*` tool.

`--wait` maps `needs_review` and claims/report `held_for_review` to exit `1`. Treat `held_for_review` / `needs_review` / `review_required` as held: escalate to adjudication; do not retry or override.

## verify-extraction

**Applies when** a structured extraction output must be mechanically verified against registered captures and an extraction schema.

**Inputs.** `VerifyExtractionRequestSchema`: `verificationContractVersion`, `captureIds` (exactly one `captureId`), `extractionSchema`, `extractionOutput`. Extra capture IDs → `VERIFICATION_EXTRACTION_SINGLE_CAPTURE_REQUIRED`.

**CLI.** `knowledge verify extract --context '<OperationContext>' --input '<VerifyExtractionRequest>' --wait`

**MCP.** `knowledge_verify_extraction` `{context, request}`.

**Wait.** `--wait` is admitted (`verification_extraction`). Or `verify status` then there is no extract-result CLI; use receipt/`getVerificationOperation`. MCP: no dedicated extract-verify read tool.

**Interpret.** `0` / `valid===true`: admitted. `1` / `valid===false` or `needs_review`: completed quality failure or held review. `2`: timeout, failed/cancelled/quarantined, missing receipt, auth/config.

**Escalate.** Held review → `adjudication request`. Do not treat excerpts as selectors. Register only service-issued artifact handles.

## verify-source-attribution

**Applies when** claims/citations/source attribution must be verified (`verify citations` / `knowledge_verify_claims`).

**Inputs.** `VerifyClaimsRequestSchema`: `verificationContractVersion`, `captureIds`, `assertions` artifact.

**CLI.** `knowledge verify citations --context '<OperationContext>' --input '<VerifyClaimsRequest>' --wait`

**MCP.** `knowledge_verify_claims` `{context, request}`.

**Wait.** `--wait` admitted (`verification_claims`). Completion `{operationId,state,claims:{runId,manifestDigest,policyOutcome,mechanicalStatus,disposition},receiptId,exitCode}` is not authoritative. Or `verify status`, then `knowledge verify claims-result --input '{"operationId":"<uuid>"}'`. MCP: `knowledge_get_verification_operation` then `knowledge_get_verification_claims_result`.

**Interpret.** `--wait` `disposition` `admitted` (exit `0`): `mechanicalStatus==="passed"` and `policyOutcome` `pass` / `pass_with_warnings`. `held_for_review` (exit `1`): review/abstain policy or `review_required` mechanics — escalate, never retry or override. `quality_failed` (exit `1`). Authoritative result is the signed `claims-result` read. Submit/auth errors: infrastructure (`2`). Deterministic failures stay failed.

**Escalate.** `adjudication request` with reason `ambiguous_evidence`, `conflicting_evidence`, `policy_review`, `quality_failure`, or `appeal`. Never override deterministic findings with a judge.

## verify-report

**Applies when** a report plus claim ledger must be verified (report-wide gates).

**Inputs.** `VerifyReportRequestSchema`: `verificationContractVersion`, `report`, `claimLedger`, `captureIds`.

**CLI.** `knowledge verify report --context '<OperationContext>' --input '<VerifyReportRequest>' --wait`

**MCP.** `knowledge_verify_report` `{context, request}`.

**Wait.** `--wait` admitted (`verification_report`). Completion uses `report` instead of `claims` and is not authoritative. Or `verify status`, then `knowledge verify report-result --input '{"operationId":"<uuid>"}'`. MCP: `knowledge_get_verification_operation` then `knowledge_get_verification_report_result`.

**Interpret.** Same lattice as claims (`admitted` / `held_for_review` / `quality_failed`). Report-wide mechanical gates are deterministic. Authoritative result is the signed `report-result` read.

**Escalate.** Same as claims. Do not retry on the producer deployment.

## run-extraction-benchmark

**Applies when** a sealed offline benchmark must run (`executionMode` is only `offline_recorded`).

**Inputs.** `RunBenchmarkRequestSchema`: `verificationContractVersion`, `dataset`, `experimentDefinition`, `executionMode: "offline_recorded"`.

**CLI.** `knowledge benchmark run --context '<OperationContext>' --input '<RunBenchmarkRequest>' --wait`

**MCP.** `knowledge_run_benchmark` `{context, request}`.

**Wait.** `--wait` admitted (`verification_benchmark`): exit `0` on success receipt. Compare: `knowledge benchmark compare` / `knowledge_compare_benchmark_runs`; `--wait` exit `1` if `engineeringGateOutcome==="fail"`. Reads: `benchmark show|manifest|comparison`. MCP: `knowledge_get_benchmark_run`, `knowledge_get_benchmark_manifest`, `knowledge_get_benchmark_comparison`.

**Interpret.** `0`: admitted run. `1`: comparison engineering gate fail. `2`: infrastructure. Offline demo is **not** this workflow.

**Escalate.** Incomplete recorded outputs or missing human gold → abstain; do not claim production quality. Request adjudication on contested cases.

## replay-verification-run

**Applies when** a prior run must be recomputed from registered artifacts.

**Inputs.** `ReplayRunRequestSchema`: `verificationContractVersion`, `runId`, `replayMode` `deterministic_only` | `recorded_provider_outputs`.

**CLI.** `knowledge bundle replay --context '<OperationContext>' --input '<ReplayRunRequest>' --wait`

**MCP.** `knowledge_replay_run` `{context, request}`.

**Wait.** `--wait` admitted (`verification_replay`). Then `knowledge verify run|manifest --input '{"runId":"<id>"}'`. Audit inspect is separate: `knowledge bundle inspect` / `knowledge_inspect_audit_bundle` (no `--wait`); read `bundle show` / `knowledge_get_audit_inspection`.

**Interpret.** Replay must match sealed deterministic results. Divergence is a quality or integrity failure, not a license to change the original verdict.

**Escalate.** Integrity mismatch → stop; inspect audit bundle; do not re-run with the producer deployment or live SDKs.

## adjudicate-verification

**Applies when** a completed verification is held (`review` / `review_required`) or a human must record a packet-bound decision.

**Inputs.** Request: `RequestAdjudicationRequestSchema` (`target` kind `assertion`|`evidence`|`run`, `reason`, `evidencePacket`, optional `requesterNote`). Decision: `VerificationAdjudicationDecisionRequestSchema` (`subjectId`, `packetArtifact`, `decision` `affirm`|`reject`|`defer`, `rationale`). Decision HTTP accepts actor `human`, or `service` with `serviceIdentity: human_reviewer`; never `model`. Model agents request only; they do not record decisions.

**CLI.** `knowledge adjudication request --context '...' --input '<RequestAdjudicationRequest>'`  
`knowledge adjudication decision --context '...' --input '<VerificationAdjudicationDecisionRequest>'`  
Reads: `adjudication get` / `adjudication get-decision` with `{operationId}`.

**MCP.** `knowledge_request_adjudication`, `knowledge_record_adjudication_decision`, `knowledge_get_adjudication`, `knowledge_get_adjudication_decision`.

**Wait.** No `--wait` (unhandled). Poll `verify status` / `knowledge_get_verification_operation`, then the get command/tool.

**Interpret.** Request output is `pending_human_adjudication`. Decision records review only (`admissionChanged` is always `false`). Quorum uses distinct `human_origin` `affirm` only.

**Escalate.** Defer or missing quorum stays held. Never fabricate a human label. Never use a decision to override a deterministic failure.

## Offline demo

Local frozen pack; no HTTP token, no provider authority, no human gold.

```text
knowledge demo diagnostics-companies --dataset diagnostics-companies-v1 --output <dir>
```

Optional `--open` (TTY only). Run the **built** CLI so `dist/demo-assets/` exists (see [cli-reference.md](cli-reference.md)).

Exit: `0` `quality_gate_passed`; `1` `quality_gate_failed`; `2` `verification_incomplete` / `unavailable` (expected until human labels and a sealed benchmark exist) or catch (`DEMO_ERROR`). Status `verification_incomplete` is not admitted verification.

## References

- [cli-reference.md](cli-reference.md)
- [mcp-reference.md](mcp-reference.md)
- [examples.md](examples.md)
