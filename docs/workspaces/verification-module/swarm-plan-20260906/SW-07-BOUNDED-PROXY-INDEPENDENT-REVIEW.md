# SW-07 bounded proxy independent review

Reviewed 2026-09-06, read-only. Scope: Mission Control dashboard `src/server/proxy.ts`, `read-bounded-text.ts`, tests, and the KS/MC route allowlist. No dashboard source, database, provider, or shared runtime was changed by this review.

## Result

No blocking finding.

- `readBoundedText` enforces the byte ceiling while streaming, before UTF-8 decoding and JSON parsing. It rejects an oversized or malformed declared length, cancels an oversized chunked stream, counts actual UTF-8 bytes even when the header understates them, and fails on invalid UTF-8 rather than decoding replacement text.
- The proxy applies the bounded reader to browser mutation bodies and upstream responses. It retains the 100 KB request and 512 KB response ceilings, five-second upstream deadline, and redirect rejection.
- Forwarded projected responses force `application/json`, use no-store caching, and set `X-Content-Type-Options: nosniff`; upstream content types and bodies do not pass through untouched.
- The closed allowlist correctly removes the invented dashboard paths `POST /v1/verification/operations/:id:retry` and `:reconcile`. The supported generic event path remains `GET /v1/operations/:id/events`; no dashboard control depends on the removed paths.

## Observed minor consistency gap

`problem()` responses are JSON and no-store, but do not add `X-Content-Type-Options: nosniff`. Forwarded projected responses do. This does not expose an upstream body or permit an unsupported route, but adding the same header to local error responses would make the forced-JSON/nosniff policy uniform across the dashboard API boundary.

The coordinator reports `corepack pnpm verify` exit 0 in `internal/verification-mission-full-verify-20260907.log`, including dashboard tests, typecheck, lint, and build. This review makes no full dashboard-acceptance claim.
