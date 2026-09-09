# Provider response capture review

Coordinator review,2026-09-06 UTC. Full verification-module goal remains active.

## Implemented boundary

Actual Gateway semantic/structured and Interfaze raw/precontext persistence now supplies observed Response.status. The optional interface field preserves historical/custom callers; operation-bound capture requires an integer200–599 and never infers status from response JSON. Existing five-field response envelopes remain byte-compatible.

The opt-in composer registers `verification_provider_transport_response` containing actual status, full raw/response-envelope handles and exact operation/step/provider-attempt/profile/original-dispatch-fence binding. Ordered parents are response envelope and profile. A pipe-delimited SHA256 transformation binding includes every canonical identity, status, raw/request digest and payload digest; fields are validated UUIDs, hashes and integers. SQL reconstructs that signature so changing status while retaining a valid artifact cannot pass. This is hash-bound custody, not a provider or Ed25519 signature. A configured canonical callback must succeed before a transport capture is exposed; raw bytes survive callback failure. Exact raw/precontext retries preserve capture; changed status/body fails.

`PostgresVerificationProviderResponseCaptureStore.store` snapshots lease and parses transport input, validates its canonical payload/handle/metadata, locks the running structured-extraction operation, exact step/lease and scoped provider ledger, then inserts or returns one exact immutable capture. Recording is allowed while dispatched response_artifact_id is still null, before interpretation/accounting settlement. SQL independently validates ledger/profile/fence/request-envelope ancestry, dedicated artifact type, ordered parents and semantic signature. It assigns captured_at from DBclock. RLS grants bounded same-tenant worker reads/inserts and app_reader reads; mutations/deletes fail. Replacement leases retain original dispatch identity and capture time. Recovery reads are internal metadata, not authenticated Storage-byte replay or public results.

## Evidence

Real proof: `../../../../internal/verification-provider-response-capture-d61246fa-19f2-4799-b1a1-d3d2949d990b.json`, SHA256 `da2cbfd991b390cf4e5850c3353a1339151d237142568b09002943e23c59fbe5`. Thirteen named checks across three actual Gateway adapter scenarios: schema-valid200, schema-invalid200, HTTP503. Injected synthetic Response objects supply exact raw bodies; no supplier HTTP call or billing occurs. Capture is durable before adapter interpretation; direct SQL status substitution fails; repeated capture retains DBtime; wrong/stale leases fail; production heartbeat/natural expiry/higher-fence replacement preserves response status and original dispatch fence. Exactly three initial synthetic fetches, zero recovery dispatches. Proof operations are cancelled afterward. Success output is explicitly an unverified synthetic candidate, not a registered production extraction result.

Independent audit: `../../../../internal/verification-provider-response-capture-audit-20260906.json`, SHA256 `2bea3a480c455e60253927a89f30d2b675d1a420717d4bceddd8e61dd5cc7ea1`. Root independently verifies nine unique live Storage payloads, native canonical/payload/semantic hashes, captured rows, original dispatch fences, cancelled operations/released leases, seven scoped source hashes and actual app_reader same-tenant/foreign-tenant RLS isolation. Synthetic budget:200 reserved and10 settled microUSD.

Local migration06031400 is applied. DBcontract0.2.17 is regenerated/typechecked/packed/locked/installed, with177 shipped files byte-matching canonical sources. No remote migration; remote remains06022000. Strict standalone proof typecheck passes. Full workspace regression result is recorded in EVIDENCE-LOG after completion.

## Remaining executor work

Hydrate and validate captured transport/raw/request/profile bytes for actual memory adapter replay; do not merely return cached candidate JSON. Handle crashes between artifact retention and canonical capture without redispatch. Add durable candidate/result registration, original lifecycle timestamps, canonical terminal guards, configured worker/transports/reads and actual OS-process recovery. Post-cancellation supplier reconciliation remains open. Human gold/calibration, claims/report/adjudication, case/score completeness, disconnected replay, deployment/runtime cutovers, dashboard/human review and final matrix audit remain open.
