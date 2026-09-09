# Interfaze VR-015/016/017 official-docs handoff (2026-09-08)

Scope: read-only reconciliation of the current adapter, retained evidence, and Interfaze primary documentation. No provider call, credential read, database mutation, or acceptance-matrix edit was made.

## Narrow verdict

| Requirement | What is already proved | Exact remaining gate | Required or optional |
|---|---|---|---|
| VR-015 fixed-task and strict-schema modes | Retained live synthetic calls cover both modes. `verification-provider-live-reconciliation-bc098d95-a789-4bf0-8497-a8f79ab8e8fb.json` recovers the strict-text response and the OCR fixed-task response from the original raw artifacts. `verification-provider-live-artifact-review-f1fa37ef-2779-44ce-bdac-70f08b22ef68.json` independently verifies request binding, exact strict-schema fixture output, and fixed OCR `{name: "ocr", result}` output. | Reconcile current wire format before any future fixed-task call: Interfaze now says a non-Interfaze/non-LangChain client must send `<task>...</task>` **and** an `any`/empty response format. `runTask()` sends the task tag but no `response_format`. Add the documented empty/`any` form and an injected request-shape test, or retain authoritative confirmation that omission remains supported. If “behind provider-neutral adapters” is interpreted as production workflow reachability, compose a task operation; the current worker calls only `extract()`. | Wire-format reconciliation is required for a current-conformance claim. Another paid OCR call is optional for the historical capability claim because a retained live safe call already exists. Production task composition is required only if the row is intended to promise workflow reachability rather than adapter capability. |
| VR-016 raw response/precontext custody and compact evidence | Native raw-response custody and compact source evidence are retained in `verification-vr016-interfaze-projection-retention-audit-20260908.json`. Injected transport proves bounded, separate precontext custody and compact `{name,resultDigest}` projection in `verification-vr016-synthetic-interfaze-precontext-boundary-20260908.json`. | No retained native response contains a top-level `precontext`; the native audit records `nativePrecontextObserved=false`. Interfaze documents top-level precontext for model completions that perform OCR and documents OCR as a supported precontext task. If the acceptance row requires a provider-returned non-empty precontext, one structured-output OCR fixture is still required. Do not relabel a fixed-task `output.result` as top-level precontext. | Raw custody is proved. Handling an absent optional precontext field and the injected branch are proved. A native non-empty precontext fixture is required only for the explicit provider-returned-precontext interpretation currently used by the audit. The streaming-only `x-show-additional-info` behavior is irrelevant because the adapter is non-streaming. |
| VR-017 ZDR and independence | Source/tests require server-owned `zdrPolicy: "required"`, send `x-interfaze-zdr: true`, reject sensitive classification before persistence/dispatch, and reject same-deployment verification. Interfaze documents the same per-request header. | Obtain a reviewed policy decision that (1) confirms this account and `/v1/chat/completions` path are ZDR-eligible, (2) approves the intended classifications/modalities and locations/subprocessors, and (3) resolves input/output-right and retention terms. The DPA says ZDR varies by service/endpoint and may have eligibility requirements; the public security page alone is not account/endpoint evidence. | Required before sensitive input. A sensitive live fixture is neither required nor appropriate: the local specification deliberately keeps sensitive use closed until the policy/legal/security gate is satisfied. No provider call can prove server-side deletion. |

## Supported safe fixture

The lowest-risk native-precontext fixture is one locally generated PNG containing only a nonce such as `VR016 SYNTHETIC 20260908`, submitted through `InterfazeStructuredExtractionProvider.extract()` with:

- classification `synthetic`, modality `image`, `zdrPolicy: "required"`, one attempt, no retry, existing bounded budget reservation;
- a strict root-object schema containing only the expected nonce/text field;
- no URL, web task, GUI task, code, forecast, personal data, repository text, or secret;
- assertions for the persisted request digest, raw response, response envelope, separate `verification_provider_precontext` and precontext envelope, allowed name `ocr`, byte bounds, compact `{name,resultDigest}`, and absence of raw OCR metadata from downstream model context;
- deterministic local comparison of the returned text to the fixture. Interfaze remains extraction evidence only and cannot be the sole verifier.

