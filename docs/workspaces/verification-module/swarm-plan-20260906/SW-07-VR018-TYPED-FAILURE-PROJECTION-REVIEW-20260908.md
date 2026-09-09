# VR-018 typed failure projection review

The generic operation read now has a compact, receipt-derived `failure` field only when the canonical operation is terminal `failed`. It requires the latest failure receipt shape and publishes its receipt ID, an exact bounded error class, retryability, and a public category. A subsequent `succeeded` state omits the prior failure. Unknown public error classes are `harness_failure`; no raw receipt body, message, provider body, API key, or caller category is projected.

Completed verification quality is deliberately separate. Claims and report terminal reads now project a policy summary only after hydrating the registered policy-decision artifact and verifying canonical bytes, digest, run, policy version, sealed outcome, and `overrideApplied=false`. The summary has verified bounded canonical reason codes or an explicit unavailable marker for a legacy terminal without that verified projection. It is not an operation failure.

A verified policy summary must have the same outcome as the sealed terminal policy outcome. Both the resource contract and dashboard DTO reject a mismatch.

Focused validation passed: contracts 3 tests, application 5, persistence 10, dashboard 37 with dashboard typecheck, and API 9 across three files. HTTP parity covers provider, policy-rejection, and harness execution failures; recovery omission; completed fail/review reason projection; unknown-reason rejection; and the OpenAPI shape. The HTTP fixture does not claim native signature verification.

Read-only retained-native follow-up used the current repository and application reader against the existing signed claims/report proof. It verified signed policy projection for claims `review` / `SOURCE_AUTHORITY_WITHHELD` and report `fail` / `MECHANICAL_BUNDLE_FAILURE`, `SOURCE_AUTHORITY_WITHHELD`; it also retained all 13 hostile custody controls. The connection was default-transaction-read-only, and the run made zero provider or parser dispatches.

Evidence: [R2 receipt](../../../../../../internal/verification-vr018-operation-failure-projection-r2-20260908.json), [API parity log](../../../../../../internal/verification-policy-api-final-r2-20260908.log), and [retained signed-policy read](../../../../../../internal/verification-vr018-retained-policy-read-20260908.json).
