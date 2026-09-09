# SW-VR025 Cloud worker recovery scaffold — 2026-09-08

Scope is bounded to the requested Cloud worker-loss/recovery proof harness. No Cloud execution, provider call, database mutation, cancellation, or receipt write was performed by this review.

## Prepared artifacts

- `ai-engineer-mission-control/scripts/verification-cloud-proof-worker.ts` is a child worker entry point. It accepts the host's ephemeral Temporal/knowledge configuration only over bounded stdin, starts the production verification workflow worker and activities on the supplied task queue, and emits readiness/failure metadata without configuration values.
- `internal/prove-verification-cloud-worker-recovery-20260908.mts` is gated by `VERIFICATION_CLOUD_RECOVERY_EXECUTE=1`. It starts the exact child, launches the host report, waits for the exact KS operation to be queued or running before killing the first child, kills only the first child, starts a replacement on the same queue, starts the deferred KS worker, then requires terminal completion, exact operation and terminal artifact custody, an activity retry attempt, Temporal history replay, and history secret scanning. Failed or non-terminal runs call the host's exact-operation cancellation fallback before host cleanup.
- The host hook at `ai-engineer-knowledge-services/scripts/start-verification-cloud-agent-report-host.ts` supplies `externalMissionWorker`, deferred KS startup, an in-memory child configuration, `readOperationState`, `readTerminal`, and `cancelOwnedOperation`.

## Review result

The scaffold is ready for root review and an explicitly authorized Cloud run. The child configuration remains in memory/stdin; it is not put in args, environment, logs, or the receipt. The receipt schema is intentionally prepared-only until execution. The recovery proof still requires a real run to establish Cloud worker loss, activity retry/history replay, one retained operation with durable terminal artifacts, and absence of all three relevant secret values (Temporal API key, knowledge token, upstream bearer) from retained history.

Validation: mission-worker package TypeScript check passed with `corepack pnpm --filter @aiengineer/mission-worker exec tsc --noEmit`. The standalone internal module loader check passed through the mission-worker tsx runtime with the execution gate closed; no live execution was used as a substitute.

Source SHA-256 at ledger time:

- `ai-engineer-mission-control/scripts/verification-cloud-proof-worker.ts`: `33ca75039e62ee64d02f0a9566d4095d505403c3911f28574a1d947b34fcc46b`
- `internal/prove-verification-cloud-worker-recovery-20260908.mts`: `db47ccdfca508a2d35c71b1326784b6a6fe7d4e38dbd5066d10aee87c353cf9d`
- `ai-engineer-knowledge-services/scripts/start-verification-cloud-agent-report-host.ts`: `291898d68ebbb01f59d9c5d50666ec4db6a8cb21394c633b8ac5137c0f0cb3c2`





## R1 readiness failure and read-only reconciliation

R1 launched the owned operation at 2026-09-08 21:27:39Z and the child readiness path timed out. The local operation is `30220d80-79ed-519f-a625-15c42491ddb8`, now `cancelled`. A read-only local Postgres query found no other operation in the launch window. The derived owned Temporal workflow is `verification-27f86b488d8899dfe2807d857fcad1dcfdf1c3ed2a74df19625b8`, and a read-only Temporal Cloud describe/history read showed `RUNNING`, five events, and last event type `10` (activity task scheduled). No cancellation or other mutation was performed by this reconciliation.

The scaffold was corrected without another run: child readiness timeout is 60 seconds; child emits only fixed stage codes (`input_accepted`, `temporal_connected`, `activities_ready`, `worker_created`, `run_started`) and fixed failure codes; parent retains only validated stage codes; the intent record is written with `wx` before launch; Temporal connection/client are established immediately after accepted launch for failure cleanup; failed runs request cancellation of the exact owned workflow and call `cancelOwnedOperation`; child termination is awaited. The next run remains blocked until root reconciles the still-running R1 workflow.

Updated source SHA-256:

- `ai-engineer-mission-control/scripts/verification-cloud-proof-worker.ts`: `33ca75039e62ee64d02f0a9566d4095d505403c3911f28574a1d947b34fcc46b`
- `internal/prove-verification-cloud-worker-recovery-20260908.mts`: `db47ccdfca508a2d35c71b1326784b6a6fe7d4e38dbd5066d10aee87c353cf9d`



## R2 actual Cloud recovery proof — 2026-09-08

R2 completed once after R1 orphan cleanup using the frozen report and its authoritative producer lineage (`bc-15996c7b-89b9-41b9-98f6-34103081506c` / `run-11597ece-0e18-4881-a876-5c2205bea203`). The proof launched workflow `verification-a584c54b06ea0ba8643fa88aa0ac4d7d7c00b7dd0e2b37220b9b35f1cf20dda2`, operation `98ba9184-93a6-52a6-a500-7e0d76ce71be`, and task queue `verification-cursor-cloud-0654f260-5220-4b15-b72a-12b51b732139`. Local readback confirms the operation is `succeeded`.

