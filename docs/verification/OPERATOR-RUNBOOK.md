# Verification operator runbook

Practical local procedures. Commands below exist in this repository. On Windows Git Bash, `corepack` may not be on `PATH`; use `corepack.cmd` in place of `corepack`.

## Prerequisites

- Node.js **>= 24** (`package.json` `engines.node`)
- pnpm **10.34.5** via Corepack (`packageManager`)
- Docker, for the verification parser image (`services/verification-parser`)
- Local Postgres / Supabase (`POSTGRES_URL`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`)
- Do not load the Knowledge Services `.env` file for local proofs. Export only the vars a profile needs. Never print grants, PEMs, or tokens.

## Build and verify

```bash
corepack pnpm install
corepack pnpm verify
```

`verify` is `corepack pnpm typecheck && corepack pnpm test && corepack pnpm build` (each step is Turbo). Equivalent:

```bash
corepack pnpm exec turbo run typecheck test build
```

Serial (avoids host contention):

```bash
corepack pnpm exec turbo run typecheck test build --concurrency=1
```

The testkit file `packages/testkit/src/broad-evaluation-corpus.test.ts` has a p95-latency hard gate that is a known **wall-clock flake under parallel load**. It is unrelated to verification. It passes in isolation:

```bash
corepack pnpm --filter @aiengineer/knowledge-testkit exec vitest run src/broad-evaluation-corpus.test.ts
```

See `docs/workspaces/verification-module/swarm-plan-20260906/SW-00-FULL-VERIFY-REGRESSION.md`.

Package-only verification algorithms:

```bash
corepack pnpm --filter @aiengineer/knowledge-verification typecheck
corepack pnpm --filter @aiengineer/knowledge-verification test
corepack pnpm --filter @aiengineer/knowledge-verification build
```

## CLI invocation

Bin name: `knowledge` (`apps/cli/package.json`).

In-repo from source (passes args after `--` to `tsx src/index.ts`):

```bash
corepack pnpm --filter @aiengineer/knowledge-cli dev -- <group> <action> ...
```

After `build`:

```bash
corepack pnpm --filter @aiengineer/knowledge-cli exec node dist/index.js <group> <action> ...
```

Generic HTTP commands need `KNOWLEDGE_API_URL` or `--base-url`, and `KNOWLEDGE_API_TOKEN`. `--context` must be JSON that parses as `OperationContextSchema` (full envelope: `tenantId`, `operationId`, `attemptId`, `correlationId`, `actor`, `capabilityVersion`, `idempotencyKey`, `reason`, `contractVersion`). The API ignores caller-supplied actor/operation identity and builds a trusted context from the bearer and ownership grants.

Examples below use `knowledge` as the bin; substitute the in-repo form above.

## Start API, worker, MCP

```bash
corepack pnpm dev:api
corepack pnpm dev:worker
corepack pnpm dev:mcp
```

These are `tsx watch src/index.ts` for `@aiengineer/knowledge-api`, `@aiengineer/knowledge-worker`, and `@aiengineer/knowledge-mcp`. They read `process.env` only (no `--env-file`).

- API default `HOST=127.0.0.1`, `PORT=4100`
- MCP default `PORT` fallback **4101**
- Worker loop: `WORKER_TENANT_ID`, `WORKER_ID`, `WORKER_POLL_MS`, `WORKER_LEASE_MS`, `KNOWLEDGE_PERSISTENCE_MODE`

Shared non-verification deps for durable surfaces: `POSTGRES_URL`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `KNOWLEDGE_API_IDENTITIES`, `KNOWLEDGE_API_URL`. Optional `CANONICAL_LOCAL_ONLY=1` for loopback Postgres.

Parser image (required when any verification worker block is on):

```bash
docker build -t aiengineer-verification-parser:v1 services/verification-parser
docker image inspect --format '{{.Id}}' aiengineer-verification-parser:v1
```

Set `VERIFICATION_PARSER_IMAGE_DIGEST` to that immutable `sha256:`+64hex id, not the mutable tag. `VERIFICATION_PARSER_COMMAND` defaults to `docker`.

## Ownership grants

`VERIFICATION_SERVICE_OWNERSHIP_GRANTS_JSON` is the production path (required whenever `VERIFICATION_CLAIMS_ENABLED=1`). Full shape, uniqueness rule, and rollout order: [DEPLOYMENT.md](DEPLOYMENT.md#ownership-grants).

Array of **1–256** grants `{tenantId, actor, missionId, agentDeploymentId, capabilityVersion, externalExecution?, eveRuntimeAuthority?}`. Unique on `tenantId:actor.kind:actor.id:missionId`. `externalExecution` and `eveRuntimeAuthority` are mutually exclusive.

```json
[
  {
    "tenantId": "00000000-0000-4000-8000-000000000001",
    "actor": {
      "kind": "service",
      "id": "00000000-0000-4000-8000-000000000004",
      "serviceIdentity": "knowledge_api"
    },
    "missionId": "00000000-0000-4000-8000-000000000005",
    "agentDeploymentId": "your-registered-deployment",
    "capabilityVersion": "verification-service.v1"
  }
]
```

Seed `orchestration.mission` / `work_item` / `attempt` rows for the caller's `agentDeploymentId` **before** starting the API. Mutations must send `attemptId` + `missionId` + `workItemId` that match a grant and those rows; otherwise **403** `"Verification operation ownership denied"`.

## Configuration profiles

Flags default to `0` (off). Empty JSON leaves the kind unregistered. Grouped vars below are the exact names from inventory §7.

### (a) Read-only inspection

Reads flags + public keys. API only; worker not required.


| Var                                                        | Notes                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------ |
| `VERIFICATION_SERVICE_OWNERSHIP_GRANTS_JSON`               | grant array; see [Ownership grants](#ownership-grants) |
| `VERIFICATION_READS_ENABLED`                               | `1` for run/case/evidence GET                          |
| `VERIFICATION_CAPTURE_READS_ENABLED`                       | `1` for capture GET                                    |
| `VERIFICATION_AUDIT_INSPECTION_READS_ENABLED`              | `1` for inspect GET                                    |
| `VERIFICATION_CLAIMS_REPORT_READ_PUBLIC_KEYS_JSON`         | JSON keys                                              |
| `VERIFICATION_BENCHMARK_READ_PUBLIC_KEYS_JSON`             | JSON keys                                              |
| `VERIFICATION_BENCHMARK_COMPARISON_READ_PUBLIC_KEYS_JSON`  | JSON keys                                              |
| `VERIFICATION_STRUCTURED_EXTRACTION_READ_PUBLIC_KEYS_JSON` | JSON keys                                              |
| `VERIFICATION_ADJUDICATION_GRANTS_JSON`                    | trio, all-or-nothing, for adjudication GET             |
| `VERIFICATION_ADJUDICATION_REVIEW_REQUIREMENTS_JSON`       | trio                                                   |
| `VERIFICATION_ADJUDICATION_PUBLIC_KEYS_JSON`               | trio                                                   |
| `VERIFICATION_ADJUDICATION_DECISIONS_ENABLED`              | `1` for decision GET                                   |
| `VERIFICATION_ADJUDICATION_TIMEOUT_MS`                     | optional int, default 30000                            |


Plus `POSTGRES_URL`, `SUPABASE_`*, `KNOWLEDGE_API_IDENTITIES`.

Smoke: `GET /health` is always `{ "status": "ok" }`. A capability-off probe is any enabled-flag GET, e.g. `GET /v1/verification/runs/:runId` returns **503** `CAPABILITY_NOT_ADMITTED` (`"Verification reads unavailable"`) when `VERIFICATION_READS_ENABLED` is not `1`.

### (b) Capture / parse / extraction verification

Catalog + parser image + ownership grants.


| Var                                                          | Process     | Notes                                                  |
| ------------------------------------------------------------ | ----------- | ------------------------------------------------------ |
| `VERIFICATION_SERVICE_OWNERSHIP_GRANTS_JSON`                 | api         | grant array; see [Ownership grants](#ownership-grants) |
| `VERIFICATION_SERVICE_CATALOG_JSON`                          | api, worker | JSON catalog                                           |
| `VERIFICATION_PARSER_IMAGE_DIGEST`                           | api, worker | `sha256:`+64hex                                        |
| `VERIFICATION_PARSER_COMMAND`                                | worker      | default `docker`                                       |
| `VERIFICATION_STORAGE_BUCKET`                                | api, worker | default `ai-engineer-cloud-bucket`                     |
| `VERIFICATION_CAPTURE_ACQUIRE_ENABLED`                       | api, worker | `0`/`1`                                                |
| `VERIFICATION_SOURCE_ACQUISITION_GRANTS_JSON`                | worker      | required if acquire=`1`                                |
| `VERIFICATION_CAPTURE_READS_ENABLED`                         | api         | `1` to read terminals                                  |
| `VERIFICATION_PARSE_ARTIFACT_ENABLED`                        | api, worker | `0`/`1`                                                |
| `VERIFICATION_STRUCTURED_EXTRACTION_CONFIG_JSON`             | api, worker | JSON                                                   |
| `VERIFICATION_STRUCTURED_EXTRACTION_SIGNING_KEY_ID`          | worker      | required if config set                                 |
| `VERIFICATION_STRUCTURED_EXTRACTION_SIGNING_PRIVATE_KEY_PEM` | worker      | PEM                                                    |
| `VERIFICATION_STRUCTURED_EXTRACTION_READ_PUBLIC_KEYS_JSON`   | api         | JSON keys                                              |
| `AI_GATEWAY_API_KEY` or `INTERFAZE_API_KEY`                  | worker      | extraction host                                        |


### (c) Claims / report with semantic stage + sealing

Projection grants, seal grants, code identity, semantic runtime/profile grants. Optional `AI_GATEWAY_API_KEY`.


| Var                                                | Process     | Notes                                                  |
| -------------------------------------------------- | ----------- | ------------------------------------------------------ |
| `VERIFICATION_SERVICE_OWNERSHIP_GRANTS_JSON`       | api         | grant array; see [Ownership grants](#ownership-grants) |
| `VERIFICATION_CLAIMS_ENABLED`                      | api         | `0`/`1`                                                |
| `VERIFICATION_CLAIMS_PROJECTION_GRANTS_JSON`       | api, worker | JSON array                                             |
| `VERIFICATION_SEAL_POLICY_GRANTS_JSON`             | api, worker | JSON array                                             |
| `VERIFICATION_CLAIMS_REPORT_READ_PUBLIC_KEYS_JSON` | api         | JSON keys                                              |
| `VERIFICATION_PARSER_IMAGE_DIGEST`                 | api, worker | required if claims/seal                                |
| `VERIFICATION_CODE_GIT_SHA`                        | api, worker | seal identity                                          |
| `VERIFICATION_CODE_DIRTY`                          | api, worker | `0`/`1`                                                |
| `VERIFICATION_RUNTIME_PLATFORM`                    | api, worker | string                                                 |
| `VERIFICATION_RUNTIME_DEPLOYMENT_ID`               | api, worker | string                                                 |
| `VERIFICATION_SEMANTIC_RUNTIME_JSON`               | worker      | optional JSON                                          |
| `VERIFICATION_SEMANTIC_PROFILE_GRANTS_JSON`        | api, worker | optional JSON                                          |
| `VERIFICATION_STORAGE_BUCKET`                      | api, worker | default bucket                                         |
| `VERIFICATION_AUDIT_SIGNING_KEY_ID`                | worker      | optional pair                                          |
| `VERIFICATION_AUDIT_SIGNING_PRIVATE_KEY_PEM`       | worker      | optional PEM                                           |
| `AI_GATEWAY_API_KEY`                               | worker      | optional semantic judge                                |


### (d) Benchmark + adjudication + audit inspection

Configs, signing keys, adjudication trio.


| Var                                                         | Process     | Notes                                                  |
| ----------------------------------------------------------- | ----------- | ------------------------------------------------------ |
| `VERIFICATION_SERVICE_OWNERSHIP_GRANTS_JSON`                | api         | grant array; see [Ownership grants](#ownership-grants) |
| `VERIFICATION_BENCHMARK_CONFIG_JSON`                        | api, worker | JSON                                                   |
| `VERIFICATION_BENCHMARK_SIGNING_KEY_ID`                     | worker      | required if config                                     |
| `VERIFICATION_BENCHMARK_SIGNING_PRIVATE_KEY_PEM`            | worker      | PEM                                                    |
| `VERIFICATION_BENCHMARK_COMPARISON_CONFIG_JSON`             | api, worker | JSON                                                   |
| `VERIFICATION_BENCHMARK_COMPARISON_SIGNING_KEY_ID`          | worker      | required if config                                     |
| `VERIFICATION_BENCHMARK_COMPARISON_SIGNING_PRIVATE_KEY_PEM` | worker      | PEM                                                    |
| `VERIFICATION_BENCHMARK_READ_PUBLIC_KEYS_JSON`              | api         | JSON keys                                              |
| `VERIFICATION_BENCHMARK_COMPARISON_READ_PUBLIC_KEYS_JSON`   | api         | JSON keys                                              |
| `VERIFICATION_BENCHMARK_CAPTURE_PROFILES_JSON`              | api         | JSON                                                   |
| `VERIFICATION_ADJUDICATION_GRANTS_JSON`                     | api, worker | trio                                                   |
| `VERIFICATION_ADJUDICATION_REVIEW_REQUIREMENTS_JSON`        | api, worker | trio                                                   |
| `VERIFICATION_ADJUDICATION_PUBLIC_KEYS_JSON`                | api, worker | trio                                                   |
| `VERIFICATION_ADJUDICATION_TIMEOUT_MS`                      | api, worker | optional, default 30000                                |
| `VERIFICATION_ADJUDICATION_DECISIONS_ENABLED`               | api, worker | `0`/`1`                                                |
| `VERIFICATION_ADJUDICATION_SYNTHETIC_REVIEWER_GRANTS_JSON`  | api, worker | optional if decisions enabled                          |
| `VERIFICATION_AUDIT_INSPECTION_ENABLED`                     | api, worker | `0`/`1`                                                |
| `VERIFICATION_AUDIT_INSPECTION_GRANTS_JSON`                 | api, worker | JSON                                                   |
| `VERIFICATION_AUDIT_INSPECTION_PUBLIC_KEYS_JSON`            | worker      | JSON keys                                              |
| `VERIFICATION_AUDIT_INSPECTION_READS_ENABLED`               | api         | `0`/`1`                                                |
| `VERIFICATION_AUDIT_INSPECTION_TIMEOUT_MS`                  | worker      | optional, default 30000                                |
| `VERIFICATION_CLAIMS_PROJECTION_GRANTS_JSON`                | api, worker | required if audit inspect                              |


Full matrix: [DEPLOYMENT.md](DEPLOYMENT.md).

## Offline diagnostics demo

Local frozen-input execution. No HTTP client, access token, or provider authority.

```bash
corepack pnpm --filter @aiengineer/knowledge-cli dev -- demo diagnostics-companies --dataset diagnostics-companies-v1 --output <dir>
```

`--dataset` must be `diagnostics-companies-v1`. `--output` is required and must not already exist. Optional `--open` opens `verification-audit.html` when stdin/stdout are TTYs.

Stdout is JSON including `status`, `dataset`, `outputDirectory`, `auditPath`, `runManifestDigest`, `fileManifestDigest`, `files`, `qualityGate`, `providerDispatches` (always `0`), `humanGoldScoringEligible` (always `false`), `exitCode`.


| `qualityGate.outcome` | stdout `status`           | Exit |
| --------------------- | ------------------------- | ---- |
| `pass`                | `quality_gate_passed`     | 0    |
| `fail`                | `quality_gate_failed`     | 1    |
| `unavailable`         | `verification_incomplete` | 2    |


Catch → stderr `{code:"DEMO_ERROR",...}` and exit 2.

**Exit 2 `verification_incomplete` is expected** until human labels and a sealed quality benchmark exist.

Required output files (always written):

`trudiagnostic-research-report.{md,html,json}`, `generation-lab-research-report.{md,html,json}`, `diagnostics-comparison-report.{md,html,json}`, `verification-audit.{md,html,json}`, `company-fields.{json,html}`, `native-verification.json`, `native-ledger-artifacts.json`, `engineering-mutations.json`, `mutation-report.json`, `report-coverage.json`, `evidence-appendix.{html,json}`, `claim-ledger.json`, `field-ledger.json`, `source-ledger.json`, `run-ledger.json`, `metrics.json`, `quality-gates.json`, `adversarial-checks.json`, `verification-bundle.json`, `manifest.json`.

Conditionally written when fixtures replay: `semantic-replay.json`, `policy-replay.json`, `report-semantic-replay.json`.

## Claims verification via CLI

`--wait` on `verify citations` is handled (`verification_claims`, receipt `verify_claims_and_register.succeeded`). Completion `{operationId,state,claims:{runId,manifestDigest,policyOutcome,mechanicalStatus,disposition},receiptId,exitCode}` is a compact projection: `admitted` exit 0, `held_for_review` / `quality_failed` exit 1. The signed `verify claims-result` read is authoritative. `held_for_review` / `needs_review` / `review_required`: escalate to adjudication; do not retry or override.

```bash
knowledge verify citations --input '<VerifyClaimsRequestSchema JSON>' --context '<OperationContextSchema JSON>' --wait
# or poll then read:
knowledge verify status --input '{"operationId":"<uuid>"}' --context '<same context>'
knowledge verify claims-result --input '{"operationId":"<uuid>"}' --context '<same context>'
```

`VerifyClaimsRequestSchema` fields: `verificationContractVersion` (`verification.v1`), `captureIds` (unique, 1–100), `assertions` `{artifactId, digest}`.

When `--wait` is used on a handled kind (capture, extraction, replay, metric, benchmark, compare, claims, report), stdout is the completion object and the process exit code is `completed.exitCode` (0 admitted / quality pass, 1 quality fail / `held_for_review` / `needs_review`, 2 infrastructure). The `--wait` completion is not the authoritative result.

## Attestation export and inspect

Local only. Does not call the API.

```bash
knowledge verification attestation-export --audit-bundle <path> --trusted-public-keys <path> --trusted-binding <path> --output <path>
knowledge verification attestation-inspect --audit-bundle <path> --trusted-public-keys <path> --trusted-binding <path> --attestation <path>
```

Export signs with `KNOWLEDGE_VERIFICATION_ATTESTATION_SIGNING_KEY_PEM`. Inspect: exit 0 verified, 1 not verified, 2 error.

## Replay

```bash
knowledge bundle replay --input '<ReplayRunRequestSchema JSON>' --context '<OperationContextSchema JSON>'
```

`ReplayRunRequestSchema`: `verificationContractVersion`, `runId`, `replayMode` (`deterministic_only` | `recorded_provider_outputs`). Path `runId` must match the body. `--wait` handles `verification_replay` (uses `result.valid`).

## Adjudication

```bash
knowledge adjudication request --input '<RequestAdjudicationRequestSchema JSON>' --context '<context>'
knowledge adjudication get --input '{"operationId":"<uuid>"}' --context '<context>'
knowledge adjudication decision --input '<VerificationAdjudicationDecisionRequestSchema JSON>' --context '<context>'
knowledge adjudication get-decision --input '{"operationId":"<uuid>"}' --context '<context>'
```

Decision POST requires the **authenticated** actor to be `human`, or `service` with `serviceIdentity` `human_reviewer`; never `model`. That identity comes from `KNOWLEDGE_API_IDENTITIES`, not from forging `--context.actor`. Decisions record review only; `admissionChanged` is always `false`. `--wait` does not handle these kinds.

## Provider reconciliation

```bash
knowledge reconciliation apply --input '{"operationId":"<uuid>","providerAttemptId":"<uuid>","artifact":<VerificationArtifactHandle>}' --context '<context>'
knowledge reconciliation show --input '{"operationId":"<uuid>","providerAttemptId":"<uuid>"}' --context '<context>'
```

Apply never authorizes redispatch. Extraction vs claims/report HTTP hosts differ; the CLI apply/show path uses the extraction host.

## Recovery

- Historical local DB wipe: `docs/workspaces/verification-module/LOCAL-RESET-RECOVERY.md`. Do not run `db:reset` against a shared populated project. Incremental migrate; disposable reset is `../ai-engineer-db-contract/scripts/reset-disposable-local.mjs`.
- Retry / reconcile (generic operation control):

```bash
knowledge operation retry --input '{"operationId":"<uuid>"}' --context '<full OperationContext>'
knowledge operation reconcile --input '{"operationId":"<uuid>"}' --context '<full OperationContext>'
```

Manual retry is restricted to deterministic replay/extraction infrastructure failures. It does not retry provider-capable, unknown, policy, or quality outcomes.

## Hygiene

- Never load KS `.env` for local proofs.
- Never print grants, PEMs, or tokens.
- Sealed artifacts, audit bundles, and registered object-store bytes are immutable. Changing a judgment changes `manifestDigest`.
- Do not invent human labels. The diagnostics review pack candidates stay blank until authenticated humans annotate them.

