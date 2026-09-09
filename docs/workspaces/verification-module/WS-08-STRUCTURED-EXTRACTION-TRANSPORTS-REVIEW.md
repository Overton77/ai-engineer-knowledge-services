# Structured extraction public transport review

Coordinator session, 2026-09-06. EV-089 adds compact public custody results, mission-authorized reads and extraction submission through HTTP, typed client, CLI and MCP. The overall module remains incomplete.

## Public surface

| Surface | Submit | Read |
| --- | --- | --- |
| HTTP | `POST /v1/verification/extractions` | `GET /v1/verification/extractions/{operationId}` |
| TypeScript client | `extractStructuredData(request, context)` | `getStructuredExtraction(operationId, context)` |
| CLI | `extraction run` | `extraction show` with `{"operationId":"…"}` |
| MCP | `knowledge_extract_structured_data` | `knowledge_get_structured_extraction` |

Submission uses the existing compact ExtractStructuredDataRequest, authenticated ownership hints and idempotency key. The shared application service constructs the canonical structured-extraction request and step; generic default admission remains closed. Worker and API now parse the same strict runtime configuration and exact tenant/capture/representation/schema grant key. Duplicate mappings fail. Native profile hydration, source admission and provider selection remain worker responsibilities; grant matching does not replace those checks.

The public VerificationStructuredExtractionResource is a strict bounded projection of the EV-088 authenticated terminal read. Both accepted and captured-failure outputs retain the original receipt fields. Publication references are compact; Storage object paths, raw provider output, source content, public-key material and signatures are not included. `signatureStatus: verified` is explicitly scoped to `purpose: artifact_custody_only`. A successful producer result remains `unverified_candidate` with `shape_only` schema validation. Failed results contain no candidate and no automatic retry. Generated JSON Schema/OpenAPI include both new routes and the request/resource schemas.

Reads require knowledge.read permission for the authenticated tenant and a server-owned ownership grant. The configured runtime binds caller actor to original operation mission, attempt/work item, agent deployment and capability version; an external-execution constraint is enforced when present in the grant. Denied or missing ownership returns 404. Unknown signing trust, byte/receipt integrity failure or unavailable configuration fails closed. Errors are sanitized. Caller query parameters cannot establish trust or extend scope. No raw receipt grants were added.

## Configuration

- Shared API/worker: `VERIFICATION_STRUCTURED_EXTRACTION_CONFIG_JSON`, schema version `verification-structured-extraction-runtime.v1`, as implemented by `parseVerificationStructuredExtractionRuntimeConfig` in application. The API requires dynamic `VERIFICATION_SERVICE_OWNERSHIP_GRANTS_JSON`, `live_provider` mode and a valid bounded Ed25519 public keyring. The API does not need the worker's private signing key or supplier credential.
- Worker: existing `VERIFICATION_STRUCTURED_EXTRACTION_SIGNING_KEY_ID`, `VERIFICATION_STRUCTURED_EXTRACTION_SIGNING_PRIVATE_KEY_PEM` and selected supplier key remain required. Synthetic transport remains possible only with an explicit in-process test port.
- Reads: `VERIFICATION_STRUCTURED_EXTRACTION_READ_PUBLIC_KEYS_JSON` is an array of `{keyId, publicKeyPem}` objects, using the existing bounded Ed25519 read-keyring parser. This is separate from the runtime configuration's key map. Read startup also requires database, `SUPABASE_URL`, `SUPABASE_SECRET_KEY` and ownership grants. `VERIFICATION_STORAGE_BUCKET` retains its default. Trust rotation is operator configuration.

Configuration validation is not evidence of a deployed healthy worker. Actual production capability health, supplier readiness, live authentication and deployment acceptance remain outstanding.

## Evidence and limits

The final transport proof uses actual loopback HTTP, PostgreSQL and original EV-087 Storage publications. Six provider/outcome cases pass through typed HTTP, CLI dispatcher and MCP executor. It additionally launches the built CLI in a separate process and connects the MCP SDK over actual Streamable HTTP for read and submission. Five new requests are admitted canonically and cancelled while queued; the exact HTTP retry reuses the same operation. All five have no provider-attempt rows. Wrong actor, tenant, input grant and ownership attempt are rejected; unknown query trust and private resource extensions fail.

The three API tests cover validation ordering and sanitized errors, missing runtime trust/storage/ownership, and mission/deployment/capability/external-execution grant mismatch. Existing worker configuration tests exercise the shared parser. Proof TypeScript settings match the MCP package's exact-optional setting because the proof imports the actual MCP transport implementation.

This proof does not execute a new worker after public submission, perform supplier calls, establish production authentication/deployment, or test process death during provider execution. The synthetic config is supplied explicitly to buildServer for the local admission proof; production API startup rejects that mode. The original EV-087 completed publications retain their original runtime/source-custody claims. This change does not retroactively recertify them as executions of the modified worker.

Final artifact hashes and workspace validation are recorded in EVIDENCE-LOG.md. Next prove public submission through worker completion with current source custody, then actual process-kill/crash-gap recovery and authorized uncertain-call reconciliation. All remaining claims/report/adjudication, case/score, disconnected replay, runtime cutover, security, dashboard, human review and final matrix requirements remain open.
