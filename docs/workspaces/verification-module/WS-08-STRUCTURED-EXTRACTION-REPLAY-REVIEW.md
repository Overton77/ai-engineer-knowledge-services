# Structured extraction captured replay review

Coordinator review,2026-09-06 UTC. Full verification-module objective remains active.

## Production behavior

`StructuredExtractionProfileAdmission` now accepts a resolver factory and creates a fresh resolver per preparation. Authorization/hydration pairs are sequential. Root found that the real repository carries one consumable authorization ticket; earlier permissive mocks missed parallel ticket clobbering. Eighteen profile tests now include two concurrent preparations with separate single-ticket resolvers.

`StructuredExtractionCapturedReplayService` accepts an issuing profile-admission service and fresh resolver factory. It first verifies preparation branding and exact capture/profile identity, then hydrates actual bounded transport, response-envelope, request and raw bytes sequentially. It checks tenant, ID, digest, length, full handles where retained, canonical transport/envelope serialization, ordered parents and native metadata signatures. The response envelope must retain the exact five-field v1 contract.

The regenerated Gateway/Interfaze adapter request must match both the original digest and exact wire bytes, using admitted prompt, schema and fixed schemaName `structured_extraction`. The only fetch implementation returns one in-memory Response with retained status/body. No key, network or write port is accepted. Sink callbacks recheck request/response/status consistency. Only reproduced HTTP/response/parser/schema failure classes return a failed outcome; custody errors, cancellation, local deadlines and unexpected failures propagate. Output is an unverified candidate, with usage and emitted precontext retained. Mutable precontext bytes are copied.

Interfaze validates output before emitting admitted precontext. Schema/HTTP failures therefore expose no admitted precontext through the current adapter, although full raw response bytes retain any original precontext text. A failed early proof incorrectly asserted precontext emission on schema rejection. Root inspected the actual adapter order and corrected the proof; no adapter semantics were weakened or alternate interpretation invented.

## Real evidence

Native preparation `../../../../internal/verification-structured-extraction-preparation-c6085a8a-8c56-4923-a9ed-dd09666d223d.json`, SHA256 `36e0c76c5c93eb13ce8acfa5c6ac6a17ec00ecd404450a7f812fc686696d6b3c`, registers a synthetic HTML source, runs the actual pinned sandbox parser (`sha256:1669a3f9674b2e0a70ba1c8686c1cb3647492b8268bdfa7a9a4452fb0530fb37`), and admits both real registered producer profiles with exact selected-evidence digest. No supplier dispatch.

Final proof `../../../../internal/verification-structured-extraction-replay-a465e3f1-7006-45c1-af65-ca90e2dc11d2.json`, SHA256 `49b536f69d3f06ec4d291b75070bd400917d27c7434ba091e62fb86c0ff1ce46`, covers eight original synthetic transport executions through actual adapters and canonical accounting/capture storage: each provider's success, schema-invalid200, HTTP503 and valid-custody wrong-wire request. Six responses replay with exact output/failure parity, one memory fetch each and no accounting changes. Two wrong-wire captures fail before memory fetch. Changed status, cloned preparation, cancellation and changed response-envelope bytes fail. All proof operations are cancelled afterward. Original synthetic responses are not supplier calls, actual billing or provider quality evidence. Earlier proof runs remain historical fixtures; the final receipt above is authoritative.

Independent audit `../../../../internal/verification-structured-extraction-replay-audit-20260906.json`, SHA256 `35829968b54e16f457f690c15afc139c04e31353bf5cdb115d5e48bf0d15fd21`, verifies29 actual Storage payloads, native/profile/source/transport/envelope/raw/request identities and hashes, native semantic signatures, exact original/corrupted prompt binding, canonical capture state and four current scoped source files. The audit does not claim another adapter execution.

Strict standalone preparation/replay TypeScript passes. Eighteen profile tests pass. Full workspace result is recorded in EVIDENCE-LOG after completion. Database-contract remains0.2.17/local06031400; no migration or remote rollout was needed in this slice.

## Remaining mission work

This is an internal captured-response replay boundary, not extractStructuredData operation completion. Next implement durable candidate/result identity, original lifecycle timestamps, admission-bound execution, canonical completion guards, configured worker/HTTP/client/CLI/MCP/reads and actual OS-process recovery. Recovery between response artifact and capture-row commit, supplier reconciliation after cancellation and explicit array evidence mapping remain open. All remaining claims/report/adjudication, case/score completeness, disconnected export replay, runtime/deployment cutovers, dashboard/human review and final requirement-by-requirement audit remain part of the goal.
