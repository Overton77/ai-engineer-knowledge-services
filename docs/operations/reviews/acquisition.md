# Module review: acquisition

Module and reviewed revision: `@aiengineer/knowledge-acquisition` plus worker `knowledge.capture/v1` upload wiring (2026-09-16).

Purpose, owner, callers, and supported interfaces: Knowledge Services owns sealed-byte custody. Callers are the platform worker (`source fetch` → `capture`), the verification grant acquirer (pinned HTTP only), executor capture/read tools, and package examples. Public interface: `AcquisitionAdapter`, `RoutedAcquisitionAdapter`, HTTP helpers used by verification, upload filesystem source, inspect read/search/observe, `planPaperAsHttpRequest`.

Affected agent skills: `knowledge-acquisition-and-vetting` v1.2.0. Preparation and ingest skills unchanged.

## Must-haves

| ID | Must-have | Given / when / then | Assessment |
|---|---|---|---|
| ACQ-HTTP | Public static HTTPS URL seals one digest with redacted headers | Given a mocked public fetch, when plan/execute/verify run, then one artifact is stored and `set-cookie` is absent | present |
| ACQ-UPLOAD | Local attested file under the upload root seals one digest | Given `ACQUISITION_UPLOAD_ROOT` and a sidecar attestation, when target.kind is upload, then one artifact is stored | present |
| ACQ-INSPECT | Inspection returns handles/excerpts, not locators or admission | Given sealed bytes, when read/search/observe run, then excerpt has no locator and findings never say accepted | present |
| ACQ-CARD | Platform capture stays one primary body | Given acquire, when verify fails or artifacts.length !== 1, then the worker rejects | present |
| ACQ-VENDOR | Vendor MCP is not a KS MCP dependency | Firecrawl/Tavily stay agent-attached | present |

Normal path: HTTP or upload → seal → inspect excerpts. Failure path: `ADDRESS_DENIED`, `UPLOAD_PATH_TRAVERSAL`, `CAPTURE_DIGEST_MISMATCH`. Recovery: retry only on recorded retryAdvice; do not fall back to Firecrawl inside KS.

Provider restrictions: do not grow Firecrawl scrape; do not wire repository or paper `execute`; do not admit platform inspect.

Evidence: `packages/acquisition/src/*.test.ts`, `packages/acquisition/examples/`, `apps/worker/src/activity-registry.test.ts`.

Explicitly skipped checks: live Firecrawl, live paper resolvers, platform inspect admission, lifting `artifacts.length === 1`.
