# Verification service runtime

The implemented slice supports registering uploaded HTML captures, verifying a registered extraction against one capture, and replaying that extraction. Metric runtime composition is under local integration review as described below. Remaining specification routes are not yet admitted. Local integration evidence is not production deployment evidence.

## API ownership

Configure `KNOWLEDGE_API_IDENTITIES` with authenticated bearer identities and tenant roles. Separately configure `VERIFICATION_SERVICE_OWNERSHIP_GRANTS_JSON` as an array of strict grants:

```json
[
  {
    "tenantId": "00000000-0000-4000-8000-000000000001",
    "actor": {
      "kind": "service",
      "id": "00000000-0000-4000-8000-000000000002",
      "serviceIdentity": "mission_control_client"
    },
    "missionId": "00000000-0000-4000-8000-000000000003",
    "agentDeploymentId": "your-registered-deployment",
    "capabilityVersion": "verification-service.v1"
  }
]
```

These example IDs are placeholders, not seeded records. The actor must match the bearer identity. Each mission, work item and attempt must already exist under the tenant; the attempt's deployment must match its grant. Requests carry `x-verification-mission-id`, `x-verification-work-item-id` and `x-verification-attempt-id`. The API resolves their relationship through canonical Postgres before creating context. An optional grant `externalExecution` binds exact runtime/run/session metadata. Supplied external metadata must match that grant.

Changing a request or authenticated context under an existing idempotency key fails as drift. Preserve context and key when retrying an uncertain submission. Use a new key for intentionally different work. The legacy `VERIFICATION_SERVICE_ATTEMPT_ID` configuration is only a development compatibility path; production rejects it without ownership grants.

## Worker configuration

Set `WORKER_TENANT_ID`, canonical Postgres/private Storage credentials, `VERIFICATION_PARSER_IMAGE_DIGEST` to the reviewed installed image digest and `VERIFICATION_SERVICE_CATALOG_JSON` to the immutable source/profile grant catalog. The catalog has `captureGrants` and `extractionProfileArtifacts` arrays. Source grants include the registered source identity, exact content artifact ID/digest, capture time and method, `parserKind: "html"` and `projectionKinds: ["html_dom"]`. Extraction profile grants contain exact registered artifact IDs/digests. Full artifact handles and caller-authored authority fields are rejected.

The worker creates native projection and transformation artifacts in `ai-engineer-cloud-bucket`. It hydrates registered bytes, checks capture-specific transformation lineage, and registers results before completing the durable operation. Verification remains unavailable without these configured runtime ports.

## Metric runtime configuration

The API requires `VERIFICATION_METRIC_ENABLED=1` and dynamic `VERIFICATION_SERVICE_OWNERSHIP_GRANTS_JSON` before accepting metric operations. The development static-attempt fallback does not enable metrics. The worker independently requires `VERIFICATION_METRIC_PROFILE_GRANTS_JSON`: a nonempty array of at most 256 grants, bounded to 262,144 characters. Each grant is `{profileArtifact: {artifactId, digest}, observations: {artifactId, digest}}`. It binds an existing immutable observations bundle to a registered `verification-metric-profile.v1` artifact containing the exact capture set and native transformation-envelope mapping.

The metric worker uses canonical artifact producer ownership and authenticated verifier attempt ownership to derive deployment principals. Requests cannot supply those principals or a lineage override. The configured parser digest and private bucket are also required. A successful metric result is explicitly `mechanical_only`; policy admission and publication require separate stages. `knowledge verify metric`, `/v1/verification/metrics:verify`, and MCP `knowledge_verify_metric` share this durable path. The guarded local `metric-service` proof records the currently verified boundary; consult the latest receipt and ledger before treating runtime composition as accepted.

## CLI completion behavior

`knowledge verify extract --context '<operation context JSON>' --input '<strict request JSON>' --wait --timeout-ms 60000` submits through `KNOWLEDGE_API_URL` using `KNOWLEDGE_API_TOKEN`. The same context routing fields reach API ownership admission. Without `--wait`, the response is an accepted operation, not a verification result.

