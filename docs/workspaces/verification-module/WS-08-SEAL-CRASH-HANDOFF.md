# WS-08 sealed-run crash child handoff

Updated 2026-09-05.

## Delivered bounded child fixture

`scripts/verification-seal-crash-child.ts` is an IPC-only child for the parent
crash/recovery proof. It refuses startup unless `POSTGRES_URL` points to
`localhost` or `127.0.0.1` on port `54322`, `SUPABASE_URL` points to the local
Supabase endpoint on port `54321`, and the inherited local Supabase service key
is present. It creates local-only `PostgresCanonicalRepository`,
`PostgresVerificationRepository`, and an 8 MB `SupabaseArtifactStore`.

The parent sends exactly one bounded message:

```ts
{
  kind: "fixture",
  fixture: {
    tenantId, operationId,
    profileGrant: { profileArtifact: { artifactId, digest }, observations: { artifactId, digest } },
    policyGrant: { tenantId, policyVersion, policyArtifact: { artifactId, digest } },
    imageDigest,
    verifierDeploymentId
  }
}
```

All outer and nested objects use an exact-key parser. Tenant and operation IDs,
artifact IDs, and SHA-256 digests are checked before composing the metric
service. `policyGrant.tenantId` must equal the fixture tenant.

The child constructs the same admission/parser metadata and metric runtime
components as the local metric proof, then runs the real canonical durable
worker once with a 1.5 s lease. It captures the actual `LeasedStep` immediately
before registry execution. The sealer wrapper invokes the real sealer; only
*after* durable `recordVerificationRun` returns does it send:

```ts
{
  kind: "sealed",
  seal: { runId, manifestDigest, policyOutcome },
  claim: /* full JSON-safe actual LeasedStep */
}
```

It then awaits forever while the real canonical worker heartbeat remains active.
The parent can therefore confirm the durable row, kill the child with SIGKILL,
and use the supplied real claim for stale-completion checks before starting the
replacement. The IPC output contains no environment values, artifact bytes,
provider output, or credential.

The fixture constructs `SandboxedVerificationParser` only to compose the real
admission service. It calls no parser entry point and no provider route: metric
verification rehydrates already admitted local artifacts and projection
receipts.

Before any fixture message, a 30-second timeout sends only
`{ kind: "error", code: "SEAL_CRASH_CHILD_FIXTURE_TIMEOUT" }`, closes the pool,
disconnects IPC, and exits nonzero. Configuration and runtime failures follow
the same safe-uppercase-code IPC path. A parent IPC disconnect after the
post-seal trap closes the pool and exits the child, preventing an orphaned
heartbeat.

## Validation

- The script transpiles under `tsx`; launching without local configuration
  reaches the expected `SEAL_CRASH_CHILD_POSTGRES_REQUIRED` guard before any
  connection or child work.
- Existing focused worker metric-sealer and sealed-replay suites remain green:
  16 tests passed.

The parent-owned orchestrator supplies the fresh registered fixture, starts the
child with IPC, confirms the database state, performs the kill/replacement, and
records the actual custody evidence. This child performs no DB reset, migration,
remote call, or provider execution.
