# SW-06 Consumer Proof Harness HTTP bridge independent review

Reviewed on 2026-09-08. This is loopback-only preparation for D-017; it does not
authorize, start, or validate a tunnel, Cloud namespace, remote endpoint, or
production deployment.

## Scope and evidence

- Proposal: `SW-06-CLOUD-ENDPOINT-PROPOSAL-20260908.md`.
- Bridge: `C:\Users\Pinda\Proyectos\aiengineer\internal\verification-cph-http-bridge.mjs`.
- Local suite: `node internal/verification-cph-http-bridge.test.mjs`, exit 0.
- Independent receipt: `C:\Users\Pinda\Proyectos\aiengineer\internal\verification-cph-http-bridge-independent-review-20260908.json`.

The receipt records exact SHA-256 values for the bridge, test, original Luna
receipt, proposal, and the reviewed Mission Control route implementation. It
contains no credential value.

## Findings and repair

The initial bridge had two material gaps: it admitted only `POST`, although
Mission Control uses `GET /v1/verification/executions/:workflowId` for terminal
read, and it checked expiry only before a request body was read. It also accepted
a JSON-shaped upstream response with a non-JSON media type and accepted
`localhost` as a potentially name-resolved upstream target.

The reviewed repair now permits only planned `POST` or `GET` method/path pairs,
requires the SHA-256 of every corresponding body (including the empty GET body),
and forwards the original allowed method. It rechecks expiry immediately before
the upstream dispatch, binds upstream only to literal `127.0.0.1`, uses an
independent fixed Mission Control authorization header, rejects reuse of the CPH
bearer and unsafe hop/body headers, caps request/header and upstream work time at
five seconds, denies redirects, caps the response at 64,000 bytes, and requires
`application/json`. Responses are `no-store`, `nosniff`, and connection-closing.

The local test uses an actual loopback HTTP upstream. It verifies denial before
dispatch for wrong bearer, query, changed body, and oversize body; exact fixed
headers without caller authorization forwarding; planned launch and planned
terminal-read shape; redirect denial; expiry after a partial body; strict JSON
media; literal-loopback rejection; and CPH-bearer reuse rejection.

Mission Control compatibility is source-verified against
`apps/api/src/verification-http.ts`: launch is the documented `POST
/v1/verification/executions` bearer-authenticated route, while terminal read is
the documented `GET /v1/verification/executions/:workflowId` route with fixed
`x-tenant-id` and `x-mission-id` scope headers. The bridge test exercises those
method/path/header requirements against its loopback upstream. It does not claim
that a Mission Control server was started.

## Conclusion and limits

No remaining material flaw was found in the bounded bridge after the repair and
local rerun. The boundary is suitable only as a prepared, fixture-scoped,
expiring loopback component. D-017 remains proposed: any future use still needs
the separate execution approval and the proposal's tunnel inspection, account,
expiry, fixture, cleanup, and accounting checks.

## R2 final hardening review

The earlier independent receipt remains retained as superseded preparation:
`internal/verification-cph-http-bridge-independent-review-20260908.json`. The
final receipt is
`internal/verification-cph-http-bridge-independent-review-20260908-r2.json`.

R2 removes request-target normalization from the security boundary. Configured
paths must be canonical, and the bridge now looks up the raw HTTP target only;
it rejects dot-segment, percent-encoded, backslash, fragment, query, repeated
slash, and absolute-form aliases before body handling or upstream dispatch. The
route policy still permits only exact planned `POST` and `GET` targets.

The body reader now settles on `end`, `aborted`, or `error`; an oversized input
is paused immediately and receives a bounded rejection, so it cannot remain an
unresolved handler or dispatch upstream. The constructor also rejects a
non-integer listen port, bearers shorter than 32 UTF-8 bytes, unsafe header
values, and duplicate fixed header names after case normalization. Response
media parsing accepts exactly `application/json` and
`application/problem+json`, with optional parameters, and rejects lookalikes
such as `application/jsonevil`. The loopback suite passes raw-alias, abort,
oversize, `problem+json`, and constructor-rejection controls.