With `--wait`, exit 0 means completed quality pass, exit 1 means completed quality rejection or required review, and exit 2 means request/execution failure or timeout. The command reads the authorized durable receipt before reporting a quality verdict. One deadline bounds submission and subsequent HTTP reads. A client timeout does not cancel durable work; inspect the returned/idempotent operation before retrying or cancelling it.

## Local evidence commands

From the parent workspace, `node internal/verification-run-local-proof.mjs operation-ownership` proves authenticated ownership and idempotency against guarded local Postgres. `node internal/verification-run-local-proof.mjs service-worker` exercises real Storage/parser/worker, public API/client, CLI executable, MCP HTTP and process-loss recovery. Build the CLI and client before executable proofs. Both commands preserve prior records, use fresh synthetic tenants and dispatch no providers. They must not be pointed at the remote `.env` through ad hoc shell overrides.

The shared ledger records proof scope and remaining gaps. Do not infer production readiness, human gold, full metric/report/claim coverage, or all ten mutation/six read routes from this slice.

## Sealed run reads

Set `VERIFICATION_READS_ENABLED=1` in the API with canonical Postgres and private Storage configuration. `GET /v1/verification/runs/{runId}` and `/manifest` require the existing bearer and tenant read grant. These IDs belong to `evidence.verification_run`, not the IDs of the four durable operation results. The repository validates the sealed audit bundle and its registered bindings before the application projects compact metadata. Missing owned runs return 404; malformed IDs return 400; missing configuration and integrity failures fail safely without exposing storage errors. Responses are bounded to 1 MiB by default.

Use `verify run --input '{"runId":"..."}'` or `verify manifest` with the ordinary CLI bearer/context options. MCP tools are `knowledge_get_verification_run` and `knowledge_get_verification_manifest`; their arguments contain only `runId` and `{tenantId,correlationId}`. The typed client offers `getVerificationRun` and `getVerificationRunManifest`. These reads contain artifact IDs/digests and reproducibility metadata, not private Storage locations, raw source/provider bodies, judgments or signatures.

For local proof, set `VERIFICATION_PROVE_READS=1` and run `node internal/verification-run-local-proof.mjs persistence` from the parent workspace. It creates a fresh canonical sealed run and compares real HTTP/client, built CLI and MCP reads, including foreign-tenant denial, using only loopback Postgres/Storage. Existing operation workers do not yet create these sealed-run records automatically; that mapping remains subsequent integration work.

## Metric sealing configuration (integration under verification)

The worker can seal metric audit runs when VERIFICATION_SEAL_POLICY_GRANTS_JSON is set to a nonempty JSON array of grants shaped as `{ tenantId, policyVersion, policyArtifact: { artifactId, digest } }`. Register the immutable policy artifact first. The bundle policy version must resolve through this trusted catalog. Runtime metadata also requires VERIFICATION_CODE_GIT_SHA, VERIFICATION_CODE_DIRTY (0 or 1), VERIFICATION_RUNTIME_PLATFORM, and VERIFICATION_RUNTIME_DEPLOYMENT_ID. These values describe the deployed worker and must be supplied by deployment configuration. Sealing configuration without metric profile grants fails startup.

The activity passes its actual start time and current lease fence to the sealer. A configured sealing failure prevents successful result registration. The operation output keeps mechanical_only admission and has a separate sealedRun reference; a mechanical pass must not be interpreted as policy admission. Empty sealing configuration preserves the existing mechanical operation mode and does not establish audit-run acceptance.

The internal repository recovery method validates canonical operation and verifier ownership before returning an existing seal for a running/succeeded operation. Public run and manifest reads continue to require a succeeded linked operation. Recovery must reuse stored timestamps and immutable handles. This section describes the integration contract; live acceptance is recorded separately in EVIDENCE-LOG.md.

## Sealed metric replay

When metric profile grants are configured, the worker's replay handler first resolves the requested canonical sealed run. It requires the caller's authenticated mission to match the recorded mission and uses the historical verifier attempt from canonical ownership. The profile grant must still match the retained artifact digest. The public endpoint is POST /v1/verification/runs/{runId}:replay. A matched replay returns result.valid=true and replayMatched=true while retaining the original policyOutcome; this is replay parity, not new policy approval. Legacy extraction operation replay is attempted only when no canonical run exists and the extraction catalog is configured. Integrity, ownership and grant failures cannot select that fallback.
