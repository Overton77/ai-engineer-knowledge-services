# WS-08 provider HTTP-status handoff

Updated 2026-09-06. This is an adapter-boundary implementation handoff, not
provider or storage acceptance. No provider was called.

`ProviderArtifactSink.persistAfterResponse` now accepts an optional
`httpStatus`. This preserves retained-replay and custom sinks that do not have
an observed HTTP response.

Gateway semantic and structured extraction adapters pass `Response.status` to
raw-response custody after bounded bytes are read and before HTTP status checks
or JSON/schema interpretation. Interfaze does the same for its raw custody call
and its later precontext custody call. The status is observed from the actual
response; no default status is invented for older callers.

Focused tests cover successful Interfaze custody, Interfaze precontext custody,
a Gateway HTTP 200 response rejected by output-schema validation, and a Gateway
503 response rejected as retryable HTTP failure. Each proves the actual status
reaches custody before the later failure or parsing path.

Validation:

```text
pnpm --filter @aiengineer/knowledge-verification exec vitest run src/providers/providers.test.ts
pnpm --filter @aiengineer/knowledge-verification exec tsc --noEmit
```
