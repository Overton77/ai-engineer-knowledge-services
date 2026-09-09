# Comparison service review — 2026-09-06 UTC

Coordinator accepts EV-074 for configured local comparison execution and authenticated statistical reads. This extends EV-072/073; process-kill recovery and the full module remain open.

## Runtime and surfaces

`VERIFICATION_BENCHMARK_COMPARISON_CONFIG_JSON` supplies schema `verification-benchmark-comparison-runtime.v1`, tenant ID, one or two exact registered profile artifact grants, trusted input publication Ed25519 public keys, and runtime custody without attempt ID. The worker supplies the current canonical attempt. Dirty runtime state requires an exact same-tenant source artifact. API ownership grants remain required. Missing configuration denies execution; ungranted profiles fail before operation creation. Preserve exact profile/runtime grants while operations are pending: changing them intentionally fails identity validation on retry.

The worker additionally requires `VERIFICATION_BENCHMARK_COMPARISON_SIGNING_PRIVATE_KEY_PEM` and `VERIFICATION_BENCHMARK_COMPARISON_SIGNING_KEY_ID`. These are operator secrets, never caller fields or retained proof material. Reads independently require `VERIFICATION_BENCHMARK_COMPARISON_READ_PUBLIC_KEYS_JSON`, an array of `{keyId, publicKeyPem}` Ed25519 public keys. Existing local/production database and Storage configuration supplies persistence. This evidence uses local services only.

| Surface | Submission | Read |
| --- | --- | --- |
| HTTP | POST `/v1/verification/benchmarks::compare` | GET `/v1/verification/benchmarks/comparisons/:comparisonId` |
| TypeScript client | `compareBenchmarkRuns` | `getBenchmarkComparison` |
| CLI | `benchmark compare` with existing JSON/context/wait arguments | `benchmark comparison` with comparison ID JSON |
| MCP | `knowledge_compare_benchmark_runs` | `knowledge_get_benchmark_comparison` |

The worker regenerates trusted preparation on retry, retains canonical timestamps and deterministic comparison identity, then completes and seals through the fenced durable store. Canonical worker completion owns the sole receipt. CLI wait treats an observed regression-gate failure as exit 1 without asserting human quality. Reads require sealed comparison plus succeeded canonical operation, exact receipt, admitted dedicated artifact types, actual registered bytes and full handles, signature, runtime/input/profile/result bindings, and result self-digest. The public projection excludes object paths and signature material and explicitly disclaims assessed cluster independence and human-gold quality.

## Reviewed evidence

- Worker receipt `../../../../internal/verification-benchmark-comparison-worker-f861733d-499b-43d0-96a5-4596ee51944c.json`, SHA-256 `fd5abfea069e7bbfe01adf0bc2d32b5f74d626886373d4b0853617d4d116153a`: nine groups, three actual succeeded/sealed operations via typed client, built CLI wait and MCP Streamable HTTP; one receipt per operation; original signed inputs and both v3 profiles; zero provider requests.
- Root independent audits `../../../../internal/verification-benchmark-comparison-worker-audit-{0,1,2}-20260906.json`: each rereads canonical state and receipt, hydrates six Storage payloads, verifies three signatures using native Node crypto, recomputes result digest, and matches eleven scoped source files. Repeated shared inputs are not additional unique benchmark observations. The unsuffixed audit is an intermediate diagnostic; numbered receipts are final.
- Read receipt `../../../../internal/verification-benchmark-comparison-reads-918b9463-6bc8-4b6e-b035-376a2bd2b2f8.json`, SHA-256 `a79f4f3a70949ce26858bf8e1dbcab20b4bc4c4b52dd2f5005f0a95ae30165a4`: seven groups, all four pairs/36 metrics/72 global tests matched to retained result bytes, actual typed client/built CLI/MCP HTTP; missing/foreign 404, invalid/query 400, absent trust/wrong key 503. Root verified all nine snapshot hashes against current source.
- Full workspace `../../../../internal/verification-comparison-service-workspace-20260906.log`: 72/72 uncached typecheck/test/build tasks. Focused additions include three config, seven activity, one factory, three projection and two API read tests. Existing skipped integration tests are not runtime evidence. Contract artifacts regenerated successfully. Standalone MCP proofs explicitly disable `exactOptionalPropertyTypes` for SDK compatibility; production package checks retain their configured settings.

Local database/Kong container restarts restored host connectivity with retained volumes; no reset, remote migration, deployment or provider dispatch occurred. Database contract remains 0.2.15, local migrations through 20260906031200. Human gold remains zero. Recovery after actual OS-process termination, complete retained-call replay, remaining service operations, deployment, dashboard/human review and all other acceptance gaps remain pending.

Final workspace log SHA-256: `5f4aa3a7d72dcc756ae428d73f098937a91d2299e0a0ae2280246bc1e78615d7`. Relevant passing test counts: contracts 34, application 128, persistence 56 (14 pre-existing skips), API 61 (5 skips), CLI 16, MCP 17 (1 skip), worker 57 (5 skips). Runtime claims rely on the actual local proofs, not skipped tests.
