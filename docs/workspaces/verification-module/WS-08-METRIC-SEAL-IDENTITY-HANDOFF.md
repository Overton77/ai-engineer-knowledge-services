# WS-08 metric sealed-run producer identity handoff

Updated 2026-09-05.

## Delivered identity boundary

The metric runtime port now returns:

```ts
{
  runtimePrincipals: RuntimePrincipalBinding,
  producerAttemptId: string,
}
```

`PostgresVerificationMetricRuntimePrincipals` derives `producerAttemptId` from
the registered observations artifact's durable `producer_attempt_id`. Before it
returns the value, its existing query and checks bind the artifact ID/digest/
tenant, artifact mission, producer mission, authenticated verifier attempt and
work item, and verifier mission. The producer attempt is additionally required
to be a UUID. A missing, cross-tenant, mismatched, or malformed binding fails
rather than producing an identity.

`VerificationMetricApplicationService` passes only `runtimePrincipals` to the
deterministic verifier, preserving its mechanical-only result. It places the
validated `producerAttemptId` on `VerificationMetricServiceResult` for trusted
sealed-run composition. Request schemas remain strict; callers cannot submit a
producer attempt or trust finding.

No worker or recorder change is included. A later trusted sealer can pair this
artifact-derived producer attempt with the authenticated verifier context and
optional live lease when it calls `recordVerificationRun`.

## Focused validation

- Application tests confirm the mechanical result retains the resolver-derived
  producer attempt and reject caller-supplied producer identity/trust fields.
- Principal-resolver tests cover the returned producer attempt, durable
  artifact/mission/work-item mismatches, absent rows, and malformed producer
  attempt UUIDs.

```text
vitest run packages/application/src/verification-metrics.test.ts \
  packages/persistence/src/verification-metric-principals.test.ts
# 13 passed
packages/application: tsup + declaration emit
packages/persistence: tsup + declaration emit
```
