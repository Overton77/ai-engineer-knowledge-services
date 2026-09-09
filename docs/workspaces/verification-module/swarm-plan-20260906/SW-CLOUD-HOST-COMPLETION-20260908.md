# Temporal Cloud verification host completion — 2026-09-08

Status: complete for the deterministic engineering proof.

The production Mission Control `verificationWorkflow` ran on Temporal Cloud namespace `verification-cph-20260908.ih0e7`, dispatched `verifyReport` through the real Mission Control activity and local Knowledge Services HTTP API, and completed exact worker-scoped operation `0ea2b16c-79f4-53ab-ac15-470b478eb000`.

The terminal was read through the signed typed report service and the authenticated HTTP route. Both representations matched. Deterministic verification passed with one admitted capture and one supported report assertion. The terminal disposition was `review_required` because citation semantics were deliberately unassessed (`REPORT_CITATION_SEMANTICS_UNASSESSED`); no model or Gateway call occurred and no human label was invented.

Temporal evidence:

- Workflow ID and task queue: `verification-cloud-report-437f1e4b-b5d3-4a2b-b231-eadf53f2f210`.
- Cloud helper receipt: `internal/verification-temporal-cloud-8ab2a354-3dd0-4c50-8695-6f90ac3f18e1.json` (`sha256:5d68b6086078a5a88fb8d1f5918dd295a36f169da3f16cb4c43bb92bc1969e97`).
- Cloud history: `internal/verification-temporal-cloud-8ab2a354-3dd0-4c50-8695-6f90ac3f18e1.history.json` (`sha256:0994a9a0c375c3ee5a87b37eaf5cc853b7c45517928073b9f8b13b3385fe4138`).
- Host proof: `internal/verification-cloud-fixture-host-437f1e4b-b5d3-4a2b-b231-eadf53f2f210.json` (`sha256:46e9eba3222b7eb11cb8f6adcd53ef81c5daa74cedebe30e1dba4ac8f67ee642`).
- The same workflow ID was started a second time and Temporal rejected the duplicate. The completed history replayed successfully with `Worker.runReplayHistory`.
- The Temporal API credential and the in-memory Knowledge Services bearer were checked for absence from serialized Cloud history before persistence. A separate post-run scan confirmed the Temporal credential is absent from the helper receipt, history, host proof, and startup journal.

Implementation evidence:

- `scripts/start-verification-cloud-fixture-host.ts` creates only a fresh mission, producer attempt, verifier attempt, and exact report operation in the retained registry tenant. It starts the Knowledge Services API and a worker scoped with `WORKER_OPERATION_ID`, configures the deterministic report sealer without a semantic stage, invokes the Cloud helper in-process, checks the typed signed terminal, and closes only the resources it created.
- `ai-engineer-mission-control/scripts/prove-verification-temporal-cloud.ts` accepts caller-declared workflow and task-queue identities so server-owned Knowledge Services authorization can bind the exact external execution before Temporal start. Its default unique-ID behavior remains available.
- Source hashes at execution: host `sha256:da822f7a925ff543120c59ba8e047380f5d195096d2f4902802c2ae8cbc2e944`; helper `sha256:1d7791f37a4462ae563a4a8406b9e70ea051b9c9eb6689c6ec4819b48b1ddd98`.

Validation: the actual Cloud run passed, the Mission Control worker TypeScript check passed, all owned workers and connections stopped, and the local database and Storage evidence were retained. This proof does not claim semantic citation correctness or model-backed review.

## Actual Cursor Cloud report composition

The recovered Cursor Cloud Luna report from agent `bc-15996c7b-89b9-41b9-98f6-34103081506c`, run `run-11597ece-0e18-4881-a876-5c2205bea203`, was passed unchanged through the loopback fixture bridge, the production Mission Control API, the production `verificationWorkflow` on Temporal Cloud, the local Knowledge Services HTTP API, and the exact operation-scoped production Knowledge Services worker.

- Workflow: `verification-e5cdefc23172bdb2f570d7a2c670ae855deb53a671971e1e2539deaacee6f2ea`.
- Task queue: `verification-cursor-cloud-716b43b9-4b6e-46e7-90e0-0d5bbe71a596`.
- Operation: `725445d7-0a76-5821-a88b-980a48011a52`.
- Receipt: `internal/verification-cursor-cloud-loopback-716b43b9-4b6e-46e7-90e0-0d5bbe71a596.json` (`sha256:f51c07d572646da21f438837847897460716e6bcab90b75eb8121c30ae02cb84`).
- Execution log: `internal/verification-cursor-cloud-loopback-root-r3-20260908.log` (`sha256:6eeff35bd3faf6f7b777fdb649f37167284b39ed257118743533a9d8c18a5bab`).
- The second launch returned the same workflow identity. The typed terminal completed with deterministic status `passed`, one admitted capture, and one supported assertion. Its `review_required` disposition correctly preserves unassessed citation semantics.
- No additional Cursor Cloud run, Gateway call, semantic provider call, or human label was used.

The first two composition attempts exposed `VERIFICATION_REPORT_LEDGER_REPORT_MISMATCH`. The retained report was valid; the reuse helper had converted a PostgreSQL `Date` through `String(date)`, dropping the report registration's `634` millisecond component. The final host preserves `Date.toISOString()` exactly, validates the offered agent/run identity and report bytes, hydrates the canonical report registration, and binds that exact handle into the new ledger. A preflight now compares the ledger handle with the trusted resolver's hydrated registration before any Cloud workflow starts.

Focused reuse regression validation passed: six tests total, including rejection of a wrong producer agent, wrong producer run, and changed hydrated report bytes. Direct TypeScript checking of the fixture and reusable host passed. Final source is frozen under `internal/verification-temporal-cloud-agent-report-source-20260908/manifest.json`.

Final source hashes:

- `scripts/start-verification-cloud-agent-report-host.ts`: `sha256:407f8918460c03d259cb28be1aa69cfb5341eeb3efc9a18a52642b01f669329d`.
- `scripts/verification-agent-report-fixture.ts`: `sha256:33f3cd732f3366915111d9db2247a1c802e37d0280ab89588ce33fc14229f976`.
- `scripts/verification-agent-report-fixture.test.ts`: `sha256:5c56a6ef9e9c11e9ab19f3043f23bca4eee7062ff5a9511ddc36228b38528b66`.
- `ai-engineer-mission-control/scripts/prove-verification-temporal-cloud.ts`: `sha256:00cc38f39d2d25a3bd6a933045ab423d70004d2de26b0e849426078c712f6235`.
- `ai-engineer-mission-control/scripts/verification-proof-secret-scan.mjs`: `sha256:541a0a4129c4e22aa8e1ded5843d6f33a039abcfdcc96a791f7dcf679856a9d3`.

The actual Cursor caller still used the local loopback bridge. A public tunnel remains the final prerequisite for proving the same route with Cursor Cloud as the HTTP caller. Cloud cancellation and worker-loss recovery remain outside this checkpoint, so this evidence does not close the broader VR025 recovery scope.
