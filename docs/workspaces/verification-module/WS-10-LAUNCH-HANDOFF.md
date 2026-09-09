# WS-10 Mission Control authenticated launch handoff

Updated 2026-09-05. This records the bounded Mission Control HTTP boundary only;
it does not claim a completed production verification deployment.

## Delivered boundary

`ai-engineer-mission-control/apps/api/src/verification-http.ts` exports
`registerVerificationHttp` and a dependency-injected `VerificationExecutionPort`.
The port returns only a compact execution summary:

- `workflowId`
- `state` (`running`, `completed`, `cancelled`, or `failed`)
- optional `disposition`, `operationId`, and `receiptId`

It never exposes workflow history, operation payloads, or receipt bodies. The
Temporal implementation remains behind this port and is responsible for checking
stored workflow ownership against the supplied tenant and mission scope.

Routes are:

- `POST /v1/verification/executions`
- `GET /v1/verification/executions/:workflowId`
- `POST /v1/verification/executions/:workflowId:cancel`
- `GET /v1/verification/readiness`

Launch runs the public kernel's `assertVerificationDispatchLaunchInput` before
the execution port is invoked. This rejects unknown request fields, including
raw source, secrets, and caller actor fields. Launch binds the strict request's
tenant and mission to the authenticated principal grant. Inspect and cancellation
require exact `x-tenant-id` and `x-mission-id` headers, an action grant, and pass
that scope to the port for durable ownership confirmation. Cancellation accepts
no request body.

The HTTP error surface is deliberately sanitized: malformed input is `400`, no
valid bearer is `401`, scope denial is `403`, an absent owned workflow is `404`,
durable identity drift is `409`, and an unavailable resolver or port is `503`.
Readiness returns the port availability capability and returns false if the port
cannot be queried.

## Validation and next proof

Focused unit-only tests in
`ai-engineer-mission-control/apps/api/src/verification-http.test.ts` cover strict
launch validation, authentication/scope separation, required read/cancel scope,
the documented cancellation URL, port ownership inputs, readiness, and sanitized
port failures. They do not call Temporal or Knowledge Services. On 2026-09-05:

```text
pnpm --filter @aiengineer/mission-api exec vitest run src/verification-http.test.ts
6 passed

pnpm --filter @aiengineer/mission-api typecheck
passed
```

The coordinator owns the real `VerificationExecutionPort`, server registration,
and authenticated HTTP-to-Temporal proof. That proof must use a fresh scoped
token and verify the resulting workflow's durable tenant/mission ownership;
unit success here is not a claim of that end-to-end result.

## Real HTTP proof helper

`ai-engineer-mission-control/scripts/prove-verification-http.ts` exports
`proveVerificationHttp`. It starts a local real Mission worker on a unique task
queue plus `createMissionApiRuntime` with a generated, separate Mission bearer.
The fixture supplies a fresh authorized Knowledge Services bearer, tenant,
mission, work item, attempt, and admitted metric request.

The helper proves the route accepts the strict launch, repeats it with the same
workflow identity, rejects a changed request with a recomputed digest as drift,
denies missing/unknown bearer and wrong mission scope, and rejects caller actor
and raw-source injection. It polls the owned compact status to the requested
quality outcome and uses the finished-cancellation route as a scoped idempotent
control. It then fetches the actual Temporal history, checks both bearer tokens
are absent from literal JSON, base64 JSON forms, binary payload values, and
recursively decoded base64 payload strings. It replays the history and writes a
standalone history plus source-hashed custody receipt. The receipt hashes this
helper, the kernel dispatch module, the API server/HTTP/Temporal-port/runtime
modules, and the worker dispatch/activity/workflow/runtime modules. Returned
check names are prefixed with the expected quality disposition so the passing
and quality-rejected fixture results cannot overwrite one another.

The helper only imports and starts local Temporal at `127.0.0.1:7233` in
`verification-local`; it does not reset Temporal, database state, providers, or
remote services. It has been syntax/import checked with `tsx` only. The
coordinator owns the fresh fixture and its one-at-a-time real execution, so no
HTTP proof result is claimed here yet.
