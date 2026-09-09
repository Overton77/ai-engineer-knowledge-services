# WS-08 provider operation-scope handoff

Updated 2026-09-06. This is implementation handoff, not database acceptance.
No migration was applied and no provider was called.

## Delivered changes

`packages/persistence/src/verification-provider-accounting.ts` now accepts an
optional immutable `VerificationProviderOperationScope` in its constructor:

- `LeasedStep` (tenant, operation, step, lease token, holder, numeric fence);
- producer profile artifact ID and SHA-256 digest.

Scoped methods verify their tenant on every call and, inside every transaction,
write a transaction-local `verification.provider_claim` JSON value and lock the
live `knowledge_service.operation` before its `operation_step` and lease. The claimed
operation must be running `verification_structured_extraction` and the claimed
step must be running `extract_and_register` with the exact holder, token,
fencing token, and unexpired lease.

Scoped reservation reads by tenant/operation/ordinal and records operation,
step, profile, and reservation fence. A scoped reservation requires an admitted
request artifact and rejects request/profile identity drift. A replacement live
lease can reuse the same reservation without changing its historical reservation
fence or reserving budget again.
Dispatch retains the existing UUID `dispatchFence` as an idempotency marker and
also writes the canonical numeric `dispatch_fencing_token`. It cannot dispatch
a non-reserved attempt. Scoped settlement and uncertainty marking require the
same active lease, so post-cancellation response reconciliation remains
intentionally unresolved and the reservation remains a liability. Neither
uncertain nor settled state can redispatch.

Legacy construction has no scope. It retains the legacy query/insert shapes and
rejects scoped rows; scoped construction rejects legacy or another operation's
row. No request salt, semantic hash fabrication, cache inference, or child
orchestration attempt was introduced.

`ai-engineer-db-contract/supabase/migrations/20260906031300_verification_provider_operation_scope.sql`
adds nullable legacy-compatible operation scope columns, same-tenant composite
FKs, profile artifact type, legacy and scoped partial uniqueness indexes, and
separate scope and claim triggers. The original 140 attempt-state guard remains
untouched. The claim trigger locks operation then step/lease, validates the exact
step claim and admitted profile/request/response artifacts, and only checks the
current fencing token on initial reservation or reserved-to-dispatched transition.
The scope constraint requires a request artifact and a dispatch fence only after
dispatch; later settlement/uncertainty can use a replacement lease while retaining
the historical dispatch fence.
It replaces global request/ordinal uniqueness with:

- legacy: `(tenant_id, request_sha256, attempt_ordinal) WHERE operation_id IS NULL`;
- scoped: `(tenant_id, operation_id, attempt_ordinal) WHERE operation_id IS NOT NULL`.

Thus the same exact wire request can appear in different operations without a
collision, while a changed wire request/profile under one operation cannot
silently become another call.

## Required follow-up

Run the DB migration only in the coordinator's controlled proof. The migration
discovers the exact legacy uniqueness constraint by `pg_get_constraintdef` and
aborts unless exactly one match is present. Root must compose scoped accounting only after the structured
extraction executor has a real leased operation and must preserve the active
lease claim across reserve, dispatch, uncertainty, and settlement paths.

## Focused verification

```
pnpm --filter @aiengineer/knowledge-persistence exec vitest run src/verification-provider-accounting.test.ts
pnpm --filter @aiengineer/knowledge-persistence exec tsc --noEmit
```

Both passed: 6 focused tests and persistence TypeScript compilation. The focused
tests cover malformed lease tokens, operation-before-step locking, 15-parameter
scoped reservation SQL, replacement-lease reservation reuse, stale lease before
budget SQL, and cached settle/uncertain profile drift.


## Coordinator live review — 2026-09-06 UTC

After correction and review, root applied06031300 locally and ran `scripts/prove-verification-provider-operation-scope.ts`. All27 actual local PostgreSQL/Storage checks pass. Final receipt: `../../../../internal/verification-provider-operation-scope-f01e8ec5-2d07-4626-a107-8d5b4932c136.json`, SHA256 `0954c95ac3663a656102a67ece4b6f965d61b96f5890bf38c850730d6361b907`. Its separate native audit (`...-audit.json`, SHA256 `abdda1cd4ed4612b1528e1c7d56c35057c80711e6424e43df499fb4388c16c24`) rereads five canonical attempts, budget balances, four actual Storage payloads, released leases, two partial unique indexes and three current scoped source files. Four proof operations are cancelled afterward.

The proof exercises same wire in two distinct operations and legacy scope, exact retry, request/profile/tenant drift, SQL profile digest/type admission, null dispatch fence, original estimate immutability, attempted scope removal, wrong token/holder/fence, concurrent claim, cross-scope access, uncertainty without redispatch, exact settlement, natural lease replacement before dispatch and after dispatch, direct missing claim and cancellation. Remaining reserved cost is200 synthetic microUSD; settled cost90 synthetic microUSD. These are synthetic fixtures, not supplier charges. No provider request or native extraction execution occurs.

Database-contract0.2.16 is regenerated, typechecked, packed, locked and installed. Native package audit compares all176 shipped source/migration/config/seed files to canonical bytes. Remote remains through06022000. The post-cancellation supplier reconciliation lifecycle remains unresolved by design: active scoped methods reject it and reserved liability is retained. This is an explicit next executor requirement, not completed reconciliation.
