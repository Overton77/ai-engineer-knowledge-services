# SW-07 dashboard independent review

Date: 2026-09-06
Reviewer: semantic agent
Scope: read-only inspection of Mission Control dashboard server/session/proxy, allowlists, route handlers, Live view command handling, resource projection, and tests. Dashboard source was not edited.

## Findings

### P0 — static environment credentials grant authority to any unauthenticated browser

`getDashboardSession()` treats `DASHBOARD_*`, `KNOWLEDGE_API_TOKEN`, and `MISSION_CONTROL_API_TOKEN` as the complete session and has no browser session, cookie, issuer, or request principal. If those environment variables are configured, `forwardDashboardRequest()` forwards any same-origin visitor's GETs and operator mutations with server-held bearer tokens. The comment explicitly calls this a temporary pending issuer, so the existing landing E2E does not prove the required authentication boundary. A visitor who can reach `/api/mission-control/verification/executions` can submit arbitrary upstream-valid launch JSON whenever the configured role is operator/mission_admin.

Required fix: resolve a real authenticated browser session on every route, bind tenant/mission/role from the authenticated principal, and keep static environment configuration limited to server-to-server upstream credentials. Add an uncredentialed browser mutation test with configured upstream credentials proving 401/403 and no upstream call.

### P1 — no CSRF or Origin protection on state-changing proxy routes

The POST route accepts requests based only on server configuration and role. It does not check Origin/Referer, CSRF token, or an equivalent same-site browser session. A cross-site form or scripted request can trigger launch, cancellation, retry, or reconcile through the dashboard origin; response CORS protection does not prevent the mutation. This remains exploitable even after adding a browser session if cookie authentication is used.

Required fix: enforce same-origin/CSRF checks for all mutations before upstream fetch, with regression tests for absent and foreign Origin plus valid same-origin requests.

### P1 — client-side resource filtering is shallow and can expose nested manifests/object keys

`ResourceInspector` removes sensitive keys only from the top-level object returned by the upstream API. Nested objects and arrays are rendered unchanged. A nested `manifest`, `objectKey`, `token`, `body`, `bytes`, or billing field can therefore reach the browser. Filtering in a client component is also too late to establish a server projection boundary.

Required fix: return explicit server-side DTOs with allowlisted fields and recursively reject/strip internal fields before serialization. Test nested objects and arrays, including alternate casing and nested manifest structures.

### P1 — dashboard-safe API correspondence is not proved for Knowledge routes

The dashboard allowlist advertises `/v1/verification/{runs,cases,evidence,extractions,benchmarks,...}` reads, but the inspected Mission Control API exposes only `/v1/verification/readiness` and `/v1/verification/executions*`. Those Knowledge targets are delegated to a configured URL without a route contract or response DTO mapper. Current UI text acknowledges missing listing APIs, but no route-level correspondence test proves each allowed target exists and returns the promised compact shape.

## Positive controls observed

The proxy uses a strict path segment regex and explicit method/path allowlists; it does not accept arbitrary proxy paths. Tenant and mission headers are injected server-side. Upstream authorization and response bodies are not forwarded wholesale through response headers. Client code does not contain the configured token names or server config imports. Mutation roles are checked before upstream fetch. The Live view keeps state and disposition separate and displays identity grants as unavailable.

## Verification

Commands (Mission Control repository, pinned toolchain):

- `corepack pnpm --version` — exit 0, `10.34.5`.
- `corepack pnpm --filter @aiengineer/mission-dashboard typecheck` — exit 0.
- `corepack pnpm --filter @aiengineer/mission-dashboard test` — exit 1: Vitest collected `e2e/landing.spec.ts` and failed with Playwright `test() was called here`; the two unit suites still passed (3 tests). This is a test-discovery/configuration defect, not an auth pass.
- `corepack pnpm --filter @aiengineer/mission-dashboard lint` — exit 0; import-boundary check and ESLint passed.

Source hashes:

- `apps/dashboard/src/server/config.ts`: `7C691D189AF9320C3F2ED47D344D25C50A54BCBB9709059FD8545C82446933D9`
- `apps/dashboard/src/server/proxy.ts`: `C439A40F0C32634E3C994DE581BC6B7718456AC27361E0B4AEDABBE421EA7501`
- `apps/dashboard/src/server/allowed-paths.ts`: `5BF161352E336C995C805E6385BF366A9E2872783C2FB042DA81384D6410E21A`
- `apps/dashboard/src/features/runs/resource-inspector.tsx`: `7252F368845EDC32DBABD452CBB438D95214CA033529D6CB0935CC0FA21CCDED`
- `apps/dashboard/src/features/executions/execution-launcher.tsx`: `A0D017E2630705E441C6E272E1912B5807DE40E9E5FA158A5EB5AFC7385C50E4`

No database, provider, browser mutation, or external network call was made during this review. The review is source-level and does not promote any dashboard acceptance row.
