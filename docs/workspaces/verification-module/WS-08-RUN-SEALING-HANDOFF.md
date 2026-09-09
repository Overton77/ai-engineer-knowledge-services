# WS-08 sealed-run recording handoff

Updated 2026-09-05.

## Recorder acceptance boundary

`PostgresVerificationRepository.recordVerificationRun` now records one
immutable `verification.v1` row per tenant/run ID.

- It validates UUIDs, artifact handles/tenant ownership, canonical lifecycle
  timestamps, and optional lease shape before opening the write path.
- It locks an existing `(tenant_id, id)` row first. An exact retry returns
  successfully; any change to producer/verifier attempt, policy version,
  lifecycle/status/timestamps, mission/work-item/operation binding, or a
  bundle/result/policy/manifest artifact identity or recorded digest throws
  `VERIFICATION_RUN_IDENTITY_DRIFT`.
- A first insert uses `ON CONFLICT (tenant_id, id) DO NOTHING`, then takes a
  locked reread and performs the same exact comparison. This also makes a
  concurrent no-operation retry safe when a missing-row lock cannot serialize
  writers.

Existing callers without `operationId` remain supported.

## Operation and lease fence

For an operation-linked record, the first writer locks the tenant-scoped
canonical operation and requires `status` `running` or `succeeded`. Its nullable
mission ID, work-item ID, and attempt ID must exactly equal the recorder input
mission/work-item and `verifierAttemptId`; missing, inactive, or mismatched
operations are rejected before the insert.

An optional `lease` has `{ stepId, leaseToken, fencingToken, holderIdentity }`.
When supplied it must reference a `running` step owned by that operation and an
unreleased, unexpired lease with the same token, fence, and holder.

The recorder deliberately holds the operation row and performs the lease/step
check without locking lease/step rows. `completeStep` takes lease/step before it
locks the operation; reversing that order would deadlock. The locked operation
is the linearization point: a prior cancellation/completion is observed before
recording, while a later transition waits until the sealed-row transaction
commits.

`loadAuditBundle` integration additionally requires a linked canonical
operation to have reached `succeeded`; standalone sealed runs remain readable.

## Focused validation

`packages/persistence/src/verification-run-recording.test.ts` is unit-only and
covers exact no-operation retry, conflict-safe insertion, artifact/context/
lifecycle drift, operation ownership and terminal control rejection, live/stale
lease fencing, and PostgreSQL timestamp values returned as either `Date` or ISO
strings.

```text
vitest run packages/persistence/src/verification-run-recording.test.ts
# 13 passed
packages/persistence: tsup src/index.ts --format esm
packages/persistence: tsc --emitDeclarationOnly --rootDir src --outDir dist
```

No migration, database reset, worker integration, or local fixture proof was
run in this change. The integration proof should demonstrate exact retry and
drift rejection, operation ownership, stale lease rejection, and read
invisibility until canonical completion.

## Coordinator integration acceptance

EV-050 records the subsequent real local integration and independent custody review. Ten new recording checks and concurrent standalone retry passed; the full KS typecheck/test/build passed 72/72 uncached. See EVIDENCE-LOG.md for exact receipts and scope. Automatic worker composition remains pending.