The retained receipt reports `terminalState: completed`, exact result and manifest artifact IDs, `activityAttempts: [2]`, `historyReplay: true`, and both history and terminal secret scans checked three secrets with zero decoded payload matches. Both first and replacement workers reached all five fixed readiness milestones. Provider calls were zero. Full history and pre-launch intent are retained with `wx`.

Receipt: `internal/verification-cloud-worker-recovery-baf628c7-188d-4b19-acd2-7364c11382c2.json` (SHA-256 `dd45d7dec349d9c18fcbeb6f55b8505ee890c27c3c4427398636bc63b8cbb55f`); history SHA-256 `424aea2e8899234a05475bfe69e2d72c48f8a0d823617dc166e8cb2f666b4681`.

## Final VR025 acceptance audit — 2026-09-08

Verdict: **proved for the exact VR-025 row**. The original §20.1 requirements are idempotent capability nodes, bounded checkpoints/heartbeats, distinct cancellation/retryable infrastructure/terminal contract/completed quality outcomes, artifact registration before acknowledgment, deterministic fan-out/fan-in, and attempt/causation lineage. The retained evidence now covers the acceptance row's requested workflow replay, duplicate/idempotency, cancellation, retry classification, and worker-loss recovery across actual Temporal Cloud and the production Mission Control → local Knowledge Services path.

Evidence binding:

- EV-158 retained actual Temporal Cloud production workflow completion, duplicate start rejection, history replay, and Cursor report loopback; its limitations predate the later bounded cancellation/classification/recovery proofs.
- `internal/verification-cloud-cancellation-b779e2a7-edc7-40d6-a658-882fc5b8c6a2.json` proves actual Cloud launch/read/cancel through production Mission Control API and deferred Knowledge worker, with exact owned operation cancellation; its retained replay receipt is `internal/verification-cloud-cancellation-replay-20260908.json`.
- `internal/verification-cloud-classification-ac7340b4-eafe-4d63-8f8b-9c05c9e94cce.json` proves production activity error classification: infrastructure retries three times and request failure invokes once, with replayed histories. The fixture injects dependency failure before a KS request; this limits provider/semantic quality claims but does not leave the orchestration classification requirement unproved.
- R2 recovery receipt `internal/verification-cloud-worker-recovery-baf628c7-188d-4b19-acd2-7364c11382c2.json` proves actual child SIGKILL, same-queue replacement, activity attempt 2, terminal completion, history replay, exact operation/result/manifest custody, and three-secret scans. Its retained history and pre-launch intent are bound by the receipt hashes.
- Read-only Postgres custody for R2 binds tenant `fbfa12cf-0cef-423d-858e-f7a3e213fa80`, operation `98ba9184-93a6-52a6-a500-7e0d76ce71be`, exact idempotency key, external workflow ID, one succeeded `verify_report_and_register.succeeded` receipt `ddd9428e-0d25-537c-ac20-2f240913b505`, result artifact `a22dbaf5-8f6b-55d4-a34c-ce1184fd9c55`, and manifest artifact `4ee67739-bba9-5807-a6ec-87c89edf72af`.

Current workflow/runtime sources remain bound to the retained Cloud source hashes for `verification-workflow.ts` and `verification-runtime.ts`; current activity, mission-kernel dispatch, and API runtime hashes are recorded in the immutable receipt. No further Cloud start, provider call, or database mutation was made by this audit. Broader module rows concerning benchmark quality, human review, provider semantics, or deployment controls remain outside VR025 and are not used to downgrade this exact orchestration verdict.

## 2026-09-08 corrected decoded-payload secret rescan

The corrected `ai-engineer-mission-control/scripts/verification-proof-secret-scan.mjs` recursively decodes retained Temporal payloads, including base64, `Uint8Array`, and serialized `Buffer` forms. A read-only rescan covered worker-recovery, cancellation, and both classification histories: 18 decoded payloads, three scan inputs per history, and zero matches. The exact ephemeral generated credential values were unavailable after execution; `cursor-cloud-knowledge-` and `cursor-cloud-upstream-` were therefore checked as prefixes, while the current `.env` Temporal Cloud key was loaded only for comparison and never retained or printed. This strengthens the prior VR025 proof but qualifies the credential claim as prefix-based for those generated values.

VR025 remains **proved** for the exact orchestration row: idempotency, cancellation, retry classification, worker-loss recovery, reconciliation, and history replay. Successor receipt: `internal/verification-vr025-final-acceptance-audit-successor-secret-scan-20260908/receipt.json`, SHA-256 `127901BE5DF9ED25F90CAB218DC82DBBBDF7596669F6B96D78125BB88ECE9B4C`.
