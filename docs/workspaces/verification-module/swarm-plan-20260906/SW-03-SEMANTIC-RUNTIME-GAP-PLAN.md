# SW-03 semantic runtime gap — smallest production-shaped slice

Status: read-only allocation plan. The current Gateway callback is useful telemetry but is not durable semantic execution.

## What already exists

- `packages/verification/src/providers/gateway.ts` retains request and raw response bytes through `ProviderArtifactSink` before it parses the Gateway response. Its optional `recordObservation` callback then receives digests, requested/observed model, drift state, revalidation flag, and bounded usage. A mismatched returned model is retained and then fails closed.
- `packages/verification/src/semantic/verification.ts` binds blinded input to a digest, preserves qualifiers/fragments/execution cancellation, validates judgments, and independently composes primary/cross-family identities. `packages/application/src/verification-semantic.ts` rejects producer/verifier and verifier/verifier deployment collisions.
- `VerificationProviderArtifactComposer`, `AccountedVerificationProviderSink`, `PostgresVerificationProviderAccounting`, and `PostgresVerificationProviderResponseCaptureStore` provide the reusable artifact, reservation, dispatch, raw-envelope, unknown-cost, and recovery patterns.
- Claims/report provides generic signed-run, artifact-resolver, fenced-registration, operation/step, and audit-read patterns. Those are reusable custody infrastructure, but its result/policy contracts must not be relabelled as semantic results.

## Blocking mismatch

The provider persistence paths are deliberately hard-coded to `verification_structured_extraction` and `extract_and_register`:

- `PostgresVerificationProviderAccounting.#assertScope` queries that exact operation kind and step key.
- `PostgresVerificationProviderResponseCaptureStore` and DB migration `20260906031300_verification_provider_operation_scope.sql` require an extraction profile and live extraction lease.
- Worker composition exists only in `apps/worker/src/verification-structured-extraction-runtime.ts`; there is no server-owned semantic profile/grant, semantic operation handler, terminal sealer, or public operation admission.

Using this path unchanged for Gateway judging would make semantic provider calls appear to be extraction activity. A source-only adapter cannot repair that custody mismatch.

## Smallest correct production-shaped slice

1. **DB contract first.** Replace/factor the existing provider-scope guards in one reviewed migration so the fixed server-owned scope tuples include exactly:
   - `verification_structured_extraction` / `extract_and_register` / `verification_structured_extraction_profile`; and
   - `verification_semantic` / `verify_semantic_and_register` / `verification_semantic_judge_profile`.
   Add an append-only, one-to-one semantic observation relation bound to a live lease and exact provider attempt. It must bind admitted request/raw/input artifacts, profile digest, provider/model, dispatch fence, model-status/revalidation truth table, server timestamp, usage bounds, and `unknown` cost liability. Preserve all extraction guard, reconciliation, RLS, privilege, and immutable-artifact behavior.
2. **Contracts/application adapter.** Add an internal semantic-observation contract carrying the server-composed `LeasedStep`, profile handle, provider attempt, full blinded-input artifact handle, request/raw artifact references, and Gateway observation. Its application adapter validates exact handles and hands only this trusted context to persistence. Do not add provider SDK types to contracts and do not expose a caller-supplied callback.
3. **Worker factory.** Create a configured semantic runtime parallel to structured extraction. It must obtain the server-owned semantic profile/grant, compose the artifact sink plus accounted provider sink and observation closure, require full input/capture admission, and run the existing `verifySemanticEvidence` algorithm. The closure may supply lease/profile/attempt context missing from `GatewaySemanticResponseObservation`; it must reject absent `inputArtifactDigest` in production.
4. **Terminal custody.** Add semantic operation/result/manifest/sealer contracts and worker activity using the existing fenced generic run recorder and signed artifact substrate. Seal semantic results and observation references under the exact operation/step/lease. Do not reuse claims/report result schemas or claim policy passage simply because a semantic verdict exists.
5. **Only then transport/config.** Add exact operation admission, server-owned key/profile/grant configuration, API/client/CLI/MCP entry points, recovery, and typed compact reads. Default disabled without these grants.

## Focused acceptance tests

- DB rollback-only: reject wrong operation, step, profile, tenant, attempt, stale/expired lease, stale fence, non-admitted input/request/raw handles, duplicate observation, update/delete, model/revalidation inconsistency, negative/unknown-as-zero cost, and non-worker RLS access; retain all extraction controls.
- Worker/application: verify raw bytes persist before callback; missing/mismatched model becomes retained observation then deterministic provider failure; absent blinded-input digest, identity collisions, and cancellation fail closed; recovery has no redispatch.
- Native disposable run: exact semantic provider attempt, request/raw artifacts, observation, sealed terminal result and manifest; unknown/BYOK cost remains unknown. Verify zero tools/search/gui and no policy admission based on raw confidence.
- Transport: deny unconfigured grants and caller-supplied profile/verifier identity; return typed pending/failed/cancelled/success reads without raw provider bytes.

## Remaining non-runtime acceptance gaps

No human-label calibration data, reliability metrics, production/shadow promotion, live provider conformance, or human gold exists. Raw provider confidence remains uncalibrated. The semantic slice must not claim any of these, authority assessment, or policy override authority.
