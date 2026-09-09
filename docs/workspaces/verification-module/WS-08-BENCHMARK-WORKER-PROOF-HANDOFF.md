# WS-08 configured benchmark-worker proof handoff

## Scope

`scripts/prove-verification-benchmark-worker.ts` is a local-only proof for the
configured offline benchmark path.  It creates a fresh mission, review work item,
and attempt; uses the real configured benchmark activity handler, canonical
activity registry/executor/worker, authenticated API, generated TypeScript client,
built CLI, and MCP tool adapter.  It uses retained registered profile, source-import,
and recorded-replay artifacts only.  It does not make provider requests.

The parent local-proof dispatcher accepts `benchmark-worker` and supplies only the
local Supabase/Postgres credentials in process memory.  The proof requires
`127.0.0.1:54321` and local Postgres port `54322`; it neither resets the database nor
contacts a remote service.

## Trusted configuration and custody

The proof parses the same `VerificationBenchmarkRuntimeConfig` used by the runtime.
The API's benchmark-admission callback resolves the parsed trusted input catalog,
rather than reimplementing an artifact-pair comparison.  The generic API operation
service is deliberately a default `PostgresKnowledgeOperationService`; only the
dedicated verification service admits `verification_benchmark`.

For each run the proof stores a public configuration wrapper under `internal/` with
the parsed input configuration, Ed25519 public key, and key ID.  Its private key is
generated in memory and is never written.  A retained, content-addressed restricted
source snapshot includes Base64 source bytes and SHA-256 digests for the bounded
worker/activity, runtime configuration, offline executor, publication builder,
benchmark evaluator, durable run store, and publisher sources.  Its scope explicitly
states that it is not a complete deployment image.

The primary receipt's result artifact is hydrated through the real registered
artifact resolver and checked with `verifyVerificationBenchmarkPublication` and the
retained public key.  The proof retains only compact references in the receipt.

## Latest actual run

Ran from `ai-engineer-knowledge-services`:

```text
node ../internal/verification-run-local-proof.mjs benchmark-worker
```

Passed receipt:
`../internal/verification-benchmark-worker-62c9b30e-fb46-478c-9e8c-3da5701fce3a.json`.

It recorded three actual operation IDs, one from each transport surface:

```text
49164749-a2e4-5b7a-ac0d-cd01edf6a092  authenticated HTTP + generated client
d9893c6b-0cc3-5a9b-ad84-9cc16deb42f0  built CLI --wait
6b5418d5-337c-5df5-a50b-62bc058c099c  MCP tool adapter
```

All checks passed:

- configured handler creation and authenticated HTTP exact retry idempotency;
- ungranted dataset denial and queued/completed client status;
- compact receipt parsing with engineering-only quality claims;
- Ed25519 verification of the hydrated publication artifact;
- primary operation: one sealed benchmark run, four canonical `eval_run` rows, and
  172 durable checkpoints;
- CLI and MCP each reached canonical worker completion; across all three transport
  operations the fresh attempt has exactly 12 published evaluation runs;
- `externalProviderRequests: 0`.

The receipt identifies source snapshot
`474dd714-ee6f-5c82-a29d-6e5b403daa61` with digest
`sha256:24678cd6c5fb4832c6087e5a12a834432479e247711b60183fe3ddc95ff847f9`,
and links the public configuration wrapper and public Ed25519 verification key.

## Cleanup and limits

The proof cancels any submitted operation left queued or running when it exits and
SIGKILLs a built CLI child that exceeds its bound.  Successful operations remain as
canonical audit records.

This proves configured execution and all four local transport surfaces.  It does not
prove process-death recovery, worker fencing after a crash, public benchmark reads,
or any provider dispatch; the crash proof owns the first of those boundaries.

## Standalone compiler and generic-operation follow-up

The standalone proof TypeScript project now sets `exactOptionalPropertyTypes` to
`false`, matching `apps/mcp/tsconfig.json`.  This is a narrow compiler-boundary
override for the source-imported MCP adapter: its stateless SDK transport deliberately
uses optional fields with `undefined`, and changing that transport merely to satisfy a
consumer's compiler setting would change a separate app's boundary.  The shared base
configuration remains strict.

The generic `POST /v1/operations` route now maps
`OperationCapabilityUnavailableError` to the sanitized `503
CAPABILITY_NOT_ADMITTED` problem response.  The generic service intentionally does
not admit `verification_benchmark`; the dedicated verification route remains the only
benchmark entry point.  The API regression test uses the real default Postgres
operation service with a `createOperation` spy and proves the denied generic request
never reaches a database write.

Focused validation passed:

```text
corepack pnpm exec tsc -p scripts/tsconfig.verification-benchmark-worker.json
corepack pnpm --filter @aiengineer/knowledge-mcp typecheck
corepack pnpm --filter @aiengineer/knowledge-mcp test          # 15 passed, 1 skipped
corepack pnpm --filter @aiengineer/knowledge-api typecheck
corepack pnpm --filter @aiengineer/knowledge-api test -- server.test.ts
                                                           # 53 passed, 5 skipped
```
