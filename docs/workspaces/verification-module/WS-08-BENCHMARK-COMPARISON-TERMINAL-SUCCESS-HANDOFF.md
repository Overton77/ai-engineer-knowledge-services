# WS-08 benchmark comparison terminal success handoff

Updated 2026-09-05. This slice implements review finding 3 only. It adds the
forward-only migration
`20260906030900_verification_benchmark_comparison_terminal_success.sql` and a
rollback-safe terminal proof. It makes no whole-service or EV acceptance claim.

## Terminal ordering enforced

The migration follows the canonical `PostgresCanonicalRepository.completeStep`
order:

1. a comparison step may become `succeeded` only after its unique durable
   comparison is `sealed`;
2. the successful receipt must then bind the exact comparison, input run IDs,
   publication artifact and payload digest, result digest, gate outcome,
   all-false quality claims, succeeded step input, fencing token and preceding
   success event;
3. the comparison operation may become `succeeded` only when exactly one such
   receipt exists.

The guards cover INSERT as well as UPDATE where an initially terminal row could
otherwise bypass a transition trigger. A second successful receipt for the same
step is rejected. Failed receipts and non-comparison operations retain their
existing behavior.

## Proof

The actual lifecycle proof used a live lease and the real
`database.completeStep` path. It passed 20 checks, including unsealed completion
rejection, drifted receipt rollback, canonical success, exact retry with one
receipt, the dedicated publication type, custody, semantic transformation and
lease fencing:

- `internal/verification-benchmark-comparison-lifecycle-3bc94031-9325-4ba3-b3b1-f41b271b7d6a.json`
- SHA-256:
  `3808cad40a1ff4a428038adbe89bb854a48816cc8f7e80fc3165d7db5bf60d11`

The focused terminal SQL proof then read that canonical succeeded row and ran
fresh initial/update early-success, duplicate receipt and immutable receipt
negatives inside a transaction that was deliberately rolled back. It disabled
no production trigger and passed 13 checks:

- `internal/verification-benchmark-comparison-terminal-success-50eea137-5c6d-42e4-8555-9142b46080d2.json`
- SHA-256:
  `fb9cec17d99a01c314314e6f70ef67581c0f65b7aa5f62c786a6552bb65906a8`

The independent native audit verified the exact six Storage artifact byte
payloads, three Ed25519 signatures, profile/result/publication bindings and 14
scoped current source files with zero provider requests:

- `internal/verification-benchmark-comparison-audit-20260906.json`
- SHA-256:
  `d3faade2853e9250c5a36b1fe46af5f57626f191b1dcd11b530a8600b25e3062`

The strict proof TypeScript check passes:

```text
corepack pnpm exec tsc -p scripts/tsconfig.verification-benchmark-comparison-terminal-success.json
```

## Review closure map

- `30700` and `31200`: dedicated comparison-publication type and terminal type
  enforcement.
- `30800`: exact ordered artifact custody.
- `30900`: exact terminal receipt, step and operation success.
- `31000`: transaction-local live lease/fencing claim.
- `31100`: canonical semantic transformation and digest binding.

The coordinator owns EV-072/EV-073, status, work-item and release decisions.
