# WS-06 provider implementation brief

Coordinator preparation for the next sequential owner. Read specification sections13–15, decisions D-011/D-012, WS-05 handoff when complete, and HANDOFF-FROZEN-SOURCE-REGISTRY.md. No inference calls have been made during this mission as of this brief.

## Existing code and boundaries

The prototype experiment adapter is `../research_ingestion_systems_agent/experiments/interfaze-lab/src/interfaze.ts`. Port its useful request/response knowledge into the canonical provider framework; do not retain its unbounded response.text(), missing request deadline, raw upstream error exposure, or inline full precontext return as production behavior. It is a prototype, not a reviewed implementation to copy unchanged. Fixed task and strict schema extraction must share neutral admission, artifact, accounting, and failure contracts with the baseline.

WS-05 defines `SemanticJudgeAdapter` under verification/semantic. Its trusted identity records deployment, provider, family, model, capability kind, grader, prompt/schema/config digests. Judge input is bounded assertion/qualifiers/entity bindings and exact authorized fragments. Implement Gateway judge adapters against the final handoff shape, including per-request cancellation. Do not give them tools or general retrieval. Interfaze is an extraction provider, never its own sole verifier. Do not call an LLM prompt a separately trained NLI model or copy raw confidence into calibratedProbability.

## Current primary documentation, checked 2026-09-06

Interfaze's HTTP endpoint is the prototype's `https://api.interfaze.ai/v1/chat/completions`, model `interfaze-beta`. For generic clients, fixed tasks use a task tag in the system message and an empty response schema; only one task executes per call and its result schema is provider-defined. The response task name and result must be admitted, rather than treated as caller-defined structured extraction. Production task allowlist is ocr, object_detection, scraper, speech_to_text and translate; GUI/search/forecast/code tasks remain disabled. [Run tasks](https://interfaze.ai/docs/run-tasks).

Structured extraction uses an object-root JSON Schema and JSON-parsed message content. The provider documents wrapping non-object roots, so prohibit those roots instead of silently unwrapping arbitrary output. Reapply the local admitted schema after the provider reply; provider schema mode does not establish factual validity. [Structured outputs](https://interfaze.ai/docs/structured-output).

Precontext is an array and may repeat task names. OCR can contain text/geometry, and transcription precontext uses the name stt even though the fixed task is speech_to_text. Admit a small explicit versioned alias map. Unknown or unexpected task results must not silently become evidence. Retain raw response/precontext as restricted registered artifacts outside subsequent model context and derive bounded canonical projections. [Precontext](https://interfaze.ai/docs/precontext).

Set x-interfaze-zdr:true at the actual HTTP boundary and test the outgoing header. Interfaze documents this as request-level ephemeral handling; a passing header test proves that this client requests the policy, not independently that the provider enforces its retention claims. Sensitive classified inputs remain disabled without the separate deployment/legal admission policy. [Security and privacy](https://interfaze.ai/docs/security).

## Conformance and actual calls

Use bounded request bytes, response bytes before JSON parse, depth/collection preflight, total deadlines spanning headers/body, abort propagation, retry caps and typed failures. Do not retry malformed schema/unsupported task/quality rejection. Retrying provider/transient failures must charge every attempt and preserve request/response identity. Endpoint selection and credentials are trusted deployment configuration, not request fields. Unknown usage/cost stays unknown; estimated cost is labelled and supported by recorded pricing/model catalog data. Cache reuse must be exact manifest-bound reuse and explicitly disclosed; no silent semantic cache equivalence.

Persist input/request identities and restricted response bytes before producing an accepted extraction or compact precontext projection. Full handles, producer/parser/model/config/schema/prompt identities, selected source bytes, and parent transformations must remain replayable. Registry output confidence is a measurement, not a verification gate.

Start real conformance with a tiny synthetic text extraction and synthetic image/fixed-task case, then the same frozen diagnostics cases. Use non-sensitive short source excerpts only when licensing permits the use. Do not upload full restricted corporate/paper captures just because a provider accepts URLs or files. Preserve the failed-call receipt if a provider is unavailable; do not fabricate an equivalent response or count a stub as live.

Prepared fixture: `internal/verification-provider-fixtures/20260906/` contains synthetic-record.png, matching text, a bounded extraction schema, and expected.json with deterministic synthetic labels and rendered line coordinates. The coordinator visually checked the image. Image SHA-256 is `e639ae98cf1fb35eb39de48342eb0bd162dfacf90144971419932ab1088def8d`; text SHA-256 is `48745a8303e077f1061205e2e5934f29f8c35b3740034ce38e2478444601ac3b`. The expected turnaround includes the after-receipt qualification. Register these inputs and outputs before using them as live conformance evidence; they are not human-adjudicated benchmark labels.

D-011 baseline is Gateway openai/gpt-5.6-luna, cross-family semantic judge anthropic/claude-haiku-4.5, and justified Terra escalation. D-012 bounds the first live Pilot at estimated USD20 total, with explicit output/retry/concurrency caps and a small conformance run first. Current model catalog receipt is internal/verification-model-catalog-20260905.json. Reserve cost before dispatch, reconcile actual usage when available, and prevent concurrent calls from overspending the shared budget. Frozen paired baseline/Interfaze/cascade/consensus arms belong to WS-07.

Contract reconciliation: the initial VerificationRunManifestSchema calls array currently requires integer costMicros and retries, but has no explicit unknown/estimated/actual cost distinction. Do not record zero for missing provider usage. Own the narrow additive contracts/generated-artifact update needed for truthful provider accounting, with compatibility tests. Shared budget storage must persist reservations and conservatively retain uncertain dispatched attempts; a process-local counter alone cannot protect the whole Pilot across restarts.

## Independent prerequisite review

Before using the v2 source registry as accepted benchmark evidence, independently review the coordinator's small Python parser change and repeat a meaningful visible-text/hidden-content fixture. Candidate image and receipts are in HANDOFF-FROZEN-SOURCE-REGISTRY.md. The previous v1 parser acceptance remains intact; v2 currently has owner corpus/boundary proofs only.

Human policy promotion, empirical calibration, gold adjudication and production shadow gates remain explicit. Implement safe proposal/review states and useful runnable surfaces rather than claiming those external decisions occurred.
