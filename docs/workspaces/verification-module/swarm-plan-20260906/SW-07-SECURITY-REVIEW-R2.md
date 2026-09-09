# SW-07 independent security review R2

Review date: 2026-09-06. Reviewer did not author the dashboard or configuration changes. This was a source and focused-test review only; no database, provider, dashboard build, or browser/E2E operation was performed.

## Reviewed snapshot

The dashboard and `packages/config/src/index.ts` were untracked in the Mission Control checkout at review time, so the hashes below identify the exact reviewed working-tree snapshot.

| File | SHA-256 |
| --- | --- |
| `ai-engineer-mission-control/apps/dashboard/src/server/config.ts` | `F80C10D75FDCBAD18956372CEDA72BB0B304FEC061C4DDF4EB3B320C34C7A32B` |
| `ai-engineer-mission-control/apps/dashboard/src/server/proxy.ts` | `7F4F8828E73E030803F6DCD5F5CC5A98158D26595E89CA6A3F21638C86CC6FA9` |
| `ai-engineer-mission-control/apps/dashboard/src/server/launch-shape.ts` | `B6F74131FB6A70CA5084BD448F1B1A34AFAEAA90815EEA843E9218271EF859F1` |
| `ai-engineer-mission-control/apps/dashboard/src/server/allowed-paths.ts` | `5BF161352E336C995C805E6385BF366A9E2872783C2FB042DA81384D6410E21A` |
| `ai-engineer-mission-control/apps/dashboard/src/server/dto.ts` | `89414EC5EAE7CFE7E1851D0B9B1DE16346C3832DC4D7FB572862B362A9D40DE9` |
| `ai-engineer-mission-control/apps/dashboard/src/server/proxy-auth.test.ts` | `DB3B9D12723015A1563ACE286A12138026370DFE9D098D963762F40A4E8DF09C` |
| `ai-engineer-mission-control/apps/dashboard/src/server/proxy.test.ts` | `0B775C210386DA82C14A663FCCD70F71290B4A71F08705BBC32373185B8E1DFA` |
| `ai-engineer-mission-control/packages/config/src/index.ts` | `4053684C7DA96F491B5DF0DDD920E23B49C02C275792F0DDFF1ECEAC5830933E` |
| `ai-engineer-mission-control/packages/config/src/index.test.ts` | `E85917D62AD77FA7E3403D0E639D915A7A3740DBF862EDE82F65A5D15488076A` |

## Findings

### P1 — production authentication issuer and cookie lifecycle are absent

`getDashboardSession` correctly verifies a HMAC, validates subject, tenant, mission, role, CSRF token, and an unexpired `expiresAt`. It then uses the signed tenant and mission values for the server-injected upstream headers. That only establishes a trustworthy browser authority if an authenticated server-side issuer binds those claims to the real operator.

The reviewed dashboard has no login/auth callback, issuer, `Set-Cookie` route, session revocation or renewal path, or deployment runbook for that binding. The sole minting function is explicitly named `signDashboardSessionForTest`, while its comment merely says production auth “must set” `Secure; HttpOnly; SameSite=Strict`. Consequently an implementation cannot demonstrate that a principal's role, tenant, and mission are obtained from authentication rather than chosen by whoever holds `DASHBOARD_SESSION_SECRET`; it also cannot demonstrate cookie expiry/max-age, secure delivery, or invalidation behavior. Because the proxy sends server-held service tokens, this is a confused-deputy blocker.

Remediation: add a production-only issuer boundary that resolves the authenticated identity and its server-owned tenant/mission grants, signs only that result with a short absolute expiry and per-session CSRF value, and writes `mc_dashboard_session` with `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`, and matching `Max-Age`/`Expires`. Document secret rotation, logout/revocation, grant changes, and upstream token least privilege. Add tests showing no cookie before authentication, issuer-denied unauthorized or ungranted scopes, expired signed cookie denial, and authenticated issuance attributes.

### P1 — the required authenticated proxy regression suite is currently red

`corepack pnpm --filter @aiengineer/mission-dashboard test` exited 1. `proxy-auth.test.ts` expects a 202 upstream response but posts no launch body. The proxy correctly calls `assertDashboardLaunchShape`, rejects that missing body, and returns 400. The failing test is the only test intended to reach the upstream proxy and assert DTO projection, so it currently proves neither forwarding nor response redaction.

Remediation: make that test submit a complete valid launch object with UUID tenant and mission values matching the signed session, then assert the forwarded request retains the exact approved body and injected headers. Add a separate multi-tenant negative fixture: a valid signed session for scope A with a complete body scoped to B must return 400 and never call upstream. This makes the existing binding in `launch-shape.ts` durable against regression.

### P2 — DTO filtering is a recursive key filter, not a response contract

`compactDashboardDto` recursively allows scalar values for generic keys such as `reason`, `error`, `label`, and `items`; it does not impose endpoint-specific object schemas, value types, bounds, or a policy for sensitive text placed under an allowed key. It does remove nested objects whose keys are `manifest`, `token`, `secret`, etc., which covers the test fixture, but an upstream value such as `{ error: "provider returned token …" }` or `{ items: [{ id: "x", reason: "raw source bytes …" }] }` reaches the browser. The dashboard architecture promises no credentials, provider bodies, or source bytes.

Remediation: use a compact schema per permitted upstream response, or make the generic projector allow only typed/length-bounded fields whose values are known public. Add tests for sensitive strings under allowed keys and for unknown nested structures within `error`/`items`.

### P3 — proxy transport lacks explicit redirect, timeout, and response-size controls

The proxy copies the request query verbatim and invokes `fetch(target, init)` without `redirect: "error"`, an `AbortSignal` timeout, or a bounded body reader. Current allowed Knowledge query use is pagination and current MC launch scope is checked against the signed session before forwarding, so this review found no current cross-tenant launch-body bypass. Nevertheless the high-authority server token proxy should fail closed on redirects and bound waiting/response parsing so a compromised or misconfigured upstream cannot turn it into an unbounded resource consumer.

## Controls confirmed in this snapshot

- Missing, forged, malformed, and expired session values are denied by signature and claim validation; expiry is checked against the current Unix time.
- Mutation requests require an operator/mission-admin role, exact same-origin `Origin`, and a session-bound `x-dashboard-csrf` value.
- Launches are strict-shaped and require `body.context.tenantId` and `body.context.missionId` to equal the signed session scope before the wholesale body is forwarded. This blocks the session-A/body-B attack described in review.
- Path segments and methods are closed-allowlisted. Credentials remain server-side and responses are projected before serialization.
- The shared Temporal configuration parses only host:port endpoints, chooses TLS from the normalized locality test, requires a key, non-local address, and non-default namespace for production, and both API and worker can use `temporalConnectionOptions`.

## Verification commands

| Command | Exit | Result |
| --- | ---: | --- |
| `corepack pnpm --filter @aiengineer/mission-dashboard typecheck` | 0 | TypeScript check passed. |
| `corepack pnpm --filter @aiengineer/mission-dashboard test` | 1 | 6/7 tests passed; the upstream projection test failed with 400 versus expected 202 because its request omitted the now-required strict launch body. |
| `corepack pnpm --filter @aiengineer/mission-config test` | 0 | 12 tests passed, including remote TLS, blank-primary-key fallback, malformed endpoint, and production-local rejection cases. |
| `corepack pnpm --filter @aiengineer/mission-config typecheck` | 0 | TypeScript check passed. |

