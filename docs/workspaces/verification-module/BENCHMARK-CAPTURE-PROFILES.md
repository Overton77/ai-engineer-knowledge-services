# Server-owned benchmark capture profiles

The API supports `POST /v1/verification/benchmark-capture-profiles/{profileName}/captures` with the existing acquire-mode capture request. A bearer token, correlation ID, and idempotency key accompany the request. Tenant, attempt, work-item, mission, causation, and external execution routing headers are rejected on this route.

Configure `VERIFICATION_BENCHMARK_CAPTURE_PROFILES_JSON` on the API as an array of objects with `profileName`, `tenantId`, `actor`, `missionId`, `workItemId`, and `attemptId`. These must refer to existing canonical ownership. The profile name is an opaque lowercase identifier, at most 64 characters. Profiles do not create actors, tenants, missions, or attempts.

The existing `VERIFICATION_SERVICE_OWNERSHIP_GRANTS_JSON` must grant that actor the mission and deployment. The bearer identity must separately hold `operation.submit` for the configured tenant. The resolver verifies the canonical attempt/work-item/mission/deployment relationship through the existing ownership resolver. Unknown, unauthorized, or stale ownership returns a generic 404. Existing source-acquisition catalog grants still apply and ungranted source URIs return 403.

The response is `{tenantId, operation}`, where `operation` is the standard accepted operation resource. The TypeScript client's `captureVerificationSourceWithProfile` exposes this path without accepting caller-controlled routing context. Clients can use the returned tenant with the ordinary authenticated operation/capture reads.

Native proof `internal/verification-source-acquisition-native-b7f8e92e-a4f3-46b8-bc87-f930dc7a854e.json` exercises profile submission through Fastify injection, actual canonical ownership lookup, worker acquisition, Storage/parser custody, and authenticated terminal read. Wrapper `internal/verification-source-acquire-isolated-dd5d1031-253c-4d05-b3cd-19628d606d7b.json` records isolated database/dump cleanup and zero model calls. This is not a listening API deployment or the completed sixteen-source CLI refresh/proposal workflow.