This is a single paid call only if VR-016 must include provider-returned non-empty precontext. Existing broad authorization is sufficient for the synthetic fixture once the adapter request shape and budget are reviewed; actual execution still depends on an available Interfaze credential and provider service. VR-015 should reuse the retained OCR call rather than spend on a duplicate.

## Capability boundaries

The current adapter intentionally admits `ocr`, `object_detection`, `scraper`, `speech_to_text`, and `translate`. Interfaze currently also documents `gui_detection`, `web_search`, and `forecast`; the local verification specification deliberately excludes GUI, unrestricted browsing, forecasting, and code execution pending separate security/correctness evaluation. Their absence is therefore a policy boundary, not missing VR-015 evidence. The specification mentions classification among possible task examples, but the current Interfaze Run Tasks list does not document a classification task; treat it as unsupported/unverified rather than a fixture obligation.

For precontext names, the official table uses `ocr`, `object_detection`, `stt`, `translate`, `web_search`, `scraper`, `code_sandbox`, `forecast`, and `guardrails`. OCR avoids alias ambiguity and is the supported safe choice. A fixed task returns the raw task output directly; a model completion that performs OCR is the documented route for observing top-level `precontext`.

## Policy evidence still absent for sensitive use

The approval record must bind dated copies or hashes of the controlling documents and record an accountable decision on:

1. Written confirmation that the account and exact Chat Completion/fixed-task endpoints are ZDR-eligible and enabled, because the DPA qualifies ZDR by service, endpoint, and customer eligibility.
2. The precedence and practical effect of ZDR against the Terms' surviving license to use submitted content for providing/improving the service, and the limited, revocable, internal-use-only output license.
3. Approved input classifications and modalities, data minimization, retention/deletion, incident response, processing locations, and the current subprocessor list/change-notice process.
4. DPA execution and applicable transfer mechanism for the user's jurisdiction. Interfaze identifies US and global processing locations.
5. Whether additional assurance is required. The public security page directs SOC 2 or HIPAA review requests to Interfaze support; no such assurance should be inferred from the page.
6. A server-owned grant and reviewer identity/version that the runtime can verify. User-supplied classification or an API response is not policy evidence.

Until that record exists, keep sensitive admission closed. Public/synthetic fixtures may continue under the existing server-owned grant and ZDR header.

## Primary sources checked 2026-09-08

- [Run Tasks](https://interfaze.ai/docs/run-tasks): available tasks, one-task limit, fixed output, other-client task tag plus empty/`any` response format, and canonical `{name,result}` output.
- [Precontext](https://interfaze.ai/docs/precontext): supported names, top-level response shape, and raw task metadata.
- [Structured Outputs](https://interfaze.ai/docs/structured-output): schema-constrained output capability.
- [Security and Privacy](https://interfaze.ai/docs/security): per-request `x-interfaze-zdr: true` behavior and public security-review contact.
- [Terms of Service](https://interfaze.ai/legal/terms): user-content and output-license terms.
- [Privacy Policy](https://interfaze.ai/legal/privacy): collected content/usage/log categories and stated no-training treatment for stored service data.
- [Data Processing Addendum](https://interfaze.ai/legal/dpa): processor duties, deletion, transfer terms, and service/endpoint/customer ZDR eligibility qualification.
- [Subprocessors](https://interfaze.ai/legal/subprocessors): list updated 2026-08-17, processing locations, change notices, and statement that prompts/responses are not sent to third-party model providers for inference.

## Handoff order

1. Review the two retained Interfaze live-call reconciliations and use them for VR-015; do not rerun OCR for that row.
2. Resolve the documented fixed-task request-shape drift locally before any future fixed-task call.
3. Decide whether VR-016 requires observed non-empty native precontext. If yes, run the one synthetic structured OCR fixture above; if no, document that precontext is conditional and accept the already-proved absent-field plus injected-present branches.
4. Keep VR-017 partial until the account/endpoint ZDR and legal/security policy record exists. Do not send sensitive data as a test.

