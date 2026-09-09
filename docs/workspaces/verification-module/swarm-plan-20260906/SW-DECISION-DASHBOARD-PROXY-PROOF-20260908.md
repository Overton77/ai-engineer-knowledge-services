# Dashboard decision proxy proof — 2026-09-08

The local proof started an owned Mission Control Next server with process-only fixture configuration, established a signed dashboard session through its login endpoint, read the dashboard CSRF token, and submitted the decision through the actual dashboard knowledge proxy. The proxy used its server-owned mapping for a new synthetic `human_reviewer` service actor and the exact retained mission, work-item, and attempt IDs. The KS API accepted the request (202), and `startWorker` processed only its returned `WORKER_OPERATION_ID` to `succeeded`.

The dashboard terminal proxy returned HTTP 200 but its compact DTO was `{ "error": { "code": "ADJUDICATION_DECISION_INTEGRITY_INVALID" } }`, so the proof is blocked rather than passed. The completed synthetic terminal result has `quorum.required=2` and `syntheticAffirmRecorded=3`; the Mission Control DTO rejects synthetic counts above the required quorum even though the result contract permits that synthetic count and preserves `synthetic_engineering`, `admissionChanged=false`, and `humanGoldScoringEligible=false`.

No human grant row or human provenance was created, and no provider was called. The immutable central diagnostic receipt is `C:/Users/Pinda/Proyectos/aiengineer/internal/verification-decision-dashboard-proxy-diagnostic-fccc967e-7b2c-5f15-a712-18cb9e745dd7.json`.

The dashboard terminal projector and renderer guard were corrected to accept nonnegative, safe accumulated quorum counts. A terminal marked `reached` now additionally requires `humanAffirmRecorded >= required` and `humanRejectRecorded === 0`. The focused DTO and renderer tests passed (17 tests), dashboard typecheck passed, and a fresh dashboard build completed.

A new immutable full proof passed: `C:/Users/Pinda/Proyectos/aiengineer/internal/verification-decision-dashboard-proxy-4bc6d7c7-b004-53d5-a252-b5d67bebc9d9.json`. It records signed-session login 200, CSRF 200, actual dashboard proxy POST to KS 202, scoped production worker success, and dashboard proxy terminal compact DTO 200. The terminal remained `synthetic_engineering`, with `admissionChanged=false`, `humanGoldScoringEligible=false`, and zero provider calls.

Frozen source SHA-256: dashboard DTO `eaf35a9757b29f0eb15edbd70fd80d3d2fb673f7d9948dc4b5704546ca99b308`; dashboard guard `c6155bbce28dd24a2f2fb73c2fee806b91001c06370f04084f8b4f596bde83dc`; native proof script `927575cc5e40e152951261cef6ca47624254916c7490a26ab23fa702e3f2d3aa`.
