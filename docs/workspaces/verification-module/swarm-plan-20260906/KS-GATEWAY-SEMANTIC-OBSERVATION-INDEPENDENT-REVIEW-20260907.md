# Knowledge Services gateway semantic-observation independent review

Reviewed 2026-09-06 as a source-only review. No provider, database, or Redis connection was made.

## Snapshot

| File | SHA-256 |
| --- | --- |
| `ai-engineer-knowledge-services/packages/verification/src/providers/gateway.ts` | `DE9C5D4508A87599460852C85A91B6E4BC899AA66908CA40A551D73DA5581E2C` |
| `ai-engineer-knowledge-services/packages/verification/src/providers/gateway-semantic-observation.test.ts` | `1E60EFF6D25E94C9F9DB960CE7BC00AE45616311409372FEDF5C9D55C8578E77` |

## Result

The response custody ordering is correct in the reviewed adapter: it persists bounded original response bytes through `persistAfterResponse` before parsing the response or invoking `recordObservation`. The observation contains immutable request and raw-response digests, configured deployment/requested-model identity, observed model state, revalidation flag, and parsed usage. It cannot replace the configured judge identity.

A changed provider model is observed after raw retention and then fails closed with non-retryable `PROVIDER_RESPONSE_INVALID`. Observation-persistence failure after raw retention becomes non-retryable `PROVIDER_ARTIFACT_PERSISTENCE_FAILURE`; the focused test confirms one dispatch only, so that failure does not cause an in-method redispatch. Usage omits unknown values and treats BYOK cost as unknown rather than zero.

## Limitation requiring an integration proof

The adapter accepts a response with an absent `payload.model`, records `modelStatus: "missing"` and `revalidationRequired: true`, then may return a semantic judgment. Whether that is an acceptable provisional result depends on the downstream observation consumer enforcing revalidation before any admission or drift-free claim. That consumer/persistence binding was outside this bounded source scope; the adapter test is a callback mock, not a durable custody proof. Do not claim production model-identity closure from this review alone.

## Commands

| Command | Exit | Result |
| --- | ---: | --- |
| `corepack pnpm --filter @aiengineer/knowledge-verification exec vitest run src/providers/gateway-semantic-observation.test.ts` | 0 | 4 passed. |

