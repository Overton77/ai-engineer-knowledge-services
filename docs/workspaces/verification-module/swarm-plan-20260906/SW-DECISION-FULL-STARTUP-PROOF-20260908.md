# Decision API-to-worker startup proof — 2026-09-08

One local synthetic proof completed through the production API and worker composition. `createApiRuntime` accepted one POST at `/v1/verification/adjudications:record-decision` (202), using a new `human_reviewer` service actor and exact synthetic server allowlist. The process then started `startWorker` with the returned `WORKER_OPERATION_ID`; startup reconciliation and scheduled claiming were confined to that ID. The operation reached `succeeded`, and the production API terminal read returned 200.

The decision was `synthetic_engineering`, with `admissionChanged=false` and `humanGoldScoringEligible=false`. The retained tenant had three unrelated queued/running operations; their post-proof statuses matched the pre-proof values, confirming that the scoped worker did not claim or reconcile them. Both API and worker emitted clean shutdown events. No provider calls occurred.

Immutable proof receipt: `C:/Users/Pinda/Proyectos/aiengineer/internal/verification-decision-full-startup-966fb678-1dc4-55ec-aa7d-683ba71e8696.json`, SHA-256 `77250e622d90c8e539c8fbad947ab5cf09cd1125aee4491a66f5976d17e4443d`. Progress receipt: `internal/verification-decision-full-startup-progress-20260908.json`.

The earlier blocked isolation receipt is retained unchanged. This is a local synthetic engineering proof, not human adjudication, human quality evidence, or Cloud deployment evidence.
