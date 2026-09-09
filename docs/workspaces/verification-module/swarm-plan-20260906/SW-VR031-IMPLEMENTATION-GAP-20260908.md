# VR031 implementation-gap audit — 2026-09-08

VR031 requires observable provider/model/parser/grader/policy drift that **triggers revalidation policy**, with drift fixtures, a scheduled comparison, and an alert test. The current acceptance row remains partial.

## What is implemented

Gateway semantic calls persist request bytes, raw response bytes, and a signed semantic observation before interpreting the response. `packages/verification/src/providers/gateway.ts` marks a missing or returned-model mismatch as `revalidationRequired: true`, records that observation, and rejects the provider result. The tests verify that a mismatched model is retained before rejection and that failed observation storage stops execution.

`packages/persistence/src/verification-semantic-gateway-call.ts` wires that callback through registered provider artifacts, durable accounting, response capture, and `PostgresVerificationSemanticObservationStore`. The observation store writes a fenced, append-only `orchestration.verification_semantic_response_observation` row only after lease, host, artifact, and replay checks. The semantic DB migration binds this custody to claims/report worker leases.

The production worker can compose the optional semantic stage when `VERIFICATION_SEMANTIC_RUNTIME_JSON`, profile grants, and the gateway key are supplied. This is an execution-time opt-in for claims/report semantics; it is not a monitor or scheduler configuration.

## Missing behavior is local engineering, not only deployment configuration

There is no application or persistence path that selects `revalidationRequired = true` observations, derives an idempotent revalidation/comparison request, records an alert event, or delivers an alert. The only worker timer in `apps/worker/src/index.ts` calls `runOnce()` for already-created canonical operations. It does not discover observations or create monitor operations. The benchmark comparison runtime is an explicitly submitted comparison of two completed benchmark runs; it does not consume semantic observations or provide alert delivery.

Repository deployment material contains the worker Dockerfile and API/MCP Vercel descriptors, but no scheduler deployment or alert-destination configuration. The operations runbook names alerts as operator signals without defining a semantic-drift alert sink. Therefore adding environment values alone cannot satisfy VR031.

## Smallest correct integration

Use the existing canonical-operation worker rather than introducing a second scheduler:

1. Add an internal persistence query/repository in `packages/persistence/src/verification-semantic-observation-store.ts` (or a focused sibling) that returns only immutable, tenant-scoped observations requiring revalidation and their exact source handles. Add a durable idempotency/alert state so repeated polling neither repeats alerts nor creates duplicate work.
2. Add an application-level semantic drift comparator/revalidation planner under `packages/application/src/`, consuming those exact observation handles and producing a compact deterministic comparison/alert payload. It must keep provider calls out of the monitor; a revalidation call needs a separately admitted, server-owned canonical operation and budget.
3. Add one explicit operation kind/step and handler in the canonical registry (`apps/worker/src/activity-registry.ts`, `apps/worker/src/verification-activities.ts`, and a focused worker runtime). The existing `startWorker` poll loop may then process created operations, but must not synthesize cross-tenant work from an unbounded timer.
4. Add an authenticated deployment-owned scheduler that submits that explicit operation at a bounded cadence, plus a configured alert outbox/destination. Keep both opt-in and fail closed if cadence, tenant scope, destination, grants, or budget policy is absent.
5. Test three boundaries: a drift observation queues exactly one eligible revalidation/comparison; a scheduled invocation yields one durable alert event and delivery attempt; disabled/missing configuration creates neither provider call nor alert. A deployed scheduled run and an observed alert delivery remain the final infrastructure proof.

This requires a reviewed DB-contract migration for durable idempotency/alert state and operation-kind admission. It cannot safely reuse the benchmark comparison tables: their identities are bound to benchmark-run artifacts, while VR031 starts from semantic provider observations.

## Conclusion

The observation/rejection portion is implemented and runtime-configurable. Automatic revalidation/comparison and alerting are absent from local code, and deployment scheduler/alert infrastructure is also absent. VR031 should remain partial until both the bounded integration and a real deployment scheduled-comparison/alert proof exist.
