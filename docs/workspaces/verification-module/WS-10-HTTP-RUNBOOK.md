# Mission Control verification HTTP runtime

The Mission API launches the same strict dispatch contract used by the worker. The implementation lives in Mission Control's `packages/mission-kernel/src/verification-dispatch.ts`; the former worker module re-exports it. Knowledge Services remains the verification algorithm owner.

## Configuration

Provision `MISSION_VERIFICATION_IDENTITIES_JSON` as a JSON array of identities with `token`, `tenantId`, and `grants`. Each grant contains one `missionId`, an `operations` array (registered capture, extraction, metric, replay dispatch names), and an `actions` array (`launch`, `read`, `cancel`). Tokens must contain at least 32 characters. Unknown fields, duplicate tokens and duplicate mission grants are rejected. Credentials belong in the deployment secret store. This bearer is independent of the worker's Knowledge Services bearer.

Configure `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, `TEMPORAL_TASK_QUEUE` and, where applicable, `TEMPORAL_API_KEY`. TLS is enabled except for exact loopback port 7233 in nonproduction environments. The worker must use the same namespace and queue, with its own `KNOWLEDGE_API_URL`, `KNOWLEDGE_API_TOKEN`, and `VERIFICATION_DISPATCH_GRANTS_JSON`. Knowledge Services separately validates canonical attempt ownership and its external execution grant.

Without API identity configuration, health/readiness remain readable, verification availability is false, and launch requires authentication. Configured availability checks for a recent Temporal workflow task poller. This is a queue liveness signal; the worker's downstream credentials and operation-specific grants are established by the end-to-end deployment proof.

## Commands and semantics

- `POST /v1/verification/executions` accepts the strict `VerificationDispatchRequest`: operation, routing context, registered artifact request, and canonical request digest. It returns 202 and compact workflow status. Actor/deployment credentials and raw source content are excluded from this input.
- `GET /v1/verification/executions/{workflowId}` requires bearer plus `x-tenant-id` and `x-mission-id`.
- `POST /v1/verification/executions/{workflowId}:cancel` requires the same scoped headers and an empty body. It returns 202. Poll the read route for confirmed terminal status; acceptance of a cancel request does not imply completed cancellation.
- `GET /v1/verification/readiness` returns the configured queue availability signal.

Workflow IDs derive from tenant, mission, work item, attempt and operation identity. Exact repeated commands retain the workflow; changed commands under that identity return 409, including after completion. A new intentional attempt needs a new canonical attempt identity. Temporal memo stores only ownership and command digest. Reads and cancellation verify workflow type, task queue and persisted tenant/mission ownership before accessing results or requesting cancellation.

Terminal responses contain compact IDs and disposition. Quality rejection is a completed execution with `quality_rejected`. Full evidence receipts remain in Knowledge Services. Failed infrastructure and unresolved reconciliation must not be presented as a quality pass. No arbitrary retry or promotion endpoint is implemented by these three routes.

## Local proof

From the parent workspace, set `VERIFICATION_PROVE_TEMPORAL=1` and run `node internal/verification-run-local-proof.mjs metric-service`. The guard uses only loopback Postgres/Storage. The preserved Temporal development server must be running on loopback7233 in namespace `verification-local`. The proof creates fresh synthetic tenants and attempts, runs actual API/worker paths, saves histories and hashes, and closes its workers and listeners. It does not reset storage, dispatch providers, or establish Temporal Cloud readiness.

Real HTTP proof evidence and independent custody review are recorded separately in `EVIDENCE-LOG.md`; implementation tests alone do not establish deployment acceptance.

Targeted proof modes: VERIFICATION_PROVE_TEMPORAL=http runs only the HTTP additions plus metric/surface baseline; VERIFICATION_PROVE_TEMPORAL=uncertain runs the activity-observed withheld-response cancellation case plus that baseline. Value 1 runs the combined Temporal suite. These modes preserve independent historical receipts; none implies Cloud deployment.

