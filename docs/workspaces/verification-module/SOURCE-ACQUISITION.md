# Trusted source acquisition

`captureSource` supports live HTTPS HTML and PDF acquisition when the API and worker are explicitly configured. The public request selects a source URI; the server catalog must bind that exact URI and source kind to the authenticated tenant and a worker-owned source key. Existing registered HTML capture remains available with its original grants.

Enable `VERIFICATION_CAPTURE_ACQUIRE_ENABLED=1` on both API and worker. Preserve existing entries in `VERIFICATION_SERVICE_CATALOG_JSON` and add `acquisitionGrants` containing `tenantId`, `sourceKey`, and a `source` with a UUID `sourceId`, `kind: "web_page"`, canonical HTTPS `canonicalUri`, and `logicalIdentity`. API acquisition also requires its existing trusted operation-ownership configuration.

The worker additionally requires `VERIFICATION_SOURCE_ACQUISITION_GRANTS_JSON`, an array of transport grants:

```json
[
  {
    "sourceKey": "gl-faq",
    "sourceUri": "https://www.generationlab.com/FAQs",
    "redirectUris": [],
    "acceptedMediaTypes": ["text/html"],
    "maximumBytes": 2000000,
    "timeoutMs": 30000
  }
]
```

Redirect destinations must be explicitly listed when required. The adapter reuses the acquisition package's public-address validation and pinned HTTPS transport. It applies a single deadline, bounded identity-encoded bytes, media/status checks, and cancellation. No model-provider credential is needed.

For PDF, configure the catalog source as `kind: "pdf"`, transport media as `application/pdf`, and a byte limit at or below the native parser's 8,000,000-byte input cap. The request must use `sourceKind: "pdf"` and ordered `requestedProjectionKinds: ["pdf_text", "geometry"]`. Both projections retain separate transformation references and share exactly one native parser output. Terminal reads rehydrate both projections. HTML continues to require `html_dom` and `text/html`; the executor rejects source-kind and media mismatches before recording a new capture.

The executor registers canonical acquisition metadata, then raw source bytes with that metadata artifact as their parent. It records the source capture before parser admission. Retrying an operation with an existing capture hydrates its original bytes and validates its metadata, hashes, parent references, and transformation bindings rather than fetching again. Cancellation is checked before acquisition persistence, recovery hydration, and parser work. Metadata and source bytes remain restricted internal artifacts; capture does not establish semantic correctness or publication authority.

Native proof `verification-source-acquisition-native-c5bf7034-c2f0-47b1-86ce-60ef5a62cc1f.json` records one live FAQ acquisition through the application, canonical durable worker, PostgreSQL, Storage, and sandboxed parser. The dedicated clone wrapper `verification-source-acquire-isolated-db1b0dae-7b54-40a1-a542-c0075cc38941.json` records successful database and dump cleanup. This is not yet an immutable benchmark-version proposal, a full capture/diff CLI demonstration, or a remote rollout.

Completed captures can be read with `GET /v1/verification/captures/{operationId}` or the TypeScript client's `getVerificationCaptureResult`. Enable `VERIFICATION_CAPTURE_READS_ENABLED=1` on the API and provide its existing PostgreSQL/Storage configuration, `VERIFICATION_PARSER_IMAGE_DIGEST`, and `VERIFICATION_SERVICE_OWNERSHIP_GRANTS_JSON`. The authenticated reader must have `knowledge.read` and match a server-owned mission/deployment grant. Authorization runs before artifact hydration. Disabled reads return 503, unknown or unauthorized operation ownership returns 404, pending returns 409, and failed/cancelled returns 422.

The compact terminal resource includes source identity, capture metadata, projection references, acquisition-receipt reference for acquired sources, and result-artifact reference. It excludes storage object keys, raw source bytes, and response headers. The runtime checks the durable receipt and source/projection custody using read-only admission; it cannot fetch a source or invoke a parser. `captured_without_admission` does not grant benchmark publication or human-review authority.

Successor native proof `verification-source-acquisition-native-7938d821-2872-421c-9947-d26b50f5c091.json` exercises this actual read runtime through Fastify injection after live acquisition, including unknown-operation and unauthenticated denials. It does not prove a listening HTTP deployment or the full API startup configuration. Its isolated wrapper `verification-source-acquire-isolated-5e196aaf-2e23-4d3b-b45f-d9849cdbb334.json` records cleanup and zero provider calls.

Review of that proof found that read-time acquisition receipt bytes also needed explicit validation. The reader now hydrates the receipt and checks canonical bytes, exact registration, metadata bindings, and both acquisition transformation signatures. Proof `verification-source-acquisition-native-fa90f602-b6e6-4ef3-9dd2-8bc323e68f1b.json` repeats the native path with this repair; wrapper `verification-source-acquire-isolated-55b7a7bc-559c-4eae-aed5-9f567d590b7d.json` records successful cleanup and zero provider calls.
