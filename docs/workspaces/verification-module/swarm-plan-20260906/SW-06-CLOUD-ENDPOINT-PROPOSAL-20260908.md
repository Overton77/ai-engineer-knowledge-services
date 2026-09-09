# D-017 test endpoint proposal

Status: proposed, not started or approved. Read-only preparation on 2026-09-08.

Use the installed ngrok 3.37.1 agent for one temporary HTTPS endpoint in the
Consumer Proof Harness. Forward it to a dedicated loopback bridge exposing only
the exact authenticated Mission Control launch/read/cancel routes needed by the
frozen report fixture. The bridge must use an expiring, fixture-scoped bearer and
fixed upstream routing; it must not expose the general dashboard, database,
Storage gateway, parser, or arbitrary proxy destinations. KS remains reachable
only by the local Mission Control worker. That worker connects outbound to the
user-provisioned Temporal Cloud namespace. This is a Cloud orchestration and
remote-consumer proof with a locally hosted service, not production deployment.

Why this mechanism: KS `infra/aws/README.md` describes ECS worker/Docling
deployment and explicitly excludes API/MCP, which are separate Vercel projects.
MC `infra/aws/README.md` is currently a placeholder for API/MCP containers and
Temporal workers. Building that production infrastructure and applying remote
schema changes would introduce a separate rollout dependency. The installed
ngrok agent supports forwarding a local HTTP service through HTTPS and disabling
HTTP inspection with `--inspect=false` ([official CLI documentation](https://ngrok.com/docs/gateway/agent/cli)).
The local executable's version and help were checked; no tunnel was opened and
account entitlement/authentication was not tested.

Before requesting execution approval, prepare and independently test the
loopback bridge: a maximum 30-minute lifetime, exact method/path allowlist,
constant-time bearer verification, fixed fixture identity, bounded request and
response bodies, upstream deadlines, and denial of missing/expired credentials,
wrong routes, query injection, oversize payloads and redirects. Credentials stay
in host memory/environment and are never written to request logs, prompts or
receipts. Disable tunnel HTTP inspection and verify the account's capture
configuration before any authenticated traffic. Provide only the short-lived
fixture credential through the supported Cursor runtime secret mechanism.

The concrete execution boundary is starting one ngrok HTTPS endpoint against
that independently tested bridge for one frozen Cursor Cloud fixture. Record
the assigned endpoint, process handle, fixture/input/source digests, expiry,
Cloud workflow/history and exact accounting; stop the owned tunnel and bridge
and revoke the fixture credential afterward. Do not modify DNS or install a
background service. A failed or unavailable ngrok account/entitlement is a
readiness failure, not permission to purchase service or choose another exposure
mechanism silently.

D-016 is separately pending: authenticated Cloud namespace discovery returned
zero namespaces. D-019 remote migrations remain a separate user-controlled
window. D-017 has not been accepted; this document does not authorize exposure.

## Prepared implementation — 2026-09-08

The dedicated bridge is implemented in Mission Control at `scripts/verification-loopback-fixture-bridge.mjs`. Its frozen launch is validated by the existing Mission Control kernel and its workflow ID is derived with the production idempotency function. Only exact launch/read/cancel routes are reachable, with fixed server-owned tenant/mission headers and upstream credentials. Maximum lifetime is 30 minutes; expiry aborts active work and closes the listener. Request/response, connection, body, socket inactivity and upstream bounds are enforced. Upstream errors, unexpected fields and non-UUID result identifiers are rejected without forwarding their contents.

The r4 focused suite passes 9/9, including a raw TCP incomplete-header stall. Root independently reran it in `internal/verification-loopback-fixture-bridge-root-r4-20260908.log`. Source-bound receipt: `internal/verification-loopback-fixture-bridge-receipt-r4-20260908.json`, SHA-256 `6f5da8e7641d3831f2688ca284cbba13129200e8007bf2e8aab3e18e18057047`. Independent review accepted r4 in `SW-LOOPBACK-FIXTURE-BRIDGE-INDEPENDENT-REVIEW-20260908.md`; its correction distinguishes Node's periodic header-timeout enforcement from the explicit socket inactivity timer.

Execution still requires D-017 and the D-016 Cloud namespace/address. No tunnel, Cloud workflow or provider call was created. Account capture configuration and supported runtime secret delivery must be checked before authenticated traffic; credentials must never enter prompts or receipts.
