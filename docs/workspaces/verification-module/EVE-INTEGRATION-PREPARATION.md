# EVE integration preparation

Historical coordinator inspection, 2026-09-06 UTC. The following preparation notes describe the pre-cutover state. The active adapter now uses the KS client and signed bridge described below; EV-134–136 retain its subsequent runtime evidence.

Installed `eve` is 0.44.4 under `research_ingestion_systems_agent/agents/verification/node_modules/eve`. Root read the EVE skill, bundled docs index, tools, eval overview, built-in tools and context-control guides. The prototype AGENTS.md requires its technical decisions and research/prototype plan plus installed docs before source changes. A future owner must read the complete relevant constraints before implementing the cutover.

The current authored `verify_evidence_bundle.ts` directly imports legacy `@aiengineer/verification-core`. Replace this with a bounded Knowledge Services client/tool that propagates canonical tenant/mission/work-item/attempt/run identity and receives compact recorded findings/handles. Generic algorithms remain in Knowledge Services. Producer/verifier deployment identity must come from trusted runtime configuration; the LLM cannot set its own trusted identity. Preserve prototype parity/rollback evidence before retiring duplicate code.

Default `bash`, `read_file`, `write_file`, `web_fetch`, `web_search`, `agent`, `todo` and `ask_question` are already explicitly disabled with `disableTool()`. Do not re-enable them accidentally. **An additional capability is declared through `agent/extensions/shared.ts`: the shared extension contributes `list_research_records`, which reads `select('*')` from a runtime-selected Supabase table with optional project scope.** This is source-level evidence of an extension capability, not yet a compiled/runtime catalog assertion. During cutover, remove or appropriately isolate that extension from the evidence-closed verifier and prove the actual runtime tool catalog contains only admitted verification capabilities. The tool being bounded to 50 rows is not an evidence-scope/tenant authorization check. Keep this shared extension available to unrelated agents only as their existing policy permits.

EVE authored tools run in the application runtime with `process.env` access; sandbox controls do not sandbox authored TypeScript tool code. Use runtime secrets only for the fixed service call, never return keys/configuration or raw provider bodies. Forward `ctx.abortSignal`. EVE can rerun a tool interrupted before durable completion, so pass a stable operation idempotency key, not a new UUID per retry. Handle retry taxonomy in the service/tool; an exception's arbitrary `retryable` property does not create framework retry semantics.

## Signed runtime bridge configuration

The active verification adapter uses a host-issued, exact
`EVE_VERIFICATION_GRANTS_JSON` entry for each permitted claims or report
request. A signing-enabled entry has `runtimeAttestation` with an issuer, key
ID, and deployed Eve verifier identity. The host derives its stable
idempotency key, deterministic operation ID, and
`eve-verification:<operationId>` correlation ID from that entry. It signs only
the actual callback session/turn/tool-call lineage immediately before POSTing
to Knowledge Services using `EVE_VERIFICATION_SIGNING_PRIVATE_KEY_PEM`.

Knowledge Services must independently configure
`VERIFICATION_EVE_RUNTIME_ATTESTATION_KEYS_JSON` as a bounded public Ed25519
issuer/key allowlist and add a matching `eveRuntimeAuthority` to the exact
server-owned ownership grant. Do not put private signing material, a grant
catalog, tenant routing values, or an arbitrary signer in the model tool
arguments. Unknown or removed keys, keys not listed by the grant, expired or
malformed attestations, and owner/context mismatches fail before submission.

The canonical first binding stores the original external execution; every
newly signed retry JTI is appended to its invocation ledger and resolves back
to that original context. When an attempt has an Eve session or turn registry,
it must corroborate the signed values. This is supplemental to the trusted
API key-and-grant boundary, never a fallback for caller-provided headers.
Roll a key by adding its public key and grant key ID before use, then removing
the old key only after its short attestation lifetime. Removing a grant or key
stops new submissions without mutating historical evidence.

See the [lineage bridge design](swarm-plan-20260906/SW-03-EVE-LINEAGE-BRIDGE-DESIGN-20260908.md)
and its [rollback-only API](../../../../internal/verification-eve-native-admission-805e58bd-54a7-40ec-929c-a504ee4816b1.json)
and [isolated concurrency](../../../../internal/verification-eve-binding-concurrency-288164b9-548b-44ea-aeae-b8d5d3145c9b.json)
receipts before relying on this path. The [EV-136 evidence aggregate](../../../../internal/verification-eve-report-EV136-20260908.json)
adds actual Eve runtime through KS HTTP, worker, PostgreSQL and Storage to an
independently audited signed report. Eve inference was mocked; the KS judge
made one live Luna call. [EV-137](../../../../internal/verification-eve-negative-controls-EV137-20260908.json)
adds native same-deployment and corrupted-locator rejection controls with zero
provider calls. Same-deployment verification stops before sealing and cannot
create a verification run. Capability injection coverage, cancellation/recovery
and live Eve inference remain open.

Bundled eval docs confirm evals boot/target the real HTTP runtime and drive sessions through its client protocol. Use actual EVE eval runs against the service with deterministic assertions for tool usage, forbidden-tool absence, same-deployment refusal, corrupted locators, cancellation/idempotent receipt handling and context-size bounds. `mockModel` is available for real-runtime harness fixtures but must be labeled mocked inference. At least the required live integration/model fixture remains a separate proof. Use economical lab models and declared budget from D-011/D-012; do not confuse eval judge with the agent under test.

Registry discovery was performed using `eve registry search verification --json` and `eve registry search aiengineer --json`. Results are fuzzy skills listings, not a selected native Knowledge Services integration. No registry item was installed. The latter raw non-secret search result is `../../../../internal/verification-eve-registry-search-20260906.log`. The integration owner should inspect the relevant native registry/API options if choosing another connection surface; no `registry view` is warranted for unrelated skill results.

Local Cursor Agent CLI responds with version `2026.04.13-a9d7fb5`. This proves executable availability only, not cloud authentication, cloud execution, or canonical orchestration propagation. Actual Cursor/EVE/Temporal/Mission Control proofs remain WS-10.

Subsequent read-only `agent status --format json` returned status authenticated, isAuthenticated true, hasAccessToken true and hasRefreshToken true. Only these booleans/status were inspected for readiness; no token values were printed or copied. This establishes current CLI authentication state, not successful Cursor Cloud execution or service integration. The installed CLI advertises a cloud flag and headless print mode, but compatibility and actual remote execution must still be proved by WS-10.

## 2026-09-08 current bounded-runtime checkpoint

EV139 independently accepts VR013: the effective catalog contains only verify_evidence_bundle, nine synthetic prohibited names produce zero actions, and the semantic adapter has no provider tools or metadata-instruction projection. This proves capability isolation, not live prompt obedience. The full disposable Eve build/eval now traverses a parent-only-key loopback Gateway adapter with fake upstream and enforces a persistent two-dispatch cap; this remains transport compatibility evidence until the model→verification tool→model native live harness completes. No new provider call has occurred. Canonical adapter/harness EV136 remains preserved.