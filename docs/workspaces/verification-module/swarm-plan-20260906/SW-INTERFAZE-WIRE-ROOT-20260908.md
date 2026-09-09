# Interfaze fixed-task wire reconciliation

Root changed `packages/verification/src/providers/interfaze.ts` so `runTask()` sends an empty JSON Schema response format, with name `task_output`. This leaves the provider-defined fixed-task output unconstrained on the wire; the existing local name/result and precontext validation still applies. Strict-schema extraction remains unchanged.

Primary documentation checked2026-09-08: [Run Tasks](https://interfaze.ai/docs/run-tasks) requires other clients to send a task tag and empty/any schema; [Chat Completion API](https://interfaze.ai/docs/api/chat-completion) defines the JSON Schema envelope. The implementation uses the documented `json_schema` type with `schema: {}`, not an undocumented response-format type.

Validation: nine provider adapter tests pass, including the fixed-task versus strict-extraction wire distinction; verification package typecheck and build pass. No provider request or credential read was made. Historical live OCR evidence is retained separately and is not claimed to have executed this updated wire shape.

Sol's official-docs reconciliation identified retained successful synthetic fixed OCR and strict text extraction under `internal/verification-provider-live-reconciliation-bc098d95-a789-4bf0-8497-a8f79ab8e8fb.json`, independently bound by `internal/verification-provider-live-artifact-review-f1fa37ef-2779-44ce-bdac-70f08b22ef68.json`. Earlier remaining-gates notes incorrectly treated the fixed-task proof as absent. Reuse these records; no duplicate paid OCR request is needed for adapter capability.

VR015/016 independent acceptance reconciliation remains pending. Native non-empty precontext has not been observed; raw native response custody and injected present-precontext custody are distinct evidence. Any acceptance decision must apply the actual conditional provider schema and exact requirement without claiming unseen provider output. VR017 sensitive-input policy remains closed pending accountable vendor/account/endpoint review.
