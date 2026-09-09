# Decision full-startup proof isolation — 2026-09-08

Prepared `scripts/prove-verification-adjudication-decision-full-startup.ts` for one local synthetic API startup POST, production worker execution, and terminal API read. It uses the reviewed local direct-config helper, a new synthetic `human_reviewer` service actor, an exact server allowlist, retained signed packet evidence, and canonical cancellation if a post-submit failure occurs.

The proof did not start. Its tenant isolation preflight found three unrelated queued/running operations. `startWorker` currently runs tenant-wide reconciliation before its polling loop and has no operation-ID filter. The required signed-subject configuration also registers claims and report handlers, so running it could affect the unrelated work. No API/server or worker was started, no decision operation was created, and nothing was cancelled.

The narrow proposed change for review is an optional strict `WORKER_OPERATION_ID`: call `reconcileOperation(tenantId, id)` and schedule `runOperationOnce(id)` when set. The existing default remains tenant-wide. Receipt: `internal/verification-decision-full-startup-isolation-blocked-20260908.json`. No provider calls and no human evidence.
