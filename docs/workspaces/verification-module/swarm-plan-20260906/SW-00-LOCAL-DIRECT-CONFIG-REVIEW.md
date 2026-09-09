# Local direct configuration review

Independent read-only review completed 2026-09-07 for the explicit `VERIFICATION_LOCAL_DIRECT_DEFAULTS=1` path in the root proof wrapper.

## Remediation re-review

The original blocking finding is resolved. The wrapper now delegates child construction to `internal/verification-local-proof-environment.mjs`; it no longer spreads `process.env`. The helper case-folds a compact system and known proof-control allowlist, overrides all DB/Storage values from verified local configuration, excludes `NODE_OPTIONS` and unrelated credentials, and passes `AI_GATEWAY_API_KEY` only to the five explicitly named paid/reconciliation modes.

Both the direct-default and `supabase status` paths flow through the same endpoint validator. It accepts only `127.0.0.1` or `localhost`, PostgreSQL port `54322` with the exact `/postgres` path, and HTTP API port `54321` with root path. User info is forbidden for the API endpoint; query and fragment overrides are forbidden for both. Remote hosts, wrong ports/schemes/paths, and URL query/hash overrides fail closed as `LOCAL_PROOF_ENDPOINT_INVALID` before a child is started.

## Verified properties

- The direct loader hardcodes `127.0.0.1:54322` for PostgreSQL and `127.0.0.1:54321` for Storage/API; it does not read `.env` files or accept externally supplied endpoints.
- PostgreSQL preflight has 5-second connection/query/statement bounds, begins `READ ONLY`, checks the expected migration ledger entry, rolls back, closes the client, and converts every failure to `LOCAL_DEVELOPMENT_DB_PREFLIGHT_FAILED`.
- Storage preflight targets the fixed loopback URL, supplies only an in-memory locally derived development service JWT, uses a 5-second timeout and `redirect: 'error'`, cancels the response body, and fails closed as `LOCAL_DEVELOPMENT_STORAGE_PREFLIGHT_FAILED`.
- The loader exports nothing or logs nothing at module import. A safe import-only check completed with `loader-module-imported-without-running-preflight`; no key material was printed. No loader invocation, database query, Storage request, proof, migration, reset, provider request, or environment-file load was performed during this review.
- The wrapper's reset-incident guard remains fail-closed for the two retired live modes and does not reset state.
- The environment helper tests cover excluded remote-style credentials and `NODE_OPTIONS`, gated Gateway-key forwarding, and remote/redirected/wrong-port endpoint rejection. They pass three of three.

## Source and command evidence

| File | SHA-256 |
| --- | --- |
| `internal/verification-local-direct-config.mjs` | `BB589A76BF6F18FA9E677E247B2D4A831E9D53A7725A1AEDF96EECADF53F6E1A` |
| `internal/verification-local-proof-environment.mjs` | `3BD740ADC95031DC28E41D69E7BCD5193134BA2DDE831CE0BA6EAB7C36201C54` |
| `internal/verification-run-local-proof.mjs` | `31E2A9A5F2F289A7D67BF04283A5FBEB0E3575F70DB6C590789E04D6CDA895A8` |

| Command | Exit | Evidence |
| --- | ---: | --- |
| `node --input-type=module -e "import('./internal/verification-local-direct-config.mjs').then(() => console.log('loader-module-imported-without-running-preflight'))"` | 0 | Module import has no preflight side effect and emitted no configuration secrets. |
| `node --test internal/verification-local-proof-environment.test.mjs` | 0 | 3/3 allowlist, paid-mode, and endpoint-negative tests. |
| import-only loader plus synthetic `localProofEnvironment` check | 0 | Confirmed the loader export and local endpoint overrides while asserting remote token and `NODE_OPTIONS` omission; output contained no credentials. |

## Scope

This is source and import-only evidence. It does not establish that local services are currently reachable, that any proof completed, or that remote infrastructure is unaffected.
