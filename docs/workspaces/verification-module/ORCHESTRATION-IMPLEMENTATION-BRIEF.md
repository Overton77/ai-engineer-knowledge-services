# Orchestration preparation

Coordinator, 2026-09-05. WS-10 remains unclaimed; this preparation proves no workflow integration.

## Local runtime prepared

Temporal CLI was absent from PATH. The coordinator installed official CLI **1.8.1** under `../../../../internal/tools/temporal-1.8.1/bin/temporal.exe`, without changing system PATH. Its reported embedded versions are Server **1.31.2**, UI **2.50.1**. Download: [official release](https://github.com/temporalio/cli/releases/tag/v1.8.1). ZIP SHA-256 `01d3808b1a245676c69372692265e79a42f3fbef74f22533fc0b178b467f90cc` matches the release's `checksums.txt`, both retained next to the executable directory. No Temporal server was started during preparation.

Use an isolated local development namespace and persistent test SQLite path for worker-loss/restart proof. Bind frontend/UI to `127.0.0.1`; do not connect these tests to Temporal Cloud or claim production readiness. Start background helpers with `Start-Process -WindowStyle Hidden` and explicit stdout/stderr logs. Confirm ownership before stopping a process. Do not reset existing database state.

The coordinator read the Temporal developer skill and its TypeScript getting-started, testing, determinism, error-handling, CLI-install and fairness references. The implementation agent must inspect installed SDK versions/types and its relevant references. Keep all `@temporalio/*` dependencies at the same pinned version. Use built workflow bundles for deployed workers.

## Required composition

Coordinator subsequently started the pinned local server with an isolated SQLite path and verification-local namespace. CLI health returned SERVING and namespace state REGISTERED; all observed process listeners were loopback. Readiness receipt `internal/verification-temporal-readiness-48085427-56b4-4050-a772-1a5b7b2a1347/readiness.json` SHA-256 `8f5dd254311abd5b2a0664edadc0e775f5deab3dc8c6d901c9728d0cf3aa4494`; process arguments and logs are retained alongside it. The coordinator verified executable/PID ownership before stopping that server; ports are released and SQLite state retained. No workflow, activity, HTTP integration or history replay was executed. This supersedes only the earlier sentence saying the server had never started, not the missing WS-10 proof.

- Mission Control owns authenticated dispatch and control; Knowledge Services owns verification behavior. Reuse canonical operation/lease/fencing/outbox primitives. Do not create a parallel job ledger.
- Workflow payloads contain operation/tenant/artifact identifiers and compact non-sensitive configuration. Resolve bytes and run providers in activities; no secrets/raw source content in workflow history.
- Workflow code must be deterministic and import activity types only. Provider calls, storage, clock reads, and database access remain outside workflow code.
- Model quality outcomes are terminal results or explicitly non-retryable domain failures; infrastructure failures use bounded retries. A verifier must never retry by adopting the producer deployment's identity.
- Heartbeats and cancellation must reach long-running provider/parser activities. Cancellation must prevent later admission even if a remote request finishes. Reconciliation recovers committed receipts without duplicate runs or provider charges.
- A repeated dispatch key must return the same operation, including concurrent delivery and worker restart. Tests need separate producer/verifier trusted principals.
- Preserve compatibility wrapper semantics through HTTP/client/CLI for EVE and Cursor. Do not copy server algorithms into those repositories.

## Tenant fairness

For a multi-tenant queue, use Task Queue Fairness when the deployed server/SDK supports and the operator enables it. The skill identifies it as preview and paid in Temporal Cloud; do not enable a paid Cloud feature implicitly. Initial local proof should explicitly bound per-tenant concurrency/admission and test that a high-volume tenant cannot starve a second tenant. Record which mechanism was actually exercised.

## Independent proof checklist

Run real local Temporal execution with actual verification HTTP/activity composition, not only mocked activity results. Test duplicate start, transient failure then recovery, permanent quality failure, cancellation during work, worker loss, stale lease/fencing rejection, and recovery without duplicate persisted results. Export histories and run `Worker.runReplayHistory` against the actual bundle. Distinguish deterministic verifier replay from Temporal event-history replay. Preserve versions/configuration, tenant-isolated operation IDs, artifact hashes and output logs in the handoff.

Before modifying consumers, read their AGENTS instructions. Cursor requires `npm run verify:environment`; EVE requires its registry/deployment discovery and installed documentation. The dashboard has its separate Next development-loop requirement. Actual production research shadow behavior cannot be claimed while upstream research systems remain unfinished.
