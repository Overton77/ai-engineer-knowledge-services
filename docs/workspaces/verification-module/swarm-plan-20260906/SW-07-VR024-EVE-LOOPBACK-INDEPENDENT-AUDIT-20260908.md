# SW-07 VR-024 Eve loopback independent audit — 2026-09-08

## Scope

Read-only review of the retained EV-134 candidate receipt for the Eve verifier consumer lane. This review does not alter `ACCEPTANCE-MATRIX.md`, rerun the fixture, start a provider, or make a database/Storage mutation.

## Receipt and source binding

Reviewed receipt: `C:\Users\Pinda\Proyectos\aiengineer\internal\verification-eve-ks-loopback-fixture-20260908-r19.json`, SHA-256 `e3080b1874f7dff100a9ed0cfbb2932af791994fca0ed526d575590b8a8e49b2`.

The receipt declares schema `verification-eve-ks-loopback-fixture.v1`, `kind: transport_fixture_only`, `passed: true`, and all six checks true: fixture build exit zero, Eve eval exit zero, exact calls, authentication, an idempotency key with the expected prefix, and no cancellation. Its two recorded calls are exactly one authenticated POST to `/v1/verification/claims:verify` and one authenticated GET to `/v1/verification/claims/00000000-0000-4000-8000-000000000007`; the POST carries `x-external-runtime: eve`, the tenant, and an `eve-verify-...` idempotency key. The harness does not submit a duplicate request, so this receipt does not prove idempotency deduplication; the separate unit tests cover key derivation.

The receipt itself does not contain source digests or a source manifest, so source binding is an independent contemporaneous check rather than a receipt-bound claim. SHA-256 values at review time are:

- `research_ingestion_systems_agent/agents/verification/scripts/prove-ks-loopback.mjs`: `2b195425fc887af70bfda2bf0cd880a5e79e02447cab44eab8050822619afcae`;
- `research_ingestion_systems_agent/agents/verification/agent/agent.ts`: `bfa49f82e8887ed6f3388622521a3cb3dbdb2d50aaa9d3b9898548c924ff4772`;
- `research_ingestion_systems_agent/agents/verification/agent/lib/verification-ks-runtime.ts`: `3a2bad58fb9aaef4f8c16dae9c3bd2f9cee88768219e6fa20cbb7869eef6f0c0`;
- `research_ingestion_systems_agent/agents/verification/agent/tools/verify_evidence_bundle.ts`: `45ebfb702ced3f69a22cc41bb89d741c1007e9179bbbd28b012906860e61962c`.

The runner copies the active Eve agent, runs `eve build`, then runs `eve eval ks-loopback --strict --json --skip-report`. The active agent's fixture branch uses `mockModel` only when `EVE_VERIFICATION_TRANSPORT_FIXTURE=1`; it emits one authored `verify_evidence_bundle` tool call and returns the tool result. The tool delegates through `executeEveVerification`, which derives the grant-bound idempotency key and calls the typed KS client.

## Finding

**Recommendation: VR-024 should move from `missing` to `partial`, subject to coordinator review.** This receipt is meaningful actual Eve runtime evidence: the built/evaluated Eve process made the authored tool call, and the harness observed the resulting authenticated POST and terminal GET with the expected grant and lineage headers. It also complements the prior source/build-catalog cutover showing only `verify_evidence_bundle` and no `list_research_records`.

The proof is deliberately a loopback transport fixture. `prove-ks-loopback.mjs` supplies its own HTTP server and canned 202/200 responses; the receipt explicitly says no KS application, worker, PostgreSQL, Storage, Mission Control, persistence, provider, or live model ran. The loopback server also returns a canned terminal for the fixed Eve-grant operation ID; it does not exercise the real KS resolver, which must derive the operation ID from the server-owned idempotency/request context rather than accept the fixed Eve-grant ID as proof of compatibility. The fixture does not provide or validate real `externalExecution` grant enforcement. Therefore it does not prove a real KS operation, independent verifier deployment enforcement, same-deployment refusal, corrupted-locator denial through the real service, cancellation/receipt retry against durable state, or a live-model run. `mockModel` makes the inference synthetic and must remain labelled that way.

The exact minimal next gap for VR-024 is a native KS HTTP/Eve evaluation with the real authenticated KS API and worker, a preseeded operation/grant whose resolver-derived operation identity is compatible with the Eve request, server-owned exact `externalExecution` grants, and no provider secret for the Eve process. It must retain the Eve catalog/tool result, actual KS operation/receipt identity, same-deployment and corrupted-locator denials, interrupted-request cancellation, same-lineage retry/idempotency, and a separately labelled live-model run if executed. No VR-024 `proved` recommendation is justified by EV-134.
