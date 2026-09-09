# SW-12 VR-032 independent acceptance review — 2026-09-08

## Recommendation

**VR-032 has sufficient whole-row evidence for coordinator promotion to `proved`.** Its exact requirement is that the dashboard initially reads through supported server/API boundaries and that controls never directly mutate canonical tables. The current dashboard meets both clauses. This conclusion does not promote VR-036.

## Evidence inspected

The machine audit `internal/audit-verification-dashboard-vr032.mjs` passed and retained `internal/verification-dashboard-vr032-independent-audit-20260908.json`. It verified the two supplied receipts, all 30 route-inventory source hashes and all adjudication-read source hashes against current bytes, checked seven focused test files, and inspected the actual allowlist/proxy boundary.

The inventory covers 15 dashboard pages and ten browser controls. Every data-bearing dashboard page reaches Mission Control or Knowledge Services through authenticated same-origin dashboard proxy routes. The proxy derives upstream credentials, tenant and mission from the signed server session; it validates path segments and exact method/path allowlists before forwarding; it bounds request and response sizes; and it parses/projects upstream JSON into endpoint-specific DTOs with `no-store` and `nosniff` headers. Browser code does not receive server credentials.

The only allowlisted dashboard mutations are Mission Control execution launch and cancellation. Both require an operator-capable role and same-origin CSRF; launch additionally receives bounded shape and scope validation. These controls call Mission Control HTTP. They do not import a database client or write canonical tables directly. The Knowledge Services proxy allowlist contains reads only. Static inspection of the full receipt-listed dashboard source set found no `pg`, Postgres, Supabase, Prisma or Drizzle client import.

The adjudication page is a pending-subject read. The retained local browser proof records operator login, actual KS adjudication GET, dashboard proxy traversal, pending-detail rendering, no decision/admission control, zero provider calls and zero mutations. Its source hashes match. The existing inventory also cites EV-122 for native local launch/cancel, claims/report terminal rendering and evidence navigation; this bounded review relies on that retained lifecycle claim and did not reopen every EV-122 CAS object.

Five supported read endpoints are allowlisted but not issued by the current UI. This does not contradict the row: VR-032 specifies the dashboard's initial boundary and mutation architecture, not complete UI exposure of every upstream capability. Informational pages make no request and explicitly avoid a hidden direct persistence path.

## VR-036 boundary

VR-036 remains `partial`. VR-032 proves architecture and custody of existing reads and launch/cancel controls. It does not establish a dashboard replay control, promotion control, authenticated human decision authority, production recovery, or remote deployment. The pending adjudication reader deliberately exposes no decision control. Those omissions belong to VR-036 and rollout rather than weakening VR-032's no-direct-canonical-mutation guarantee.

## Limits

This auditor performed source/hash and receipt inspection only; it did not rerun the dashboard test suite, invoke a provider, or mutate a database. The route receipt states its focused dashboard suite ran, and the adjudication receipt retains one local browser proof. Remote deployment and Cloud behavior are outside this review.
