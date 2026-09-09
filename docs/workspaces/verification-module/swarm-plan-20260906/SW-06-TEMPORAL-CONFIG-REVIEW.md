# SW-06 Temporal configuration independent review

Date: 2026-09-06
Reviewer: semantic agent (independent of the Mission Control author)
Scope: read-only review of Mission Control `packages/config/src/index.ts`, `packages/config/src/index.test.ts`, `apps/api/src/runtime.ts`, and `apps/worker/src/index.ts`.

## Findings

The shared `loadTemporalConfig` and `temporalConnectionOptions` composition is sound for the reviewed boundary. API and worker both consume the same parsed host:port configuration and the same `{ address, tls, apiKey? }` connection shape. TLS is false only for localhost, 127/loopback, or `::1`, and true for remote Temporal Cloud endpoints. API credentials are used for connection setup and are not placed in workflow inputs. Production requires a nonblank API key, rejects local endpoints, and rejects the default namespace. Endpoint parsing rejects URL schemes, credentials, paths, port zero, and ports above 65535.

No actionable source finding was identified within this bounded review. The current tests cover local TLS parity, production loopback rejection, remote TLS, blank-key alias fallback, malformed endpoints, and unconfigured API readiness behavior.

## Verification

Read-only source hashes (SHA-256, current working tree):

- `packages/config/src/index.ts`: `4053684C7DA96F491B5DF0DDD920E23B49C02C275792F0DDFF1ECEAC5830933E`
- `packages/config/src/index.test.ts`: `E85917D62AD77FA7E3403D0E639D915A7A3740DBF862EDE82F65A5D15488076A`
- `apps/api/src/runtime.ts`: `6901F51821AD5CA9E8D636101132A868245CA056310FFF03895F35AF9EBC606A`
- `apps/worker/src/index.ts`: `FCDBF7F9E0BF0B9AB6F9C8B78CCE9F9D6F52950E96B90F375F3233B0C3C9114B`

Attempted commands, each from the Mission Control repository:

- `pnpm --filter @aiengineer/mission-config typecheck`
- `pnpm --filter @aiengineer/mission-config test`
- `pnpm --filter @aiengineer/mission-api typecheck`
- `pnpm --filter @aiengineer/mission-api test`
- `pnpm --filter @aiengineer/mission-worker typecheck`
- `pnpm --filter @aiengineer/mission-worker test`

The checks could not reach package tests because the repository's package-manager guard attempted to recreate `node_modules`, then stopped with `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH` (`overrides` differs from the lockfile). The initial non-CI attempt stopped earlier with `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`. No source or lockfile was changed; no Temporal connection, database, or provider call was made. This is an environment validation blocker, not a code failure.

## SW-04 read-only inventory recommendation

The smallest useful next artifact is a reviewer-facing annotation queue generated from `catalog/verification-benchmarks/diagnostics-companies-benchmark-v1-preparation-v3/curation-queue.json`, retaining each candidate's exact fragment, full capture/projection/selector handles, source family, claim family, qualifiers, and a blank human label slot. It should include explicit choices for support status, contradiction, qualifier preservation, source scope, and abstain/insufficient evidence, plus annotator identity/qualification and timestamp fields. Keep the six leakage components indivisible and preserve the provisional 90/14/76 split warning. Do not freeze cases, infer gold, or run providers until a qualified human reviews the queue.
