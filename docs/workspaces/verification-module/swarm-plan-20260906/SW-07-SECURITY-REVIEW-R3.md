# SW-07 independent security review R3

Reviewed 2026-09-06 without implementation changes, database access, providers, build, or E2E browser work.

## Snapshot

| File | SHA-256 |
| --- | --- |
| `apps/dashboard/app/api/dashboard/session/route.ts` | `6CBDAFB425F238EEFF8C3822CF1A0F97F085A071A2A45B8FA00BB807357DB04A` |
| `apps/dashboard/app/api/dashboard/session/route.test.ts` | `F8C847002644794DEF09E1851A1058762ACB40BC7AB389C287C8256FD1C7D9C2` |
| `apps/dashboard/src/server/config.ts` | `640AEBB4E42E80EEA2B1511FC1C85A7D10E6E1D49B95E453C2C291CFD6B298AC` |
| `apps/dashboard/src/server/proxy.ts` | `8335B7A57CD817E160302E747002A3B4EC23F74261134C235536667BD7A7E5E3` |
| `apps/dashboard/src/server/dto.ts` | `3AE384EDC88AE89143C4D0581D51D435ED18F77709AB927EEB888D1977F7857A` |
| `apps/dashboard/src/server/launch-shape.ts` | `0CD01D87926BE4E835C8CDE0F13EBAB99AE2D2C2B435B05AE60C76D8BA58E1D8` |
| `apps/dashboard/src/server/launch-shape.test.ts` | `8FA28D605EFBD90FE33B2C1C8C9E6AE6B279B3E32CAF0FD47637D22AFBB3B307` |
| `apps/dashboard/src/server/proxy-auth.test.ts` | `17E396D53E5F4C962F918927E985B722696BC27789CF108A3E26ECDF344AA18E` |

## R2 remediations confirmed

The dashboard now has a real session issuer at `app/api/dashboard/session/route.ts:7-16`. It accepts only a strict token body on same-origin POST, hashes the token, derives subject/tenant/mission/role solely from configured digest grants, and issues a one-hour HMAC session cookie with HttpOnly, Strict SameSite, path, and production Secure attributes. The route tests cover unknown token, foreign origin, caller-selected scope rejection, production cookie attributes, and CSRF-protected logout.

The proxy binds all mutations to a signed session role plus exact Origin and CSRF token (`src/server/proxy.ts:22-25`), requires a matching tenant/mission in a launch context, and has strict request schemas for benchmark, comparison, and extraction requests. It also enforces request/response ceilings, a five-second abort deadline, and `redirect: "error"` (`src/server/proxy.ts:39-55`).

## Remaining actionable issues

### P2 — grant revocation or role/scope change does not invalidate existing sessions

`getDashboardSession` verifies only the HMAC claims against the session secret (`src/server/config.ts:30-44`). It does not confirm that the signed subject/tenant/mission/role still matches a current configured operator grant. `issueDashboardSession` uses the configured grant only at issuance (`src/server/config.ts:47-54`). Removing a compromised token, revoking an operator, or lowering its role therefore leaves an already-issued cookie usable with its original scope for up to one hour. Logout only clears the current browser's cookie.

Add a session identifier with a server-side revocation/version check, or bind each request to the current configured grant and reject stale scope/role claims. Add a test that issues a session, removes or changes its matching grant, and confirms the proxy and logout route deny it.

### P2 — DTO still permits sensitive content hidden inside allowed scalar fields

The projector now bounds depth, arrays, and strings, but it remains a generic key filter. `reason`, `error`, `label`, and nested `items` are allowlisted at `src/server/dto.ts:4`, and their scalar values are forwarded without content classification (`src/server/dto.ts:6-17`). An upstream response such as `{ error: "provider returned Authorization: …" }` or `{ items: [{ reason: "raw source bytes …" }] }` reaches the browser despite the architecture promise not to expose credentials, provider bodies, or source content.

Replace the generic projection with endpoint-specific compact DTO schemas, or remove free-text fields until each has a defined safe format. Add adversarial tests for sensitive text under allowed keys.

## Focused verification

| Command | Exit | Result |
| --- | ---: | --- |
| `corepack pnpm --filter @aiengineer/mission-dashboard test` | 0 | 13 tests passed. |
| `corepack pnpm --filter @aiengineer/mission-dashboard typecheck` | 0 | Passed. |
| `corepack pnpm --filter @aiengineer/mission-dashboard lint` | 0 | Import-boundary and ESLint checks passed. |

